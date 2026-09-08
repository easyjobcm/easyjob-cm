-- Migration : Autoriser les administrateurs à créer des notifications
-- Date : 2026-09-03
-- Tables affectées : notifications (policy RLS)
-- Contexte : la table notifications n'avait AUCUNE policy INSERT (RLS deny-by-
--            default), ce qui empêchait tout envoi de notification applicatif
--            (candidature, modération d'offre, validation de justificatif...).
--            Nécessaire pour US-ADMIN-05 / US-PROF-04 (notification de
--            validation/refus de document) mais réutilisable pour les autres
--            TODO "send notification" déjà présents dans le code.
-- Rollback :
--   drop policy if exists "notifications_insert_admin" on public.notifications;

begin;

create policy "notifications_insert_admin" on public.notifications
  for insert
  with check (public.is_admin_user((select auth.uid())));

commit;
