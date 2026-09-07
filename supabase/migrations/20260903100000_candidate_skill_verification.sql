-- Migration : Vérification des compétences candidat par documents justificatifs
-- Date : 2026-09-03
-- Tables affectées : candidate_skills (colonne), candidate_documents (nouveau),
--                     candidate_skill_documents (nouveau), job_required_skill_documents
--                     (nouveau), jobs (colonne), document_expirations (colonne + contrainte),
--                     storage.buckets / storage.objects (bucket candidate-documents),
--                     notification_type (enum)
-- Référence : SRS §6.14, §5.2, §5.4, §8.1 ; US-PROF-04, US-ADMIN-05, US-MATCH-03
-- Idempotent : IF NOT EXISTS / DO blocs sur toutes les créations. Sûr à rejouer.
-- Rollback (à exécuter manuellement, ordre inverse) :
--   drop policy if exists "candidate_documents_admin_select" on storage.objects;
--   update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'candidate-documents';
--   drop table if exists public.job_required_skill_documents;
--   drop table if exists public.candidate_skill_documents;
--   drop table if exists public.candidate_documents;
--   alter table public.document_expirations drop column if exists candidate_document_id;
--   alter table public.document_expirations drop constraint if exists document_expirations_document_type_chk;
--   alter table public.document_expirations add constraint document_expirations_document_type_chk check (document_type = any (array['cni','driving_license','other']));
--   alter table public.candidate_skills drop constraint if exists candidate_skills_verification_status_chk;
--   alter table public.candidate_skills drop column if exists verification_status;
--   alter table public.jobs drop column if exists required_documents;
--   drop function if exists public.is_ops_admin_user(uuid);
--   -- notification_type : les valeurs ENUM ajoutées ne peuvent pas être retirées (limitation Postgres).

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. jobs — exigences documentaires simples (cni, permis, casier...)
--    Aligné sur job_templates.required_documents (déjà existant).
-- ────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists required_documents text[];

-- ────────────────────────────────────────────────────────────────────
-- 2. candidate_skills — statut de vérification par compétence
-- ────────────────────────────────────────────────────────────────────
alter table public.candidate_skills
  add column if not exists verification_status text not null default 'unverified';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'candidate_skills_verification_status_chk'
  ) then
    alter table public.candidate_skills
      add constraint candidate_skills_verification_status_chk
      check (verification_status = any (array['unverified','pending','verified','rejected','expired']));
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Fonction helper : admin habilité à valider/refuser (admin_ops/admin_founder)
--    admin_support garde un accès lecture seule (couvert par is_admin_user).
-- ────────────────────────────────────────────────────────────────────
create or replace function public.is_ops_admin_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('admin_ops','admin_founder')
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. candidate_documents — justificatifs professionnels (CV, diplôme,
--    certificat, attestations, permis, casier judiciaire, autre)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  document_type text not null,
  title text not null,
  issuing_organization text,
  reference_number text,
  issued_at date,
  expires_at date,
  storage_path text not null,
  status text not null default 'pending',
  rejection_reason text,
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_documents_document_type_chk check (
    document_type = any (array[
      'cv','diplome','certificat','attestation_formation',
      'attestation_travail','permis_conduire','casier_judiciaire','autre'
    ])
  ),
  constraint candidate_documents_status_chk check (
    status = any (array['pending','verified','rejected','expired'])
  )
);

create index if not exists idx_candidate_documents_candidate_id on public.candidate_documents(candidate_id);
create index if not exists idx_candidate_documents_status on public.candidate_documents(status);

drop trigger if exists trg_candidate_documents_set_updated_at on public.candidate_documents;
create trigger trg_candidate_documents_set_updated_at
  before update on public.candidate_documents
  for each row execute function public.set_updated_at();

alter table public.candidate_documents enable row level security;

-- Lecture : le candidat propriétaire, ou tout administrateur (support inclus, lecture seule).
create policy "candidate_documents_select_own_or_admin"
  on public.candidate_documents
  for select
  using (
    exists (
      select 1 from public.candidate_profiles cp
      where cp.id = candidate_documents.candidate_id
        and cp.user_id = (select auth.uid())
    )
    or public.is_admin_user((select auth.uid()))
  );

-- Ajout : uniquement le candidat propriétaire, toujours en statut "pending"
-- (jamais "verified" à l'upload — pas d'auto-vérification côté client).
create policy "candidate_documents_insert_own"
  on public.candidate_documents
  for insert
  with check (
    status = 'pending'
    and verified_by is null
    and verified_at is null
    and exists (
      select 1 from public.candidate_profiles cp
      where cp.id = candidate_documents.candidate_id
        and cp.user_id = (select auth.uid())
    )
  );

-- Validation/refus : réservé à admin_ops / admin_founder (jamais le candidat lui-même).
create policy "candidate_documents_update_ops_admin"
  on public.candidate_documents
  for update
  using (public.is_ops_admin_user((select auth.uid())))
  with check (public.is_ops_admin_user((select auth.uid())));

-- Suppression : le candidat propriétaire, uniquement tant que le document
-- n'est pas encore vérifié (rétention d'audit pour les documents validés/expirés).
create policy "candidate_documents_delete_own_pending_or_rejected"
  on public.candidate_documents
  for delete
  using (
    status in ('pending','rejected')
    and exists (
      select 1 from public.candidate_profiles cp
      where cp.id = candidate_documents.candidate_id
        and cp.user_id = (select auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 5. candidate_skill_documents — association compétence <-> document
--    (un document peut couvrir plusieurs compétences, sans duplication)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.candidate_skill_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_skill_id uuid not null references public.candidate_skills(id) on delete cascade,
  candidate_document_id uuid not null references public.candidate_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint candidate_skill_documents_unique unique (candidate_skill_id, candidate_document_id)
);

create index if not exists idx_csd_skill_id on public.candidate_skill_documents(candidate_skill_id);
create index if not exists idx_csd_document_id on public.candidate_skill_documents(candidate_document_id);

alter table public.candidate_skill_documents enable row level security;

create policy "candidate_skill_documents_select_own_or_admin"
  on public.candidate_skill_documents
  for select
  using (
    exists (
      select 1
      from public.candidate_skills cs
      join public.candidate_profiles cp on cp.id = cs.candidate_id
      where cs.id = candidate_skill_documents.candidate_skill_id
        and cp.user_id = (select auth.uid())
    )
    or public.is_admin_user((select auth.uid()))
  );

-- Le candidat ne peut lier qu'une compétence et un document qui lui appartiennent tous les deux.
create policy "candidate_skill_documents_insert_own"
  on public.candidate_skill_documents
  for insert
  with check (
    exists (
      select 1
      from public.candidate_skills cs
      join public.candidate_profiles cp on cp.id = cs.candidate_id
      where cs.id = candidate_skill_documents.candidate_skill_id
        and cp.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.candidate_documents cd
      join public.candidate_profiles cp on cp.id = cd.candidate_id
      where cd.id = candidate_skill_documents.candidate_document_id
        and cp.user_id = (select auth.uid())
    )
  );

create policy "candidate_skill_documents_delete_own"
  on public.candidate_skill_documents
  for delete
  using (
    exists (
      select 1
      from public.candidate_skills cs
      join public.candidate_profiles cp on cp.id = cs.candidate_id
      where cs.id = candidate_skill_documents.candidate_skill_id
        and cp.user_id = (select auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 6. job_required_skill_documents — exigence de justificatif par
--    compétence sur une offre (ex : "Cuisine" nécessite un "certificat")
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.job_required_skill_documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  skill_name text not null,
  document_type text not null,
  created_at timestamptz not null default now(),
  constraint job_required_skill_documents_document_type_chk check (
    document_type = any (array[
      'cv','diplome','certificat','attestation_formation',
      'attestation_travail','permis_conduire','casier_judiciaire','autre'
    ])
  )
);

create index if not exists idx_jrsd_job_id on public.job_required_skill_documents(job_id);

alter table public.job_required_skill_documents enable row level security;

-- Lecture : mêmes règles de visibilité que l'offre (publiée, ou propriétaire, ou admin).
create policy "job_required_skill_documents_select_visible_job"
  on public.job_required_skill_documents
  for select
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_required_skill_documents.job_id
        and (
          j.status = 'published'
          or j.company_id in (
            select id from public.company_profiles where user_id = (select auth.uid())
          )
        )
    )
    or public.is_admin_user((select auth.uid()))
  );

-- Écriture : uniquement l'entreprise propriétaire de l'offre.
create policy "job_required_skill_documents_manage_own_job"
  on public.job_required_skill_documents
  for all
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_required_skill_documents.job_id
        and j.company_id in (
          select id from public.company_profiles where user_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_required_skill_documents.job_id
        and j.company_id in (
          select id from public.company_profiles where user_id = (select auth.uid())
        )
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 7. document_expirations — extension pour couvrir les justificatifs
--    de compétences (en plus de cni / driving_license / other)
-- ────────────────────────────────────────────────────────────────────
alter table public.document_expirations
  add column if not exists candidate_document_id uuid references public.candidate_documents(id) on delete cascade;

create index if not exists idx_document_expirations_candidate_document_id
  on public.document_expirations(candidate_document_id);

alter table public.document_expirations
  drop constraint if exists document_expirations_document_type_chk;

alter table public.document_expirations
  add constraint document_expirations_document_type_chk
  check (document_type = any (array['cni','driving_license','skill_document','other']));

-- ────────────────────────────────────────────────────────────────────
-- 8. Storage — bucket candidate-documents : autoriser le PDF (diplômes,
--    certificats, attestations) en plus des images déjà supportées.
-- ────────────────────────────────────────────────────────────────────
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
where id = 'candidate-documents';

-- Lecture admin (support/ops/founder) des documents pour la revue de vérification.
-- Toujours via URL signée de courte durée côté serveur, jamais d'URL publique.
create policy "candidate_documents_admin_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-documents'
    and public.is_admin_user((select auth.uid()))
  );

-- ────────────────────────────────────────────────────────────────────
-- 9. notification_type — nouvel événement pour le cycle de vie des
--    justificatifs (envoyé / validé / refusé / expiré / compétence vérifiée)
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'notification_type'
  ) then
    alter type public.notification_type add value if not exists 'document_status';
  else
    raise notice 'Type public.notification_type absent, etape ignoree.';
  end if;
end;
$$;

commit;
