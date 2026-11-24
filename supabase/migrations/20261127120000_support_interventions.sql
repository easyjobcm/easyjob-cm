-- Migration : interventions du support sur les engagements (lot 17d-3)
-- Date : 2026-11-23 (date de rédaction ; l'horodatage ordonne seulement)
-- Tables affectées :
--   engagement_requests, engagement_request_days, support_cancellations,
--   support_cancellation_days, absence_findings, absence_finding_events
--   (nouvelles, fermées aux sessions et aux écritures de la clé service) ;
--   company_cancellations (colonnes de traçabilité du support) ;
--   case_evidence (type « absence_finding ») ; account_suspensions
--   (déclencheur de tâche) ; fonctions de 20261126120000 étendues à la
--   troisième origine d'annulation (support).
--
-- Décisions (docs/product/DECISIONS.md) : ANN-17, ANN-18, SAN-08, validées
-- par le « oui » de l'utilisateur du 2026-11-23 (proposition AUDIT §46),
-- précisées par son brief du même jour ; ANN-16, ANN-15, ANN-13, ANN-06,
-- ANN-04, ECH-09, ECH-02, ADM-04, DON-04.
--
--   1. Retrait ciblé (ANN-17) : demande tracée de l'entreprise (motif de 10
--      à 500 caractères, ANN-15) pour un candidat et des journées futures ;
--      décision motivée d'un admin_ops/admin_founder actif avant le début de
--      chaque journée retenue ; acceptation enregistrée comme annulation
--      PAR L'ENTREPRISE (company_cancellations, qualification ANN-06 sans
--      conséquence) ; candidat prévenu sans le motif.
--   2. Candidat suspendu (ANN-18) : toute suspension ouvre une tâche du
--      support listant les journées futures couvertes ; seul un
--      ops/fondateur actif les annule, sur suspension et journées
--      revérifiées à la décision (aucune annulation automatique) ;
--      troisième origine « support » ; entreprise prévenue « candidat
--      indisponible », sans cause ; une levée ne restaure rien.
--   3. Candidat suspendu : request_candidate_cancellation refusée
--      (account_suspended) ; « Demander l'annulation au support » ouvre une
--      demande traitée comme au point 2, sans manquement.
--   4. Constat d'absence injustifiée (SAN-08) : dossier distinct du lot 16 ;
--      instruction ouverte à tout admin actif, en parallèle ; aucun dossier
--      du lot 16 exigé ; décision bloquée pendant une contestation ouverte sur
--      la réalisation ; aucune absence injustifiée sur une journée confirmée,
--      partielle ou ambiguë (absence_realization_state) ; 72 h de réponse du
--      candidat à compter de la demande qui lui est adressée (ouverture du
--      constat) ; double validation par deux ops/fondateurs actifs
--      distincts ; recours de 7 jours (une partie, agent distinct des deux
--      validateurs).
--      AUCUN effet : ni reputation_incidents (aucun candidate_no_show), ni
--      exclusion, ni réputation, ni montant. Le constat n'est lu par aucun
--      calcul de sanction.
--
-- Invariants : aucune réouverture de place ni remplacement (ANN-14 non
-- étendu) ; journée commencée → parcours d'incident ou d'interruption ;
-- contrat, candidature, conditions figées, journées confirmées et montants
-- reconnus conservés ; disponibilité libérée selon ECH-09.
--
-- Rollback :
--   drop trigger trg_support_task_on_suspension on public.account_suspensions ;
--   recréer depuis 20261126120000 : mission_day_cancelled_by/at,
--     guard_single_day_cancellation, block_cancelled_mission_day,
--     block_incident_on_cancelled_day, mission_close_if_interrupted,
--     candidate_schedule_conflicts, company_job_cancellations,
--     protect_reputation_incidents ; request_candidate_cancellation depuis
--     20261122120000 ;
--   alter table public.company_cancellations drop column support_request_id,
--     drop column decided_by ;
--   remettre la contrainte de case_evidence (cancellation, fraud) ;
--   drop table public.absence_finding_events, public.absence_findings,
--     public.support_cancellation_days, public.support_cancellations,
--     public.engagement_request_days, public.engagement_requests ;
--   drop function … (fonctions créées ci-dessous, dont request_targeted_removal_review,
--     submit_absence_finding_element, admin_add_absence_finding_note, absence_finding_notify).

-- ════════════════════════════════════════════════════════════════════
-- 1. Demandes et tâches du support
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.engagement_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  kind text not null check (kind in ('targeted_removal', 'suspension_task', 'suspended_candidate')),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  company_id uuid references public.company_profiles(id) on delete cascade,
  company_user_id uuid references public.users(id) on delete cascade,
  suspension_id uuid references public.account_suspensions(id) on delete set null,
  requested_by uuid references public.users(id) on delete set null,
  reason text check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_role text,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 2000),
  cancellation_id uuid,
  -- Réexamen d'un refus de retrait ciblé : demande initiale conservée.
  reexamination_of uuid references public.engagement_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint engagement_requests_kind_chk check (
    (kind = 'targeted_removal'
       and job_id is not null and company_id is not null and company_user_id is not null
       and char_length(reason) between 10 and 500)
    or (kind <> 'targeted_removal' and job_id is null and company_id is null)),
  constraint engagement_requests_decision_chk check (
    (status = 'pending') = (decided_at is null)
    and (status = 'pending') = (decision_note is null)
    and (status = 'accepted') = (cancellation_id is not null))
);
create index if not exists idx_engagement_requests_status on public.engagement_requests (status, created_at);
-- Un refus donné ne produit qu'une demande de réexamen (contrôle serveur).
create unique index if not exists engagement_requests_reexam_key
  on public.engagement_requests (reexamination_of) where reexamination_of is not null;
create index if not exists idx_engagement_requests_job on public.engagement_requests (job_id);
create index if not exists idx_engagement_requests_candidate on public.engagement_requests (candidate_id);
-- Une tâche par suspension.
create unique index if not exists engagement_requests_task_key
  on public.engagement_requests (suspension_id) where kind = 'suspension_task';

create table if not exists public.engagement_request_days (
  engagement_request_id uuid not null references public.engagement_requests(id) on delete cascade,
  mission_day_id uuid not null references public.mission_days(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  starts_at timestamptz not null,
  primary key (engagement_request_id, mission_day_id)
);
create index if not exists idx_engagement_request_days_day on public.engagement_request_days (mission_day_id);

comment on table public.engagement_requests is
  'Lot 17d-3 : retrait ciblé demandé par l''entreprise (ANN-17), tâche ouverte par une suspension et demande d''un candidat suspendu (ANN-18). Décision par admin_ops/admin_founder actif ; aucune décision automatique.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Troisième origine d'annulation : le support (ANN-18)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.support_cancellations (
  id uuid primary key default gen_random_uuid(),
  engagement_request_id uuid not null unique references public.engagement_requests(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_role text not null,
  day_count integer not null check (day_count >= 1),
  created_at timestamptz not null default now()
);
create table if not exists public.support_cancellation_days (
  mission_day_id uuid primary key references public.mission_days(id) on delete cascade,
  cancellation_id uuid not null references public.support_cancellations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  starts_at timestamptz not null
);
create index if not exists idx_support_cancellation_days_mission on public.support_cancellation_days (mission_id);
create index if not exists idx_support_cancellation_days_cancellation on public.support_cancellation_days (cancellation_id);

-- Reprise de 20261126120000 : les cascades des nouvelles colonnes (compte
-- supprimé → SET NULL) restent possibles ; toute autre modification reste
-- refusée.
create or replace function public.protect_company_cancellation_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception '%: written by the database only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_company_cancellation_writes() from public, anon, authenticated, service_role;

-- Retrait ciblé accepté : annulation par l'entreprise, décidée par le support.
alter table public.company_cancellations
  add column if not exists support_request_id uuid references public.engagement_requests(id) on delete set null,
  add column if not exists decided_by uuid references public.users(id) on delete set null;

-- ════════════════════════════════════════════════════════════════════
-- 3. Constat d'absence injustifiée (SAN-08)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.absence_findings (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.mission_incidents(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  mission_day_id uuid not null references public.mission_days(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  company_user_id uuid not null references public.users(id) on delete cascade,
  opened_by uuid references public.users(id) on delete set null,
  opened_by_role text not null,
  opened_at timestamptz not null default now(),
  -- 72 h à compter de la notification d'ouverture adressée au candidat,
  -- créée dans la même transaction que le constat (jamais sa lecture).
  candidate_notification_id uuid references public.notifications(id) on delete set null,
  candidate_notified_at timestamptz not null,
  candidate_due_at timestamptz not null,
  candidate_statement text check (char_length(candidate_statement) between 10 and 2000),
  candidate_answered_at timestamptz,
  revision integer not null default 1,
  status text not null default 'instruction' check (status in ('instruction', 'proposed', 'decided')),
  proposed_outcome text check (proposed_outcome in ('established', 'not_established')),
  proposed_note text check (char_length(proposed_note) <= 2000),
  proposed_by uuid references public.users(id) on delete set null,
  proposed_at timestamptz,
  proposal_revision integer,
  outcome text check (outcome in ('established', 'not_established')),
  decision_note text check (char_length(decision_note) <= 2000),
  validated_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  -- 7 jours à compter de la notification de la décision au candidat, créée
  -- dans la même transaction.
  decision_notification_id uuid references public.notifications(id) on delete set null,
  decision_notified_at timestamptz,
  review_deadline timestamptz,
  review_requested_at timestamptz,
  review_party text check (review_party in ('candidate', 'company')),
  review_note text check (char_length(review_note) <= 2000),
  review_outcome text check (review_outcome in ('maintained', 'overturned')),
  review_decided_by uuid references public.users(id) on delete set null,
  review_decided_at timestamptz,
  review_decision_note text check (char_length(review_decision_note) <= 2000),
  updated_at timestamptz not null default now(),
  constraint absence_findings_state_chk check (
    (status = 'instruction' and proposed_outcome is null and outcome is null)
    or (status = 'proposed' and proposed_outcome is not null and outcome is null)
    or (status = 'decided' and outcome is not null and decided_at is not null
        and review_deadline is not null and decision_notified_at is not null
        and review_deadline = decision_notified_at + interval '7 days')),
  constraint absence_findings_due_chk check (candidate_due_at = candidate_notified_at + interval '72 hours')
);
create index if not exists idx_absence_findings_status on public.absence_findings (status, opened_at);
create index if not exists idx_absence_findings_candidate on public.absence_findings (candidate_id);

create table if not exists public.absence_finding_events (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.absence_findings(id) on delete cascade,
  kind text not null,
  actor_id uuid references public.users(id) on delete set null,
  actor_role text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_absence_finding_events_finding on public.absence_finding_events (finding_id, created_at);

comment on table public.absence_findings is
  'Lot 17d-3 (SAN-08) : constat d''absence injustifiée, distinct de la décision du lot 16 sur la réalisation du travail. Aucun effet : ni manquement (candidate_no_show), ni exclusion, ni réputation, ni montant ; lu par aucun calcul de sanction.';

alter table public.case_evidence drop constraint if exists case_evidence_case_type_check;
alter table public.case_evidence add constraint case_evidence_case_type_check
  check (case_type in ('cancellation', 'fraud', 'absence_finding'));

-- ════════════════════════════════════════════════════════════════════
-- 4. Fermeture et protection
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array['engagement_requests', 'engagement_request_days', 'support_cancellations',
                           'support_cancellation_days', 'absence_findings', 'absence_finding_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from service_role', t);
  end loop;
end $$;

-- Lignes en ajout seul, sauf les deux dossiers dont l'état avance par les
-- seules fonctions de la base (jamais par une session ni par la clé service).
create or replace function public.protect_support_intervention_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception '%: written by the database only', tg_table_name using errcode = '42501';
  end if;
  -- Cascade d'une clé étrangère (ON DELETE SET NULL, compte supprimé) :
  -- action de la base, déclencheur imbriqué.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and tg_table_name not in ('engagement_requests', 'absence_findings') then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'engagement_requests' then
    if old.status <> 'pending'
       or (to_jsonb(new) - array['status', 'decided_by', 'decided_by_role', 'decided_at',
                                 'decision_note', 'cancellation_id'])
          is distinct from
          (to_jsonb(old) - array['status', 'decided_by', 'decided_by_role', 'decided_at',
                                 'decision_note', 'cancellation_id']) then
      raise exception 'engagement_requests: only a single decision is allowed' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'absence_findings' then
    if (new.incident_id, new.mission_day_id, new.candidate_id, new.company_id, new.opened_at,
        new.opened_by, new.candidate_due_at, new.candidate_notified_at)
       is distinct from
       (old.incident_id, old.mission_day_id, old.candidate_id, old.company_id, old.opened_at,
        old.opened_by, old.candidate_due_at, old.candidate_notified_at)
       or new.revision < old.revision then
      raise exception 'absence_findings: identity is immutable' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_support_intervention_writes() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['engagement_requests', 'engagement_request_days', 'support_cancellations',
                           'support_cancellation_days', 'absence_findings', 'absence_finding_events'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_support_intervention_writes()', t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 5. Journée annulée : trois origines (reprises de 20261126120000)
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
    when exists (select 1 from public.support_cancellation_days x where x.mission_day_id = p_day_id)
      then 'support'
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
     where x.mission_day_id = p_day_id),
    (select c.created_at from public.support_cancellation_days x
     join public.support_cancellations c on c.id = x.cancellation_id
     where x.mission_day_id = p_day_id));
$$;
revoke all on function public.mission_day_cancelled_at(uuid) from public, anon, authenticated, service_role;

create or replace function public.guard_single_day_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_table_name <> 'candidate_cancellation_days'
      and exists (select 1 from public.candidate_cancellation_days x where x.mission_day_id = new.mission_day_id))
     or (tg_table_name <> 'company_cancellation_days'
      and exists (select 1 from public.company_cancellation_days x where x.mission_day_id = new.mission_day_id))
     or (tg_table_name <> 'support_cancellation_days'
      and exists (select 1 from public.support_cancellation_days x where x.mission_day_id = new.mission_day_id)) then
    raise exception 'day_already_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_single_day_cancellation() from public, anon, authenticated, service_role;
drop trigger if exists trg_guard_support_cancellation_day on public.support_cancellation_days;
create trigger trg_guard_support_cancellation_day
  before insert on public.support_cancellation_days
  for each row execute function public.guard_single_day_cancellation();

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
     and public.mission_day_cancelled_by(new.id) is not null then
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
  if public.mission_day_cancelled_by(new.mission_day_id) is not null then
    raise exception 'day_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.block_incident_on_cancelled_day() from public, anon, authenticated;

-- Auteur retenu : dernière annulation enregistrée ; le support est inscrit
-- « admin » (contrainte de missions.cancelled_by), motif support_cancellation.
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
     and not exists (select 1 from public.company_cancellation_days cd where cd.mission_id = p_mission_id)
     and not exists (select 1 from public.support_cancellation_days cd where cd.mission_id = p_mission_id) then
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
    where cd.mission_id = p_mission_id
    union all
    select 'support', c.created_at from public.support_cancellation_days cd
    join public.support_cancellations c on c.id = cd.cancellation_id
    where cd.mission_id = p_mission_id) x
  order by x.created_at desc, x.actor limit 1;
  update public.missions m
  set status = 'cancelled',
      cancelled_by = case v_by when 'support' then 'admin' else v_by end,
      cancellation_reason = v_by || case
        when exists (select 1 from public.mission_days d where d.mission_id = m.id
                     and public.completion_counts(d.completion_source))
        then '_cancellation_interrupted' else '_cancellation' end
  where m.id = p_mission_id;
  return true;
end;
$$;
revoke all on function public.mission_close_if_interrupted(uuid) from public, anon, authenticated;

-- ECH-09 : une journée annulée par le support libère aussi son créneau.
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
      and not exists (select 1 from public.support_cancellation_days x where x.mission_day_id = md.id)
      and tstzrange(md.starts_at - interval '3 hours', md.ends_at + interval '3 hours') && r.rng);
$$;
revoke all on function public.candidate_schedule_conflicts(uuid, tstzrange[]) from public, anon, authenticated;

-- Vue de l'entreprise : « support » = candidat indisponible (sans cause).
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
    where cd.job_id = p_job_id
    union all
    select cd.mission_id, cd.mission_day_id, c.created_at, 'support'::text, cd.starts_at
    from public.support_cancellation_days cd
    join public.support_cancellations c on c.id = cd.cancellation_id
    where cd.job_id = p_job_id) x
  order by x.starts_at;
end;
$$;
revoke all on function public.company_job_cancellations(uuid) from public, anon;
grant execute on function public.company_job_cancellations(uuid) to authenticated;

-- Aucune faute du candidat sur une journée annulée par l'entreprise ou par
-- le support (reprise de 20261126120000).
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
    if exists (select 1 from public.company_cancellation_days x
               join public.mission_days d on d.id = x.mission_day_id
               where x.mission_id = new.mission_id
                 and (d.starts_at = new.scheduled_start_at
                      or x.starts_at = new.scheduled_start_at)) then
      raise exception 'incident_conflicts_with_company_cancellation';
    end if;
    -- Lot 17d-3 : journée annulée par le support (candidat indisponible).
    if exists (select 1 from public.support_cancellation_days x
               join public.mission_days d on d.id = x.mission_day_id
               where x.mission_id = new.mission_id
                 and (d.starts_at = new.scheduled_start_at
                      or x.starts_at = new.scheduled_start_at)) then
      raise exception 'incident_conflicts_with_support_cancellation';
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
    if exists (select 1 from public.mission_days d
               where d.mission_id = new.mission_id
                 and public.completion_counts(d.completion_source)) then
      raise exception 'incident_conflicts_with_completion';
    end if;
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
-- 6. Outils communs
-- ════════════════════════════════════════════════════════════════════
-- Journée encore annulable par le support : future, non commencée, non
-- confirmée, non annulée, mission active et candidature sélectionnée.
create or replace function public.support_day_state(p_day_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when d.id is null then 'missing'
    when public.mission_day_cancelled_by(d.id) is not null then 'cancelled'
    when d.actual_start_time is not null or d.completion_source is not null then 'started'
    when now() >= d.starts_at then 'begun'
    when m.status not in ('pending', 'confirmed', 'in_progress')
         or a.status is distinct from 'selected' then 'inactive'
    else 'open' end
  from (select p_day_id as id) x
  left join public.mission_days d on d.id = x.id
  left join public.missions m on m.id = d.mission_id
  left join public.job_applications a on a.id = m.application_id;
$$;
revoke all on function public.support_day_state(uuid) from public, anon, authenticated, service_role;

-- Une suspension en cours couvre la journée (début avant la fin prévue).
create or replace function public.suspension_covers_day(p_user_id uuid, p_starts_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_suspensions s
    where s.user_id = p_user_id
      and public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now())
      and (s.ends_at is null or p_starts_at < s.ends_at));
$$;
revoke all on function public.suspension_covers_day(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.support_days_json(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'mission_day_id', rd.mission_day_id, 'mission_id', rd.mission_id, 'job_id', rd.job_id,
           'job_title', j.title, 'starts_at', d.starts_at, 'ends_at', d.ends_at,
           'date', d.scheduled_date, 'state', public.support_day_state(rd.mission_day_id))
           order by d.starts_at), '[]'::jsonb)
  from public.engagement_request_days rd
  join public.mission_days d on d.id = rd.mission_day_id
  join public.jobs j on j.id = rd.job_id
  where rd.engagement_request_id = p_request_id;
$$;
revoke all on function public.support_days_json(uuid) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 7. Retrait ciblé : demande de l'entreprise (ANN-17)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.request_targeted_removal(
  p_request_id uuid, p_job_id uuid, p_day_ids uuid[], p_reason text)
returns table (engagement_request_id uuid, status text, day_count integer, already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_ids uuid[];
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.engagement_requests;
  v_candidate uuid;
  v_candidate_user uuid;
  v_day record;
  v_id uuid;
begin
  select a.* into v_actor from public.company_cancellation_actor(p_job_id) a;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_day_ids, '{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 31 then
    raise exception 'days_invalid';
  end if;

  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    if v_existing.kind <> 'targeted_removal' or v_existing.company_user_id <> v_actor.user_id
       or (select array_agg(rd.mission_day_id order by rd.mission_day_id)
           from public.engagement_request_days rd where rd.engagement_request_id = v_existing.id)
          is distinct from (select array_agg(x order by x) from unnest(v_ids) x) then
      raise exception 'request_conflict';
    end if;
    return query select v_existing.id, v_existing.status, cardinality(v_ids), true;
    return;
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'cancellation_reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'cancellation_reason_too_long';
  end if;

  -- Verrous : journées (une seule demande en attente par journée).
  for v_day in
    select d.id, d.starts_at, m.id as mission_id, m.job_id, m.candidate_id
    from public.mission_days d join public.missions m on m.id = d.mission_id
    where d.id = any (v_ids) order by d.id for update of d
  loop
    if not (v_day.job_id = any (v_actor.job_ids)) then
      raise exception 'days_invalid';
    end if;
    if v_candidate is null then
      v_candidate := v_day.candidate_id;
    elsif v_candidate <> v_day.candidate_id then
      raise exception 'days_invalid';
    end if;
    case public.support_day_state(v_day.id)
      when 'cancelled' then raise exception 'day_already_cancelled';
      when 'started' then raise exception 'day_started';
      when 'begun' then raise exception 'day_already_begun';
      when 'inactive' then raise exception 'mission_not_active';
      else null;
    end case;
    if exists (select 1 from public.engagement_request_days rd
               join public.engagement_requests r on r.id = rd.engagement_request_id
               where rd.mission_day_id = v_day.id and r.kind = 'targeted_removal'
                 and r.status = 'pending') then
      raise exception 'removal_already_requested';
    end if;
  end loop;
  if v_candidate is null
     or (select count(*) from public.mission_days d where d.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'days_invalid';
  end if;

  -- Même demande envoyée deux fois en parallèle : résultat d'origine.
  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.status, cardinality(v_ids), true;
    return;
  end if;

  select cp.user_id into v_candidate_user from public.candidate_profiles cp where cp.id = v_candidate;
  insert into public.engagement_requests (request_id, kind, candidate_id, candidate_user_id, job_id,
    company_id, company_user_id, requested_by, reason)
  values (p_request_id, 'targeted_removal', v_candidate, v_candidate_user, p_job_id,
          v_actor.company_id, v_actor.user_id, v_actor.user_id, v_reason)
  returning id into v_id;
  insert into public.engagement_request_days (engagement_request_id, mission_day_id, mission_id, job_id, starts_at)
  select v_id, d.id, d.mission_id, m.job_id, d.starts_at
  from public.mission_days d join public.missions m on m.id = d.mission_id where d.id = any (v_ids);

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_actor.user_id, v_actor.role, 'request_targeted_removal', 'engagement_requests', v_id,
          jsonb_build_object('job_id', p_job_id, 'day_count', cardinality(v_ids)));
  return query select v_id, 'pending'::text, cardinality(v_ids), false;
end;
$$;
revoke all on function public.request_targeted_removal(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.request_targeted_removal(uuid, uuid, uuid[], text) to authenticated;

-- Réexamen motivé d'un refus de retrait ciblé (décision du 2026-11-24) :
-- nouvelle demande liée à la demande refusée (conservée avec son refus),
-- sur ses journées encore annulables ; aucune annulation automatique ; même
-- décision que toute demande (ops ou fondateur actif, avant le début).
-- Aucune condition d'agent distinct ni aucun délai propre.
create or replace function public.request_targeted_removal_review(
  p_request_id uuid, p_original_id uuid, p_reason text)
returns table (engagement_request_id uuid, status text, day_count integer, already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig public.engagement_requests;
  v_actor record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.engagement_requests;
  v_ids uuid[];
  v_day record;
  v_id uuid;
begin
  -- Demande refusée verrouillée : deux réexamens simultanés du même refus
  -- s'attendent ; le second trouve le premier.
  select r.* into v_orig from public.engagement_requests r where r.id = p_original_id for update;
  if not found or v_orig.kind <> 'targeted_removal' then
    raise exception 'request_not_found';
  end if;
  select a.* into v_actor from public.company_cancellation_actor(v_orig.job_id) a;
  if v_orig.company_id <> v_actor.company_id then
    raise exception 'request_not_found';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    if v_existing.reexamination_of is distinct from p_original_id
       or v_existing.company_user_id <> v_actor.user_id then
      raise exception 'request_conflict';
    end if;
    return query select v_existing.id, v_existing.status,
      (select count(*)::integer from public.engagement_request_days rd
       where rd.engagement_request_id = v_existing.id), true;
    return;
  end if;
  if v_orig.status <> 'refused' then
    raise exception 'request_not_refused';
  end if;
  if exists (select 1 from public.engagement_requests r where r.reexamination_of = v_orig.id) then
    raise exception 'reexamination_exists';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'cancellation_reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'cancellation_reason_too_long';
  end if;

  for v_day in
    select d.id from public.engagement_request_days rd
    join public.mission_days d on d.id = rd.mission_day_id
    where rd.engagement_request_id = v_orig.id order by d.id for update of d
  loop
    if public.support_day_state(v_day.id) = 'open' then
      if exists (select 1 from public.engagement_request_days x
                 join public.engagement_requests r on r.id = x.engagement_request_id
                 where x.mission_day_id = v_day.id and r.kind = 'targeted_removal'
                   and r.status = 'pending') then
        raise exception 'removal_already_requested';
      end if;
      v_ids := array_append(v_ids, v_day.id);
    end if;
  end loop;
  -- Toutes les journées ont commencé, sont annulées ou inactives.
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'day_already_begun';
  end if;

  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.status, cardinality(v_ids), true;
    return;
  end if;

  insert into public.engagement_requests (request_id, kind, candidate_id, candidate_user_id, job_id,
    company_id, company_user_id, requested_by, reason, reexamination_of)
  values (p_request_id, 'targeted_removal', v_orig.candidate_id, v_orig.candidate_user_id, v_orig.job_id,
          v_orig.company_id, v_orig.company_user_id, v_actor.user_id, v_reason, v_orig.id)
  returning id into v_id;
  insert into public.engagement_request_days (engagement_request_id, mission_day_id, mission_id, job_id, starts_at)
  select v_id, d.id, d.mission_id, m.job_id, d.starts_at
  from public.mission_days d join public.missions m on m.id = d.mission_id where d.id = any (v_ids);
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_actor.user_id, v_actor.role, 'request_targeted_removal_review', 'engagement_requests', v_id,
          jsonb_build_object('reexamination_of', v_orig.id, 'day_count', cardinality(v_ids)));
  return query select v_id, 'pending'::text, cardinality(v_ids), false;
end;
$$;
revoke all on function public.request_targeted_removal_review(uuid, uuid, text) from public, anon;
grant execute on function public.request_targeted_removal_review(uuid, uuid, text) to authenticated;

-- Demandes de l'offre, pour son entreprise (motif et décision du support).
create or replace function public.my_targeted_removals(p_job_id uuid)
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
  return jsonb_build_object('server_now', now(), 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at,
             'decided_at', r.decided_at, 'decision_note', r.decision_note,
             'candidate_id', r.candidate_id, 'reexamination_of', r.reexamination_of,
             'days', (select jsonb_agg(jsonb_build_object('mission_day_id', rd.mission_day_id,
                               'starts_at', rd.starts_at) order by rd.starts_at)
                      from public.engagement_request_days rd where rd.engagement_request_id = r.id))
           order by r.created_at desc)
    from public.engagement_requests r
    where r.kind = 'targeted_removal' and r.company_id = v_actor.company_id
      and r.job_id = any (v_actor.job_ids)), '[]'::jsonb));
end;
$$;
revoke all on function public.my_targeted_removals(uuid) from public, anon;
grant execute on function public.my_targeted_removals(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Candidat suspendu : tâche ouverte et demande au support (ANN-18)
-- ════════════════════════════════════════════════════════════════════
-- Toute suspension d'un candidat ayant des journées futures couvertes ouvre
-- une tâche, sans rien annuler.
create or replace function public.support_task_on_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_id uuid;
begin
  select cp.id into v_profile from public.candidate_profiles cp where cp.user_id = new.user_id;
  if v_profile is null then
    return null;
  end if;
  if not exists (
    select 1 from public.mission_days d join public.missions m on m.id = d.mission_id
    where m.candidate_id = v_profile and public.support_day_state(d.id) = 'open'
      and (new.ends_at is null or d.starts_at < new.ends_at)) then
    return null;
  end if;
  insert into public.engagement_requests (request_id, kind, candidate_id, candidate_user_id,
    suspension_id, requested_by)
  values (gen_random_uuid(), 'suspension_task', v_profile, new.user_id, new.id, new.decided_by)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.engagement_request_days (engagement_request_id, mission_day_id, mission_id, job_id, starts_at)
    select v_id, d.id, d.mission_id, m.job_id, d.starts_at
    from public.mission_days d join public.missions m on m.id = d.mission_id
    where m.candidate_id = v_profile and public.support_day_state(d.id) = 'open'
      and (new.ends_at is null or d.starts_at < new.ends_at);
  end if;
  return null;
end;
$$;
revoke all on function public.support_task_on_suspension() from public, anon, authenticated, service_role;
drop trigger if exists trg_support_task_on_suspension on public.account_suspensions;
create trigger trg_support_task_on_suspension
  after insert on public.account_suspensions
  for each row execute function public.support_task_on_suspension();

-- Journées que le candidat suspendu peut demander d'annuler.
create or replace function public.support_cancellation_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select cp.id into v_profile from public.candidate_profiles cp where cp.user_id = v_uid;
  if v_profile is null then
    raise exception 'mission_not_found';
  end if;
  return jsonb_build_object(
    'suspended', exists (select 1 from public.account_suspensions s where s.user_id = v_uid
                         and public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now())),
    'server_now', now(),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('mission_day_id', d.id, 'mission_id', d.mission_id,
               'job_title', j.title, 'starts_at', d.starts_at, 'ends_at', d.ends_at,
               'date', d.scheduled_date,
               'requested', exists (select 1 from public.engagement_request_days rd
                                    join public.engagement_requests r on r.id = rd.engagement_request_id
                                    where rd.mission_day_id = d.id and r.kind = 'suspended_candidate'
                                      and r.status = 'pending'))
             order by d.starts_at)
      from public.mission_days d join public.missions m on m.id = d.mission_id
      join public.jobs j on j.id = m.job_id
      where m.candidate_id = v_profile and public.support_day_state(d.id) = 'open'
        and public.suspension_covers_day(v_uid, d.starts_at)), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at,
               'decided_at', r.decided_at, 'decision_note', r.decision_note,
               'days', public.support_days_json(r.id)) order by r.created_at desc)
      from public.engagement_requests r
      where r.kind = 'suspended_candidate' and r.candidate_user_id = v_uid), '[]'::jsonb));
end;
$$;
revoke all on function public.support_cancellation_preview() from public, anon;
grant execute on function public.support_cancellation_preview() to authenticated;

create or replace function public.request_support_cancellation(
  p_request_id uuid, p_day_ids uuid[], p_message text)
returns table (engagement_request_id uuid, status text, day_count integer, already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile uuid;
  v_ids uuid[];
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_existing public.engagement_requests;
  v_suspension uuid;
  v_day record;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select cp.id into v_profile from public.candidate_profiles cp where cp.user_id = v_uid;
  if v_profile is null then
    raise exception 'mission_not_found';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_day_ids, '{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 31 then
    raise exception 'days_invalid';
  end if;
  if char_length(v_message) > 1000 then
    raise exception 'note_invalid';
  end if;

  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    if v_existing.kind <> 'suspended_candidate' or v_existing.candidate_user_id <> v_uid
       or (select array_agg(rd.mission_day_id order by rd.mission_day_id)
           from public.engagement_request_days rd where rd.engagement_request_id = v_existing.id)
          is distinct from (select array_agg(x order by x) from unnest(v_ids) x) then
      raise exception 'request_conflict';
    end if;
    return query select v_existing.id, v_existing.status, cardinality(v_ids), true;
    return;
  end if;

  -- Réservé au candidat suspendu ; les autres gardent le désistement (17b).
  select s.id into v_suspension from public.account_suspensions s
  where s.user_id = v_uid
    and public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now())
  order by s.starts_at desc limit 1;
  if v_suspension is null then
    raise exception 'suspension_not_active';
  end if;

  for v_day in
    select d.id, d.starts_at, m.candidate_id
    from public.mission_days d join public.missions m on m.id = d.mission_id
    where d.id = any (v_ids) order by d.id for update of d
  loop
    if v_day.candidate_id <> v_profile then
      raise exception 'mission_not_found';
    end if;
    case public.support_day_state(v_day.id)
      when 'cancelled' then raise exception 'day_already_cancelled';
      when 'started' then raise exception 'day_started';
      when 'begun' then raise exception 'day_already_begun';
      when 'inactive' then raise exception 'mission_not_active';
      else null;
    end case;
    if not public.suspension_covers_day(v_uid, v_day.starts_at) then
      raise exception 'day_not_covered';
    end if;
    if exists (select 1 from public.engagement_request_days rd
               join public.engagement_requests r on r.id = rd.engagement_request_id
               where rd.mission_day_id = v_day.id and r.kind = 'suspended_candidate'
                 and r.status = 'pending') then
      raise exception 'removal_already_requested';
    end if;
  end loop;
  if (select count(*) from public.mission_days d where d.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'days_invalid';
  end if;

  select r.* into v_existing from public.engagement_requests r where r.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.status, cardinality(v_ids), true;
    return;
  end if;

  insert into public.engagement_requests (request_id, kind, candidate_id, candidate_user_id,
    suspension_id, requested_by, reason)
  values (p_request_id, 'suspended_candidate', v_profile, v_uid, v_suspension, v_uid, v_message)
  returning id into v_id;
  insert into public.engagement_request_days (engagement_request_id, mission_day_id, mission_id, job_id, starts_at)
  select v_id, d.id, d.mission_id, m.job_id, d.starts_at
  from public.mission_days d join public.missions m on m.id = d.mission_id where d.id = any (v_ids);
  return query select v_id, 'pending'::text, cardinality(v_ids), false;
end;
$$;
revoke all on function public.request_support_cancellation(uuid, uuid[], text) from public, anon;
grant execute on function public.request_support_cancellation(uuid, uuid[], text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 9. Décision du support (ops ou fondateur actif)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_decide_engagement_request(
  p_id uuid, p_decision text, p_day_ids uuid[], p_note text)
returns table (engagement_request_id uuid, status text, cancellation_id uuid, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  r public.engagement_requests;
  v_ids uuid[];
  v_day record;
  v_cancel uuid;
  v_counts record;
  v_title text;
  v_dates_fr text;
  v_dates_en text;
  v_first_mission uuid;
  v_company_user uuid;
  v_job uuid;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_decision is null or p_decision not in ('accept', 'refuse') then
    raise exception 'decision_invalid';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_day_ids, '{}'::uuid[])) x where x is not null;

  select x.* into r from public.engagement_requests x where x.id = p_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status <> 'pending' then
    -- Relance de la même décision : résultat d'origine.
    if r.status = (case p_decision when 'accept' then 'accepted' else 'refused' end)
       and (p_decision = 'refuse' or
            (select array_agg(x order by x) from (
               select d.mission_day_id as x from public.company_cancellation_days d
               join public.company_cancellations c on c.id = d.cancellation_id where c.id = r.cancellation_id
               union all
               select d.mission_day_id from public.support_cancellation_days d
               where d.cancellation_id = r.cancellation_id) y)
            is not distinct from (select array_agg(x order by x) from unnest(v_ids) x)) then
      return query select r.id, r.status, r.cancellation_id, true;
      return;
    end if;
    raise exception 'request_already_decided';
  end if;

  if p_decision = 'refuse' then
    update public.engagement_requests x
    set status = 'refused', decided_by = v_uid, decided_by_role = v_role, decided_at = now(),
        decision_note = v_note
    where x.id = r.id;
    if r.kind = 'targeted_removal' then
      perform public.incident_notify(r.company_user_id, 'Demande de retrait refusée', 'Removal request declined',
        'Le support a refusé votre demande de retrait d''un candidat. L''engagement est maintenu.',
        'Support declined your request to remove a candidate. The engagement is kept.',
        jsonb_build_object('kind', 'targeted_removal', 'request_id', r.id, 'job_id', r.job_id,
                           'href', '/company/jobs/' || r.job_id));
    elsif r.kind = 'suspended_candidate' then
      perform public.incident_notify(r.candidate_user_id, 'Demande d''annulation refusée', 'Cancellation request declined',
        'Le support a examiné votre demande : vos journées sont maintenues.',
        'Support reviewed your request: your days are kept.',
        jsonb_build_object('kind', 'support_cancellation', 'request_id', r.id));
    end if;
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    values (v_uid, v_role, 'decide_engagement_request', 'engagement_requests', r.id,
            jsonb_build_object('kind', r.kind, 'decision', 'refuse'));
    return query select r.id, 'refused'::text, null::uuid, false;
    return;
  end if;

  -- Acceptation : journées choisies parmi celles de la demande.
  if coalesce(cardinality(v_ids), 0) = 0
     or exists (select 1 from unnest(v_ids) x
                where not exists (select 1 from public.engagement_request_days rd
                                  where rd.engagement_request_id = r.id and rd.mission_day_id = x)) then
    raise exception 'days_invalid';
  end if;

  -- Verrous : missions (ordre des identifiants), puis journées.
  perform 1 from public.missions m
  where m.id in (select d.mission_id from public.mission_days d where d.id = any (v_ids))
  order by m.id for update;
  for v_day in
    select d.* from public.mission_days d where d.id = any (v_ids) order by d.id for update
  loop
    case public.support_day_state(v_day.id)
      when 'cancelled' then raise exception 'day_already_cancelled';
      when 'started' then raise exception 'day_started';
      when 'begun' then raise exception 'day_already_begun';
      when 'inactive' then raise exception 'mission_not_active';
      when 'missing' then raise exception 'days_invalid';
      else null;
    end case;
    if r.kind <> 'targeted_removal' then
      if (select u.is_active from public.users u where u.id = r.candidate_user_id) is not false
         or not exists (select 1 from public.account_suspensions s where s.user_id = r.candidate_user_id
                        and public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now())) then
        raise exception 'suspension_not_active';
      end if;
      if not public.suspension_covers_day(r.candidate_user_id, v_day.starts_at) then
        raise exception 'day_not_covered';
      end if;
    end if;
  end loop;

  if r.kind = 'targeted_removal' then
    -- Annulation par l'entreprise (ANN-17), qualification ANN-06 figée.
    select count(*) filter (where k.classification = 'in_time') as in_time,
           count(*) filter (where k.classification = 'late') as late,
           count(*) filter (where k.classification = 'legacy') as legacy,
           count(distinct (m.job_id, d.scheduled_date)) as dates
    into v_counts
    from public.mission_days d join public.missions m on m.id = d.mission_id
    cross join lateral public.company_cancellation_classify(d.id, now()) k
    where d.id = any (v_ids);
    insert into public.company_cancellations (request_id, company_id, company_user_id, job_id, reason,
      day_count, date_count, candidate_count, in_time_count, late_count, legacy_count, notified_users,
      support_request_id, decided_by)
    values (r.request_id, r.company_id, r.company_user_id, r.job_id, r.reason,
            cardinality(v_ids), v_counts.dates, 1, v_counts.in_time, v_counts.late, v_counts.legacy, 1,
            r.id, v_uid)
    returning id into v_cancel;
    insert into public.company_cancellation_days (mission_day_id, cancellation_id, mission_id,
      application_id, candidate_id, job_id, scheduled_date, starts_at, classification, terms_source,
      company_plan, cancellation_notice_hours, deadline_at)
    select d.id, v_cancel, d.mission_id, m.application_id, m.candidate_id, m.job_id, d.scheduled_date,
           d.starts_at, k.classification, k.terms_source, k.company_plan, k.cancellation_notice_hours,
           k.deadline_at
    from public.mission_days d join public.missions m on m.id = d.mission_id
    cross join lateral public.company_cancellation_classify(d.id, now()) k
    where d.id = any (v_ids);
  else
    insert into public.support_cancellations (engagement_request_id, candidate_id, candidate_user_id,
      decided_by, decided_by_role, day_count)
    values (r.id, r.candidate_id, r.candidate_user_id, v_uid, v_role, cardinality(v_ids))
    returning id into v_cancel;
    insert into public.support_cancellation_days (mission_day_id, cancellation_id, mission_id, job_id, starts_at)
    select d.id, v_cancel, d.mission_id, m.job_id, d.starts_at
    from public.mission_days d join public.missions m on m.id = d.mission_id where d.id = any (v_ids);
  end if;

  perform public.mission_close_if_interrupted(x.mission_id)
  from (select distinct d.mission_id from public.mission_days d where d.id = any (v_ids)) x;

  update public.engagement_requests x
  set status = 'accepted', decided_by = v_uid, decided_by_role = v_role, decided_at = now(),
      decision_note = v_note, cancellation_id = v_cancel
  where x.id = r.id;

  -- Candidat : dates, sans le motif de l'entreprise ni la cause interne.
  select string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI'), ', ' order by d.starts_at),
         string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI'), ', ' order by d.starts_at),
         (array_agg(d.mission_id order by d.starts_at))[1]
  into v_dates_fr, v_dates_en, v_first_mission
  from public.mission_days d where d.id = any (v_ids);
  if r.kind = 'targeted_removal' then
    select j.title into v_title from public.jobs j where j.id = r.job_id;
    perform public.incident_notify(r.candidate_user_id,
      'Journées annulées par l''entreprise', 'Days cancelled by the company',
      'L''entreprise a annulé votre participation à « ' || v_title || ' » : ' || v_dates_fr
        || ' (heure de Douala). Cette annulation ne vous est pas imputée. Votre contrat et vos journées déjà confirmées sont conservés.',
      'The company cancelled your participation in "' || v_title || '": ' || v_dates_en
        || ' (Douala time). This cancellation is not held against you. Your contract and your already confirmed days are kept.',
      jsonb_build_object('kind', 'company_cancellation', 'cancellation_id', v_cancel,
                         'mission_id', v_first_mission, 'href', '/missions/' || v_first_mission));
    perform public.incident_notify(r.company_user_id, 'Retrait accepté', 'Removal accepted',
      'Le support a accepté votre demande de retrait pour « ' || v_title || ' » : ' || v_dates_fr || ' (heure de Douala).',
      'Support accepted your removal request for "' || v_title || '": ' || v_dates_en || ' (Douala time).',
      jsonb_build_object('kind', 'targeted_removal', 'request_id', r.id, 'job_id', r.job_id,
                         'href', '/company/jobs/' || r.job_id));
  else
    perform public.incident_notify(r.candidate_user_id,
      'Journées annulées par le support', 'Days cancelled by support',
      'Le support a annulé vos journées : ' || v_dates_fr
        || ' (heure de Douala). Aucun manquement n''est retenu pour ces annulations.',
      'Support cancelled your days: ' || v_dates_en
        || ' (Douala time). No breach is recorded for these cancellations.',
      jsonb_build_object('kind', 'support_cancellation', 'cancellation_id', v_cancel,
                         'mission_id', v_first_mission));
    -- Entreprises : « candidat indisponible », sans cause (DON-04).
    for v_job, v_company_user, v_title, v_dates_fr, v_dates_en in
      select j.id, cp.user_id, j.title,
             string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI'), ', ' order by d.starts_at),
             string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI'), ', ' order by d.starts_at)
      from public.mission_days d join public.missions m on m.id = d.mission_id
      join public.jobs j on j.id = m.job_id join public.company_profiles cp on cp.id = j.company_id
      where d.id = any (v_ids)
      group by j.id, cp.user_id, j.title
    loop
      perform public.incident_notify(v_company_user, 'Candidat indisponible', 'Candidate unavailable',
        'Un candidat sélectionné pour « ' || v_title || ' » n''est plus disponible : ' || v_dates_fr
          || ' (heure de Douala). Ces journées sont annulées.',
        'A candidate selected for "' || v_title || '" is no longer available: ' || v_dates_en
          || ' (Douala time). These days are cancelled.',
        jsonb_build_object('kind', 'support_cancellation', 'job_id', v_job, 'href', '/company/jobs/' || v_job));
    end loop;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'decide_engagement_request', 'engagement_requests', r.id,
          jsonb_build_object('kind', r.kind, 'decision', 'accept', 'cancellation_id', v_cancel,
                             'day_count', cardinality(v_ids)));
  return query select r.id, 'accepted'::text, v_cancel, false;
end;
$$;
revoke all on function public.admin_decide_engagement_request(uuid, text, uuid[], text) from public, anon;
grant execute on function public.admin_decide_engagement_request(uuid, text, uuid[], text) to authenticated;

-- File du support (tout admin actif : instruction et lecture). La cause de
-- la suspension est visible ici seulement.
create or replace function public.admin_engagement_requests(p_status text default null)
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
  return jsonb_build_object('server_now', now(), 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'status', r.status, 'created_at', r.created_at,
             'reason', r.reason, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
             'decided_by_role', r.decided_by_role, 'job_id', r.job_id,
             'reexamination_of', r.reexamination_of,
             'job_title', (select j.title from public.jobs j where j.id = r.job_id),
             'company_name', (select cp.company_name from public.company_profiles cp where cp.id = r.company_id),
             'candidate_id', r.candidate_id,
             'candidate_name', (select cp.first_name || ' ' || left(cp.last_name, 1) || '.'
                                from public.candidate_profiles cp where cp.id = r.candidate_id),
             'suspension', (select jsonb_build_object('id', s.id, 'cause', s.cause, 'ends_at', s.ends_at,
                                     'active', public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now()))
                            from public.account_suspensions s where s.id = r.suspension_id),
             'candidate_suspended', (select u.is_active is false from public.users u where u.id = r.candidate_user_id),
             'days', public.support_days_json(r.id))
           order by (r.status = 'pending') desc, r.created_at)
    from public.engagement_requests r
    where p_status is null or r.status = p_status), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_engagement_requests(text) from public, anon;
grant execute on function public.admin_engagement_requests(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Désistement d'un candidat suspendu fermé en base (point 3)
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261122120000 avec un seul ajout : compte suspendu →
-- account_suspended, après la relance d'une demande déjà enregistrée.
create or replace function public.request_candidate_cancellation(p_request_id uuid, p_day_ids uuid[], p_reason_code text, p_reason_text text, p_evidence_choice text)
 RETURNS TABLE(cancellation_id uuid, status text, late_day_count integer, day_count integer, already_recorded boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid uuid := auth.uid();
  v_profile uuid;
  v_existing public.candidate_cancellations;
  v_ids uuid[];
  v_job uuid;
  v_mission record;
  v_day record;
  v_class record;
  v_late integer := 0;
  v_status text;
  v_id uuid;
  v_reason_text text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_company_user uuid;
  v_title text;
  v_dates_fr text;
  v_dates_en text;
  v_first_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  select cp.id, cp.first_name into v_profile, v_first_name
  from public.candidate_profiles cp where cp.user_id = v_uid;
  if v_profile is null then
    raise exception 'mission_not_found';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_day_ids, '{}'::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 31 then
    raise exception 'days_invalid';
  end if;

  -- Relance : résultat d'origine.
  select c.* into v_existing from public.candidate_cancellations c where c.request_id = p_request_id;
  if found then
    if v_existing.candidate_user_id <> v_uid
       or (select array_agg(cd.mission_day_id order by cd.mission_day_id)
           from public.candidate_cancellation_days cd where cd.cancellation_id = v_existing.id)
          is distinct from (select array_agg(x order by x) from unnest(v_ids) x) then
      raise exception 'request_conflict';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.late_day_count,
      v_existing.day_count, true;
    return;
  end if;

  -- Lot 17d-3 : compte suspendu → demande au support (request_support_cancellation),
  -- jamais un désistement qualifié ni sanctionné.
  if (select u.is_active from public.users u where u.id = v_uid) is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  -- Verrous : missions (ordre des identifiants), puis journées — même
  -- ordre que le début, le code et la confirmation par le support.
  for v_mission in
    select m.id, m.job_id, m.candidate_id, m.status, m.application_id
    from public.missions m
    where m.id in (select d.mission_id from public.mission_days d where d.id = any (v_ids))
    order by m.id
    for update
  loop
    if v_mission.candidate_id <> v_profile then
      raise exception 'mission_not_found';
    end if;
    if v_job is null then
      v_job := v_mission.job_id;
    elsif v_job <> v_mission.job_id then
      raise exception 'days_invalid';
    end if;
    if v_mission.status not in ('pending', 'confirmed', 'in_progress')
       or (select a.status from public.job_applications a where a.id = v_mission.application_id)
          is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
  end loop;
  if v_job is null then
    raise exception 'days_invalid';
  end if;

  -- Concurrence : une autre demande vient d'être enregistrée.
  select c.* into v_existing from public.candidate_cancellations c where c.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.status, v_existing.late_day_count,
      v_existing.day_count, true;
    return;
  end if;

  for v_day in
    select d.* from public.mission_days d where d.id = any (v_ids) order by d.id for update
  loop
    if exists (select 1 from public.candidate_cancellation_days cd where cd.mission_day_id = v_day.id) then
      raise exception 'day_already_cancelled';
    end if;
    if v_day.actual_start_time is not null or public.completion_counts(v_day.completion_source) then
      raise exception 'day_started';
    end if;
    if now() >= v_day.starts_at then
      raise exception 'day_already_begun';
    end if;
  end loop;
  if (select count(*) from public.mission_days d where d.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'days_invalid';
  end if;

  select count(*) into v_late
  from unnest(v_ids) x cross join lateral public.classify_cancellation_day(x, now()) k
  where k.classification = 'late';

  if v_late > 0 then
    if p_reason_code is null or p_reason_code not in ('illness', 'family_emergency', 'transport',
                                                      'late_notification', 'other') then
      raise exception 'reason_required';
    end if;
    if p_evidence_choice is null or p_evidence_choice not in ('provided', 'none') then
      raise exception 'evidence_choice_required';
    end if;
    v_status := case p_evidence_choice when 'none' then 'sanctioned_no_evidence' else 'awaiting_evidence' end;
  else
    if p_reason_code is not null and p_reason_code not in ('illness', 'family_emergency', 'transport',
                                                           'late_notification', 'other') then
      raise exception 'reason_required';
    end if;
    v_status := 'closed_no_sanction';
  end if;
  if char_length(v_reason_text) > 1000 then
    raise exception 'reason_too_long';
  end if;

  insert into public.candidate_cancellations (
    request_id, candidate_id, candidate_user_id, job_id, day_count, late_day_count,
    reason_code, reason_text, evidence_choice, status)
  values (p_request_id, v_profile, v_uid, v_job, cardinality(v_ids), v_late,
          p_reason_code, v_reason_text,
          case when v_late > 0 then p_evidence_choice end, v_status)
  returning id into v_id;

  insert into public.candidate_cancellation_days (
    mission_day_id, cancellation_id, mission_id, starts_at, classification, terms_source,
    candidate_plan, cancellation_notice_hours, deadline_at, reaction_until)
  select d.id, v_id, d.mission_id, d.starts_at, k.classification, k.terms_source,
         k.candidate_plan, k.cancellation_notice_hours, k.deadline_at, k.reaction_until
  from public.mission_days d cross join lateral public.classify_cancellation_day(d.id, now()) k
  where d.id = any (v_ids);

  -- Effets sur les engagements : mission entièrement annulée → annulée et
  -- place libérée (candidature « withdrawn ») ; mission interrompue
  -- (journées restantes toutes annulées ou confirmées) → annulée, place
  -- conservée (le support examine la poursuite et le remplacement).
  for v_mission in
    select distinct d.mission_id as id from public.mission_days d where d.id = any (v_ids)
  loop
    if not exists (select 1 from public.mission_days d
                   where d.mission_id = v_mission.id
                     and not exists (select 1 from public.candidate_cancellation_days cd
                                     where cd.mission_day_id = d.id)) then
      update public.missions m
      set status = 'cancelled', cancelled_by = 'candidate', cancellation_reason = 'candidate_cancellation'
      where m.id = v_mission.id;
      update public.job_applications a set status = 'withdrawn'
      where a.id = (select m.application_id from public.missions m where m.id = v_mission.id)
        and a.status = 'selected';
    else
      perform public.mission_close_if_interrupted(v_mission.id);
    end if;
  end loop;

  -- Entreprise prévenue, sans classement ni plan.
  select cp.user_id, j.title into v_company_user, v_title
  from public.jobs j join public.company_profiles cp on cp.id = j.company_id where j.id = v_job;
  select string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI'), ', ' order by d.starts_at),
         string_agg(to_char(d.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI'), ', ' order by d.starts_at)
  into v_dates_fr, v_dates_en
  from public.mission_days d where d.id = any (v_ids);
  perform public.incident_notify(v_company_user, 'Désistement d''un candidat', 'Candidate withdrawal',
    coalesce(v_first_name, 'Le candidat') || ' s''est désisté(e) de « ' || v_title || ' » : ' || v_dates_fr || ' (heure de Douala).',
    coalesce(v_first_name, 'The candidate') || ' withdrew from "' || v_title || '": ' || v_dates_en || ' (Douala time).',
    jsonb_build_object('kind', 'candidate_cancellation', 'job_id', v_job, 'cancellation_id', v_id));
  perform public.incident_notify(v_uid, 'Annulation enregistrée', 'Cancellation recorded',
    case v_status
      when 'closed_no_sanction' then 'Votre désistement est enregistré, sans sanction.'
      when 'sanctioned_no_evidence' then 'Votre désistement est enregistré. Hors délai et sans justificatif : un manquement est retenu (−5 unités d''expérience). Recours possible pendant 7 jours.'
      else 'Votre désistement est enregistré. Déposez votre justificatif : le support l''examinera avant toute sanction.' end,
    case v_status
      when 'closed_no_sanction' then 'Your withdrawal is recorded, with no sanction.'
      when 'sanctioned_no_evidence' then 'Your withdrawal is recorded. Late and without proof: a breach is recorded (−5 experience units). You may appeal within 7 days.'
      else 'Your withdrawal is recorded. Upload your proof: support will review it before any sanction.' end,
    jsonb_build_object('kind', 'candidate_cancellation', 'cancellation_id', v_id));

  if v_status = 'sanctioned_no_evidence' then
    perform public.cancellation_apply_sanction(v_id, 'cancellation_flow', null);
  end if;

  return query select v_id, v_status, v_late, cardinality(v_ids), false;
end;
$$;
revoke all on function public.request_candidate_cancellation(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.request_candidate_cancellation(uuid, uuid[], text, text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════
-- 11. Constat d'absence injustifiée (SAN-08)
-- ════════════════════════════════════════════════════════════════════
-- Articulation avec la réalisation du travail (décision du 2026-11-23,
-- précisée le 2026-11-24). Le constat suit son propre parcours ; aucun
-- dossier du lot 16 n'est exigé.
--   contested       contestation non résolue sur la réalisation (décision du
--                   2026-11-24) : « code non remis » encore en instruction,
--                   proposition du lot 16 en attente, recours demandé et non
--                   tranché ou arbitrage requis → décision du constat bloquée ;
--   work_confirmed  journée confirmée (code, support, décision exceptionnelle)
--                   ou décision « établi » → aucune absence injustifiée ;
--   ambiguous       début enregistré, accord partiel, décision « partiel » ou
--                   « désaccord », interruption → aucune absence injustifiée
--                   sans règle validée ;
--   clear           sinon (aucune décision, ou « non établi » définitif, qui
--                   ne prouve jamais à lui seul une faute).
-- outcome : issue de la dernière décision du lot 16 sur la journée, ou null.
drop function if exists public.absence_realization_state(uuid);
create or replace function public.absence_realization_state(p_incident_id uuid)
returns table (state text, outcome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inc public.mission_incidents;
  v_day public.mission_days;
  v_last text;
  v_contested boolean := false;
  v_ambiguous boolean := false;
  x record;
  v_dec public.mission_incident_decisions;
begin
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id;
  select d.* into v_day from public.mission_days d where d.id = v_inc.mission_day_id;
  for x in
    select i.* from public.mission_incidents i
    where i.mission_day_id = v_day.id and i.kind in ('absence', 'code_not_received', 'interruption')
  loop
    if x.kind = 'interruption' then
      v_ambiguous := true;
      continue;
    end if;
    if exists (select 1 from public.mission_incident_proposals p
               where p.incident_id = x.id and p.status = 'pending') then
      v_contested := true;
    end if;
    if x.kind = 'code_not_received' and x.status in ('open', 'answered') then
      v_contested := true;
    end if;
    select d.* into v_dec from public.mission_incident_decisions d
    where d.incident_id = x.id order by d.decided_at desc, d.id desc limit 1;
    if v_dec.id is not null then
      v_last := v_dec.outcome;
      if v_dec.outcome = 'established' then
        return query select 'work_confirmed'::text, v_dec.outcome;
        return;
      end if;
      if v_dec.outcome in ('partial', 'disagreement') then
        v_ambiguous := true;
      end if;
      -- Recours non résolu (demandé et non tranché, ou arbitrage requis). Une
      -- fenêtre de révision ouverte sans demande ne bloque pas.
      if (v_dec.kind = 'appeal' and v_dec.appeal_result = 'arbitration_required')
         or exists (select 1 from public.mission_incident_appeals a
                    where a.incident_id = x.id and a.status <> 'decided') then
        v_contested := true;
      end if;
    end if;
  end loop;
  if public.completion_counts(v_day.completion_source) then
    return query select 'work_confirmed'::text, v_last;
    return;
  end if;
  if v_contested then
    return query select 'contested'::text, v_last;
    return;
  end if;
  if v_ambiguous or v_day.actual_start_time is not null
     or v_day.completion_source in ('partial', 'partial_support') then
    return query select 'ambiguous'::text, v_last;
    return;
  end if;
  return query select 'clear'::text, v_last;
end;
$$;
revoke all on function public.absence_realization_state(uuid) from public, anon, authenticated, service_role;

-- Contrôle commun à la proposition et à la validation : mission et journée
-- tenues en partage (une confirmation concurrente attend la fin de la
-- décision, ou la décision lit la confirmation déjà enregistrée).
create or replace function public.absence_finding_check(p_finding uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.absence_findings;
  v_state record;
begin
  select f.* into v_f from public.absence_findings f where f.id = p_finding;
  perform 1 from public.missions m where m.id = v_f.mission_id for share;
  perform 1 from public.mission_days d where d.id = v_f.mission_day_id for share;
  select s.* into v_state from public.absence_realization_state(v_f.incident_id) s;
  if v_state.state = 'contested' then
    raise exception 'realization_review_open';
  end if;
  if p_outcome = 'established' then
    if v_state.state = 'work_confirmed' then
      raise exception 'work_confirmed';
    end if;
    if v_state.state = 'ambiguous' then
      raise exception 'realization_ambiguous';
    end if;
  end if;
end;
$$;
revoke all on function public.absence_finding_check(uuid, text) from public, anon, authenticated, service_role;

-- Réciproque : tant qu'un constat « absence injustifiée établie » est en
-- vigueur, la journée ne peut pas être confirmée (tout auteur, clé service
-- comprise) ; un recours qui l'infirme rouvre la voie.
create or replace function public.guard_confirmation_vs_absence_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completion_source is not null
     and new.completion_source is distinct from old.completion_source
     and exists (select 1 from public.absence_findings f
                 where f.mission_day_id = new.id and f.status = 'decided'
                   and f.outcome = 'established') then
    raise exception 'absence_finding_established';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_confirmation_vs_absence_finding() from public, anon, authenticated, service_role;
drop trigger if exists trg_guard_confirmation_vs_absence_finding on public.mission_days;
create trigger trg_guard_confirmation_vs_absence_finding
  before update on public.mission_days
  for each row execute function public.guard_confirmation_vs_absence_finding();

create or replace function public.absence_finding_event(
  p_finding uuid, p_kind text, p_actor uuid, p_role text, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.absence_finding_events (finding_id, kind, actor_id, actor_role, data)
  values (p_finding, p_kind, p_actor, p_role, coalesce(p_data, '{}'::jsonb));
$$;
revoke all on function public.absence_finding_event(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Ouverture (instruction) : tout admin actif ; en parallèle du lot 16.
create or replace function public.admin_open_absence_finding(p_incident_id uuid)
returns table (finding_id uuid, candidate_due_at timestamptz, already_open boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_inc public.mission_incidents;
  v_f public.absence_findings;
  v_day public.mission_days;
  v_cand_user uuid;
  v_comp_user uuid;
  v_title text;
  v_fid uuid;
  v_note_id uuid;
  v_note_at timestamptz;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  select f.* into v_f from public.absence_findings f where f.incident_id = v_inc.id;
  if found then
    return query select v_f.id, v_f.candidate_due_at, true;
    return;
  end if;
  if v_inc.kind <> 'absence' or v_inc.reported_by_party <> 'company' then
    raise exception 'incident_kind_invalid';
  end if;
  select d.* into v_day from public.mission_days d where d.id = v_inc.mission_day_id;
  if public.completion_counts(v_day.completion_source) then
    raise exception 'day_already_confirmed';
  end if;
  select cp.user_id into v_cand_user from public.candidate_profiles cp where cp.id = v_inc.candidate_id;
  select cp.user_id into v_comp_user from public.company_profiles cp where cp.id = v_inc.company_id;
  select j.title into v_title from public.jobs j where j.id = v_inc.job_id;
  v_fid := gen_random_uuid();
  -- Notification d'ouverture créée d'abord ; les 72 h partent de sa
  -- création (même transaction), jamais de sa lecture.
  select n.id, n.created_at into v_note_id, v_note_at
  from public.absence_finding_notify(v_cand_user, 'Absence signalée : votre version', 'Reported absence: your account',
    'Une absence a été signalée pour « ' || v_title || ' » le '
      || to_char(v_day.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI')
      || '. Le support l''examine. Vous pouvez donner votre version et déposer un justificatif jusqu''au '
      || to_char((now() + interval '72 hours') at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI')
      || ' (heure de Douala). Un signalement n''est pas une faute établie.',
    'An absence was reported for "' || v_title || '" on '
      || to_char(v_day.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI')
      || '. Support is reviewing it. You can give your account and upload proof until '
      || to_char((now() + interval '72 hours') at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI')
      || ' (Douala time). A report is not an established fault.',
    jsonb_build_object('kind', 'absence_finding', 'finding_id', v_fid,
                       'mission_id', v_inc.mission_id, 'href', '/missions/' || v_inc.mission_id)) n;
  insert into public.absence_findings (id, incident_id, mission_id, mission_day_id, job_id, candidate_id,
    candidate_user_id, company_id, company_user_id, opened_by, opened_by_role,
    candidate_notification_id, candidate_notified_at, candidate_due_at)
  values (v_fid, v_inc.id, v_inc.mission_id, v_inc.mission_day_id, v_inc.job_id, v_inc.candidate_id,
          v_cand_user, v_inc.company_id, v_comp_user, v_uid, v_role,
          v_note_id, v_note_at, v_note_at + interval '72 hours')
  returning * into v_f;
  perform public.absence_finding_event(v_f.id, 'opened', v_uid, v_role,
    jsonb_build_object('notification_id', v_note_id, 'notified_at', v_note_at));
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'open_absence_finding', 'absence_findings', v_f.id,
          jsonb_build_object('incident_id', v_inc.id));
  return query select v_f.id, v_f.candidate_due_at, false;
end;
$$;
revoke all on function public.admin_open_absence_finding(uuid) from public, anon;
grant execute on function public.admin_open_absence_finding(uuid) to authenticated;

-- Réponse du candidat jusqu'à l'échéance incluse (72 h) ; nouvelle version
-- ou nouvelle pièce : révision suivante, proposition en cours annulée.
-- Tout dépôt reçu avant la décision finale (version, texte, pièce, quelle
-- que soit l'échéance des 72 h) crée une révision et rend périmée la
-- proposition qui ne l'inclut pas ; aucun délai n'est prolongé.
create or replace function public.absence_finding_touch(
  p_finding uuid, p_kind text, p_actor uuid, p_role text default 'candidate',
  p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.absence_findings;
begin
  select f.* into v_f from public.absence_findings f where f.id = p_finding;
  update public.absence_findings f
  set revision = f.revision + 1, updated_at = now(),
      status = case when f.status = 'proposed' then 'instruction' else f.status end,
      proposed_outcome = case when f.status = 'proposed' then null else f.proposed_outcome end,
      proposed_note = case when f.status = 'proposed' then null else f.proposed_note end,
      proposed_by = case when f.status = 'proposed' then null else f.proposed_by end,
      proposed_at = case when f.status = 'proposed' then null else f.proposed_at end,
      proposal_revision = case when f.status = 'proposed' then null else f.proposal_revision end
  where f.id = p_finding;
  perform public.absence_finding_event(p_finding, p_kind, p_actor, p_role,
    coalesce(p_data, '{}'::jsonb)
      || jsonb_build_object('revision', v_f.revision + 1, 'proposal_voided', v_f.status = 'proposed'));
end;
$$;
revoke all on function public.absence_finding_touch(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.answer_absence_finding(p_finding_id uuid, p_statement text)
returns table (finding_id uuid, revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_statement, ''));
  v_f public.absence_findings;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found or v_f.candidate_user_id <> v_uid then
    raise exception 'finding_not_found';
  end if;
  if v_f.status = 'decided' then
    raise exception 'finding_decided';
  end if;
  if now() > v_f.candidate_due_at then
    raise exception 'response_window_closed';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  update public.absence_findings f
  set candidate_statement = v_body, candidate_answered_at = now()
  where f.id = v_f.id;
  perform public.absence_finding_touch(v_f.id, 'candidate_answer', v_uid);
  return query select v_f.id, v_f.revision + 1;
end;
$$;
revoke all on function public.answer_absence_finding(uuid, text) from public, anon;
grant execute on function public.answer_absence_finding(uuid, text) to authenticated;

-- Pièce déposée par la route (clé service), après contrôle du propriétaire.
create or replace function public.record_absence_finding_evidence(
  p_user_id uuid, p_finding_id uuid, p_path text, p_mime text, p_size integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.absence_findings;
  v_party text;
  v_id uuid;
  v_answer boolean;
begin
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  v_party := case when v_f.candidate_user_id = p_user_id then 'candidate'
                  when v_f.company_user_id = p_user_id then 'company' end;
  if v_party is null then
    raise exception 'finding_not_found';
  end if;
  insert into public.case_evidence (case_type, case_id, storage_path, mime_type, size_bytes,
                                    uploaded_by, uploaded_by_role)
  values ('absence_finding', v_f.id, p_path, p_mime, p_size, p_user_id, v_party)
  returning id into v_id;
  -- Avant la décision finale : révision suivante (réponse du candidat dans
  -- les 72 h, ou nouvel élément de l'une ou l'autre partie). Après la
  -- décision : élément ajouté au journal, sans infirmation ni réouverture.
  v_answer := v_party = 'candidate' and v_f.status <> 'decided' and now() <= v_f.candidate_due_at;
  if v_f.status <> 'decided' then
    perform public.absence_finding_touch(v_f.id,
      case when v_answer then 'candidate_evidence' else 'new_element' end,
      p_user_id, v_party, jsonb_build_object('evidence_id', v_id));
  else
    perform public.absence_finding_event(v_f.id, 'new_element', p_user_id, v_party,
      jsonb_build_object('evidence_id', v_id, 'after_decision', true));
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_absence_finding_evidence(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_absence_finding_evidence(uuid, uuid, text, text, integer) to service_role;

-- Proposition (premier validateur) : réalisation définitive « non établi »
-- et réponse reçue ou échéance passée ; jamais déduite du silence.
create or replace function public.admin_propose_absence_finding(
  p_finding_id uuid, p_outcome text, p_note text, p_expected_revision integer)
returns table (finding_id uuid, status text, revision integer, already_proposed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_f public.absence_findings;
  v_state record;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_outcome is null or p_outcome not in ('established', 'not_established') then
    raise exception 'outcome_invalid';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  if v_f.status = 'proposed' and v_f.proposed_by = v_uid and v_f.proposed_outcome = p_outcome
     and v_f.proposal_revision = v_f.revision and p_expected_revision = v_f.revision then
    return query select v_f.id, v_f.status, v_f.revision, true;
    return;
  end if;
  if v_f.status = 'decided' then
    raise exception 'finding_decided';
  end if;
  if v_f.status <> 'instruction' then
    raise exception 'proposal_pending';
  end if;
  if p_expected_revision is distinct from v_f.revision then
    raise exception 'finding_stale';
  end if;
  perform public.absence_finding_check(v_f.id, p_outcome);
  if v_f.candidate_answered_at is null and now() <= v_f.candidate_due_at then
    raise exception 'response_window_open';
  end if;
  update public.absence_findings f
  set status = 'proposed', proposed_outcome = p_outcome, proposed_note = v_note, proposed_by = v_uid,
      proposed_at = now(), proposal_revision = f.revision, updated_at = now()
  where f.id = v_f.id;
  perform public.absence_finding_event(v_f.id, 'proposed', v_uid, v_role,
    jsonb_build_object('outcome', p_outcome, 'revision', v_f.revision));
  return query select v_f.id, 'proposed'::text, v_f.revision, false;
end;
$$;
revoke all on function public.admin_propose_absence_finding(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_propose_absence_finding(uuid, text, text, integer) to authenticated;

-- Seconde validation (agent distinct) : approuvée → décision ; rejetée →
-- retour à l'instruction. Aucun effet sur la réputation, les sanctions ni
-- les montants.
create or replace function public.admin_validate_absence_finding(
  p_finding_id uuid, p_approve boolean, p_note text, p_expected_revision integer)
returns table (finding_id uuid, status text, outcome text, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_f public.absence_findings;
  v_title text;
  v_when text;
  v_note_id uuid;
  v_note_at timestamptz;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_approve is null then
    raise exception 'decision_invalid';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  if v_f.status = 'decided' then
    if p_approve and v_f.validated_by = v_uid then
      return query select v_f.id, v_f.status, v_f.outcome, true;
      return;
    end if;
    raise exception 'finding_decided';
  end if;
  -- Version lue périmée (élément reçu depuis) : relecture exigée.
  if p_expected_revision is distinct from v_f.revision then
    raise exception 'finding_stale';
  end if;
  if v_f.status <> 'proposed' then
    raise exception 'no_proposal';
  end if;
  if v_f.proposed_by = v_uid then
    raise exception 'validator_must_differ';
  end if;
  if v_f.proposal_revision <> v_f.revision then
    raise exception 'finding_stale';
  end if;
  if p_approve then
    perform public.absence_finding_check(v_f.id, v_f.proposed_outcome);
  end if;

  if not p_approve then
    update public.absence_findings f
    set status = 'instruction', proposed_outcome = null, proposed_note = null, proposed_by = null,
        proposed_at = null, proposal_revision = null, updated_at = now()
    where f.id = v_f.id;
    perform public.absence_finding_event(v_f.id, 'proposal_rejected', v_uid, v_role,
      jsonb_build_object('note', v_note));
    return query select v_f.id, 'instruction'::text, null::text, false;
    return;
  end if;

  select j.title, to_char(d.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI')
  into v_title, v_when
  from public.jobs j, public.mission_days d where j.id = v_f.job_id and d.id = v_f.mission_day_id;
  -- Notification de la décision créée d'abord ; les 7 jours de recours
  -- partent de sa création (même transaction), jamais de sa lecture.
  select n.id, n.created_at into v_note_id, v_note_at
  from public.absence_finding_notify(v_f.candidate_user_id, 'Constat sur l''absence signalée', 'Finding on the reported absence',
    case v_f.proposed_outcome when 'established'
      then 'Le support a constaté une absence injustifiée pour « ' || v_title || ' » le ' || v_when
           || '. Recours possible jusqu''au ' || to_char((now() + interval '7 days') at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI') || ' (heure de Douala).'
      else 'Absence injustifiée non établie pour « ' || v_title || ' » le ' || v_when
           || '. Cette issue ne confirme ni le travail ni un droit au paiement. Recours possible jusqu''au '
           || to_char((now() + interval '7 days') at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI') || ' (heure de Douala).' end,
    case v_f.proposed_outcome when 'established'
      then 'Support found an unjustified absence for "' || v_title || '". You may appeal until '
           || to_char((now() + interval '7 days') at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI') || ' (Douala time).'
      else 'Unjustified absence not established for "' || v_title || '". This outcome confirms neither the work nor any right to payment. You may appeal until '
           || to_char((now() + interval '7 days') at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI') || ' (Douala time).' end,
    jsonb_build_object('kind', 'absence_finding', 'finding_id', v_f.id, 'mission_id', v_f.mission_id,
                       'href', '/missions/' || v_f.mission_id)) n;
  perform public.absence_finding_notify(v_f.company_user_id, 'Constat sur l''absence signalée', 'Finding on the reported absence',
    case v_f.proposed_outcome when 'established'
      then 'Le support a constaté une absence injustifiée pour « ' || v_title || ' » le ' || v_when || '.'
      else 'Absence injustifiée non établie pour « ' || v_title || ' » le ' || v_when
           || '. Cette issue ne confirme ni le travail ni un droit au paiement.' end,
    case v_f.proposed_outcome when 'established'
      then 'Support found an unjustified absence for "' || v_title || '".'
      else 'Unjustified absence not established for "' || v_title || '". This outcome confirms neither the work nor any right to payment.' end,
    jsonb_build_object('kind', 'absence_finding', 'finding_id', v_f.id, 'job_id', v_f.job_id,
                       'href', '/company/jobs/' || v_f.job_id));
  update public.absence_findings f
  set status = 'decided', outcome = f.proposed_outcome, decision_note = f.proposed_note,
      validated_by = v_uid, decided_at = now(),
      decision_notification_id = v_note_id, decision_notified_at = v_note_at,
      review_deadline = v_note_at + interval '7 days',
      review_requested_at = null, review_party = null, review_note = null, review_outcome = null,
      review_decided_by = null, review_decided_at = null, review_decision_note = null,
      updated_at = now()
  where f.id = v_f.id;
  -- Historique : chaque décision reste dans le journal (ajout seul).
  perform public.absence_finding_event(v_f.id, 'decided', v_uid, v_role,
    jsonb_build_object('outcome', v_f.proposed_outcome, 'note', v_f.proposed_note,
                       'proposed_by', v_f.proposed_by, 'validated_by', v_uid,
                       'notification_id', v_note_id, 'notified_at', v_note_at,
                       'review_deadline', v_note_at + interval '7 days', 'revision', v_f.revision));
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'decide_absence_finding', 'absence_findings', v_f.id,
          jsonb_build_object('outcome', v_f.proposed_outcome, 'proposed_by', v_f.proposed_by));
  return query select v_f.id, 'decided'::text, v_f.proposed_outcome, false;
end;
$$;
revoke all on function public.admin_validate_absence_finding(uuid, boolean, text, integer) from public, anon;
grant execute on function public.admin_validate_absence_finding(uuid, boolean, text, integer) to authenticated;

-- Recours d'une partie pendant 7 jours (à l'instant exact : clos), un par
-- décision.
create or replace function public.request_absence_finding_review(p_finding_id uuid, p_note text)
returns table (finding_id uuid, review_deadline timestamptz, already_requested boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_note, ''));
  v_f public.absence_findings;
  v_party text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  v_party := case when v_f.candidate_user_id = v_uid then 'candidate'
                  when v_f.company_user_id = v_uid then 'company' end;
  if v_party is null then
    raise exception 'finding_not_found';
  end if;
  if v_f.status <> 'decided' then
    raise exception 'no_decision';
  end if;
  if v_f.review_requested_at is not null then
    if v_f.review_party = v_party then
      return query select v_f.id, v_f.review_deadline, true;
      return;
    end if;
    raise exception 'review_already_requested';
  end if;
  if now() >= v_f.review_deadline then
    raise exception 'review_window_closed';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  update public.absence_findings f
  set review_requested_at = now(), review_party = v_party, review_note = v_body, updated_at = now()
  where f.id = v_f.id;
  perform public.absence_finding_event(v_f.id, 'review_requested', v_uid, v_party);
  return query select v_f.id, v_f.review_deadline, false;
end;
$$;
revoke all on function public.request_absence_finding_review(uuid, text) from public, anon;
grant execute on function public.request_absence_finding_review(uuid, text) to authenticated;

-- Recours tranché par un ops/fondateur actif distinct des deux validateurs :
-- maintenu, ou infirmé → retour à l'instruction (nouvelle proposition et
-- nouvelle double validation exigées).
create or replace function public.admin_decide_absence_finding_review(
  p_finding_id uuid, p_outcome text, p_note text)
returns table (finding_id uuid, status text, review_outcome text, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_f public.absence_findings;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_outcome is null or p_outcome not in ('maintained', 'overturned') then
    raise exception 'outcome_invalid';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  if v_f.review_decided_at is not null then
    if v_f.review_outcome = p_outcome and v_f.review_decided_by = v_uid then
      return query select v_f.id, v_f.status, v_f.review_outcome, true;
      return;
    end if;
    raise exception 'already_decided';
  end if;
  if v_f.status <> 'decided' or v_f.review_requested_at is null then
    raise exception 'review_not_requested';
  end if;
  if v_uid in (v_f.validated_by, (select (e.data ->> 'proposed_by')::uuid
                                  from public.absence_finding_events e
                                  where e.finding_id = v_f.id and e.kind = 'decided'
                                  order by e.created_at desc limit 1)) then
    raise exception 'reviewer_must_differ';
  end if;
  if p_outcome = 'maintained' then
    update public.absence_findings f
    set review_outcome = 'maintained', review_decided_by = v_uid, review_decided_at = now(),
        review_decision_note = v_note, updated_at = now()
    where f.id = v_f.id;
  else
    update public.absence_findings f
    set status = 'instruction', outcome = null, decision_note = null, validated_by = null,
        decided_at = null, decision_notification_id = null, decision_notified_at = null,
        review_deadline = null, review_requested_at = null, review_party = null,
        review_note = null, review_outcome = null, review_decided_by = null, review_decided_at = null,
        review_decision_note = null, proposed_outcome = null, proposed_note = null, proposed_by = null,
        proposed_at = null, proposal_revision = null, revision = f.revision + 1, updated_at = now()
    where f.id = v_f.id;
  end if;
  perform public.absence_finding_event(v_f.id, 'review_decided', v_uid, v_role,
    jsonb_build_object('outcome', p_outcome, 'note', v_note, 'previous_outcome', v_f.outcome,
                       'previous_decision_note', v_f.decision_note, 'previous_decided_at', v_f.decided_at,
                       'review_party', v_f.review_party, 'review_note', v_f.review_note));
  perform public.incident_notify(u, 'Recours sur le constat', 'Appeal on the finding',
    case p_outcome when 'maintained' then 'Le recours est rejeté : le constat est maintenu.'
      else 'Le recours est accepté : le constat est réexaminé.' end,
    case p_outcome when 'maintained' then 'The appeal is dismissed: the finding stands.'
      else 'The appeal is upheld: the finding is re-examined.' end,
    jsonb_build_object('kind', 'absence_finding', 'finding_id', v_f.id))
  from unnest(array[v_f.candidate_user_id, v_f.company_user_id]) u;
  return query select v_f.id,
    case p_outcome when 'maintained' then 'decided' else 'instruction' end, p_outcome, false;
end;
$$;
revoke all on function public.admin_decide_absence_finding_review(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_absence_finding_review(uuid, text, text) to authenticated;

-- Notification d'une étape du constat : identifiant et instant de
-- création renvoyés (origine des délais).
create or replace function public.absence_finding_notify(
  p_user uuid, p_title_fr text, p_title_en text, p_body_fr text, p_body_en text, p_data jsonb)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locale text;
begin
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = p_user;
  return query
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (p_user, 'mission_update',
          case when v_locale = 'en' then p_title_en else p_title_fr end,
          case when v_locale = 'en' then p_body_en else p_body_fr end, p_data)
  returning notifications.id, notifications.created_at;
end;
$$;
revoke all on function public.absence_finding_notify(uuid, text, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- Nouvel élément transmis au support par une partie, à tout moment, sans
-- plafond cumulatif : avant la décision finale, révision suivante (la
-- proposition qui ne l'inclut pas est périmée) ; après, simple ajout au
-- journal. Ni infirmation, ni réouverture, ni nouveau délai.
create or replace function public.submit_absence_finding_element(p_finding_id uuid, p_text text)
returns table (finding_id uuid, element_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_text, ''));
  v_f public.absence_findings;
  v_party text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select f.* into v_f from public.absence_findings f where f.id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;
  v_party := case when v_f.candidate_user_id = v_uid then 'candidate'
                  when v_f.company_user_id = v_uid then 'company' end;
  if v_party is null then
    raise exception 'finding_not_found';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  if v_f.status <> 'decided' then
    perform public.absence_finding_touch(v_f.id, 'new_element', v_uid, v_party,
      jsonb_build_object('text', v_body));
  else
    perform public.absence_finding_event(v_f.id, 'new_element', v_uid, v_party,
      jsonb_build_object('text', v_body, 'after_decision', true));
  end if;
  select count(*) into v_count from public.absence_finding_events e
  where e.finding_id = v_f.id and e.kind = 'new_element' and e.actor_id = v_uid;
  return query select v_f.id, v_count;
end;
$$;
revoke all on function public.submit_absence_finding_element(uuid, text) from public, anon;
grant execute on function public.submit_absence_finding_element(uuid, text) to authenticated;

-- Note d'instruction : tout admin actif (support compris), sans pouvoir de
-- décision.
create or replace function public.admin_add_absence_finding_note(p_finding_id uuid, p_note text)
returns table (finding_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  if not exists (select 1 from public.absence_findings f where f.id = p_finding_id) then
    raise exception 'finding_not_found';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  perform public.absence_finding_event(p_finding_id, 'instruction_note', v_uid, v_role,
    jsonb_build_object('note', v_note));
  return query select p_finding_id;
end;
$$;
revoke all on function public.admin_add_absence_finding_note(uuid, text) from public, anon;
grant execute on function public.admin_add_absence_finding_note(uuid, text) to authenticated;

-- Lectures.
create or replace function public.absence_finding_json(f public.absence_findings, p_viewer text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id, 'incident_id', f.incident_id, 'mission_id', f.mission_id,
    'mission_day_id', f.mission_day_id, 'job_id', f.job_id, 'status', f.status,
    'opened_at', f.opened_at, 'candidate_notified_at', f.candidate_notified_at,
    'candidate_due_at', f.candidate_due_at, 'decision_notified_at', f.decision_notified_at,
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind,
                    'outcome', e.data ->> 'outcome', 'at', e.created_at,
                    'notified_at', e.data ->> 'notified_at',
                    'review_deadline', e.data ->> 'review_deadline') order by e.created_at)
                  from public.absence_finding_events e
                  where e.finding_id = f.id and e.kind in ('decided', 'review_decided')), '[]'::jsonb),
    'my_elements', coalesce((select count(*) from public.absence_finding_events e
                  where e.finding_id = f.id and e.kind = 'new_element'
                    and e.actor_role = p_viewer), 0),
    'outcome', f.outcome, 'decided_at', f.decided_at, 'review_deadline', f.review_deadline,
    'review_requested_at', f.review_requested_at, 'review_party', f.review_party,
    'review_outcome', f.review_outcome, 'review_decided_at', f.review_decided_at,
    'day_starts_at', (select d.starts_at from public.mission_days d where d.id = f.mission_day_id))
  || case when p_viewer in ('candidate', 'admin') then jsonb_build_object(
       'candidate_statement', f.candidate_statement, 'candidate_answered_at', f.candidate_answered_at,
       'decision_note', f.decision_note,
       'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'mime_type', e.mime_type,
                       'created_at', e.created_at) order by e.created_at)
                     from public.case_evidence e
                     where e.case_type = 'absence_finding' and e.case_id = f.id), '[]'::jsonb))
     else '{}'::jsonb end
  || case when p_viewer = 'admin' then jsonb_build_object(
       'revision', f.revision, 'proposed_outcome', f.proposed_outcome, 'proposed_note', f.proposed_note,
       'proposed_by', f.proposed_by, 'proposed_at', f.proposed_at, 'validated_by', f.validated_by,
       'review_note', f.review_note, 'review_decided_by', f.review_decided_by,
       'review_decision_note', f.review_decision_note,
       'realization', (select jsonb_build_object('state', s.state, 'outcome', s.outcome)
                       from public.absence_realization_state(f.incident_id) s),
       'candidate_name', (select cp.first_name || ' ' || left(cp.last_name, 1) || '.'
                          from public.candidate_profiles cp where cp.id = f.candidate_id),
       'job_title', (select j.title from public.jobs j where j.id = f.job_id),
       'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor_role', e.actor_role,
                     'created_at', e.created_at,
                     'note', coalesce(e.data ->> 'note', e.data ->> 'text'),
                     'outcome', e.data ->> 'outcome',
                     'evidence_id', e.data ->> 'evidence_id') order by e.created_at)
                   from public.absence_finding_events e where e.finding_id = f.id), '[]'::jsonb))
     else '{}'::jsonb end;
$$;
revoke all on function public.absence_finding_json(public.absence_findings, text) from public, anon, authenticated, service_role;

create or replace function public.my_absence_findings(p_mission_id uuid default null)
returns jsonb
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
  return jsonb_build_object('server_now', now(), 'findings', coalesce((
    select jsonb_agg(public.absence_finding_json(f,
             case when f.candidate_user_id = v_uid then 'candidate' else 'company' end)
           order by f.opened_at desc)
    from public.absence_findings f
    where (f.candidate_user_id = v_uid or f.company_user_id = v_uid)
      and (p_mission_id is null or f.mission_id = p_mission_id)), '[]'::jsonb));
end;
$$;
revoke all on function public.my_absence_findings(uuid) from public, anon;
grant execute on function public.my_absence_findings(uuid) to authenticated;

create or replace function public.admin_absence_findings(p_incident_id uuid default null)
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
  return jsonb_build_object('server_now', now(),
    'findings', coalesce((
      select jsonb_agg(public.absence_finding_json(f, 'admin') order by f.opened_at desc)
      from public.absence_findings f
      where p_incident_id is null or f.incident_id = p_incident_id), '[]'::jsonb),
    -- Signalements d'absence de l'entreprise sans constat ouvert (journée
    -- non confirmée) : instruction possible.
    'openable', coalesce((
      select jsonb_agg(jsonb_build_object('incident_id', i.id, 'mission_id', i.mission_id,
               'job_title', j.title, 'starts_at', d.starts_at, 'created_at', i.created_at,
               'realization', (select jsonb_build_object('state', s.state, 'outcome', s.outcome)
                               from public.absence_realization_state(i.id) s))
             order by i.created_at desc)
      from public.mission_incidents i
      join public.mission_days d on d.id = i.mission_day_id
      join public.jobs j on j.id = i.job_id
      where i.kind = 'absence' and i.reported_by_party = 'company'
        and not public.completion_counts(d.completion_source)
        and not exists (select 1 from public.absence_findings f where f.incident_id = i.id)
        and (p_incident_id is null or i.id = p_incident_id)), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_absence_findings(uuid) from public, anon;
grant execute on function public.admin_absence_findings(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Signaux temps réel (charge utile {d, r})
-- ════════════════════════════════════════════════════════════════════
create or replace function public.rt_on_engagement_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[new.candidate_user_id, new.company_user_id], 'missions', null);
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_engagement_requests() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_engagement_requests on public.engagement_requests;
create trigger trg_rt_engagement_requests
  after insert or update on public.engagement_requests
  for each row execute function public.rt_on_engagement_requests();

drop trigger if exists trg_rt_support_cancellation_days on public.support_cancellation_days;
create trigger trg_rt_support_cancellation_days
  after insert on public.support_cancellation_days
  for each row execute function public.rt_on_mission_child();

create or replace function public.rt_on_absence_findings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[new.candidate_user_id, new.company_user_id], 'incidents', new.mission_id);
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_absence_findings() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_absence_findings on public.absence_findings;
create trigger trg_rt_absence_findings
  after insert or update on public.absence_findings
  for each row execute function public.rt_on_absence_findings();

-- Journal du constat (nouvel élément, note d'instruction) : signal au
-- support et aux deux parties, sans contenu (charge utile {d, r}).
create or replace function public.rt_on_absence_finding_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.absence_findings;
begin
  select f.* into v_f from public.absence_findings f where f.id = new.finding_id;
  perform public.rt_signal_users(array[v_f.candidate_user_id, v_f.company_user_id], 'incidents', v_f.mission_id);
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_absence_finding_events() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_absence_finding_events on public.absence_finding_events;
create trigger trg_rt_absence_finding_events
  after insert on public.absence_finding_events
  for each row execute function public.rt_on_absence_finding_events();
