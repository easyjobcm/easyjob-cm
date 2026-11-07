-- Migration : début de mission, confirmation par code et évaluations (lot 7c audit)
-- Date : 2026-11-07
-- Constats : F-07 (partie missions), F-10 (partie suivi), F-30
-- Tables affectées : missions (trigger, policy UPDATE supprimée, privilèges),
--   mission_check_ins (trigger, policy INSERT supprimée, privilèges),
--   mission_completion_codes (nouvelle), reviews (colonne origin, index,
--   trigger, policy INSERT supprimée, privilèges), candidate_profiles et
--   company_profiles (average_rating, écrit par le trigger d'évaluation),
--   notifications (écrites par les RPC)
-- Fonctions : mission_schedule_bounds, generate_mission_completion_code,
--   create_mission_completion_code, protect_mission_writes,
--   protect_mission_check_in_writes, protect_mission_completion_codes,
--   protect_review_writes, refresh_review_rating, get_mission, candidate_tasks, start_mission,
--   submit_completion_code, company_job_missions, submit_mission_review
--
-- Modèle produit (décisions du 2026-11-06 et du 2026-11-07, AUDIT.md §20) :
--   - Mission rémunérée à la tâche : le montant convenu ne dépend pas de la
--     durée. Les horaires prévus de l'offre restent la référence affichée au
--     candidat et au support ; le début et la fin déclarés servent au suivi.
--     Aucune validation des heures par l'entreprise.
--   - Un candidat sélectionné travaille même sans contrat signé ; sa
--     signature sera exigée au paiement (lot paiement). La tâche « Signer mon
--     contrat » reste visible jusqu'à sa signature.
--   - Début : disponible dès H−15 min (heure prévue, Africa/Douala),
--     enregistré une seule fois par la base.
--   - Fin : l'entreprise communique à chaque candidat présent ayant effectué
--     le travail un code à six chiffres, généré à la sélection (un par
--     mission, distinct pour chaque candidat d'une même offre). Le candidat
--     le saisit après avoir confirmé son début ; la base vérifie et consomme
--     le code et enregistre la réalisation dans la même transaction.
--   - Aucune géolocalisation : ni le GPS ni le seuil de 500 m ne bloquent.
--   - Évaluations : celle de l'entreprise par le candidat est obligatoire
--     (tâche jusqu'à la note) ; celle du candidat par l'entreprise est
--     facultative et ne bloque rien. Une seule évaluation par auteur,
--     mission et sens, entre les deux parties uniquement.
--
-- Code de fin :
--   - Table mission_completion_codes, sans aucun privilège de session ni
--     publication Realtime (missions est publiée avec REPLICA IDENTITY FULL :
--     le code n'y figure pas). Lu seulement par company_job_missions pour
--     l'entreprise propriétaire. Jamais dans get_mission, candidate_tasks,
--     les notifications ni les messages d'erreur.
--   - Généré par trigger à l'insertion de la mission (donc dans la
--     transaction de select_candidate) avec pgcrypto ; zéros initiaux
--     conservés (texte) ; unique par offre. Une relance de la sélection ne
--     crée pas de mission : le code reste le même.
--   - Tentatives : 5 erreurs, puis blocage de 15 minutes, compté en base sous
--     verrou (appels directs et concurrents compris). Une erreur n'est pas
--     une exception : le compteur est enregistré.
--
-- Reprise des données : chaque mission encore à effectuer (pending,
-- confirmed ou in_progress, sans fin enregistrée) reçoit un code neuf, non
-- remis. Aucune remise de code ni évaluation n'est déduite de l'existant :
-- les avis antérieurs (origin = 'legacy') ne comptent ni pour la tâche
-- « Noter l'entreprise » ni dans les étoiles. Requêtes de contrôle (lecture
-- seule) :
--   select ci.mission_id, ci.check_in_type, count(*)
--   from public.mission_check_ins ci
--   join public.missions m on m.id = ci.mission_id
--   where m.actual_start_time is null group by 1, 2;
--   select id, status, actual_start_time, actual_end_time, validated_at,
--          payment_status, platform_fee
--   from public.missions
--   where validated_at is not null or payment_status <> 'pending'
--      or platform_fee <> 0 or actual_start_time is not null;
--   select mission_id, reviewer_type, count(*) from public.reviews
--   group by 1, 2 having count(*) > 1;
--
-- Retour arrière : NE PAS recréer les policies supprimées. En dernier
-- recours : drop des fonctions et triggers listés ci-dessus. La table des
-- codes et la colonne reviews.origin peuvent rester. Transactionnelle.

-- ── 1. Horaires prévus ──────────────────────────────────────────────
-- Début et fin prévus en Africa/Douala ; fin ≤ début : fin le lendemain.
create or replace function public.mission_schedule_bounds(
  p_date date, p_start time, p_end time
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select (p_date + p_start) at time zone 'Africa/Douala',
         ((p_date + p_end) at time zone 'Africa/Douala')
           + case when p_end <= p_start then interval '1 day' else interval '0' end;
$$;

revoke all on function public.mission_schedule_bounds(date, time, time) from public, anon, authenticated;
grant execute on function public.mission_schedule_bounds(date, time, time) to service_role;

-- ── 2. Codes de fin ─────────────────────────────────────────────────
create table if not exists public.mission_completion_codes (
  mission_id uuid primary key references public.missions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  attempt_window_started_at timestamptz,
  locked_until timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mission_completion_codes_job_code_key unique (job_id, code)
);

comment on table public.mission_completion_codes is
  'Code de fin (6 chiffres) par mission. Lu par l''entreprise propriétaire (company_job_missions), consommé par submit_completion_code. Aucun accès de session, hors Realtime.';

alter table public.mission_completion_codes enable row level security;
revoke all on table public.mission_completion_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_completion_codes to service_role;

create or replace function public.generate_mission_completion_code(p_job_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_code text;
begin
  for i in 1..50 loop
    v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint)
                     % 1000000)::text, 6, '0');
    if not exists (select 1 from public.mission_completion_codes c
                   where c.job_id = p_job_id and c.code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'completion_code_exhausted';
end;
$$;

revoke all on function public.generate_mission_completion_code(uuid) from public, anon, authenticated;

create or replace function public.create_mission_completion_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Le verrou de l'offre pris par select_candidate sérialise les sélections
  -- d'une même offre ; l'index unique couvre les autres chemins.
  insert into public.mission_completion_codes (mission_id, job_id, code)
  values (new.id, new.job_id, public.generate_mission_completion_code(new.job_id))
  on conflict (mission_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_mission_completion_code() from public, anon, authenticated;

drop trigger if exists trg_create_mission_completion_code on public.missions;
create trigger trg_create_mission_completion_code
  after insert on public.missions
  for each row execute function public.create_mission_completion_code();

create or replace function public.protect_mission_completion_codes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_completion_codes: no session access' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.mission_id, new.job_id, new.code, new.created_at)
       is distinct from (old.mission_id, old.job_id, old.code, old.created_at) then
      raise exception 'mission_completion_codes: code is immutable' using errcode = '42501';
    end if;
    if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
      raise exception 'mission_completion_codes: code already used' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_mission_completion_codes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_completion_codes on public.mission_completion_codes;
create trigger trg_protect_mission_completion_codes
  before insert or update or delete on public.mission_completion_codes
  for each row execute function public.protect_mission_completion_codes();

-- Reprise : missions encore à effectuer, code neuf (jamais réputé remis).
do $$
declare
  v_mission record;
begin
  for v_mission in
    select m.id, m.job_id from public.missions m
    where m.status in ('pending', 'confirmed', 'in_progress')
      and m.actual_end_time is null
      and not exists (select 1 from public.mission_completion_codes c
                      where c.mission_id = m.id)
    order by m.job_id, m.created_at
  loop
    insert into public.mission_completion_codes (mission_id, job_id, code)
    values (v_mission.id, v_mission.job_id,
            public.generate_mission_completion_code(v_mission.job_id));
  end loop;
end;
$$;

-- ── 3. Écritures sur missions ───────────────────────────────────────
create or replace function public.protect_mission_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'missions: use start_mission / submit_completion_code'
      using errcode = '42501';
  end if;

  -- Tous rôles : un début ou une fin enregistrés ne changent plus.
  if old.actual_start_time is not null
     and new.actual_start_time is distinct from old.actual_start_time then
    raise exception 'missions: start already recorded' using errcode = '42501';
  end if;
  if old.actual_end_time is not null
     and new.actual_end_time is distinct from old.actual_end_time then
    raise exception 'missions: completion already recorded' using errcode = '42501';
  end if;
  if new.actual_end_time is not null and new.actual_start_time is null then
    raise exception 'missions: completion requires a start' using errcode = '42501';
  end if;
  if new.actual_end_time < new.actual_start_time then
    raise exception 'missions: completion before start' using errcode = '42501';
  end if;
  if old.actual_start_time is not null and (
       new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time
     ) is distinct from (
       old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time
     ) then
    raise exception 'missions: schedule is frozen once started' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_mission_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_writes on public.missions;
create trigger trg_protect_mission_writes
  before update on public.missions
  for each row execute function public.protect_mission_writes();

drop policy if exists "Companies can update their job missions" on public.missions;
revoke update, insert, delete, truncate, references, trigger
  on table public.missions from anon, authenticated;

-- ── 4. Événements de suivi (mission_check_ins) ──────────────────────
create or replace function public.protect_mission_check_in_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_check_ins: use start_mission / submit_completion_code'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'mission_check_ins: events are immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_mission_check_in_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_check_in_writes on public.mission_check_ins;
create trigger trg_protect_mission_check_in_writes
  before insert or update or delete on public.mission_check_ins
  for each row execute function public.protect_mission_check_in_writes();

drop policy if exists "Candidates can create check-ins" on public.mission_check_ins;
revoke all on table public.mission_check_ins from anon, authenticated;
grant select (
  id, mission_id, check_in_type, distance_from_job_meters,
  validated_by_company, checked_at, created_at
) on table public.mission_check_ins to authenticated;

-- ── 5. Évaluations ──────────────────────────────────────────────────
alter table public.reviews
  add column if not exists origin text not null default 'legacy';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_origin_chk') then
    alter table public.reviews
      add constraint reviews_origin_chk check (origin in ('legacy', 'mission_flow'));
  end if;
end;
$$;
comment on column public.reviews.origin is
  'mission_flow : écrite par submit_mission_review (parties vérifiées, une par mission et par sens). legacy : antérieure, non vérifiée, ignorée par les tâches et les étoiles.';

create unique index if not exists reviews_mission_flow_unique
  on public.reviews (mission_id, reviewer_type) where origin = 'mission_flow';

create or replace function public.protect_review_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'reviews: use submit_mission_review' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.origin = 'mission_flow' then
    raise exception 'reviews: mission reviews are immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_review_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_review_writes on public.reviews;
create trigger trg_protect_review_writes
  before insert or update or delete on public.reviews
  for each row execute function public.protect_review_writes();

-- Étoiles : moyenne des évaluations vérifiées du profil évalué, arrondie au
-- dixième (règle de updateReliabilityScore, lib/matching/ai-matching).
-- Trigger non exécutable en session : seule average_rating est écrite, et
-- aucune fonction exposée n'écrit les profils (garde-fou F-41, lot 5b).
create or replace function public.refresh_review_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin is distinct from 'mission_flow' then
    return new;
  end if;
  if new.reviewed_type = 'company' then
    update public.company_profiles cp
    set average_rating = coalesce((
      select round(avg(r.overall_rating)::numeric, 1) from public.reviews r
      where r.reviewed_type = 'company' and r.reviewed_id = new.reviewed_id
        and r.origin = 'mission_flow'), 0)
    where cp.id = new.reviewed_id;
  elsif new.reviewed_type = 'candidate' then
    update public.candidate_profiles cp
    set average_rating = coalesce((
      select round(avg(r.overall_rating)::numeric, 1) from public.reviews r
      where r.reviewed_type = 'candidate' and r.reviewed_id = new.reviewed_id
        and r.origin = 'mission_flow'), 0)
    where cp.id = new.reviewed_id;
  end if;
  return new;
end;
$$;

revoke all on function public.refresh_review_rating() from public, anon, authenticated;

drop trigger if exists trg_refresh_review_rating on public.reviews;
create trigger trg_refresh_review_rating
  after insert on public.reviews
  for each row execute function public.refresh_review_rating();

drop policy if exists "Users can create reviews for their missions" on public.reviews;
revoke insert, update, delete, truncate, references, trigger
  on table public.reviews from anon, authenticated;

-- ── 6. Lecture d'une mission par l'une de ses parties (sans code) ───
create or replace function public.get_mission(p_mission_id uuid)
returns table (
  mission_id uuid,
  application_id uuid,
  job_id uuid,
  viewer_party text,
  status public.mission_status,
  job_title text,
  company_id uuid,
  company_name text,
  address text,
  city text,
  hourly_rate numeric,
  scheduled_date date,
  scheduled_start_time time,
  scheduled_end_time time,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  start_available_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  contract_id uuid,
  contract_status public.contract_status,
  candidate_signed boolean,
  candidate_reviewed boolean,
  company_reviewed boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_job public.jobs;
  v_party text;
  v_bounds record;
  v_contract record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;

  if exists (select 1 from public.candidate_profiles cp
             where cp.id = v_mission.candidate_id and cp.user_id = v_uid) then
    v_party := 'candidate';
  elsif exists (select 1 from public.company_profiles cp
                where cp.id = v_job.company_id and cp.user_id = v_uid) then
    v_party := 'company';
  else
    raise exception 'mission_not_found';
  end if;

  select * into v_bounds from public.mission_schedule_bounds(
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time);
  select c.id, c.status, c.candidate_signed_at into v_contract
  from public.contracts c where c.application_id = v_mission.application_id;

  return query select
    v_mission.id, v_mission.application_id, v_mission.job_id, v_party,
    v_mission.status, v_job.title, v_job.company_id,
    (select cp.company_name from public.company_profiles cp where cp.id = v_job.company_id),
    v_job.address, v_job.city, v_job.hourly_rate,
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time,
    v_bounds.starts_at, v_bounds.ends_at, v_bounds.starts_at - interval '15 minutes',
    v_mission.actual_start_time, v_mission.actual_end_time,
    v_contract.id, v_contract.status, v_contract.candidate_signed_at is not null,
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'candidate' and r.origin = 'mission_flow'),
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'company' and r.origin = 'mission_flow'),
    now();
end;
$$;

revoke all on function public.get_mission(uuid) from public, anon;
grant execute on function public.get_mission(uuid) to authenticated;

-- ── 7. Tâches du candidat (sans code) ───────────────────────────────
create or replace function public.candidate_tasks()
returns table (
  mission_id uuid,
  status public.mission_status,
  job_title text,
  company_name text,
  address text,
  city text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  start_available_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  contract_id uuid,
  candidate_signed boolean,
  candidate_reviewed boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  return query
  select m.id, m.status, j.title, cp.company_name, j.address, j.city,
         b.starts_at, b.ends_at, b.starts_at - interval '15 minutes',
         m.actual_start_time, m.actual_end_time,
         c.id, c.candidate_signed_at is not null,
         exists (select 1 from public.reviews r where r.mission_id = m.id
                 and r.reviewer_type = 'candidate' and r.origin = 'mission_flow'),
         now()
  from public.missions m
  join public.candidate_profiles cand on cand.id = m.candidate_id and cand.user_id = v_uid
  join public.jobs j on j.id = m.job_id
  left join public.company_profiles cp on cp.id = j.company_id
  left join public.contracts c on c.application_id = m.application_id
  cross join lateral public.mission_schedule_bounds(
    m.scheduled_date, m.scheduled_start_time, m.scheduled_end_time) b
  where m.status not in ('cancelled', 'no_show')
    and (
      m.actual_end_time is null
      or (c.id is not null and c.candidate_signed_at is null)
      or not exists (select 1 from public.reviews r where r.mission_id = m.id
                     and r.reviewer_type = 'candidate' and r.origin = 'mission_flow')
    )
  order by b.starts_at;
end;
$$;

revoke all on function public.candidate_tasks() from public, anon;
grant execute on function public.candidate_tasks() to authenticated;

-- ── 8. Début de mission ─────────────────────────────────────────────
create or replace function public.start_mission(p_mission_id uuid)
returns table (
  mission_id uuid,
  status public.mission_status,
  started_at timestamptz,
  already_started boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_active boolean;
  v_mission public.missions;
  v_job public.jobs;
  v_candidate record;
  v_bounds record;
  v_application_status public.application_status;
  v_company record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select cp.id, cp.first_name into v_candidate from public.candidate_profiles cp
  where cp.id = v_mission.candidate_id and cp.user_id = v_uid;
  if not found then
    raise exception 'mission_not_found';
  end if;

  -- Relance : début d'origine, sans écriture.
  if v_mission.actual_start_time is not null then
    return query select v_mission.id, v_mission.status, v_mission.actual_start_time, true;
    return;
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status not in ('pending', 'confirmed')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;

  select * into v_bounds from public.mission_schedule_bounds(
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time);
  if now() < v_bounds.starts_at - interval '15 minutes' then
    raise exception 'too_early'
      using detail = to_char((v_bounds.starts_at - interval '15 minutes') at time zone 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  insert into public.mission_check_ins (mission_id, check_in_type, checked_at)
  values (v_mission.id, 'arrival', now());
  update public.missions m
  set actual_start_time = now(), status = 'in_progress'
  where m.id = v_mission.id
  returning m.* into v_mission;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;
  select cp.user_id, u.locale::text as locale into v_company
  from public.company_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id, 'mission_update',
      case when v_company.locale = 'en' then 'Mission started' else 'Mission commencée' end,
      case when v_company.locale = 'en'
        then coalesce(v_candidate.first_name, 'The candidate') || ' started "' || v_job.title || '".'
        else coalesce(v_candidate.first_name, 'Le candidat') || ' a commencé « ' || v_job.title || ' ».' end,
      jsonb_build_object('mission_id', v_mission.id, 'job_id', v_job.id,
                         'mission_status', v_mission.status)
    );
  end if;

  return query select v_mission.id, v_mission.status, v_mission.actual_start_time, false;
end;
$$;

revoke all on function public.start_mission(uuid) from public, anon;
grant execute on function public.start_mission(uuid) to authenticated;

-- ── 9. Confirmation par code ────────────────────────────────────────
-- Résultats : completed (réalisation enregistrée ou déjà enregistrée),
-- invalid (code erroné, tentative comptée), locked (trop d'erreurs).
-- Les refus de contexte sont des exceptions (rien n'est écrit).
create or replace function public.submit_completion_code(
  p_mission_id uuid,
  p_code text
)
returns table (
  result text,
  mission_id uuid,
  completed_at timestamptz,
  remaining_attempts integer,
  locked_until timestamptz,
  already_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_active boolean;
  v_mission public.missions;
  v_job public.jobs;
  v_candidate record;
  v_code public.mission_completion_codes;
  v_application_status public.application_status;
  v_company record;
  v_failed integer;
  v_window timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  -- Verrou de la mission : soumissions concurrentes sérialisées.
  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select cp.id, cp.first_name into v_candidate from public.candidate_profiles cp
  where cp.id = v_mission.candidate_id and cp.user_id = v_uid;
  if not found then
    raise exception 'mission_not_found';
  end if;

  -- Relance après succès : confirmation d'origine, sans écriture.
  if v_mission.actual_end_time is not null then
    return query select 'completed'::text, v_mission.id, v_mission.actual_end_time,
      null::integer, null::timestamptz, true;
    return;
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status in ('cancelled', 'no_show', 'disputed')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;
  if v_mission.actual_start_time is null then
    raise exception 'not_started';
  end if;

  select c.* into v_code from public.mission_completion_codes c
  where c.mission_id = v_mission.id for update;
  if not found or v_code.consumed_at is not null then
    raise exception 'code_unavailable';
  end if;

  if v_code.locked_until is not null and v_code.locked_until > now() then
    return query select 'locked'::text, v_mission.id, null::timestamptz, 0,
      v_code.locked_until, false;
    return;
  end if;

  if p_code is null or btrim(p_code) is distinct from v_code.code then
    -- Fenêtre de 15 minutes : au-delà, le compteur repart de zéro.
    v_window := case when v_code.attempt_window_started_at is null
                       or v_code.attempt_window_started_at < now() - interval '15 minutes'
                     then now() else v_code.attempt_window_started_at end;
    v_failed := case when v_window = now() then 1 else v_code.failed_attempts + 1 end;
    if v_failed >= 5 then
      update public.mission_completion_codes c
      set failed_attempts = 0, attempt_window_started_at = null,
          locked_until = now() + interval '15 minutes'
      where c.mission_id = v_mission.id
      returning c.* into v_code;
      return query select 'locked'::text, v_mission.id, null::timestamptz, 0,
        v_code.locked_until, false;
    else
      update public.mission_completion_codes c
      set failed_attempts = v_failed, attempt_window_started_at = v_window,
          locked_until = null
      where c.mission_id = v_mission.id;
      return query select 'invalid'::text, v_mission.id, null::timestamptz,
        5 - v_failed, null::timestamptz, false;
    end if;
    return;
  end if;

  -- Code exact : consommation et réalisation dans la même transaction.
  update public.mission_completion_codes c
  set consumed_at = now(), failed_attempts = 0, attempt_window_started_at = null,
      locked_until = null
  where c.mission_id = v_mission.id;
  insert into public.mission_check_ins (mission_id, check_in_type, checked_at)
  values (v_mission.id, 'departure', now());
  update public.missions m
  set actual_end_time = now(), status = 'completed'
  where m.id = v_mission.id
  returning m.* into v_mission;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;
  select cp.user_id, u.locale::text as locale into v_company
  from public.company_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id, 'mission_update',
      case when v_company.locale = 'en' then 'Mission completed' else 'Mission réalisée' end,
      case when v_company.locale = 'en'
        then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed the completion of "' || v_job.title || '".'
        else coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé la réalisation de « ' || v_job.title || ' ».' end,
      jsonb_build_object('mission_id', v_mission.id, 'job_id', v_job.id,
                         'mission_status', v_mission.status)
    );
  end if;

  return query select 'completed'::text, v_mission.id, v_mission.actual_end_time,
    null::integer, null::timestamptz, false;
end;
$$;

revoke all on function public.submit_completion_code(uuid, text) from public, anon;
grant execute on function public.submit_completion_code(uuid, text) to authenticated;

-- ── 10. Missions d'une offre, vues par l'entreprise propriétaire ────
create or replace function public.company_job_missions(p_job_id uuid)
returns table (
  mission_id uuid,
  application_id uuid,
  status public.mission_status,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_code text,
  code_used boolean,
  company_reviewed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs j
    join public.company_profiles cp on cp.id = j.company_id
    where j.id = p_job_id and cp.user_id = (select auth.uid())
  ) then
    raise exception 'job_not_found';
  end if;

  return query
  select m.id, m.application_id, m.status, b.starts_at, b.ends_at,
         m.actual_start_time, m.actual_end_time,
         -- Code lisible tant qu'il peut encore servir.
         case when c.consumed_at is null and m.status not in ('cancelled', 'no_show')
              then c.code end,
         c.consumed_at is not null,
         exists (select 1 from public.reviews r where r.mission_id = m.id
                 and r.reviewer_type = 'company' and r.origin = 'mission_flow')
  from public.missions m
  left join public.mission_completion_codes c on c.mission_id = m.id
  cross join lateral public.mission_schedule_bounds(
    m.scheduled_date, m.scheduled_start_time, m.scheduled_end_time) b
  where m.job_id = p_job_id
  order by m.scheduled_date, m.created_at;
end;
$$;

revoke all on function public.company_job_missions(uuid) from public, anon;
grant execute on function public.company_job_missions(uuid) to authenticated;

-- ── 11. Évaluation après réalisation ────────────────────────────────
create or replace function public.submit_mission_review(
  p_mission_id uuid,
  p_rating integer,
  p_comment text default null
)
returns table (
  review_id uuid,
  reviewer_type text,
  overall_rating integer,
  created_at timestamptz,
  already_reviewed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_active boolean;
  v_mission public.missions;
  v_job public.jobs;
  v_candidate_id uuid;
  v_company_id uuid;
  v_side text;
  v_existing public.reviews;
  v_review public.reviews;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;

  select cp.id into v_candidate_id from public.candidate_profiles cp
  where cp.id = v_mission.candidate_id and cp.user_id = v_uid;
  select cp.id into v_company_id from public.company_profiles cp
  where cp.id = v_job.company_id and cp.user_id = v_uid;
  if v_candidate_id is not null then
    v_side := 'candidate';
  elsif v_company_id is not null then
    v_side := 'company';
  else
    raise exception 'mission_not_found';
  end if;

  select r.* into v_existing from public.reviews r
  where r.mission_id = v_mission.id and r.reviewer_type = v_side
    and r.origin = 'mission_flow';
  if found then
    return query select v_existing.id, v_existing.reviewer_type,
      v_existing.overall_rating, v_existing.created_at, true;
    return;
  end if;

  if v_mission.actual_end_time is null then
    raise exception 'mission_not_completed';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating_invalid';
  end if;
  if v_comment is not null and length(v_comment) > 1000 then
    raise exception 'comment_too_long';
  end if;

  insert into public.reviews (
    mission_id, reviewer_type, reviewer_id, reviewed_type, reviewed_id,
    overall_rating, comment, origin
  ) values (
    v_mission.id, v_side,
    case when v_side = 'candidate' then v_mission.candidate_id else v_job.company_id end,
    case when v_side = 'candidate' then 'company' else 'candidate' end,
    case when v_side = 'candidate' then v_job.company_id else v_mission.candidate_id end,
    p_rating, v_comment, 'mission_flow'
  )
  returning * into v_review;

  -- Étoiles du profil évalué : trigger trg_refresh_review_rating.

  return query select v_review.id, v_review.reviewer_type, v_review.overall_rating,
    v_review.created_at, false;
end;
$$;

revoke all on function public.submit_mission_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_mission_review(uuid, integer, text) to authenticated;
