-- Cleanup des inscriptions abandonnées.
-- Supprime de auth.users (cascade → public.users + profils) :
--   • Email jamais confirmé > 1h après création
--   • Email confirmé mais téléphone jamais vérifié > 30 min après création
-- Schedulé toutes les 15 min via pg_cron si l'extension est disponible.

CREATE OR REPLACE FUNCTION public.cleanup_unconfirmed_signups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH del AS (
    DELETE FROM auth.users u
    WHERE
      (u.email_confirmed_at IS NULL AND u.created_at < now() - interval '1 hour')
      OR (
        u.email_confirmed_at IS NOT NULL
        AND (u.phone IS NULL OR u.phone = '')
        AND u.created_at < now() - interval '30 minutes'
      )
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM del;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_unconfirmed_signups() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_unconfirmed_signups() TO service_role;

-- Schedule via pg_cron (cloud Supabase l'a par défaut). En local, on skip si absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

      PERFORM cron.unschedule('cleanup-unconfirmed-signups')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'cleanup-unconfirmed-signups'
      );

      PERFORM cron.schedule(
        'cleanup-unconfirmed-signups',
        '*/15 * * * *',
        $cron$SELECT public.cleanup_unconfirmed_signups();$cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron non activé (shared_preload_libraries) : cleanup à scheduler manuellement.';
    END;
  END IF;
END;
$$;

-- Rollback :
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       PERFORM cron.unschedule('cleanup-unconfirmed-signups');
--     END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.cleanup_unconfirmed_signups();
