-- Migration : quota de l'assistant EasyBot (lot 8, audit F-15)
-- Date : 2026-11-08
-- Tables affectées : chat_request_log (nouvelle)
-- Fonctions : consume_chat_quota (nouvelle)
--
-- Chaque appel au fournisseur LLM est précédé d'une réservation atomique
-- par consume_chat_quota, appelée uniquement par la route /api/chat avec la
-- clé service. Les seuils sont passés par l'application (source unique :
-- lib/chat/config.ts) ; la fonction refuse des seuils non positifs.
--
-- Concurrence : un verrou consultatif transactionnel par utilisateur, puis
-- par IP, sérialise les réservations concurrentes. En READ COMMITTED, le
-- comptage qui suit l'obtention du verrou voit les réservations validées
-- par les transactions précédentes : N requêtes simultanées à la limite ne
-- peuvent pas toutes passer, quel que soit le nombre d'instances serveur
-- (le verrou est en base). Ordre fixe (utilisateur, puis IP) : pas d'interblocage.
--
-- Données : identifiant du compte, IP observée par l'infrastructure (NULL
-- hors Vercel) et horodatage. Aucun contenu de conversation. Purge à 2 jours
-- par pg_cron quand il est disponible.
--
-- Rollback :
--   select cron.unschedule('purge-chat-request-log')
--     where exists (select 1 from cron.job where jobname = 'purge-chat-request-log');
--   drop function if exists public.consume_chat_quota(uuid, integer, integer, integer, text);
--   drop table if exists public.chat_request_log;

create table if not exists public.chat_request_log (
  id           bigserial primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  ip           text,
  requested_at timestamptz not null default now()
);

create index if not exists chat_request_log_user_requested_at_idx
  on public.chat_request_log (user_id, requested_at desc);
create index if not exists chat_request_log_ip_requested_at_idx
  on public.chat_request_log (ip, requested_at desc)
  where ip is not null;

alter table public.chat_request_log enable row level security;
-- Aucune politique : seul service_role (route /api/chat) y accède.
revoke all on public.chat_request_log from public, anon, authenticated;

create or replace function public.consume_chat_quota(
  p_user_id       uuid,
  p_user_per_hour integer,
  p_user_per_day  integer,
  p_ip_per_hour   integer,
  p_ip            text default null
) returns table (allowed boolean, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  integer;
  v_oldest timestamptz;
begin
  if p_user_id is null
     or coalesce(p_user_per_hour, 0) <= 0
     or coalesce(p_user_per_day, 0) <= 0
     or coalesce(p_ip_per_hour, 0) <= 0 then
    raise exception 'invalid_chat_quota' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('easyjob.chat.user:' || p_user_id::text, 0)
  );
  if p_ip is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('easyjob.chat.ip:' || p_ip, 0)
    );
  end if;

  select count(*), min(requested_at) into v_count, v_oldest
  from public.chat_request_log
  where user_id = p_user_id and requested_at > now() - interval '1 hour';
  if v_count >= p_user_per_hour then
    return query select false, 'user_hourly'::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))::integer);
    return;
  end if;

  select count(*), min(requested_at) into v_count, v_oldest
  from public.chat_request_log
  where user_id = p_user_id and requested_at > now() - interval '24 hours';
  if v_count >= p_user_per_day then
    return query select false, 'user_daily'::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - now())))::integer);
    return;
  end if;

  if p_ip is not null then
    select count(*), min(requested_at) into v_count, v_oldest
    from public.chat_request_log
    where ip = p_ip and requested_at > now() - interval '1 hour';
    if v_count >= p_ip_per_hour then
      return query select false, 'ip_hourly'::text,
        greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))::integer);
      return;
    end if;
  end if;

  insert into public.chat_request_log (user_id, ip) values (p_user_id, p_ip);
  return query select true, null::text, 0;
end;
$$;

revoke all on function public.consume_chat_quota(uuid, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.consume_chat_quota(uuid, integer, integer, integer, text)
  to service_role;

-- Purge automatique (même procédé que sms_send_log).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema extensions;
      perform cron.unschedule('purge-chat-request-log')
      where exists (select 1 from cron.job where jobname = 'purge-chat-request-log');
      perform cron.schedule(
        'purge-chat-request-log',
        '15 3 * * *',
        $cron$delete from public.chat_request_log where requested_at < now() - interval '2 days';$cron$
      );
    exception when others then
      raise notice 'pg_cron indisponible : purge chat_request_log à planifier manuellement.';
    end;
  end if;
end;
$$;
