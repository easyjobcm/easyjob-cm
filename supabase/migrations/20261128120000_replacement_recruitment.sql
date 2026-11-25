-- Migration : recrutement de remplacement après désistement (lot 17d-4a)
-- Date : 2026-11-25 (date de rédaction ; l'horodatage ordonne seulement)
-- Tables affectées :
--   replacement_cycles, replacement_cycle_sources, replacement_cycle_events,
--   replacement_cycle_notices (nouvelles, fermées aux sessions et aux
--   écritures de la clé service) ;
--   job_applications (confirmation d'intérêt liée à un cycle, index
--   d'unicité restreints aux candidatures hors cycle) ;
--   fonctions reprises : apply_to_job_core, withdraw_job_application,
--   job_days_for_candidate, company_job_applicants, selection_prepare,
--   contract_select_core, request_candidate_cancellation,
--   reputation_company_offers, reputation_company_next_close,
--   request_company_cancellation, job_availability.
--
-- Décisions (docs/product/DECISIONS.md) : ANN-14 (`[UV]` 2026-11-20 :
-- principe, destinataires, confirmations, journées au choix) ; ANN-20
-- (`[UV]` 2026-11-25 : le candidat à l'origine du désistement ne revient
-- pas sur les journées abandonnées) ; ECH-01, ECH-02, ECH-06, ECH-07,
-- ECH-09, CTR-02, MNT-01, MNT-09 (non appliqué d'office), REP-04, DON-04.
-- Livraison partielle d'ANN-14 : avis dans l'application seulement ; aucun
-- e-mail (17d-4b, ANN-21). Période commencée (ANN-19) : non traitée ici.
--
--   1. Déclencheur unique : désistement enregistré d'un candidat
--      sélectionné (request_candidate_cancellation) qui libère toute sa
--      mission : journée au choix, ou période complète entièrement libérée
--      avant son début. Aucune autre origine (absence, suspension, entreprise,
--      support) n'ouvre de cycle.
--   2. Ouverture s'il reste au moins 4 h avant le début concerné (limite
--      incluse) ; fermeture à H−2 (refus à l'instant exact). Journées au
--      choix : début de la journée libérée. Fenêtre propre au cycle, figée à
--      l'ouverture : horaires, première publication, régime et échéance
--      initiale de l'offre ne sont jamais écrits.
--   3. Un cycle par portée (offre ou journée) ; chaque désistement est une
--      source tracée (une par mission) ; places ouvertes = places libérées −
--      places pourvues dans le cycle, bornées par les places restantes de
--      l'offre ou de la journée (une place jamais pourvue n'est pas rouverte).
--   4. Avis dans l'application dans la transaction du désistement, une fois
--      par cycle et par destinataire (ANN-14) ; retenus si l'entreprise ne
--      peut pas recruter à l'ouverture (modalité à décider, aucun renvoi).
--   5. Confirmation d'intérêt explicite : nouvelle candidature liée au
--      cycle ; ancienne candidature conservée telle quelle, jamais réactivée.
--   6. « Signer et sélectionner » : fenêtre du cycle, places, entreprise,
--      profil, CNI, documents, compte, disponibilité et marge de 3 h
--      revérifiés en base ; nouveau contrat par le parcours existant.
--   7. Annulation par l'entreprise (ANN-08, dates entières) d'une date de
--      la portée d'un cycle : places non pourvues neutralisées et cycle
--      fermé dans la même transaction (refus replacement_cancelled) ;
--      aucun cycle n'est ouvert sur une portée dont une date est annulée.
--   8. Entreprise non autorisée : dossier non valide → règles existantes
--      (offre invisible, confirmation et sélection refusées) et avis
--      retenus à titre provisoire (ANN-22, à décider) ; compte suspendu →
--      seule la sélection est refusée (règle existante), avis envoyés.
--   9. Relance concurrente d'un même identifiant de demande (désistement,
--      annulation par l'entreprise) : résultat d'origine, sans écriture.
--  10. Date entière annulée par l'entreprise (company_date_cancelled ; un
--      retrait ciblé par le support n'en est pas une) : plus aucune
--      candidature ni sélection ordinaire ou de remplacement qui l'inclut,
--      même échéance initiale ouverte (date_cancelled) ; état lu par
--      job_days_for_candidate, company_job_applicants, job_availability et
--      la liste publique ; offre verrouillée en exclusif par l'annulation ;
--      signal temps réel de l'offre.
--
-- Rollback :
--   recréer depuis leur migration d'origine : apply_to_job_core,
--     job_days_for_candidate, reputation_company_next_close (20261113120000) ;
--     withdraw_job_application, company_job_applicants, selection_prepare,
--     contract_select_core (20261116120000) ; reputation_company_offers
--     (20261120120000) ; request_candidate_cancellation (20261127120000) ;
--     request_company_cancellation (20261126120000) ; job_availability
--     (20261124120000) ; job_days_for_candidate (20261113120000, type de retour) ;
--   drop trigger trg_rt_company_date_cancellation on public.company_cancellations ;
--   drop index idx_company_cancellation_days_job_date ;
--   drop trigger trg_replacement_on_selection, trg_guard_replacement_application
--     on public.job_applications ;
--   drop index job_applications_cycle_candidate_key ; recréer
--     job_applications_job_candidate_key et job_applications_day_candidate_key
--     sans « replacement_cycle_id is null » (20261113120000) ;
--   alter table public.job_applications drop constraint
--     job_applications_replacement_chk, drop column previous_application_id,
--     drop column interest_origin, drop column interest_confirmed_at,
--     drop column replacement_cycle_id ;
--   drop table public.replacement_cycle_notices, public.replacement_cycle_events,
--     public.replacement_cycle_sources, public.replacement_cycles ;
--   drop function … (fonctions créées ci-dessous).

-- ════════════════════════════════════════════════════════════════════
-- 1. Cycles de remplacement
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.replacement_cycles (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Journée libérée (journées au choix) ; vide : période complète.
  job_day_id uuid references public.job_days(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  -- Début concerné et fermeture (H−2), figés à l'ouverture.
  starts_at timestamptz not null,
  closes_at timestamptz not null,
  places_released integer not null default 1 check (places_released >= 1),
  places_filled integer not null default 0 check (places_filled >= 0),
  -- Places neutralisées par une annulation de l'entreprise (ANN-08 : dates
  -- entières) portant sur la portée du cycle, et cette annulation.
  places_cancelled integer not null default 0 check (places_cancelled >= 0),
  cancelled_at timestamptz,
  company_cancellation_id uuid references public.company_cancellations(id) on delete set null,
  opened_at timestamptz not null default now(),
  constraint replacement_cycles_closes_chk check (closes_at = starts_at - interval '2 hours'),
  constraint replacement_cycles_opened_chk check (starts_at - opened_at >= interval '4 hours'),
  constraint replacement_cycles_places_chk check (places_filled + places_cancelled <= places_released),
  constraint replacement_cycles_cancelled_chk check (
    cancelled_at is not null or (places_cancelled = 0 and company_cancellation_id is null))
);
-- Un cycle par portée : plusieurs désistements ne créent ni second cycle
-- ni seconde échéance.
create unique index if not exists replacement_cycles_scope_key
  on public.replacement_cycles (job_id, coalesce(job_day_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_replacement_cycles_company on public.replacement_cycles (company_id);

-- Une source par mission libérée (relance et concurrence : unicité).
create table if not exists public.replacement_cycle_sources (
  mission_id uuid primary key references public.missions(id) on delete cascade,
  cycle_id uuid not null references public.replacement_cycles(id) on delete cascade,
  cancellation_id uuid not null references public.candidate_cancellations(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_replacement_cycle_sources_cycle on public.replacement_cycle_sources (cycle_id);

-- Journal du cycle (ajout seul).
create table if not exists public.replacement_cycle_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.replacement_cycles(id) on delete cascade,
  kind text not null check (kind in ('opened', 'place_added', 'alerts_sent', 'alerts_withheld', 'place_filled',
                                     'company_cancelled')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_replacement_cycle_events_cycle on public.replacement_cycle_events (cycle_id, created_at);

-- Avis émis : une ligne par cycle, destinataire et nature (dédoublonnage).
create table if not exists public.replacement_cycle_notices (
  cycle_id uuid not null references public.replacement_cycles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('candidate_alert', 'company_opened')),
  created_at timestamptz not null default now(),
  primary key (cycle_id, user_id, kind)
);

do $$
declare
  t text;
begin
  foreach t in array array['replacement_cycles', 'replacement_cycle_sources',
                           'replacement_cycle_events', 'replacement_cycle_notices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from service_role', t);
  end loop;
end $$;

-- Écrites par les seules fonctions de la base. Seuls les compteurs d'un
-- cycle évoluent ; le reste est en ajout seul.
create or replace function public.protect_replacement_cycle_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception '%: written by the database only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and tg_table_name <> 'replacement_cycles' then
    return new;
  end if;
  if tg_op = 'UPDATE' and tg_table_name <> 'replacement_cycles' then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.job_id, new.job_day_id, new.company_id, new.starts_at, new.closes_at, new.opened_at)
       is distinct from
       (old.job_id, old.job_day_id, old.company_id, old.starts_at, old.closes_at, old.opened_at)
       or new.places_released < old.places_released
       or new.places_filled < old.places_filled
       or new.places_cancelled < old.places_cancelled
       -- Une annulation enregistrée ne se lève jamais.
       or (old.cancelled_at is not null
           and (new.cancelled_at, new.company_cancellation_id)
               is distinct from (old.cancelled_at, old.company_cancellation_id)) then
      raise exception 'replacement_cycles: window and history are immutable' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_replacement_cycle_writes() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['replacement_cycles', 'replacement_cycle_sources',
                           'replacement_cycle_events', 'replacement_cycle_notices'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_replacement_cycle_writes()', t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 2. Confirmation d'intérêt : candidature liée au cycle
-- ════════════════════════════════════════════════════════════════════
alter table public.job_applications
  add column if not exists replacement_cycle_id uuid references public.replacement_cycles(id) on delete cascade,
  add column if not exists interest_confirmed_at timestamptz,
  add column if not exists interest_origin text,
  add column if not exists previous_application_id uuid references public.job_applications(id) on delete set null;

alter table public.job_applications drop constraint if exists job_applications_replacement_chk;
alter table public.job_applications add constraint job_applications_replacement_chk check (
  (replacement_cycle_id is null and interest_confirmed_at is null
     and interest_origin is null and previous_application_id is null)
  or (replacement_cycle_id is not null and interest_confirmed_at is not null
      and interest_origin in ('pending', 'rejected', 'withdrawn', 'new')));

comment on column public.job_applications.replacement_cycle_id is
  'Lot 17d-4a : confirmation d''intérêt explicite pour un cycle de remplacement (ANN-14). Écrite par confirm_replacement_interest uniquement ; l''ancienne candidature (previous_application_id) reste inchangée.';

-- Une candidature par offre ou par journée hors cycle (règle inchangée :
-- un retrait ou un refus n'est jamais rouvert) ; une confirmation par cycle.
drop index if exists public.job_applications_job_candidate_key;
drop index if exists public.job_applications_day_candidate_key;
create unique index job_applications_job_candidate_key
  on public.job_applications (job_id, candidate_id)
  where job_day_id is null and replacement_cycle_id is null;
create unique index job_applications_day_candidate_key
  on public.job_applications (job_day_id, candidate_id)
  where job_day_id is not null and replacement_cycle_id is null;
create unique index if not exists job_applications_cycle_candidate_key
  on public.job_applications (replacement_cycle_id, candidate_id)
  where replacement_cycle_id is not null;

-- Colonnes du cycle : jamais posées ni changées par une session ou par la
-- clé service (protect_job_application_writes laisse passer la clé service).
create or replace function public.guard_replacement_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT'
     and (new.replacement_cycle_id, new.interest_confirmed_at, new.interest_origin,
          new.previous_application_id) is distinct from (null::uuid, null::timestamptz, null::text, null::uuid) then
    raise exception 'job_applications: replacement columns are written by the database only'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and (new.replacement_cycle_id, new.interest_confirmed_at, new.interest_origin,
          new.previous_application_id)
         is distinct from
         (old.replacement_cycle_id, old.interest_confirmed_at, old.interest_origin,
          old.previous_application_id) then
    raise exception 'job_applications: replacement columns are written by the database only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_replacement_application() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_replacement_application on public.job_applications;
create trigger trg_guard_replacement_application
  before insert or update on public.job_applications
  for each row execute function public.guard_replacement_application();

-- ════════════════════════════════════════════════════════════════════
-- 3. Outils communs
-- ════════════════════════════════════════════════════════════════════
-- Plages de travail de la portée (journée libérée, ou toute la période).
create or replace function public.replacement_cycle_ranges(p_cycle public.replacement_cycles)
returns tstzrange[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_cycle.job_day_id is not null then
      (select array[tstzrange(d.starts_at, d.ends_at)] from public.job_days d where d.id = p_cycle.job_day_id)
    else
      (select array_agg(tstzrange(e.starts_at, e.ends_at) order by e.starts_at)
       from public.job_effective_days(p_cycle.job_id) e)
  end;
$$;
revoke all on function public.replacement_cycle_ranges(public.replacement_cycles) from public, anon, authenticated, service_role;

-- Places encore ouvertes dans le cycle : jamais plus que les places
-- libérées non pourvues, ni que les places restantes de l'offre ou de la
-- journée.
create or replace function public.replacement_cycle_remaining(p_cycle public.replacement_cycles)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_cycle.cancelled_at is not null then 0 else greatest(0, least(
    p_cycle.places_released - p_cycle.places_filled - p_cycle.places_cancelled,
    case when p_cycle.job_day_id is not null then
      (select coalesce(d.positions_available, 1) - d.positions_filled
       from public.job_days d where d.id = p_cycle.job_day_id)
    else
      (select coalesce(j.positions_available, 1) - coalesce(j.positions_filled, 0)
       from public.jobs j where j.id = p_cycle.job_id)
    end)) end;
$$;
revoke all on function public.replacement_cycle_remaining(public.replacement_cycles) from public, anon, authenticated, service_role;

-- État à un instant : open, filled, closed (H−2 atteinte), unavailable
-- (dossier de l'entreprise non valide : mêmes règles que la visibilité et
-- la candidature), job_closed (offre clôturée ou retirée), cancelled (date
-- de la portée annulée par l'entreprise : places neutralisées). La
-- suspension du compte de l'entreprise ne change pas l'état : elle ne
-- bloque que la sélection (règle existante, selection_company_of).
create or replace function public.replacement_cycle_state(p_cycle public.replacement_cycles, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when j.id is null or j.closed_at is not null or j.status is distinct from 'active' then 'job_closed'
    when p_cycle.cancelled_at is not null then 'cancelled'
    when p_at >= p_cycle.closes_at then 'closed'
    when public.replacement_cycle_remaining(p_cycle) <= 0 then 'filled'
    when not public.company_dossier_valid(j.company_id) then 'unavailable'
    else 'open' end
  from (select 1) one
  left join public.jobs j on j.id = p_cycle.job_id;
$$;
revoke all on function public.replacement_cycle_state(public.replacement_cycles, timestamptz) from public, anon, authenticated, service_role;

-- Portée d'une candidature hors cycle : même offre, même journée (journées
-- au choix) ou offre entière (période complète).
create or replace function public.replacement_scope_matches(
  p_cycle public.replacement_cycles, p_job_id uuid, p_job_day_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job_id = p_cycle.job_id
     and ((p_cycle.job_day_id is null and p_job_day_id is null)
          or p_job_day_id = p_cycle.job_day_id);
$$;
revoke all on function public.replacement_scope_matches(public.replacement_cycles, uuid, uuid) from public, anon, authenticated, service_role;

-- Motif qui empêche un candidat de confirmer ou d'être sélectionné dans le
-- cycle (null : aucun). Mêmes contrôles que la candidature (profil, compte,
-- CNI, documents, disponibilité avec la marge de 3 h), plus : candidat qui
-- s'est désisté de ces journées (ANN-20) ou déjà sélectionné sur la portée.
create or replace function public.replacement_candidate_blocker(
  p_candidate_id uuid, p_cycle public.replacement_cycles)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.candidate_profiles;
  v_active boolean;
  v_verified boolean;
  v_cni text;
  v_ranges tstzrange[];
begin
  select * into v_profile from public.candidate_profiles cp where cp.id = p_candidate_id;
  if not found then
    return 'profile_not_found';
  end if;
  select u.is_active, u.is_verified into v_active, v_verified
  from public.users u where u.id = v_profile.user_id;
  if v_active is false then
    return 'account_suspended';
  end if;
  -- ANN-20 : journées abandonnées par ce candidat (désistement enregistré).
  if exists (select 1 from public.job_applications a
             join public.missions m on m.application_id = a.id
             where a.candidate_id = p_candidate_id
               and a.replacement_cycle_id is null
               and public.replacement_scope_matches(p_cycle, a.job_id, a.job_day_id)
               and a.status = 'withdrawn' and m.cancelled_by = 'candidate')
     or exists (select 1 from public.replacement_cycle_sources s
                where s.cycle_id = p_cycle.id and s.candidate_id = p_candidate_id) then
    return 'replacement_own_withdrawal';
  end if;
  if exists (select 1 from public.job_applications a
             where a.candidate_id = p_candidate_id
               and public.replacement_scope_matches(p_cycle, a.job_id, a.job_day_id)
               and a.status in ('selected', 'no_show')) then
    return 'already_selected';
  end if;
  if v_profile.onboarding_status is distinct from 'completed' then
    return 'onboarding_incomplete';
  end if;
  if v_profile.profile_completion_pct < 60 then
    return 'profile_incomplete';
  end if;
  v_cni := public.candidate_cni_state(v_profile, now());
  if v_cni in ('expired', 'renewal_pending', 'renewal_rejected') then
    return 'cni_expired';
  end if;
  if not coalesce(v_verified, false) or v_cni <> 'valid' then
    return 'profile_not_verified';
  end if;
  if public.candidate_document_blocker(v_profile, p_cycle.job_id) is not null then
    return 'document_requirement';
  end if;
  v_ranges := public.replacement_cycle_ranges(p_cycle);
  if v_ranges is null then
    return 'job_days_missing';
  end if;
  if cardinality(public.candidate_schedule_conflicts(v_profile.id, v_ranges)) > 0 then
    return 'schedule_conflict';
  end if;
  return null;
end;
$$;
revoke all on function public.replacement_cycle_state(public.replacement_cycles, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.replacement_candidate_blocker(uuid, public.replacement_cycles) from public, anon, authenticated, service_role;

-- Date entière annulée par l'entreprise (ANN-08) : annulation enregistrée
-- par request_company_cancellation. Un retrait ciblé accepté par le support
-- (ANN-17 : company_cancellations.support_request_id renseigné) n'annule que
-- les journées du candidat visé : il ne ferme pas la date.
create index if not exists idx_company_cancellation_days_job_date
  on public.company_cancellation_days (job_id, scheduled_date);

create or replace function public.company_date_cancelled(p_job_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_cancellation_days cd
    join public.company_cancellations c on c.id = cd.cancellation_id
    where cd.job_id = p_job_id and cd.scheduled_date = p_date
      and c.support_request_id is null);
$$;
revoke all on function public.company_date_cancelled(uuid, date) from public, anon, authenticated, service_role;

-- Offre dont au moins une date est annulée (période complète : aucune
-- nouvelle sélection ne peut l'inclure).
create or replace function public.job_has_cancelled_date(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.job_effective_days(p_job_id) e
                 where public.company_date_cancelled(p_job_id, e.day_date));
$$;
revoke all on function public.job_has_cancelled_date(uuid) from public, anon, authenticated, service_role;

-- Recrutement ordinaire encore possible sur au moins une date non annulée
-- (liste publique). L'échéance reste celle de recruitment_open.
create or replace function public.ordinary_dates_open(j public.jobs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when j.schedule_format = 'per_day' then
    exists (select 1 from public.job_effective_days(j.id) e
            where not public.company_date_cancelled(j.id, e.day_date)
              and (e.applications_close_at is null or now() < e.applications_close_at))
  else not public.job_has_cancelled_date(j.id) end;
$$;
revoke all on function public.ordinary_dates_open(public.jobs) from public;
grant execute on function public.ordinary_dates_open(public.jobs) to anon, authenticated;

-- Colonne calculée (liste publique) : un cycle ouvert sur l'offre. Ne
-- renvoie qu'un booléen ; la visibilité reste celle de la politique de jobs.
create or replace function public.replacement_open(j public.jobs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.replacement_cycles c
                 where c.job_id = j.id
                   and public.replacement_cycle_state(c, now()) = 'open');
$$;
revoke all on function public.replacement_open(public.jobs) from public;
grant execute on function public.replacement_open(public.jobs) to anon, authenticated;

-- Liste publique : recrutement initial ouvert sur une date non annulée, ou
-- cycle de remplacement ouvert.
create or replace function public.listing_open(j public.jobs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.recruitment_open(j) and public.ordinary_dates_open(j)) or public.replacement_open(j);
$$;
revoke all on function public.listing_open(public.jobs) from public;
grant execute on function public.listing_open(public.jobs) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Avis dans l'application (ANN-14), une fois par cycle et destinataire
-- ════════════════════════════════════════════════════════════════════
create or replace function public.replacement_cycle_alert(p_cycle_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.replacement_cycles;
  v_job public.jobs;
  v_company_user uuid;
  v_rows integer;
  v_count integer := 0;
  v_when_fr text;
  v_when_en text;
  v_close_fr text;
  v_close_en text;
  r record;
begin
  select c.* into v_cycle from public.replacement_cycles c where c.id = p_cycle_id;
  select j.* into v_job from public.jobs j where j.id = v_cycle.job_id;
  select cp.user_id into v_company_user
  from public.company_profiles cp where cp.id = v_job.company_id;

  -- Dossier de l'entreprise non valide à l'ouverture : l'offre n'est pas
  -- visible et la confirmation est refusée (règles existantes, ECH-07) ;
  -- aucun avis, rien n'est renvoyé après une revalidation. Comportement
  -- provisoire, à décider (DECISIONS : ANN-22) ; le cycle reste tracé.
  -- Compte de l'entreprise suspendu : aucune règle existante ne touche la
  -- visibilité, la candidature ni les avis (seule la sélection est
  -- bloquée) ; les avis partent donc normalement, sans extension implicite
  -- de la suspension.
  if not public.company_dossier_valid(v_job.company_id) then
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'alerts_withheld', jsonb_build_object('reason', 'company_dossier_invalid'));
    return 0;
  end if;

  v_when_fr := case when v_cycle.job_day_id is not null
    then 'le ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI')
    else 'à partir du ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI') end;
  v_when_en := case when v_cycle.job_day_id is not null
    then 'on ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI')
    else 'from ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI') end;
  v_close_fr := to_char(v_cycle.closes_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI');
  v_close_en := to_char(v_cycle.closes_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI');

  insert into public.replacement_cycle_notices (cycle_id, user_id, kind)
  values (v_cycle.id, v_company_user, 'company_opened')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.incident_notify(v_company_user,
      'Recrutement de remplacement ouvert', 'Replacement recruitment open',
      'Une place s''est libérée sur « ' || v_job.title || ' » (' || v_when_fr
        || '). Vous pouvez sélectionner un candidat qui confirme son intérêt jusqu''au '
        || v_close_fr || ' (heure de Douala).',
      'A place became free on "' || v_job.title || '" (' || v_when_en
        || '). You can select a candidate who confirms their interest until '
        || v_close_en || ' (Douala time).',
      jsonb_build_object('kind', 'replacement_cycle', 'job_id', v_job.id,
                         'cycle_id', v_cycle.id, 'href', '/company/jobs/' || v_job.id));
  end if;

  -- Destinataires (ANN-14) : candidature en attente non sélectionnée, ou
  -- refusée par l'entreprise, sur la portée, encore éligible et disponible.
  -- Jamais : candidature retirée, candidat à l'origine du désistement,
  -- candidat déjà sélectionné, confirmation déjà donnée.
  for r in
    select distinct cp.id as candidate_id, cp.user_id
    from public.job_applications a
    join public.candidate_profiles cp on cp.id = a.candidate_id
    where a.replacement_cycle_id is null
      and public.replacement_scope_matches(v_cycle, a.job_id, a.job_day_id)
      and a.status in ('pending', 'shortlisted', 'rejected')
      and not exists (select 1 from public.job_applications x
                      where x.replacement_cycle_id = v_cycle.id and x.candidate_id = cp.id)
      and public.replacement_candidate_blocker(cp.id, v_cycle) is null
    order by cp.id
  loop
    insert into public.replacement_cycle_notices (cycle_id, user_id, kind)
    values (v_cycle.id, r.user_id, 'candidate_alert')
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_count := v_count + 1;
      perform public.incident_notify(r.user_id,
        'Une place s''est libérée', 'A place became free',
        '« ' || v_job.title || ' » : une place est de nouveau disponible (' || v_when_fr
          || ', heure de Douala). Si elle vous intéresse toujours, confirmez votre intérêt avant le '
          || v_close_fr || ' : l''entreprise choisit parmi les candidats qui confirment. '
          || 'Votre ancienne candidature n''est pas réactivée.',
        '"' || v_job.title || '": a place is available again (' || v_when_en
          || ', Douala time). If you are still interested, confirm your interest before '
          || v_close_en || ': the company chooses among the candidates who confirm. '
          || 'Your previous application is not reactivated.',
        jsonb_build_object('kind', 'replacement_cycle', 'job_id', v_job.id,
                           'cycle_id', v_cycle.id, 'href', '/jobs/' || v_job.id));
    end if;
  end loop;

  insert into public.replacement_cycle_events (cycle_id, kind, detail)
  values (v_cycle.id, 'alerts_sent', jsonb_build_object('candidates', v_count));
  return v_count;
end;
$$;
revoke all on function public.replacement_cycle_alert(uuid) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 5. Ouverture depuis un désistement enregistré (seul déclencheur)
-- ════════════════════════════════════════════════════════════════════
-- Appelée par request_candidate_cancellation, dans sa transaction, pour
-- chaque mission entièrement libérée (candidature passée à « withdrawn »).
create or replace function public.replacement_cycle_on_withdrawal(
  p_cancellation_id uuid, p_mission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_app public.job_applications;
  v_job public.jobs;
  v_start timestamptz;
  v_cycle public.replacement_cycles;
begin
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found or v_mission.cancelled_by is distinct from 'candidate' then
    return null;
  end if;
  select a.* into v_app from public.job_applications a where a.id = v_mission.application_id;
  if not found or v_app.status is distinct from 'withdrawn' then
    return null;
  end if;
  -- Offre déjà verrouillée par le compteur des places (même transaction).
  select j.* into v_job from public.jobs j where j.id = v_app.job_id for update;
  if v_job.status is distinct from 'active' or v_job.closed_at is not null then
    return null;
  end if;
  -- Période déjà commencée ou travail confirmé : hors 17d-4a (ANN-19).
  if exists (select 1 from public.mission_days d
             where d.mission_id = v_mission.id
               and (d.actual_start_time is not null
                    or public.completion_counts(d.completion_source)
                    or d.starts_at <= now())) then
    return null;
  end if;

  if v_app.job_day_id is not null then
    select d.starts_at into v_start from public.job_days d where d.id = v_app.job_day_id for update;
  else
    select min(e.starts_at) into v_start from public.job_effective_days(v_job.id) e;
  end if;
  -- Au moins 4 h avant le début concerné (limite incluse).
  if v_start is null or v_start - now() < interval '4 hours' then
    return null;
  end if;
  -- Date de la portée déjà annulée par l'entreprise (ANN-08, dates
  -- entières) : aucune place n'est rouverte sur une date annulée.
  if (v_app.job_day_id is not null
      and exists (select 1 from public.job_days d
                  where d.id = v_app.job_day_id
                    and public.company_date_cancelled(v_job.id, d.day_date)))
     or (v_app.job_day_id is null and public.job_has_cancelled_date(v_job.id)) then
    return null;
  end if;

  select c.* into v_cycle from public.replacement_cycles c
  where c.job_id = v_job.id and c.job_day_id is not distinct from v_app.job_day_id
  for update;
  if not found then
    insert into public.replacement_cycles (job_id, job_day_id, company_id, starts_at, closes_at, places_released)
    values (v_job.id, v_app.job_day_id, v_job.company_id, v_start, v_start - interval '2 hours', 1)
    returning * into v_cycle;
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'opened', jsonb_build_object('mission_id', v_mission.id,
                                                     'cancellation_id', p_cancellation_id));
  else
    if exists (select 1 from public.replacement_cycle_sources s where s.mission_id = v_mission.id) then
      return v_cycle.id;
    end if;
    -- Même portée, même début : la fermeture ne bouge pas.
    update public.replacement_cycles c set places_released = c.places_released + 1
    where c.id = v_cycle.id
    returning * into v_cycle;
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'place_added', jsonb_build_object('mission_id', v_mission.id,
                                                          'cancellation_id', p_cancellation_id));
  end if;

  insert into public.replacement_cycle_sources (mission_id, cycle_id, cancellation_id, application_id, candidate_id)
  values (v_mission.id, v_cycle.id, p_cancellation_id, v_app.id, v_app.candidate_id);

  perform public.replacement_cycle_alert(v_cycle.id);
  -- REP-04 : un recrutement encore possible tient l'unité « offre » fermée.
  perform public.refresh_reputation('company', v_job.company_id, 'job');
  return v_cycle.id;
end;
$$;
revoke all on function public.replacement_cycle_on_withdrawal(uuid, uuid) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 6. Confirmation d'intérêt (candidat)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.confirm_replacement_interest(p_cycle_id uuid, p_consent boolean)
returns table (application_id uuid, already_confirmed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.candidate_profiles;
  v_cycle public.replacement_cycles;
  v_job public.jobs;
  v_block text;
  v_prev public.job_applications;
  v_app public.job_applications;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'consent_required';
  end if;
  select * into v_profile from public.candidate_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  select c.* into v_cycle from public.replacement_cycles c where c.id = p_cycle_id;
  if not found then
    raise exception 'replacement_not_found';
  end if;
  -- Mêmes verrous partagés que la candidature (offre, entreprise).
  select j.* into v_job from public.jobs j where j.id = v_cycle.job_id for share;
  perform 1 from public.company_profiles cp where cp.id = v_job.company_id for share;

  -- Relance : confirmation déjà enregistrée pour ce cycle.
  select a.* into v_app from public.job_applications a
  where a.replacement_cycle_id = v_cycle.id and a.candidate_id = v_profile.id;
  if found then
    if v_app.status = 'withdrawn' then
      raise exception 'interest_withdrawn';
    end if;
    return query select v_app.id, true;
    return;
  end if;

  if v_job.closed_at is not null then
    raise exception 'job_closed' using errcode = '42501';
  end if;
  if v_job.status is distinct from 'active' or not public.company_dossier_valid(v_job.company_id) then
    raise exception 'job_not_available';
  end if;
  if v_cycle.cancelled_at is not null then
    raise exception 'replacement_cancelled';
  end if;
  if now() >= v_cycle.closes_at then
    raise exception 'replacement_closed';
  end if;
  if public.replacement_cycle_remaining(v_cycle) <= 0 then
    raise exception 'no_positions';
  end if;

  v_block := public.replacement_candidate_blocker(v_profile.id, v_cycle);
  if v_block = 'cni_expired' then
    raise exception 'cni_expired'
      using errcode = '42501',
            detail = jsonb_build_object('state', public.candidate_cni_state(v_profile, now()))::text;
  elsif v_block = 'document_requirement' then
    raise exception 'document_requirement'
      using detail = public.candidate_document_blocker(v_profile, v_cycle.job_id)::text;
  elsif v_block is not null then
    raise exception '%', v_block;
  end if;

  select a.* into v_prev from public.job_applications a
  where a.candidate_id = v_profile.id and a.replacement_cycle_id is null
    and public.replacement_scope_matches(v_cycle, a.job_id, a.job_day_id);

  insert into public.job_applications (
    job_id, job_day_id, candidate_id, status, replacement_cycle_id,
    interest_confirmed_at, interest_origin, previous_application_id)
  values (
    v_cycle.job_id, v_cycle.job_day_id, v_profile.id, 'pending', v_cycle.id, now(),
    case when v_prev.id is null then 'new'
         when v_prev.status = 'rejected' then 'rejected'
         when v_prev.status = 'withdrawn' then 'withdrawn'
         else 'pending' end,
    v_prev.id)
  on conflict (replacement_cycle_id, candidate_id) where replacement_cycle_id is not null do nothing
  returning * into v_app;
  if v_app.id is null then
    -- Envoi simultané : la première confirmation fait foi.
    select a.* into v_app from public.job_applications a
    where a.replacement_cycle_id = v_cycle.id and a.candidate_id = v_profile.id;
    return query select v_app.id, true;
    return;
  end if;

  delete from public.candidate_application_blockers b
  where b.candidate_id = v_profile.id and b.job_id = v_cycle.job_id;
  return query select v_app.id, false;
end;
$$;
revoke all on function public.confirm_replacement_interest(uuid, boolean) from public, anon;
grant execute on function public.confirm_replacement_interest(uuid, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Lectures (candidat, visiteur, entreprise)
-- ════════════════════════════════════════════════════════════════════
-- Cycles d'une offre visible : journées et places ouvertes, fermeture,
-- état ; pour un candidat connecté, sa confirmation et son motif éventuel.
create or replace function public.job_replacement_cycles(p_job_id uuid)
returns table (
  cycle_id uuid,
  job_day_id uuid,
  day_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  closes_at timestamptz,
  places_open integer,
  state text,
  my_application_id uuid,
  my_status public.application_status,
  my_blocker text,
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

  return query
  select c.id, c.job_day_id, d.day_date,
         c.starts_at,
         coalesce(d.ends_at, (select max(e.ends_at) from public.job_effective_days(c.job_id) e)),
         c.closes_at,
         public.replacement_cycle_remaining(c),
         public.replacement_cycle_state(c, now()),
         a.id, a.status,
         case when v_candidate is not null and a.id is null
              then public.replacement_candidate_blocker(v_candidate, c) end,
         now()
  from public.replacement_cycles c
  left join public.job_days d on d.id = c.job_day_id
  left join public.job_applications a
    on v_candidate is not null and a.replacement_cycle_id = c.id and a.candidate_id = v_candidate
  where c.job_id = p_job_id
  order by c.starts_at;
end;
$$;
revoke all on function public.job_replacement_cycles(uuid) from public;
grant execute on function public.job_replacement_cycles(uuid) to anon, authenticated;

-- Entreprise propriétaire : suivi de ses cycles (aucune donnée de candidat).
create or replace function public.company_replacement_cycles(p_job_id uuid)
returns table (
  cycle_id uuid,
  job_day_id uuid,
  day_date date,
  starts_at timestamptz,
  closes_at timestamptz,
  places_released integer,
  places_filled integer,
  places_open integer,
  state text,
  confirmations integer,
  alerts_withheld boolean,
  server_now timestamptz
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
  select c.id, c.job_day_id, d.day_date, c.starts_at, c.closes_at,
         c.places_released, c.places_filled,
         public.replacement_cycle_remaining(c),
         public.replacement_cycle_state(c, now()),
         (select count(*)::integer from public.job_applications a
          where a.replacement_cycle_id = c.id and a.status in ('pending', 'shortlisted')),
         exists (select 1 from public.replacement_cycle_events e
                 where e.cycle_id = c.id and e.kind = 'alerts_withheld'),
         now()
  from public.replacement_cycles c
  left join public.job_days d on d.id = c.job_day_id
  where c.job_id = p_job_id
  order by c.starts_at;
end;
$$;
revoke all on function public.company_replacement_cycles(uuid) from public, anon;
grant execute on function public.company_replacement_cycles(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Place pourvue dans le cycle (sélection signée)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.replacement_on_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.replacement_cycles c set places_filled = c.places_filled + 1
  where c.id = new.replacement_cycle_id;
  insert into public.replacement_cycle_events (cycle_id, kind, detail)
  values (new.replacement_cycle_id, 'place_filled', jsonb_build_object('application_id', new.id));
  return null;
end;
$$;
revoke all on function public.replacement_on_selection() from public, anon, authenticated, service_role;

drop trigger if exists trg_replacement_on_selection on public.job_applications;
create trigger trg_replacement_on_selection
  after update of status on public.job_applications
  for each row
  when (new.replacement_cycle_id is not null and new.status = 'selected'
        and old.status is distinct from 'selected')
  execute function public.replacement_on_selection();

-- ════════════════════════════════════════════════════════════════════
-- 9. Signaux temps réel (charge utile {d, r})
-- ════════════════════════════════════════════════════════════════════
create or replace function public.rt_on_replacement_cycles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[public.rt_company_user(new.company_id)], 'jobs', new.job_id);
  perform public.rt_signal_users(
    array(select cp.user_id from public.job_applications ja
          join public.candidate_profiles cp on cp.id = ja.candidate_id
          where ja.job_id = new.job_id),
    'jobs', new.job_id);
  perform public.rt_signal_public_jobs(new.job_id);
  perform public.rt_signal_admin('jobs');
  return null;
end;
$$;
revoke all on function public.rt_on_replacement_cycles() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_replacement_cycles on public.replacement_cycles;
create trigger trg_rt_replacement_cycles
  after insert or update on public.replacement_cycles
  for each row execute function public.rt_on_replacement_cycles();

-- ════════════════════════════════════════════════════════════════════
-- 10. Fonctions reprises (corps d'origine, lignes « Lot 17d-4a »)
-- ════════════════════════════════════════════════════════════════════

-- a. Candidature (20261113120000) : index restreints aux candidatures hors cycle.
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
    -- Lot 17d-4a : une période dont une date est annulée par l'entreprise
    -- n'accepte plus de candidature (aucune sélection ne pourrait l'inclure).
    if public.job_has_cancelled_date(p_job_id) then
      raise exception 'date_cancelled';
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

    -- Lot 17d-4a : intérêt déjà confirmé dans un cycle de remplacement.
    if exists (select 1 from public.job_applications a
               where a.job_id = p_job_id and a.candidate_id = v_profile.id
                 and a.job_day_id is null and a.replacement_cycle_id is not null) then
      raise exception 'already_applied';
    end if;

    insert into public.job_applications (job_id, candidate_id, status)
    values (p_job_id, v_profile.id, 'pending')
    on conflict (job_id, candidate_id) where job_day_id is null and replacement_cycle_id is null do nothing
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
             -- Lot 17d-4a : date annulée par l'entreprise, échéance ouverte ou non.
             when public.company_date_cancelled(p_job_id, d.day_date)
               then 'date_cancelled'
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
    on conflict (job_day_id, candidate_id) where job_day_id is not null and replacement_cycle_id is null do nothing
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

-- b. Retrait (20261116120000) : sans identifiant, la candidature hors cycle.
create or replace function public.withdraw_job_application(
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
    and (case when p_application_id is null then a.job_day_id is null and a.replacement_cycle_id is null
              else a.id = p_application_id end)
  for update of a;

  if not found then
    raise exception 'application_not_found';
  end if;
  if v_application.status = 'withdrawn' then
    return v_application;
  end if;
  if v_application.status not in ('pending', 'shortlisted') then
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

-- c. Journées du candidat (20261113120000) : candidature hors cycle.
drop function if exists public.job_days_for_candidate(uuid);
create function public.job_days_for_candidate(p_job_id uuid)
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
  server_now timestamptz,
  date_cancelled boolean
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
           and x.applications_close_at is not null and now() < x.applications_close_at
           and not x.cancelled,
         x.positions_filled >= coalesce(x.positions_available, 1),
         x.application_id, x.application_status,
         case when v_candidate is null or x.application_id is not null then null
              else not (x.ord = any (v_conflicts)) end,
         case when v_candidate is not null and x.application_id is null
                   and x.ord = any (v_conflicts) then 'schedule_conflict' end,
         now(),
         x.cancelled
  from (
    select e.day_id, e.day_date, e.start_time, e.end_time, e.starts_at, e.ends_at,
           e.mission_pay_per_candidate, e.applications_close_at,
           e.positions_filled, e.positions_available,
           a.id as application_id, a.status as application_status,
           (row_number() over (order by e.starts_at))::integer as ord,
           public.company_date_cancelled(p_job_id, e.day_date) as cancelled
    from public.job_effective_days(p_job_id) e
    left join public.job_applications a
      on v_candidate is not null and a.candidate_id = v_candidate and a.job_id = p_job_id
     and a.replacement_cycle_id is null
     and ((v_job.schedule_format = 'per_day' and a.job_day_id = e.day_id)
          or (v_job.schedule_format = 'full_period' and a.job_day_id is null))
  ) x
  order by x.starts_at;
end;
$$;
revoke all on function public.job_days_for_candidate(uuid) from public;
grant execute on function public.job_days_for_candidate(uuid) to anon, authenticated;

-- d. Candidatures vues par l'entreprise (20261116120000) : cycle et fermeture.
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
  day_ends_at timestamptz,
  contract_id uuid,
  contract_to_sign boolean,
  replacement_cycle_id uuid,
  replacement_closes_at timestamptz,
  date_cancelled boolean
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
         d.id, d.day_date, d.starts_at, d.ends_at,
         k.id,
         k.id is not null and k.company_signed_at is null
           and coalesce(k.status, 'pending') not in ('rejected', 'expired'),
         a.replacement_cycle_id, rc.closes_at,
         case when a.job_day_id is not null then public.company_date_cancelled(a.job_id, d.day_date)
              else public.job_has_cancelled_date(a.job_id) end
  from public.job_applications a
  join public.candidate_profiles c on c.id = a.candidate_id
  left join public.job_days d on d.id = a.job_day_id
  left join public.contracts k on k.application_id = a.id
  left join public.replacement_cycles rc on rc.id = a.replacement_cycle_id
  where a.job_id = p_job_id
  order by d.starts_at nulls first, a.match_score desc nulls last, a.created_at;
end;
$$;
revoke all on function public.company_job_applicants(uuid) from public, anon;
grant execute on function public.company_job_applicants(uuid) to authenticated;

-- e. Préparation de la sélection (20261116120000).
create or replace function public.selection_prepare(p_uid uuid, p_application_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_day public.job_days;
  v_candidate record;
  v_days jsonb;
  v_ranges tstzrange[];
  v_count integer;
  v_pay integer;
  v_first record;
  v_last_date date;
  v_template text;
  v_terms jsonb;
  v_clauses jsonb;
  v_cycle public.replacement_cycles;
  v_block text;
begin
  select * into v_company from public.selection_company_of(p_uid);

  select a.* into v_application
  from public.job_applications a where a.id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  select j.* into v_job from public.jobs j where j.id = v_application.job_id;
  if not found or v_job.company_id is distinct from v_company.id then
    raise exception 'application_not_found';
  end if;

  -- Présélection (retirée au lot 13) : une candidature encore
  -- présélectionnée se traite comme une candidature en attente.
  if v_application.status not in ('pending', 'shortlisted') then
    raise exception 'application_not_selectable';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  if not public.company_dossier_valid(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  if v_application.job_day_id is not null then
    select d.* into v_day from public.job_days d
    where d.id = v_application.job_day_id and d.job_id = v_job.id;
    if not found then
      raise exception 'application_not_found';
    end if;
  end if;

  -- Lot 17d-4a : confirmation liée à un cycle de remplacement → fenêtre et
  -- places du cycle (jamais l'échéance initiale, inchangée).
  if v_application.replacement_cycle_id is not null then
    select c.* into v_cycle from public.replacement_cycles c
    where c.id = v_application.replacement_cycle_id and c.job_id = v_job.id;
    if not found then
      raise exception 'application_not_found';
    end if;
    -- Date de la portée annulée par l'entreprise : places neutralisées.
    if v_cycle.cancelled_at is not null then
      raise exception 'replacement_cancelled';
    end if;
    if now() >= v_cycle.closes_at then
      raise exception 'replacement_closed';
    end if;
    if public.replacement_cycle_remaining(v_cycle) <= 0 then
      raise exception 'no_positions';
    end if;
  elsif v_application.job_day_id is not null then
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

  select cp.id, cp.user_id, cp.first_name, cp.last_name, u.is_active,
         u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_application.candidate_id;
  if not found or v_candidate.is_active is false then
    raise exception 'candidate_unavailable';
  end if;
  -- Lot 17d-4a : profil, CNI, documents et désistement revérifiés pour un
  -- remplacement ; refus générique côté entreprise (DON-04). Les conflits
  -- d'horaires gardent leur code ci-dessous.
  if v_cycle.id is not null then
    v_block := public.replacement_candidate_blocker(v_candidate.id, v_cycle);
    if v_block is not null and v_block <> 'schedule_conflict' then
      raise exception 'candidate_unavailable';
    end if;
  end if;

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

  -- Lot 17d-4a : aucune nouvelle sélection n'inclut une date annulée par
  -- l'entreprise (ANN-08), même si l'échéance initiale reste ouverte.
  if exists (select 1 from jsonb_array_elements(v_days) x
             where public.company_date_cancelled(v_job.id, (x ->> 'date')::date)) then
    raise exception 'date_cancelled';
  end if;

  -- Aucun détail des autres engagements n'est renvoyé à l'entreprise.
  if cardinality(public.candidate_schedule_conflicts(v_candidate.id, v_ranges)) > 0 then
    raise exception 'candidate_schedule_conflict';
  end if;

  v_count := jsonb_array_length(v_days);
  -- SRS §6.7 : 3 journées travaillées ou plus → formalisé.
  v_template := case when v_count >= 3 then 'formal' else 'simple' end;

  select (x ->> 'date')::date as d, (x ->> 'start_time')::time as st,
         (x ->> 'end_time')::time as et
  into v_first
  from jsonb_array_elements(v_days) with ordinality t(x, ord) where t.ord = 1;
  v_last_date := (v_days -> (v_count - 1) ->> 'date')::date;

  v_clauses := public.current_contract_clauses(v_template);
  if v_clauses is null then
    raise exception 'contracts: no clause version for template %', v_template
      using errcode = '23514';
  end if;

  v_terms := jsonb_build_object(
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
    'clauses', v_clauses
  );

  return jsonb_build_object(
    'application_id', v_application.id,
    'job_id', v_job.id,
    'job_day_id', v_application.job_day_id,
    'job_title', v_job.title,
    'company_id', v_company.id,
    'company_name', v_company.company_name,
    'candidate_id', v_candidate.id,
    'candidate_user_id', v_candidate.user_id,
    'candidate_locale', v_candidate.locale,
    'candidate_name', nullif(btrim(concat_ws(' ', v_candidate.first_name,
        nullif(upper(left(btrim(coalesce(v_candidate.last_name, '')), 1)) || '.', '.'))), ''),
    'template', v_template,
    'days', v_days,
    'day_count', v_count,
    'first_date', v_first.d,
    'first_start', v_first.st,
    'first_end', v_first.et,
    'last_date', v_last_date,
    'break_minutes', v_job.break_duration_minutes,
    'terms', v_terms,
    'proposal_hash', public.contract_proposal_hash(
      v_application.id, v_job.id, v_candidate.id, v_company.id, v_template, v_terms)
  );
end;
$$;

revoke all on function public.selection_prepare(uuid, uuid) from public, anon, authenticated;

-- f. Signature et sélection (20261116120000) : verrou du cycle.
create or replace function public.contract_select_core(
  p_uid uuid,
  p_application_id uuid,
  p_terms_hash text,
  p_observed_ip text
)
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
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_p jsonb;
  v_hash text := lower(btrim(coalesce(p_terms_hash, '')));
  v_mission_id uuid;
  v_contract public.contracts;
  v_contract_id uuid;
  v_ip text;
  v_count integer;
  v_first date;
  v_last date;
  v_locale text;
  v_company_name text;
  v_title text;
begin
  select * into v_company from public.selection_company_of(p_uid);

  -- Verrous dans l'ordre de select_candidate (lots 7a à 12) : candidature,
  -- offre, entreprise (partage), journée, puis candidat (consultatif).
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

  -- Relance : résultat d'origine, sans écriture ni signature.
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

  perform 1 from public.company_profiles cp where cp.id = v_company.id for share;
  if v_application.job_day_id is not null then
    perform 1 from public.job_days d
    where d.id = v_application.job_day_id and d.job_id = v_job.id
    for update;
  end if;
  -- Lot 17d-4a : places du cycle de remplacement (désistement concurrent,
  -- autre sélection dans le même cycle).
  if v_application.replacement_cycle_id is not null then
    perform 1 from public.replacement_cycles c
    where c.id = v_application.replacement_cycle_id
    for update;
  end if;
  -- Deux entreprises qui sélectionnent ce candidat au même moment
  -- s'attendent ici ; la seconde relit les engagements validés.
  perform public.lock_candidate_engagements(v_application.candidate_id);

  -- Mêmes contrôles que l'aperçu, sur l'état verrouillé.
  v_p := public.selection_prepare(p_uid, p_application_id);

  -- Le consentement porte sur les conditions présentées : si elles ont
  -- changé depuis l'aperçu (offre, clauses), rien n'est écrit.
  if v_hash is distinct from v_p ->> 'proposal_hash' then
    raise exception 'terms_mismatch';
  end if;

  update public.job_applications a
  set status = 'selected', selected_at = now(), selected_by = p_uid
  where a.id = v_application.id
  returning a.* into v_application;

  insert into public.missions (
    job_id, candidate_id, application_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, break_minutes, contract_type
  ) values (
    v_job.id, v_application.candidate_id, v_application.id,
    (v_p ->> 'first_date')::date, (v_p ->> 'first_start')::time,
    (v_p ->> 'first_end')::time, (v_p ->> 'break_minutes')::integer,
    v_p ->> 'template'
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
  from jsonb_array_elements(v_p -> 'days') with ordinality t(x, ord)
  where t.ord > 1;

  -- Clauses copiées et terms_hash calculé par trg_protect_contract_writes.
  insert into public.contracts (
    application_id, job_id, candidate_id, company_id, contract_template,
    contract_data
  ) values (
    v_application.id, v_job.id, v_application.candidate_id, v_company.id,
    v_p ->> 'template',
    ((v_p -> 'terms') - 'clauses') || jsonb_build_object('mission_id', v_mission_id)
  )
  returning * into v_contract;

  -- Le contrat enregistré est exactement celui que l'entreprise a lu.
  if public.contract_proposal_hash(
       v_contract.application_id, v_contract.job_id, v_contract.candidate_id,
       v_contract.company_id, v_contract.contract_template, v_contract.contract_data)
     is distinct from v_hash then
    raise exception 'terms_mismatch';
  end if;

  begin
    v_ip := case when length(p_observed_ip) <= 64
                 then host(btrim(p_observed_ip)::inet) end;
  exception when others then
    v_ip := null;
  end;

  update public.contracts c
  set company_signed_at = now(),
      company_signed_by = p_uid,
      company_ip = v_ip,
      company_terms_hash = c.terms_hash,
      status = public.contract_expected_status(c.candidate_signed_at, now())
  where c.id = v_contract.id;

  v_count := (v_p ->> 'day_count')::integer;
  v_first := (v_p ->> 'first_date')::date;
  v_last := (v_p ->> 'last_date')::date;
  v_locale := v_p ->> 'candidate_locale';
  v_company_name := coalesce(v_p ->> 'company_name', '');
  v_title := coalesce(v_p ->> 'job_title', '');

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    (v_p ->> 'candidate_user_id')::uuid,
    'application_update',
    case when v_locale = 'en' then 'You have been selected'
         else 'Vous êtes sélectionné(e)' end,
    case when v_locale = 'en'
      then v_company_name || ' selected you for "' || v_title || '" '
           || case when v_count > 1
                then 'from ' || to_char(v_first, 'YYYY-MM-DD') || ' to '
                     || to_char(v_last, 'YYYY-MM-DD') || ' (' || v_count || ' days)'
                else 'on ' || to_char(v_first, 'YYYY-MM-DD') end
           || '. Sign your contract from your tasks.'
      else v_company_name || ' vous a sélectionné(e) pour « ' || v_title || ' » '
           || case when v_count > 1
                then 'du ' || to_char(v_first, 'DD/MM/YYYY') || ' au '
                     || to_char(v_last, 'DD/MM/YYYY') || ' (' || v_count || ' journées)'
                else 'le ' || to_char(v_first, 'DD/MM/YYYY') end
           || '. Signez votre contrat depuis vos tâches.' end,
    jsonb_build_object(
      'job_id', v_job.id,
      'application_id', v_application.id,
      'mission_id', v_mission_id,
      'contract_id', v_contract.id,
      'application_status', 'selected'
    )
  );

  return query select v_application.id, v_application.status,
    v_mission_id, v_contract.id, false;
end;
$$;

revoke all on function public.contract_select_core(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

-- g. Désistement (20261127120000) : ouverture du cycle.
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
  v_withdrawn uuid[] := '{}';
  v_mid uuid;
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
  end loop;
  if v_job is null then
    raise exception 'days_invalid';
  end if;

  -- Lot 17d-4a : concurrence sur la même demande (même identifiant) → le
  -- résultat d'origine, relu avant l'état des missions que cette demande
  -- vient de modifier (auparavant : refus mission_not_active). Aucune
  -- nouvelle écriture : ni place, ni cycle, ni avis supplémentaire.
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

  -- Demande différente : mission déjà libérée ou interrompue → refus.
  for v_mission in
    select m.id, m.status, m.application_id
    from public.missions m
    where m.id in (select d.mission_id from public.mission_days d where d.id = any (v_ids))
  loop
    if v_mission.status not in ('pending', 'confirmed', 'in_progress')
       or (select a.status from public.job_applications a where a.id = v_mission.application_id)
          is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
  end loop;

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
      v_withdrawn := v_withdrawn || v_mission.id;
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

  -- Lot 17d-4a (ANN-14) : place réellement libérée → cycle de remplacement
  -- et avis, dans cette transaction. Seul déclencheur.
  foreach v_mid in array v_withdrawn loop
    perform public.replacement_cycle_on_withdrawal(v_id, v_mid);
  end loop;

  if v_status = 'sanctioned_no_evidence' then
    perform public.cancellation_apply_sanction(v_id, 'cancellation_flow', null);
  end if;

  return query select v_id, v_status, v_late, cardinality(v_ids), false;
end;
$$;
revoke all on function public.request_candidate_cancellation(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.request_candidate_cancellation(uuid, uuid[], text, text, text) to authenticated;

-- h. Unité « offre » (20261120120000, REP-04, condition 3) : un cycle ouvert
-- laisse le recrutement ouvert.
create or replace function public.reputation_company_offers(
  p_company_id uuid,
  p_at timestamptz default now()
)
returns table (offer_id uuid, realized_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d.mission_id,
           bool_and(public.completion_counts(d.completion_source)) as all_confirmed,
           max(d.actual_end_time) as confirmed_at
    from public.mission_days d
    group by d.mission_id
  ), offer_jobs as (
    select coalesce(j.parent_job_id, j.id) as offer_id, j.id as job_id,
           ((j.legacy_publication and j.applications_close_at is null)
             or (j.first_published_at is not null
                 and j.applications_close_at is not null
                 and j.applications_close_at <= p_at))
           -- Lot 17d-4a : recrutement de remplacement encore possible à p_at.
           and not exists (select 1 from public.replacement_cycles rc
                           where rc.job_id = j.id and rc.opened_at <= p_at
                             and rc.closes_at > p_at) as closed,
           greatest(j.applications_close_at,
                    (select max(rc.closes_at) from public.replacement_cycles rc
                     where rc.job_id = j.id and rc.opened_at <= p_at)) as applications_close_at
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
            and k.all_confirmed is true) as confirmed,
           case when k.all_confirmed then k.confirmed_at end as confirmed_at
    from offer_jobs oj
    join public.job_applications a on a.job_id = oj.job_id
    left join public.missions m on m.application_id = a.id
    left join days k on k.mission_id = m.id
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

-- i. Prochaine fermeture de recrutement (20261113120000).
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
  select min(x.at) from (
    select j.applications_close_at as at
    from public.jobs j
    where j.company_id = p_company_id
      and j.first_published_at is not null
      and j.applications_close_at > p_at
      and exists (select 1 from public.job_applications a
                  where a.job_id = j.id and a.status in ('selected', 'no_show'))
    union all
    -- Lot 17d-4a : fermeture d'un cycle de remplacement.
    select rc.closes_at
    from public.replacement_cycles rc
    where rc.company_id = p_company_id and rc.closes_at > p_at
      and exists (select 1 from public.job_applications a
                  where a.job_id = rc.job_id and a.status in ('selected', 'no_show'))
  ) x;
$$;
revoke all on function public.reputation_company_next_close(uuid, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 11. Annulation par l'entreprise d'une date couverte par un cycle
-- ════════════════════════════════════════════════════════════════════
-- Appelée par request_company_cancellation, dans sa transaction, après
-- l'enregistrement des journées annulées. Portée du cycle touchée : la
-- journée libérée (journées au choix) a sa date annulée, ou une date de la
-- période complète est annulée (un remplacement couvrirait toute la
-- période, y compris la date annulée ; le remplacement partiel relève de
-- 17d-4c, ANN-19). Les places non pourvues sont neutralisées et le cycle
-- est fermé (état « cancelled ») : aucune confirmation ni sélection
-- ensuite. Journées indépendantes (autres cycles), contrats, sources et
-- journal conservés ; une place déjà pourvue reste un engagement ordinaire,
-- annulé par la même demande s'il porte sur la date (dates entières).
create or replace function public.replacement_cycles_on_company_cancellation(p_cancellation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.replacement_cycles;
  v_places integer;
  v_count integer := 0;
begin
  for v_cycle in
    select c.* from public.replacement_cycles c
    where c.cancelled_at is null
      and exists (
        select 1 from public.company_cancellation_days cd
        where cd.cancellation_id = p_cancellation_id
          and cd.job_id = c.job_id
          and (c.job_day_id is null
               or cd.scheduled_date = (select d.day_date from public.job_days d
                                       where d.id = c.job_day_id)))
    order by c.id
    for update
  loop
    v_places := greatest(0, v_cycle.places_released - v_cycle.places_filled - v_cycle.places_cancelled);
    update public.replacement_cycles c
    set places_cancelled = c.places_cancelled + v_places,
        cancelled_at = now(),
        company_cancellation_id = p_cancellation_id
    where c.id = v_cycle.id;
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'company_cancelled',
            jsonb_build_object('cancellation_id', p_cancellation_id,
                               'places_cancelled', v_places,
                               'places_filled', v_cycle.places_filled));
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.refresh_reputation('company',
      (select c.company_id from public.company_cancellations c where c.id = p_cancellation_id), 'job');
  end if;
  return v_count;
end;
$$;
revoke all on function public.replacement_cycles_on_company_cancellation(uuid) from public, anon, authenticated, service_role;

-- j. Annulation par l'entreprise (20261126120000) : neutralisation des
-- cycles de remplacement et relance concurrente de la même demande.
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
  end loop;

  -- Lot 17d-4a : concurrence sur la même demande (même identifiant) → le
  -- résultat d'origine, relu avant l'état des missions que cette demande
  -- vient de modifier (auparavant : refus mission_not_active).
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

  -- Demande différente : mission déjà annulée ou libérée → refus.
  for v_mission in
    select m.id, m.status, m.application_id
    from public.missions m
    where m.id in (select d.mission_id from public.mission_days d where d.id = any (v_ids))
  loop
    if v_mission.status not in ('pending', 'confirmed', 'in_progress')
       or (select a.status from public.job_applications a where a.id = v_mission.application_id)
          is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
  end loop;

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

  -- Offres verrouillées (lot 17d-4a : en exclusif, auparavant en partage) :
  -- une sélection, une candidature ou une confirmation concurrente est
  -- terminée avant le contrôle des dates entières, ou attend la fin de
  -- cette demande puis relit la date annulée.
  perform 1 from public.jobs j where j.id = any (v_actor.job_ids) order by j.id for update;

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

  -- Lot 17d-4a : cycles de remplacement dont la portée contient une date
  -- annulée → places non pourvues neutralisées, cycle fermé (verrous des
  -- cycles après ceux des offres, comme la sélection).
  perform public.replacement_cycles_on_company_cancellation(v_id);

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

-- ════════════════════════════════════════════════════════════════════
-- 12. Date annulée par l'entreprise : disponibilité et signal
-- ════════════════════════════════════════════════════════════════════
-- k. Disponibilité d'une offre (20261124120000) : période dont une date est
-- annulée → date_cancelled (lien direct lisible, aucune candidature).
create or replace function public.job_availability(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when j.id is not null and j.closed_at is not null then 'closed_by_company'
    when j.id is null or j.status is distinct from 'active' then 'not_found'
    when not public.company_dossier_valid(j.company_id) then 'unavailable'
    -- Lot 11b : offre lisible mais recrutement clos (échéance atteinte).
    when j.applications_close_at is null or now() >= j.applications_close_at then 'closed'
    -- Lot 17d-4a : période complète dont une date est annulée par l'entreprise.
    when j.schedule_format = 'full_period' and public.job_has_cancelled_date(j.id) then 'date_cancelled'
    else 'available' end
  from (select 1) one
  left join public.jobs j on j.id = p_job_id;
$$;
revoke all on function public.job_availability(uuid) from public;
grant execute on function public.job_availability(uuid) to anon, authenticated;

-- Annulation d'une date entière : l'offre et ses candidats relisent
-- (écran déjà ouvert : détail, liste publique, candidatures de l'entreprise).
-- Charge utile {d, r} ; un retrait ciblé (support) n'émet rien ici.
create or replace function public.rt_on_company_date_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(array[new.company_user_id], 'jobs', new.job_id);
  perform public.rt_signal_users(
    array(select distinct cp.user_id from public.job_applications ja
          join public.candidate_profiles cp on cp.id = ja.candidate_id
          where ja.job_id = new.job_id),
    'jobs', new.job_id);
  perform public.rt_signal_public_jobs(new.job_id);
  return null;
end;
$$;
revoke all on function public.rt_on_company_date_cancellation() from public, anon, authenticated, service_role;
drop trigger if exists trg_rt_company_date_cancellation on public.company_cancellations;
create trigger trg_rt_company_date_cancellation
  after insert on public.company_cancellations
  for each row when (new.support_request_id is null)
  execute function public.rt_on_company_date_cancellation();
