-- Anti-abus EMAIL : log + quota par adresse et par IP.
-- Évite qu'un bot spam "Renvoyer le code" et fasse exploser la facture SMTP
-- ou blackliste le domaine expéditeur.

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id         bigserial PRIMARY KEY,
  email      text        NOT NULL,
  ip         text,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS email_send_log_email_sent_at_idx
  ON public.email_send_log (email, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_ip_sent_at_idx
  ON public.email_send_log (ip, sent_at DESC);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (Server Actions) y accède.

/**
 * Retourne true si l'envoi est autorisé, false si quota atteint.
 *   - max 5 emails par adresse / 24h
 *   - max 20 emails par IP     / 1h
 */
CREATE OR REPLACE FUNCTION public.check_email_send_quota(
  p_email text,
  p_ip    text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_count integer;
  ip_count    integer;
BEGIN
  SELECT count(*) INTO email_count
  FROM public.email_send_log
  WHERE email = p_email
    AND sent_at > now() - interval '24 hours';

  IF email_count >= 5 THEN
    RETURN false;
  END IF;

  IF p_ip IS NOT NULL THEN
    SELECT count(*) INTO ip_count
    FROM public.email_send_log
    WHERE ip = p_ip
      AND sent_at > now() - interval '1 hour';

    IF ip_count >= 20 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_send_quota(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_send_quota(text, text) TO service_role;

-- Purge auto > 30 jours.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
      PERFORM cron.unschedule('purge-email-send-log')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-email-send-log');
      PERFORM cron.schedule(
        'purge-email-send-log',
        '5 3 * * *',
        $cron$DELETE FROM public.email_send_log WHERE sent_at < now() - interval '30 days';$cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron indisponible : purge email_send_log à scheduler manuellement.';
    END;
  END IF;
END;
$$;
