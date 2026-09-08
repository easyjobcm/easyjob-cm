-- Migration : Lecture admin sur candidate_profiles
-- Date : 2026-09-03
-- Tables affectées : candidate_profiles (policy RLS)
-- Contexte : candidate_profiles n'a AUCUNE policy SELECT admin (seule
--            "Candidates can view own profile" existe, USING user_id = auth.uid()).
--            La page /admin/skill-documents fait un inner join
--            candidate_documents -> candidate_profiles pour afficher le nom du
--            candidat ; RLS filtrant candidate_profiles à zéro ligne pour un
--            admin, l'inner join élimine aussi la ligne candidate_documents
--            correspondante -> la liste apparaît vide côté admin alors que les
--            documents existent bien en base.
-- Rollback :
--   drop policy if exists "candidate_profiles_admin_select" on public.candidate_profiles;

begin;

create policy "candidate_profiles_admin_select" on public.candidate_profiles
  for select
  using (public.is_admin_user((select auth.uid())));

commit;
