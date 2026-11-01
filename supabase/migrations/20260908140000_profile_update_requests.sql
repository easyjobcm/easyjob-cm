-- Migration : demandes de mise à jour de profil initiées par l'admin
-- Date : 2026-09-08
-- Tables affectées : profile_update_requests (nouveau)
-- Contexte : les informations verrouillées (identité vérifiée, documents CNI
--            vérifiés) ne peuvent être modifiées par le candidat que si un
--            admin y a demandé. L'admin crée une demande (status = 'pending')
--            qui se matérialise en notification + tâche côté candidat ; le
--            candidat exécute la mise à jour via la page edit/profile
--            existante puis clôt la tâche (status = 'done', completed_at).
--            La déverrouille est testée côté serveur (PUT /api/profile/identity
--            et /api/profile/documents) : la RLS seule ne suffit pas.
--            SRS §5.1 (verrouillage + mise à jour initiée par l'admin), §6.2.
--            UI admin de création des demandes intégrée en T8 (l'endpoint
--            POST /api/admin/profile-update-requests existe dès T2).
-- Idempotent : IF NOT EXISTS partout. Sûr à rejouer.
-- Rollback (à exécuter manuellement) :
--   drop trigger if exists trg_profile_update_requests_set_updated_at on public.profile_update_requests;
--   drop table if exists public.profile_update_requests;

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. profile_update_requests — file des mises à jour demandées par l'admin
--    fields : 'identity' (prénom/nom/date de naissance) et/ou
--             'cni_documents' (recto/verso/selfie CNI).
--    status : 'pending' (en attente du candidat) -> 'done' (exécutée) ou
--             'cancelled' (abandonnée par l'admin).
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.profile_update_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  fields text[] not null default '{}'::text[],
  status text not null default 'pending',
  reason text,
  requested_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint profile_update_requests_fields_chk check (
    cardinality(fields) >= 1
    and fields <@ array['identity','cni_documents']
  ),
  constraint profile_update_requests_status_chk check (
    status = any (array['pending','done','cancelled'])
  )
);

create index if not exists idx_profile_update_requests_candidate_status
  on public.profile_update_requests (candidate_id, status);
create index if not exists idx_profile_update_requests_status
  on public.profile_update_requests (status);

drop trigger if exists trg_profile_update_requests_set_updated_at on public.profile_update_requests;
create trigger trg_profile_update_requests_set_updated_at
  before update on public.profile_update_requests
  for each row execute function public.set_updated_at();

alter table public.profile_update_requests enable row level security;

-- Lecture : le candidat propriétaire (liste ses tâches) ou tout administrateur.
create policy "profile_update_requests_select_own_or_admin"
  on public.profile_update_requests
  for select
  using (
    exists (
      select 1 from public.candidate_profiles cp
      where cp.id = profile_update_requests.candidate_id
        and cp.user_id = (select auth.uid())
    )
    or public.is_admin_user((select auth.uid()))
  );

-- Création : uniquement admin_ops / admin_founder (jamais le candidat lui-même,
-- sinon il se déverrouillerait tout seul).
create policy "profile_update_requests_insert_ops_admin"
  on public.profile_update_requests
  for insert
  with check (
    public.is_ops_admin_user((select auth.uid()))
    and status = 'pending'
    and candidate_id is not null
    and requested_by = (select auth.uid())
  );

-- Mise à jour : l'admin (annulation, statut) ; le candidat propriétaire
-- uniquement pour clôturer la tâche en 'done' (jamais de re-passage à
-- 'pending', jamais sur la demande d'un autre candidat).
create policy "profile_update_requests_update_admin_or_own_done"
  on public.profile_update_requests
  for update
  using (
    public.is_ops_admin_user((select auth.uid()))
    or exists (
      select 1 from public.candidate_profiles cp
      where cp.id = profile_update_requests.candidate_id
        and cp.user_id = (select auth.uid())
    )
  )
  with check (
    public.is_ops_admin_user((select auth.uid()))
    or (
      status = 'done'
      and exists (
        select 1 from public.candidate_profiles cp
        where cp.id = profile_update_requests.candidate_id
          and cp.user_id = (select auth.uid())
      )
    )
  );

-- Suppression : admin uniquement (rétention d'audit côté candidat).
create policy "profile_update_requests_delete_ops_admin"
  on public.profile_update_requests
  for delete
  using (public.is_ops_admin_user((select auth.uid())));

commit;
