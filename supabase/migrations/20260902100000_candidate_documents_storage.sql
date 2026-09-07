-- Migration : Stockage privé des documents candidat (photo, CNI, selfie)
-- Date : 2026-09-02
-- Tables affectées : storage.buckets, storage.objects (policies)
-- Objectif : permettre l'upload réel de la photo de profil et des documents
--            CNI (recto/verso/selfie) exigés par le SRS §6.2, dans un bucket
--            privé où chaque candidat ne peut lire/écrire que ses propres
--            fichiers (dossier = user_id), avec accès uniquement via URL
--            signée temporaire côté serveur (jamais d'URL publique).
-- Rollback :
--   drop policy if exists "candidate_documents_owner_select" on storage.objects;
--   drop policy if exists "candidate_documents_owner_insert" on storage.objects;
--   drop policy if exists "candidate_documents_owner_update" on storage.objects;
--   drop policy if exists "candidate_documents_owner_delete" on storage.objects;
--   delete from storage.buckets where id = 'candidate-documents';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-documents',
  'candidate-documents',
  false,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Chaque objet est stocké sous "<user_id>/<uuid>.<ext>" : le premier segment
-- du chemin (storage.foldername renvoie un tableau de dossiers) doit
-- correspondre à l'utilisateur authentifié.
create policy "candidate_documents_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "candidate_documents_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "candidate_documents_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "candidate_documents_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
