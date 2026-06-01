-- Anti-abus SMS : log + quota par numéro et par IP.
-- Couche applicative au-dessus du rate-limit Supabase pour éviter
-- qu'un utilisateur (ou bot) spam "Renvoyer le code" et fasse exploser
-- la facture Twilio.

CREATE TABLE IF NOT EXISTS public.sms_send_log (
  id         bigserial PRIMARY KEY,
  phone      text        NOT NULL,
  ip         text,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS sms_send_log_phone_sent_at_idx
  ON public.sms_send_log (phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS sms_send_log_ip_sent_at_idx
  ON public.sms_send_log (ip, sent_at DESC);

ALTER TABLE public.sms_send_log ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (Server Actions) y accède.

/**
 * Retourne true si l'envoi est autorisé, false si quota atteint.
 *   - max 5 SMS par numéro / 24h
 *   - max 10 SMS par IP    / 1h
 */
CREATE OR REPLACE FUNCTION public.check_sms_send_quota(
  p_phone text,
  p_ip    text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  phone_count integer;
  ip_count    integer;
BEGIN
  SELECT count(*) INTO phone_count
  FROM public.sms_send_log
  WHERE phone = p_phone
    AND sent_at > now() - interval '24 hours';

  IF phone_count >= 5 THEN
    RETURN false;
  END IF;

  IF p_ip IS NOT NULL THEN
    SELECT count(*) INTO ip_count
    FROM public.sms_send_log
    WHERE ip = p_ip
      AND sent_at > now() - interval '1 hour';

    IF ip_count >= 10 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_sms_send_quota(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_sms_send_quota(text, text) TO service_role;

-- Purge automatique des logs > 30 jours (économise la place).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
      PERFORM cron.unschedule('purge-sms-send-log')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-sms-send-log');
      PERFORM cron.schedule(
        'purge-sms-send-log',
        '0 3 * * *',
        $cron$DELETE FROM public.sms_send_log WHERE sent_at < now() - interval '30 days';$cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron indisponible : purge sms_send_log à scheduler manuellement.';
    END;
  END IF;
END;
$$;
