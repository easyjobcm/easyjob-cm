-- Lot 12 — offres de plusieurs journées (dates choisies explicitement).
-- Non déployée.
--
-- Tables affectées : jobs (schedule_format, régime 'per_day'), job_days
--   (nouvelle), job_applications (job_day_id, unicités), missions (première
--   journée créée par trigger), mission_days (nouvelle),
--   mission_completion_codes (rattachés à la journée de mission),
--   contract_clause_versions (simple-v3, formal-v3).
-- Fonctions : job_days_parse, job_days_unpublishable, job_effective_days,
--   candidate_schedule_conflicts, protect_job_day_writes,
--   protect_mission_day_writes, create_mission_first_day,
--   sync_single_mission_day, create_mission_day_completion_code,
--   protect_mission_completion_codes, sync_job_positions_filled,
--   job_publication_guard, create_job, update_job, moderate_job,
--   apply_to_job_core, apply_to_job, apply_to_job_days, select_candidate,
--   start_mission, submit_completion_code, get_mission, candidate_tasks,
--   company_job_missions, company_job_applicants, job_days_for_candidate,
--   compute_reputation, reputation_company_offers,
--   reputation_company_next_close, reputation_expiry_sweep, rt_on_job_days.
--
-- Deux formats (décision produit, PLAN_ACTION.md lot 12) :
--   * full_period (« période complète ») : une candidature et une sélection
--     pour l'ensemble ; un montant fixe par candidat pour toute la période
--     (jobs.mission_pay_per_candidate, jamais divisé) ; un contrat et une
--     mission globale suivie par journée (mission_days), un code par journée
--     et par candidat ; la mission est réalisée quand toutes ses journées
--     sont confirmées. Régime et échéance : ceux de l'offre, fondés sur le
--     premier début (lot 11b inchangé). Une offre d'une seule journée est
--     une période complète d'une journée (parcours simple conservé).
--   * per_day (« journées au choix ») : montant et places propres à chaque
--     journée (job_days) ; une candidature par journée (job_day_id) ; chaque
--     sélection produit sa mission, son contrat et son code. Régime et
--     échéance propres à chaque journée, fixés à la première publication
--     effective. Au niveau de l'offre : publication_regime = 'per_day',
--     applications_close_at = dernière échéance des journées (l'offre reste
--     proposée tant qu'une journée est ouverte), mission_pay_per_candidate =
--     plus petit montant journalier et positions_available = somme des
--     places (résumés d'affichage, jamais utilisés pour un contrat).
--
-- Calendrier : dates explicites (1 à 31), sans doublon, jamais déduites d'un
-- intervalle ; horaires par journée (le formulaire peut appliquer les mêmes
-- à toutes) ; bornes en Africa/Douala, fin ≤ début → lendemain (journée qui
-- traverse minuit, mission_schedule_bounds) ; aucun chevauchement interne.
-- Les colonnes start_date, start_time, end_time (première journée) et
-- end_date (dernière journée) de jobs deviennent un résumé tenu par les RPC.
-- Après la première publication, le calendrier est figé pour tout auteur
-- (ajout, suppression, dates, horaires, format) : job_schedule_locked.
--
-- Engagements : une candidature ne réserve aucune place. À la sélection, la
-- capacité est vérifiée sous le verrou de l'offre ; les conflits avec les
-- engagements du candidat (missions non annulées) sous un verrou consultatif
-- propre au candidat, pris par toutes les sélections : aucun chevauchement
-- et au moins 3 h entre deux engagements distincts (exactement 3 h :
-- admis). Les journées d'une même mission globale ne sont pas des
-- engagements distincts (seul le chevauchement est interdit, par la saisie).
-- Le refus envoyé à l'entreprise ne contient aucun détail des autres
-- engagements (candidate_schedule_conflict).
--
-- Hors lot (documenté) : signalement d'une journée non confirmée, absence,
-- contestation, remplacement, sanction, remboursement : lot « Engagements
-- et annulations ». Une journée non confirmée reste non confirmée, sans
-- sanction, sans annulation des suivantes et sans paiement. Signature de
-- l'entreprise avant sélection : lot contrats (inchangé ici).
--
-- Reprise (aucune donnée inventée) :
--   * offre sans intervalle (end_date nulle ou égale au début) : une journée
--     job_days identique à son horaire, comme la mission que select_candidate
--     créait déjà sur start_date ;
--   * offre à intervalle (end_date > start_date) : sens non établi, AUCUNE
--     journée créée ; elle ne peut pas être publiée tant que l'entreprise
--     n'a pas saisi ses dates (job_days_missing) ; offres publiées : closes
--     (lot 11b), engagements conservés. Diagnostic affiché en fin de fichier ;
--   * chaque mission existante reçoit une journée (son horaire prévu, son
--     début et sa fin enregistrés) ; son code y est rattaché, inchangé.
--
-- Retour arrière (dernier recours, pile non déployée) : recréer les
-- fonctions depuis 20261112120000, 20261109120000, 20261107120000 et
-- 20261106140000 (drop des nouvelles signatures avant) ; remettre la clé
-- primaire de mission_completion_codes sur mission_id (une seule ligne par
-- mission requise) ; drop table mission_days, job_days ; alter table
-- job_applications drop column job_day_id puis recréer la contrainte
-- job_applications_job_id_candidate_id_key ; alter table jobs drop column
-- schedule_format. Les clauses v3 restent (versions immuables).

-- ════════════════════════════════════════════════════════════════════
-- 1. Format et calendrier
-- ════════════════════════════════════════════════════════════════════
alter table public.jobs
  add column if not exists schedule_format text not null default 'full_period';

alter table public.jobs drop constraint if exists jobs_schedule_format_chk;
alter table public.jobs add constraint jobs_schedule_format_chk
  check (schedule_format in ('full_period', 'per_day'));

alter table public.jobs drop constraint if exists jobs_publication_regime_chk;
alter table public.jobs add constraint jobs_publication_regime_chk
  check (publication_regime is null or publication_regime in ('normal', 'urgent', 'per_day'));

comment on column public.jobs.schedule_format is
  'Lot 12 : full_period (une candidature, un contrat, une mission globale pour toutes les journées) ou per_day (candidature, contrat et mission par journée). Figé après la première publication.';
comment on column public.jobs.publication_regime is
  'Lot 11b : normal (clôture H−24) ou urgent (clôture H−2), figé à la première publication. Lot 12 : per_day = régime propre à chaque journée (job_days).';

create table if not exists public.job_days (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  day_date date not null,
  start_time time not null,
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mission_pay_per_candidate integer,
  positions_available integer,
  positions_filled integer not null default 0,
  publication_regime text,
  applications_close_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_days_job_date_key unique (job_id, day_date),
  constraint job_days_id_job_key unique (id, job_id),
  constraint job_days_bounds_chk check (ends_at > starts_at and start_time <> end_time),
  constraint job_days_pay_chk check (mission_pay_per_candidate is null or mission_pay_per_candidate > 0),
  constraint job_days_positions_chk check (positions_available is null or positions_available >= 1),
  constraint job_days_filled_chk check (positions_filled >= 0),
  constraint job_days_regime_chk check (publication_regime is null or publication_regime in ('normal', 'urgent')),
  constraint job_days_publication_consistent_chk
    check ((publication_regime is null) = (applications_close_at is null))
);

create index if not exists idx_job_days_job_starts on public.job_days (job_id, starts_at);

comment on table public.job_days is
  'Lot 12 : journées explicites d''une offre (heure de Douala, fin ≤ début → lendemain). Montant, places, régime et échéance par journée seulement pour le format per_day. Écrites par create_job / update_job ; figées après la première publication.';

alter table public.job_days enable row level security;
revoke all on table public.job_days from public, anon, authenticated;
grant select on table public.job_days to anon, authenticated;
grant select, insert, update, delete on table public.job_days to service_role;

-- Lecture : mêmes offres que celles que la session peut lire (RLS de jobs).
drop policy if exists "Job days follow job visibility" on public.job_days;
create policy "Job days follow job visibility" on public.job_days
  for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.id = job_days.job_id));

-- Reprise : offres sans intervalle seulement (voir l'en-tête).
insert into public.job_days (job_id, day_date, start_time, end_time, starts_at, ends_at)
select j.id, j.start_date, j.start_time, j.end_time, b.starts_at, b.ends_at
from public.jobs j
cross join lateral public.mission_schedule_bounds(j.start_date, j.start_time, j.end_time) b
where (j.end_date is null or j.end_date = j.start_date)
  and j.start_time <> j.end_time
on conflict (job_id, day_date) do nothing;

-- Écritures : jamais en session ; calendrier figé après publication.
create or replace function public.protect_job_day_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  v_published boolean;
  v_bounds record;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'job_days: use create_job / update_job' using errcode = '42501';
  end if;

  -- Offre absente (suppression en cascade) : rien n'est figé.
  select (j.first_published_at is not null or j.legacy_publication) into v_published
  from public.jobs j where j.id = v_job_id;
  v_published := coalesce(v_published, false);

  if tg_op = 'DELETE' then
    if v_published then
      raise exception 'job_schedule_locked' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and v_published then
    raise exception 'job_schedule_locked' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.job_id is distinct from old.job_id then
      raise exception 'job_days: job is immutable' using errcode = '42501';
    end if;
    if v_published and (new.day_date, new.start_time, new.end_time)
       is distinct from (old.day_date, old.start_time, old.end_time) then
      raise exception 'job_schedule_locked' using errcode = '42501';
    end if;
    if old.applications_close_at is not null
       and (new.publication_regime, new.applications_close_at)
           is distinct from (old.publication_regime, old.applications_close_at) then
      raise exception 'publication_regime_locked' using errcode = '42501';
    end if;
  end if;

  select * into v_bounds from public.mission_schedule_bounds(new.day_date, new.start_time, new.end_time);
  new.starts_at := v_bounds.starts_at;
  new.ends_at := v_bounds.ends_at;

  if exists (select 1 from public.job_days d
             where d.job_id = new.job_id and d.id <> new.id
               and tstzrange(d.starts_at, d.ends_at) && tstzrange(new.starts_at, new.ends_at)) then
    raise exception 'invalid_job_data' using detail = 'days_overlap';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_job_day_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_job_day_writes on public.job_days;
create trigger trg_protect_job_day_writes
  before insert or update or delete on public.job_days
  for each row execute function public.protect_job_day_writes();

-- ════════════════════════════════════════════════════════════════════
-- 2. Candidatures par journée
-- ════════════════════════════════════════════════════════════════════
alter table public.job_applications
  add column if not exists job_day_id uuid;

alter table public.job_applications drop constraint if exists job_applications_job_day_fkey;
alter table public.job_applications add constraint job_applications_job_day_fkey
  foreign key (job_day_id, job_id) references public.job_days(id, job_id) on delete cascade;

comment on column public.job_applications.job_day_id is
  'Lot 12 : journée visée (format per_day) ; null pour une période complète. Écrite par apply_to_job_days uniquement.';

-- Une candidature par offre (période complète) ou par journée (au choix),
-- y compris après retrait ou refus : rien n'est rouvert.
alter table public.job_applications
  drop constraint if exists job_applications_job_id_candidate_id_key;
create unique index if not exists job_applications_job_candidate_key
  on public.job_applications (job_id, candidate_id) where job_day_id is null;
create unique index if not exists job_applications_day_candidate_key
  on public.job_applications (job_day_id, candidate_id) where job_day_id is not null;

-- Places pourvues : offre (lot 6) et journée.
create or replace function public.sync_job_positions_filled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer := case when new.status = 'selected' then 1 else -1 end;
begin
  update public.jobs j
  set positions_filled = greatest(coalesce(j.positions_filled, 0) + v_delta, 0)
  where j.id = new.job_id;
  if new.job_day_id is not null then
    update public.job_days d
    set positions_filled = greatest(d.positions_filled + v_delta, 0)
    where d.id = new.job_day_id;
  end if;
  return null;
end;
$$;
revoke all on function public.sync_job_positions_filled() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. Journées de mission et codes
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.mission_days (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  job_day_id uuid references public.job_days(id) on delete set null,
  scheduled_date date not null,
  scheduled_start_time time not null,
  scheduled_end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  actual_start_time timestamptz,
  actual_end_time timestamptz,
  created_at timestamptz not null default now(),
  constraint mission_days_mission_date_key unique (mission_id, scheduled_date),
  constraint mission_days_bounds_chk check (ends_at > starts_at),
  constraint mission_days_actual_chk check (
    actual_end_time is null
    or (actual_start_time is not null and actual_end_time >= actual_start_time))
);

create index if not exists idx_mission_days_mission on public.mission_days (mission_id, starts_at);
create index if not exists idx_mission_days_range on public.mission_days (starts_at, ends_at);

comment on table public.mission_days is
  'Lot 12 : journées d''une mission (une pour une mission journalière, toutes les journées prévues pour une période complète). Début et confirmation par code enregistrés par journée. Aucun accès de session : lecture par get_mission, candidate_tasks et company_job_missions.';

alter table public.mission_days enable row level security;
revoke all on table public.mission_days from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_days to service_role;

-- Reprise : une journée par mission existante (horaire prévu, début et fin
-- enregistrés), rattachée à la journée de l'offre de même date si elle existe.
insert into public.mission_days (
  mission_id, job_day_id, scheduled_date, scheduled_start_time, scheduled_end_time,
  starts_at, ends_at, actual_start_time, actual_end_time
)
select m.id,
       (select d.id from public.job_days d
        where d.job_id = m.job_id and d.day_date = m.scheduled_date),
       m.scheduled_date, m.scheduled_start_time, m.scheduled_end_time,
       b.starts_at, b.ends_at, m.actual_start_time,
       case when m.actual_start_time is not null then m.actual_end_time end
from public.missions m
cross join lateral public.mission_schedule_bounds(
  m.scheduled_date, m.scheduled_start_time, m.scheduled_end_time) b
on conflict (mission_id, scheduled_date) do nothing;

-- Codes : rattachés à la journée de mission (un par journée et par candidat).
alter table public.mission_completion_codes
  add column if not exists mission_day_id uuid references public.mission_days(id) on delete cascade;

alter table public.mission_completion_codes disable trigger user;
update public.mission_completion_codes c
set mission_day_id = md.id
from public.mission_days md
where md.mission_id = c.mission_id and c.mission_day_id is null;
alter table public.mission_completion_codes enable trigger user;

do $$
begin
  if exists (select 1 from public.mission_completion_codes where mission_day_id is null) then
    raise exception 'lot 12: code sans journée de mission (reprise impossible)';
  end if;
end $$;

alter table public.mission_completion_codes alter column mission_day_id set not null;
alter table public.mission_completion_codes drop constraint if exists mission_completion_codes_pkey;
alter table public.mission_completion_codes add constraint mission_completion_codes_pkey
  primary key (mission_day_id);
create index if not exists idx_mission_completion_codes_mission
  on public.mission_completion_codes (mission_id);

comment on table public.mission_completion_codes is
  'Code de fin (6 chiffres) par journée de mission (lot 12), unique dans l''offre. Lu par l''entreprise propriétaire (company_job_missions), consommé par submit_completion_code. Aucun accès de session, hors Realtime.';

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
    if (new.mission_id, new.mission_day_id, new.job_id, new.code, new.created_at)
       is distinct from
       (old.mission_id, old.mission_day_id, old.job_id, old.code, old.created_at) then
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

create or replace function public.protect_mission_day_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bounds record;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_days: use start_mission / submit_completion_code'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.mission_id is distinct from old.mission_id
       or (new.job_day_id is distinct from old.job_day_id and new.job_day_id is not null) then
      raise exception 'mission_days: mission is immutable' using errcode = '42501';
    end if;
    if old.actual_start_time is not null
       and new.actual_start_time is distinct from old.actual_start_time then
      raise exception 'mission_days: start already recorded' using errcode = '42501';
    end if;
    if old.actual_end_time is not null
       and new.actual_end_time is distinct from old.actual_end_time then
      raise exception 'mission_days: completion already recorded' using errcode = '42501';
    end if;
    if old.actual_start_time is not null
       and (new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time)
           is distinct from (old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time) then
      raise exception 'mission_days: schedule is frozen once started' using errcode = '42501';
    end if;
  end if;
  select * into v_bounds from public.mission_schedule_bounds(
    new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time);
  new.starts_at := v_bounds.starts_at;
  new.ends_at := v_bounds.ends_at;
  return new;
end;
$$;
revoke all on function public.protect_mission_day_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_day_writes on public.mission_days;
create trigger trg_protect_mission_day_writes
  before insert or update or delete on public.mission_days
  for each row execute function public.protect_mission_day_writes();

-- Première journée : créée avec la mission (même transaction), quel que
-- soit l'auteur ; select_candidate ajoute les suivantes d'une période.
create or replace function public.create_mission_first_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.mission_days (
    mission_id, job_day_id, scheduled_date, scheduled_start_time, scheduled_end_time,
    starts_at, ends_at
  ) values (
    new.id,
    (select d.id from public.job_days d
     where d.job_id = new.job_id and d.day_date = new.scheduled_date),
    new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time,
    -- Recalculées par trg_protect_mission_day_writes.
    now(), now() + interval '1 second'
  )
  on conflict (mission_id, scheduled_date) do nothing;
  return new;
end;
$$;
revoke all on function public.create_mission_first_day() from public, anon, authenticated;

-- L'ancien code par mission est remplacé par un code par journée.
drop trigger if exists trg_create_mission_completion_code on public.missions;
drop function if exists public.create_mission_completion_code();

drop trigger if exists trg_create_mission_first_day on public.missions;
create trigger trg_create_mission_first_day
  after insert on public.missions
  for each row execute function public.create_mission_first_day();

-- Horaire d'une mission d'une journée : la journée suit (écritures de
-- service, ex. preuves) ; une mission de plusieurs journées ne change pas.
create or replace function public.sync_single_mission_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time)
     is not distinct from (old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time) then
    return null;
  end if;
  select count(*) into v_count from public.mission_days d where d.mission_id = new.id;
  if v_count > 1 then
    raise exception 'missions: multi-day schedule is frozen' using errcode = '42501';
  end if;
  update public.mission_days d
  set scheduled_date = new.scheduled_date,
      scheduled_start_time = new.scheduled_start_time,
      scheduled_end_time = new.scheduled_end_time
  where d.mission_id = new.id;
  return null;
end;
$$;
revoke all on function public.sync_single_mission_day() from public, anon, authenticated;

drop trigger if exists trg_sync_single_mission_day on public.missions;
create trigger trg_sync_single_mission_day
  after update of scheduled_date, scheduled_start_time, scheduled_end_time on public.missions
  for each row execute function public.sync_single_mission_day();

create or replace function public.create_mission_day_completion_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select m.job_id into v_job_id from public.missions m where m.id = new.mission_id;
  -- Le verrou de l'offre pris par select_candidate sérialise les sélections
  -- d'une même offre ; l'index unique (job_id, code) couvre les autres
  -- chemins. Unique dans l'offre : aucune ambiguïté entre candidats ni
  -- entre journées.
  insert into public.mission_completion_codes (mission_day_id, mission_id, job_id, code)
  values (new.id, new.mission_id, v_job_id, public.generate_mission_completion_code(v_job_id))
  on conflict (mission_day_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_mission_day_completion_code() from public, anon, authenticated;

drop trigger if exists trg_create_mission_day_completion_code on public.mission_days;
create trigger trg_create_mission_day_completion_code
  after insert on public.mission_days
  for each row execute function public.create_mission_day_completion_code();

-- Missions encore à effectuer sans code (aucune attendue) : code neuf.
insert into public.mission_completion_codes (mission_day_id, mission_id, job_id, code)
select md.id, m.id, m.job_id, public.generate_mission_completion_code(m.job_id)
from public.mission_days md
join public.missions m on m.id = md.mission_id
where m.status in ('pending', 'confirmed', 'in_progress')
  and md.actual_end_time is null
  and not exists (select 1 from public.mission_completion_codes c where c.mission_day_id = md.id);

-- ════════════════════════════════════════════════════════════════════
-- 4. Règles partagées
-- ════════════════════════════════════════════════════════════════════

-- Calendrier soumis : validé et trié par début. Détails d'erreur :
-- days (forme), days_count (1 à 31), days_time (début = fin),
-- days_duplicate (même date), days_overlap (chevauchement interne),
-- days_pay / days_positions (format per_day ; interdits en full_period).
create or replace function public.job_days_parse(p_format text, p_days jsonb)
returns table (
  day_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  mission_pay_per_candidate integer,
  positions_available integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_date date;
  v_st time;
  v_et time;
  v_num numeric;
  v_dates date[] := '{}';
  v_sts time[] := '{}';
  v_ets time[] := '{}';
  v_pays integer[] := '{}';
  v_pos integer[] := '{}';
begin
  if p_format is null or p_format not in ('full_period', 'per_day') then
    raise exception 'invalid_job_data' using detail = 'schedule_format';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' then
    raise exception 'invalid_job_data' using detail = 'days';
  end if;
  if jsonb_array_length(p_days) < 1 or jsonb_array_length(p_days) > 31 then
    raise exception 'invalid_job_data' using detail = 'days_count';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_days) e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_job_data' using detail = 'days';
    end if;
    begin
      v_date := (v_item ->> 'date')::date;
      v_st := (v_item ->> 'start_time')::time;
      v_et := (v_item ->> 'end_time')::time;
    exception
      when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow then
        raise exception 'invalid_job_data' using detail = 'days';
    end;
    if v_date is null or v_st is null or v_et is null then
      raise exception 'invalid_job_data' using detail = 'days';
    end if;
    if v_st = v_et then
      raise exception 'invalid_job_data' using detail = 'days_time';
    end if;

    if p_format = 'per_day' then
      if jsonb_typeof(v_item -> 'mission_pay_per_candidate') is distinct from 'number' then
        raise exception 'invalid_job_data' using detail = 'days_pay';
      end if;
      v_num := (v_item ->> 'mission_pay_per_candidate')::numeric;
      if v_num <> trunc(v_num) or v_num <= 0 or v_num > 2147483647 then
        raise exception 'invalid_job_data' using detail = 'days_pay';
      end if;
      v_pays := v_pays || v_num::integer;
      if v_item ? 'positions_available' then
        if jsonb_typeof(v_item -> 'positions_available') is distinct from 'number' then
          raise exception 'invalid_job_data' using detail = 'days_positions';
        end if;
        v_num := (v_item ->> 'positions_available')::numeric;
        if v_num <> trunc(v_num) or v_num < 1 or v_num > 10000 then
          raise exception 'invalid_job_data' using detail = 'days_positions';
        end if;
        v_pos := v_pos || v_num::integer;
      else
        v_pos := v_pos || 1;
      end if;
    else
      -- Période complète : un seul montant et une seule capacité, ceux de
      -- l'offre. Aucun montant journalier (jamais une division du forfait).
      if v_item ? 'mission_pay_per_candidate' then
        raise exception 'invalid_job_data' using detail = 'days_pay';
      end if;
      if v_item ? 'positions_available' then
        raise exception 'invalid_job_data' using detail = 'days_positions';
      end if;
      v_pays := v_pays || null::integer;
      v_pos := v_pos || null::integer;
    end if;

    v_dates := v_dates || v_date;
    v_sts := v_sts || v_st;
    v_ets := v_ets || v_et;
  end loop;

  if (select count(distinct x) from unnest(v_dates) x) <> cardinality(v_dates) then
    raise exception 'invalid_job_data' using detail = 'days_duplicate';
  end if;

  if exists (
    select 1 from (
      select b.starts_at as s,
             lag(b.ends_at) over (order by b.starts_at) as prev_end
      from unnest(v_dates, v_sts, v_ets) u(d, st, et)
      cross join lateral public.mission_schedule_bounds(u.d, u.st, u.et) b
    ) x
    where x.prev_end > x.s
  ) then
    raise exception 'invalid_job_data' using detail = 'days_overlap';
  end if;

  return query
  select u.d, u.st, u.et, b.starts_at, b.ends_at, u.pay, u.pos
  from unnest(v_dates, v_sts, v_ets, v_pays, v_pos) u(d, st, et, pay, pos)
  cross join lateral public.mission_schedule_bounds(u.d, u.st, u.et) b
  order by b.starts_at;
end;
$$;
revoke all on function public.job_days_parse(text, jsonb) from public, anon, authenticated;

-- Journées non publiables à l'instant p_at (lot 11b : avant H−24, ou de
-- moins de 24 h jusqu'à H−4 inclus). Période complète : le premier début
-- seul fixe le régime ; journées au choix : chaque journée.
create or replace function public.job_days_unpublishable(
  p_format text, p_dates date[], p_starts timestamptz[], p_at timestamptz)
returns date[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(u.d order by u.s), '{}'::date[])
  from unnest(p_dates, p_starts) u(d, s)
  where public.job_publication_regime(u.s, p_at) is null
    and (p_format = 'per_day' or u.s = (select min(x) from unnest(p_starts) x));
$$;
revoke all on function public.job_days_unpublishable(text, date[], timestamptz[], timestamptz)
  from public, anon, authenticated;

-- Journées effectives d'une offre : job_days, ou pour une offre antérieure
-- sans intervalle (et les insertions de service sans calendrier) une
-- journée implicite identique à son horaire. Offre à intervalle sans
-- calendrier : aucune journée (sens non établi).
create or replace function public.job_effective_days(p_job_id uuid)
returns table (
  day_id uuid,
  day_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  mission_pay_per_candidate integer,
  positions_available integer,
  positions_filled integer,
  publication_regime text,
  applications_close_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select * from (
    select d.id, d.day_date, d.start_time, d.end_time, d.starts_at, d.ends_at,
           case when j.schedule_format = 'per_day' then d.mission_pay_per_candidate
                else j.mission_pay_per_candidate end,
           case when j.schedule_format = 'per_day' then d.positions_available
                else j.positions_available end,
           case when j.schedule_format = 'per_day' then d.positions_filled
                else coalesce(j.positions_filled, 0) end,
           case when j.schedule_format = 'per_day' then d.publication_regime
                else j.publication_regime end,
           case when j.schedule_format = 'per_day' then d.applications_close_at
                else j.applications_close_at end
    from public.jobs j
    join public.job_days d on d.job_id = j.id
    where j.id = p_job_id
    union all
    select null::uuid, j.start_date, j.start_time, j.end_time, b.starts_at, b.ends_at,
           j.mission_pay_per_candidate, j.positions_available,
           coalesce(j.positions_filled, 0), j.publication_regime, j.applications_close_at
    from public.jobs j
    cross join lateral public.mission_schedule_bounds(j.start_date, j.start_time, j.end_time) b
    where j.id = p_job_id
      and j.schedule_format = 'full_period'
      and (j.end_date is null or j.end_date = j.start_date)
      and not exists (select 1 from public.job_days d where d.job_id = j.id)
  ) x
  order by x.starts_at;
$$;
revoke all on function public.job_effective_days(uuid) from public, anon, authenticated;

-- Plages (indices 1..n de p_ranges) en conflit avec un engagement du
-- candidat : chevauchement, ou moins de 3 h d'écart (exactement 3 h :
-- admis). Engagement = journée d'une mission non annulée dont la
-- sélection tient. Lecture seule ; l'appelant sérialise par le verrou
-- consultatif du candidat.
create or replace function public.candidate_schedule_conflicts(
  p_candidate_id uuid, p_ranges tstzrange[])
returns integer[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(r.ord::integer order by r.ord), '{}'::integer[])
  from unnest(p_ranges) with ordinality r(rng, ord)
  where exists (
    select 1
    from public.mission_days md
    join public.missions m on m.id = md.mission_id
    left join public.job_applications a on a.id = m.application_id
    where m.candidate_id = p_candidate_id
      and coalesce(m.status::text, 'pending') not in ('cancelled', 'no_show')
      and (a.id is null or a.status = 'selected')
      and tstzrange(md.starts_at - interval '3 hours', md.ends_at + interval '3 hours') && r.rng);
$$;
revoke all on function public.candidate_schedule_conflicts(uuid, tstzrange[]) from public, anon, authenticated;

-- Verrou consultatif propre au candidat : deux sélections du même candidat
-- (deux entreprises, deux offres) s'attendent ; le contrôle de conflit
-- relit les engagements validés après l'attente.
create or replace function public.lock_candidate_engagements(p_candidate_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('easyjob:candidate-engagements:' || p_candidate_id::text, 0));
$$;
revoke all on function public.lock_candidate_engagements(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Publication : régime figé, par journée pour le format au choix
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261112120000, plus le format (figé) et le régime par
-- journée. Un refus nomme les journées non publiables ; rien n'est publié
-- partiellement (la transaction est annulée).
create or replace function public.job_publication_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_regime text;
  v_bad date[];
  v_close timestamptz;
begin
  if tg_op = 'UPDATE' and new.legacy_publication is distinct from old.legacy_publication then
    raise exception 'publication_regime_locked' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.first_published_at is not null or old.legacy_publication) then
    if (new.first_published_at, new.publication_regime, new.applications_close_at)
       is distinct from
       (old.first_published_at, old.publication_regime, old.applications_close_at) then
      raise exception 'publication_regime_locked' using errcode = '42501';
    end if;
    if (new.start_date, new.end_date, new.start_time, new.end_time, new.schedule_format)
       is distinct from
       (old.start_date, old.end_date, old.start_time, old.end_time, old.schedule_format) then
      raise exception 'job_schedule_locked' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.status = 'active'
       or (old.status is not null and old.status not in ('draft', 'pending_review'))) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.first_published_at is not null
     and new.publication_regime is not null
     and new.applications_close_at is not null then
    return new;
  end if;
  if new.legacy_publication
     or (tg_op = 'UPDATE' and old.first_published_at is not null) then
    return new;
  end if;

  if new.schedule_format = 'per_day' then
    -- Lot 12 : chaque journée reçoit son régime et son échéance ; une seule
    -- journée non publiable fait refuser toute la publication.
    if tg_op = 'INSERT' or not exists (select 1 from public.job_days d where d.job_id = new.id) then
      raise exception 'job_days_missing';
    end if;
    select coalesce(array_agg(d.day_date order by d.starts_at), '{}'::date[]) into v_bad
    from public.job_days d
    where d.job_id = new.id and public.job_publication_regime(d.starts_at, now()) is null;
    if cardinality(v_bad) > 0 then
      raise exception 'job_start_too_close'
        using detail = jsonb_build_object('days', to_jsonb(v_bad))::text;
    end if;
    update public.job_days d
    set publication_regime = public.job_publication_regime(d.starts_at, now()),
        applications_close_at = public.job_recruitment_close(
          d.starts_at, public.job_publication_regime(d.starts_at, now()))
    where d.job_id = new.id;
    select max(d.applications_close_at) into v_close
    from public.job_days d where d.job_id = new.id;
    new.first_published_at := now();
    new.publication_regime := 'per_day';
    new.applications_close_at := v_close;
    return new;
  end if;

  v_start := public.job_start_instant(new.start_date, new.start_time);
  v_regime := public.job_publication_regime(v_start, now());
  if v_regime is null then
    raise exception 'job_start_too_close'
      using detail = jsonb_build_object('days', jsonb_build_array(new.start_date))::text;
  end if;
  new.first_published_at := now();
  new.publication_regime := v_regime;
  new.applications_close_at := public.job_recruitment_close(v_start, v_regime);
  return new;
end;
$$;
revoke all on function public.job_publication_guard() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Saisie et correction
-- ════════════════════════════════════════════════════════════════════
-- Reprises de 20261112120000, plus le calendrier (champ `days`, format
-- `schedule_format`). Sans `days` : une seule journée, celle de start_date
-- (end_date absente ou égale) ; un intervalle n'est plus accepté.

create or replace function public.create_job(p_job jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company record;
  v_job public.jobs;
  v_format text;
  v_payload jsonb;
  v_dates date[];
  v_sts time[];
  v_ets time[];
  v_starts timestamptz[];
  v_pays integer[];
  v_pos integer[];
  v_bad date[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_user_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select cp.id, cp.verification_status, cp.is_active into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if not public.company_verification_complete(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  if p_job is null or jsonb_typeof(p_job) <> 'object' then
    raise exception 'invalid_job_data' using detail = 'payload';
  end if;
  if p_job ?| array['first_published_at', 'publication_regime',
                    'applications_close_at', 'published_at'] then
    raise exception 'invalid_job_data' using detail = 'publication';
  end if;

  v_format := coalesce(nullif(p_job ->> 'schedule_format', ''), 'full_period');
  v_payload := p_job - 'days' - 'schedule_format';

  if p_job ? 'days' then
    select array_agg(p.day_date order by p.starts_at), array_agg(p.start_time order by p.starts_at),
           array_agg(p.end_time order by p.starts_at), array_agg(p.starts_at order by p.starts_at),
           array_agg(p.mission_pay_per_candidate order by p.starts_at),
           array_agg(p.positions_available order by p.starts_at)
    into v_dates, v_sts, v_ets, v_starts, v_pays, v_pos
    from public.job_days_parse(v_format, p_job -> 'days') p;
    -- Résumé : première journée, dernière date.
    v_payload := v_payload || jsonb_build_object(
      'start_date', v_dates[1],
      'end_date', v_dates[cardinality(v_dates)],
      'start_time', v_sts[1],
      'end_time', v_ets[1]);
    if v_format = 'per_day' then
      v_payload := v_payload || jsonb_build_object(
        'mission_pay_per_candidate', (select min(x) from unnest(v_pays) x),
        'positions_available', (select sum(x) from unnest(v_pos) x));
    end if;
  elsif v_format <> 'full_period' then
    raise exception 'invalid_job_data' using detail = 'days';
  end if;

  v_job := public.job_apply_content(
    jsonb_populate_record(null::public.jobs, '{}'::jsonb), v_payload);

  if not (p_job ? 'days') then
    -- Lot 12 : aucune journée n'est déduite d'un intervalle.
    if v_job.end_date is not null and v_job.end_date <> v_job.start_date then
      raise exception 'invalid_job_data' using detail = 'end_date';
    end if;
    if v_job.start_time = v_job.end_time then
      raise exception 'invalid_job_data' using detail = 'days_time';
    end if;
    v_dates := array[v_job.start_date];
    v_sts := array[v_job.start_time];
    v_ets := array[v_job.end_time];
    v_starts := array[(select b.starts_at from public.mission_schedule_bounds(
      v_job.start_date, v_job.start_time, v_job.end_time) b)];
    v_pays := array[null::integer];
    v_pos := array[null::integer];
  end if;

  v_bad := public.job_days_unpublishable(v_format, v_dates, v_starts, now());
  if cardinality(v_bad) > 0 then
    raise exception 'job_start_too_close'
      using detail = jsonb_build_object('days', to_jsonb(v_bad))::text;
  end if;

  insert into public.jobs (
    company_id, status, schedule_format,
    title, description, category_id, job_type, address, city, quartier,
    latitude, longitude, start_date, end_date, start_time, end_time,
    is_recurring, recurring_days, mission_pay_per_candidate, estimated_hours,
    required_skills, min_experience_months, dress_code,
    special_instructions, positions_available, urgency
  ) values (
    v_company.id, 'pending_review', v_format,
    v_job.title, v_job.description, v_job.category_id, v_job.job_type,
    v_job.address, v_job.city, v_job.quartier, v_job.latitude,
    v_job.longitude, v_job.start_date, v_job.end_date, v_job.start_time,
    v_job.end_time, v_job.is_recurring, v_job.recurring_days,
    v_job.mission_pay_per_candidate, v_job.estimated_hours, v_job.required_skills,
    v_job.min_experience_months, v_job.dress_code,
    v_job.special_instructions, v_job.positions_available, v_job.urgency
  )
  returning * into v_job;

  insert into public.job_days (
    job_id, day_date, start_time, end_time, starts_at, ends_at,
    mission_pay_per_candidate, positions_available
  )
  select v_job.id, u.d, u.st, u.et, now(), now() + interval '1 second', u.pay, u.pos
  from unnest(v_dates, v_sts, v_ets, v_pays, v_pos) u(d, st, et, pay, pos);

  return v_job;
end;
$$;

revoke all on function public.create_job(jsonb) from public, anon;
grant execute on function public.create_job(jsonb) to authenticated;

create or replace function public.update_job(p_job_id uuid, p_job jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company record;
  v_current public.jobs;
  v_job public.jobs;
  v_published boolean;
  v_format text;
  v_payload jsonb;
  v_dates date[];
  v_sts time[];
  v_ets time[];
  v_starts timestamptz[];
  v_pays integer[];
  v_pos integer[];
  v_bad date[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_user_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select cp.id, cp.verification_status, cp.is_active,
         public.company_effective_plan(cp.subscription_plan, cp.subscription_expires_at) as plan
  into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if not public.company_verification_complete(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  select * into v_current from public.jobs j
  where j.id = p_job_id and j.company_id = v_company.id
  for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  if v_current.status = 'active' then
    if v_company.plan not in ('pro', 'business') then
      raise exception 'job_locked_plan';
    end if;
    if coalesce(v_current.positions_filled, 0) > 0 then
      raise exception 'job_has_selected_candidates';
    end if;
  elsif v_current.status is null
     or v_current.status not in ('draft', 'pending_review', 'rejected') then
    raise exception 'job_not_editable';
  end if;

  if p_job is null or jsonb_typeof(p_job) <> 'object' then
    raise exception 'invalid_job_data' using detail = 'payload';
  end if;
  if p_job ?| array['first_published_at', 'publication_regime',
                    'applications_close_at', 'published_at'] then
    raise exception 'invalid_job_data' using detail = 'publication';
  end if;

  v_published := v_current.first_published_at is not null or v_current.legacy_publication;
  v_format := coalesce(nullif(p_job ->> 'schedule_format', ''), v_current.schedule_format);
  if v_format not in ('full_period', 'per_day') then
    raise exception 'invalid_job_data' using detail = 'schedule_format';
  end if;
  if v_published and v_format <> v_current.schedule_format then
    raise exception 'job_schedule_locked' using errcode = '42501';
  end if;
  v_payload := p_job - 'days' - 'schedule_format';

  if p_job ? 'days' then
    select array_agg(p.day_date order by p.starts_at), array_agg(p.start_time order by p.starts_at),
           array_agg(p.end_time order by p.starts_at), array_agg(p.starts_at order by p.starts_at),
           array_agg(p.mission_pay_per_candidate order by p.starts_at),
           array_agg(p.positions_available order by p.starts_at)
    into v_dates, v_sts, v_ets, v_starts, v_pays, v_pos
    from public.job_days_parse(v_format, p_job -> 'days') p;
    if v_format = 'per_day' then
      v_payload := v_payload || jsonb_build_object(
        'mission_pay_per_candidate', (select min(x) from unnest(v_pays) x),
        'positions_available', (select sum(x) from unnest(v_pos) x));
    end if;
  elsif v_format = 'per_day' and not v_published then
    raise exception 'invalid_job_data' using detail = 'days';
  end if;

  if v_published then
    if p_job ? 'days' then
      -- Lot 12 : même calendrier exigé (ajout, suppression, date ou horaire
      -- changés → refus) ; montants et places par journée suivent les
      -- règles de correction existantes (vérifiées ci-dessus).
      if (select array_agg(row(u.d, u.st, u.et)::text order by u.d)
          from unnest(v_dates, v_sts, v_ets) u(d, st, et))
         is distinct from
         (select array_agg(row(e.day_date, e.start_time, e.end_time)::text order by e.day_date)
          from public.job_effective_days(v_current.id) e) then
        raise exception 'job_schedule_locked' using errcode = '42501';
      end if;
    else
      if v_format = 'per_day' and (p_job ? 'mission_pay_per_candidate'
                                   or p_job ? 'positions_available') then
        raise exception 'invalid_job_data' using detail = 'days';
      end if;
      begin
        if (p_job ? 'start_date'
            and (p_job ->> 'start_date')::date is distinct from v_current.start_date)
           or (p_job ? 'start_time'
            and (p_job ->> 'start_time')::time is distinct from v_current.start_time)
           or (p_job ? 'end_time'
            and (p_job ->> 'end_time')::time is distinct from v_current.end_time)
           or (p_job ? 'end_date'
            and coalesce((p_job ->> 'end_date')::date,
                         coalesce((p_job ->> 'start_date')::date, v_current.start_date))
                is distinct from coalesce(v_current.end_date, v_current.start_date)) then
          raise exception 'job_schedule_locked' using errcode = '42501';
        end if;
      exception
        when invalid_text_representation or invalid_datetime_format
          or datetime_field_overflow then
          raise exception 'invalid_job_data' using detail = 'schedule';
      end;
      if v_format = 'per_day' then
        v_payload := v_payload || jsonb_build_object(
          'mission_pay_per_candidate', v_current.mission_pay_per_candidate,
          'positions_available', v_current.positions_available);
      end if;
    end if;
    v_job := public.job_apply_content(v_current,
      v_payload || jsonb_build_object(
        'start_date', greatest(v_current.start_date, (now() at time zone 'Africa/Douala')::date),
        'end_date', null,
        'start_time', v_current.start_time,
        'end_time', v_current.end_time));
    v_job.start_date := v_current.start_date;
    v_job.end_date := v_current.end_date;
    v_job.start_time := v_current.start_time;
    v_job.end_time := v_current.end_time;
  else
    if p_job ? 'days' then
      v_payload := v_payload || jsonb_build_object(
        'start_date', v_dates[1],
        'end_date', v_dates[cardinality(v_dates)],
        'start_time', v_sts[1],
        'end_time', v_ets[1]);
    end if;
    v_job := public.job_apply_content(v_current, v_payload);
    if not (p_job ? 'days') then
      if v_job.end_date is not null and v_job.end_date <> v_job.start_date then
        raise exception 'invalid_job_data' using detail = 'end_date';
      end if;
      if v_job.start_time = v_job.end_time then
        raise exception 'invalid_job_data' using detail = 'days_time';
      end if;
      v_dates := array[v_job.start_date];
      v_sts := array[v_job.start_time];
      v_ets := array[v_job.end_time];
      v_starts := array[(select b.starts_at from public.mission_schedule_bounds(
        v_job.start_date, v_job.start_time, v_job.end_time) b)];
      v_pays := array[null::integer];
      v_pos := array[null::integer];
    end if;
    v_bad := public.job_days_unpublishable(v_format, v_dates, v_starts, now());
    if cardinality(v_bad) > 0 then
      raise exception 'job_start_too_close'
        using detail = jsonb_build_object('days', to_jsonb(v_bad))::text;
    end if;
  end if;

  update public.jobs j set
    schedule_format = v_format,
    title = v_job.title,
    description = v_job.description,
    category_id = v_job.category_id,
    job_type = v_job.job_type,
    address = v_job.address,
    city = v_job.city,
    quartier = v_job.quartier,
    latitude = v_job.latitude,
    longitude = v_job.longitude,
    start_date = v_job.start_date,
    end_date = v_job.end_date,
    start_time = v_job.start_time,
    end_time = v_job.end_time,
    is_recurring = v_job.is_recurring,
    recurring_days = v_job.recurring_days,
    mission_pay_per_candidate = v_job.mission_pay_per_candidate,
    estimated_hours = v_job.estimated_hours,
    required_skills = v_job.required_skills,
    min_experience_months = v_job.min_experience_months,
    dress_code = v_job.dress_code,
    special_instructions = v_job.special_instructions,
    positions_available = v_job.positions_available,
    urgency = v_job.urgency,
    status = 'pending_review',
    rejection_reason = null,
    moderation_notes = null,
    moderated_at = null,
    moderation_by = null,
    published_at = null
  where j.id = p_job_id
  returning * into v_job;

  if not v_published then
    -- Jamais publiée : aucune candidature possible, le calendrier est remplacé.
    delete from public.job_days d where d.job_id = p_job_id;
    insert into public.job_days (
      job_id, day_date, start_time, end_time, starts_at, ends_at,
      mission_pay_per_candidate, positions_available
    )
    select p_job_id, u.d, u.st, u.et, now(), now() + interval '1 second', u.pay, u.pos
    from unnest(v_dates, v_sts, v_ets, v_pays, v_pos) u(d, st, et, pay, pos);
  elsif v_format = 'per_day' and p_job ? 'days' then
    update public.job_days d
    set mission_pay_per_candidate = u.pay, positions_available = u.pos
    from unnest(v_dates, v_pays, v_pos) u(dt, pay, pos)
    where d.job_id = p_job_id and d.day_date = u.dt;
    if exists (select 1 from public.job_days d
               where d.job_id = p_job_id and d.positions_available < d.positions_filled) then
      raise exception 'invalid_job_data' using detail = 'days_positions';
    end if;
  end if;

  return v_job;
end;
$$;

revoke all on function public.update_job(uuid, jsonb) from public, anon;
grant execute on function public.update_job(uuid, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Modération : tout ou rien, journées non publiables nommées
-- ════════════════════════════════════════════════════════════════════
create or replace function public.moderate_job(
  p_job_id uuid,
  p_action text,
  p_reason text default null,
  p_seen_updated_at timestamptz default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_admin_active boolean;
  v_reason text := nullif(btrim(p_reason), '');
  v_job public.jobs;
  v_company record;
  v_locale text;
  v_bad date[];
  v_dates date[];
  v_starts timestamptz[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_admin_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('admin_ops', 'admin_founder')
     or v_admin_active is false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;
  if p_action = 'reject' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'pending_review' then
    raise exception 'job_not_pending';
  end if;
  if p_seen_updated_at is not null
     and v_job.updated_at is distinct from p_seen_updated_at then
    raise exception 'job_changed';
  end if;

  select cp.user_id, cp.verification_status, cp.is_active as company_active,
         u.is_active as user_active, u.locale::text as locale
  into v_company
  from public.company_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;

  if p_action = 'approve'
     and (not public.company_verification_complete(v_job.company_id)
          or v_company.company_active is false
          or v_company.user_active is false) then
    raise exception 'company_not_eligible';
  end if;

  -- Lot 11b / lot 12 : première publication. Calendrier absent (offre
  -- antérieure à intervalle) → refus ; une journée non publiable → refus de
  -- toute l'offre, journées nommées. Une nouvelle approbation après
  -- correction ne change ni horaires, ni régime, ni échéance.
  if p_action = 'approve' and v_job.first_published_at is null
     and not v_job.legacy_publication then
    select array_agg(e.day_date order by e.starts_at), array_agg(e.starts_at order by e.starts_at)
    into v_dates, v_starts
    from public.job_effective_days(v_job.id) e;
    if v_dates is null then
      raise exception 'job_days_missing';
    end if;
    v_bad := public.job_days_unpublishable(v_job.schedule_format, v_dates, v_starts, now());
    if cardinality(v_bad) > 0 then
      raise exception 'job_start_too_close'
        using detail = jsonb_build_object('days', to_jsonb(v_bad))::text;
    end if;
  end if;

  update public.jobs j set
    status = case when p_action = 'approve' then 'active' else 'rejected' end::public.job_status,
    published_at = case when p_action = 'approve' then now() else null end,
    rejection_reason = case when p_action = 'reject' then v_reason else null end,
    moderated_at = now(),
    moderation_by = v_uid
  where j.id = p_job_id
  returning * into v_job;

  v_locale := coalesce(v_company.locale, 'fr');
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id,
      'system',
      case
        when p_action = 'approve' and v_locale = 'en' then 'Job approved'
        when p_action = 'approve' then 'Offre approuvée'
        when v_locale = 'en' then 'Job rejected'
        else 'Offre refusée' end,
      case
        when p_action = 'approve' and v_locale = 'en'
          then 'Your job "' || v_job.title || '" is now visible to candidates.'
        when p_action = 'approve'
          then 'Votre offre « ' || v_job.title || ' » est désormais visible par les candidats.'
        when v_locale = 'en'
          then 'Your job "' || v_job.title || '" was rejected. Reason: ' || v_reason
               || '. You can correct it and submit it again.'
        else 'Votre offre « ' || v_job.title || ' » a été refusée. Motif : ' || v_reason
             || '. Vous pouvez la corriger et la soumettre à nouveau.' end,
      jsonb_build_object('job_id', v_job.id, 'job_action', p_action)
    );
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (
    v_uid,
    v_role,
    case when p_action = 'approve' then 'approve_job' else 'reject_job' end,
    'jobs',
    v_job.id,
    jsonb_build_object('company_id', v_job.company_id, 'reason', v_reason)
  );

  return v_job;
end;
$$;

revoke all on function public.moderate_job(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.moderate_job(uuid, text, text, timestamptz) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Candidature
-- ════════════════════════════════════════════════════════════════════
-- Contrôles du lot 11b repris dans le même ordre (compte, profil, CNI,
-- vérification, offre, dossier), puis : période complète → échéance,
-- places, justificatifs, conflits ; journées au choix → blocages par
-- journée (tout ou rien), justificatifs. Aucune place n'est réservée.
create or replace function public.apply_to_job_core(p_job_id uuid, p_day_ids uuid[])
returns setof public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.candidate_profiles;
  v_is_active boolean;
  v_is_verified boolean;
  v_cni_state text;
  v_job record;
  v_blocker jsonb;
  v_application public.job_applications;
  v_ranges tstzrange[];
  v_conflicts integer[];
  v_blocked jsonb;
  v_count integer;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_profile from public.candidate_profiles where user_id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if v_profile.onboarding_status is distinct from 'completed' then
    raise exception 'onboarding_incomplete';
  end if;
  if v_profile.profile_completion_pct < 60 then
    raise exception 'profile_incomplete';
  end if;

  select u.is_active, u.is_verified into v_is_active, v_is_verified
  from public.users u where u.id = v_uid;
  if v_is_active is false then
    raise exception 'account_suspended';
  end if;

  v_cni_state := public.candidate_cni_state(v_profile, now());
  if v_cni_state in ('expired', 'renewal_pending', 'renewal_rejected') then
    raise exception 'cni_expired'
      using errcode = '42501',
            detail = jsonb_build_object('state', v_cni_state)::text;
  end if;

  if not coalesce(v_is_verified, false) or v_cni_state <> 'valid' then
    raise exception 'profile_not_verified';
  end if;

  select j.id, j.status, j.positions_available, j.positions_filled, j.company_id,
         j.applications_close_at, j.schedule_format
  into v_job
  from public.jobs j where j.id = p_job_id
  for share;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  perform 1 from public.company_profiles cp where cp.id = v_job.company_id for share;
  if not public.company_dossier_valid(v_job.company_id) then
    raise exception 'job_not_available';
  end if;

  if v_job.schedule_format = 'full_period' then
    if p_day_ids is not null then
      raise exception 'job_days_not_selectable';
    end if;
    if v_job.applications_close_at is null or now() >= v_job.applications_close_at then
      raise exception 'recruitment_closed';
    end if;
    if v_job.positions_filled >= v_job.positions_available then
      raise exception 'no_positions';
    end if;

    v_blocker := public.candidate_document_blocker(v_profile, p_job_id);
    if v_blocker is not null then
      raise exception 'document_requirement' using detail = v_blocker::text;
    end if;

    -- Engagements du candidat lui-même (aucune donnée d'un tiers) : chaque
    -- journée de la période doit rester compatible.
    select array_agg(tstzrange(e.starts_at, e.ends_at) order by e.starts_at)
    into v_ranges from public.job_effective_days(p_job_id) e;
    if v_ranges is null then
      raise exception 'job_days_missing';
    end if;
    v_conflicts := public.candidate_schedule_conflicts(v_profile.id, v_ranges);
    if cardinality(v_conflicts) > 0 then
      raise exception 'schedule_conflict'
        using detail = jsonb_build_object('days', (
          select jsonb_agg(e.day_date order by e.starts_at)
          from (select x.*, row_number() over (order by x.starts_at) as ord
                from public.job_effective_days(p_job_id) x) e
          where e.ord = any (v_conflicts)))::text;
    end if;

    insert into public.job_applications (job_id, candidate_id, status)
    values (p_job_id, v_profile.id, 'pending')
    on conflict (job_id, candidate_id) where job_day_id is null do nothing
    returning * into v_application;
    if v_application.id is null then
      raise exception 'already_applied';
    end if;

    delete from public.candidate_application_blockers b
    where b.candidate_id = v_profile.id and b.job_id = p_job_id;
    return next v_application;
    return;
  end if;

  -- Journées au choix.
  if p_day_ids is null or cardinality(p_day_ids) = 0 then
    raise exception 'job_days_required';
  end if;
  if cardinality(p_day_ids) > 31
     or (select count(distinct x) from unnest(p_day_ids) x) <> cardinality(p_day_ids)
     or exists (select 1 from unnest(p_day_ids) x where x is null) then
    raise exception 'job_days_invalid';
  end if;
  select count(*) into v_count from public.job_days d
  where d.job_id = p_job_id and d.id = any (p_day_ids);
  if v_count <> cardinality(p_day_ids) then
    raise exception 'job_days_invalid';
  end if;

  select array_agg(tstzrange(d.starts_at, d.ends_at) order by d.starts_at)
  into v_ranges
  from public.job_days d where d.id = any (p_day_ids);
  v_conflicts := public.candidate_schedule_conflicts(v_profile.id, v_ranges);

  -- Journées bloquantes, nommées (date et motif), sans rien créer.
  select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.day_date, 'reason', s.reason)
                   order by s.starts_at)
  into v_blocked
  from (
    select d.id, d.day_date, d.starts_at,
           case
             when d.applications_close_at is null or now() >= d.applications_close_at
               then 'recruitment_closed'
             when exists (select 1 from public.job_applications a
                          where a.job_day_id = d.id and a.candidate_id = v_profile.id)
               then 'already_applied'
             when d.positions_filled >= coalesce(d.positions_available, 1)
               then 'no_positions'
             when (row_number() over (order by d.starts_at))::integer = any (v_conflicts)
               then 'schedule_conflict'
           end as reason
    from public.job_days d where d.id = any (p_day_ids)
  ) s
  where s.reason is not null;
  if v_blocked is not null then
    raise exception 'job_days_unavailable'
      using detail = jsonb_build_object('days', v_blocked)::text;
  end if;

  v_blocker := public.candidate_document_blocker(v_profile, p_job_id);
  if v_blocker is not null then
    raise exception 'document_requirement' using detail = v_blocker::text;
  end if;

  -- Double soumission : l'index unique tranche ; une seule journée déjà
  -- prise annule tout l'envoi (already_applied).
  v_inserted := 0;
  for v_application in
    insert into public.job_applications (job_id, job_day_id, candidate_id, status)
    select p_job_id, d.id, v_profile.id, 'pending'
    from public.job_days d where d.id = any (p_day_ids)
    on conflict (job_day_id, candidate_id) where job_day_id is not null do nothing
    returning *
  loop
    v_inserted := v_inserted + 1;
    return next v_application;
  end loop;
  if v_inserted <> cardinality(p_day_ids) then
    raise exception 'already_applied';
  end if;

  delete from public.candidate_application_blockers b
  where b.candidate_id = v_profile.id and b.job_id = p_job_id;
  return;
end;
$$;
revoke all on function public.apply_to_job_core(uuid, uuid[]) from public, anon, authenticated;

-- Période complète (signature inchangée) ; offre à journées au choix :
-- job_days_required (passer par apply_to_job_days).
create or replace function public.apply_to_job(p_job_id uuid)
returns public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.job_applications;
begin
  select * into v_application from public.apply_to_job_core(p_job_id, null) limit 1;
  return v_application;
end;
$$;
revoke all on function public.apply_to_job(uuid) from public, anon;
grant execute on function public.apply_to_job(uuid) to authenticated;

create or replace function public.apply_to_job_days(p_job_id uuid, p_day_ids uuid[])
returns setof public.job_applications
language sql
security definer
set search_path = ''
as $$
  select * from public.apply_to_job_core(p_job_id, coalesce(p_day_ids, '{}'::uuid[]));
$$;
revoke all on function public.apply_to_job_days(uuid, uuid[]) from public, anon;
grant execute on function public.apply_to_job_days(uuid, uuid[]) to authenticated;

-- Retrait (20261031130000) : période complète, la candidature à l'offre ;
-- journées au choix, une candidature précise (les autres journées ne
-- changent pas). Mêmes règles : seule une candidature en attente se retire,
-- un retrait déjà fait est renvoyé tel quel, rien n'est rouvert ensuite.
drop function if exists public.withdraw_job_application(uuid);
create function public.withdraw_job_application(
  p_job_id uuid,
  p_application_id uuid default null
)
returns public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.job_applications;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select a.* into v_application
  from public.job_applications a
  join public.candidate_profiles cp on cp.id = a.candidate_id
  where a.job_id = p_job_id and cp.user_id = v_uid
    and (case when p_application_id is null then a.job_day_id is null
              else a.id = p_application_id end)
  for update of a;

  if not found then
    raise exception 'application_not_found';
  end if;
  if v_application.status = 'withdrawn' then
    return v_application;
  end if;
  if v_application.status is distinct from 'pending' then
    raise exception 'application_not_withdrawable';
  end if;

  update public.job_applications
  set status = 'withdrawn'
  where id = v_application.id
  returning * into v_application;

  return v_application;
end;
$$;
revoke all on function public.withdraw_job_application(uuid, uuid) from public, anon;
grant execute on function public.withdraw_job_application(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 9. Sélection
-- ════════════════════════════════════════════════════════════════════
-- Reprise du lot 11b (verrous candidature, offre, entreprise ; relance
-- idempotente ; dossier ; échéance ; places), plus : journée (échéance et
-- places propres, sous le verrou de l'offre), verrou consultatif du
-- candidat puis conflits d'engagements, mission et journées, contrat figé
-- (format, journées, montant, devise).
create or replace function public.select_candidate(p_application_id uuid)
returns table (
  application_id uuid,
  status public.application_status,
  mission_id uuid,
  contract_id uuid,
  already_selected boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_day public.job_days;
  v_candidate record;
  v_contract_type text;
  v_mission_id uuid;
  v_contract_id uuid;
  v_days jsonb;
  v_ranges tstzrange[];
  v_count integer;
  v_pay integer;
  v_first record;
  v_last_date date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_user_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select cp.id, cp.company_name, cp.is_active into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select a.* into v_application
  from public.job_applications a where a.id = p_application_id
  for update;
  if not found then
    raise exception 'application_not_found';
  end if;

  select j.* into v_job
  from public.jobs j where j.id = v_application.job_id
  for update;
  if not found or v_job.company_id is distinct from v_company.id then
    raise exception 'application_not_found';
  end if;

  if v_application.status = 'selected' then
    select m.id into v_mission_id from public.missions m
    where m.application_id = v_application.id;
    select c.id into v_contract_id from public.contracts c
    where c.application_id = v_application.id;
    if v_mission_id is null or v_contract_id is null then
      raise exception 'selection_incomplete';
    end if;
    return query select v_application.id, v_application.status,
      v_mission_id, v_contract_id, true;
    return;
  end if;

  if v_application.status not in ('pending', 'shortlisted') then
    raise exception 'application_not_selectable';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  perform 1 from public.company_profiles cp where cp.id = v_company.id for share;
  if not public.company_dossier_valid(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  if v_application.job_day_id is not null then
    -- Journée au choix : échéance et capacité propres (le verrou de l'offre
    -- sérialise les sélections de toutes ses journées).
    select d.* into v_day from public.job_days d
    where d.id = v_application.job_day_id and d.job_id = v_job.id
    for update;
    if not found then
      raise exception 'application_not_found';
    end if;
    if v_day.applications_close_at is null or now() >= v_day.applications_close_at then
      raise exception 'recruitment_closed';
    end if;
    if v_day.positions_filled >= coalesce(v_day.positions_available, 1) then
      raise exception 'no_positions';
    end if;
  else
    if v_job.applications_close_at is null or now() >= v_job.applications_close_at then
      raise exception 'recruitment_closed';
    end if;
    if coalesce(v_job.positions_filled, 0) >= coalesce(v_job.positions_available, 1) then
      raise exception 'no_positions';
    end if;
  end if;

  select cp.id, cp.user_id, cp.first_name, u.is_active, u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_application.candidate_id;
  if not found or v_candidate.is_active is false then
    raise exception 'candidate_unavailable';
  end if;

  -- Journées engagées par cette sélection.
  if v_application.job_day_id is not null then
    v_days := jsonb_build_array(jsonb_build_object(
      'job_day_id', v_day.id, 'date', v_day.day_date,
      'start_time', v_day.start_time, 'end_time', v_day.end_time,
      'starts_at', v_day.starts_at, 'ends_at', v_day.ends_at));
    v_ranges := array[tstzrange(v_day.starts_at, v_day.ends_at)];
    v_pay := v_day.mission_pay_per_candidate;
  else
    select jsonb_agg(jsonb_build_object(
             'job_day_id', e.day_id, 'date', e.day_date,
             'start_time', e.start_time, 'end_time', e.end_time,
             'starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.starts_at),
           array_agg(tstzrange(e.starts_at, e.ends_at) order by e.starts_at)
    into v_days, v_ranges
    from public.job_effective_days(v_job.id) e;
    if v_days is null then
      raise exception 'job_days_missing';
    end if;
    v_pay := v_job.mission_pay_per_candidate;
  end if;

  -- Deux entreprises qui sélectionnent ce candidat au même moment
  -- s'attendent ici ; la seconde relit les engagements validés.
  perform public.lock_candidate_engagements(v_candidate.id);
  if cardinality(public.candidate_schedule_conflicts(v_candidate.id, v_ranges)) > 0 then
    -- Aucun détail des autres engagements n'est renvoyé à l'entreprise.
    raise exception 'candidate_schedule_conflict';
  end if;

  update public.job_applications a
  set status = 'selected', selected_at = now(), selected_by = v_uid
  where a.id = v_application.id
  returning a.* into v_application;

  v_count := jsonb_array_length(v_days);
  -- Format du contrat (SRS §6.7) : 3 journées travaillées ou plus →
  -- formalisé. Une journée au choix : simple.
  v_contract_type := case when v_count >= 3 then 'formal' else 'simple' end;

  select (x ->> 'date')::date as d, (x ->> 'start_time')::time as st,
         (x ->> 'end_time')::time as et
  into v_first
  from jsonb_array_elements(v_days) with ordinality t(x, ord) where t.ord = 1;
  v_last_date := (v_days -> (v_count - 1) ->> 'date')::date;

  insert into public.missions (
    job_id, candidate_id, application_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, break_minutes, contract_type
  ) values (
    v_job.id, v_candidate.id, v_application.id, v_first.d,
    v_first.st, v_first.et, v_job.break_duration_minutes, v_contract_type
  )
  returning id into v_mission_id;

  -- Journées suivantes d'une période complète (la première est créée par
  -- trg_create_mission_first_day) ; un code par journée (trigger).
  insert into public.mission_days (
    mission_id, job_day_id, scheduled_date, scheduled_start_time, scheduled_end_time,
    starts_at, ends_at
  )
  select v_mission_id, nullif(x ->> 'job_day_id', '')::uuid, (x ->> 'date')::date,
         (x ->> 'start_time')::time, (x ->> 'end_time')::time,
         now(), now() + interval '1 second'
  from jsonb_array_elements(v_days) with ordinality t(x, ord)
  where t.ord > 1;

  insert into public.contracts (
    application_id, job_id, candidate_id, company_id, contract_template,
    contract_data
  ) values (
    v_application.id, v_job.id, v_candidate.id, v_company.id, v_contract_type,
    jsonb_build_object(
      'job_title', v_job.title,
      'company_name', v_company.company_name,
      'schedule_format', v_job.schedule_format,
      'start_date', v_first.d,
      'end_date', v_last_date,
      'start_time', v_first.st,
      'end_time', v_first.et,
      'day_count', v_count,
      'days', (select jsonb_agg(t.x - 'job_day_id' order by t.ord)
               from jsonb_array_elements(v_days) with ordinality t(x, ord)),
      'break_minutes', v_job.break_duration_minutes,
      'address', v_job.address,
      'city', v_job.city,
      'mission_pay_per_candidate', v_pay,
      'currency', 'XAF',
      'pay_basis', 'per_mission',
      'mission_id', v_mission_id
    )
  )
  returning id into v_contract_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_candidate.user_id,
    'application_update',
    case when v_candidate.locale = 'en' then 'You have been selected'
         else 'Vous êtes sélectionné(e)' end,
    case when v_candidate.locale = 'en'
      then v_company.company_name || ' selected you for "' || v_job.title || '" '
           || case when v_count > 1
                then 'from ' || to_char(v_first.d, 'YYYY-MM-DD') || ' to '
                     || to_char(v_last_date, 'YYYY-MM-DD') || ' (' || v_count || ' days)'
                else 'on ' || to_char(v_first.d, 'YYYY-MM-DD') end
           || '. Your mission and contract have been created.'
      else v_company.company_name || ' vous a sélectionné(e) pour « ' || v_job.title || ' » '
           || case when v_count > 1
                then 'du ' || to_char(v_first.d, 'DD/MM/YYYY') || ' au '
                     || to_char(v_last_date, 'DD/MM/YYYY') || ' (' || v_count || ' journées)'
                else 'le ' || to_char(v_first.d, 'DD/MM/YYYY') end
           || '. Votre mission et votre contrat ont été créés.' end,
    jsonb_build_object(
      'job_id', v_job.id,
      'application_id', v_application.id,
      'mission_id', v_mission_id,
      'contract_id', v_contract_id,
      'application_status', 'selected'
    )
  );

  return query select v_application.id, v_application.status,
    v_mission_id, v_contract_id, false;
end;
$$;

revoke all on function public.select_candidate(uuid) from public, anon;
grant execute on function public.select_candidate(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Début et confirmation par journée
-- ════════════════════════════════════════════════════════════════════
drop function if exists public.start_mission(uuid);
create function public.start_mission(p_mission_id uuid, p_mission_day_id uuid default null)
returns table (
  mission_id uuid,
  mission_day_id uuid,
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
  v_day public.mission_days;
  v_job public.jobs;
  v_candidate record;
  v_application_status public.application_status;
  v_company record;
  v_day_count integer;
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

  select count(*) into v_day_count from public.mission_days d where d.mission_id = v_mission.id;
  if p_mission_day_id is null then
    if v_day_count <> 1 then
      raise exception 'mission_day_required';
    end if;
    select d.* into v_day from public.mission_days d where d.mission_id = v_mission.id for update;
  else
    select d.* into v_day from public.mission_days d
    where d.id = p_mission_day_id and d.mission_id = v_mission.id for update;
    if not found then
      raise exception 'mission_not_found';
    end if;
  end if;

  if v_day.actual_start_time is not null then
    return query select v_mission.id, v_day.id, v_mission.status, v_day.actual_start_time, true;
    return;
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status not in ('pending', 'confirmed', 'in_progress')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;

  if now() < v_day.starts_at - interval '15 minutes' then
    raise exception 'too_early'
      using detail = to_char((v_day.starts_at - interval '15 minutes') at time zone 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  insert into public.mission_check_ins (mission_id, check_in_type, checked_at)
  values (v_mission.id, 'arrival', now());
  update public.mission_days d set actual_start_time = now()
  where d.id = v_day.id returning d.* into v_day;
  if v_mission.actual_start_time is null then
    update public.missions m
    set actual_start_time = now(), status = 'in_progress'
    where m.id = v_mission.id
    returning m.* into v_mission;
  end if;

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
        then coalesce(v_candidate.first_name, 'The candidate') || ' started "' || v_job.title || '"'
             || case when v_day_count > 1
                  then ' (day of ' || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || ')' else '' end || '.'
        else coalesce(v_candidate.first_name, 'Le candidat') || ' a commencé « ' || v_job.title || ' »'
             || case when v_day_count > 1
                  then ' (journée du ' || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || ')' else '' end || '.' end,
      jsonb_build_object('mission_id', v_mission.id, 'job_id', v_job.id,
                         'mission_status', v_mission.status)
    );
  end if;

  return query select v_mission.id, v_day.id, v_mission.status, v_day.actual_start_time, false;
end;
$$;
revoke all on function public.start_mission(uuid, uuid) from public, anon;
grant execute on function public.start_mission(uuid, uuid) to authenticated;

-- Résultats : completed (journée confirmée, ou déjà confirmée), invalid
-- (code erroné, tentative comptée), locked. Le code d'un autre candidat ou
-- d'une autre journée est un code erroné pour cette journée. La mission
-- n'est réalisée qu'avec sa dernière journée (mission_completed).
drop function if exists public.submit_completion_code(uuid, text);
create function public.submit_completion_code(
  p_mission_id uuid,
  p_code text,
  p_mission_day_id uuid default null
)
returns table (
  result text,
  mission_id uuid,
  mission_day_id uuid,
  completed_at timestamptz,
  mission_completed boolean,
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
  v_day public.mission_days;
  v_job public.jobs;
  v_candidate record;
  v_code public.mission_completion_codes;
  v_application_status public.application_status;
  v_company record;
  v_failed integer;
  v_window timestamptz;
  v_day_count integer;
  v_done boolean;
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

  select count(*) into v_day_count from public.mission_days d where d.mission_id = v_mission.id;
  if p_mission_day_id is null then
    if v_day_count <> 1 then
      raise exception 'mission_day_required';
    end if;
    select d.* into v_day from public.mission_days d where d.mission_id = v_mission.id for update;
  else
    select d.* into v_day from public.mission_days d
    where d.id = p_mission_day_id and d.mission_id = v_mission.id for update;
    if not found then
      raise exception 'mission_not_found';
    end if;
  end if;

  if v_day.actual_end_time is not null then
    return query select 'completed'::text, v_mission.id, v_day.id, v_day.actual_end_time,
      v_mission.actual_end_time is not null, null::integer, null::timestamptz, true;
    return;
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status in ('cancelled', 'no_show', 'disputed')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;
  if v_day.actual_start_time is null then
    raise exception 'not_started';
  end if;

  select c.* into v_code from public.mission_completion_codes c
  where c.mission_day_id = v_day.id for update;
  if not found or v_code.consumed_at is not null then
    raise exception 'code_unavailable';
  end if;

  if v_code.locked_until is not null and v_code.locked_until > now() then
    return query select 'locked'::text, v_mission.id, v_day.id, null::timestamptz, false, 0,
      v_code.locked_until, false;
    return;
  end if;

  if p_code is null or btrim(p_code) is distinct from v_code.code then
    v_window := case when v_code.attempt_window_started_at is null
                       or v_code.attempt_window_started_at < now() - interval '15 minutes'
                     then now() else v_code.attempt_window_started_at end;
    v_failed := case when v_window = now() then 1 else v_code.failed_attempts + 1 end;
    if v_failed >= 5 then
      update public.mission_completion_codes c
      set failed_attempts = 0, attempt_window_started_at = null,
          locked_until = now() + interval '15 minutes'
      where c.mission_day_id = v_day.id
      returning c.* into v_code;
      return query select 'locked'::text, v_mission.id, v_day.id, null::timestamptz, false, 0,
        v_code.locked_until, false;
    else
      update public.mission_completion_codes c
      set failed_attempts = v_failed, attempt_window_started_at = v_window,
          locked_until = null
      where c.mission_day_id = v_day.id;
      return query select 'invalid'::text, v_mission.id, v_day.id, null::timestamptz, false,
        5 - v_failed, null::timestamptz, false;
    end if;
    return;
  end if;

  update public.mission_completion_codes c
  set consumed_at = now(), failed_attempts = 0, attempt_window_started_at = null,
      locked_until = null
  where c.mission_day_id = v_day.id;
  insert into public.mission_check_ins (mission_id, check_in_type, checked_at)
  values (v_mission.id, 'departure', now());
  update public.mission_days d set actual_end_time = now()
  where d.id = v_day.id returning d.* into v_day;

  -- Réalisation globale seulement quand toutes les journées prévues sont
  -- confirmées ; une journée non confirmée n'annule rien.
  v_done := not exists (select 1 from public.mission_days d
                        where d.mission_id = v_mission.id and d.actual_end_time is null);
  if v_done then
    update public.missions m
    set actual_end_time = now(), status = 'completed'
    where m.id = v_mission.id
    returning m.* into v_mission;
  end if;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;
  select cp.user_id, u.locale::text as locale into v_company
  from public.company_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id, 'mission_update',
      case
        when v_done and v_company.locale = 'en' then 'Mission completed'
        when v_done then 'Mission réalisée'
        when v_company.locale = 'en' then 'Day confirmed'
        else 'Journée confirmée' end,
      case
        when v_done and v_company.locale = 'en'
          then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed the completion of "' || v_job.title || '".'
        when v_done
          then coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé la réalisation de « ' || v_job.title || ' ».'
        when v_company.locale = 'en'
          then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed the day of '
               || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || ' for "' || v_job.title || '".'
        else coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé la journée du '
             || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || ' pour « ' || v_job.title || ' ».' end,
      jsonb_build_object('mission_id', v_mission.id, 'job_id', v_job.id,
                         'mission_status', v_mission.status)
    );
  end if;

  return query select 'completed'::text, v_mission.id, v_day.id, v_day.actual_end_time,
    v_done, null::integer, null::timestamptz, false;
end;
$$;
revoke all on function public.submit_completion_code(uuid, text, uuid) from public, anon;
grant execute on function public.submit_completion_code(uuid, text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 11. Lectures (aucun code côté candidat)
-- ════════════════════════════════════════════════════════════════════

-- Journées d'une mission, sans code.
create or replace function public.mission_days_json(p_mission_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'date', d.scheduled_date,
           'start_time', d.scheduled_start_time,
           'end_time', d.scheduled_end_time,
           'starts_at', d.starts_at,
           'ends_at', d.ends_at,
           'start_available_at', d.starts_at - interval '15 minutes',
           'started_at', d.actual_start_time,
           'completed_at', d.actual_end_time) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;

drop function if exists public.get_mission(uuid);
create function public.get_mission(p_mission_id uuid)
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
  mission_pay_per_candidate integer,
  currency text,
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
  schedule_format text,
  days jsonb,
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

  select min(d.starts_at) as starts_at, max(d.ends_at) as ends_at into v_bounds
  from public.mission_days d where d.mission_id = v_mission.id;
  select c.id, c.status, c.candidate_signed_at,
         case when jsonb_typeof(c.contract_data -> 'mission_pay_per_candidate') = 'number'
           then (c.contract_data ->> 'mission_pay_per_candidate')::integer end as pay,
         c.contract_data ->> 'currency' as currency,
         coalesce(c.contract_data ->> 'schedule_format', 'full_period') as format
  into v_contract
  from public.contracts c where c.application_id = v_mission.application_id;

  return query select
    v_mission.id, v_mission.application_id, v_mission.job_id, v_party,
    v_mission.status, v_job.title, v_job.company_id,
    (select cp.company_name from public.company_profiles cp where cp.id = v_job.company_id),
    v_job.address, v_job.city, v_contract.pay, v_contract.currency,
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time,
    v_bounds.starts_at, v_bounds.ends_at, v_bounds.starts_at - interval '15 minutes',
    v_mission.actual_start_time, v_mission.actual_end_time,
    v_contract.id, v_contract.status, v_contract.candidate_signed_at is not null,
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'candidate' and r.origin = 'mission_flow'),
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'company' and r.origin = 'mission_flow'),
    coalesce(v_contract.format, v_job.schedule_format),
    public.mission_days_json(v_mission.id),
    now();
end;
$$;
revoke all on function public.get_mission(uuid) from public, anon;
grant execute on function public.get_mission(uuid) to authenticated;

drop function if exists public.candidate_tasks();
create function public.candidate_tasks()
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
  days jsonb,
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
         public.mission_days_json(m.id),
         now()
  from public.missions m
  join public.candidate_profiles cand on cand.id = m.candidate_id and cand.user_id = v_uid
  join public.jobs j on j.id = m.job_id
  left join public.company_profiles cp on cp.id = j.company_id
  left join public.contracts c on c.application_id = m.application_id
  cross join lateral (
    select min(d.starts_at) as starts_at, max(d.ends_at) as ends_at
    from public.mission_days d where d.mission_id = m.id) b
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

-- Entreprise propriétaire : une ligne par journée de mission, code de la
-- journée tant qu'il peut servir.
drop function if exists public.company_job_missions(uuid);
create function public.company_job_missions(p_job_id uuid)
returns table (
  mission_id uuid,
  mission_day_id uuid,
  application_id uuid,
  status public.mission_status,
  day_date date,
  day_count integer,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_code text,
  code_used boolean,
  mission_completed_at timestamptz,
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
  select m.id, d.id, m.application_id, m.status, d.scheduled_date,
         (select count(*)::integer from public.mission_days x where x.mission_id = m.id),
         d.starts_at, d.ends_at, d.actual_start_time, d.actual_end_time,
         case when c.consumed_at is null and m.status not in ('cancelled', 'no_show')
              then c.code end,
         c.consumed_at is not null,
         m.actual_end_time,
         exists (select 1 from public.reviews r where r.mission_id = m.id
                 and r.reviewer_type = 'company' and r.origin = 'mission_flow')
  from public.missions m
  join public.mission_days d on d.mission_id = m.id
  left join public.mission_completion_codes c on c.mission_day_id = d.id
  where m.job_id = p_job_id
  order by d.starts_at, m.created_at;
end;
$$;
revoke all on function public.company_job_missions(uuid) from public, anon;
grant execute on function public.company_job_missions(uuid) to authenticated;

-- Candidatures vues par l'entreprise : colonnes autorisées (F-16), plus la
-- journée visée.
drop function if exists public.company_job_applicants(uuid);
create function public.company_job_applicants(p_job_id uuid)
returns table (
  application_id uuid,
  status public.application_status,
  match_score numeric,
  distance_km numeric,
  rejection_reason text,
  created_at timestamptz,
  first_name text,
  last_initial text,
  has_photo boolean,
  reputation_stars numeric,
  skills text[],
  job_day_id uuid,
  day_date date,
  day_starts_at timestamptz,
  day_ends_at timestamptz
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
  select a.id, a.status, a.match_score, a.distance_km, a.rejection_reason,
         a.created_at,
         c.first_name,
         nullif(upper(left(btrim(coalesce(c.last_name, '')), 1)), ''),
         c.profile_photo_url is not null,
         public.reputation_stars_for('candidate', c.id),
         coalesce((select array_agg(s.skill_name order by s.skill_name)
                   from public.candidate_skills s
                   where s.candidate_id = c.id), '{}'::text[]),
         d.id, d.day_date, d.starts_at, d.ends_at
  from public.job_applications a
  join public.candidate_profiles c on c.id = a.candidate_id
  left join public.job_days d on d.id = a.job_day_id
  where a.job_id = p_job_id
  order by d.starts_at nulls first, a.match_score desc nulls last, a.created_at;
end;
$$;
revoke all on function public.company_job_applicants(uuid) from public, anon;
grant execute on function public.company_job_applicants(uuid) to authenticated;

-- Journées d'une offre pour l'écran de détail : mêmes offres que la lecture
-- RLS de jobs (active et dossier valide, candidat ayant postulé, ou
-- entreprise propriétaire). Ouverture et place à l'heure de la base ; état
-- de la candidature de la session pour chaque journée. Aucun nombre de
-- places exposé (SRS §6.6, détail candidat).
--
-- Compatibilité avec les engagements du candidat de la session (décision
-- confirmée : le conflit est expliqué AVANT l'envoi, le refus à la
-- candidature est conservé) : calculée ici par candidate_schedule_conflicts,
-- la fonction qu'utilisent apply_to_job_core et select_candidate (seuls les
-- engagements déjà sélectionnés comptent, marge de 3 h, exactement 3 h
-- admis ; une candidature en attente ne bloque rien). Aucune règle n'est
-- recopiée dans le navigateur. Réponse minimale : pour chaque journée,
-- schedule_compatible (true, false, ou null si la question ne se pose pas :
-- visiteur sans profil candidat, ou journée à laquelle le candidat a déjà
-- postulé) et un code de motif (schedule_conflict). Aucun détail de l'autre
-- engagement (offre, entreprise, dates, horaires) n'est renvoyé, et seul le
-- candidat lui-même lit sa compatibilité.
create or replace function public.job_days_for_candidate(p_job_id uuid)
returns table (
  day_id uuid,
  day_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  mission_pay_per_candidate integer,
  applications_close_at timestamptz,
  recruitment_open boolean,
  is_full boolean,
  my_application_id uuid,
  my_application_status public.application_status,
  schedule_compatible boolean,
  schedule_reason text,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
  v_candidate uuid;
  v_conflicts integer[] := '{}';
begin
  select j.* into v_job from public.jobs j where j.id = p_job_id;
  if not found
     or not ((v_job.status = 'active'
              and (public.company_dossier_valid(v_job.company_id)
                   or public.candidate_applied_to_job(v_job.id)))
             or exists (select 1 from public.company_profiles cp
                        where cp.id = v_job.company_id and cp.user_id = v_uid)) then
    raise exception 'job_not_found';
  end if;
  select cp.id into v_candidate from public.candidate_profiles cp where cp.user_id = v_uid;

  -- Même appel que la candidature : plages triées par début, indices des
  -- plages en conflit avec un engagement sélectionné du candidat.
  if v_candidate is not null then
    select public.candidate_schedule_conflicts(
             v_candidate,
             array_agg(tstzrange(e.starts_at, e.ends_at) order by e.starts_at))
    into v_conflicts
    from public.job_effective_days(p_job_id) e;
    v_conflicts := coalesce(v_conflicts, '{}');
  end if;

  return query
  select x.day_id, x.day_date, x.start_time, x.end_time, x.starts_at, x.ends_at,
         x.mission_pay_per_candidate, x.applications_close_at,
         v_job.status = 'active' and public.company_dossier_valid(v_job.company_id)
           and x.applications_close_at is not null and now() < x.applications_close_at,
         x.positions_filled >= coalesce(x.positions_available, 1),
         x.application_id, x.application_status,
         case when v_candidate is null or x.application_id is not null then null
              else not (x.ord = any (v_conflicts)) end,
         case when v_candidate is not null and x.application_id is null
                   and x.ord = any (v_conflicts) then 'schedule_conflict' end,
         now()
  from (
    select e.day_id, e.day_date, e.start_time, e.end_time, e.starts_at, e.ends_at,
           e.mission_pay_per_candidate, e.applications_close_at,
           e.positions_filled, e.positions_available,
           a.id as application_id, a.status as application_status,
           (row_number() over (order by e.starts_at))::integer as ord
    from public.job_effective_days(p_job_id) e
    left join public.job_applications a
      on v_candidate is not null and a.candidate_id = v_candidate and a.job_id = p_job_id
     and ((v_job.schedule_format = 'per_day' and a.job_day_id = e.day_id)
          or (v_job.schedule_format = 'full_period' and a.job_day_id is null))
  ) x
  order by x.starts_at;
end;
$$;
revoke all on function public.job_days_for_candidate(uuid) from public;
grant execute on function public.job_days_for_candidate(uuid) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Réputation : une unité par mission réalisée, sans double comptage
-- ════════════════════════════════════════════════════════════════════
-- Offres réalisées — décision produit validée (lot 12) : une offre
-- rapporte +1 unité à l'entreprise, une seule fois, quand à l'instant
-- p_at :
--   1. au moins une réalisation est confirmée par code ;
--   2. tous ses engagements sont résolus. Seule résolution disponible
--      aujourd'hui : le travail confirmé (mission dont TOUTES les journées
--      sont confirmées par leur code). L'autre résolution prévue, absence
--      validée avec remboursement effectivement confirmé, n'existe pas
--      encore (lots « Engagements et annulations » et paiement) : aucun
--      statut n'en tient lieu. Une candidature `no_show`, une mission
--      `cancelled`, `no_show` ou `disputed`, une journée sans code, une
--      sélection sans mission restent NON résolues et empêchent l'unité.
--      Le manque de code ne vaut jamais absence ;
--   3. aucun nouveau recrutement n'est possible : chaque offre du groupe a
--      été publiée et son échéance de recrutement (lot 11b, journées au
--      choix : la dernière échéance) est atteinte, ou elle est antérieure
--      au lot 11b (legacy_publication, jamais rouverte). Une offre masquée
--      parce que le dossier de l'entreprise est en revue n'est PAS close :
--      seule l'échéance, figée et jamais rouverte, ferme le recrutement.
-- Sans travail réalisé, aucune unité. Les sanctions restent indépendantes
-- (reputation_incidents). Le résultat ne dépend que des données sources et
-- de p_at : un recalcul après invalidation d'une preuve ou décision support
-- corrige la réputation (aucun indicateur « point déjà gagné »).
-- Horodatage : la plus tardive de la clôture et de la dernière confirmation.
drop function if exists public.reputation_company_offers(uuid);
create function public.reputation_company_offers(
  p_company_id uuid,
  p_at timestamptz default now()
)
returns table (offer_id uuid, realized_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with codes as (
    select c.mission_id,
           bool_and(c.consumed_at is not null) as all_consumed,
           max(c.consumed_at) as consumed_at
    from public.mission_completion_codes c
    group by c.mission_id
  ), offer_jobs as (
    select coalesce(j.parent_job_id, j.id) as offer_id, j.id as job_id,
           (j.legacy_publication and j.applications_close_at is null)
             or (j.first_published_at is not null
                 and j.applications_close_at is not null
                 and j.applications_close_at <= p_at) as closed,
           j.applications_close_at
    from public.jobs j
    where j.company_id = p_company_id
  ), offers as (
    select oj.offer_id, bool_and(oj.closed) as closed,
           max(oj.applications_close_at) as close_at
    from offer_jobs oj
    group by oj.offer_id
  ), engagements as (
    select oj.offer_id,
           (a.status = 'selected'
            and m.id is not null
            and m.actual_end_time is not null
            and k.all_consumed is true) as confirmed,
           case when k.all_consumed then k.consumed_at end as confirmed_at
    from offer_jobs oj
    join public.job_applications a on a.job_id = oj.job_id
    left join public.missions m on m.application_id = a.id
    left join codes k on k.mission_id = m.id
    where a.status in ('selected', 'no_show')
  )
  select e.offer_id, greatest(max(e.confirmed_at), max(o.close_at))
  from engagements e
  join offers o on o.offer_id = e.offer_id
  where o.closed
  group by e.offer_id
  having bool_or(e.confirmed) and bool_and(e.confirmed);
$$;
revoke all on function public.reputation_company_offers(uuid, timestamptz) from public, anon, authenticated;

-- Prochaine clôture de recrutement d'une offre de l'entreprise qui a déjà
-- un engagement : à cet instant, le balayage planifié existant
-- (reputation_expiry_sweep, pg_cron) recalcule le score sans visite ni
-- écriture ; la lecture par un tiers (reputation_stars_for) et par le
-- titulaire (my_reputation) recalcule déjà dès l'échéance passée.
create or replace function public.reputation_company_next_close(
  p_company_id uuid,
  p_at timestamptz default now()
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(j.applications_close_at)
  from public.jobs j
  where j.company_id = p_company_id
    and j.first_published_at is not null
    and j.applications_close_at > p_at
    and exists (select 1 from public.job_applications a
                where a.job_id = j.id and a.status in ('selected', 'no_show'));
$$;
revoke all on function public.reputation_company_next_close(uuid, timestamptz) from public, anon, authenticated;

-- Score complet (20261109120000), inchangé sauf l'expérience du candidat :
-- une mission globale porte un code par journée ; elle compte une fois,
-- quand toutes ses journées sont confirmées (aucune progression du forfait
-- après une seule journée).
create or replace function public.compute_reputation(
  p_subject_type text, p_subject_id uuid, p_at timestamptz default now())
returns table (
  stars numeric,
  profile_pct integer,
  profile_stars numeric,
  experience_units integer,
  experience_stars numeric,
  confirmed_count integer,
  breach_count integer,
  review_units integer,
  review_stars numeric,
  skill_count integer,
  skill_stars numeric,
  next_expiry_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pct integer;
  v_exp integer := 0;
  v_confirmed integer := 0;
  v_breaches integer := 0;
  v_reviews integer := 0;
  v_skills integer;
  v_next timestamptz;
  v_window timestamptz[] := '{}';
  v_penalties timestamptz[] := '{}';
  v_company public.company_profiles;
  e record;
begin
  if p_subject_type = 'candidate' then
    select cp.profile_completion_pct into v_pct
    from public.candidate_profiles cp where cp.id = p_subject_id;
    if not found then
      return;
    end if;

    for e in
      select x.at, x.delta from (
        -- Lot 12 : une unité par mission réalisée (toutes ses journées
        -- confirmées par code), quel que soit le nombre de codes.
        select max(c.consumed_at) as at, 1 as delta, m.id as ref
        from public.missions m
        join public.mission_completion_codes c on c.mission_id = m.id
        where m.candidate_id = p_subject_id
          and m.actual_end_time is not null
        group by m.id
        having bool_and(c.consumed_at is not null)
        union all
        select i.occurred_at, -5, i.id
        from public.reputation_incidents i
        where i.subject_type = 'candidate' and i.subject_id = p_subject_id
          and i.voided_at is null
      ) x
      order by x.at, x.delta desc, x.ref
    loop
      if e.delta > 0 then
        v_confirmed := v_confirmed + 1;
      else
        v_breaches := v_breaches + 1;
      end if;
      v_exp := greatest(0, least(20, v_exp + e.delta));
    end loop;

    v_reviews := public.reputation_review_units('candidate', p_subject_id, 10);

    select count(distinct lower(btrim(cs.skill_name)))::integer into v_skills
    from public.candidate_skills cs
    where cs.candidate_id = p_subject_id
      and exists (
        select 1 from public.candidate_skill_documents csd
        join public.candidate_documents d on d.id = csd.candidate_document_id
        where csd.candidate_skill_id = cs.id and d.candidate_id = p_subject_id
          and public.reputation_document_valid(d.status, d.expires_at, p_at))
      and (public.skill_requires_license(cs.skill_name) is null
           or exists (
             select 1 from public.candidate_documents l
             where l.candidate_id = p_subject_id
               and l.document_type = 'permis_conduire'
               and l.license_category = any (
                 public.license_categories_for(public.skill_requires_license(cs.skill_name)))
               and public.reputation_document_valid(l.status, l.expires_at, p_at)));

    -- Prochaine échéance d'un justificatif approuvé encore valide.
    select min(d.expires_at::timestamp at time zone 'UTC') into v_next
    from public.candidate_documents d
    where d.candidate_id = p_subject_id and d.status = 'verified'
      and d.expires_at is not null
      and d.expires_at::timestamp at time zone 'UTC' >= p_at;

    return query select
      (public.reputation_profile_stars(v_pct) + public.reputation_half_stars(v_exp, 20)
       + public.reputation_half_stars(v_reviews, 10)
       + least(coalesce(v_skills, 0), 2) * 0.5)::numeric(2,1),
      v_pct, public.reputation_profile_stars(v_pct),
      v_exp, public.reputation_half_stars(v_exp, 20), v_confirmed, v_breaches,
      v_reviews, public.reputation_half_stars(v_reviews, 10),
      coalesce(v_skills, 0), (least(coalesce(v_skills, 0), 2) * 0.5)::numeric(2,1),
      v_next;
    return;
  end if;

  if p_subject_type = 'company' then
    select cp.* into v_company from public.company_profiles cp where cp.id = p_subject_id;
    if not found then
      return;
    end if;
    v_pct := public.company_profile_completion_pct(v_company);

    -- Trois annulations tardives en 90 jours → un retrait, au troisième.
    for e in
      select i.occurred_at as at
      from public.reputation_incidents i
      where i.subject_type = 'company' and i.subject_id = p_subject_id
        and i.voided_at is null
      order by i.occurred_at, i.id
    loop
      v_breaches := v_breaches + 1;
      v_window := array(select w from unnest(v_window) w where w > e.at - interval '90 days')
                  || e.at;
      if cardinality(v_window) >= 3 then
        v_penalties := v_penalties || e.at;
        v_window := '{}';
      end if;
    end loop;

    for e in
      select x.at, x.delta from (
        select o.realized_at as at, 1 as delta, o.offer_id as ref
        from public.reputation_company_offers(p_subject_id, p_at) o
        union all
        select p.at, -5, null::uuid from unnest(v_penalties) as p(at)
      ) x
      order by x.at, x.delta desc, x.ref
    loop
      if e.delta > 0 then
        v_confirmed := v_confirmed + 1;
      end if;
      v_exp := greatest(0, least(20, v_exp + e.delta));
    end loop;

    v_reviews := public.reputation_review_units('company', p_subject_id, 20);

    return query select
      (public.reputation_profile_stars(v_pct) + public.reputation_half_stars(v_exp, 20)
       + public.reputation_half_stars(v_reviews, 20))::numeric(2,1),
      v_pct, public.reputation_profile_stars(v_pct),
      v_exp, public.reputation_half_stars(v_exp, 20), v_confirmed,
      cardinality(v_penalties),
      v_reviews, public.reputation_half_stars(v_reviews, 20),
      null::integer, null::numeric,
      -- Lot 12 : prochaine clôture de recrutement à prendre en compte.
      public.reputation_company_next_close(p_subject_id, p_at);
  end if;
end;
$$;


-- Balayage planifié (20261109120000), repris : la clôture du recrutement
-- d'une offre (next_expiry_at d'une entreprise) déclenche le recalcul.
-- Notification et animation : seulement si les étoiles changent
-- (refresh_reputation, ligne de score verrouillée), donc jamais en double.
create or replace function public.reputation_expiry_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  d record;
  v_docs jsonb;
  v_before numeric;
  v_after numeric;
  v_count integer := 0;
  v_locale text;
  v_user uuid;
  v_days integer;
  v_label text;
begin
  for s in
    select rs.subject_type, rs.subject_id, rs.next_expiry_at, rs.computed_at, rs.stars
    from public.reputation_scores rs
    where rs.next_expiry_at is not null and rs.next_expiry_at < now()
    order by rs.next_expiry_at
    for update skip locked
  loop
    select coalesce(jsonb_agg(jsonb_build_object('id', cd.id, 'type', cd.document_type,
                                                 'title', cd.title) order by cd.expires_at), '[]')
    into v_docs
    from public.candidate_documents cd
    where cd.candidate_id = s.subject_id and cd.status = 'verified'
      and cd.expires_at is not null
      and cd.expires_at::timestamp at time zone 'UTC' >= s.next_expiry_at
      and cd.expires_at::timestamp at time zone 'UTC' < now();
    v_before := s.stars;
    -- Lot 12 : pour une entreprise, l'échéance est la clôture du recrutement
    -- d'une offre (cause « job ») ; un justificatif ne la concerne jamais.
    v_after := public.refresh_reputation(s.subject_type, s.subject_id,
      case when s.subject_type = 'company' then 'job' else 'document_expired' end,
      case when s.subject_type = 'company' then '{}'::jsonb
           else jsonb_build_object('documents', v_docs) end);
    if s.subject_type = 'candidate' and v_after is not null and v_after < v_before then
      update public.document_expirations de set notified_expired = true
      where de.candidate_document_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_docs) x)
        and de.notified_expired = false;
      insert into public.document_expirations (candidate_id, candidate_document_id,
        document_type, expires_at, notified_expired)
      select s.subject_id, (x ->> 'id')::uuid, 'skill_document', cd.expires_at, true
      from jsonb_array_elements(v_docs) x
      join public.candidate_documents cd on cd.id = (x ->> 'id')::uuid
      on conflict (candidate_document_id) where candidate_document_id is not null do nothing;
    end if;
    v_count := v_count + 1;
  end loop;

  -- Suivi des justificatifs approuvés avec échéance.
  insert into public.document_expirations (candidate_id, candidate_document_id,
    document_type, expires_at)
  select cd.candidate_id, cd.id,
         case when cd.document_type = 'permis_conduire' then 'driving_license' else 'skill_document' end,
         cd.expires_at
  from public.candidate_documents cd
  where cd.status = 'verified' and cd.expires_at is not null
    and cd.expires_at >= (now() at time zone 'UTC')::date - 1
  on conflict (candidate_document_id) where candidate_document_id is not null
  do update set expires_at = excluded.expires_at
  where public.document_expirations.expires_at is distinct from excluded.expires_at;

  for d in
    select de.id, de.expires_at, de.notified_30d, de.notified_7d, de.notified_expired,
           cd.title, cd.document_type, cp.user_id
    from public.document_expirations de
    join public.candidate_documents cd on cd.id = de.candidate_document_id
    join public.candidate_profiles cp on cp.id = cd.candidate_id
    where cd.status = 'verified'
      and ((not de.notified_expired and de.expires_at::timestamp at time zone 'UTC' < now())
        or (not de.notified_7d and de.expires_at::timestamp at time zone 'UTC' - interval '7 days' < now()
            and de.expires_at::timestamp at time zone 'UTC' >= now())
        or (not de.notified_30d and de.expires_at::timestamp at time zone 'UTC' - interval '30 days' < now()
            and de.expires_at::timestamp at time zone 'UTC' - interval '7 days' >= now()))
    for update of de skip locked
  loop
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = d.user_id;
    v_label := coalesce(nullif(btrim(d.title), ''), d.document_type);
    if d.expires_at::timestamp at time zone 'UTC' < now() then
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (d.user_id, 'document_status',
        case when v_locale = 'en' then 'Document expired' else 'Justificatif expiré' end,
        case when v_locale = 'en' then v_label || ' has expired. Upload the renewed document.'
             else v_label || ' a expiré. Ajoutez le justificatif renouvelé.' end,
        jsonb_build_object('kind', 'document_expiry', 'stage', 'expired', 'href', '/profile/skills'));
      -- Les rappels antérieurs non envoyés ne le seront plus.
      update public.document_expirations set notified_expired = true, notified_7d = true,
        notified_30d = true where id = d.id;
    else
      v_days := case when d.expires_at::timestamp at time zone 'UTC' - interval '7 days' < now()
                     then 7 else 30 end;
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (d.user_id, 'document_status',
        case when v_locale = 'en' then 'Document expiring soon' else 'Justificatif bientôt expiré' end,
        case when v_locale = 'en'
             then v_label || ' expires on ' || to_char(d.expires_at, 'YYYY-MM-DD') || '. Renew it to keep your stars.'
             else v_label || ' expire le ' || to_char(d.expires_at, 'DD/MM/YYYY') || '. Renouvelez-le pour conserver vos étoiles.' end,
        jsonb_build_object('kind', 'document_expiry', 'stage', v_days || 'd', 'href', '/profile/skills'));
      update public.document_expirations
      set notified_7d = notified_7d or v_days = 7, notified_30d = true
      where id = d.id;
    end if;
  end loop;

  -- CNI vérifiée : suivi aligné sur la date du profil (création si
  -- absente, remise à zéro des rappels si la date change).
  insert into public.document_expirations (candidate_id, document_type, expires_at)
  select cp.id, 'cni', cp.cni_expires_at
  from public.candidate_profiles cp
  where cp.cni_verified = 'verified' and cp.cni_expires_at is not null
    and cp.cni_expires_at >= (now() at time zone 'UTC')::date - 1
  on conflict (candidate_id) where document_type = 'cni' and candidate_document_id is null
  do update set expires_at = excluded.expires_at, notified_30d = false,
    notified_7d = false, notified_expired = false
  where public.document_expirations.expires_at is distinct from excluded.expires_at;

  for d in
    select de.id, de.expires_at, cp.user_id
    from public.document_expirations de
    join public.candidate_profiles cp on cp.id = de.candidate_id
    where de.document_type = 'cni' and de.candidate_document_id is null
      and cp.cni_verified = 'verified' and cp.cni_expires_at = de.expires_at
      and ((not de.notified_expired and de.expires_at::timestamp at time zone 'UTC' < now())
        or (not de.notified_7d and de.expires_at::timestamp at time zone 'UTC' - interval '7 days' < now()
            and de.expires_at::timestamp at time zone 'UTC' >= now())
        or (not de.notified_30d and de.expires_at::timestamp at time zone 'UTC' - interval '30 days' < now()
            and de.expires_at::timestamp at time zone 'UTC' - interval '7 days' >= now()))
    for update of de skip locked
  loop
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = d.user_id;
    if d.expires_at::timestamp at time zone 'UTC' < now() then
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (d.user_id, 'document_status',
        case when v_locale = 'en' then 'ID card expired' else 'CNI expirée' end,
        case when v_locale = 'en'
             then 'Your national ID card has expired. Submit your new ID card from your profile.'
             else 'Votre CNI a expiré. Soumettez votre nouvelle CNI depuis votre profil.' end,
        jsonb_build_object('kind', 'document_expiry', 'document', 'cni', 'stage', 'expired',
                           'href', '/profile/candidate/edit'));
      update public.document_expirations set notified_expired = true, notified_7d = true,
        notified_30d = true where id = d.id;
    else
      v_days := case when d.expires_at::timestamp at time zone 'UTC' - interval '7 days' < now()
                     then 7 else 30 end;
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (d.user_id, 'document_status',
        case when v_locale = 'en' then 'ID card expiring soon' else 'CNI bientôt expirée' end,
        case when v_locale = 'en'
             then 'Your national ID card expires on ' || to_char(d.expires_at, 'YYYY-MM-DD') || '. Submit your new ID card from your profile.'
             else 'Votre CNI expire le ' || to_char(d.expires_at, 'DD/MM/YYYY') || '. Soumettez votre nouvelle CNI depuis votre profil.' end,
        jsonb_build_object('kind', 'document_expiry', 'document', 'cni', 'stage', v_days || 'd',
                           'href', '/profile/candidate/edit'));
      update public.document_expirations
      set notified_7d = notified_7d or v_days = 7, notified_30d = true
      where id = d.id;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.reputation_expiry_sweep() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 13. Clauses v3 (journées prévues, code de chaque journée)
-- ════════════════════════════════════════════════════════════════════
-- Nouvelles versions : les anciennes clauses et les contrats déjà créés ne
-- changent pas (versions immuables, clauses figées dans contract_data).
insert into public.contract_clause_versions (id, contract_template, body)
select v.id, v.template, jsonb_build_object(
  'fr', jsonb_build_object(
    'intro', 'Le présent contrat est conclu entre les parties ci-dessus pour la mission décrite, aux journées et horaires indiqués.',
    'candidate_title', 'Le candidat s''engage à',
    'candidate', jsonb_build_array(
      'se présenter à l''heure convenue sur le lieu de la mission, à chaque journée prévue ;',
      'exécuter les tâches confiées avec professionnalisme ;',
      'respecter les règles de sécurité et d''hygiène ;',
      'confirmer le début de chaque journée et saisir le code de fin de cette journée dans EasyJob.'),
    'company_title', 'L''entreprise s''engage à',
    'company', jsonb_build_array(
      'fournir un environnement de travail sûr ;',
      'remettre au candidat le code de fin de chaque journée une fois le travail de cette journée effectué ;',
      'régler au candidat le montant forfaitaire convenu pour la mission, qui couvre toutes les journées prévues au contrat, quelle que soit l''heure de fin effective, selon les conditions de la plateforme.'),
    'consent', 'J''ai lu les conditions ci-dessus et je les accepte. Je comprends que cette acceptation électronique, horodatée, vaut signature.'),
  'en', jsonb_build_object(
    'intro', 'This contract is concluded between the parties above for the mission described, on the days and times stated.',
    'candidate_title', 'The candidate agrees to',
    'candidate', jsonb_build_array(
      'arrive at the agreed time at the mission location on each scheduled day;',
      'carry out the assigned tasks professionally;',
      'follow safety and hygiene rules;',
      'confirm the start of each day and enter that day''s completion code in EasyJob.'),
    'company_title', 'The company agrees to',
    'company', jsonb_build_array(
      'provide a safe working environment;',
      'give the candidate each day''s completion code once that day''s work is done;',
      'pay the candidate the agreed flat amount for the mission, which covers all the days scheduled in the contract, whatever the actual finishing time, under the platform''s terms.'),
    'consent', 'I have read the terms above and accept them. I understand that this timestamped electronic acceptance counts as my signature.'))
from (values ('simple-v3', 'simple'), ('formal-v3', 'formal')) as v(id, template)
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 14. Realtime : signaux minimaux existants
-- ════════════════════════════════════════════════════════════════════
create or replace function public.rt_on_job_days()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select j.* into v_job from public.jobs j
  where j.id = case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  if not found then
    return null;
  end if;
  perform public.rt_signal_users(
    array[public.rt_company_user(v_job.company_id)], 'jobs', v_job.id);
  perform public.rt_signal_users(
    array(select cp.user_id
          from public.job_applications ja
          join public.candidate_profiles cp on cp.id = ja.candidate_id
          where ja.job_id = v_job.id),
    'jobs', v_job.id);
  if v_job.status = 'active' then
    perform public.rt_signal_public_jobs(v_job.id);
  end if;
  return null;
end;
$$;
revoke all on function public.rt_on_job_days() from public, anon, authenticated;

drop trigger if exists trg_rt_job_days on public.job_days;
create trigger trg_rt_job_days
  after insert or update or delete on public.job_days
  for each row execute function public.rt_on_job_days();

drop trigger if exists trg_rt_mission_days on public.mission_days;
create trigger trg_rt_mission_days
  after insert or update or delete on public.mission_days
  for each row execute function public.rt_on_mission_child();

-- ════════════════════════════════════════════════════════════════════
-- 15. Diagnostic de reprise (lecture seule)
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_days integer;
  v_ambiguous integer;
  v_ambiguous_unpublished integer;
  v_ambiguous_engaged integer;
  v_missions integer;
  v_codes integer;
begin
  select count(*) into v_days from public.job_days;
  select count(*) into v_ambiguous from public.jobs j
  where j.end_date is not null and j.end_date <> j.start_date
    and not exists (select 1 from public.job_days d where d.job_id = j.id);
  select count(*) into v_ambiguous_unpublished from public.jobs j
  where j.end_date is not null and j.end_date <> j.start_date
    and j.first_published_at is null and not j.legacy_publication;
  select count(distinct j.id) into v_ambiguous_engaged from public.jobs j
  join public.missions m on m.job_id = j.id
  where j.end_date is not null and j.end_date <> j.start_date;
  select count(*) into v_missions from public.mission_days;
  select count(*) into v_codes from public.mission_completion_codes;
  raise notice 'lot 12: % journée(s) reprise(s) ; % offre(s) à intervalle sans calendrier (sens non établi, non converties), dont % jamais publiée(s) (publication refusée : job_days_missing) et % avec mission(s) (conservées, journée de start_date) ; % journée(s) de mission ; % code(s)',
    v_days, v_ambiguous, v_ambiguous_unpublished, v_ambiguous_engaged, v_missions, v_codes;
end $$;
