-- Migration : Alignement schema Easyjob CM avec SRS v1.1
-- Date : 2026-05-26
-- Tables affectees : candidate_profiles, jobs, missions, job_applications,
--                    document_expirations, disputes, subscriptions, audit_logs, sandbox_config,
--                    wallets, withdrawal_requests, payment_batches
-- Rollback : voir bloc en fin de fichier

begin;

-- -----------------------------------------------------------------------------
-- PRE-REQUIS
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Utilitaire updated_at automatique
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) AJOUT CHAMPS MANQUANTS : candidate_profiles
-- -----------------------------------------------------------------------------
alter table if exists public.candidate_profiles
  add column if not exists sandbox_level integer not null default 0,
  add column if not exists cni_selfie_url text,
  add column if not exists cni_expires_at date,
  add column if not exists driving_license_verified boolean not null default false,
  add column if not exists driving_license_expires_at date,
  add column if not exists momo_name_match boolean not null default false,
  add column if not exists premium_until timestamptz,
  add column if not exists average_rating numeric(3,2) not null default 0.00,
  add column if not exists profile_completion_pct integer not null default 0;

-- Contraintes de domaine
alter table if exists public.candidate_profiles drop constraint if exists candidate_profiles_sandbox_level_chk;
alter table if exists public.candidate_profiles
  add constraint candidate_profiles_sandbox_level_chk check (sandbox_level between 0 and 3);

alter table if exists public.candidate_profiles drop constraint if exists candidate_profiles_profile_completion_pct_chk;
alter table if exists public.candidate_profiles
  add constraint candidate_profiles_profile_completion_pct_chk check (profile_completion_pct between 0 and 100);

-- Commentaires colonnes
comment on column public.candidate_profiles.sandbox_level is 'Niveau de confiance Sandbox du candidat (0 nouveau -> 3 expert).';
comment on column public.candidate_profiles.cni_selfie_url is 'URL du selfie candidat tenant la CNI pour verification d''identite.';
comment on column public.candidate_profiles.cni_expires_at is 'Date d''expiration de la CNI du candidat pour blocage/postulation conditionnelle.';
comment on column public.candidate_profiles.driving_license_verified is 'Indique si le permis de conduire a ete verifie par l''equipe admin.';
comment on column public.candidate_profiles.driving_license_expires_at is 'Date d''expiration du permis de conduire.';
comment on column public.candidate_profiles.momo_name_match is 'Vrai si le nom du compte Mobile Money correspond au nom CNI du candidat.';
comment on column public.candidate_profiles.premium_until is 'Date de fin du statut candidat premium.';
comment on column public.candidate_profiles.average_rating is 'Note moyenne agregee du candidat (1 a 5, precision 2 decimales).';
comment on column public.candidate_profiles.profile_completion_pct is 'Pourcentage de completude du profil (0 a 100).';

-- -----------------------------------------------------------------------------
-- 2) AJOUT CHAMPS MANQUANTS : jobs
-- -----------------------------------------------------------------------------
alter table if exists public.jobs
  add column if not exists parent_job_id uuid,
  add column if not exists break_duration_minutes integer not null default 0,
  add column if not exists effective_hours numeric(4,2),
  add column if not exists location_reference text,
  add column if not exists location_photo_url text,
  add column if not exists location_map_url text,
  add column if not exists provided_equipment text[] not null default '{}'::text[],
  add column if not exists benefits text[] not null default '{}'::text[],
  add column if not exists salary_per_person_per_day numeric(10,2),
  add column if not exists required_candidates_count integer not null default 1,
  add column if not exists sandbox_level_required integer not null default 0;

alter table if exists public.jobs drop constraint if exists jobs_parent_job_id_fkey;
alter table if exists public.jobs
  add constraint jobs_parent_job_id_fkey
  foreign key (parent_job_id) references public.jobs(id) on delete cascade;

alter table if exists public.jobs drop constraint if exists jobs_sandbox_level_required_chk;
alter table if exists public.jobs
  add constraint jobs_sandbox_level_required_chk check (sandbox_level_required between 0 and 3);

alter table if exists public.jobs drop constraint if exists jobs_break_duration_minutes_chk;
alter table if exists public.jobs
  add constraint jobs_break_duration_minutes_chk check (break_duration_minutes >= 0);

alter table if exists public.jobs drop constraint if exists jobs_required_candidates_count_chk;
alter table if exists public.jobs
  add constraint jobs_required_candidates_count_chk check (required_candidates_count >= 1);

-- Commentaires colonnes
comment on column public.jobs.parent_job_id is 'Reference vers l''offre parent pour les offres multi-jours decomposees.';
comment on column public.jobs.break_duration_minutes is 'Duree de pause obligatoire en minutes (selon regles metier).';
comment on column public.jobs.effective_hours is 'Duree effective de travail (heures brutes moins pause).';
comment on column public.jobs.location_reference is 'Point de repere local pour faciliter l''arrivee du candidat.';
comment on column public.jobs.location_photo_url is 'Photo optionnelle du lieu de mission.';
comment on column public.jobs.location_map_url is 'Lien map (Google Maps ou equivalent) du lieu de mission.';
comment on column public.jobs.provided_equipment is 'Liste des equipements fournis par l''entreprise.';
comment on column public.jobs.benefits is 'Liste des avantages proposes (repas, taxi, prime, etc.).';
comment on column public.jobs.salary_per_person_per_day is 'Salaire journalier brut par candidat.';
comment on column public.jobs.required_candidates_count is 'Nombre de candidats requis pour la mission/journee.';
comment on column public.jobs.sandbox_level_required is 'Niveau Sandbox minimum requis pour postuler.';

-- -----------------------------------------------------------------------------
-- 3) AJOUT CHAMPS MANQUANTS : missions
-- -----------------------------------------------------------------------------
alter table if exists public.missions
  add column if not exists contract_type text not null default 'simple',
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_first_tranche_at timestamptz,
  add column if not exists payment_second_tranche_at timestamptz,
  add column if not exists platform_fee numeric(10,2) not null default 0,
  add column if not exists validated_at timestamptz;

alter table if exists public.missions drop constraint if exists missions_contract_type_chk;
alter table if exists public.missions
  add constraint missions_contract_type_chk check (contract_type in ('simple', 'formal'));

-- Commentaires colonnes
comment on column public.missions.contract_type is 'Type de contrat applique : simple (<3 jours) ou formal (>=3 jours).';
comment on column public.missions.payment_status is 'Etat de paiement mission (pending, partial, full, failed, refunded).';
comment on column public.missions.payment_first_tranche_at is 'Horodatage du premier versement candidat (si paiement fractionne).';
comment on column public.missions.payment_second_tranche_at is 'Horodatage du second versement candidat (si paiement fractionne).';
comment on column public.missions.platform_fee is 'Frais plateforme preleves sur la mission.';
comment on column public.missions.validated_at is 'Horodatage de validation finale de mission par entreprise/admin.';

-- -----------------------------------------------------------------------------
-- 4) AJOUT/SUPPRESSION CHAMPS : job_applications
-- -----------------------------------------------------------------------------
alter table if exists public.job_applications
  add column if not exists ai_score numeric(5,2),
  add column if not exists has_worked_here_before boolean not null default false,
  add column if not exists previous_rating numeric(3,2),
  drop column if exists candidate_note,
  drop column if exists company_note;

-- Commentaires colonnes
comment on column public.job_applications.ai_score is 'Score de matching IA (0-100) entre le candidat et l''offre.';
comment on column public.job_applications.has_worked_here_before is 'Indique si le candidat a deja travaille pour cette entreprise.';
comment on column public.job_applications.previous_rating is 'Derniere note recue chez cette entreprise (si historique disponible).';

-- -----------------------------------------------------------------------------
-- 5) CREATION TABLES MANQUANTES
-- -----------------------------------------------------------------------------

-- 5.1 document_expirations
create table if not exists public.document_expirations (
  id uuid not null default gen_random_uuid(),
  candidate_id uuid not null,
  document_type text not null,
  expires_at date not null,
  notified_30d boolean not null default false,
  notified_7d boolean not null default false,
  notified_expired boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_expirations_pkey primary key (id),
  constraint document_expirations_candidate_id_fkey foreign key (candidate_id) references public.candidate_profiles(id) on delete cascade,
  constraint document_expirations_document_type_chk check (document_type in ('cni','driving_license','other'))
);

comment on table public.document_expirations is 'Suivi des dates d''expiration des documents candidats et notifications associees.';
comment on column public.document_expirations.id is 'Identifiant unique de la ligne d''expiration document.';
comment on column public.document_expirations.candidate_id is 'Reference du candidat concerne.';
comment on column public.document_expirations.document_type is 'Type de document surveille (cni, driving_license, other).';
comment on column public.document_expirations.expires_at is 'Date d''expiration effective du document.';
comment on column public.document_expirations.notified_30d is 'Vrai si la notification J-30 a ete envoyee.';
comment on column public.document_expirations.notified_7d is 'Vrai si la notification J-7 a ete envoyee.';
comment on column public.document_expirations.notified_expired is 'Vrai si la notification de document expire a ete envoyee.';
comment on column public.document_expirations.created_at is 'Date de creation de l''enregistrement.';
comment on column public.document_expirations.updated_at is 'Date de derniere mise a jour de l''enregistrement.';

-- 5.2 disputes
create table if not exists public.disputes (
  id uuid not null default gen_random_uuid(),
  mission_id uuid not null,
  opened_by uuid not null,
  type text not null,
  description text not null,
  evidence_urls text[] not null default '{}'::text[],
  status text not null default 'open',
  resolution text,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint disputes_pkey primary key (id),
  constraint disputes_mission_id_fkey foreign key (mission_id) references public.missions(id) on delete cascade,
  constraint disputes_opened_by_fkey foreign key (opened_by) references public.users(id) on delete restrict,
  constraint disputes_resolved_by_fkey foreign key (resolved_by) references public.users(id) on delete set null
);

comment on table public.disputes is 'Gestion des litiges mission avec pieces justificatives et resolution admin.';
comment on column public.disputes.id is 'Identifiant unique du litige.';
comment on column public.disputes.mission_id is 'Mission concernee par le litige.';
comment on column public.disputes.opened_by is 'Utilisateur ayant ouvert le litige.';
comment on column public.disputes.type is 'Type de litige (absence, paiement, comportement, etc.).';
comment on column public.disputes.description is 'Description detaillee du litige.';
comment on column public.disputes.evidence_urls is 'URLs des preuves jointes (photos, documents, captures).';
comment on column public.disputes.status is 'Etat du litige (open, under_review, resolved, escalated).';
comment on column public.disputes.resolution is 'Decision/resolution finale du litige.';
comment on column public.disputes.resolved_by is 'Admin ayant cloture le litige.';
comment on column public.disputes.created_at is 'Date de creation du litige.';
comment on column public.disputes.updated_at is 'Date de derniere mise a jour du litige.';
comment on column public.disputes.resolved_at is 'Date de resolution du litige.';

-- 5.3 subscriptions
create table if not exists public.subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  plan text not null,
  price numeric(10,2) not null,
  started_at timestamptz not null,
  expires_at timestamptz,
  is_trial boolean not null default false,
  auto_renew boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_pkey primary key (id),
  constraint subscriptions_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade
);

comment on table public.subscriptions is 'Abonnements candidats/entreprises (essai, renouvellement, statut).';
comment on column public.subscriptions.id is 'Identifiant unique de l''abonnement.';
comment on column public.subscriptions.user_id is 'Utilisateur proprietaire de l''abonnement.';
comment on column public.subscriptions.plan is 'Nom du plan (gratuit, starter, pro, business, premium).';
comment on column public.subscriptions.price is 'Montant periodique de l''abonnement.';
comment on column public.subscriptions.started_at is 'Date de debut de validite.';
comment on column public.subscriptions.expires_at is 'Date de fin de validite.';
comment on column public.subscriptions.is_trial is 'Vrai si l''abonnement est en periode d''essai.';
comment on column public.subscriptions.auto_renew is 'Vrai si le renouvellement automatique est actif.';
comment on column public.subscriptions.status is 'Etat de l''abonnement (active, cancelled, expired).';
comment on column public.subscriptions.created_at is 'Date de creation de l''abonnement.';
comment on column public.subscriptions.updated_at is 'Date de derniere mise a jour de l''abonnement.';

-- 5.4 audit_logs
create table if not exists public.audit_logs (
  id uuid not null default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_logs_pkey primary key (id),
  constraint audit_logs_actor_id_fkey foreign key (actor_id) references public.users(id) on delete set null
);

comment on table public.audit_logs is 'Journal d''audit des actions sensibles et operations admin.';
comment on column public.audit_logs.id is 'Identifiant unique du log d''audit.';
comment on column public.audit_logs.actor_id is 'Utilisateur ayant execute l''action (si authentifie).';
comment on column public.audit_logs.actor_role is 'Role systeme au moment de l''action.';
comment on column public.audit_logs.action is 'Nom de l''action executee (approve_job, resolve_dispute, etc.).';
comment on column public.audit_logs.resource_type is 'Type de ressource ciblee (job, mission, user, dispute, etc.).';
comment on column public.audit_logs.resource_id is 'Identifiant de la ressource ciblee.';
comment on column public.audit_logs.metadata is 'Contexte additionnel de l''action (JSON structure).';
comment on column public.audit_logs.ip_address is 'Adresse IP source de la requete.';
comment on column public.audit_logs.created_at is 'Date de creation du log.';
comment on column public.audit_logs.updated_at is 'Date de derniere mise a jour du log.';

-- 5.5 sandbox_config
create table if not exists public.sandbox_config (
  id uuid not null default gen_random_uuid(),
  level integer not null,
  label_fr text not null,
  label_en text not null,
  min_missions integer not null,
  min_rating numeric(3,2),
  min_profile_pct integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint sandbox_config_pkey primary key (id),
  constraint sandbox_config_level_key unique (level),
  constraint sandbox_config_level_chk check (level between 0 and 3),
  constraint sandbox_config_min_missions_chk check (min_missions >= 0),
  constraint sandbox_config_min_profile_pct_chk check (min_profile_pct is null or (min_profile_pct between 0 and 100)),
  constraint sandbox_config_updated_by_fkey foreign key (updated_by) references public.users(id) on delete set null
);

comment on table public.sandbox_config is 'Parametrage dynamique des seuils Sandbox sans redeploiement.';
comment on column public.sandbox_config.id is 'Identifiant unique de configuration Sandbox.';
comment on column public.sandbox_config.level is 'Niveau Sandbox configure (0 a 3).';
comment on column public.sandbox_config.label_fr is 'Libelle FR du niveau Sandbox.';
comment on column public.sandbox_config.label_en is 'Libelle EN du niveau Sandbox.';
comment on column public.sandbox_config.min_missions is 'Nombre minimum de missions reussies pour debloquer le niveau.';
comment on column public.sandbox_config.min_rating is 'Note minimale moyenne requise pour debloquer le niveau.';
comment on column public.sandbox_config.min_profile_pct is 'Pourcentage minimal de completude profil requis.';
comment on column public.sandbox_config.is_active is 'Indique si cette regle niveau est active.';
comment on column public.sandbox_config.created_at is 'Date de creation de la regle.';
comment on column public.sandbox_config.updated_at is 'Date de derniere mise a jour de la regle.';
comment on column public.sandbox_config.updated_by is 'Admin ayant effectue la derniere mise a jour.';

-- Seed initial Sandbox config (idempotent)
insert into public.sandbox_config (level, label_fr, label_en, min_missions, min_rating, min_profile_pct, is_active)
values
  (0, 'Nouveau', 'New', 0, null, null, true),
  (1, 'Confirme', 'Confirmed', 1, 3.50, null, true),
  (2, 'Fiable', 'Reliable', 3, 4.00, 80, true),
  (3, 'Expert', 'Expert', 10, 4.50, 80, true)
on conflict (level) do update
set label_fr = excluded.label_fr,
    label_en = excluded.label_en,
    min_missions = excluded.min_missions,
    min_rating = excluded.min_rating,
    min_profile_pct = excluded.min_profile_pct,
    is_active = excluded.is_active,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- 6) TABLES HORS PERIMETRE MVP A SUPPRIMER
-- -----------------------------------------------------------------------------
drop table if exists public.payment_batches cascade;
drop table if exists public.withdrawal_requests cascade;
drop table if exists public.wallets cascade;

-- -----------------------------------------------------------------------------
-- 7) INDEXES (performances)
-- -----------------------------------------------------------------------------
create index if not exists idx_jobs_parent_job_id on public.jobs(parent_job_id);
create index if not exists idx_document_expirations_candidate_id on public.document_expirations(candidate_id);
create index if not exists idx_document_expirations_expires_at on public.document_expirations(expires_at);
create index if not exists idx_document_expirations_doc_type on public.document_expirations(document_type);

create index if not exists idx_disputes_mission_id on public.disputes(mission_id);
create index if not exists idx_disputes_opened_by on public.disputes(opened_by);
create index if not exists idx_disputes_resolved_by on public.disputes(resolved_by);
create index if not exists idx_disputes_status on public.disputes(status);
create index if not exists idx_disputes_created_at on public.disputes(created_at desc);

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_subscriptions_expires_at on public.subscriptions(expires_at);

create index if not exists idx_audit_logs_actor_id on public.audit_logs(actor_id);
create index if not exists idx_audit_logs_resource on public.audit_logs(resource_type, resource_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

create index if not exists idx_sandbox_config_updated_by on public.sandbox_config(updated_by);
create index if not exists idx_sandbox_config_is_active on public.sandbox_config(is_active);

-- -----------------------------------------------------------------------------
-- 8) UPDATED_AT TRIGGERS
-- -----------------------------------------------------------------------------
drop trigger if exists trg_document_expirations_set_updated_at on public.document_expirations;
create trigger trg_document_expirations_set_updated_at
before update on public.document_expirations
for each row execute function public.set_updated_at();

drop trigger if exists trg_disputes_set_updated_at on public.disputes;
create trigger trg_disputes_set_updated_at
before update on public.disputes
for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_set_updated_at on public.subscriptions;
create trigger trg_subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_logs_set_updated_at on public.audit_logs;
create trigger trg_audit_logs_set_updated_at
before update on public.audit_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_sandbox_config_set_updated_at on public.sandbox_config;
create trigger trg_sandbox_config_set_updated_at
before update on public.sandbox_config
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 9) RLS + POLICIES (nouvelles tables)
-- -----------------------------------------------------------------------------

-- Helpers policies
create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('admin_support','admin_ops','admin_founder')
  );
$$;

create or replace function public.is_company_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('company','company_premium')
  );
$$;

create or replace function public.is_candidate_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('candidate','candidate_premium')
  );
$$;

-- document_expirations
alter table public.document_expirations enable row level security;

drop policy if exists "document_expirations_select_own_or_admin" on public.document_expirations;
create policy "document_expirations_select_own_or_admin"
on public.document_expirations
for select
using (
  exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = document_expirations.candidate_id
      and cp.user_id = auth.uid()
  )
  or public.is_admin_user(auth.uid())
);

drop policy if exists "document_expirations_insert_admin" on public.document_expirations;
create policy "document_expirations_insert_admin"
on public.document_expirations
for insert
with check (public.is_admin_user(auth.uid()));

drop policy if exists "document_expirations_update_own_or_admin" on public.document_expirations;
create policy "document_expirations_update_own_or_admin"
on public.document_expirations
for update
using (
  exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = document_expirations.candidate_id
      and cp.user_id = auth.uid()
  )
  or public.is_admin_user(auth.uid())
)
with check (
  exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = document_expirations.candidate_id
      and cp.user_id = auth.uid()
  )
  or public.is_admin_user(auth.uid())
);

-- disputes
alter table public.disputes enable row level security;

drop policy if exists "disputes_select_party_or_admin" on public.disputes;
create policy "disputes_select_party_or_admin"
on public.disputes
for select
using (
  disputes.opened_by = auth.uid()
  or public.is_admin_user(auth.uid())
  or exists (
    select 1
    from public.missions m
    left join public.jobs j on j.id = m.job_id
    left join public.candidate_profiles cp on cp.id = m.candidate_id
    left join public.company_profiles cmp on cmp.id = j.company_id
    where m.id = disputes.mission_id
      and (
        cp.user_id = auth.uid()
        or cmp.user_id = auth.uid()
      )
  )
);

drop policy if exists "disputes_insert_party_or_admin" on public.disputes;
create policy "disputes_insert_party_or_admin"
on public.disputes
for insert
with check (
  disputes.opened_by = auth.uid()
  or public.is_admin_user(auth.uid())
);

drop policy if exists "disputes_update_admin_only" on public.disputes;
create policy "disputes_update_admin_only"
on public.disputes
for update
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

-- subscriptions
alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin"
on public.subscriptions
for select
using (
  subscriptions.user_id = auth.uid()
  or public.is_admin_user(auth.uid())
);

drop policy if exists "subscriptions_insert_admin_or_self" on public.subscriptions;
create policy "subscriptions_insert_admin_or_self"
on public.subscriptions
for insert
with check (
  subscriptions.user_id = auth.uid()
  or public.is_admin_user(auth.uid())
);

drop policy if exists "subscriptions_update_admin_only" on public.subscriptions;
create policy "subscriptions_update_admin_only"
on public.subscriptions
for update
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

-- audit_logs
alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_select_founder_only" on public.audit_logs;
create policy "audit_logs_select_founder_only"
on public.audit_logs
for select
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role::text = 'admin_founder'
  )
);

drop policy if exists "audit_logs_insert_admin_only" on public.audit_logs;
create policy "audit_logs_insert_admin_only"
on public.audit_logs
for insert
with check (public.is_admin_user(auth.uid()));

-- sandbox_config
alter table public.sandbox_config enable row level security;

drop policy if exists "sandbox_config_select_authenticated" on public.sandbox_config;
create policy "sandbox_config_select_authenticated"
on public.sandbox_config
for select
using (auth.uid() is not null);

drop policy if exists "sandbox_config_mutate_admin_ops_founder" on public.sandbox_config;
create policy "sandbox_config_mutate_admin_ops_founder"
on public.sandbox_config
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role::text in ('admin_ops','admin_founder')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role::text in ('admin_ops','admin_founder')
  )
);

commit;

-- -----------------------------------------------------------------------------
-- ROLLBACK (manuel, a adapter selon donnees production)
-- -----------------------------------------------------------------------------
-- begin;
-- alter table public.candidate_profiles
--   drop column if exists sandbox_level,
--   drop column if exists cni_selfie_url,
--   drop column if exists cni_expires_at,
--   drop column if exists driving_license_verified,
--   drop column if exists driving_license_expires_at,
--   drop column if exists momo_name_match,
--   drop column if exists premium_until,
--   drop column if exists average_rating,
--   drop column if exists profile_completion_pct;
--
-- alter table public.jobs
--   drop column if exists parent_job_id,
--   drop column if exists break_duration_minutes,
--   drop column if exists effective_hours,
--   drop column if exists location_reference,
--   drop column if exists location_photo_url,
--   drop column if exists location_map_url,
--   drop column if exists provided_equipment,
--   drop column if exists benefits,
--   drop column if exists salary_per_person_per_day,
--   drop column if exists required_candidates_count,
--   drop column if exists sandbox_level_required;
--
-- alter table public.missions
--   drop column if exists contract_type,
--   drop column if exists payment_status,
--   drop column if exists payment_first_tranche_at,
--   drop column if exists payment_second_tranche_at,
--   drop column if exists platform_fee,
--   drop column if exists validated_at;
--
-- alter table public.job_applications
--   drop column if exists ai_score,
--   drop column if exists has_worked_here_before,
--   drop column if exists previous_rating;
--
-- drop table if exists public.document_expirations cascade;
-- drop table if exists public.disputes cascade;
-- drop table if exists public.subscriptions cascade;
-- drop table if exists public.audit_logs cascade;
-- drop table if exists public.sandbox_config cascade;
--
-- -- Restauration tables hors scope (schema precedent) a faire depuis backup.
-- -- create table public.wallets (...);
-- -- create table public.withdrawal_requests (...);
-- -- create table public.payment_batches (...);
--
-- commit;
