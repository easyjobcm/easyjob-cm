-- Migration : Lecture admin sur candidate_skills
-- Date : 2026-09-03
-- Table affectée : candidate_skills (policy RLS)
-- Contexte : candidate_skills n'a qu'une seule policy —
--            "Candidates can manage own skills" (FOR ALL,
--            USING candidate_id IN (SELECT id FROM candidate_profiles
--            WHERE user_id = auth.uid())). La page /admin/skill-documents et
--            l'API liste admin imbriquent
--            candidate_documents -> candidate_skill_documents ->
--            candidate_skills (skill_name). PostgREST applique la RLS à
--            chaque niveau d'embed : pour un admin, candidate_skills
--            retournait 0 ligne -> skill_name vide dans la liste et le modal
--            de revue, rendant la décision de validation US-ADMIN-05
--            impossible (l'admin ne voyait pas quelle compétence était
--            justifiée). Cette migration est le symétrique exact de
--            20260903130000 (candidate_profiles), qui corrigeait le même
--            type de bug d'inner-join admin au niveau du profil.
--            Le trigger protect_candidate_skill_verification_status
--            (migration 20260903110000) reste en place : la policy
--            SELECT n'ouvre AUCUN droit d'écriture sur la colonne
--            verification_status.
-- Rollback :
--   drop policy if exists "candidate_skills_admin_select" on public.candidate_skills;

begin;

create policy "candidate_skills_admin_select" on public.candidate_skills
  for select
  using (public.is_admin_user((select auth.uid())));

commit;
