-- Migration : annulations par le candidat, justification, manquement unique,
-- exclusions progressives, suspensions par cause, fraude présumée et
-- montant acquis d'un forfait interrompu (lots 17b–17c)
-- Date : 2026-11-22
-- Tables affectées :
--   candidate_cancellations, candidate_cancellation_days, case_evidence,
--   account_suspensions, fraud_reports (nouvelles, fermées aux sessions) ;
--   reputation_incidents (colonne cancellation_id, protection reprise) ;
--   mission_days, mission_incidents, missions, job_applications, users
--   (déclencheurs ou écritures par RPC).
--
-- Règles (SRS §5.2, décisions des 2026-11-17 et 2026-11-18) :
--   * Le candidat choisit les journées (non commencées, non confirmées,
--     avant leur début) d'une même offre. Une demande = un événement.
--   * Classement par journée, sur les conditions figées à la sélection
--     (mission_day_commitment_terms, lot 17a), à l'heure de la base :
--       in_time          now() <= début − délai (Free 48 h, Premium 24 h) ;
--       reaction_window  sélection après ce seuil et now() <= sélection + 1 h ;
--       late             sinon ;
--       legacy           conditions historiques ou absentes : aucune
--                        sanction automatique fondée sur un délai supposé.
--     Limites incluses.
--   * Désistement enregistré tout de suite (journées annulées, entreprise
--     prévenue), quelle que soit la suite de l'examen.
--   * Au moins une journée « late » : motif obligatoire et choix explicite.
--       « Je n'ai pas de justificatif » → manquement immédiat (−5 unités).
--       Justificatif annoncé → « awaiting_evidence » jusqu'au premier dépôt
--       réussi (un échec d'envoi ne vaut pas déclaration), puis
--       « under_review » ; décision motivée d'un ops/founder actif :
--       acceptée (aucune sanction) ou refusée (−5 unités).
--     Un seul manquement par demande (reputation_incidents.cancellation_id
--     unique), quel que soit le nombre de journées tardives.
--   * Recours (comme la révision interne du lot 16) : 7 jours après la
--     décision ou le manquement automatique ; agent distinct de l'auteur de
--     la décision ; « overturned » annule le manquement (voided_at), le
--     rejeu de réputation et les exclusions sont recalculés.
--   * Exclusions : annulations tardives retenues (manquements
--     candidate_late_cancellation non annulés), sur toute la vie du compte,
--     par cycle de trois : 6 mois, puis 1 an, puis exclusion définitive.
--     Seuls comptent pour un cycle les faits commis (occurred_at) après le
--     retour du cycle précédent : un dossier ancien décidé tard reste
--     rattaché à sa période.
--   * Suspensions par cause (admin, cancellation_cycle, fraud) :
--     users.is_active = aucune suspension en cours. L'échéance d'une cause
--     ne réactive pas un compte encore suspendu pour une autre.
--   * Fraude présumée : signalement (tout admin actif) et éléments ;
--     suspension décidée par un ops/founder actif, durée choisie et motivée
--     (aucun barème).
--   * Montant acquis d'un forfait interrompu : forfait × heures prévues des
--     journées réalisées ÷ heures prévues de toutes les journées, sur les
--     journées et le montant du contrat (heures brutes début → fin, nuit
--     comprise, pause non déduite). Valeur exacte et arrondi au franc
--     (à valider). Aucun versement ni amende.
--
-- Rollback :
--   drop trigger trg_block_cancelled_day on public.mission_days ;
--   drop trigger trg_close_interrupted_mission on public.mission_days ;
--   drop trigger trg_block_incident_on_cancelled_day on public.mission_incidents ;
--   recréer protect_reputation_incidents depuis 20261120120000 ;
--   alter table public.reputation_incidents drop column cancellation_id ;
--   recréer mission_days_json depuis 20261120120000, admin_set_user_active
--   depuis 20260911140000 et la tâche planifiée sans account_suspension_sweep ;
--   drop table public.fraud_reports, public.account_suspensions,
--     public.case_evidence, public.candidate_cancellation_days,
--     public.candidate_cancellations ;
--   drop function … (fonctions créées ci-dessous).

-- ════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.candidate_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  day_count integer not null check (day_count between 1 and 31),
  late_day_count integer not null check (late_day_count >= 0),
  reason_code text check (reason_code in ('illness', 'family_emergency', 'transport',
                                          'late_notification', 'other')),
  reason_text text check (char_length(reason_text) <= 1000),
  evidence_choice text check (evidence_choice in ('provided', 'none')),
  status text not null check (status in ('closed_no_sanction', 'awaiting_evidence',
                                         'under_review', 'sanctioned_no_evidence',
                                         'accepted', 'refused')),
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null,
  decision_note text,
  incident_id uuid,
  review_requested_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  review_decided_at timestamptz,
  review_decided_by uuid references public.users(id) on delete set null,
  review_outcome text check (review_outcome in ('maintained', 'overturned')),
  review_decision_note text,
  updated_at timestamptz not null default now(),
  constraint candidate_cancellations_late_chk check (
    (late_day_count = 0 and status = 'closed_no_sanction')
    or (late_day_count > 0 and status <> 'closed_no_sanction'
        and reason_code is not null and evidence_choice is not null))
);
create index if not exists idx_candidate_cancellations_candidate
  on public.candidate_cancellations (candidate_id, created_at);
create index if not exists idx_candidate_cancellations_status
  on public.candidate_cancellations (status, created_at);

create table if not exists public.candidate_cancellation_days (
  mission_day_id uuid primary key references public.mission_days(id) on delete cascade,
  cancellation_id uuid not null references public.candidate_cancellations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  starts_at timestamptz not null,
  classification text not null check (classification in ('in_time', 'reaction_window',
                                                         'late', 'legacy')),
  terms_source text,
  candidate_plan text,
  cancellation_notice_hours integer,
  deadline_at timestamptz,
  reaction_until timestamptz
);
create index if not exists idx_candidate_cancellation_days_cancellation
  on public.candidate_cancellation_days (cancellation_id);
create index if not exists idx_candidate_cancellation_days_mission
  on public.candidate_cancellation_days (mission_id);

-- Pièces privées (bucket incident-evidence, sans politique) d'un dossier
-- d'annulation ou d'un signalement de fraude.
create table if not exists public.case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_type text not null check (case_type in ('cancellation', 'fraud')),
  case_id uuid not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_by_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_case_evidence_case on public.case_evidence (case_type, case_id);

create table if not exists public.fraud_reports (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references public.users(id) on delete cascade,
  cancellation_id uuid references public.candidate_cancellations(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 2000),
  created_by uuid references public.users(id) on delete set null,
  created_by_role text not null,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  closure_note text
);
create index if not exists idx_fraud_reports_subject on public.fraud_reports (subject_user_id, created_at);

create table if not exists public.account_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cause text not null check (cause in ('admin', 'cancellation_cycle', 'fraud')),
  cycle smallint check (cycle between 1 and 3),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text not null,
  incident_ids uuid[] not null default '{}',
  fraud_report_id uuid references public.fraud_reports(id) on delete set null,
  decided_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.users(id) on delete set null,
  lift_kind text check (lift_kind in ('decision_voided', 'admin', 'contest')),
  lift_reason text,
  ended_notified_at timestamptz,
  contested_at timestamptz,
  contest_note text check (char_length(contest_note) <= 1000),
  contest_decided_at timestamptz,
  contest_decided_by uuid references public.users(id) on delete set null,
  contest_outcome text check (contest_outcome in ('maintained', 'lifted')),
  contest_decision_note text,
  constraint account_suspensions_cycle_chk check (
    (cause = 'cancellation_cycle') = (cycle is not null)),
  constraint account_suspensions_end_chk check (ends_at is null or ends_at > starts_at)
);
create index if not exists idx_account_suspensions_user on public.account_suspensions (user_id, starts_at);
-- Un cycle appliqué (non annulé par recours) par numéro.
create unique index if not exists account_suspensions_cycle_key
  on public.account_suspensions (user_id, cycle)
  where cause = 'cancellation_cycle' and lift_kind is distinct from 'decision_voided';
-- Une seule suspension administrative en cours par compte.
create unique index if not exists account_suspensions_admin_key
  on public.account_suspensions (user_id)
  where cause = 'admin' and lifted_at is null;

-- Un manquement par demande d'annulation.
alter table public.reputation_incidents
  add column if not exists cancellation_id uuid references public.candidate_cancellations(id)
    on delete set null;
create unique index if not exists reputation_incidents_cancellation_key
  on public.reputation_incidents (cancellation_id) where cancellation_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'candidate_cancellations_incident_fk') then
    alter table public.candidate_cancellations
      add constraint candidate_cancellations_incident_fk
      foreign key (incident_id) references public.reputation_incidents(id) on delete set null;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['candidate_cancellations', 'candidate_cancellation_days',
                           'case_evidence', 'fraud_reports', 'account_suspensions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Aucune écriture de session ; journées et pièces immuables.
create or replace function public.protect_cancellation_case_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception '%: server-side only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and tg_table_name in ('candidate_cancellation_days', 'case_evidence') then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_cancellation_case_writes() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['candidate_cancellations', 'candidate_cancellation_days',
                           'case_evidence', 'fraud_reports', 'account_suspensions'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_cancellation_case_writes()', t, t);
  end loop;
end $$;

-- Suspensions administratives antérieures : une ligne « admin » par compte
-- déjà suspendu, pour que les causes soient distinguées.
insert into public.account_suspensions (user_id, cause, starts_at, reason)
select u.id, 'admin', coalesce(u.updated_at, now()) - interval '1 second',
       'Suspension administrative antérieure au lot 17c'
from public.users u
where u.is_active is false
  and not exists (select 1 from public.account_suspensions s where s.user_id = u.id);

-- ════════════════════════════════════════════════════════════════════
-- 2. Réputation : manquement rattaché à une demande d'annulation
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261120120000. Ajouts : cancellation_id immuable ; un
-- manquement d'annulation se vérifie sur la demande (ses journées ne sont
-- ni commencées ni confirmées) et non sur la mission entière, dont des
-- journées antérieures peuvent être réalisées ; une absence est refusée
-- sur une journée annulée (pas de double comptage).
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
-- 3. Journées annulées : plus de début, de code, de confirmation ni de
--    signalement
-- ════════════════════════════════════════════════════════════════════
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
     and exists (select 1 from public.candidate_cancellation_days cd
                 where cd.mission_day_id = new.id) then
    raise exception 'day_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.block_cancelled_mission_day() from public, anon, authenticated;
drop trigger if exists trg_block_cancelled_day on public.mission_days;
create trigger trg_block_cancelled_day
  before update on public.mission_days
  for each row execute function public.block_cancelled_mission_day();

create or replace function public.block_incident_on_cancelled_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.candidate_cancellation_days cd
             where cd.mission_day_id = new.mission_day_id) then
    raise exception 'day_cancelled';
  end if;
  return new;
end;
$$;
revoke all on function public.block_incident_on_cancelled_day() from public, anon, authenticated;
drop trigger if exists trg_block_incident_on_cancelled_day on public.mission_incidents;
create trigger trg_block_incident_on_cancelled_day
  before insert on public.mission_incidents
  for each row execute function public.block_incident_on_cancelled_day();

-- Mission dont toutes les journées sont annulées ou confirmées, avec au
-- moins une annulation : interrompue (statut « cancelled »). Les journées
-- confirmées restent acquises ; aucune unité de mission n'est attribuée
-- (mission non entièrement réalisée, règle du lot 12).
create or replace function public.mission_close_if_interrupted(p_mission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
begin
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found or v_mission.status in ('cancelled', 'no_show', 'completed') then
    return false;
  end if;
  if not exists (select 1 from public.candidate_cancellation_days cd
                 where cd.mission_id = p_mission_id) then
    return false;
  end if;
  if exists (select 1 from public.mission_days d
             where d.mission_id = p_mission_id
               and not public.completion_counts(d.completion_source)
               and not exists (select 1 from public.candidate_cancellation_days cd
                               where cd.mission_day_id = d.id)) then
    return false;
  end if;
  update public.missions m
  set status = 'cancelled', cancelled_by = 'candidate',
      cancellation_reason = case
        when exists (select 1 from public.mission_days d where d.mission_id = m.id
                     and public.completion_counts(d.completion_source))
        then 'candidate_cancellation_interrupted' else 'candidate_cancellation' end
  where m.id = p_mission_id;
  return true;
end;
$$;
revoke all on function public.mission_close_if_interrupted(uuid) from public, anon, authenticated;

create or replace function public.close_interrupted_mission_after_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.mission_close_if_interrupted(new.mission_id);
  return null;
end;
$$;
revoke all on function public.close_interrupted_mission_after_day() from public, anon, authenticated;
drop trigger if exists trg_close_interrupted_mission on public.mission_days;
create trigger trg_close_interrupted_mission
  after update of completion_source on public.mission_days
  for each row when (new.completion_source is not null)
  execute function public.close_interrupted_mission_after_day();

-- Journées vues par les parties (reprise de 20261120120000) : ajout de
-- cancelled_at, sans classement ni plan (confidentiel vis-à-vis de
-- l'entreprise).
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
                                 then d.completion_source end,
           'cancelled_at', (select c.created_at from public.candidate_cancellation_days cd
                            join public.candidate_cancellations c on c.id = cd.cancellation_id
                            where cd.mission_day_id = d.id)) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Classement d'une journée
-- ════════════════════════════════════════════════════════════════════
create or replace function public.classify_cancellation_day(p_day_id uuid, p_at timestamptz)
returns table (
  classification text,
  terms_source text,
  candidate_plan text,
  cancellation_notice_hours integer,
  deadline_at timestamptz,
  reaction_until timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day public.mission_days;
  v_terms public.mission_day_commitment_terms;
  v_deadline timestamptz;
  v_reaction timestamptz;
begin
  select d.* into v_day from public.mission_days d where d.id = p_day_id;
  select t.* into v_terms from public.mission_day_commitment_terms t where t.mission_day_id = p_day_id;
  if v_terms.mission_day_id is null or v_terms.terms_source = 'legacy'
     or v_terms.cancellation_notice_hours is null then
    return query select 'legacy'::text, coalesce(v_terms.terms_source, 'none'),
      null::text, null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;
  v_deadline := v_day.starts_at - make_interval(hours => v_terms.cancellation_notice_hours);
  if v_terms.selected_at > v_deadline then
    v_reaction := v_terms.selected_at + interval '1 hour';
  end if;
  return query select
    case when p_at <= v_deadline then 'in_time'
         when v_reaction is not null and p_at <= v_reaction then 'reaction_window'
         else 'late' end,
    v_terms.terms_source, v_terms.candidate_plan, v_terms.cancellation_notice_hours,
    v_deadline, v_reaction;
end;
$$;
revoke all on function public.classify_cancellation_day(uuid, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Suspensions par cause
-- ════════════════════════════════════════════════════════════════════
create or replace function public.account_suspension_is_active(
  p_lifted_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz, p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lifted_at is null and p_starts_at <= p_at and (p_ends_at is null or p_ends_at > p_at);
$$;

-- users.is_active = aucune suspension en cours, toutes causes confondues.
create or replace function public.refresh_account_active(p_user_id uuid, p_at timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  v_active := not exists (
    select 1 from public.account_suspensions s
    where s.user_id = p_user_id
      and public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, p_at));
  update public.users u set is_active = v_active
  where u.id = p_user_id and u.is_active is distinct from v_active;
  return v_active;
end;
$$;
revoke all on function public.refresh_account_active(uuid, timestamptz) from public, anon, authenticated;

-- Engagements futurs déjà sélectionnés (information du support : rien
-- n'est supprimé ni transformé en absence).
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
    and not exists (select 1 from public.candidate_cancellation_days cd where cd.mission_day_id = d.id);
$$;
revoke all on function public.candidate_future_engagements(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.suspension_notify(p_suspension_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.account_suspensions;
  v_until_fr text;
  v_until_en text;
  v_events_fr text;
  v_events_en text;
begin
  select x.* into s from public.account_suspensions x where x.id = p_suspension_id;
  v_until_fr := case when s.ends_at is null then 'sans date de fin'
                     else 'jusqu''au ' || to_char(s.ends_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI') end;
  v_until_en := case when s.ends_at is null then 'with no end date'
                     else 'until ' || to_char(s.ends_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI') end;
  select string_agg(to_char(i.occurred_at at time zone 'Africa/Douala', 'DD/MM/YYYY'), ', ' order by i.occurred_at),
         string_agg(to_char(i.occurred_at at time zone 'Africa/Douala', 'YYYY-MM-DD'), ', ' order by i.occurred_at)
  into v_events_fr, v_events_en
  from public.reputation_incidents i where i.id = any (s.incident_ids);
  perform public.incident_notify(
    s.user_id,
    case s.cause when 'cancellation_cycle' then
      case s.cycle when 3 then 'Exclusion définitive' else 'Compte suspendu' end
      else 'Compte suspendu' end,
    case s.cause when 'cancellation_cycle' then
      case s.cycle when 3 then 'Permanent exclusion' else 'Account suspended' end
      else 'Account suspended' end,
    case s.cause
      when 'cancellation_cycle' then
        'Motif : trois annulations tardives sans justificatif valable (' || coalesce(v_events_fr, '') || '). '
        || case s.cycle when 3 then 'Exclusion définitive.' else 'Suspension ' || v_until_fr || ' (heure de Douala).' end
        || ' Vos dossiers restent consultables. Recours : contestez cette décision depuis votre compte ou contactez le support.'
      when 'fraud' then
        'Motif : fraude présumée examinée par le support. Suspension ' || v_until_fr
        || '. Recours : contestez cette décision depuis votre compte ou contactez le support.'
      else
        'Votre compte a été suspendu par l''administration. Contactez le support pour plus d''information.'
    end,
    case s.cause
      when 'cancellation_cycle' then
        'Reason: three late cancellations without a valid proof (' || coalesce(v_events_en, '') || '). '
        || case s.cycle when 3 then 'Permanent exclusion.' else 'Suspension ' || v_until_en || ' (Douala time).' end
        || ' Your files remain available. Appeal: contest this decision from your account or contact support.'
      when 'fraud' then
        'Reason: suspected fraud reviewed by support. Suspension ' || v_until_en
        || '. Appeal: contest this decision from your account or contact support.'
      else
        'Your account was suspended by the administration. Contact support for more information.'
    end,
    jsonb_build_object('kind', 'account_suspension', 'suspension_id', s.id, 'cause', s.cause,
                       'cycle', s.cycle, 'ends_at', s.ends_at));
end;
$$;
revoke all on function public.suspension_notify(uuid) from public, anon, authenticated;

-- Cycles d'exclusion, recalculés depuis les manquements (rejeu
-- déterministe sur l'historique des suspensions déjà appliquées).
create or replace function public.candidate_cycle_reconcile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  s public.account_suspensions;
  v_last public.account_suspensions;
  v_return timestamptz;
  v_window uuid[];
  v_next smallint;
  v_id uuid;
  v_lifted integer := 0;
  v_created uuid;
  v_arbitration boolean := false;
begin
  select cp.id into v_profile from public.candidate_profiles cp where cp.user_id = p_user_id;
  if v_profile is null then
    return jsonb_build_object('created', null, 'lifted', 0);
  end if;
  -- 1. Cycle fondé sur un manquement annulé par recours : levé.
  for s in
    select x.* from public.account_suspensions x
    where x.user_id = p_user_id and x.cause = 'cancellation_cycle'
      and x.lift_kind is distinct from 'decision_voided'
      and exists (select 1 from public.reputation_incidents i
                  where i.id = any (x.incident_ids) and i.voided_at is not null)
    order by x.cycle
  loop
    update public.account_suspensions x
    set lifted_at = coalesce(x.lifted_at, now()), lift_kind = 'decision_voided',
        lift_reason = 'Manquement annulé après recours'
    where x.id = s.id;
    v_lifted := v_lifted + 1;
    if exists (select 1 from public.account_suspensions y
               where y.user_id = p_user_id and y.cause = 'cancellation_cycle'
                 and y.cycle > s.cycle and y.lift_kind is distinct from 'decision_voided') then
      v_arbitration := true;
      insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
      values (null, 'system', 'cancellation_cycle_arbitration_needed', 'account_suspensions', s.id,
              jsonb_build_object('user_id', p_user_id, 'voided_cycle', s.cycle));
    end if;
    perform public.incident_notify(p_user_id, 'Suspension levée', 'Suspension lifted',
      'Une suspension a été levée : un manquement retenu a été annulé après recours.',
      'A suspension was lifted: a recorded breach was cancelled on appeal.',
      jsonb_build_object('kind', 'account_suspension_lifted', 'suspension_id', s.id));
  end loop;

  -- 2. Nouveau cycle : trois manquements commis après le retour du cycle
  --    précédent, sans être déjà retenus.
  select x.* into v_last from public.account_suspensions x
  where x.user_id = p_user_id and x.cause = 'cancellation_cycle'
    and x.lift_kind is distinct from 'decision_voided'
  order by x.cycle desc limit 1;
  if v_last.id is not null then
    if v_last.cycle >= 3 then
      perform public.refresh_account_active(p_user_id);
      return jsonb_build_object('created', null, 'lifted', v_lifted, 'arbitration', v_arbitration);
    end if;
    v_return := coalesce(v_last.lifted_at, v_last.ends_at);
    if v_return is null or v_return > now() then
      -- Suspension en cours : les faits commis pendant la suspension ne
      -- comptent pas pour le cycle suivant (avant le retour).
      perform public.refresh_account_active(p_user_id);
      return jsonb_build_object('created', null, 'lifted', v_lifted, 'arbitration', v_arbitration);
    end if;
  end if;
  v_next := coalesce(v_last.cycle, 0) + 1;
  select array_agg(z.id order by z.occurred_at, z.id) into v_window
  from (
    select i.id, i.occurred_at from public.reputation_incidents i
    where i.subject_type = 'candidate' and i.subject_id = v_profile
      and i.kind = 'candidate_late_cancellation' and i.voided_at is null
      and (v_return is null or i.occurred_at >= v_return)
      and not exists (select 1 from public.account_suspensions x
                      where x.user_id = p_user_id and x.cause = 'cancellation_cycle'
                        and x.lift_kind is distinct from 'decision_voided'
                        and i.id = any (x.incident_ids))
    order by i.occurred_at, i.id
    limit 3
  ) z;
  if coalesce(cardinality(v_window), 0) >= 3 then
    insert into public.account_suspensions (user_id, cause, cycle, starts_at, ends_at, reason, incident_ids)
    values (p_user_id, 'cancellation_cycle', v_next, now(),
            case v_next when 1 then now() + interval '6 months'
                        when 2 then now() + interval '1 year' end,
            case v_next when 3 then 'Trois nouvelles annulations tardives sans justificatif valable après le deuxième retour : exclusion définitive.'
                        else 'Trois annulations tardives sans justificatif valable.' end,
            v_window)
    returning id into v_id;
    v_created := v_id;
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    values (null, 'system', 'cancellation_cycle_suspension', 'account_suspensions', v_id,
            jsonb_build_object('user_id', p_user_id, 'cycle', v_next, 'incident_ids', v_window,
                               'future_engagements', public.candidate_future_engagements(p_user_id)));
    perform public.suspension_notify(v_id);
  end if;
  perform public.refresh_account_active(p_user_id);
  return jsonb_build_object('created', v_created, 'lifted', v_lifted, 'arbitration', v_arbitration);
end;
$$;
revoke all on function public.candidate_cycle_reconcile(uuid) from public, anon, authenticated;

-- Échéances : compte réactivé seulement sans autre suspension en cours ;
-- fin notifiée une fois ; cycle suivant évalué (faits déjà commis après le
-- retour). Rattaché à la tâche planifiée existante.
create or replace function public.account_suspension_sweep(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.account_suspensions;
  v_count integer := 0;
begin
  for s in
    select x.* from public.account_suspensions x
    where x.ends_at is not null and x.ends_at <= p_at and x.lifted_at is null
      and x.ended_notified_at is null
    order by x.ends_at
    for update skip locked
  loop
    update public.account_suspensions x set ended_notified_at = p_at where x.id = s.id;
    if public.refresh_account_active(s.user_id, p_at) then
      perform public.incident_notify(s.user_id, 'Suspension terminée', 'Suspension ended',
        'Votre suspension est terminée : vous pouvez de nouveau postuler et travailler.',
        'Your suspension has ended: you can apply and work again.',
        jsonb_build_object('kind', 'account_suspension_ended', 'suspension_id', s.id));
    else
      perform public.incident_notify(s.user_id, 'Suspension terminée', 'Suspension ended',
        'Une suspension est terminée, mais une autre décision reste en cours sur votre compte.',
        'A suspension has ended, but another decision is still in force on your account.',
        jsonb_build_object('kind', 'account_suspension_ended', 'suspension_id', s.id));
    end if;
    if s.cause = 'cancellation_cycle' then
      perform public.candidate_cycle_reconcile(s.user_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.account_suspension_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.account_suspension_sweep(timestamptz) to service_role;

-- Suspension administrative (reprise de 20260911140000) : même signature,
-- mêmes messages ; désormais une cause « admin » parmi les autres.
create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_role text;
  v_was boolean;
  v_now boolean;
begin
  if not public.is_admin_user((select auth.uid())) then
    raise exception 'not authorized: admin only';
  end if;
  select role into v_role from public.users where id = (select auth.uid());
  if v_role not in ('admin_ops', 'admin_founder') then
    raise exception 'not authorized: role must be admin_ops or admin_founder';
  end if;
  if p_user_id = (select auth.uid()) or p_user_id is null then
    raise exception 'cannot modify own account';
  end if;
  select role, is_active into v_role, v_was from public.users where id = p_user_id for update;
  if v_role is null then
    raise exception 'user not found';
  end if;
  if v_role not in ('candidate', 'candidate_premium', 'company', 'company_premium') then
    raise exception 'cannot modify admin account';
  end if;

  if p_active then
    if not exists (select 1 from public.account_suspensions s
                   where s.user_id = p_user_id and s.cause = 'admin' and s.lifted_at is null) then
      if v_was is false then
        -- Compte suspendu pour une autre cause (cycle, fraude) : la levée
        -- passe par la suspension concernée.
        raise exception 'other_suspension_active';
      end if;
      return;
    end if;
    update public.account_suspensions s
    set lifted_at = now(), lifted_by = (select auth.uid()), lift_kind = 'admin',
        lift_reason = 'Réactivation administrative'
    where s.user_id = p_user_id and s.cause = 'admin' and s.lifted_at is null;
  else
    if exists (select 1 from public.account_suspensions s
               where s.user_id = p_user_id and s.cause = 'admin' and s.lifted_at is null) then
      return;
    end if;
    insert into public.account_suspensions (user_id, cause, reason, decided_by)
    values (p_user_id, 'admin', 'Suspension administrative', (select auth.uid()));
  end if;
  v_now := public.refresh_account_active(p_user_id);
  if v_now = v_was then
    -- Autre cause encore en cours : la levée administrative est tracée,
    -- le compte reste suspendu.
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    values ((select auth.uid()), (select role::text from public.users where id = (select auth.uid())),
            case when p_active then 'activate_user' else 'suspend_user' end, 'users', p_user_id,
            jsonb_build_object('was_active', v_was, 'is_active', v_now, 'other_cause', true));
    return;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values ((select auth.uid()), (select role::text from public.users where id = (select auth.uid())),
          case when v_now then 'activate_user' else 'suspend_user' end, 'users', p_user_id,
          jsonb_build_object('was_active', v_was, 'is_active', v_now));

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id, 'system',
    case when v_now then 'Compte réactivé' else 'Compte suspendu' end,
    case when v_now
      then 'Votre compte a été réactivé. Vous pouvez de nouveau postuler aux offres et travailler.'
      else 'Votre compte a été suspendu par l''administration. Vous ne pouvez plus postuler ni travailler. Contactez le support pour plus d''information.'
    end,
    jsonb_build_object('action', case when v_now then 'activate' else 'suspend' end));
end;
$body$;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Candidat : aperçu, demande, pièces, recours, contestation
-- ════════════════════════════════════════════════════════════════════
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
    and not exists (select 1 from public.candidate_cancellation_days cd where cd.mission_day_id = d.id)
  order by d.starts_at;
end;
$$;
revoke all on function public.candidate_cancellation_preview(uuid) from public, anon;
grant execute on function public.candidate_cancellation_preview(uuid) to authenticated;

create or replace function public.cancellation_apply_sanction(
  p_cancellation_id uuid, p_source text, p_decided_by uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.candidate_cancellations;
  v_day record;
  v_id uuid;
begin
  select x.* into c from public.candidate_cancellations x where x.id = p_cancellation_id;
  select i.id into v_id from public.reputation_incidents i where i.cancellation_id = c.id;
  if v_id is not null then
    return v_id;
  end if;
  select cd.mission_id, cd.starts_at, m.job_id into v_day
  from public.candidate_cancellation_days cd join public.missions m on m.id = cd.mission_id
  where cd.cancellation_id = c.id and cd.classification = 'late'
  order by cd.starts_at limit 1;
  insert into public.reputation_incidents (
    subject_type, subject_id, kind, source, mission_id, job_id,
    scheduled_start_at, occurred_at, decided_by, cancellation_id)
  values ('candidate', c.candidate_id, 'candidate_late_cancellation', p_source,
          v_day.mission_id, v_day.job_id, v_day.starts_at, c.created_at, p_decided_by, c.id)
  returning id into v_id;
  update public.candidate_cancellations x set incident_id = v_id, updated_at = now() where x.id = c.id;
  perform public.candidate_cycle_reconcile(c.candidate_user_id);
  return v_id;
end;
$$;
revoke all on function public.cancellation_apply_sanction(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.request_candidate_cancellation(
  p_request_id uuid,
  p_day_ids uuid[],
  p_reason_code text,
  p_reason_text text,
  p_evidence_choice text
)
returns table (
  cancellation_id uuid,
  status text,
  late_day_count integer,
  day_count integer,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
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

-- Pièce déposée par la route (clé service), après contrôle du propriétaire.
create or replace function public.record_cancellation_evidence(
  p_user_id uuid, p_cancellation_id uuid, p_path text, p_mime text, p_size integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.candidate_cancellations;
  v_id uuid;
begin
  select x.* into c from public.candidate_cancellations x where x.id = p_cancellation_id for update;
  if not found or c.candidate_user_id is distinct from p_user_id then
    raise exception 'cancellation_not_found';
  end if;
  if not (c.status in ('awaiting_evidence', 'under_review', 'closed_no_sanction')
          or (c.review_requested_at is not null and c.review_decided_at is null)) then
    raise exception 'cancellation_closed';
  end if;
  if (select count(*) from public.case_evidence e
      where e.case_type = 'cancellation' and e.case_id = c.id) >= 5 then
    raise exception 'evidence_limit';
  end if;
  insert into public.case_evidence (case_type, case_id, storage_path, mime_type, size_bytes,
                                    uploaded_by, uploaded_by_role)
  values ('cancellation', c.id, p_path, p_mime, p_size, p_user_id, 'candidate')
  returning id into v_id;
  if c.status = 'awaiting_evidence' then
    update public.candidate_cancellations x set status = 'under_review', updated_at = now()
    where x.id = c.id;
  else
    update public.candidate_cancellations x set updated_at = now() where x.id = c.id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_cancellation_evidence(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_cancellation_evidence(uuid, uuid, text, text, integer) to service_role;

create or replace function public.cancellation_review_deadline(c public.candidate_cancellations)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when c.status = 'refused' then c.decided_at + interval '7 days'
    when c.status = 'sanctioned_no_evidence' then c.created_at + interval '7 days'
  end;
$$;

create or replace function public.request_cancellation_review(p_cancellation_id uuid, p_note text)
returns table (cancellation_id uuid, review_requested_at timestamptz, already_requested boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.candidate_cancellations;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select x.* into c from public.candidate_cancellations x where x.id = p_cancellation_id for update;
  if not found or c.candidate_user_id <> v_uid then
    raise exception 'cancellation_not_found';
  end if;
  if c.review_requested_at is not null then
    return query select c.id, c.review_requested_at, true;
    return;
  end if;
  if c.status not in ('refused', 'sanctioned_no_evidence') then
    raise exception 'review_not_available';
  end if;
  if now() > public.cancellation_review_deadline(c) then
    raise exception 'review_deadline_passed';
  end if;
  if length(v_note) < 10 or length(v_note) > 1000 then
    raise exception 'note_invalid';
  end if;
  update public.candidate_cancellations x
  set review_requested_at = now(), review_note = v_note, updated_at = now()
  where x.id = c.id returning x.* into c;
  return query select c.id, c.review_requested_at, false;
end;
$$;
revoke all on function public.request_cancellation_review(uuid, text) from public, anon;
grant execute on function public.request_cancellation_review(uuid, text) to authenticated;

create or replace function public.cancellation_json(c public.candidate_cancellations, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'created_at', c.created_at,
    'job_id', c.job_id,
    'job_title', (select j.title from public.jobs j where j.id = c.job_id),
    'status', c.status,
    'day_count', c.day_count,
    'late_day_count', c.late_day_count,
    'reason_code', c.reason_code,
    'reason_text', c.reason_text,
    'evidence_choice', c.evidence_choice,
    'evidence_count', (select count(*) from public.case_evidence e
                       where e.case_type = 'cancellation' and e.case_id = c.id),
    'decided_at', c.decided_at,
    'decision_note', c.decision_note,
    'sanctioned', exists (select 1 from public.reputation_incidents i
                          where i.cancellation_id = c.id and i.voided_at is null),
    'review_requested_at', c.review_requested_at,
    'review_note', c.review_note,
    'review_deadline_at', public.cancellation_review_deadline(c),
    'review_decided_at', c.review_decided_at,
    'review_outcome', c.review_outcome,
    'review_decision_note', c.review_decision_note,
    'days', (select jsonb_agg(jsonb_build_object(
               'mission_day_id', cd.mission_day_id, 'mission_id', cd.mission_id,
               'starts_at', cd.starts_at, 'classification', cd.classification,
               'deadline_at', cd.deadline_at, 'reaction_until', cd.reaction_until)
               || case when p_admin then jsonb_build_object(
                    'candidate_plan', cd.candidate_plan, 'terms_source', cd.terms_source)
                  else '{}'::jsonb end
             order by cd.starts_at)
             from public.candidate_cancellation_days cd where cd.cancellation_id = c.id)
  ) || case when p_admin then jsonb_build_object(
    'candidate_user_id', c.candidate_user_id,
    'candidate_id', c.candidate_id,
    'candidate_name', (select concat_ws(' ', cp.first_name, cp.last_name)
                       from public.candidate_profiles cp where cp.id = c.candidate_id),
    'decided_by', c.decided_by,
    'review_decided_by', c.review_decided_by,
    'incident_id', c.incident_id,
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', e.id, 'mime_type', e.mime_type, 'size_bytes', e.size_bytes,
                   'uploaded_by_role', e.uploaded_by_role, 'created_at', e.created_at)
                   order by e.created_at), '[]'::jsonb)
                 from public.case_evidence e where e.case_type = 'cancellation' and e.case_id = c.id)
  ) else '{}'::jsonb end;
$$;
revoke all on function public.cancellation_json(public.candidate_cancellations, boolean) from public, anon, authenticated;

create or replace function public.my_candidate_cancellations(p_mission_id uuid default null)
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
  return jsonb_build_object(
    'server_now', now(),
    'cancellations', coalesce((
      select jsonb_agg(public.cancellation_json(c, false) order by c.created_at desc)
      from public.candidate_cancellations c
      where c.candidate_user_id = v_uid
        and (p_mission_id is null or exists (
          select 1 from public.candidate_cancellation_days cd
          join public.missions m on m.id = cd.mission_id
          join public.missions m2 on m2.job_id = m.job_id and m2.candidate_id = m.candidate_id
          where cd.cancellation_id = c.id and m2.id = p_mission_id))
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.my_candidate_cancellations(uuid) from public, anon;
grant execute on function public.my_candidate_cancellations(uuid) to authenticated;

create or replace function public.my_account_suspensions()
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
  return jsonb_build_object(
    'server_now', now(),
    'suspensions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'cause', s.cause, 'cycle', s.cycle, 'starts_at', s.starts_at,
        'ends_at', s.ends_at, 'reason', s.reason,
        'active', public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now()),
        'lifted_at', s.lifted_at, 'lift_kind', s.lift_kind,
        'events', (select coalesce(jsonb_agg(i.occurred_at order by i.occurred_at), '[]'::jsonb)
                   from public.reputation_incidents i where i.id = any (s.incident_ids)),
        'contested_at', s.contested_at, 'contest_outcome', s.contest_outcome,
        'contest_decision_note', s.contest_decision_note)
        order by s.starts_at desc)
      from public.account_suspensions s
      where s.user_id = v_uid and s.cause <> 'admin'
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.my_account_suspensions() from public, anon;
grant execute on function public.my_account_suspensions() to authenticated;

create or replace function public.contest_account_suspension(p_suspension_id uuid, p_note text)
returns table (suspension_id uuid, contested_at timestamptz, already_contested boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s public.account_suspensions;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select x.* into s from public.account_suspensions x where x.id = p_suspension_id for update;
  if not found or s.user_id <> v_uid or s.cause = 'admin' then
    raise exception 'suspension_not_found';
  end if;
  if s.contested_at is not null then
    return query select s.id, s.contested_at, true;
    return;
  end if;
  if s.lifted_at is not null then
    raise exception 'suspension_not_active';
  end if;
  if length(v_note) < 10 or length(v_note) > 1000 then
    raise exception 'note_invalid';
  end if;
  update public.account_suspensions x set contested_at = now(), contest_note = v_note
  where x.id = s.id returning x.* into s;
  return query select s.id, s.contested_at, false;
end;
$$;
revoke all on function public.contest_account_suspension(uuid, text) from public, anon;
grant execute on function public.contest_account_suspension(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Support : lecture, décision, recours, fraude, suspensions
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_candidate_cancellations(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('server_now', now(), 'cancellations', coalesce((
    select jsonb_agg(public.cancellation_json(c, true) order by c.created_at desc)
    from (select x.* from public.candidate_cancellations x
          where p_status is null
             or (p_status = 'to_review' and (x.status = 'under_review'
                 or (x.review_requested_at is not null and x.review_decided_at is null)))
             or x.status = p_status
          order by x.created_at desc limit 200) c
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_candidate_cancellations(text) from public, anon;
grant execute on function public.admin_candidate_cancellations(text) to authenticated;

create or replace function public.admin_candidate_cancellation(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.candidate_cancellations;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select x.* into c from public.candidate_cancellations x where x.id = p_id;
  if not found then
    raise exception 'cancellation_not_found';
  end if;
  return public.cancellation_json(c, true) || jsonb_build_object(
    'server_now', now(),
    'fraud_reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'reason', f.reason, 'status', f.status,
               'created_at', f.created_at, 'created_by_role', f.created_by_role,
               'evidence', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id,
                              'mime_type', e.mime_type, 'created_at', e.created_at)), '[]'::jsonb)
                            from public.case_evidence e where e.case_type = 'fraud' and e.case_id = f.id))
             order by f.created_at)
      from public.fraud_reports f where f.subject_user_id = c.candidate_user_id), '[]'::jsonb),
    'suspensions', public.admin_account_suspensions_json(c.candidate_user_id),
    'late_cancellation_count', (select count(*) from public.reputation_incidents i
      where i.subject_type = 'candidate' and i.subject_id = c.candidate_id
        and i.kind = 'candidate_late_cancellation' and i.voided_at is null),
    'future_engagements', public.candidate_future_engagements(c.candidate_user_id));
end;
$$;

create or replace function public.admin_account_suspensions_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'cause', s.cause, 'cycle', s.cycle, 'starts_at', s.starts_at,
    'ends_at', s.ends_at, 'reason', s.reason, 'incident_ids', s.incident_ids,
    'fraud_report_id', s.fraud_report_id, 'decided_by', s.decided_by,
    'active', public.account_suspension_is_active(s.lifted_at, s.starts_at, s.ends_at, now()),
    'lifted_at', s.lifted_at, 'lift_kind', s.lift_kind, 'lift_reason', s.lift_reason,
    'contested_at', s.contested_at, 'contest_note', s.contest_note,
    'contest_outcome', s.contest_outcome, 'contest_decided_at', s.contest_decided_at)
    order by s.starts_at), '[]'::jsonb)
  from public.account_suspensions s where s.user_id = p_user_id;
$$;
revoke all on function public.admin_account_suspensions_json(uuid) from public, anon, authenticated;
revoke all on function public.admin_candidate_cancellation(uuid) from public, anon;
grant execute on function public.admin_candidate_cancellation(uuid) to authenticated;

create or replace function public.admin_account_suspensions(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('server_now', now(),
    'suspensions', public.admin_account_suspensions_json(p_user_id),
    'future_engagements', public.candidate_future_engagements(p_user_id),
    'fraud_reports', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'reason', f.reason,
        'status', f.status, 'created_at', f.created_at, 'cancellation_id', f.cancellation_id)
        order by f.created_at) from public.fraud_reports f where f.subject_user_id = p_user_id), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_account_suspensions(uuid) from public, anon;
grant execute on function public.admin_account_suspensions(uuid) to authenticated;

create or replace function public.admin_case_evidence_path(p_evidence_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select e.storage_path into v_path from public.case_evidence e where e.id = p_evidence_id;
  if v_path is null then
    raise exception 'evidence_not_found';
  end if;
  return v_path;
end;
$$;
revoke all on function public.admin_case_evidence_path(uuid) from public, anon;
grant execute on function public.admin_case_evidence_path(uuid) to authenticated;

create or replace function public.admin_decide_candidate_cancellation(
  p_id uuid, p_decision text, p_note text)
returns table (cancellation_id uuid, status text, sanctioned boolean, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.candidate_cancellations;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'refused') then
    raise exception 'decision_invalid';
  end if;
  if length(v_note) < 10 or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select x.* into c from public.candidate_cancellations x where x.id = p_id for update;
  if not found then
    raise exception 'cancellation_not_found';
  end if;
  if c.status in ('accepted', 'refused') then
    if c.status <> p_decision then
      raise exception 'already_decided';
    end if;
    return query select c.id, c.status, c.incident_id is not null, true;
    return;
  end if;
  if c.status <> 'under_review' then
    raise exception 'cancellation_not_reviewable';
  end if;
  update public.candidate_cancellations x
  set status = p_decision, decided_at = now(), decided_by = v_uid, decision_note = v_note,
      updated_at = now()
  where x.id = c.id returning x.* into c;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'decide_candidate_cancellation', 'candidate_cancellations', c.id,
          jsonb_build_object('decision', p_decision));
  if p_decision = 'refused' then
    perform public.cancellation_apply_sanction(c.id, 'support_decision', v_uid);
  end if;
  perform public.incident_notify(c.candidate_user_id,
    case p_decision when 'accepted' then 'Justificatif accepté' else 'Justificatif refusé' end,
    case p_decision when 'accepted' then 'Proof accepted' else 'Proof refused' end,
    case p_decision when 'accepted'
      then 'Votre justificatif est accepté : aucune sanction pour cette annulation.'
      else 'Votre justificatif est refusé : ' || v_note || ' Un manquement est retenu (−5 unités d''expérience). Recours possible pendant 7 jours.' end,
    case p_decision when 'accepted'
      then 'Your proof is accepted: no sanction for this cancellation.'
      else 'Your proof is refused: ' || v_note || ' A breach is recorded (−5 experience units). You may appeal within 7 days.' end,
    jsonb_build_object('kind', 'candidate_cancellation_decision', 'cancellation_id', c.id,
                       'decision', p_decision));
  return query select c.id, c.status, p_decision = 'refused', false;
end;
$$;
revoke all on function public.admin_decide_candidate_cancellation(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_candidate_cancellation(uuid, text, text) to authenticated;

create or replace function public.admin_decide_cancellation_review(
  p_id uuid, p_outcome text, p_note text)
returns table (cancellation_id uuid, review_outcome text, sanction_voided boolean, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.candidate_cancellations;
  v_note text := btrim(coalesce(p_note, ''));
  v_voided boolean := false;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('maintained', 'overturned') then
    raise exception 'decision_invalid';
  end if;
  if length(v_note) < 10 or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select x.* into c from public.candidate_cancellations x where x.id = p_id for update;
  if not found then
    raise exception 'cancellation_not_found';
  end if;
  if c.review_requested_at is null then
    raise exception 'review_not_requested';
  end if;
  if c.review_decided_at is not null then
    if c.review_outcome <> p_outcome then
      raise exception 'already_decided';
    end if;
    return query select c.id, c.review_outcome, c.review_outcome = 'overturned', true;
    return;
  end if;
  if c.decided_by = v_uid then
    raise exception 'reviewer_must_differ';
  end if;
  update public.candidate_cancellations x
  set review_decided_at = now(), review_decided_by = v_uid, review_outcome = p_outcome,
      review_decision_note = v_note, updated_at = now()
  where x.id = c.id returning x.* into c;
  if p_outcome = 'overturned' then
    update public.reputation_incidents i
    set voided_at = now(), voided_by = v_uid, void_reason = 'Recours accepté : ' || v_note
    where i.cancellation_id = c.id and i.voided_at is null;
    v_voided := found;
    perform public.candidate_cycle_reconcile(c.candidate_user_id);
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'decide_cancellation_review', 'candidate_cancellations', c.id,
          jsonb_build_object('outcome', p_outcome, 'voided', v_voided));
  perform public.incident_notify(c.candidate_user_id,
    case p_outcome when 'overturned' then 'Recours accepté' else 'Recours rejeté' end,
    case p_outcome when 'overturned' then 'Appeal accepted' else 'Appeal rejected' end,
    case p_outcome when 'overturned'
      then 'Votre recours est accepté : le manquement est annulé et votre réputation recalculée.'
      else 'Votre recours est rejeté : ' || v_note end,
    case p_outcome when 'overturned'
      then 'Your appeal is accepted: the breach is cancelled and your reputation recalculated.'
      else 'Your appeal is rejected: ' || v_note end,
    jsonb_build_object('kind', 'candidate_cancellation_review', 'cancellation_id', c.id,
                       'outcome', p_outcome));
  return query select c.id, c.review_outcome, v_voided, false;
end;
$$;
revoke all on function public.admin_decide_cancellation_review(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_cancellation_review(uuid, text, text) to authenticated;

-- Fraude présumée : signalement par tout admin actif. Un justificatif
-- refusé n'en est pas la preuve ; aucune suspension automatique.
create or replace function public.admin_report_fraud(
  p_subject_user_id uuid, p_cancellation_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'note_invalid';
  end if;
  if not exists (select 1 from public.users u where u.id = p_subject_user_id
                 and u.role::text in ('candidate', 'candidate_premium', 'company', 'company_premium')) then
    raise exception 'user_not_found';
  end if;
  if p_cancellation_id is not null and not exists (
    select 1 from public.candidate_cancellations c
    where c.id = p_cancellation_id and c.candidate_user_id = p_subject_user_id) then
    raise exception 'cancellation_not_found';
  end if;
  insert into public.fraud_reports (subject_user_id, cancellation_id, reason, created_by, created_by_role)
  values (p_subject_user_id, p_cancellation_id, v_reason, v_uid,
          (select u.role::text from public.users u where u.id = v_uid))
  returning id into v_id;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'report_fraud', 'fraud_reports', v_id,
          jsonb_build_object('subject_user_id', p_subject_user_id, 'cancellation_id', p_cancellation_id));
  return v_id;
end;
$$;
revoke all on function public.admin_report_fraud(uuid, uuid, text) from public, anon;
grant execute on function public.admin_report_fraud(uuid, uuid, text) to authenticated;

create or replace function public.record_fraud_evidence(
  p_user_id uuid, p_report_id uuid, p_path text, p_mime text, p_size integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin_user(p_user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fraud_reports f where f.id = p_report_id) then
    raise exception 'fraud_report_not_found';
  end if;
  insert into public.case_evidence (case_type, case_id, storage_path, mime_type, size_bytes,
                                    uploaded_by, uploaded_by_role)
  values ('fraud', p_report_id, p_path, p_mime, p_size, p_user_id,
          (select u.role::text from public.users u where u.id = p_user_id))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_fraud_evidence(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_fraud_evidence(uuid, uuid, text, text, integer) to service_role;

-- Suspension pour fraude décidée par un ops/founder actif : signalement
-- exigé, fin explicite ou aucune fin (jusqu'à levée), motif conservé.
create or replace function public.admin_suspend_for_fraud(
  p_report_id uuid, p_ends_at timestamptz, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  f public.fraud_reports;
  v_id uuid;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'note_invalid';
  end if;
  if p_ends_at is not null and (p_ends_at <= now() or p_ends_at >= timestamptz '10000-01-01 00:00:00+00') then
    raise exception 'period_invalid';
  end if;
  select x.* into f from public.fraud_reports x where x.id = p_report_id for update;
  if not found then
    raise exception 'fraud_report_not_found';
  end if;
  perform 1 from public.users u where u.id = f.subject_user_id for update;
  if exists (select 1 from public.account_suspensions s where s.fraud_report_id = f.id
             and s.lifted_at is null) then
    select s.id into v_id from public.account_suspensions s
    where s.fraud_report_id = f.id and s.lifted_at is null limit 1;
    return v_id;
  end if;
  insert into public.account_suspensions (user_id, cause, ends_at, reason, fraud_report_id, decided_by)
  values (f.subject_user_id, 'fraud', p_ends_at, v_reason, f.id, v_uid)
  returning id into v_id;
  perform public.refresh_account_active(f.subject_user_id);
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'suspend_for_fraud', 'account_suspensions', v_id,
          jsonb_build_object('user_id', f.subject_user_id, 'fraud_report_id', f.id, 'ends_at', p_ends_at,
                             'future_engagements', public.candidate_future_engagements(f.subject_user_id)));
  perform public.suspension_notify(v_id);
  return v_id;
end;
$$;
revoke all on function public.admin_suspend_for_fraud(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_suspend_for_fraud(uuid, timestamptz, text) to authenticated;

-- Levée d'une suspension (fraude, cycle) par un ops/founder actif, ou
-- décision sur une contestation.
create or replace function public.admin_lift_suspension(
  p_suspension_id uuid, p_reason text, p_from_contest boolean default false)
returns table (suspension_id uuid, account_active boolean, already_lifted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  s public.account_suspensions;
  v_active boolean;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'note_invalid';
  end if;
  select x.* into s from public.account_suspensions x where x.id = p_suspension_id for update;
  if not found or s.cause = 'admin' then
    raise exception 'suspension_not_found';
  end if;
  perform 1 from public.users u where u.id = s.user_id for update;
  if s.lifted_at is not null then
    return query select s.id, (select u.is_active from public.users u where u.id = s.user_id), true;
    return;
  end if;
  update public.account_suspensions x
  set lifted_at = now(), lifted_by = v_uid,
      lift_kind = case when p_from_contest then 'contest' else 'admin' end,
      lift_reason = v_reason,
      contest_decided_at = case when p_from_contest then now() else x.contest_decided_at end,
      contest_decided_by = case when p_from_contest then v_uid else x.contest_decided_by end,
      contest_outcome = case when p_from_contest then 'lifted' else x.contest_outcome end,
      contest_decision_note = case when p_from_contest then v_reason else x.contest_decision_note end
  where x.id = s.id;
  v_active := public.refresh_account_active(s.user_id);
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'lift_suspension', 'account_suspensions', s.id,
          jsonb_build_object('user_id', s.user_id, 'cause', s.cause, 'account_active', v_active,
                             'from_contest', p_from_contest));
  perform public.incident_notify(s.user_id, 'Suspension levée', 'Suspension lifted',
    'Une suspension a été levée par le support : ' || v_reason
      || case when v_active then '' else ' Une autre décision reste en cours.' end,
    'A suspension was lifted by support: ' || v_reason
      || case when v_active then '' else ' Another decision is still in force.' end,
    jsonb_build_object('kind', 'account_suspension_lifted', 'suspension_id', s.id));
  if s.cause = 'cancellation_cycle' then
    perform public.candidate_cycle_reconcile(s.user_id);
  end if;
  return query select s.id, v_active, false;
end;
$$;
revoke all on function public.admin_lift_suspension(uuid, text, boolean) from public, anon;
grant execute on function public.admin_lift_suspension(uuid, text, boolean) to authenticated;

create or replace function public.admin_maintain_suspension(p_suspension_id uuid, p_note text)
returns table (suspension_id uuid, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  s public.account_suspensions;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_note) < 10 or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select x.* into s from public.account_suspensions x where x.id = p_suspension_id for update;
  if not found or s.contested_at is null then
    raise exception 'suspension_not_found';
  end if;
  if s.contest_decided_at is not null then
    return query select s.id, true;
    return;
  end if;
  update public.account_suspensions x
  set contest_decided_at = now(), contest_decided_by = v_uid, contest_outcome = 'maintained',
      contest_decision_note = v_note
  where x.id = s.id;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'maintain_suspension', 'account_suspensions', s.id, jsonb_build_object('user_id', s.user_id));
  perform public.incident_notify(s.user_id, 'Contestation examinée', 'Contest reviewed',
    'Votre contestation est examinée : la suspension est maintenue. ' || v_note,
    'Your contest was reviewed: the suspension is maintained. ' || v_note,
    jsonb_build_object('kind', 'account_suspension_contest', 'suspension_id', s.id));
  return query select s.id, false;
end;
$$;
revoke all on function public.admin_maintain_suspension(uuid, text) from public, anon;
grant execute on function public.admin_maintain_suspension(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Montant acquis d'un forfait (contrat figé)
-- ════════════════════════════════════════════════════════════════════
-- Durée prévue d'une journée : fin − début du contrat, en minutes ; fin
-- inférieure ou égale au début → le lendemain (journée de nuit). La pause
-- (break_minutes, unique pour l'offre) n'est pas déduite.
create or replace function public.contract_day_minutes(p_start time, p_end time)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (extract(epoch from (p_end - p_start))::integer / 60)
         + case when p_end <= p_start then 1440 else 0 end;
$$;

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
  v_partial boolean := false;
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
           exists (select 1 from public.candidate_cancellation_days cd where cd.mission_day_id = d.id) as cancelled,
           exists (select 1 from public.mission_incidents i where i.mission_day_id = d.id
                   and i.outcome = 'partial') as partial
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
    if public.completion_counts(x.completion_source) then
      v_done := v_done + public.contract_day_minutes(x.st, x.et);
    elsif x.partial and not x.cancelled then
      v_partial := true;
    elsif not x.cancelled then
      v_pending := true;
    end if;
    v_days := v_days || jsonb_build_object(
      'date', x.day_date, 'start_time', x.st, 'end_time', x.et,
      'planned_minutes', public.contract_day_minutes(x.st, x.et),
      'realized', public.completion_counts(x.completion_source),
      'realized_via', case when public.completion_counts(x.completion_source) then x.completion_source end,
      'cancelled', x.cancelled,
      'partial_pending_review', x.partial and not public.completion_counts(x.completion_source));
  end loop;

  v_exact := case when v_total > 0 then v_pay * v_done / v_total else 0 end;
  return jsonb_build_object(
    'mission_id', v_mission.id,
    'currency', coalesce(v_contract.contract_data ->> 'currency', 'XAF'),
    'contract_pay', v_pay,
    'planned_minutes_total', v_total,
    'realized_minutes', v_done,
    'acquired_exact', round(v_exact, 4),
    'acquired_rounded', round(v_exact),
    'is_integer', v_exact = trunc(v_exact),
    'status', case when v_partial then 'provisional_partial_review'
                   when v_pending then 'in_progress' else 'final' end,
    'rounding', 'half_up_to_validate',
    'duration_convention', 'gross_scheduled_minutes_break_not_deducted',
    'days', v_days);
end;
$$;
revoke all on function public.mission_acquired_amount(uuid) from public, anon;
grant execute on function public.mission_acquired_amount(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 9. Entreprise : journées annulées de ses offres (sans motif ni plan)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.company_job_cancellations(p_job_id uuid)
returns table (mission_id uuid, mission_day_id uuid, cancelled_at timestamptz)
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
  select cd.mission_id, cd.mission_day_id, c.created_at
  from public.candidate_cancellation_days cd
  join public.candidate_cancellations c on c.id = cd.cancellation_id
  where c.job_id = p_job_id
  order by cd.starts_at;
end;
$$;
revoke all on function public.company_job_cancellations(uuid) from public, anon;
grant execute on function public.company_job_cancellations(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Signaux temps réel (domaines existants, charge utile {d, r})
-- ════════════════════════════════════════════════════════════════════
create or replace function public.rt_on_candidate_cancellations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select cp.user_id into v_company from public.jobs j
  join public.company_profiles cp on cp.id = j.company_id where j.id = new.job_id;
  perform public.rt_signal_users(array[new.candidate_user_id], 'missions', new.id);
  if tg_op = 'INSERT' then
    perform public.rt_signal_users(array[v_company], 'missions', null);
  end if;
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_candidate_cancellations() from public, anon, authenticated;
drop trigger if exists trg_rt_candidate_cancellations on public.candidate_cancellations;
create trigger trg_rt_candidate_cancellations
  after insert or update on public.candidate_cancellations
  for each row execute function public.rt_on_candidate_cancellations();

create or replace function public.rt_on_account_suspensions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[new.user_id], 'account', new.user_id);
  perform public.rt_signal_admin('account');
  return null;
end;
$$;
revoke all on function public.rt_on_account_suspensions() from public, anon, authenticated;
drop trigger if exists trg_rt_account_suspensions on public.account_suspensions;
create trigger trg_rt_account_suspensions
  after insert or update on public.account_suspensions
  for each row execute function public.rt_on_account_suspensions();

-- ════════════════════════════════════════════════════════════════════
-- 11. Tâche planifiée existante : échéances des suspensions
-- ════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('reputation-expiry-sweep')
      where exists (select 1 from cron.job where jobname = 'reputation-expiry-sweep');
      perform cron.schedule(
        'reputation-expiry-sweep',
        '*/15 * * * *',
        $cron$select public.reputation_expiry_sweep(); select public.incident_deadline_sweep(); select public.account_suspension_sweep();$cron$
      );
    exception when others then
      raise notice 'pg_cron : account_suspension_sweep à planifier manuellement.';
    end;
  else
    raise notice 'pg_cron absent : account_suspension_sweep à planifier avec reputation_expiry_sweep.';
  end if;
end $$;
