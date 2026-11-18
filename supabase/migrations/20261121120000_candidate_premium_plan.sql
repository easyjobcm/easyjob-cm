-- Migration : plan candidat effectif, attribution administrative de Premium
-- et conditions d'engagement figées à la sélection (lot 17a)
-- Date : 2026-11-21
-- Tables affectées :
--   candidate_profiles (colonne premium_started_at),
--   candidate_premium_grants (nouvelle, historique en ajout seul),
--   mission_day_commitment_terms (nouvelle, conditions par journée),
--   mission_days (trigger AFTER INSERT) ;
-- fonctions : candidate_effective_plan, my_account_state (reprise),
--   admin_manage_candidate_premium, admin_candidate_premium,
--   record_mission_day_commitment_terms, protect_candidate_premium_grants,
--   protect_mission_day_commitment_terms.
--
-- Règle du plan (inchangée depuis le lot 7d, désormais en un seul endroit) :
--   Premium à l'instant t ⇔ users.role = 'candidate_premium'
--                           ET candidate_profiles.premium_until > t.
--   À l'échéance exacte (premium_until = t), le plan est Free. Aucune
--   écriture à l'échéance : le calcul suffit (my_account_state, minuterie
--   client sur l'heure du serveur, conditions de sélection).
--
-- Attribution administrative (aucun paiement) :
--   admin_manage_candidate_premium(request_id, candidat, opération, fin,
--   fin attendue, motif) : activer, prolonger, arrêter. Grade
--   is_ops_admin_user (admin_ops, admin_founder, compte actif), auteur
--   = auth.uid(). Verrous users puis candidate_profiles ; relance du même
--   request_id → résultat d'origine, sans nouvel audit ni notification ;
--   fin attendue différente de l'état verrouillé → premium_state_changed
--   (deux agents concurrents ne s'écrasent pas). Écriture du plan, ligne
--   d'historique (source « admin_grant »), audit et notification dans la
--   même transaction. Aucune ligne n'est écrite dans subscriptions ni
--   payments : ce n'est pas une preuve de paiement.
--   admin_candidate_premium(candidat) : lecture (is_admin_user : les trois
--   grades actifs).
--
-- Conditions d'engagement (décision du 2026-11-17, appliquées au lot 17b) :
--   à chaque journée créée par une sélection réussie (« Signer et
--   sélectionner »), le trigger enregistre le plan effectif à l'instant de
--   la sélection (job_applications.selected_at = now() de la transaction),
--   le délai d'annulation sans sanction correspondant (Free 48 h, Premium
--   24 h) et cet instant. Période complète : mêmes conditions pour chaque
--   journée de l'engagement. Journées au choix : une sélection par journée,
--   donc des conditions propres. Lignes immuables pour tout auteur, fermées
--   aux sessions (aucune lecture : le plan n'est jamais montré à
--   l'entreprise), sans signal Realtime.
--
-- Engagements antérieurs (décision du 2026-11-18) : l'historique ne permet
-- pas de retrouver le plan à la sélection (premium_until est écrasé à
-- chaque changement et aucune trace d'attribution n'existait). Chaque
-- journée déjà sélectionnée reçoit une ligne « legacy » : plan et délai
-- inconnus (null), instant de sélection repris s'il existe. Aucune sanction
-- automatique d'annulation tardive ne pourra s'appuyer sur un plan ou un
-- délai supposé (règle appliquée au lot 17b) ; les autres faits restent
-- examinés par le support selon leurs règles. À compter avant déploiement
-- (lecture seule) : journées sélectionnées qui seront marquées « legacy » :
--   select count(*) from public.mission_days d
--   join public.missions m on m.id = d.mission_id
--   join public.job_applications a on a.id = m.application_id
--   where a.status = 'selected';
--
-- Date de fin de Premium : explicite, future et antérieure au
-- 10000-01-01 UTC (limite technique : années à quatre chiffres attendues
-- par l'ISO 8601 de l'API, Zod et les champs datetime-local ; refuse aussi
-- « infinity »). Aucune durée commerciale n'est imposée.
--
-- Rollback :
--   drop trigger if exists trg_record_mission_day_commitment_terms on public.mission_days;
--   drop table if exists public.mission_day_commitment_terms;
--   drop table if exists public.candidate_premium_grants;
--   drop function if exists public.admin_manage_candidate_premium(uuid, uuid, text, timestamptz, timestamptz, text);
--   drop function if exists public.admin_candidate_premium(uuid);
--   drop function if exists public.record_mission_day_commitment_terms();
--   drop function if exists public.mark_legacy_commitment_terms();
--   drop function if exists public.candidate_premium_max_end();
--   drop function if exists public.protect_candidate_premium_grants();
--   drop function if exists public.protect_mission_day_commitment_terms();
--   recréer my_account_state depuis 20261107150000 ;
--   drop function if exists public.candidate_effective_plan(uuid, timestamptz);
--   alter table public.candidate_profiles drop column if exists premium_started_at;

-- ════════════════════════════════════════════════════════════════════
-- 1. Début de la période Premium en cours
-- ════════════════════════════════════════════════════════════════════
-- Hors des privilèges de colonnes accordés aux sessions (lot 2) : écrite
-- seulement par la RPC d'attribution. Inconnue (null) pour une activation
-- antérieure, faite en SQL.
alter table public.candidate_profiles
  add column if not exists premium_started_at timestamptz;

comment on column public.candidate_profiles.premium_started_at is
  'Début de la période Premium en cours (lot 17a), écrit par admin_manage_candidate_premium ; null si inconnu.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Plan effectif : source unique
-- ════════════════════════════════════════════════════════════════════
create or replace function public.candidate_effective_plan(p_user_id uuid, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
             when u.role = 'candidate_premium'
                  and cp.premium_until is not null
                  and cp.premium_until > p_at
             then 'premium'
             else 'free'
           end
    from public.users u
    left join public.candidate_profiles cp on cp.user_id = u.id
    where u.id = p_user_id
  ), 'free');
$$;

-- Interne : le plan d'un candidat n'est lisible par personne d'autre
-- (entreprises comprises). Les lectures passent par my_account_state
-- (compte courant) et admin_candidate_premium (grade admin).
revoke all on function public.candidate_effective_plan(uuid, timestamptz)
  from public, anon, authenticated;

-- my_account_state : reprise de 20261107150000 ; seule la partie
-- « candidate » change (plan calculé par candidate_effective_plan, début
-- de période).
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
         cp.trial_ends_at, cp.verification_status::text as verification_status,
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

  return jsonb_build_object(
    'user_id', v_uid,
    'role', v_user.role,
    'is_active', v_user.is_active,
    'is_admin', v_user.role in ('admin_support', 'admin_ops', 'admin_founder'),
    'server_now', now(),
    'company', case when v_company.id is null then null else jsonb_build_object(
      'plan', lower(coalesce(v_company.subscription_plan, 'free')),
      'effective_plan', public.company_effective_plan(
        v_company.subscription_plan, v_company.subscription_expires_at),
      'expires_at', v_company.subscription_expires_at,
      'trial_ends_at', v_company.trial_ends_at,
      'verification_status', v_company.verification_status,
      'is_active', v_company.is_active,
      'renews', case when v_sub.plan is null then null
                     else (v_sub.auto_renew and v_sub.status = 'active') end
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
-- 3. Historique des attributions (ajout seul)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.candidate_premium_grants (
  id uuid primary key default gen_random_uuid(),
  -- Clé d'idempotence fournie par l'écran (une par envoi de formulaire).
  request_id uuid not null unique,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  operation text not null check (operation in ('activate', 'extend', 'stop')),
  -- Début de la période concernée (null : activation antérieure inconnue).
  period_started_at timestamptz,
  previous_ends_at timestamptz,
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 10 and 500),
  -- Attribution administrative : jamais un paiement.
  source text not null default 'admin_grant' check (source = 'admin_grant'),
  actor_id uuid not null references public.users(id),
  actor_role text not null,
  created_at timestamptz not null default now(),
  check (period_started_at is null or ends_at >= period_started_at)
);

create index if not exists idx_candidate_premium_grants_candidate
  on public.candidate_premium_grants (candidate_user_id, created_at desc);

alter table public.candidate_premium_grants enable row level security;
revoke all on table public.candidate_premium_grants from public, anon, authenticated;

create or replace function public.protect_candidate_premium_grants()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'candidate_premium_grants: history is append-only'
      using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'candidate_premium_grants: server-side only'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_candidate_premium_grants() from public, anon, authenticated;

drop trigger if exists trg_protect_candidate_premium_grants on public.candidate_premium_grants;
create trigger trg_protect_candidate_premium_grants
  before insert or update or delete on public.candidate_premium_grants
  for each row execute function public.protect_candidate_premium_grants();

-- ════════════════════════════════════════════════════════════════════
-- 4. Activer, prolonger, arrêter (ops et fondateur actifs)
-- ════════════════════════════════════════════════════════════════════
-- Borne technique d'une date de fin (exclue) : voir l'en-tête.
create or replace function public.candidate_premium_max_end()
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select timestamptz '10000-01-01 00:00:00+00' $$;
revoke all on function public.candidate_premium_max_end() from public, anon, authenticated;

create or replace function public.admin_manage_candidate_premium(
  p_request_id uuid,
  p_user_id uuid,
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
  v_user public.users;
  v_cp public.candidate_profiles;
  v_grant public.candidate_premium_grants;
  v_active boolean;
  v_start timestamptz;
  v_end timestamptz;
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

  -- Verrous : compte, puis profil (même ordre pour toutes les opérations).
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found or v_user.role::text not in ('candidate', 'candidate_premium') then
    raise exception 'candidate_not_found';
  end if;
  select cp.* into v_cp from public.candidate_profiles cp
  where cp.user_id = p_user_id for update;
  if not found then
    raise exception 'candidate_not_found';
  end if;

  -- Relance : résultat d'origine, sans nouvelle écriture.
  select g.* into v_grant from public.candidate_premium_grants g
  where g.request_id = p_request_id;
  if found then
    if v_grant.candidate_user_id is distinct from p_user_id
       or v_grant.operation is distinct from p_operation
       or (p_operation <> 'stop' and v_grant.ends_at is distinct from p_ends_at) then
      raise exception 'request_conflict';
    end if;
    return query select v_grant.id, v_grant.operation,
      public.candidate_effective_plan(p_user_id, now()),
      case when public.candidate_effective_plan(p_user_id, now()) = 'premium'
           then v_cp.premium_started_at end,
      v_cp.premium_until, true;
    return;
  end if;

  -- L'agent décide sur l'état qu'il a lu.
  if v_cp.premium_until is distinct from p_expected_until then
    raise exception 'premium_state_changed';
  end if;

  v_active := public.candidate_effective_plan(p_user_id, now()) = 'premium';

  if p_operation = 'activate' then
    if v_active then
      raise exception 'premium_already_active';
    end if;
    if p_ends_at is null or p_ends_at <= now() then
      raise exception 'period_invalid';
    end if;
    if p_ends_at >= public.candidate_premium_max_end() then
      raise exception 'period_invalid';
    end if;
    v_start := now();
    v_end := p_ends_at;
    update public.users u set role = 'candidate_premium' where u.id = p_user_id;
    update public.candidate_profiles cp
    set premium_started_at = v_start, premium_until = v_end
    where cp.id = v_cp.id;
  elsif p_operation = 'extend' then
    if not v_active then
      raise exception 'premium_not_active';
    end if;
    if p_ends_at is null or p_ends_at <= v_cp.premium_until then
      raise exception 'period_invalid';
    end if;
    if p_ends_at >= public.candidate_premium_max_end() then
      raise exception 'period_invalid';
    end if;
    v_start := v_cp.premium_started_at;
    v_end := p_ends_at;
    update public.candidate_profiles cp set premium_until = v_end
    where cp.id = v_cp.id;
  else
    if not v_active then
      raise exception 'premium_not_active';
    end if;
    -- Fin à l'instant de l'arrêt : Free dès maintenant (limite exclue).
    v_start := v_cp.premium_started_at;
    v_end := now();
    update public.users u set role = 'candidate' where u.id = p_user_id;
    update public.candidate_profiles cp
    set premium_until = v_end, premium_started_at = null
    where cp.id = v_cp.id;
  end if;

  begin
    insert into public.candidate_premium_grants (
      request_id, candidate_user_id, operation, period_started_at,
      previous_ends_at, ends_at, reason, actor_id, actor_role
    ) values (
      p_request_id, p_user_id, p_operation, v_start,
      v_cp.premium_until, v_end, v_reason, v_uid,
      (select u.role::text from public.users u where u.id = v_uid)
    )
    returning * into v_grant;
  exception when unique_violation then
    -- Même clé utilisée au même moment pour un autre candidat.
    raise exception 'request_conflict';
  end;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_grant.actor_role, 'candidate_premium_' || p_operation,
          'candidate_premium_grants', v_grant.id,
          jsonb_build_object('candidate_user_id', p_user_id,
                             'previous_ends_at', v_cp.premium_until,
                             'ends_at', v_end,
                             'source', 'admin_grant'));

  v_until_txt := to_char(v_end at time zone 'Africa/Douala',
                         case when v_user.locale::text = 'en'
                              then 'YYYY-MM-DD HH24:MI' else 'DD/MM/YYYY HH24:MI' end);
  if v_user.locale::text = 'en' then
    v_title := case p_operation when 'activate' then 'Premium granted'
                                when 'extend' then 'Premium extended'
                                else 'Premium stopped' end;
    v_body := case p_operation
      when 'stop' then 'Your plan is now Free.'
      else 'The EasyJob team granted you Premium until ' || v_until_txt || ' (Douala time). No payment was made through the app.'
    end;
  else
    v_title := case p_operation when 'activate' then 'Premium attribué'
                                when 'extend' then 'Premium prolongé'
                                else 'Premium arrêté' end;
    v_body := case p_operation
      when 'stop' then 'Votre plan est désormais Free.'
      else 'L''équipe EasyJob vous a attribué Premium jusqu''au ' || v_until_txt || ' (heure de Douala). Aucun paiement n''a été effectué dans l''application.'
    end;
  end if;
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (p_user_id, 'system', v_title, v_body,
          jsonb_build_object('kind', 'candidate_premium', 'operation', p_operation,
                             'grant_id', v_grant.id));

  return query select v_grant.id, p_operation,
    public.candidate_effective_plan(p_user_id, now()),
    case when p_operation = 'stop' then null::timestamptz else v_start end,
    v_end, false;
end;
$$;

revoke all on function public.admin_manage_candidate_premium(uuid, uuid, text, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.admin_manage_candidate_premium(uuid, uuid, text, timestamptz, timestamptz, text)
  to authenticated;

-- Lecture admin (trois grades actifs) : état effectif et historique.
create or replace function public.admin_candidate_premium(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_cp record;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = p_user_id;
  select cp.id, cp.premium_until, cp.premium_started_at into v_cp
  from public.candidate_profiles cp where cp.user_id = p_user_id;
  if v_role is null or v_role not in ('candidate', 'candidate_premium') or v_cp.id is null then
    raise exception 'candidate_not_found';
  end if;
  return jsonb_build_object(
    'server_now', now(),
    'plan', public.candidate_effective_plan(p_user_id, now()),
    'premium_until', v_cp.premium_until,
    'premium_started_at', v_cp.premium_started_at,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'operation', g.operation,
               'period_started_at', g.period_started_at,
               'previous_ends_at', g.previous_ends_at,
               'ends_at', g.ends_at,
               'reason', g.reason,
               'source', g.source,
               'actor_role', g.actor_role,
               'actor_email', a.email,
               'created_at', g.created_at)
             order by g.created_at desc, g.id)
      from public.candidate_premium_grants g
      left join public.users a on a.id = g.actor_id
      where g.candidate_user_id = p_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_candidate_premium(uuid) from public, anon;
grant execute on function public.admin_candidate_premium(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Conditions d'engagement figées à la sélection
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.mission_day_commitment_terms (
  mission_day_id uuid primary key references public.mission_days(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  -- Comme missions.candidate_id : identifiant du profil candidat.
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  -- 'selection' : conditions figées par la sélection ; 'legacy' : journée
  -- sélectionnée avant le lot 17a, plan et délai inconnus.
  terms_source text not null default 'selection'
    check (terms_source in ('selection', 'legacy')),
  candidate_plan text check (candidate_plan in ('free', 'premium')),
  cancellation_notice_hours integer,
  selected_at timestamptz,
  recorded_at timestamptz not null default now(),
  check (
    (terms_source = 'selection' and selected_at is not null
     and ((candidate_plan = 'free' and cancellation_notice_hours = 48)
          or (candidate_plan = 'premium' and cancellation_notice_hours = 24)))
    or (terms_source = 'legacy'
        and candidate_plan is null and cancellation_notice_hours is null))
);

create index if not exists idx_mission_day_commitment_terms_application
  on public.mission_day_commitment_terms (application_id);

alter table public.mission_day_commitment_terms enable row level security;
revoke all on table public.mission_day_commitment_terms from public, anon, authenticated;

comment on table public.mission_day_commitment_terms is
  'Lot 17a : plan candidat, délai d''annulation sans sanction (Free 48 h, Premium 24 h) et instant de sélection, figés par journée à la sélection (terms_source = selection). Journées sélectionnées avant le lot : terms_source = legacy, plan et délai inconnus, aucune sanction automatique d''annulation tardive. Immuable ; jamais lisible par une session.';

create or replace function public.protect_mission_day_commitment_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'mission_day_commitment_terms: terms are immutable'
      using errcode = '42501';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_day_commitment_terms: server-side only'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_mission_day_commitment_terms() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_day_commitment_terms on public.mission_day_commitment_terms;
create trigger trg_protect_mission_day_commitment_terms
  before insert or update or delete on public.mission_day_commitment_terms
  for each row execute function public.protect_mission_day_commitment_terms();

-- Les journées d'une mission sont créées dans la transaction de sélection
-- (contract_select_core : première journée par trg_create_mission_first_day,
-- suivantes ensuite), après le passage de la candidature à « selected ».
-- Une journée sans candidature sélectionnée (fixture de service) n'a pas
-- de conditions.
create or replace function public.record_mission_day_commitment_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_candidate uuid;
  v_candidate_user uuid;
  v_status public.application_status;
  v_selected_at timestamptz;
  v_plan text;
begin
  select m.application_id, m.candidate_id into v_application_id, v_candidate
  from public.missions m where m.id = new.mission_id;
  if v_application_id is null then
    return null;
  end if;
  select a.status, a.selected_at into v_status, v_selected_at
  from public.job_applications a where a.id = v_application_id;
  if v_status is distinct from 'selected' or v_selected_at is null then
    return null;
  end if;
  select cp.user_id into v_candidate_user
  from public.candidate_profiles cp where cp.id = v_candidate;
  v_plan := public.candidate_effective_plan(v_candidate_user, v_selected_at);
  insert into public.mission_day_commitment_terms (
    mission_day_id, mission_id, application_id, candidate_id,
    candidate_plan, cancellation_notice_hours, selected_at
  ) values (
    new.id, new.mission_id, v_application_id, v_candidate,
    v_plan, case when v_plan = 'premium' then 24 else 48 end, v_selected_at
  )
  on conflict (mission_day_id) do nothing;
  return null;
end;
$$;
revoke all on function public.record_mission_day_commitment_terms() from public, anon, authenticated;

drop trigger if exists trg_record_mission_day_commitment_terms on public.mission_days;
create trigger trg_record_mission_day_commitment_terms
  after insert on public.mission_days
  for each row execute function public.record_mission_day_commitment_terms();

-- Engagements historiques : journées déjà sélectionnées sans conditions.
-- Idempotent ; ne remplace jamais une ligne existante.
create or replace function public.mark_legacy_commitment_terms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.mission_day_commitment_terms (
    mission_day_id, mission_id, application_id, candidate_id,
    terms_source, candidate_plan, cancellation_notice_hours, selected_at
  )
  select d.id, m.id, a.id, m.candidate_id, 'legacy', null, null, a.selected_at
  from public.mission_days d
  join public.missions m on m.id = d.mission_id
  join public.job_applications a on a.id = m.application_id
  where a.status = 'selected'
    and not exists (select 1 from public.mission_day_commitment_terms t
                    where t.mission_day_id = d.id)
  on conflict (mission_day_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_legacy_commitment_terms() from public, anon, authenticated;

select public.mark_legacy_commitment_terms();
