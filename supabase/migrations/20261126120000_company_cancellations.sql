-- Migration : annulation par l'entreprise après sélection (lot 17d-2)
-- Date : 2026-11-22 (date de rédaction ; l'horodatage ordonne seulement)
-- Tables affectées :
--   mission_day_company_terms, company_cancellations,
--   company_cancellation_days (nouvelles, fermées aux sessions et à la clé
--   service) ; mission_days, mission_incidents, candidate_cancellation_days,
--   reputation_incidents (déclencheurs) ; missions (écriture par RPC).
--
-- Décisions (docs/product/DECISIONS.md) :
--   * ANN-06 (validation documentée) : délai de l'entreprise jusqu'à 48 h
--     avant la journée (Free) ou 24 h (Premium), limites incluses ; plan
--     figé à chaque sélection, sans effet d'un changement ultérieur ;
--     au-delà, annulation possible, qualifiée de tardive, sans sanction,
--     frais, indemnité ni remboursement ; engagements antérieurs :
--     historiques, délai inconnu.
--   * ANN-04, côté entreprise : une demande (plusieurs journées, plusieurs
--     candidats) = un seul événement (instruction utilisateur du
--     2026-11-22, brief 17d-2).
--   * ANN-08 (à confirmer), éléments appliqués : journées futures non
--     commencées seulement ; début prévu atteint → refus et orientation
--     (interruption ou support) ; aucune réouverture du recrutement ; motif
--     obligatoire (10 à 500 caractères, comme ANN-09), jamais montré aux
--     candidats ; avis dans l'application. Non appliqués : retrait ciblé
--     d'un candidat (la demande porte sur des dates entières : tous les
--     candidats encore engagés ce jour-là), justificatifs de force majeure.
--   * Décisions du 2026-11-22 (« oui » de l'utilisateur) : motif visible par
--     l'entreprise et l'administration seulement ; retrait ciblé d'un
--     candidat réservé au support (aucun outil livré ici) ; journée
--     annulée avant son début (candidat ou entreprise) : créneau et marge
--     de 3 h libérés.
--   * ECH-02 : horaires d'une mission et de ses journées figés pour tout
--     auteur applicatif, clé service comprise.
--   * ABO-07 : plan effectif lu par company_effective_plan dans la
--     transaction de « Signer et sélectionner » (selected_at = now()) ;
--     aucune fonction ne reconstitue un plan passé.
--
-- Ce que la migration ne fait PAS (aucune règle validée pour ce cas) :
--   aucun manquement company_late_cancellation (SAN-06), aucun retrait de
--   réputation, aucun frais, indemnité ou remboursement (MNT-04), aucune
--   faute du candidat, aucune réouverture ni remplacement (ANN-14 ne
--   concerne que le désistement du candidat). Contrat, candidature
--   (« selected »), journées confirmées et montants reconnus conservés.
--
-- Rollback :
--   drop function public.request_company_cancellation(uuid, uuid, uuid[], text, boolean),
--     public.admin_company_cancellations(uuid),
--     public.company_cancellation_preview(uuid), public.my_company_cancellations(uuid),
--     public.company_cancellation_classify(uuid, timestamptz),
--     public.mission_day_cancelled_by(uuid), public.mission_day_cancelled_at(uuid) ;
--   recréer depuis 20261122120000 / 20261123120000 : block_cancelled_mission_day,
--     block_incident_on_cancelled_day, mission_close_if_interrupted,
--     candidate_cancellation_preview, candidate_future_engagements,
--     protect_reputation_incidents, company_job_cancellations,
--     mission_days_json, mission_acquired_amount ; candidate_schedule_conflicts
--     depuis 20261113120000 ; protect_mission_writes et protect_mission_day_writes
--     depuis leur dernière définition ;
--   drop trigger trg_record_mission_day_company_terms on public.mission_days ;
--   drop trigger trg_guard_candidate_cancellation_day on public.candidate_cancellation_days ;
--   drop table public.company_cancellation_days, public.company_cancellations,
--     public.mission_day_company_terms.

-- ════════════════════════════════════════════════════════════════════
-- 1. Conditions entreprise figées à la sélection (ANN-06)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.mission_day_company_terms (
  mission_day_id uuid primary key references public.mission_days(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  -- 'selection' : plan lu dans la transaction de « Signer et sélectionner » ;
  -- 'legacy' : journée sélectionnée avant ce lot (ou hors de la transaction
  -- de sélection) : plan et délai inconnus, jamais reconstitués.
  terms_source text not null default 'selection'
    check (terms_source in ('selection', 'legacy')),
  company_plan text check (company_plan in ('free', 'premium')),
  cancellation_notice_hours integer,
  selected_at timestamptz,
  recorded_at timestamptz not null default now(),
  check (
    (terms_source = 'selection' and selected_at is not null
     and ((company_plan = 'free' and cancellation_notice_hours = 48)
          or (company_plan = 'premium' and cancellation_notice_hours = 24)))
    or (terms_source = 'legacy'
        and company_plan is null and cancellation_notice_hours is null))
);
create index if not exists idx_mission_day_company_terms_job
  on public.mission_day_company_terms (job_id);

comment on table public.mission_day_company_terms is
  'Lot 17d-2 (ANN-06) : plan effectif de l''entreprise et délai d''annulation (Free 48 h, Premium 24 h), figés par journée dans la transaction de « Signer et sélectionner ». legacy : plan et délai inconnus (jamais reconstitués depuis le plan actuel). Immuable ; écrit seulement par trg_record_mission_day_company_terms.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Annulations par l'entreprise : un événement par demande
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.company_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  company_user_id uuid not null references public.users(id) on delete cascade,
  -- Offre visée (offre principale ou sous-offre) ; journées de l'offre et
  -- de ses sous-offres (job_offer_ids).
  job_id uuid not null references public.jobs(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  day_count integer not null check (day_count >= 1),
  date_count integer not null check (date_count >= 1),
  candidate_count integer not null check (candidate_count >= 1),
  in_time_count integer not null check (in_time_count >= 0),
  late_count integer not null check (late_count >= 0),
  legacy_count integer not null check (legacy_count >= 0),
  notified_users integer not null check (notified_users >= 0),
  created_at timestamptz not null default now(),
  check (in_time_count + late_count + legacy_count = day_count)
);
create index if not exists idx_company_cancellations_job
  on public.company_cancellations (job_id, created_at);

create table if not exists public.company_cancellation_days (
  mission_day_id uuid primary key references public.mission_days(id) on delete cascade,
  cancellation_id uuid not null references public.company_cancellations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  scheduled_date date not null,
  starts_at timestamptz not null,
  -- Qualification seulement (ANN-06) : aucune conséquence n'en découle.
  classification text not null check (classification in ('in_time', 'late', 'legacy')),
  terms_source text not null,
  company_plan text,
  cancellation_notice_hours integer,
  deadline_at timestamptz
);
create index if not exists idx_company_cancellation_days_cancellation
  on public.company_cancellation_days (cancellation_id);
create index if not exists idx_company_cancellation_days_mission
  on public.company_cancellation_days (mission_id);

comment on table public.company_cancellations is
  'Lot 17d-2 : annulation par l''entreprise après sélection, un événement par demande (ANN-04 étendu). Qualification ANN-06 sans conséquence : aucun manquement, frais, indemnité ni remboursement. Ajout seul ; écrit seulement par request_company_cancellation.';

do $$
declare
  t text;
begin
  foreach t in array array['mission_day_company_terms', 'company_cancellations',
                           'company_cancellation_days'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    -- Clé service : lecture seule (pages d'administration) ; aucune écriture,
    -- ni TRUNCATE (qui contournerait les déclencheurs).
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from service_role', t);
  end loop;
end $$;

-- Écriture réservée aux fonctions de la base (propriétaire) : ni session,
-- ni clé service. Aucune modification, jamais. Une suppression ne passe
-- que par une cascade ou une maintenance directe (voie postgres).
create or replace function public.protect_company_cancellation_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception '%: written by the database only', tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_company_cancellation_writes() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['mission_day_company_terms', 'company_cancellations',
                           'company_cancellation_days'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_company_cancellation_writes()', t, t);
  end loop;
end $$;

-- Les journées d'une mission naissent dans la transaction de sélection
-- (contract_select_core, qui tient la ligne de l'entreprise en partage) :
-- selected_at = now() et company_effective_plan est évalué à now(), donc à
-- l'instant de la sélection. Hors de cette transaction, aucun plan n'est
-- reconstitué : la journée est marquée legacy.
create or replace function public.record_mission_day_company_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_job uuid;
  v_status public.application_status;
  v_selected_at timestamptz;
  v_company uuid;
  v_plan text;
  v_expires timestamptz;
  v_effective text;
begin
  select m.application_id, m.job_id into v_application_id, v_job
  from public.missions m where m.id = new.mission_id;
  if v_application_id is null then
    return null;
  end if;
  select a.status, a.selected_at into v_status, v_selected_at
  from public.job_applications a where a.id = v_application_id;
  if v_status is distinct from 'selected' or v_selected_at is null then
    return null;
  end if;
  select j.company_id, cp.subscription_plan, cp.subscription_expires_at
  into v_company, v_plan, v_expires
  from public.jobs j join public.company_profiles cp on cp.id = j.company_id
  where j.id = v_job;
  if v_selected_at is distinct from now() then
    insert into public.mission_day_company_terms (
      mission_day_id, mission_id, application_id, job_id, company_id,
      terms_source, company_plan, cancellation_notice_hours, selected_at)
    values (new.id, new.mission_id, v_application_id, v_job, v_company,
            'legacy', null, null, v_selected_at)
    on conflict (mission_day_id) do nothing;
    return null;
  end if;
  v_effective := public.company_effective_plan(v_plan, v_expires);
  insert into public.mission_day_company_terms (
    mission_day_id, mission_id, application_id, job_id, company_id,
    company_plan, cancellation_notice_hours, selected_at)
  values (new.id, new.mission_id, v_application_id, v_job, v_company,
          v_effective, case when v_effective = 'premium' then 24 else 48 end, v_selected_at)
  on conflict (mission_day_id) do nothing;
  return null;
end;
$$;
revoke all on function public.record_mission_day_company_terms() from public, anon, authenticated, service_role;

drop trigger if exists trg_record_mission_day_company_terms on public.mission_days;
create trigger trg_record_mission_day_company_terms
  after insert on public.mission_days
  for each row execute function public.record_mission_day_company_terms();

-- Engagements antérieurs (ANN-06 : « historiques, délai inconnu ») : une
-- ligne legacy par journée d'une candidature sélectionnée, sans plan.
-- Idempotent ; ne remplace jamais une ligne existante.
insert into public.mission_day_company_terms (
  mission_day_id, mission_id, application_id, job_id, company_id,
  terms_source, company_plan, cancellation_notice_hours, selected_at)
select d.id, m.id, a.id, m.job_id, j.company_id, 'legacy', null, null, a.selected_at
from public.mission_days d
join public.missions m on m.id = d.mission_id
join public.job_applications a on a.id = m.application_id
join public.jobs j on j.id = m.job_id
where a.status = 'selected'
  and not exists (select 1 from public.mission_day_company_terms t
                  where t.mission_day_id = d.id)
on conflict (mission_day_id) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 3. Journée annulée : par le candidat ou par l'entreprise
-- ════════════════════════════════════════════════════════════════════
create or replace function public.mission_day_cancelled_by(p_day_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.company_cancellation_days x where x.mission_day_id = p_day_id)
      then 'company'
    when exists (select 1 from public.candidate_cancellation_days x where x.mission_day_id = p_day_id)
      then 'candidate'
  end;
$$;
revoke all on function public.mission_day_cancelled_by(uuid) from public, anon, authenticated, service_role;

create or replace function public.mission_day_cancelled_at(p_day_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.created_at from public.company_cancellation_days x
     join public.company_cancellations c on c.id = x.cancellation_id
     where x.mission_day_id = p_day_id),
    (select c.created_at from public.candidate_cancellation_days x
     join public.candidate_cancellations c on c.id = x.cancellation_id
     where x.mission_day_id = p_day_id));
$$;
revoke all on function public.mission_day_cancelled_at(uuid) from public, anon, authenticated, service_role;

-- Une journée n'est annulée qu'une fois, par l'une ou l'autre partie, quel
-- que soit l'auteur de l'écriture (garde de la base, en plus des verrous).
create or replace function public.guard_single_day_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_table_name = 'candidate_cancellation_days'
      and exists (select 1 from public.company_cancellation_days x where x.mission_day_id = new.mission_day_id))
     or (tg_table_name = 'company_cancellation_days'
      and exists (select 1 from public.candidate_cancellation_days x where x.mission_day_id = new.mission_day_id)) then
    raise exception 'day_already_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_single_day_cancellation() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_candidate_cancellation_day on public.candidate_cancellation_days;
create trigger trg_guard_candidate_cancellation_day
  before insert on public.candidate_cancellation_days
  for each row execute function public.guard_single_day_cancellation();
drop trigger if exists trg_guard_company_cancellation_day on public.company_cancellation_days;
create trigger trg_guard_company_cancellation_day
  before insert on public.company_cancellation_days
  for each row execute function public.guard_single_day_cancellation();

-- Reprise de 20261122120000 : une journée annulée par l'entreprise ne peut
-- plus être commencée, confirmée ni réglée (tout auteur, clé service
-- comprise : course avec le début ou la confirmation).
create or replace function public.block_cancelled_mission_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((new.actual_start_time is not null and old.actual_start_time is null)
      or (new.actual_end_time is not null and old.actual_end_time is null)
      or (new.completion_source is distinct from old.completion_source
          and new.completion_source is not null))
     and (exists (select 1 from public.candidate_cancellation_days cd
                  where cd.mission_day_id = new.id)
          or exists (select 1 from public.company_cancellation_days cd
                     where cd.mission_day_id = new.id)) then
    raise exception 'day_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.block_cancelled_mission_day() from public, anon, authenticated;

create or replace function public.block_incident_on_cancelled_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.candidate_cancellation_days cd
             where cd.mission_day_id = new.mission_day_id)
     or exists (select 1 from public.company_cancellation_days cd
                where cd.mission_day_id = new.mission_day_id) then
    raise exception 'day_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.block_incident_on_cancelled_day() from public, anon, authenticated;

-- Reprise de 20261122120000. Mission dont toutes les journées sont annulées
-- (par l'une ou l'autre partie) ou confirmées : annulée. L'auteur retenu
-- est celui de la dernière annulation enregistrée sur la mission. La
-- candidature et le contrat ne changent pas ici.
create or replace function public.mission_close_if_interrupted(p_mission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_by text;
begin
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found or v_mission.status in ('cancelled', 'no_show', 'completed') then
    return false;
  end if;
  if not exists (select 1 from public.candidate_cancellation_days cd where cd.mission_id = p_mission_id)
     and not exists (select 1 from public.company_cancellation_days cd where cd.mission_id = p_mission_id) then
    return false;
  end if;
  if exists (select 1 from public.mission_days d
             where d.mission_id = p_mission_id
               and not public.completion_counts(d.completion_source)
               and public.mission_day_cancelled_by(d.id) is null) then
    return false;
  end if;
  select x.actor into v_by from (
    select 'candidate'::text as actor, c.created_at from public.candidate_cancellation_days cd
    join public.candidate_cancellations c on c.id = cd.cancellation_id
    where cd.mission_id = p_mission_id
    union all
    select 'company', c.created_at from public.company_cancellation_days cd
    join public.company_cancellations c on c.id = cd.cancellation_id
    where cd.mission_id = p_mission_id) x
  order by x.created_at desc, x.actor limit 1;
  update public.missions m
  set status = 'cancelled', cancelled_by = v_by,
      cancellation_reason = v_by || case
        when exists (select 1 from public.mission_days d where d.mission_id = m.id
                     and public.completion_counts(d.completion_source))
        then '_cancellation_interrupted' else '_cancellation' end
  where m.id = p_mission_id;
  return true;
end;
$$;
revoke all on function public.mission_close_if_interrupted(uuid) from public, anon, authenticated;

-- Reprise de 20261122120000 : une journée annulée par l'entreprise n'est
-- plus proposée au désistement du candidat.
create or replace function public.candidate_cancellation_preview(p_mission_id uuid)
returns table (
  mission_day_id uuid,
  mission_id uuid,
  day_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  classification text,
  deadline_at timestamptz,
  reaction_until timestamptz,
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
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select m.* into v_mission from public.missions m
  join public.candidate_profiles cp on cp.id = m.candidate_id and cp.user_id = v_uid
  where m.id = p_mission_id;
  if not found then
    raise exception 'mission_not_found';
  end if;
  return query
  select d.id, d.mission_id, d.scheduled_date, d.scheduled_start_time, d.scheduled_end_time,
         d.starts_at, k.classification, k.deadline_at, k.reaction_until, now()
  from public.missions m
  join public.mission_days d on d.mission_id = m.id
  join public.job_applications a on a.id = m.application_id
  cross join lateral public.classify_cancellation_day(d.id, now()) k
  where m.job_id = v_mission.job_id and m.candidate_id = v_mission.candidate_id
    and m.status in ('pending', 'confirmed', 'in_progress')
    and a.status = 'selected'
    and d.actual_start_time is null
    and not public.completion_counts(d.completion_source)
    and d.starts_at > now()
    and public.mission_day_cancelled_by(d.id) is null
  order by d.starts_at;
end;
$$;
revoke all on function public.candidate_cancellation_preview(uuid) from public, anon;
grant execute on function public.candidate_cancellation_preview(uuid) to authenticated;

create or replace function public.candidate_future_engagements(p_user_id uuid, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'mission_id', d.mission_id, 'mission_day_id', d.id, 'job_id', m.job_id,
           'job_title', j.title, 'starts_at', d.starts_at) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d
  join public.missions m on m.id = d.mission_id
  join public.candidate_profiles cp on cp.id = m.candidate_id and cp.user_id = p_user_id
  join public.jobs j on j.id = m.job_id
  where d.starts_at > p_at
    and d.actual_start_time is null
    and m.status in ('pending', 'confirmed', 'in_progress')
    and public.mission_day_cancelled_by(d.id) is null;
$$;
revoke all on function public.candidate_future_engagements(uuid, timestamptz) from public, anon, authenticated;

-- Reprise de 20261113120000 (décision du 2026-11-22, ECH-04) : une journée
-- effectivement annulée avant son début, par le candidat ou par
-- l'entreprise, ne retient plus son créneau ni la marge de 3 h qui lui est
-- attachée. Seule l'annulation enregistrée compte (ligne validée de
-- candidate_cancellation_days ou de company_cancellation_days) : une demande
-- refusée ou encore en cours ne libère rien. Indépendant de la décision sur
-- un justificatif ou une sanction. Les autres journées de la même mission
-- gardent leur contrôle. Calcul partagé par l'aperçu
-- (job_days_for_candidate), la candidature (apply_to_job_core) et la
-- sélection définitive (selection_prepare, sous lock_candidate_engagements).
create or replace function public.candidate_schedule_conflicts(p_candidate_id uuid, p_ranges tstzrange[])
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
      and not exists (select 1 from public.candidate_cancellation_days x where x.mission_day_id = md.id)
      and not exists (select 1 from public.company_cancellation_days x where x.mission_day_id = md.id)
      and tstzrange(md.starts_at - interval '3 hours', md.ends_at + interval '3 hours') && r.rng);
$$;
revoke all on function public.candidate_schedule_conflicts(uuid, tstzrange[]) from public, anon, authenticated;

-- Reprise de 20261122120000 : l'annulation par l'entreprise n'est jamais
-- une faute du candidat. Aucun manquement candidat (absence ou annulation
-- tardive) sur une journée annulée par l'entreprise.
create or replace function public.protect_reputation_incidents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.subject_type, new.subject_id, new.kind, new.source,
        new.scheduled_start_at, new.occurred_at, new.created_at)
       is distinct from
       (old.subject_type, old.subject_id, old.kind, old.source,
        old.scheduled_start_at, old.occurred_at, old.created_at)
       or (new.mission_id is distinct from old.mission_id and new.mission_id is not null)
       or (new.job_id is distinct from old.job_id and new.job_id is not null)
       or (new.decided_by is distinct from old.decided_by and new.decided_by is not null)
       or (new.cancellation_id is distinct from old.cancellation_id and new.cancellation_id is not null)
       or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
      raise exception 'reputation_incidents: only a single void is allowed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.kind = 'company_late_cancellation' then
    if new.job_id is null or not exists (
      select 1 from public.jobs j
      where j.id = new.job_id and j.company_id = new.subject_id) then
      raise exception 'incident_job_mismatch';
    end if;
  end if;
  if new.kind in ('candidate_late_cancellation', 'candidate_no_show') then
    if new.mission_id is null or not exists (
      select 1 from public.missions m where m.id = new.mission_id
        and m.candidate_id = new.subject_id) then
      raise exception 'incident_mission_mismatch';
    end if;
    -- Lot 17d-2 : journée annulée par l'entreprise → aucune faute du
    -- candidat. Repère : début de la journée, courant ou enregistré à
    -- l'annulation (comme l'annulation par le candidat).
    if exists (select 1 from public.company_cancellation_days x
               join public.mission_days d on d.id = x.mission_day_id
               where x.mission_id = new.mission_id
                 and (d.starts_at = new.scheduled_start_at
                      or x.starts_at = new.scheduled_start_at)) then
      raise exception 'incident_conflicts_with_company_cancellation';
    end if;
  end if;
  if new.cancellation_id is not null then
    if new.kind <> 'candidate_late_cancellation' or not exists (
      select 1 from public.candidate_cancellations c
      join public.candidate_cancellation_days cd on cd.cancellation_id = c.id
      where c.id = new.cancellation_id and c.candidate_id = new.subject_id
        and cd.mission_id = new.mission_id) then
      raise exception 'incident_cancellation_mismatch';
    end if;
    if exists (
      select 1 from public.candidate_cancellation_days cd
      join public.mission_days d on d.id = cd.mission_day_id
      where cd.cancellation_id = new.cancellation_id
        and (d.actual_start_time is not null or public.completion_counts(d.completion_source))) then
      raise exception 'incident_conflicts_with_completion';
    end if;
  elsif new.kind in ('candidate_late_cancellation', 'candidate_no_show') then
    -- Journée confirmée (code ou support) : le travail a eu lieu, pas de faute.
    if exists (select 1 from public.mission_days d
               where d.mission_id = new.mission_id
                 and public.completion_counts(d.completion_source)) then
      raise exception 'incident_conflicts_with_completion';
    end if;
    -- Journée annulée par le candidat : pas d'absence (un seul manquement
    -- pour un même fait). Repère : début de la journée de la mission.
    if new.kind = 'candidate_no_show' and exists (
      select 1 from public.candidate_cancellation_days cd
      join public.mission_days d on d.id = cd.mission_day_id
      where cd.mission_id = new.mission_id
        and (d.starts_at = new.scheduled_start_at or cd.starts_at = new.scheduled_start_at)) then
      raise exception 'incident_conflicts_with_cancellation';
    end if;
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4. Vues des parties (reprises de 20261123120000)
-- ════════════════════════════════════════════════════════════════════
-- Ajout : cancelled_at et cancelled_by couvrent les deux parties. Ni motif,
-- ni qualification, ni plan.
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
           'completion_available_at', d.ends_at,
           'started_at', d.actual_start_time,
           'completed_at', d.actual_end_time,
           'completed_via', case when public.completion_counts(d.completion_source)
                                      or d.completion_source in ('partial', 'partial_support')
                                 then d.completion_source end,
           'cancelled_at', public.mission_day_cancelled_at(d.id),
           'cancelled_by', public.mission_day_cancelled_by(d.id),
           'interruption', (select jsonb_build_object(
                              'incident_id', i.id, 'status', i.status, 'outcome', i.outcome,
                              'stage', public.interruption_state(i.id, now()) ->> 'stage',
                              'blocks_completion', public.interruption_blocks_completion(d.id),
                              'agreement', (select case when a.id is null then null
                                              else jsonb_build_object('proposal_id', a.id,
                                                     'version', a.version, 'amount', a.amount) end
                                            from public.interruption_agreement(d.id) a),
                              'settled_amount', (select c.amount from public.mission_interruption_closures c
                                                 where c.incident_id = i.id and c.outcome = 'settled'),
                              'closure_outcome', (select c.outcome from public.mission_interruption_closures c
                                                  where c.incident_id = i.id))
                            from public.mission_incidents i
                            where i.mission_day_id = d.id and i.kind = 'interruption')) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;

-- Reprise de 20261122120000 : journées annulées par l'une ou l'autre
-- partie, avec leur auteur (ni motif, ni plan, ni qualification).
drop function if exists public.company_job_cancellations(uuid);
create or replace function public.company_job_cancellations(p_job_id uuid)
returns table (mission_id uuid, mission_day_id uuid, cancelled_at timestamptz, cancelled_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.jobs j join public.company_profiles cp on cp.id = j.company_id
                 where j.id = p_job_id and cp.user_id = (select auth.uid())) then
    raise exception 'job_not_found';
  end if;
  return query
  select x.mission_id, x.mission_day_id, x.created_at, x.actor
  from (
    select cd.mission_id, cd.mission_day_id, c.created_at, 'candidate'::text as actor, cd.starts_at
    from public.candidate_cancellation_days cd
    join public.candidate_cancellations c on c.id = cd.cancellation_id
    where c.job_id = p_job_id
    union all
    select cd.mission_id, cd.mission_day_id, c.created_at, 'company'::text, cd.starts_at
    from public.company_cancellation_days cd
    join public.company_cancellations c on c.id = cd.cancellation_id
    where cd.job_id = p_job_id) x
  order by x.starts_at;
end;
$$;
revoke all on function public.company_job_cancellations(uuid) from public, anon;
grant execute on function public.company_job_cancellations(uuid) to authenticated;

-- Reprise de 20261123120000. Ajouts : une journée annulée par l'entreprise
-- est sortie du calcul comme une journée annulée par le candidat (aucun
-- montant automatique pour elle, aucune indemnité décidée : MNT-04) ; elle
-- est signalée par cancelled_by et company_cancelled_days. Le montant des
-- journées confirmées est inchangé.
create or replace function public.mission_acquired_amount(p_mission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_contract public.contracts;
  v_pay numeric;
  v_total integer := 0;
  v_done integer := 0;
  v_days jsonb := '[]'::jsonb;
  v_pending boolean := false;
  v_settlement_pending boolean := false;
  v_settled numeric := 0;
  v_company_cancelled integer := 0;
  v_exact numeric;
  x record;
begin
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found then
    raise exception 'mission_not_found';
  end if;
  if not (public.is_admin_user(v_uid)
          or exists (select 1 from public.candidate_profiles cp
                     where cp.id = v_mission.candidate_id and cp.user_id = v_uid)
          or exists (select 1 from public.jobs j join public.company_profiles cp on cp.id = j.company_id
                     where j.id = v_mission.job_id and cp.user_id = v_uid)) then
    raise exception 'mission_not_found';
  end if;
  select c.* into v_contract from public.contracts c where c.application_id = v_mission.application_id;
  if v_contract.id is null then
    raise exception 'mission_not_found';
  end if;
  v_pay := (v_contract.contract_data ->> 'mission_pay_per_candidate')::numeric;

  for x in
    select (e ->> 'date')::date as day_date, (e ->> 'start_time')::time as st,
           (e ->> 'end_time')::time as et, d.id as day_id, d.completion_source,
           public.mission_day_cancelled_by(d.id) as cancelled_by,
           -- Travail partiel identifié (lot 16) ou interruption non réglée.
           (exists (select 1 from public.mission_incidents i where i.mission_day_id = d.id
                    and i.kind <> 'interruption' and i.outcome = 'partial')
            or public.interruption_blocks_completion(d.id)) as awaiting_settlement,
           exists (select 1 from public.mission_incidents i
                   join public.mission_interruption_closures c on c.incident_id = i.id
                   where i.mission_day_id = d.id and c.outcome = 'disagreement') as unresolved,
           (select c.amount from public.mission_incidents i
            join public.mission_interruption_closures c on c.incident_id = i.id
            where i.mission_day_id = d.id and c.outcome = 'settled') as settled_amount
    from jsonb_array_elements(coalesce(v_contract.contract_data -> 'days',
           jsonb_build_array(jsonb_build_object(
             'date', v_contract.contract_data ->> 'start_date',
             'start_time', v_contract.contract_data ->> 'start_time',
             'end_time', v_contract.contract_data ->> 'end_time')))) e
    left join public.mission_days d on d.mission_id = v_mission.id
      and d.scheduled_date = (e ->> 'date')::date
    order by (e ->> 'date')::date
  loop
    v_total := v_total + public.contract_day_minutes(x.st, x.et);
    if x.cancelled_by = 'company' then
      v_company_cancelled := v_company_cancelled + 1;
    end if;
    if public.completion_counts(x.completion_source) then
      v_done := v_done + public.contract_day_minutes(x.st, x.et);
    elsif x.completion_source in ('partial', 'partial_support') then
      v_settled := v_settled + coalesce(x.settled_amount, 0);
    elsif x.awaiting_settlement and x.cancelled_by is null then
      v_settlement_pending := true;
    elsif x.cancelled_by is null then
      v_pending := true;
    end if;
    v_days := v_days || jsonb_build_object(
      'date', x.day_date, 'start_time', x.st, 'end_time', x.et,
      'planned_minutes', public.contract_day_minutes(x.st, x.et),
      'realized', public.completion_counts(x.completion_source),
      'realized_via', case when public.completion_counts(x.completion_source)
                                or x.completion_source in ('partial', 'partial_support')
                           then x.completion_source end,
      'cancelled', x.cancelled_by is not null,
      'cancelled_by', x.cancelled_by,
      'awaiting_settlement', x.awaiting_settlement and x.completion_source is null and x.cancelled_by is null,
      'unresolved', x.unresolved and x.completion_source is null,
      'settled_amount', x.settled_amount);
  end loop;

  v_exact := (case when v_total > 0 then v_pay * v_done / v_total else 0 end) + v_settled;
  return jsonb_build_object(
    'mission_id', v_mission.id,
    'currency', coalesce(v_contract.contract_data ->> 'currency', 'XAF'),
    'contract_pay', v_pay,
    'planned_minutes_total', v_total,
    'realized_minutes', v_done,
    'settled_total', v_settled,
    'acquired_exact', round(v_exact, 4),
    'acquired_rounded', round(v_exact),
    'is_integer', v_exact = trunc(v_exact),
    'company_cancelled_days', v_company_cancelled,
    'status', case when v_settlement_pending then 'settlement_pending'
                   when v_pending then 'in_progress' else 'final' end,
    'rounding', 'half_up_to_validate',
    'duration_convention', 'gross_scheduled_minutes_break_not_deducted',
    'days', v_days);
end;
$$;
revoke all on function public.mission_acquired_amount(uuid) from public, anon;
grant execute on function public.mission_acquired_amount(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Qualification d'une journée (ANN-06, sans conséquence)
-- ════════════════════════════════════════════════════════════════════
-- in_time : p_at <= début − délai figé (limite incluse) ; late : au-delà ;
-- legacy : conditions historiques ou absentes (délai inconnu). Aucun délai
-- de réaction côté entreprise (aucune décision).
create or replace function public.company_cancellation_classify(p_day_id uuid, p_at timestamptz)
returns table (
  classification text,
  terms_source text,
  company_plan text,
  cancellation_notice_hours integer,
  deadline_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day public.mission_days;
  v_terms public.mission_day_company_terms;
  v_deadline timestamptz;
begin
  select d.* into v_day from public.mission_days d where d.id = p_day_id;
  select t.* into v_terms from public.mission_day_company_terms t where t.mission_day_id = p_day_id;
  if v_terms.mission_day_id is null or v_terms.terms_source = 'legacy'
     or v_terms.cancellation_notice_hours is null then
    return query select 'legacy'::text, coalesce(v_terms.terms_source, 'none'),
      null::text, null::integer, null::timestamptz;
    return;
  end if;
  v_deadline := v_day.starts_at - make_interval(hours => v_terms.cancellation_notice_hours);
  return query select
    case when p_at <= v_deadline then 'in_time' else 'late' end,
    v_terms.terms_source, v_terms.company_plan, v_terms.cancellation_notice_hours, v_deadline;
end;
$$;
revoke all on function public.company_cancellation_classify(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 6. Entreprise : aperçu, demande, historique
-- ════════════════════════════════════════════════════════════════════
-- Contrôles communs : session, rôle entreprise, compte et profil actifs,
-- offre de l'entreprise (dossier non exigé, comme close_job).
create or replace function public.company_cancellation_actor(p_job_id uuid)
returns table (user_id uuid, role text, company_id uuid, job_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_company record;
  v_job_ids uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.role::text, u.is_active into v_role, v_active from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  select cp.id, cp.is_active into v_company from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  v_job_ids := public.job_offer_ids(p_job_id, v_company.id);
  if v_job_ids is null or not (p_job_id = any (v_job_ids)) then
    raise exception 'job_not_found';
  end if;
  return query select v_uid, v_role, v_company.id, v_job_ids;
end;
$$;
revoke all on function public.company_cancellation_actor(uuid) from public, anon, authenticated, service_role;

-- Journées encore engagées de l'offre, par journée et par candidat, avec
-- la qualification calculée par la base à l'instant de la lecture.
--   state = cancellable : future, non commencée, non confirmée ;
--   state = begun       : début prévu atteint ou travail commencé →
--                         interruption (journée commencée) ou support.
-- Candidat : prénom et initiale seulement (colonnes de company_job_applicants).
create or replace function public.company_cancellation_preview(p_job_id uuid)
returns table (
  mission_day_id uuid,
  mission_id uuid,
  application_id uuid,
  job_id uuid,
  day_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  first_name text,
  last_initial text,
  state text,
  classification text,
  terms_source text,
  company_plan text,
  cancellation_notice_hours integer,
  deadline_at timestamptz,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select a.* into v_actor from public.company_cancellation_actor(p_job_id) a;
  return query
  select d.id, d.mission_id, m.application_id, m.job_id, d.scheduled_date,
         d.scheduled_start_time, d.scheduled_end_time, d.starts_at,
         cp.first_name::text, left(cp.last_name, 1)::text,
         case when d.actual_start_time is null and now() < d.starts_at
              then 'cancellable' else 'begun' end,
         k.classification, k.terms_source, k.company_plan, k.cancellation_notice_hours,
         k.deadline_at, now()
  from public.missions m
  join public.mission_days d on d.mission_id = m.id
  join public.job_applications a on a.id = m.application_id
  join public.candidate_profiles cp on cp.id = m.candidate_id
  cross join lateral public.company_cancellation_classify(d.id, now()) k
  where m.job_id = any (v_actor.job_ids)
    and m.status in ('pending', 'confirmed', 'in_progress')
    and a.status = 'selected'
    and d.completion_source is null
    and public.mission_day_cancelled_by(d.id) is null
  order by d.starts_at, cp.first_name, d.id;
end;
$$;
revoke all on function public.company_cancellation_preview(uuid) from public, anon;
grant execute on function public.company_cancellation_preview(uuid) to authenticated;

-- Demande d'annulation. p_day_ids : les journées de l'aperçu, pour des
-- dates entières (tous les candidats encore engagés ces jours-là ; pas de
-- retrait ciblé, ANN-08). p_acknowledge_late : l'entreprise a vu au moins
-- une journée qualifiée de tardive ; si la base en trouve une sans cet
-- accord (seuil franchi depuis l'aperçu), la demande est refusée sans
-- effet (late_not_acknowledged) et l'écran relit l'aperçu.
--
-- Verrous : missions (ordre des identifiants), puis journées, puis offres
-- en partage — même ordre que le désistement du candidat, le début et le
-- code (mission → journée) ; « Signer et sélectionner » prend la
-- candidature puis l'offre, jamais une mission existante.
create or replace function public.request_company_cancellation(
  p_request_id uuid,
  p_job_id uuid,
  p_day_ids uuid[],
  p_reason text,
  p_acknowledge_late boolean
)
returns table (
  cancellation_id uuid,
  day_count integer,
  date_count integer,
  candidate_count integer,
  in_time_count integer,
  late_count integer,
  legacy_count integer,
  created_at timestamptz,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_existing public.company_cancellations;
  v_ids uuid[];
  v_reason text := btrim(coalesce(p_reason, ''));
  v_mission record;
  v_day record;
  v_id uuid;
  v_created timestamptz;
  v_counts record;
  v_title text;
  v_user uuid;
  v_dates_fr text;
  v_dates_en text;
  v_first_mission uuid;
  v_users uuid[];
begin
  select a.* into v_actor from public.company_cancellation_actor(p_job_id) a;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_day_ids, '{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 1000 then
    raise exception 'days_invalid';
  end if;

  -- Relance : résultat d'origine, sans nouvelle écriture.
  select c.* into v_existing from public.company_cancellations c where c.request_id = p_request_id;
  if found then
    if v_existing.company_user_id <> v_actor.user_id or v_existing.job_id <> p_job_id
       or (select array_agg(cd.mission_day_id order by cd.mission_day_id)
           from public.company_cancellation_days cd where cd.cancellation_id = v_existing.id)
          is distinct from (select array_agg(x order by x) from unnest(v_ids) x) then
      raise exception 'request_conflict';
    end if;
    return query select v_existing.id, v_existing.day_count, v_existing.date_count,
      v_existing.candidate_count, v_existing.in_time_count, v_existing.late_count,
      v_existing.legacy_count, v_existing.created_at, true;
    return;
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'cancellation_reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'cancellation_reason_too_long';
  end if;

  for v_mission in
    select m.id, m.job_id, m.status, m.application_id
    from public.missions m
    where m.id in (select d.mission_id from public.mission_days d where d.id = any (v_ids))
    order by m.id
    for update
  loop
    if not (v_mission.job_id = any (v_actor.job_ids)) then
      raise exception 'days_invalid';
    end if;
    if v_mission.status not in ('pending', 'confirmed', 'in_progress')
       or (select a.status from public.job_applications a where a.id = v_mission.application_id)
          is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
  end loop;

  -- Concurrence : la même demande vient d'être enregistrée.
  select c.* into v_existing from public.company_cancellations c where c.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.day_count, v_existing.date_count,
      v_existing.candidate_count, v_existing.in_time_count, v_existing.late_count,
      v_existing.legacy_count, v_existing.created_at, true;
    return;
  end if;

  for v_day in
    select d.* from public.mission_days d where d.id = any (v_ids) order by d.id for update
  loop
    if public.mission_day_cancelled_by(v_day.id) is not null then
      raise exception 'day_already_cancelled';
    end if;
    if v_day.actual_start_time is not null or v_day.completion_source is not null then
      raise exception 'day_started';
    end if;
    if now() >= v_day.starts_at then
      raise exception 'day_already_begun';
    end if;
  end loop;
  if (select count(*) from public.mission_days d where d.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'days_invalid';
  end if;

  -- Offres en partage : une sélection concurrente est terminée avant le
  -- contrôle des dates entières, ou attend la fin de cette demande.
  perform 1 from public.jobs j where j.id = any (v_actor.job_ids) order by j.id for share;

  -- Dates entières : chaque journée encore annulable d'une date visée doit
  -- figurer dans la demande (aucun retrait ciblé d'un candidat).
  if exists (
    select 1
    from public.missions m
    join public.mission_days d on d.mission_id = m.id
    join public.job_applications a on a.id = m.application_id
    where m.job_id = any (v_actor.job_ids)
      and m.status in ('pending', 'confirmed', 'in_progress')
      and a.status = 'selected'
      and d.actual_start_time is null and d.completion_source is null
      and now() < d.starts_at
      and public.mission_day_cancelled_by(d.id) is null
      and not (d.id = any (v_ids))
      and (m.job_id, d.scheduled_date) in (
        select m2.job_id, d2.scheduled_date
        from public.mission_days d2 join public.missions m2 on m2.id = d2.mission_id
        where d2.id = any (v_ids))) then
    raise exception 'cancellation_preview_stale';
  end if;

  select count(*) filter (where k.classification = 'in_time') as in_time,
         count(*) filter (where k.classification = 'late') as late,
         count(*) filter (where k.classification = 'legacy') as legacy,
         count(distinct (m.job_id, d.scheduled_date)) as dates,
         count(distinct m.candidate_id) as candidates
  into v_counts
  from public.mission_days d
  join public.missions m on m.id = d.mission_id
  cross join lateral public.company_cancellation_classify(d.id, now()) k
  where d.id = any (v_ids);

  if v_counts.late > 0 and p_acknowledge_late is not true then
    raise exception 'late_not_acknowledged';
  end if;

  insert into public.company_cancellations (
    request_id, company_id, company_user_id, job_id, reason, day_count, date_count,
    candidate_count, in_time_count, late_count, legacy_count, notified_users)
  values (p_request_id, v_actor.company_id, v_actor.user_id, p_job_id, v_reason,
          cardinality(v_ids), v_counts.dates, v_counts.candidates,
          v_counts.in_time, v_counts.late, v_counts.legacy,
          -- Un avis par candidat concerné (un compte par profil candidat).
          v_counts.candidates)
  returning id, company_cancellations.created_at into v_id, v_created;

  insert into public.company_cancellation_days (
    mission_day_id, cancellation_id, mission_id, application_id, candidate_id, job_id,
    scheduled_date, starts_at, classification, terms_source, company_plan,
    cancellation_notice_hours, deadline_at)
  select d.id, v_id, d.mission_id, m.application_id, m.candidate_id, m.job_id,
         d.scheduled_date, d.starts_at, k.classification, k.terms_source, k.company_plan,
         k.cancellation_notice_hours, k.deadline_at
  from public.mission_days d
  join public.missions m on m.id = d.mission_id
  cross join lateral public.company_cancellation_classify(d.id, now()) k
  where d.id = any (v_ids);

  -- Mission dont il ne reste aucune journée à réaliser : annulée par
  -- l'entreprise. Candidature (« selected ») et contrat inchangés : aucune
  -- place n'est libérée, aucun recrutement rouvert.
  for v_mission in
    select distinct d.mission_id as id from public.mission_days d where d.id = any (v_ids)
  loop
    perform public.mission_close_if_interrupted(v_mission.id);
  end loop;

  -- Candidats prévenus, un avis chacun : offre et dates, sans motif, sans
  -- qualification ni plan. L'annulation ne leur est pas imputée.
  select j.title into v_title from public.jobs j where j.id = p_job_id;
  v_users := '{}';
  for v_user, v_first_mission, v_dates_fr, v_dates_en in
    select cp.user_id, (array_agg(d.mission_id order by d.starts_at))[1],
           string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI'), ', ' order by d.starts_at),
           string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI'), ', ' order by d.starts_at)
    from public.mission_days d
    join public.missions m on m.id = d.mission_id
    join public.candidate_profiles cp on cp.id = m.candidate_id
    where d.id = any (v_ids)
    group by cp.user_id
  loop
    v_users := v_users || v_user;
    perform public.incident_notify(v_user,
      'Journées annulées par l''entreprise', 'Days cancelled by the company',
      'L''entreprise a annulé « ' || v_title || ' » : ' || v_dates_fr
        || ' (heure de Douala). Cette annulation ne vous est pas imputée. Votre contrat et vos journées déjà confirmées sont conservés.',
      'The company cancelled "' || v_title || '": ' || v_dates_en
        || ' (Douala time). This cancellation is not held against you. Your contract and your already confirmed days are kept.',
      jsonb_build_object('kind', 'company_cancellation', 'cancellation_id', v_id,
                         'mission_id', v_first_mission, 'href', '/missions/' || v_first_mission));
  end loop;

  perform public.incident_notify(v_actor.user_id,
    'Annulation enregistrée', 'Cancellation recorded',
    'Votre annulation de « ' || v_title || ' » est enregistrée et les candidats concernés sont prévenus.',
    'Your cancellation of "' || v_title || '" is recorded and the candidates concerned have been notified.',
    jsonb_build_object('kind', 'company_cancellation', 'cancellation_id', v_id, 'job_id', p_job_id,
                       'href', '/company/jobs/' || p_job_id));

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_actor.user_id, v_actor.role, 'company_cancellation', 'jobs', p_job_id,
          jsonb_build_object('cancellation_id', v_id, 'company_id', v_actor.company_id,
                             'day_count', cardinality(v_ids), 'date_count', v_counts.dates,
                             'candidate_count', v_counts.candidates,
                             'in_time_count', v_counts.in_time, 'late_count', v_counts.late,
                             'legacy_count', v_counts.legacy,
                             'notified_users', cardinality(v_users)));

  return query select v_id, cardinality(v_ids), v_counts.dates::integer, v_counts.candidates::integer,
    v_counts.in_time::integer, v_counts.late::integer, v_counts.legacy::integer, v_created, false;
end;
$$;
revoke all on function public.request_company_cancellation(uuid, uuid, uuid[], text, boolean) from public, anon;
grant execute on function public.request_company_cancellation(uuid, uuid, uuid[], text, boolean) to authenticated;

-- Historique des annulations de l'offre, pour son entreprise : dates,
-- nombre de candidats, qualification et motif (le sien).
create or replace function public.my_company_cancellations(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select a.* into v_actor from public.company_cancellation_actor(p_job_id) a;
  return jsonb_build_object(
    'server_now', now(),
    'cancellations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'created_at', c.created_at, 'reason', c.reason,
               'day_count', c.day_count, 'date_count', c.date_count,
               'candidate_count', c.candidate_count, 'in_time_count', c.in_time_count,
               'late_count', c.late_count, 'legacy_count', c.legacy_count,
               'dates', (select jsonb_agg(distinct cd.scheduled_date)
                         from public.company_cancellation_days cd where cd.cancellation_id = c.id))
             order by c.created_at desc)
      from public.company_cancellations c
      where c.company_id = v_actor.company_id
        and c.job_id = any (v_actor.job_ids)), '[]'::jsonb));
end;
$$;
revoke all on function public.my_company_cancellations(uuid) from public, anon;
grant execute on function public.my_company_cancellations(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Signaux temps réel (domaines existants, charge utile {d, r})
-- ════════════════════════════════════════════════════════════════════
-- Journée annulée : parties de la mission (domaine missions) ; événement :
-- entreprise et administration.
drop trigger if exists trg_rt_company_cancellation_days on public.company_cancellation_days;
create trigger trg_rt_company_cancellation_days
  after insert on public.company_cancellation_days
  for each row execute function public.rt_on_mission_child();

create or replace function public.rt_on_company_cancellations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[new.company_user_id], 'missions', null);
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_company_cancellations() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_company_cancellations on public.company_cancellations;
create trigger trg_rt_company_cancellations
  after insert on public.company_cancellations
  for each row execute function public.rt_on_company_cancellations();

-- ════════════════════════════════════════════════════════════════════
-- 8. Calendrier d'un engagement figé pour tout auteur applicatif (ECH-02)
-- ════════════════════════════════════════════════════════════════════
-- Reprises de leur dernière définition. Les horaires d'une mission ou d'une
-- journée de mission sont ceux du contrat (copie du calendrier publié,
-- lui-même figé : job_schedule_locked). Aucun parcours ne les modifie : la
-- clé service est désormais refusée comme les sessions, avant comme après
-- le début (mission_schedule_locked). Restent possibles les fonctions de la
-- base (sync_single_mission_day) et la maintenance directe (postgres).
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
  if current_user = 'service_role' and (
       new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time
     ) is distinct from (
       old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time
     ) then
    raise exception 'mission_schedule_locked' using errcode = '42501';
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
    if current_user = 'service_role'
       and (new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time,
            new.starts_at, new.ends_at)
           is distinct from (old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time,
            old.starts_at, old.ends_at) then
      raise exception 'mission_schedule_locked' using errcode = '42501';
    end if;
    if new.mission_id is distinct from old.mission_id
       or (new.job_day_id is distinct from old.job_day_id and new.job_day_id is not null) then
      raise exception 'mission_days: mission is immutable' using errcode = '42501';
    end if;
    if old.actual_start_time is not null
       and new.actual_start_time is distinct from old.actual_start_time then
      raise exception 'mission_days: start already recorded' using errcode = '42501';
    end if;
    if old.actual_end_time is not null
       and (new.actual_end_time, new.completion_source)
           is distinct from (old.actual_end_time, old.completion_source) then
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

-- ════════════════════════════════════════════════════════════════════
-- 9. Motif : entreprise et administration seulement (décision du 2026-11-22)
-- ════════════════════════════════════════════════════════════════════
-- Lecture par un admin actif (is_admin_user exige is_active), sans écran à
-- ce jour. Jamais exposé aux candidats (avis, missions, journées).
create or replace function public.admin_company_cancellations(p_job_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user((select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'job_id', c.job_id, 'company_id', c.company_id,
             'created_at', c.created_at, 'reason', c.reason,
             'day_count', c.day_count, 'date_count', c.date_count,
             'candidate_count', c.candidate_count, 'in_time_count', c.in_time_count,
             'late_count', c.late_count, 'legacy_count', c.legacy_count,
             'notified_users', c.notified_users)
           order by c.created_at desc)
    from public.company_cancellations c
    where p_job_id is null or c.job_id = p_job_id), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_company_cancellations(uuid) from public, anon;
grant execute on function public.admin_company_cancellations(uuid) to authenticated;
