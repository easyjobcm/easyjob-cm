-- Migration : Politique SELECT jobs alignée sur 'active'
-- Date : 2026-09-08
-- Table affectee : jobs (policy RLS FOR SELECT)
-- Contexte : la seule policy SELECT "Published jobs are viewable by all"
--            expose `status = 'published'` (ou les offres de sa propre
--            entreprise). Or la migration 20260526120000 a fait migrer
--            published -> active dans l'enum job_status, et TOUT l'app
--            tourne sur `status = 'active'` : GET /api/jobs filtre
--            .eq("status","active"), la postulation exige
--            job.status === "active", et la modération admin (approved)
--            met le statut a 'active'. Resultat : au travers de RLS, un
--            candidat ne pouvait RIEN lire sur les offres actives
--            (404 "Job not found" a la lecture de l'offre) -> toute
--            postulation etait en echec en production.
-- Fix : remplacer la condition 'published' par 'active' (les offres
--       non actives - draft, rejected, filled, expired, cancelled -
--       restent invisibles aux tiers ; seules les offres actives + ses
--       propres offres restent lues).
-- Rollback :
--   drop policy if exists "Published jobs are viewable by all"
--     on public.jobs;
--   create policy "Published jobs are viewable by all"
--     on public.jobs
--     for select
--     using (
--       status = 'published'::public.job_status
--       or company_id in (
--         select company_profiles.id
--         from company_profiles
--         where company_profiles.user_id = (select auth.uid())
--       )
--     );

begin;

drop policy "Published jobs are viewable by all" on public.jobs;

create policy "Published jobs are viewable by all"
  on public.jobs
  for select
  using (
    status = 'active'::public.job_status
    or company_id in (
      select company_profiles.id
      from company_profiles
      where company_profiles.user_id = (select auth.uid())
    )
  );

commit;
