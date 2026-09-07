-- Migration : Activation de Supabase Realtime pour la synchro candidat
-- Date : 2026-06-05
-- Tables affectées : public.missions, public.job_applications
-- Objectif : diffuser les changements de statut de candidature et les
--            validations arrivée/départ des missions vers le client candidat
--            (onglets Tâches et Mes Jobs), en remplacement du polling SWR.
-- Sécurité : la RLS existante ("Candidates can view own missions" /
--            "Candidates can view own applications") est respectée par
--            Realtime — chaque candidat ne reçoit que ses propres lignes.
-- Rollback :
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.missions;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.job_applications;
--   ALTER TABLE public.missions REPLICA IDENTITY DEFAULT;
--   ALTER TABLE public.job_applications REPLICA IDENTITY DEFAULT;

-- REPLICA IDENTITY FULL : rend la colonne candidate_id disponible pour le
-- filtre Realtime (candidate_id=eq.<id>) sur tous les types d'événement,
-- y compris UPDATE/DELETE.
ALTER TABLE public.missions REPLICA IDENTITY FULL;
ALTER TABLE public.job_applications REPLICA IDENTITY FULL;

-- Ajout des tables à la publication Realtime, de façon idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'missions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.missions;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'job_applications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_applications;
  END IF;
END
$$;
