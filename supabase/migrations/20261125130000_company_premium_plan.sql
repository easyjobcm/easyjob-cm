-- Migration : plan entreprise effectif Free/Premium et gestion
-- administrative tracée (lot « Plan entreprise effectif », 2/2)
-- Décisions : docs/product/DECISIONS.md, ABO-07, ABO-08, ABO-11
-- (2026-11-20).
-- Tables affectées :
--   company_profiles (contraintes du plan, colonne premium_started_at),
--   company_premium_grants (nouvelle, historique en ajout seul) ;
-- fonctions : company_effective_plan (reprise), company_plan_transition_apply,
--   admin_manage_company_premium, admin_company_premium, my_account_state
--   (reprise), update_job (reprise), protect_company_premium_grants.
--
-- 0. Garde de transition (avant toute écriture) :
--    si un compte porte encore starter, pro ou business sans choix explicite
--    à jour (company_plan_requalifications, migration 1/2), la migration
--    s'arrête AVANT toute modification, avec le nombre de comptes par
--    ancienne valeur et leurs identifiants. Aucun plan n'est choisi à la
--    place de l'équipe. Diagnostic : select * from
--    public.company_plan_transition_report();
--
-- 1. Reprise explicite (company_plan_transition_apply) : chaque choix
--    devient le plan stocké (free, ou premium avec sa date de fin), une
--    ligne d'historique « requalify » (ancienne valeur, ancienne échéance,
--    auteur, motif du choix), une trace d'audit et une notification. Aucun
--    historique d'abonnement antérieur n'est inventé.
--
-- 2. Règle du plan (ABO-07) : Premium ⇔ subscription_plan = 'premium' ET
--    subscription_expires_at > maintenant. À l'échéance exacte, Free, sans
--    écriture (minuterie client sur l'heure du serveur, lot 7d). Le rôle
--    company_premium n'entre pas dans le calcul (ABO-11). Aucune fonction
--    ne reçoit de date : le calcul porte sur l'état présent et ne prétend
--    pas retrouver le plan d'un instant passé (aucun historique fiable avant
--    ce lot). Le figement des conditions entreprise à la sélection relève
--    de 17d-2 et n'est pas livré ici.
--
-- 3. Attribution (ABO-07) : admin_manage_company_premium(request_id,
--    entreprise, opération, fin, fin attendue, motif) — activer, prolonger,
--    arrêter ; admin_ops et admin_founder actifs (is_ops_admin_user) ;
--    relance du même request_id → résultat d'origine ; fin attendue
--    différente de l'état verrouillé → premium_state_changed. Plan,
--    historique, audit et notification dans la même transaction. Borne de
--    la date de fin : celle du lot 17a (candidate_premium_max_end(),
--    10000-01-01 UTC exclu). Aucun prix ni durée commerciale.
--    admin_company_premium(entreprise) : lecture (trois grades actifs).
--
-- 4. Modification directe d'une offre active (ABO-08) : Premium effectif
--    seulement ; autres contrôles d'update_job inchangés (propriété, compte
--    et profil actifs, dossier vérifié, aucune place pourvue, calendrier
--    figé, nouvelle modération).
--
-- 5. Écritures du plan (trg_company_plan_write_guard) : plan, fin et début
--    de période ne s'écrivent que par admin_manage_company_premium et par la
--    reprise, pour tout auteur (clé service et SQL direct compris) ; création
--    d'un profil en Free seulement. La journalisation de l'intervalle (1/2)
--    est retirée.
--
-- Conservés sans effet sur les droits : subscription_tier, trial_ends_at,
-- table subscriptions (my_account_state ne la lit plus pour l'entreprise).
--
-- Rollback (seulement si aucune attribution Premium n'a été faite) :
--   drop trigger if exists trg_company_plan_write_guard on public.company_profiles;
--   drop function if exists public.guard_company_plan_writes();
--   recréer update_job depuis 20261113120000, my_account_state depuis
--   20261121120000 et company_effective_plan depuis 20261107150000 ;
--   drop function if exists public.admin_company_premium(uuid);
--   drop function if exists public.admin_manage_company_premium(uuid, uuid, text, timestamptz, timestamptz, text);
--   drop function if exists public.company_plan_transition_apply();
--   drop table if exists public.company_premium_grants;
--   drop function if exists public.protect_company_premium_grants();
--   alter table public.company_profiles drop constraint if exists company_profiles_plan_free_premium_chk;
--   alter table public.company_profiles drop constraint if exists company_profiles_premium_end_chk;
--   alter table public.company_profiles drop column if exists premium_started_at;
--   les lignes passées en premium ou free par la reprise ne retrouvent pas
--   leur ancienne valeur automatiquement (voir company_premium_grants).

-- ════════════════════════════════════════════════════════════════════
-- 0. Garde de transition (lecture seule)
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing integer;
  v_by_value text;
  v_ids text;
begin
  select count(*),
         string_agg(distinct x.subscription_plan, ', '),
         string_agg(x.id::text, ', ' order by x.id)
  into v_missing, v_by_value, v_ids
  from (
    select cp.id, cp.subscription_plan
    from public.company_profiles cp
    left join lateral (
      select q.legacy_plan, q.legacy_expires_at
      from public.company_plan_requalifications q
      where q.company_id = cp.id
      order by q.seq desc
      limit 1
    ) r on true
    where cp.subscription_plan in ('starter', 'pro', 'business')
      and (r.legacy_plan is null
           or r.legacy_plan <> cp.subscription_plan
           or r.legacy_expires_at is distinct from cp.subscription_expires_at)
  ) x;
  if v_missing > 0 then
    raise exception 'company_plan_transition_blocked'
      using detail = v_missing || ' compte(s) sans choix explicite à jour (anciennes valeurs : '
                     || v_by_value || ') : ' || v_ids,
            hint = 'Enregistrer un choix par compte (company_plan_requalify), vérifier company_plan_transition_report(), puis relancer.';
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 1. Colonnes et historique
-- ════════════════════════════════════════════════════════════════════
alter table public.company_profiles
  add column if not exists premium_started_at timestamptz;

comment on column public.company_profiles.premium_started_at is
  'Début de la période Premium en cours (ABO-07), écrit par admin_manage_company_premium ou par la reprise ; null si Free ou inconnu.';

create table if not exists public.company_premium_grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  operation text not null check (operation in ('activate', 'extend', 'stop', 'requalify')),
  -- Plan stocké après l'opération.
  resulting_plan text not null check (resulting_plan in ('free', 'premium')),
  period_started_at timestamptz,
  previous_ends_at timestamptz,
  -- Fin de la période (null : reprise vers Free).
  ends_at timestamptz,
  -- Reprise seulement : ancienne valeur et échéance, choix d'origine.
  legacy_plan text check (legacy_plan in ('starter', 'pro', 'business')),
  legacy_expires_at timestamptz,
  requalification_id uuid references public.company_plan_requalifications(id),
  reason text not null check (char_length(reason) between 10 and 500),
  source text not null check (source in ('admin_grant', 'requalification')),
  actor_id uuid not null references public.users(id),
  actor_role text not null,
  created_at timestamptz not null default now(),
  check (
    (operation = 'requalify' and source = 'requalification'
     and legacy_plan is not null and requalification_id is not null
     and ((resulting_plan = 'premium' and ends_at is not null)
          or (resulting_plan = 'free' and ends_at is null)))
    or (operation <> 'requalify' and source = 'admin_grant'
        and legacy_plan is null and requalification_id is null
        and ends_at is not null)
  )
);

create index if not exists idx_company_premium_grants_company
  on public.company_premium_grants (company_id, created_at desc);

alter table public.company_premium_grants enable row level security;
revoke all on table public.company_premium_grants from public, anon, authenticated, service_role;
-- Clé service : lecture et suppression seulement (nettoyage des preuves) ;
-- jamais d'insertion ni de modification de l'historique.
grant select, delete on table public.company_premium_grants to service_role;

comment on table public.company_premium_grants is
  'ABO-07 : historique du plan entreprise (attribution, prolongation, arrêt par l''équipe ; reprise explicite des anciens plans). Ajout seul ; jamais une preuve de paiement ; lu par admin_company_premium.';

create or replace function public.protect_company_premium_grants()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'company_premium_grants: history is append-only'
      using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated')
     or (tg_op = 'INSERT' and current_user = 'service_role') then
    raise exception 'company_premium_grants: server-side only'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
-- service_role compris : les privilèges par défaut de Supabase lui accordent
-- EXECUTE sur toute nouvelle fonction ; aucune de ces fonctions ne lui sert.
revoke all on function public.protect_company_premium_grants() from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_company_premium_grants on public.company_premium_grants;
create trigger trg_protect_company_premium_grants
  before insert or update or delete on public.company_premium_grants
  for each row execute function public.protect_company_premium_grants();


-- ════════════════════════════════════════════════════════════════════
-- 0 bis. Écritures du plan : parcours tracés seulement
-- ════════════════════════════════════════════════════════════════════
-- La journalisation de l'intervalle entre les deux étapes (migration 1/2)
-- s'arrête : désormais, plan, fin et début de période ne changent que par
-- admin_manage_company_premium ou company_plan_transition_apply, qui
-- écrivent dans la même transaction l'état, l'historique, l'audit et la
-- notification. Toute autre écriture est refusée, pour tout auteur (clé
-- service et SQL direct compris) : ces deux fonctions seules posent
-- l'indicateur de transaction easyjob.company_plan_write. Aucune voie
-- exposée ne permet de le poser (PostgREST n'exécute pas set_config).
-- Création d'un profil : Free sans fin ni début seulement.
drop trigger if exists trg_log_company_plan_change on public.company_profiles;
drop function if exists public.log_company_plan_change();

create or replace function public.guard_company_plan_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('easyjob.company_plan_write', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if coalesce(new.subscription_plan, 'free') <> 'free'
         or new.subscription_expires_at is not null
         or new.premium_started_at is not null then
        raise exception 'company_plan_untracked_write'
          using errcode = '42501',
                hint = 'Plan entreprise : admin_manage_company_premium (ABO-07).';
      end if;
    elsif (new.subscription_plan, new.subscription_expires_at, new.premium_started_at)
          is distinct from
          (old.subscription_plan, old.subscription_expires_at, old.premium_started_at) then
      raise exception 'company_plan_untracked_write'
        using errcode = '42501',
              hint = 'Plan entreprise : admin_manage_company_premium (ABO-07).';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_company_plan_writes() from public, anon, authenticated, service_role;

drop trigger if exists trg_company_plan_write_guard on public.company_profiles;
create trigger trg_company_plan_write_guard
  before insert or update on public.company_profiles
  for each row execute function public.guard_company_plan_writes();

-- ════════════════════════════════════════════════════════════════════
-- 2. Reprise explicite des anciens plans
-- ════════════════════════════════════════════════════════════════════
-- Même garde que l'étape 0, puis application de chaque choix. Réservée au
-- propriétaire (migration, maintenance directe) : aucune session.
create or replace function public.company_plan_transition_apply()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing integer;
  v_ids text;
  v_rec record;
  v_count integer := 0;
  v_locale text;
  v_until_txt text;
  v_title text;
  v_body text;
begin
  if not public.company_plan_maintenance() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Verrou de toutes les lignes anciennes, puis contrôle : aucune écriture
  -- tant qu'un compte reste sans choix à jour.
  perform 1 from public.company_profiles cp
  where cp.subscription_plan in ('starter', 'pro', 'business')
  for update;

  select count(*), string_agg(x.company_id::text, ', ' order by x.company_id)
  into v_missing, v_ids
  from public.company_plan_transition_report() x
  where not x.ready;
  if v_missing > 0 then
    raise exception 'company_plan_transition_blocked'
      using detail = v_missing || ' compte(s) sans choix explicite à jour : ' || v_ids;
  end if;

  perform set_config('easyjob.company_plan_write', 'on', true);
  for v_rec in
    select cp.id as company_id, cp.user_id, cp.subscription_plan as legacy_plan,
           cp.subscription_expires_at as legacy_expires_at,
           q.id as requalification_id, q.target_plan, q.premium_until,
           q.reason, q.decided_by, q.decided_by_role
    from public.company_profiles cp
    join lateral (
      select r.* from public.company_plan_requalifications r
      where r.company_id = cp.id
      order by r.seq desc
      limit 1
    ) q on true
    where cp.subscription_plan in ('starter', 'pro', 'business')
    order by cp.id
  loop
    update public.company_profiles cp
    set subscription_plan = v_rec.target_plan,
        subscription_expires_at = v_rec.premium_until,
        premium_started_at = case when v_rec.target_plan = 'premium' then now() end
    where cp.id = v_rec.company_id;

    insert into public.company_premium_grants (
      request_id, company_id, operation, resulting_plan, period_started_at,
      previous_ends_at, ends_at, legacy_plan, legacy_expires_at,
      requalification_id, reason, source, actor_id, actor_role
    ) values (
      v_rec.requalification_id, v_rec.company_id, 'requalify', v_rec.target_plan,
      case when v_rec.target_plan = 'premium' then now() end,
      v_rec.legacy_expires_at, v_rec.premium_until, v_rec.legacy_plan,
      v_rec.legacy_expires_at, v_rec.requalification_id, v_rec.reason,
      'requalification', v_rec.decided_by, v_rec.decided_by_role
    );

    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    values (v_rec.decided_by, v_rec.decided_by_role, 'company_plan_requalified',
            'company_profiles', v_rec.company_id,
            jsonb_build_object('requalification_id', v_rec.requalification_id,
                               'legacy_plan', v_rec.legacy_plan,
                               'legacy_expires_at', v_rec.legacy_expires_at,
                               'target_plan', v_rec.target_plan,
                               'premium_until', v_rec.premium_until));

    select u.locale::text into v_locale from public.users u where u.id = v_rec.user_id;
    if v_rec.target_plan = 'premium' then
      v_until_txt := to_char(v_rec.premium_until at time zone 'Africa/Douala',
                             case when v_locale = 'en' then 'YYYY-MM-DD HH24:MI'
                                  else 'DD/MM/YYYY HH24:MI' end);
    end if;
    if v_locale = 'en' then
      v_title := 'Your EasyJob plan';
      v_body := case when v_rec.target_plan = 'premium'
        then 'Your plan is now Premium until ' || v_until_txt || ' (Douala time), as set by the EasyJob team. No payment was made through the app.'
        else 'Your plan is now Free, as set by the EasyJob team.' end;
    else
      v_title := 'Votre plan EasyJob';
      v_body := case when v_rec.target_plan = 'premium'
        then 'Votre plan est désormais Premium jusqu''au ' || v_until_txt || ' (heure de Douala), selon le choix de l''équipe EasyJob. Aucun paiement n''a été effectué dans l''application.'
        else 'Votre plan est désormais Free, selon le choix de l''équipe EasyJob.' end;
    end if;
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (v_rec.user_id, 'system', v_title, v_body,
            jsonb_build_object('kind', 'company_premium', 'operation', 'requalify',
                               'requalification_id', v_rec.requalification_id));

    v_count := v_count + 1;
  end loop;
  perform set_config('easyjob.company_plan_write', 'off', true);

  return v_count;
end;
$$;
revoke all on function public.company_plan_transition_apply() from public, anon, authenticated, service_role;

alter table public.company_profiles
  drop constraint if exists company_profiles_subscription_plan_chk;

select public.company_plan_transition_apply();

-- Seuls Free et Premium (null : Free, comme avant) ; Premium exige une fin.
alter table public.company_profiles
  add constraint company_profiles_plan_free_premium_chk
  check (subscription_plan is null or subscription_plan in ('free', 'premium'));
alter table public.company_profiles
  add constraint company_profiles_premium_end_chk
  check (subscription_plan is distinct from 'premium' or subscription_expires_at is not null);

-- ════════════════════════════════════════════════════════════════════
-- 3. Plan effectif : calcul unique
-- ════════════════════════════════════════════════════════════════════
create or replace function public.company_effective_plan(p_plan text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_plan = 'premium' and p_expires_at is not null and p_expires_at > now()
    then 'premium'
    else 'free'
  end;
$$;

comment on function public.company_effective_plan(text, timestamptz) is
  'ABO-07 : plan entreprise effectif à l''instant présent (premium ⇔ plan premium et fin future ; Free à l''échéance exacte). Ne reçoit pas de date : ne reconstitue aucun plan passé.';

-- ════════════════════════════════════════════════════════════════════
-- 4. Activer, prolonger, arrêter (ops et fondateur actifs)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_manage_company_premium(
  p_request_id uuid,
  p_company_id uuid,
  p_operation text,
  p_ends_at timestamptz,
  p_expected_until timestamptz,
  p_reason text
)
returns table (
  grant_id uuid,
  operation text,
  plan text,
  premium_started_at timestamptz,
  premium_until timestamptz,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cp public.company_profiles;
  v_locale text;
  v_grant public.company_premium_grants;
  v_active boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_plan_after text;
  v_title text;
  v_body text;
  v_until_txt text;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid';
  end if;
  if p_operation is null or p_operation not in ('activate', 'extend', 'stop') then
    raise exception 'operation_invalid';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'reason_invalid';
  end if;

  select cp.* into v_cp from public.company_profiles cp
  where cp.id = p_company_id for update;
  if not found then
    raise exception 'company_not_found';
  end if;

  -- Relance : résultat d'origine, sans nouvelle écriture.
  select g.* into v_grant from public.company_premium_grants g
  where g.request_id = p_request_id;
  if found then
    if v_grant.company_id is distinct from p_company_id
       or v_grant.operation is distinct from p_operation
       or (p_operation <> 'stop' and v_grant.ends_at is distinct from p_ends_at) then
      raise exception 'request_conflict';
    end if;
    return query select v_grant.id, v_grant.operation,
      public.company_effective_plan(v_cp.subscription_plan, v_cp.subscription_expires_at),
      case when public.company_effective_plan(v_cp.subscription_plan, v_cp.subscription_expires_at) = 'premium'
           then v_cp.premium_started_at end,
      v_cp.subscription_expires_at, true;
    return;
  end if;

  -- L'agent décide sur l'état qu'il a lu.
  if v_cp.subscription_expires_at is distinct from p_expected_until then
    raise exception 'premium_state_changed';
  end if;

  v_active := public.company_effective_plan(v_cp.subscription_plan, v_cp.subscription_expires_at) = 'premium';

  -- Seule voie d'écriture du plan (avec la reprise) : l'indicateur ne vaut
  -- que pour cette transaction et est retiré juste après l'écriture.
  perform set_config('easyjob.company_plan_write', 'on', true);
  if p_operation = 'activate' then
    if v_active then
      raise exception 'premium_already_active';
    end if;
    if p_ends_at is null or p_ends_at <= now()
       or p_ends_at >= public.candidate_premium_max_end() then
      raise exception 'period_invalid';
    end if;
    v_start := now();
    v_end := p_ends_at;
    v_plan_after := 'premium';
    update public.company_profiles cp
    set subscription_plan = 'premium', subscription_expires_at = v_end,
        premium_started_at = v_start
    where cp.id = v_cp.id;
  elsif p_operation = 'extend' then
    if not v_active then
      raise exception 'premium_not_active';
    end if;
    if p_ends_at is null or p_ends_at <= v_cp.subscription_expires_at
       or p_ends_at >= public.candidate_premium_max_end() then
      raise exception 'period_invalid';
    end if;
    v_start := v_cp.premium_started_at;
    v_end := p_ends_at;
    v_plan_after := 'premium';
    update public.company_profiles cp set subscription_expires_at = v_end
    where cp.id = v_cp.id;
  else
    if not v_active then
      raise exception 'premium_not_active';
    end if;
    -- Fin à l'instant de l'arrêt : Free dès maintenant.
    v_start := v_cp.premium_started_at;
    v_end := now();
    v_plan_after := 'free';
    update public.company_profiles cp
    set subscription_plan = 'free', subscription_expires_at = v_end,
        premium_started_at = null
    where cp.id = v_cp.id;
  end if;
  perform set_config('easyjob.company_plan_write', 'off', true);

  begin
    insert into public.company_premium_grants (
      request_id, company_id, operation, resulting_plan, period_started_at,
      previous_ends_at, ends_at, reason, source, actor_id, actor_role
    ) values (
      p_request_id, p_company_id, p_operation, v_plan_after, v_start,
      v_cp.subscription_expires_at, v_end, v_reason, 'admin_grant', v_uid,
      (select u.role::text from public.users u where u.id = v_uid)
    )
    returning * into v_grant;
  exception when unique_violation then
    raise exception 'request_conflict';
  end;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_grant.actor_role, 'company_premium_' || p_operation,
          'company_premium_grants', v_grant.id,
          jsonb_build_object('company_id', p_company_id,
                             'previous_ends_at', v_cp.subscription_expires_at,
                             'ends_at', v_end,
                             'source', 'admin_grant'));

  select u.locale::text into v_locale from public.users u where u.id = v_cp.user_id;
  v_until_txt := to_char(v_end at time zone 'Africa/Douala',
                         case when v_locale = 'en'
                              then 'YYYY-MM-DD HH24:MI' else 'DD/MM/YYYY HH24:MI' end);
  if v_locale = 'en' then
    v_title := case p_operation when 'activate' then 'Premium granted'
                                when 'extend' then 'Premium extended'
                                else 'Premium stopped' end;
    v_body := case p_operation
      when 'stop' then 'Your company plan is now Free.'
      else 'The EasyJob team granted your company Premium until ' || v_until_txt || ' (Douala time). No payment was made through the app.'
    end;
  else
    v_title := case p_operation when 'activate' then 'Premium attribué'
                                when 'extend' then 'Premium prolongé'
                                else 'Premium arrêté' end;
    v_body := case p_operation
      when 'stop' then 'Le plan de votre entreprise est désormais Free.'
      else 'L''équipe EasyJob a attribué Premium à votre entreprise jusqu''au ' || v_until_txt || ' (heure de Douala). Aucun paiement n''a été effectué dans l''application.'
    end;
  end if;
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (v_cp.user_id, 'system', v_title, v_body,
          jsonb_build_object('kind', 'company_premium', 'operation', p_operation,
                             'grant_id', v_grant.id));

  return query select v_grant.id, p_operation, v_plan_after,
    case when p_operation = 'stop' then null::timestamptz else v_start end,
    v_end, false;
end;
$$;

revoke all on function public.admin_manage_company_premium(uuid, uuid, text, timestamptz, timestamptz, text)
  from public, anon, service_role;
grant execute on function public.admin_manage_company_premium(uuid, uuid, text, timestamptz, timestamptz, text)
  to authenticated;

-- Lecture admin (trois grades actifs) : état effectif et historique.
create or replace function public.admin_company_premium(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cp record;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select cp.id, cp.subscription_plan, cp.subscription_expires_at, cp.premium_started_at
  into v_cp
  from public.company_profiles cp where cp.id = p_company_id;
  if v_cp.id is null then
    raise exception 'company_not_found';
  end if;
  return jsonb_build_object(
    'server_now', now(),
    'plan', public.company_effective_plan(v_cp.subscription_plan, v_cp.subscription_expires_at),
    'premium_until', v_cp.subscription_expires_at,
    'premium_started_at', v_cp.premium_started_at,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'operation', g.operation,
               'resulting_plan', g.resulting_plan,
               'period_started_at', g.period_started_at,
               'previous_ends_at', g.previous_ends_at,
               'ends_at', g.ends_at,
               'legacy_plan', g.legacy_plan,
               'legacy_expires_at', g.legacy_expires_at,
               'reason', g.reason,
               'source', g.source,
               'actor_role', g.actor_role,
               'actor_email', a.email,
               'created_at', g.created_at)
             order by g.created_at desc, g.id)
      from public.company_premium_grants g
      left join public.users a on a.id = g.actor_id
      where g.company_id = p_company_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_company_premium(uuid) from public, anon, service_role;
grant execute on function public.admin_company_premium(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. État du compte : plan entreprise sans lecture de repli
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261121120000 ; seule la partie « company » change : plan
-- effectif, fin et début de période, sans la table subscriptions (aucun
-- renouvellement n'existe : renews = null).
create or replace function public.my_account_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_company record;
  v_candidate record;
  v_sub record;
  v_plan text;
  v_company_plan text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.id, u.role::text as role, coalesce(u.is_active, true) as is_active
  into v_user
  from public.users u where u.id = v_uid;
  if not found then
    return jsonb_build_object('user_id', v_uid, 'role', null, 'is_active', false,
                              'is_admin', false, 'server_now', now());
  end if;

  select cp.id, cp.subscription_plan, cp.subscription_expires_at,
         cp.premium_started_at, cp.trial_ends_at,
         cp.verification_status::text as verification_status,
         coalesce(cp.is_active, true) as is_active
  into v_company
  from public.company_profiles cp where cp.user_id = v_uid;

  select cp.id, cp.premium_until, cp.premium_started_at
  into v_candidate
  from public.candidate_profiles cp where cp.user_id = v_uid;

  select s.plan, s.status, s.auto_renew, s.expires_at
  into v_sub
  from public.subscriptions s
  where s.user_id = v_uid
  order by s.started_at desc
  limit 1;

  v_plan := public.candidate_effective_plan(v_uid, now());
  v_company_plan := public.company_effective_plan(
    v_company.subscription_plan, v_company.subscription_expires_at);

  return jsonb_build_object(
    'user_id', v_uid,
    'role', v_user.role,
    'is_active', v_user.is_active,
    'is_admin', v_user.role in ('admin_support', 'admin_ops', 'admin_founder'),
    'server_now', now(),
    'company', case when v_company.id is null then null else jsonb_build_object(
      'plan', coalesce(v_company.subscription_plan, 'free'),
      'effective_plan', v_company_plan,
      'expires_at', v_company.subscription_expires_at,
      'premium_started_at', case when v_company_plan = 'premium'
                                 then v_company.premium_started_at end,
      'trial_ends_at', v_company.trial_ends_at,
      'verification_status', v_company.verification_status,
      'is_active', v_company.is_active,
      'renews', null
    ) end,
    'candidate', case when v_candidate.id is null then null else jsonb_build_object(
      'plan', v_plan,
      'premium', v_plan = 'premium',
      'premium_until', v_candidate.premium_until,
      'premium_started_at', case when v_plan = 'premium'
                                 then v_candidate.premium_started_at end,
      'renews', case when v_sub.plan is null then null
                     else (v_sub.auto_renew and v_sub.status = 'active') end
    ) end
  );
end;
$$;

revoke all on function public.my_account_state() from public, anon;
grant execute on function public.my_account_state() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Modification directe d'une offre active : Premium (ABO-08)
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261113120000 ; seule la condition de plan change.
create or replace function public.update_job(p_job_id uuid, p_job jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company record;
  v_current public.jobs;
  v_job public.jobs;
  v_published boolean;
  v_format text;
  v_payload jsonb;
  v_dates date[];
  v_sts time[];
  v_ets time[];
  v_starts timestamptz[];
  v_pays integer[];
  v_pos integer[];
  v_bad date[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_user_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select cp.id, cp.verification_status, cp.is_active,
         public.company_effective_plan(cp.subscription_plan, cp.subscription_expires_at) as plan
  into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if not public.company_verification_complete(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  select * into v_current from public.jobs j
  where j.id = p_job_id and j.company_id = v_company.id
  for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  if v_current.status = 'active' then
    -- ABO-08 : Premium effectif seulement (rôle sans effet, ABO-11).
    if v_company.plan <> 'premium' then
      raise exception 'job_locked_plan';
    end if;
    if coalesce(v_current.positions_filled, 0) > 0 then
      raise exception 'job_has_selected_candidates';
    end if;
  elsif v_current.status is null
     or v_current.status not in ('draft', 'pending_review', 'rejected') then
    raise exception 'job_not_editable';
  end if;

  if p_job is null or jsonb_typeof(p_job) <> 'object' then
    raise exception 'invalid_job_data' using detail = 'payload';
  end if;
  if p_job ?| array['first_published_at', 'publication_regime',
                    'applications_close_at', 'published_at'] then
    raise exception 'invalid_job_data' using detail = 'publication';
  end if;

  v_published := v_current.first_published_at is not null or v_current.legacy_publication;
  v_format := coalesce(nullif(p_job ->> 'schedule_format', ''), v_current.schedule_format);
  if v_format not in ('full_period', 'per_day') then
    raise exception 'invalid_job_data' using detail = 'schedule_format';
  end if;
  if v_published and v_format <> v_current.schedule_format then
    raise exception 'job_schedule_locked' using errcode = '42501';
  end if;
  v_payload := p_job - 'days' - 'schedule_format';

  if p_job ? 'days' then
    select array_agg(p.day_date order by p.starts_at), array_agg(p.start_time order by p.starts_at),
           array_agg(p.end_time order by p.starts_at), array_agg(p.starts_at order by p.starts_at),
           array_agg(p.mission_pay_per_candidate order by p.starts_at),
           array_agg(p.positions_available order by p.starts_at)
    into v_dates, v_sts, v_ets, v_starts, v_pays, v_pos
    from public.job_days_parse(v_format, p_job -> 'days') p;
    if v_format = 'per_day' then
      v_payload := v_payload || jsonb_build_object(
        'mission_pay_per_candidate', (select min(x) from unnest(v_pays) x),
        'positions_available', (select sum(x) from unnest(v_pos) x));
    end if;
  elsif v_format = 'per_day' and not v_published then
    raise exception 'invalid_job_data' using detail = 'days';
  end if;

  if v_published then
    if p_job ? 'days' then
      -- Lot 12 : même calendrier exigé (ajout, suppression, date ou horaire
      -- changés → refus) ; montants et places par journée suivent les
      -- règles de correction existantes (vérifiées ci-dessus).
      if (select array_agg(row(u.d, u.st, u.et)::text order by u.d)
          from unnest(v_dates, v_sts, v_ets) u(d, st, et))
         is distinct from
         (select array_agg(row(e.day_date, e.start_time, e.end_time)::text order by e.day_date)
          from public.job_effective_days(v_current.id) e) then
        raise exception 'job_schedule_locked' using errcode = '42501';
      end if;
    else
      if v_format = 'per_day' and (p_job ? 'mission_pay_per_candidate'
                                   or p_job ? 'positions_available') then
        raise exception 'invalid_job_data' using detail = 'days';
      end if;
      begin
        if (p_job ? 'start_date'
            and (p_job ->> 'start_date')::date is distinct from v_current.start_date)
           or (p_job ? 'start_time'
            and (p_job ->> 'start_time')::time is distinct from v_current.start_time)
           or (p_job ? 'end_time'
            and (p_job ->> 'end_time')::time is distinct from v_current.end_time)
           or (p_job ? 'end_date'
            and coalesce((p_job ->> 'end_date')::date,
                         coalesce((p_job ->> 'start_date')::date, v_current.start_date))
                is distinct from coalesce(v_current.end_date, v_current.start_date)) then
          raise exception 'job_schedule_locked' using errcode = '42501';
        end if;
      exception
        when invalid_text_representation or invalid_datetime_format
          or datetime_field_overflow then
          raise exception 'invalid_job_data' using detail = 'schedule';
      end;
      if v_format = 'per_day' then
        v_payload := v_payload || jsonb_build_object(
          'mission_pay_per_candidate', v_current.mission_pay_per_candidate,
          'positions_available', v_current.positions_available);
      end if;
    end if;
    v_job := public.job_apply_content(v_current,
      v_payload || jsonb_build_object(
        'start_date', greatest(v_current.start_date, (now() at time zone 'Africa/Douala')::date),
        'end_date', null,
        'start_time', v_current.start_time,
        'end_time', v_current.end_time));
    v_job.start_date := v_current.start_date;
    v_job.end_date := v_current.end_date;
    v_job.start_time := v_current.start_time;
    v_job.end_time := v_current.end_time;
  else
    if p_job ? 'days' then
      v_payload := v_payload || jsonb_build_object(
        'start_date', v_dates[1],
        'end_date', v_dates[cardinality(v_dates)],
        'start_time', v_sts[1],
        'end_time', v_ets[1]);
    end if;
    v_job := public.job_apply_content(v_current, v_payload);
    if not (p_job ? 'days') then
      if v_job.end_date is not null and v_job.end_date <> v_job.start_date then
        raise exception 'invalid_job_data' using detail = 'end_date';
      end if;
      if v_job.start_time = v_job.end_time then
        raise exception 'invalid_job_data' using detail = 'days_time';
      end if;
      v_dates := array[v_job.start_date];
      v_sts := array[v_job.start_time];
      v_ets := array[v_job.end_time];
      v_starts := array[(select b.starts_at from public.mission_schedule_bounds(
        v_job.start_date, v_job.start_time, v_job.end_time) b)];
      v_pays := array[null::integer];
      v_pos := array[null::integer];
    end if;
    v_bad := public.job_days_unpublishable(v_format, v_dates, v_starts, now());
    if cardinality(v_bad) > 0 then
      raise exception 'job_start_too_close'
        using detail = jsonb_build_object('days', to_jsonb(v_bad))::text;
    end if;
  end if;

  update public.jobs j set
    schedule_format = v_format,
    title = v_job.title,
    description = v_job.description,
    category_id = v_job.category_id,
    job_type = v_job.job_type,
    address = v_job.address,
    city = v_job.city,
    quartier = v_job.quartier,
    latitude = v_job.latitude,
    longitude = v_job.longitude,
    start_date = v_job.start_date,
    end_date = v_job.end_date,
    start_time = v_job.start_time,
    end_time = v_job.end_time,
    is_recurring = v_job.is_recurring,
    recurring_days = v_job.recurring_days,
    mission_pay_per_candidate = v_job.mission_pay_per_candidate,
    estimated_hours = v_job.estimated_hours,
    required_skills = v_job.required_skills,
    min_experience_months = v_job.min_experience_months,
    dress_code = v_job.dress_code,
    special_instructions = v_job.special_instructions,
    positions_available = v_job.positions_available,
    urgency = v_job.urgency,
    status = 'pending_review',
    rejection_reason = null,
    moderation_notes = null,
    moderated_at = null,
    moderation_by = null,
    published_at = null
  where j.id = p_job_id
  returning * into v_job;

  if not v_published then
    -- Jamais publiée : aucune candidature possible, le calendrier est remplacé.
    delete from public.job_days d where d.job_id = p_job_id;
    insert into public.job_days (
      job_id, day_date, start_time, end_time, starts_at, ends_at,
      mission_pay_per_candidate, positions_available
    )
    select p_job_id, u.d, u.st, u.et, now(), now() + interval '1 second', u.pay, u.pos
    from unnest(v_dates, v_sts, v_ets, v_pays, v_pos) u(d, st, et, pay, pos);
  elsif v_format = 'per_day' and p_job ? 'days' then
    update public.job_days d
    set mission_pay_per_candidate = u.pay, positions_available = u.pos
    from unnest(v_dates, v_pays, v_pos) u(dt, pay, pos)
    where d.job_id = p_job_id and d.day_date = u.dt;
    if exists (select 1 from public.job_days d
               where d.job_id = p_job_id and d.positions_available < d.positions_filled) then
      raise exception 'invalid_job_data' using detail = 'days_positions';
    end if;
  end if;

  return v_job;
end;
$$;

revoke all on function public.update_job(uuid, jsonb) from public, anon;
grant execute on function public.update_job(uuid, jsonb) to authenticated;
