-- Migration : requalification explicite des anciens plans entreprise
-- (lot « Plan entreprise effectif et gestion administrative tracée », 1/2)
-- Décisions : docs/product/DECISIONS.md, ABO-07 (2026-11-20).
-- Tables affectées :
--   company_plan_requalifications (nouvelle, ajout seul).
-- Fonctions : company_plan_requalify, company_plan_transition_report,
--   protect_company_plan_requalifications, company_plan_maintenance,
--   log_company_plan_change (trigger AFTER UPDATE sur company_profiles).
--
-- Rôle de cette migration (additive, aucun droit modifié) :
--   les plans entreprise starter, pro et business disparaissent au profit de
--   Free et Premium (migration 2/2, 20261125130000). Aucun ancien plan n'est
--   converti implicitement, ni vers Free ni vers Premium. Chaque compte qui
--   porte encore une ancienne valeur doit recevoir AVANT la transition un
--   choix explicite : Free, ou Premium avec une date de fin, un auteur
--   (admin_ops ou admin_founder actif) et un motif. L'ancienne valeur et son
--   échéance sont recopiées dans la ligne de requalification au moment du
--   choix ; aucun historique d'abonnement n'est inventé.
--
--   Tant que la migration 2/2 n'est pas appliquée, cette migration ne change
--   aucun droit : le plan stocké, son échéance et les droits restent ceux
--   d'avant. Tout changement de plan ou d'échéance fait dans l'intervalle est
--   journalisé (audit_logs, « company_plan_changed_before_transition ») et
--   rend caduc un choix déjà enregistré pour ce compte.
--
-- Voies d'écriture (aucune autre) :
--   - session d'un admin_ops ou admin_founder actif (auth.uid() = auteur) ;
--   - maintenance directe de la base (session_user postgres ou
--     supabase_admin, jamais une requête PostgREST, clé service comprise) :
--     l'auteur désigné (p_decided_by) doit être un admin_ops ou
--     admin_founder actif. La voie est enregistrée (recorded_via).
--
-- Déploiement (lecture seule d'abord) :
--   select subscription_plan, subscription_expires_at is null as sans_fin,
--          subscription_expires_at > now() as en_cours, count(*)
--   from public.company_profiles group by 1, 2, 3;
--   Si une ancienne valeur existe : appliquer cette migration seule,
--   enregistrer un choix par compte (company_plan_requalify), vérifier
--   company_plan_transition_report(), puis appliquer la migration 2/2, qui
--   s'arrête sans effet si un compte reste à requalifier.
--
-- Rollback :
--   drop trigger if exists trg_log_company_plan_change on public.company_profiles;
--   drop function if exists public.log_company_plan_change();
--   drop function if exists public.company_plan_transition_report();
--   drop function if exists public.company_plan_requalify(uuid, uuid, text, timestamptz, text, uuid);
--   drop table if exists public.company_plan_requalifications;
--   drop function if exists public.protect_company_plan_requalifications();
--   drop function if exists public.company_plan_maintenance();

-- ════════════════════════════════════════════════════════════════════
-- 1. Voie de maintenance directe
-- ════════════════════════════════════════════════════════════════════
-- Connexion directe à la base (comme job_history_maintenance, 17d-1). Une
-- requête de l'application passe par PostgREST (authenticator) et n'en est
-- jamais une, même en clé service.
create or replace function public.company_plan_maintenance()
returns boolean
language sql
stable
set search_path = ''
as $$
  select session_user in ('postgres', 'supabase_admin');
$$;
-- service_role compris : les privilèges par défaut de Supabase lui accordent
-- EXECUTE sur toute nouvelle fonction ; aucune de ces fonctions ne lui sert.
revoke all on function public.company_plan_maintenance() from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. Choix explicites (ajout seul)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.company_plan_requalifications (
  id uuid primary key default gen_random_uuid(),
  -- Ordre d'enregistrement : le choix le plus récent fait foi. created_at
  -- (now()) est identique pour tous les choix d'une même transaction ; seul
  -- ce numéro croissant les départage sans ambiguïté.
  seq bigint generated always as identity unique,
  -- Clé d'idempotence : une relance rejoue la même décision.
  request_id uuid not null unique,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  -- Ancienne valeur et échéance, recopiées au moment du choix.
  legacy_plan text not null check (legacy_plan in ('starter', 'pro', 'business')),
  legacy_expires_at timestamptz,
  target_plan text not null check (target_plan in ('free', 'premium')),
  premium_until timestamptz,
  reason text not null check (char_length(reason) between 10 and 500),
  decided_by uuid not null references public.users(id),
  decided_by_role text not null,
  recorded_via text not null check (recorded_via in ('admin_session', 'database_maintenance')),
  created_at timestamptz not null default now(),
  check (
    (target_plan = 'premium' and premium_until is not null
     and premium_until < timestamptz '10000-01-01 00:00:00+00')
    or (target_plan = 'free' and premium_until is null)
  )
);

create index if not exists idx_company_plan_requalifications_company
  on public.company_plan_requalifications (company_id, seq desc);

alter table public.company_plan_requalifications enable row level security;
revoke all on table public.company_plan_requalifications from public, anon, authenticated, service_role;
-- Clé service : lecture et suppression seulement (nettoyage des preuves) ;
-- jamais d'insertion, qui permettrait un choix au nom d'un admin inventé.
grant select, delete on table public.company_plan_requalifications to service_role;

comment on table public.company_plan_requalifications is
  'Plans entreprise (ABO-07) : choix explicite Free ou Premium pour un compte qui porte encore starter, pro ou business, avec ancienne valeur, échéance, auteur et motif. Ajout seul ; appliqué par la transition 20261125130000, jamais par un calcul implicite.';

create or replace function public.protect_company_plan_requalifications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'company_plan_requalifications: history is append-only'
      using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated')
     or (tg_op = 'INSERT' and current_user = 'service_role') then
    raise exception 'company_plan_requalifications: server-side only'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_company_plan_requalifications() from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_company_plan_requalifications on public.company_plan_requalifications;
create trigger trg_protect_company_plan_requalifications
  before insert or update or delete on public.company_plan_requalifications
  for each row execute function public.protect_company_plan_requalifications();

-- ════════════════════════════════════════════════════════════════════
-- 3. Enregistrer un choix
-- ════════════════════════════════════════════════════════════════════
-- Ne modifie pas le plan : le choix est appliqué par la transition. Refus
-- (codes) : forbidden, decided_by_invalid, request_invalid, target_invalid,
-- reason_invalid, period_invalid, company_not_found, company_not_legacy,
-- request_conflict.
create or replace function public.company_plan_requalify(
  p_request_id uuid,
  p_company_id uuid,
  p_target text,
  p_premium_until timestamptz,
  p_reason text,
  p_decided_by uuid default null
)
returns table (requalification_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_via text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cp public.company_profiles;
  v_row public.company_plan_requalifications;
begin
  if v_uid is not null then
    if not public.is_ops_admin_user(v_uid) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if p_decided_by is not null and p_decided_by <> v_uid then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_author := v_uid;
    v_via := 'admin_session';
  elsif public.company_plan_maintenance() then
    if p_decided_by is null or not public.is_ops_admin_user(p_decided_by) then
      raise exception 'decided_by_invalid';
    end if;
    v_author := p_decided_by;
    v_via := 'database_maintenance';
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  if p_target is null or p_target not in ('free', 'premium') then
    raise exception 'target_invalid';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'reason_invalid';
  end if;
  if p_target = 'premium' then
    if p_premium_until is null or p_premium_until <= now()
       or p_premium_until >= timestamptz '10000-01-01 00:00:00+00' then
      raise exception 'period_invalid';
    end if;
  elsif p_premium_until is not null then
    raise exception 'period_invalid';
  end if;

  select cp.* into v_cp from public.company_profiles cp
  where cp.id = p_company_id for update;
  if not found then
    raise exception 'company_not_found';
  end if;

  -- Relance : résultat d'origine, sans nouvelle écriture.
  select r.* into v_row from public.company_plan_requalifications r
  where r.request_id = p_request_id;
  if found then
    if v_row.company_id is distinct from p_company_id
       or v_row.target_plan is distinct from p_target
       or v_row.premium_until is distinct from p_premium_until then
      raise exception 'request_conflict';
    end if;
    return query select v_row.id, true;
    return;
  end if;

  if v_cp.subscription_plan is null
     or v_cp.subscription_plan not in ('starter', 'pro', 'business') then
    raise exception 'company_not_legacy';
  end if;

  begin
    insert into public.company_plan_requalifications (
      request_id, company_id, legacy_plan, legacy_expires_at, target_plan,
      premium_until, reason, decided_by, decided_by_role, recorded_via
    ) values (
      p_request_id, p_company_id, v_cp.subscription_plan,
      v_cp.subscription_expires_at, p_target, p_premium_until, v_reason,
      v_author, (select u.role::text from public.users u where u.id = v_author),
      v_via
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception 'request_conflict';
  end;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_author, v_row.decided_by_role, 'company_plan_requalification_recorded',
          'company_plan_requalifications', v_row.id,
          jsonb_build_object('company_id', p_company_id,
                             'legacy_plan', v_row.legacy_plan,
                             'legacy_expires_at', v_row.legacy_expires_at,
                             'target_plan', p_target,
                             'premium_until', p_premium_until,
                             'recorded_via', v_via));

  return query select v_row.id, false;
end;
$$;

revoke all on function public.company_plan_requalify(uuid, uuid, text, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.company_plan_requalify(uuid, uuid, text, timestamptz, text, uuid)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Diagnostic de transition
-- ════════════════════════════════════════════════════════════════════
-- Un compte est prêt quand son choix le plus récent porte sur l'ancienne
-- valeur et l'échéance encore en base (un plan changé depuis le choix le
-- rend caduc). Lecture : admin actif (trois grades) ou maintenance directe.
create or replace function public.company_plan_transition_report()
returns table (
  company_id uuid,
  legacy_plan text,
  legacy_expires_at timestamptz,
  requalification_id uuid,
  target_plan text,
  premium_until timestamptz,
  ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_user(auth.uid()) or public.company_plan_maintenance()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select cp.id, cp.subscription_plan, cp.subscription_expires_at,
         r.id, r.target_plan, r.premium_until,
         (r.id is not null
          and r.legacy_plan = cp.subscription_plan
          and r.legacy_expires_at is not distinct from cp.subscription_expires_at)
  from public.company_profiles cp
  left join lateral (
    select q.* from public.company_plan_requalifications q
    where q.company_id = cp.id
    order by q.seq desc
    limit 1
  ) r on true
  where cp.subscription_plan in ('starter', 'pro', 'business')
  order by cp.id;
end;
$$;

revoke all on function public.company_plan_transition_report() from public, anon, service_role;
grant execute on function public.company_plan_transition_report() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Changements de plan entre les deux étapes (journalisés)
-- ════════════════════════════════════════════════════════════════════
-- Entre cette migration et la transition, l'ancien modèle reste en vigueur
-- (écriture du plan en clé service ou SQL direct, sans historique). Aucun de
-- ces changements n'est perdu : chacun laisse une trace dans audit_logs
-- (ancienne et nouvelle valeur, rôle de base). Un choix enregistré avant un
-- tel changement devient caduc (company_plan_transition_report : « non
-- prêt ») et doit être renouvelé. Retiré par la transition, qui ferme ces
-- écritures (trg_company_plan_write_guard).
create or replace function public.log_company_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.subscription_plan, new.subscription_expires_at)
     is distinct from (old.subscription_plan, old.subscription_expires_at) then
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    -- Rôle de la requête : SECURITY DEFINER fait de current_user le
    -- propriétaire ; PostgREST pose « role » (service_role, authenticated),
    -- une connexion directe laisse « none » (session_user).
    values (null,
            coalesce(nullif(current_setting('role', true), 'none'), session_user::text),
            'company_plan_changed_before_transition',
            'company_profiles', new.id,
            jsonb_build_object('previous_plan', old.subscription_plan,
                               'previous_expires_at', old.subscription_expires_at,
                               'plan', new.subscription_plan,
                               'expires_at', new.subscription_expires_at));
  end if;
  return null;
end;
$$;
revoke all on function public.log_company_plan_change() from public, anon, authenticated, service_role;

drop trigger if exists trg_log_company_plan_change on public.company_profiles;
create trigger trg_log_company_plan_change
  after update of subscription_plan, subscription_expires_at on public.company_profiles
  for each row execute function public.log_company_plan_change();
