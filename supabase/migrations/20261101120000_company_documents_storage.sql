-- Migration : Stockage privé des justificatifs entreprise (document RCCM)
-- Date : 2026-11-01
-- Tables affectées : storage.buckets, storage.objects (policies)
-- Objectif : l'onboarding entreprise collecte le document RCCM, mais aucun
--            bucket ne permettait de le conserver. Même modèle que
--            `candidate-documents` : bucket privé, un dossier par
--            utilisateur (<user_id>/...), lecture admin pour la revue,
--            accès uniquement via URL signée côté serveur. Le chemin est
--            enregistré dans `company_profiles.documents_url` par
--            `PUT /api/company/onboarding`.
-- Rollback :
--   drop policy if exists "company_documents_owner_select" on storage.objects;
--   drop policy if exists "company_documents_owner_insert" on storage.objects;
--   drop policy if exists "company_documents_owner_delete" on storage.objects;
--   drop policy if exists "company_documents_admin_select" on storage.objects;
--   delete from storage.buckets where id = 'company-documents';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-documents',
  'company-documents',
  false,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Le premier segment du chemin doit être l'utilisateur authentifié. Pas de
-- politique UPDATE : un nouveau document est un nouvel objet, l'ancien est
-- supprimé après l'enregistrement du nouveau chemin.
create policy "company_documents_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "company_documents_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "company_documents_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "company_documents_admin_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_admin_user((select auth.uid()))
  );
