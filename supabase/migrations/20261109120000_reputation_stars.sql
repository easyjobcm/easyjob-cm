-- Migration : réputation EasyJob en étoiles (lot 9c)
-- Date : 2026-11-09
-- Tables : reputation_scores, reputation_changes, reputation_incidents
--   (nouvelles) ; reviews (colonne reasons, lecture de session fermée) ;
--   disputes (review_id, outcome : contestation d'un avis) ;
--   document_expirations (index unique par document) ; candidate_profiles
--   (completed_missions réparé).
-- Fonctions : calcul (reputation_*), refresh_reputation, my_reputation,
--   acknowledge_reputation_changes, reputation_expiry_sweep,
--   admin_open_review_contest, admin_resolve_review_contest,
--   admin_reputation_review_impacts, submit_mission_review (motifs),
--   company_job_applicants (étoiles seules), company_public_profiles (vue).
--
-- Règles (AUDIT.md §26, SRS §5.2 et §6.9) — le score affiché va de 0 à 5
-- par demi-étoiles ; chaque catégorie est plafonnée séparément :
--
--   Candidat   profil 1 · expérience et engagements 2 · avis 1 · compétences 1
--   Entreprise profil 1 · offres réalisées et engagements 2 · avis 2
--
--   Profil      complétude ≥ 50 % → ½, 100 % → 1. Candidat :
--               candidate_profiles.profile_completion_pct (trigger existant).
--               Entreprise : company_profile_completion_pct, mêmes critères
--               et poids que computeCompanyCriteria (lib/utils/profile-completion.ts).
--   Expérience  solde 0..20 ; 5/10/15/20 unités → ½/1/1½/2. +1 par mission
--               confirmée par code (candidat) ; +1 par offre réalisée
--               (entreprise : au moins une mission confirmée par code et
--               toutes les sélections résolues, quel que soit le nombre de
--               places ; sous-offres regroupées sous l'offre mère).
--   Engagements APPLICATION seulement : une décision de manquement
--               confirmée (ligne non annulée de reputation_incidents)
--               retire 5 unités du même solde ; entreprise : trois
--               décisions en 90 jours → un seul retrait. Les CONDITIONS
--               qui permettent de prononcer la décision (délai d'une
--               annulation tardive : 24 h candidat et 12 h entreprise
--               provisoires ; offre partiellement pourvue ; justificatif)
--               ne sont PAS encodées ici : elles relèvent du futur parcours
--               qui écrira la décision (lot Engagements et annulations,
--               PLAN_ACTION.md). Aucun parcours du dépôt n'en écrit
--               encore : aucune sanction n'est inférée.
--   Avis        4-5 → +1, 3 → 0, < 3 → −5 ; solde 0..10 (candidat) ou
--               0..20 (entreprise) ; 5 unités → ½ étoile. Avis admissible :
--               origin = mission_flow, mission confirmée par code, non
--               invalidé par une contestation acceptée.
--   Compétences ½ par compétence distincte dont un justificatif lié est
--               approuvé et valide (règle d'expiration de apply_to_job),
--               avec, pour une compétence de conduite, un permis approuvé,
--               valide et de catégorie couvrante (mapping de
--               has_verified_license_for) ; maximum 1.
--
-- Les soldes sont rejoués dans l'ordre chronologique des événements, avec
-- les bornes appliquées à chaque événement : le résultat ne dépend que des
-- données sources (missions, codes, avis, contestations, incidents,
-- documents), d'où un recalcul identique après l'invalidation d'un ancien
-- événement. average_rating et review_count restent les données sources
-- des avis ; la réputation est une projection distincte (reputation_scores).
-- Le score ne dépend ni de l'abonnement ni du premium, et ne modifie aucun
-- critère d'accès aux offres (apply_to_job inchangée).
--
-- Rollback :
--   select cron.unschedule('reputation-expiry-sweep') where exists (select 1 from cron.job where jobname = 'reputation-expiry-sweep');
--   drop trigger trg_reputation_* (liste en fin de fichier) ;
--   drop table public.reputation_changes, public.reputation_incidents, public.reputation_scores ;
--   drop function public.reputation_*, public.refresh_reputation, public.my_reputation,
--     public.acknowledge_reputation_changes, public.admin_open_review_contest,
--     public.admin_resolve_review_contest, public.admin_reputation_review_impacts,
--     public.company_profile_completion_pct, public.license_categories_for,
--     public.review_reason_label, public.review_reasons_for ;
--   recréer submit_mission_review (20261106140000, drop de la signature à 4
--   arguments avant), company_job_applicants (20261108130000, drop avant),
--   company_public_profiles (20261106120000) et la policy « Anyone can view
--   public reviews » (20260526130000) ; alter table public.reviews drop column reasons ;
--   alter table public.disputes drop column review_id, drop column outcome.

-- ════════════════════════════════════════════════════════════════════
-- 1. Avis : motifs, lecture fermée
-- ════════════════════════════════════════════════════════════════════
alter table public.reviews
  add column if not exists reasons text[] not null default '{}'::text[];

comment on column public.reviews.reasons is
  'Motifs sélectionnés par l''auteur (codes de review_reasons_for selon la partie évaluée). Au moins un pour une note < 3. Jamais exposés à un tiers.';

-- Les avis (note, motifs, commentaire) ne sont plus lisibles en session :
-- les parties lisent seulement les indicateurs « avis donné » des RPC de
-- mission, les admins passent par l'API serveur (clé service).
drop policy if exists "Anyone can view public reviews" on public.reviews;
revoke select on table public.reviews from anon, authenticated;

-- Motifs proposés selon la partie évaluée. Libellés FR/EN identiques à
-- lib/reputation/review-reasons.ts (cohérence vérifiée par la preuve).
create or replace function public.review_reasons_for(p_reviewed_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_reviewed_type
    when 'candidate' then array['late', 'left_early', 'poor_quality',
      'instructions_ignored', 'behavior', 'presentation']
    when 'company' then array['unclear_instructions', 'conditions_mismatch',
      'disrespect', 'unsafe', 'code_withheld', 'extra_tasks']
    else '{}'::text[]
  end;
$$;

create or replace function public.review_reason_label(p_code text, p_locale text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_locale = 'en' then
    case p_code
      when 'late' then 'late arrival'
      when 'left_early' then 'left early'
      when 'poor_quality' then 'work not up to standard'
      when 'instructions_ignored' then 'instructions not followed'
      when 'behavior' then 'inappropriate behaviour'
      when 'presentation' then 'unsuitable dress or equipment'
      when 'unclear_instructions' then 'unclear instructions'
      when 'conditions_mismatch' then 'conditions different from the job offer'
      when 'disrespect' then 'disrespectful treatment'
      when 'unsafe' then 'unsafe working conditions'
      when 'code_withheld' then 'completion code given late'
      when 'extra_tasks' then 'tasks not agreed'
    end
  else
    case p_code
      when 'late' then 'retard'
      when 'left_early' then 'départ anticipé'
      when 'poor_quality' then 'travail non conforme'
      when 'instructions_ignored' then 'consignes non respectées'
      when 'behavior' then 'comportement inapproprié'
      when 'presentation' then 'tenue ou équipement inadaptés'
      when 'unclear_instructions' then 'consignes peu claires'
      when 'conditions_mismatch' then 'conditions différentes de l''offre'
      when 'disrespect' then 'manque de respect'
      when 'unsafe' then 'conditions de travail dangereuses'
      when 'code_withheld' then 'code de fin remis tardivement'
      when 'extra_tasks' then 'tâches non prévues'
    end
  end;
$$;

revoke all on function public.review_reasons_for(text) from public, anon, authenticated;
revoke all on function public.review_reason_label(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. Contestation d'un avis : support et litiges existants
-- ════════════════════════════════════════════════════════════════════
-- Le support (support@easyjob.cm, lib/support.ts) reçoit la contestation ;
-- un admin la rattache à l'avis (litige de type review_contest, un par
-- avis), un admin_ops ou admin_founder la tranche. Décisions tracées dans
-- audit_logs. Un avis invalidé (outcome = upheld) sort du calcul ; l'avis
-- lui-même reste immuable (protect_review_writes).
alter table public.disputes
  add column if not exists review_id uuid references public.reviews(id) on delete cascade,
  add column if not exists outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'disputes_outcome_chk') then
    alter table public.disputes add constraint disputes_outcome_chk
      check (outcome is null or outcome in ('upheld', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'disputes_review_contest_chk') then
    alter table public.disputes add constraint disputes_review_contest_chk
      check ((type = 'review_contest') = (review_id is not null));
  end if;
end
$$;

comment on column public.disputes.review_id is
  'Avis contesté (type = review_contest). Écrit par admin_open_review_contest.';
comment on column public.disputes.outcome is
  'Décision d''une contestation d''avis : upheld (avis invalidé, retiré du calcul) ou rejected (avis maintenu).';

create unique index if not exists disputes_review_contest_unique
  on public.disputes (review_id) where type = 'review_contest';

-- Les contestations ne s'écrivent que par les RPC admin.
create or replace function public.protect_review_contest_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op in ('INSERT', 'UPDATE') and (new.type = 'review_contest' or new.review_id is not null
                                           or new.outcome is not null))
       or (tg_op in ('UPDATE', 'DELETE') and old.type = 'review_contest') then
      raise exception 'disputes: use admin_open_review_contest' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.type = 'review_contest'
     and (new.review_id is distinct from old.review_id
          or (old.outcome is not null and new.outcome is distinct from old.outcome)) then
    raise exception 'disputes: review contest decisions are final' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_review_contest_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_review_contest_writes on public.disputes;
create trigger trg_protect_review_contest_writes
  before insert or update or delete on public.disputes
  for each row execute function public.protect_review_contest_writes();

-- La partie évaluée voit sa contestation ; l'auteur de l'avis, non.
drop policy if exists disputes_select_party_or_admin on public.disputes;
create policy disputes_select_party_or_admin on public.disputes
  for select using (
    opened_by = (select auth.uid())
    or public.is_admin_user((select auth.uid()))
    or (type is distinct from 'review_contest' and exists (
      select 1
      from public.missions m
      left join public.jobs j on j.id = m.job_id
      left join public.candidate_profiles cp on cp.id = m.candidate_id
      left join public.company_profiles cmp on cmp.id = j.company_id
      where m.id = disputes.mission_id
        and (cp.user_id = (select auth.uid()) or cmp.user_id = (select auth.uid()))))
  );

-- ════════════════════════════════════════════════════════════════════
-- 3. Manquements confirmés (aucun producteur dans le dépôt)
-- ════════════════════════════════════════════════════════════════════
-- Une ligne = une DÉCISION de manquement déjà prononcée (support ou futur
-- parcours d'annulation). La base applique la décision (−5 unités) ; elle
-- ne juge pas si le manquement est constitué. Les conditions métier
-- (délai d'une annulation tardive — 24 h candidat, 12 h entreprise selon
-- SRS §5.3, seuils provisoires —, offre partiellement pourvue,
-- justificatif d'absence) restent à arbitrer avec le produit et seront
-- vérifiées par le producteur de la décision. Le trigger ne contrôle que
-- la cohérence des faits : partie concernée, mission ou offre qui lui
-- appartient, et pas d'absence sur une mission confirmée par code (le
-- travail a eu lieu ; un code jamais saisi n'est pas en soi une faute).
-- scheduled_start_at et occurred_at sont informatifs (ordre de rejeu,
-- fenêtre de 90 jours), jamais comparés à un seuil. Aucune écriture de
-- session.
create table if not exists public.reputation_incidents (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('candidate', 'company')),
  subject_id uuid not null,
  kind text not null check (kind in ('candidate_late_cancellation', 'candidate_no_show',
                                      'company_late_cancellation')),
  source text not null check (source in ('support_decision', 'cancellation_flow')),
  mission_id uuid references public.missions(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  scheduled_start_at timestamptz not null,
  occurred_at timestamptz not null,
  decided_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete set null,
  void_reason text,
  constraint reputation_incidents_kind_subject_chk check (
    (kind like 'candidate_%') = (subject_type = 'candidate'))
);

create index if not exists idx_reputation_incidents_subject
  on public.reputation_incidents (subject_type, subject_id, occurred_at);

alter table public.reputation_incidents enable row level security;
revoke all on table public.reputation_incidents from anon, authenticated;

comment on table public.reputation_incidents is
  'Décisions de manquement confirmées (annulation tardive, absence) : chacune retire 5 unités d''expérience (entreprise : 3 en 90 jours → 1 retrait). Les conditions pour prononcer une décision ne sont pas encodées ici (lot Engagements et annulations). Aucun parcours ne les écrit encore (AUDIT.md §26).';

create or replace function public.protect_reputation_incidents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Suppression : seulement avec le profil (reputation_on_profile_delete) ;
  -- aucune session n'a de droit sur la table. Une erreur se corrige par
  -- l'annulation (voided_at), qui garde la trace.
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    -- mission_id, job_id, decided_by : seul le passage à NULL d'une clé
    -- étrangère (ligne référencée supprimée) est admis.
    if (new.subject_type, new.subject_id, new.kind, new.source,
        new.scheduled_start_at, new.occurred_at, new.created_at)
       is distinct from
       (old.subject_type, old.subject_id, old.kind, old.source,
        old.scheduled_start_at, old.occurred_at, old.created_at)
       or (new.mission_id is distinct from old.mission_id and new.mission_id is not null)
       or (new.job_id is distinct from old.job_id and new.job_id is not null)
       or (new.decided_by is distinct from old.decided_by and new.decided_by is not null)
       or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
      raise exception 'reputation_incidents: only a single void is allowed' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Cohérence des faits seulement : aucun délai ni taux de remplissage
  -- n'est évalué ici (conditions à arbitrer, voir l'en-tête de section).
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
    -- Mission confirmée par code : le travail a eu lieu, pas de faute.
    if exists (select 1 from public.mission_completion_codes c
               where c.mission_id = new.mission_id and c.consumed_at is not null) then
      raise exception 'incident_conflicts_with_completion';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_reputation_incidents() from public, anon, authenticated;

drop trigger if exists trg_protect_reputation_incidents on public.reputation_incidents;
create trigger trg_protect_reputation_incidents
  before insert or update or delete on public.reputation_incidents
  for each row execute function public.protect_reputation_incidents();

-- ════════════════════════════════════════════════════════════════════
-- 4. Projection et historique
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.reputation_scores (
  subject_type text not null check (subject_type in ('candidate', 'company')),
  subject_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  stars numeric(2,1) not null default 0,
  profile_pct integer not null default 0,
  profile_stars numeric(2,1) not null default 0,
  experience_units integer not null default 0,
  experience_stars numeric(2,1) not null default 0,
  confirmed_count integer not null default 0,
  breach_count integer not null default 0,
  review_units integer not null default 0,
  review_stars numeric(2,1) not null default 0,
  skill_count integer,
  skill_stars numeric(2,1),
  next_expiry_at timestamptz,
  computed_at timestamptz not null default now(),
  primary key (subject_type, subject_id),
  constraint reputation_scores_stars_chk check (stars between 0 and 5 and stars * 2 = floor(stars * 2))
);

create index if not exists idx_reputation_scores_user
  on public.reputation_scores (user_id);
create index if not exists idx_reputation_scores_next_expiry
  on public.reputation_scores (next_expiry_at) where next_expiry_at is not null;

comment on table public.reputation_scores is
  'Réputation EasyJob (0 à 5, demi-étoiles) et progression par catégorie. Écrite par refresh_reputation seul. Lisible par son titulaire et les admins ; les tiers ne reçoivent que stars, par les RPC et vues dédiées.';

alter table public.reputation_scores enable row level security;
revoke all on table public.reputation_scores from anon, authenticated;
grant select on table public.reputation_scores to authenticated;

drop policy if exists reputation_scores_select_own_or_admin on public.reputation_scores;
create policy reputation_scores_select_own_or_admin on public.reputation_scores
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_user((select auth.uid())));

create table if not exists public.reputation_changes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('candidate', 'company')),
  subject_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  from_stars numeric(2,1) not null,
  to_stars numeric(2,1) not null,
  direction text not null check (direction in ('gain', 'loss')),
  cause text not null,
  details jsonb not null default '{}'::jsonb,
  notification_id uuid references public.notifications(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reputation_changes_direction_chk check (
    (direction = 'gain') = (to_stars > from_stars) and to_stars <> from_stars)
);

create index if not exists idx_reputation_changes_user_pending
  on public.reputation_changes (user_id, created_at) where acknowledged_at is null;
create index if not exists idx_reputation_changes_subject
  on public.reputation_changes (subject_type, subject_id, created_at);

comment on table public.reputation_changes is
  'Chaque variation réelle du score (au moins une demi-étoile), avec sa notification durable. acknowledged_at : animation déjà jouée (un seul onglet, une seule fois).';

alter table public.reputation_changes enable row level security;
revoke all on table public.reputation_changes from anon, authenticated;
grant select on table public.reputation_changes to authenticated;

drop policy if exists reputation_changes_select_own_or_admin on public.reputation_changes;
create policy reputation_changes_select_own_or_admin on public.reputation_changes
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_user((select auth.uid())));

-- ════════════════════════════════════════════════════════════════════
-- 5. Calcul
-- ════════════════════════════════════════════════════════════════════
create or replace function public.reputation_half_stars(p_units integer, p_cap integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (floor(greatest(0, least(coalesce(p_units, 0), p_cap)) / 5) * 0.5)::numeric(2,1);
$$;

create or replace function public.reputation_profile_stars(p_pct integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (case when coalesce(p_pct, 0) >= 100 then 1
               when coalesce(p_pct, 0) >= 50 then 0.5 else 0 end)::numeric(2,1);
$$;

-- Validité d'un justificatif à un instant : même règle que apply_to_job
-- (expiré dès 00:00 UTC du jour d'échéance ; sans échéance = valide).
create or replace function public.reputation_document_valid(
  p_status text, p_expires_at date, p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'verified'
     and (p_expires_at is null or not (p_expires_at::timestamp at time zone 'UTC' < p_at));
$$;

-- Catégories de permis qui couvrent une exigence : mapping de
-- has_verified_license_for (20260908150000), tous_types couvre tout.
create or replace function public.license_categories_for(p_required text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_required
    when 'moto' then array['moto', 'tous_types']
    when 'voiture' then array['voiture', 'tous_types']
    when 'fourgon' then array['fourgon', 'camion', 'tous_types']
    when 'camion' then array['camion', 'tous_types']
    when 'bus' then array['bus', 'tous_types']
    when 'tous_types' then array['tous_types']
  end;
$$;

-- Complétude entreprise : critères et poids de computeCompanyCriteria.
--   secteur 20 · description > 20 caractères 20 · logo 15 ·
--   ville et adresse 15 · RCCM ou NIU 15 · nom et téléphone du contact 15.
create or replace function public.company_profile_completion_pct(p public.company_profiles)
returns integer
language sql
immutable
set search_path = ''
as $$
  select
      (case when coalesce(p.sector, '') <> '' then 20 else 0 end)
    + (case when char_length(regexp_replace(coalesce(p.description, ''), '^\s+|\s+$', '', 'g')) > 20
            then 20 else 0 end)
    + (case when coalesce(p.logo_url, '') <> '' then 15 else 0 end)
    + (case when coalesce(p.city, '') <> '' and coalesce(p.address, '') <> '' then 15 else 0 end)
    + (case when coalesce(p.rccm, '') <> '' or coalesce(p.niu, '') <> '' then 15 else 0 end)
    + (case when coalesce(p.contact_name, '') <> '' and coalesce(p.contact_phone, '') <> ''
            then 15 else 0 end);
$$;

-- Avis admissible : vérifié, mission confirmée par code, non invalidé.
create or replace function public.reputation_review_admissible(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reviews r
    join public.missions m on m.id = r.mission_id
    join public.mission_completion_codes c on c.mission_id = m.id
    where r.id = p_review_id
      and r.origin = 'mission_flow'
      and c.consumed_at is not null
      and m.actual_end_time is not null
      and not exists (select 1 from public.disputes d
                      where d.review_id = r.id and d.type = 'review_contest'
                        and d.outcome = 'upheld'));
$$;

create or replace function public.reputation_review_delta(p_rating integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_rating >= 4 then 1 when p_rating = 3 then 0 else -5 end;
$$;

-- Solde d'avis rejoué (bornes à chaque événement).
create or replace function public.reputation_review_units(
  p_reviewed_type text, p_reviewed_id uuid, p_cap integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_units integer := 0;
  r record;
begin
  for r in
    select rv.overall_rating
    from public.reviews rv
    where rv.reviewed_type = p_reviewed_type and rv.reviewed_id = p_reviewed_id
      and public.reputation_review_admissible(rv.id)
    order by rv.created_at, rv.id
  loop
    v_units := greatest(0, least(p_cap, v_units + public.reputation_review_delta(r.overall_rating)));
  end loop;
  return v_units;
end;
$$;

-- Offres réalisées d'une entreprise : une par offre (sous-offres
-- regroupées), dès qu'au moins une mission est confirmée par code et que
-- chaque sélection est résolue (mission confirmée, annulée ou absence).
-- Horodatage : dernière résolution.
create or replace function public.reputation_company_offers(p_company_id uuid)
returns table (offer_id uuid, realized_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with sel as (
    select coalesce(j.parent_job_id, j.id) as offer_id,
           a.status as app_status,
           m.id as mission_id, m.status as mission_status,
           m.actual_end_time, m.updated_at, c.consumed_at
    from public.jobs j
    join public.job_applications a on a.job_id = j.id
    left join public.missions m on m.application_id = a.id
    left join public.mission_completion_codes c on c.mission_id = m.id
    where j.company_id = p_company_id
      and a.status in ('selected', 'no_show')
  )
  select s.offer_id,
         max(case when s.consumed_at is not null and s.actual_end_time is not null
                  then s.consumed_at else s.updated_at end)
  from sel s
  group by s.offer_id
  having bool_or(s.consumed_at is not null and s.actual_end_time is not null)
     and bool_and(s.app_status = 'no_show'
                  or (s.mission_id is not null
                      and ((s.consumed_at is not null and s.actual_end_time is not null)
                           or s.mission_status in ('cancelled', 'no_show'))));
$$;

-- Score complet d'un profil à un instant (lecture seule, déterministe).
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
        select c.consumed_at as at, 1 as delta, m.id as ref
        from public.missions m
        join public.mission_completion_codes c on c.mission_id = m.id
        where m.candidate_id = p_subject_id
          and c.consumed_at is not null and m.actual_end_time is not null
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
        from public.reputation_company_offers(p_subject_id) o
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
      null::integer, null::numeric, null::timestamptz;
  end if;
end;
$$;

-- Nombre d'étoiles d'une notification, accordé comme formatStars
-- (lib/reputation/progress.ts) : « 1,5 étoile », « 3 étoiles », « 1 star »,
-- « 3.5 stars ».
create or replace function public.reputation_stars_text(p_stars numeric, p_locale text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_locale = 'en'
    then trim(trailing '.' from trim(trailing '0' from p_stars::text))
         || case when p_stars = 1 then ' star' else ' stars' end
    else replace(trim(trailing '.' from trim(trailing '0' from p_stars::text)), '.', ',')
         || case when p_stars < 2 then ' étoile' else ' étoiles' end
  end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 6. Recalcul, notification et signal
-- ════════════════════════════════════════════════════════════════════
-- Ligne verrouillée : deux recalculs concurrents sont sérialisés, une même
-- variation ne crée qu'une notification. p_silent : reprise des données
-- (aucune notification historique).
create or replace function public.refresh_reputation(
  p_subject_type text,
  p_subject_id uuid,
  p_cause text,
  p_details jsonb default '{}'::jsonb,
  p_silent boolean default false
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_locale text;
  v_old public.reputation_scores;
  v_new record;
  v_change_id uuid;
  v_notification_id uuid;
  v_direction text;
  v_title text;
  v_body text;
  v_href text;
  v_reasons text;
  v_docs text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_stars_from text;
  v_stars_to text;
  v_doc_count integer := 0;
begin
  if p_subject_id is null or p_subject_type not in ('candidate', 'company') then
    return null;
  end if;
  if p_subject_type = 'candidate' then
    select cp.user_id into v_user from public.candidate_profiles cp where cp.id = p_subject_id;
  else
    select cp.user_id into v_user from public.company_profiles cp where cp.id = p_subject_id;
  end if;
  if v_user is null then
    return null;
  end if;

  insert into public.reputation_scores (subject_type, subject_id, user_id)
  values (p_subject_type, p_subject_id, v_user)
  on conflict (subject_type, subject_id) do nothing;

  select s.* into v_old from public.reputation_scores s
  where s.subject_type = p_subject_type and s.subject_id = p_subject_id
  for update;

  select * into v_new from public.compute_reputation(p_subject_type, p_subject_id, now());
  if not found then
    return null;
  end if;

  if (v_new.stars, v_new.profile_pct, v_new.profile_stars, v_new.experience_units,
      v_new.experience_stars, v_new.confirmed_count, v_new.breach_count, v_new.review_units,
      v_new.review_stars, v_new.skill_count, v_new.skill_stars, v_new.next_expiry_at)
     is distinct from
     (v_old.stars, v_old.profile_pct, v_old.profile_stars, v_old.experience_units,
      v_old.experience_stars, v_old.confirmed_count, v_old.breach_count, v_old.review_units,
      v_old.review_stars, v_old.skill_count, v_old.skill_stars, v_old.next_expiry_at) then
    update public.reputation_scores s
    set stars = v_new.stars, profile_pct = v_new.profile_pct, profile_stars = v_new.profile_stars,
        experience_units = v_new.experience_units, experience_stars = v_new.experience_stars,
        confirmed_count = v_new.confirmed_count, breach_count = v_new.breach_count,
        review_units = v_new.review_units, review_stars = v_new.review_stars,
        skill_count = v_new.skill_count, skill_stars = v_new.skill_stars,
        next_expiry_at = v_new.next_expiry_at, computed_at = now()
    where s.subject_type = p_subject_type and s.subject_id = p_subject_id;

    perform public.rt_signal_users(array[v_user], 'reputation', p_subject_id);
    perform public.rt_signal_admin('reputation');
  end if;

  -- Compteur affiché au titulaire et à l'admin : missions confirmées par code.
  if p_subject_type = 'candidate' then
    update public.candidate_profiles cp set completed_missions = v_new.confirmed_count
    where cp.id = p_subject_id and cp.completed_missions is distinct from v_new.confirmed_count;
  end if;

  if v_new.stars = v_old.stars then
    return v_new.stars;
  end if;

  -- Les tiers qui affichent ces étoiles relisent (entreprises des offres
  -- auxquelles le candidat a postulé ; offres publiées de l'entreprise).
  if p_subject_type = 'candidate' then
    perform public.rt_signal_users(
      (select array_agg(distinct cp.user_id)
       from public.job_applications a
       join public.jobs j on j.id = a.job_id
       join public.company_profiles cp on cp.id = j.company_id
       where a.candidate_id = p_subject_id),
      'applications', null);
  else
    perform public.rt_signal_public_jobs(j.id)
    from public.jobs j where j.company_id = p_subject_id and j.status = 'active';
  end if;

  if p_silent then
    return v_new.stars;
  end if;

  v_direction := case when v_new.stars > v_old.stars then 'gain' else 'loss' end;
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_user;
  v_stars_from := public.reputation_stars_text(v_old.stars, v_locale);
  v_stars_to := public.reputation_stars_text(v_new.stars, v_locale);
  v_href := case when p_subject_type = 'candidate' then '/profile/candidate#reputation'
                 else '/profile/company#reputation' end;

  -- Motifs d'un mauvais avis : codes seulement (jamais l'auteur ni le commentaire).
  if p_cause = 'review' and jsonb_typeof(v_details -> 'reasons') = 'array' then
    select string_agg(public.review_reason_label(x, v_locale), ', ')
    into v_reasons
    from jsonb_array_elements_text(v_details -> 'reasons') x;
  end if;
  if p_cause = 'document_expired' and jsonb_typeof(v_details -> 'documents') = 'array' then
    select string_agg(coalesce(nullif(btrim(x ->> 'title'), ''), x ->> 'type'), ', '),
           count(*)::integer
    into v_docs, v_doc_count
    from jsonb_array_elements(v_details -> 'documents') x;
    v_href := '/profile/skills';
  end if;
  if v_direction = 'loss' and p_cause in ('skill', 'document_expired') then
    v_href := '/profile/skills';
  end if;
  if v_direction = 'loss' and p_cause = 'profile' then
    v_href := case when p_subject_type = 'candidate' then '/profile/candidate/edit'
                   else '/profile/company' end;
  end if;

  if v_locale = 'en' then
    v_title := case when v_direction = 'gain' then 'Congratulations: ' || v_stars_to
                    else 'Reputation: ' || v_stars_to end;
    v_body := case
      when v_direction = 'gain' then
        'Your EasyJob reputation rises from ' || v_stars_from || ' to ' || v_stars_to || '.'
      when p_cause = 'review' then
        'Your EasyJob reputation drops to ' || v_stars_to || ' after a review'
        || coalesce(': ' || v_reasons, '') || '.'
      when p_cause = 'document_expired' then
        'Your EasyJob reputation drops to ' || v_stars_to || ': '
        || coalesce(v_docs, 'a supporting document')
        || case when v_doc_count > 1 then ' have expired. Renew them' else ' has expired. Renew it' end
        || ' to regain your stars.'
      when p_cause = 'breach' then
        'Your EasyJob reputation drops to ' || v_stars_to || ' after a confirmed missed commitment.'
      else
        'Your EasyJob reputation drops to ' || v_stars_to || '.'
    end;
  else
    v_title := case when v_direction = 'gain' then 'Félicitations : ' || v_stars_to
                    else 'Réputation : ' || v_stars_to end;
    v_body := case
      when v_direction = 'gain' then
        'Votre réputation EasyJob passe de ' || v_stars_from || ' à ' || v_stars_to || '.'
      when p_cause = 'review' then
        'Votre réputation EasyJob passe à ' || v_stars_to || ' après un avis'
        || coalesce(' : ' || v_reasons, '') || '.'
      when p_cause = 'document_expired' then
        'Votre réputation EasyJob passe à ' || v_stars_to || ' : '
        || coalesce(v_docs, 'un justificatif')
        || case when v_doc_count > 1 then ' ont expiré. Renouvelez-les' else ' a expiré. Renouvelez-le' end
        || ' pour retrouver vos étoiles.'
      when p_cause = 'breach' then
        'Votre réputation EasyJob passe à ' || v_stars_to || ' après un manquement confirmé.'
      else
        'Votre réputation EasyJob passe à ' || v_stars_to || '.'
    end;
  end if;

  v_change_id := gen_random_uuid();
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (v_user, 'system', v_title, v_body,
          jsonb_build_object('kind', 'reputation', 'change_id', v_change_id,
                             'direction', v_direction, 'from', v_old.stars, 'to', v_new.stars,
                             'cause', p_cause, 'href', v_href))
  returning id into v_notification_id;

  insert into public.reputation_changes (id, subject_type, subject_id, user_id, from_stars,
    to_stars, direction, cause, details, notification_id)
  values (v_change_id, p_subject_type, p_subject_id, v_user, v_old.stars, v_new.stars,
          v_direction, p_cause,
          -- Seuls les éléments utiles à l'action sont conservés.
          jsonb_strip_nulls(jsonb_build_object(
            'reasons', case when p_cause = 'review' then v_details -> 'reasons' end,
            'documents', case when p_cause = 'document_expired' then v_details -> 'documents' end,
            'href', v_href)),
          v_notification_id);

  return v_new.stars;
end;
$$;

-- Étoiles affichées à un tiers : la projection, ou un calcul à la lecture si
-- une échéance de justificatif est passée depuis le dernier calcul.
create or replace function public.reputation_stars_for(p_subject_type text, p_subject_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when s.next_expiry_at is not null and s.next_expiry_at < now()
                then (select c.stars from public.compute_reputation(p_subject_type, p_subject_id, now()) c)
                else s.stars end
    from public.reputation_scores s
    where s.subject_type = p_subject_type and s.subject_id = p_subject_id), 0)::numeric(2,1);
$$;

-- ════════════════════════════════════════════════════════════════════
-- 7. Déclencheurs
-- ════════════════════════════════════════════════════════════════════
create or replace function public.reputation_on_missions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if new.actual_end_time is not distinct from old.actual_end_time
     and new.status is not distinct from old.status then
    return null;
  end if;
  select j.company_id into v_company from public.jobs j where j.id = new.job_id;
  if old.actual_end_time is null and new.actual_end_time is not null then
    perform public.refresh_reputation('candidate', new.candidate_id, 'mission');
  end if;
  perform public.refresh_reputation('company', v_company, 'job');
  return null;
end;
$$;

create or replace function public.reputation_on_job_applications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if new.status is not distinct from old.status
     or not (new.status in ('selected', 'no_show') or old.status in ('selected', 'no_show')) then
    return null;
  end if;
  select j.company_id into v_company from public.jobs j where j.id = new.job_id;
  perform public.refresh_reputation('company', v_company, 'job');
  return null;
end;
$$;

create or replace function public.reputation_on_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin is distinct from 'mission_flow' then
    return null;
  end if;
  perform public.refresh_reputation(new.reviewed_type, new.reviewed_id, 'review',
    jsonb_build_object('review_id', new.id, 'reasons', to_jsonb(new.reasons)));
  return null;
end;
$$;

create or replace function public.reputation_on_disputes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.reviews;
begin
  if new.review_id is null
     or (tg_op = 'UPDATE' and new.outcome is not distinct from old.outcome) then
    return null;
  end if;
  select r.* into v_review from public.reviews r where r.id = new.review_id;
  perform public.refresh_reputation(v_review.reviewed_type, v_review.reviewed_id, 'contest',
    jsonb_build_object('review_id', v_review.id));
  return null;
end;
$$;

create or replace function public.reputation_on_incidents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.voided_at is not distinct from old.voided_at then
    return null;
  end if;
  perform public.refresh_reputation(new.subject_type, new.subject_id,
    case when tg_op = 'UPDATE' then 'correction' else 'breach' end);
  return null;
end;
$$;

create or replace function public.reputation_on_candidate_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.profile_completion_pct is not distinct from old.profile_completion_pct then
    return null;
  end if;
  perform public.refresh_reputation('candidate', new.id, 'profile');
  return null;
end;
$$;

create or replace function public.reputation_on_company_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and public.company_profile_completion_pct(new) = public.company_profile_completion_pct(old) then
    return null;
  end if;
  perform public.refresh_reputation('company', new.id, 'profile');
  return null;
end;
$$;

-- Justificatifs, liens et compétences : la catégorie compétences.
create or replace function public.reputation_on_candidate_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.candidate_documents := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'UPDATE'
     and (new.status, new.expires_at, new.license_category, new.document_type)
         is not distinct from (old.status, old.expires_at, old.license_category, old.document_type) then
    return null;
  end if;
  perform public.refresh_reputation('candidate', v_row.candidate_id,
    case when tg_op = 'UPDATE' and new.status = 'expired' then 'document_expired' else 'skill' end,
    case when tg_op = 'UPDATE' and new.status = 'expired'
         then jsonb_build_object('documents', jsonb_build_array(
                jsonb_build_object('type', new.document_type, 'title', new.title)))
         else '{}'::jsonb end);
  return null;
end;
$$;

create or replace function public.reputation_on_candidate_skill_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skill uuid := case when tg_op = 'DELETE' then old.candidate_skill_id else new.candidate_skill_id end;
  v_candidate uuid;
begin
  select cs.candidate_id into v_candidate from public.candidate_skills cs where cs.id = v_skill;
  perform public.refresh_reputation('candidate', v_candidate, 'skill');
  return null;
end;
$$;

create or replace function public.reputation_on_candidate_skills()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := case when tg_op = 'DELETE' then old.candidate_id else new.candidate_id end;
begin
  if tg_op = 'UPDATE' and new.skill_name is not distinct from old.skill_name then
    return null;
  end if;
  perform public.refresh_reputation('candidate', v_candidate, 'skill');
  return null;
end;
$$;

-- Profil supprimé : sa projection et son historique disparaissent.
create or replace function public.reputation_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reputation_incidents i
  where i.subject_type = tg_argv[0] and i.subject_id = old.id;
  delete from public.reputation_changes c
  where c.subject_type = tg_argv[0] and c.subject_id = old.id;
  delete from public.reputation_scores s
  where s.subject_type = tg_argv[0] and s.subject_id = old.id;
  return null;
end;
$$;

drop trigger if exists trg_reputation_candidate_profiles_delete on public.candidate_profiles;
create trigger trg_reputation_candidate_profiles_delete
  after delete on public.candidate_profiles
  for each row execute function public.reputation_on_profile_delete('candidate');

drop trigger if exists trg_reputation_company_profiles_delete on public.company_profiles;
create trigger trg_reputation_company_profiles_delete
  after delete on public.company_profiles
  for each row execute function public.reputation_on_profile_delete('company');

drop trigger if exists trg_reputation_missions on public.missions;
create trigger trg_reputation_missions
  after update on public.missions
  for each row execute function public.reputation_on_missions();

drop trigger if exists trg_reputation_job_applications on public.job_applications;
create trigger trg_reputation_job_applications
  after update on public.job_applications
  for each row execute function public.reputation_on_job_applications();

drop trigger if exists trg_reputation_reviews on public.reviews;
create trigger trg_reputation_reviews
  after insert on public.reviews
  for each row execute function public.reputation_on_reviews();

drop trigger if exists trg_reputation_disputes on public.disputes;
create trigger trg_reputation_disputes
  after insert or update on public.disputes
  for each row execute function public.reputation_on_disputes();

drop trigger if exists trg_reputation_incidents on public.reputation_incidents;
create trigger trg_reputation_incidents
  after insert or update on public.reputation_incidents
  for each row execute function public.reputation_on_incidents();

drop trigger if exists trg_reputation_candidate_profiles on public.candidate_profiles;
create trigger trg_reputation_candidate_profiles
  after insert or update on public.candidate_profiles
  for each row execute function public.reputation_on_candidate_profiles();

drop trigger if exists trg_reputation_company_profiles on public.company_profiles;
create trigger trg_reputation_company_profiles
  after insert or update on public.company_profiles
  for each row execute function public.reputation_on_company_profiles();

drop trigger if exists trg_reputation_candidate_documents on public.candidate_documents;
create trigger trg_reputation_candidate_documents
  after insert or update or delete on public.candidate_documents
  for each row execute function public.reputation_on_candidate_documents();

drop trigger if exists trg_reputation_candidate_skill_documents on public.candidate_skill_documents;
create trigger trg_reputation_candidate_skill_documents
  after insert or delete on public.candidate_skill_documents
  for each row execute function public.reputation_on_candidate_skill_documents();

drop trigger if exists trg_reputation_candidate_skills on public.candidate_skills;
create trigger trg_reputation_candidate_skills
  after insert or update or delete on public.candidate_skills
  for each row execute function public.reputation_on_candidate_skills();

-- ════════════════════════════════════════════════════════════════════
-- 8. Échéances : tâche planifiée idempotente
-- ════════════════════════════════════════════════════════════════════
-- Toutes les 15 minutes (pg_cron, comme les purges existantes) :
--   a. les profils dont un justificatif approuvé a atteint son échéance sont
--      recalculés (cause document_expired) : notification persistante, lue
--      à la reconnexion, sans visite du profil ;
--   b. rappels J−30, J−7 et à l'expiration des justificatifs approuvés
--      (document_expirations, drapeaux notified_*). Un document dont
--      l'expiration a déjà fait perdre des étoiles n'a pas de second avis ;
--   c. mêmes rappels pour la CNI vérifiée (ligne document_expirations
--      'cni' écrite par moderate_cni, reprise ici et alignée sur
--      candidate_profiles.cni_expires_at ; drapeaux remis à zéro si la date
--      change). La CNI ne compte dans aucune catégorie de la réputation :
--      ces rappels n'en modifient pas le score.
-- Chaque étape verrouille ses lignes (skip locked) : deux exécutions
-- simultanées ne doublent rien. Les tiers voient déjà le bon score entre
-- l'échéance et le passage de la tâche (reputation_stars_for).
create unique index if not exists document_expirations_document_unique
  on public.document_expirations (candidate_document_id)
  where candidate_document_id is not null;

-- Une ligne de suivi CNI par candidat (moderate_cni supprime puis insère ;
-- on retire d'éventuels doublons antérieurs en gardant la plus récente).
delete from public.document_expirations de
using public.document_expirations newer
where de.document_type = 'cni' and newer.document_type = 'cni'
  and de.candidate_document_id is null and newer.candidate_document_id is null
  and de.candidate_id = newer.candidate_id
  and (de.created_at, de.id) < (newer.created_at, newer.id);
create unique index if not exists document_expirations_cni_unique
  on public.document_expirations (candidate_id)
  where document_type = 'cni' and candidate_document_id is null;

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
    v_after := public.refresh_reputation(s.subject_type, s.subject_id, 'document_expired',
      jsonb_build_object('documents', v_docs));
    if v_after is not null and v_after < v_before then
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

-- ════════════════════════════════════════════════════════════════════
-- 9. Lecture par le titulaire, accusé de l'animation
-- ════════════════════════════════════════════════════════════════════
create or replace function public.my_reputation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_type text;
  v_id uuid;
  v_score record;
  v_pending jsonb;
  v_ts record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select cp.id into v_id from public.candidate_profiles cp where cp.user_id = v_uid;
  if found then
    v_type := 'candidate';
  else
    select cp.id into v_id from public.company_profiles cp where cp.user_id = v_uid;
    if found then
      v_type := 'company';
    end if;
  end if;
  if v_type is null then
    return null;
  end if;

  select * into v_score from public.compute_reputation(v_type, v_id, now());

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'from', c.from_stars, 'to', c.to_stars,
                   'direction', c.direction, 'cause', c.cause, 'details', c.details,
                   'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
  into v_pending
  from (select * from public.reputation_changes rc
        where rc.user_id = v_uid and rc.acknowledged_at is null
        order by rc.created_at desc limit 10) c;

  return jsonb_build_object(
    'subject_type', v_type,
    'stars', v_score.stars,
    'server_now', now(),
    'profile', jsonb_build_object('pct', v_score.profile_pct, 'stars', v_score.profile_stars),
    'experience', jsonb_build_object('units', v_score.experience_units, 'cap', 20,
                                     'stars', v_score.experience_stars,
                                     'confirmed', v_score.confirmed_count,
                                     'breaches', v_score.breach_count),
    'reviews', jsonb_build_object('units', v_score.review_units,
                                  'cap', case when v_type = 'candidate' then 10 else 20 end,
                                  'stars', v_score.review_stars),
    'skills', case when v_type = 'candidate' then
                jsonb_build_object('count', v_score.skill_count, 'stars', v_score.skill_stars)
              end,
    'next_expiry_at', v_score.next_expiry_at,
    'pending_changes', v_pending
  );
end;
$$;

-- Renvoie les variations acquittées PAR CET APPEL : un seul onglet (ou une
-- seule reconnexion) obtient une variation donnée et joue l'animation.
create or replace function public.acknowledge_reputation_changes(p_ids uuid[])
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.reputation_changes c
  set acknowledged_at = now()
  where c.id = any (coalesce(p_ids, '{}'::uuid[]))
    and c.user_id = (select auth.uid())
    and c.acknowledged_at is null
  returning c.id;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 10. Administration : impact des avis et contestations
-- ════════════════════════════════════════════════════════════════════
-- Impact de chaque avis reçu dans le rejeu (clé service, API admin).
create or replace function public.admin_reputation_review_impacts(
  p_subject_type text, p_subject_id uuid)
returns table (
  review_id uuid,
  admissible boolean,
  nominal_delta integer,
  applied_delta integer,
  balance_after integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap integer := case when p_subject_type = 'candidate' then 10 else 20 end;
  v_units integer := 0;
  v_next integer;
  r record;
begin
  for r in
    select rv.id, rv.overall_rating, public.reputation_review_admissible(rv.id) as ok
    from public.reviews rv
    where rv.reviewed_type = p_subject_type and rv.reviewed_id = p_subject_id
    order by rv.created_at, rv.id
  loop
    if r.ok then
      v_next := greatest(0, least(v_cap, v_units + public.reputation_review_delta(r.overall_rating)));
      return query select r.id, true, public.reputation_review_delta(r.overall_rating),
        v_next - v_units, v_next;
      v_units := v_next;
    else
      return query select r.id, false, public.reputation_review_delta(r.overall_rating), 0, v_units;
    end if;
  end loop;
end;
$$;

-- Rattache une contestation reçue par le support à l'avis (3 grades).
create or replace function public.admin_open_review_contest(p_review_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_review public.reviews;
  v_reviewed_user uuid;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select u.role::text into v_role from public.users u where u.id = v_uid and u.is_active is not false;
  if v_role is null or v_role not in ('admin_support', 'admin_ops', 'admin_founder') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_note is null or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select r.* into v_review from public.reviews r where r.id = p_review_id for update;
  if not found or v_review.origin is distinct from 'mission_flow' then
    raise exception 'review_not_found';
  end if;
  select d.id into v_id from public.disputes d
  where d.review_id = p_review_id and d.type = 'review_contest';
  if found then
    return v_id;
  end if;

  if v_review.reviewed_type = 'candidate' then
    select cp.user_id into v_reviewed_user from public.candidate_profiles cp where cp.id = v_review.reviewed_id;
  else
    select cp.user_id into v_reviewed_user from public.company_profiles cp where cp.id = v_review.reviewed_id;
  end if;

  insert into public.disputes (mission_id, opened_by, type, description, status, review_id)
  values (v_review.mission_id, coalesce(v_reviewed_user, v_uid), 'review_contest', v_note,
          'open', p_review_id)
  returning id into v_id;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'open_review_contest', 'reviews', p_review_id,
          jsonb_build_object('dispute_id', v_id, 'reviewed_type', v_review.reviewed_type,
                             'reviewed_id', v_review.reviewed_id, 'note', v_note));
  return v_id;
end;
$$;

-- Tranche la contestation (admin_ops, admin_founder) : décision définitive,
-- tracée, score recalculé dans la même transaction (trigger de disputes).
create or replace function public.admin_resolve_review_contest(
  p_review_id uuid, p_outcome text, p_note text)
returns table (dispute_id uuid, outcome text, stars_before numeric, stars_after numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_review public.reviews;
  v_dispute public.disputes;
  v_before numeric;
  v_after numeric;
  v_user uuid;
  v_locale text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select u.role::text into v_role from public.users u where u.id = v_uid and u.is_active is not false;
  if v_role is null or v_role not in ('admin_ops', 'admin_founder') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('upheld', 'rejected') then
    raise exception 'outcome_invalid';
  end if;
  if v_note is null or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select r.* into v_review from public.reviews r where r.id = p_review_id;
  if not found then
    raise exception 'review_not_found';
  end if;
  select d.* into v_dispute from public.disputes d
  where d.review_id = p_review_id and d.type = 'review_contest' for update;
  if not found then
    raise exception 'contest_not_found';
  end if;
  if v_dispute.outcome is not null then
    raise exception 'contest_already_resolved';
  end if;

  v_before := public.reputation_stars_for(v_review.reviewed_type, v_review.reviewed_id);

  update public.disputes d
  set status = 'resolved', outcome = p_outcome, resolution = v_note,
      resolved_by = v_uid, resolved_at = now()
  where d.id = v_dispute.id;

  select s.stars into v_after from public.reputation_scores s
  where s.subject_type = v_review.reviewed_type and s.subject_id = v_review.reviewed_id;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'resolve_review_contest', 'reviews', p_review_id,
          jsonb_build_object('dispute_id', v_dispute.id, 'outcome', p_outcome, 'note', v_note,
                             'reviewed_type', v_review.reviewed_type,
                             'reviewed_id', v_review.reviewed_id,
                             'stars_before', v_before, 'stars_after', v_after));

  -- Décision portée à la partie qui a contesté.
  v_user := v_dispute.opened_by;
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_user;
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (v_user, 'system',
    case when v_locale = 'en' then 'Review dispute decided' else 'Contestation examinée' end,
    case
      when p_outcome = 'upheld' and v_locale = 'en'
        then 'Your dispute was accepted: the review no longer counts towards your reputation.'
      when p_outcome = 'upheld'
        then 'Votre contestation est acceptée : l''avis ne compte plus dans votre réputation.'
      when v_locale = 'en'
        then 'Your dispute was reviewed: the review is kept.'
      else 'Votre contestation a été examinée : l''avis est maintenu.'
    end,
    jsonb_build_object('kind', 'review_contest', 'outcome', p_outcome,
      'href', case when v_review.reviewed_type = 'candidate' then '/profile/candidate#reputation'
                   else '/profile/company#reputation' end));

  return query select v_dispute.id, p_outcome, v_before, v_after;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 11. Évaluation : motifs vérifiés côté serveur
-- ════════════════════════════════════════════════════════════════════
-- Définition de 20261106140000 avec p_reasons : codes de la partie évaluée,
-- distincts, au moins un si la note est < 3 ; aucun pour 4 ou 5.
drop function if exists public.submit_mission_review(uuid, integer, text);

create or replace function public.submit_mission_review(
  p_mission_id uuid,
  p_rating integer,
  p_comment text default null,
  p_reasons text[] default '{}'::text[]
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
  v_reviewed text;
  v_existing public.reviews;
  v_review public.reviews;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_reasons text[];
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
  v_reviewed := case when v_side = 'candidate' then 'company' else 'candidate' end;

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

  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_reasons
  from unnest(coalesce(p_reasons, '{}'::text[])) x;
  if cardinality(v_reasons) > 6
     or not (v_reasons <@ public.review_reasons_for(v_reviewed)) then
    raise exception 'reasons_invalid';
  end if;
  if p_rating < 3 and cardinality(v_reasons) = 0 then
    raise exception 'reasons_required';
  end if;
  if p_rating >= 4 and cardinality(v_reasons) > 0 then
    raise exception 'reasons_invalid';
  end if;

  insert into public.reviews (
    mission_id, reviewer_type, reviewer_id, reviewed_type, reviewed_id,
    overall_rating, comment, origin, reasons, is_public
  ) values (
    v_mission.id, v_side,
    case when v_side = 'candidate' then v_mission.candidate_id else v_job.company_id end,
    v_reviewed,
    case when v_side = 'candidate' then v_job.company_id else v_mission.candidate_id end,
    p_rating, v_comment, 'mission_flow', v_reasons, false
  )
  returning * into v_review;

  -- Étoiles sources (trg_refresh_review_rating) et réputation
  -- (trg_reputation_reviews) : triggers.

  return query select v_review.id, v_review.reviewer_type, v_review.overall_rating,
    v_review.created_at, false;
end;
$$;

revoke all on function public.submit_mission_review(uuid, integer, text, text[]) from public, anon;
grant execute on function public.submit_mission_review(uuid, integer, text, text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Surfaces des tiers : étoiles seules
-- ════════════════════════════════════════════════════════════════════
-- Candidats d'une offre vus par l'entreprise : average_rating, review_count
-- et completed_missions sont remplacés par reputation_stars. Ordre et
-- autres colonnes inchangés (F-16).
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
  skills text[]
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
                   where s.candidate_id = c.id), '{}'::text[])
  from public.job_applications a
  join public.candidate_profiles c on c.id = a.candidate_id
  where a.job_id = p_job_id
  order by a.match_score desc nulls last, a.created_at;
end;
$$;

revoke all on function public.company_job_applicants(uuid) from public, anon;
grant execute on function public.company_job_applicants(uuid) to authenticated;

-- Fiche entreprise publique (détail d'offre) : étoiles de l'entreprise.
-- Le score entreprise ne dépend d'aucune échéance : la projection suffit.
create or replace view public.company_public_profiles
with (security_barrier = true)
as
select cp.id, cp.company_name, cp.logo_url, cp.city, cp.sector, cp.description,
       coalesce((select rs.stars from public.reputation_scores rs
                 where rs.subject_type = 'company' and rs.subject_id = cp.id), 0)::numeric(2,1)
         as reputation_stars
from public.company_profiles cp
where exists (select 1 from public.jobs j where j.company_id = cp.id and j.status = 'active')
   or exists (select 1 from public.jobs j
              join public.job_applications a on a.job_id = j.id
              join public.candidate_profiles c on c.id = a.candidate_id
              where j.company_id = cp.id and c.user_id = (select auth.uid()))
   or cp.user_id = (select auth.uid());

revoke all on public.company_public_profiles from public, anon, authenticated;
grant select on public.company_public_profiles to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 13. Droits des fonctions
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reputation_half_stars(integer, integer)',
    'public.reputation_profile_stars(integer)',
    'public.reputation_document_valid(text, date, timestamptz)',
    'public.license_categories_for(text)',
    'public.company_profile_completion_pct(public.company_profiles)',
    'public.reputation_review_admissible(uuid)',
    'public.reputation_review_delta(integer)',
    'public.reputation_review_units(text, uuid, integer)',
    'public.reputation_company_offers(uuid)',
    'public.compute_reputation(text, uuid, timestamptz)',
    'public.reputation_stars_text(numeric, text)',
    'public.refresh_reputation(text, uuid, text, jsonb, boolean)',
    'public.reputation_stars_for(text, uuid)',
    'public.reputation_on_missions()',
    'public.reputation_on_job_applications()',
    'public.reputation_on_reviews()',
    'public.reputation_on_disputes()',
    'public.reputation_on_incidents()',
    'public.reputation_on_candidate_profiles()',
    'public.reputation_on_company_profiles()',
    'public.reputation_on_candidate_documents()',
    'public.reputation_on_candidate_skill_documents()',
    'public.reputation_on_candidate_skills()',
    'public.reputation_on_profile_delete()',
    'public.protect_reputation_incidents()',
    'public.reputation_expiry_sweep()',
    'public.admin_reputation_review_impacts(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

grant execute on function public.compute_reputation(text, uuid, timestamptz) to service_role;
grant execute on function public.reputation_expiry_sweep() to service_role;
grant execute on function public.admin_reputation_review_impacts(text, uuid) to service_role;

revoke all on function public.my_reputation() from public, anon;
grant execute on function public.my_reputation() to authenticated;
revoke all on function public.acknowledge_reputation_changes(uuid[]) from public, anon;
grant execute on function public.acknowledge_reputation_changes(uuid[]) to authenticated;
revoke all on function public.admin_open_review_contest(uuid, text) from public, anon;
grant execute on function public.admin_open_review_contest(uuid, text) to authenticated;
revoke all on function public.admin_resolve_review_contest(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_review_contest(uuid, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 14. Reprise des données
-- ════════════════════════════════════════════════════════════════════
-- Score initial de chaque profil existant, sans notification ni variation
-- (p_silent) ; completed_missions réécrit depuis les missions confirmées
-- par code (seules les lignes qui diffèrent).
do $$
declare
  r record;
  v_candidates integer := 0;
  v_companies integer := 0;
begin
  for r in select cp.id from public.candidate_profiles cp order by cp.id loop
    perform public.refresh_reputation('candidate', r.id, 'initial', '{}'::jsonb, true);
    v_candidates := v_candidates + 1;
  end loop;
  for r in select cp.id from public.company_profiles cp order by cp.id loop
    perform public.refresh_reputation('company', r.id, 'initial', '{}'::jsonb, true);
    v_companies := v_companies + 1;
  end loop;
  raise notice 'reputation: % candidate and % company scores initialised', v_candidates, v_companies;
end
$$;

-- is_public n'ouvre plus aucune lecture ; les avis vérifiés étant immuables
-- (protect_review_writes), seules les nouvelles lignes passent à false.
alter table public.reviews alter column is_public set default false;

-- Planification (pg_cron) : même garde que les purges existantes.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema extensions;
      perform cron.unschedule('reputation-expiry-sweep')
      where exists (select 1 from cron.job where jobname = 'reputation-expiry-sweep');
      perform cron.schedule(
        'reputation-expiry-sweep',
        '*/15 * * * *',
        $cron$select public.reputation_expiry_sweep();$cron$
      );
    exception when others then
      raise notice 'pg_cron non activé : reputation_expiry_sweep à planifier manuellement.';
    end;
  end if;
end
$$;
