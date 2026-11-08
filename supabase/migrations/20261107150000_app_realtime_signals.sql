-- Migration : signaux Realtime de l'application (lot 7d)
-- Date : 2026-11-07
--
-- Objectif : qu'un changement fait dans une session (ou par le serveur, ou
-- par un admin) soit visible sans rechargement dans les autres sessions,
-- onglets et écrans restés ouverts.
--
-- Modèle « signal puis relecture » :
--   - Les triggers ci-dessous n'émettent qu'un signal minimal
--     {"d": domaine, "r": identifiant de la ressource ou null} par Realtime
--     Broadcast (realtime.send), sur des canaux PRIVÉS :
--       user:<auth.uid>  destinataire unique, propriétaire ou partie ;
--       admin            administrateurs actifs, domaine seul (pas d'id) ;
--       jobs:public      offres visibles des candidats (statut active),
--                        identifiant d'offre seulement.
--   - L'écran qui reçoit un signal relit ce à quoi il a droit (routes, RPC,
--     RLS inchangées). Le signal ne porte aucune donnée métier : ni code de
--     fin, ni IP, ni document, ni numéro MoMo, ni contenu d'un autre compte.
--   - Un signal n'accorde aucun droit : les opérations protégées relisent
--     les droits courants en base (RPC existantes).
--
-- Domaines : account, profile, subscription, jobs, applications, missions,
-- contracts, notifications (liste fermée, contrôlée côté client).
--
-- Autorisation (RLS sur realtime.messages, extension broadcast) :
--   - lecture de user:<uid> par cette seule session, même suspendue (elle
--     doit apprendre sa suspension ou sa perte de rôle) ;
--   - lecture de admin et de jobs:public : compte actif (admin pour admin) ;
--   - aucune politique INSERT : un client ne peut pas émettre sur ces
--     canaux privés (realtime.send est SECURITY INVOKER : l'insertion faite
--     depuis une session est refusée par la RLS), ni présence.
--
-- Publication postgres_changes : missions et job_applications sont
-- retirées de supabase_realtime (lot 2026-06-05). Leurs lignes complètes
-- (REPLICA IDENTITY FULL) partaient vers le navigateur, colonnes héritées
-- comprises ; le hook client est remplacé par le modèle ci-dessus.
--
-- Droits effectifs des plans :
--   - company_effective_plan : le plan entreprise stocké
--     (company_profiles.subscription_plan, source de vérité SRS v1.2) ne
--     vaut que jusqu'à subscription_expires_at ; au-delà, « free », sans
--     écriture SQL. NULL = sans échéance. Une annulation en fin de période
--     (auto_renew = false) conserve le plan jusqu'à cette date.
--   - update_job applique ce plan effectif (modification directe des
--     offres actives : Pro et Business). Seule différence avec 7c-bis.
--   - Premium candidat : rôle candidate_premium ET premium_until futur
--     (règle de /upgrade/candidate ; le matching lit premium_until).
--   - my_account_state : état du compte et des droits pour l'interface,
--     avec l'heure du serveur (échéances programmées côté client).
--
-- Volume (plan Supabase Free) : un signal par (canal, domaine, ressource)
-- et par transaction (déduplication locale à la transaction).
--
-- Rollback :
--   drop trigger … (liste en fin de fichier) ; drop function public.rt_* ;
--   drop policy easyjob_rt_* on realtime.messages ;
--   drop function public.my_account_state(), public.company_effective_plan(text, timestamptz) ;
--   recréer update_job depuis 20261107120000 ;
--   alter publication supabase_realtime add table public.missions, public.job_applications ;
--   alter table public.missions replica identity full ; idem job_applications.

-- ── 1. Publication postgres_changes : retrait ───────────────────────
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'missions') then
    alter publication supabase_realtime drop table public.missions;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'job_applications') then
    alter publication supabase_realtime drop table public.job_applications;
  end if;
end
$$;

alter table public.missions replica identity default;
alter table public.job_applications replica identity default;

-- ── 2. Émission ──────────────────────────────────────────────────────
-- Envoi dédupliqué dans la transaction. Une erreur d'envoi ne fait jamais
-- échouer l'écriture métier (realtime.send journalise un avertissement).
create or replace function public.rt_send(p_topic text, p_domain text, p_resource uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text := p_topic || '|' || p_domain || '|' || coalesce(p_resource::text, '-');
  v_sent text := coalesce(current_setting('easyjob.rt_sent', true), '');
begin
  if p_topic is null or p_domain is null then
    return;
  end if;
  if position(';' || v_key || ';' in v_sent) > 0 then
    return;
  end if;
  perform set_config('easyjob.rt_sent', v_sent || ';' || v_key || ';', true);
  perform realtime.send(
    jsonb_build_object('d', p_domain, 'r', p_resource),
    'sync',
    p_topic,
    true
  );
end;
$$;

create or replace function public.rt_signal_users(p_user_ids uuid[], p_domain text, p_resource uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  for v_uid in
    select distinct u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
    where u is not null
  loop
    perform public.rt_send('user:' || v_uid::text, p_domain, p_resource);
  end loop;
end;
$$;

-- Admin : domaine seul. Un admin rétrogradé dont le canal resterait ouvert
-- (client modifié) n'apprend qu'« il s'est passé quelque chose ».
create or replace function public.rt_signal_admin(p_domain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_send('admin', p_domain, null);
end;
$$;

create or replace function public.rt_signal_public_jobs(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_send('jobs:public', 'jobs', p_job_id);
end;
$$;

-- ── 3. Destinataires ─────────────────────────────────────────────────
create or replace function public.rt_candidate_user(p_candidate_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id from public.candidate_profiles cp where cp.id = p_candidate_id;
$$;

create or replace function public.rt_company_user(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id from public.company_profiles cp where cp.id = p_company_id;
$$;

create or replace function public.rt_job_company_user(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cp.user_id
  from public.jobs j
  join public.company_profiles cp on cp.id = j.company_id
  where j.id = p_job_id;
$$;

-- Candidat et entreprise d'une mission.
create or replace function public.rt_mission_parties(p_mission_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array[cand.user_id, comp.user_id]
  from public.missions m
  left join public.candidate_profiles cand on cand.id = m.candidate_id
  left join public.jobs j on j.id = m.job_id
  left join public.company_profiles comp on comp.id = j.company_id
  where m.id = p_mission_id;
$$;

-- ── 4. Triggers ──────────────────────────────────────────────────────
-- users : statut, rôle, vérification. Destinataire : le compte lui-même
-- (il apprend sa suspension ou sa perte de rôle même s'il ne lit plus la
-- ligne qu'il consultait), puis les écrans admin.
create or replace function public.rt_on_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.role, new.is_active, new.is_verified, new.phone_verified,
        new.ban_reason, new.ban_expires_at, new.locale, new.email, new.phone)
       is not distinct from
       (old.role, old.is_active, old.is_verified, old.phone_verified,
        old.ban_reason, old.ban_expires_at, old.locale, old.email, old.phone) then
      return null;
    end if;
    perform public.rt_signal_users(array[new.id], 'account', new.id);
  end if;
  perform public.rt_signal_admin('account');
  return null;
end;
$$;

-- candidate_profiles : onboarding, progression, CNI, MoMo, identité,
-- étoiles ; premium_until → domaine subscription.
create or replace function public.rt_on_candidate_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.candidate_profiles := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.rt_signal_users(array[v_row.user_id], 'profile', v_row.id);
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.premium_until is distinct from old.premium_until) then
    perform public.rt_signal_users(array[v_row.user_id], 'subscription', v_row.id);
    perform public.rt_signal_admin('subscription');
  end if;
  perform public.rt_signal_admin('profile');
  return null;
end;
$$;

-- Tables filles du profil candidat (colonne candidate_id).
create or replace function public.rt_on_candidate_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := case when tg_op = 'DELETE' then old.candidate_id else new.candidate_id end;
begin
  perform public.rt_signal_users(
    array[public.rt_candidate_user(v_candidate)], 'profile', v_candidate);
  perform public.rt_signal_admin('profile');
  return null;
end;
$$;

create or replace function public.rt_on_candidate_skill_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skill uuid := case when tg_op = 'DELETE' then old.candidate_skill_id else new.candidate_skill_id end;
  v_candidate uuid;
begin
  select cs.candidate_id into v_candidate from public.candidate_skills cs where cs.id = v_skill;
  perform public.rt_signal_users(
    array[public.rt_candidate_user(v_candidate)], 'profile', v_candidate);
  perform public.rt_signal_admin('profile');
  return null;
end;
$$;

-- company_profiles : onboarding, vérification, suspension ; colonnes de
-- plan → domaine subscription.
create or replace function public.rt_on_company_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_profiles := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.rt_signal_users(array[v_row.user_id], 'profile', v_row.id);
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE'
         and (new.subscription_plan, new.subscription_tier,
              new.subscription_expires_at, new.trial_ends_at)
             is distinct from
             (old.subscription_plan, old.subscription_tier,
              old.subscription_expires_at, old.trial_ends_at)) then
    perform public.rt_signal_users(array[v_row.user_id], 'subscription', v_row.id);
    perform public.rt_signal_admin('subscription');
  end if;
  perform public.rt_signal_admin('profile');
  return null;
end;
$$;

create or replace function public.rt_on_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  perform public.rt_signal_users(array[v_user], 'subscription', null);
  perform public.rt_signal_admin('subscription');
  return null;
end;
$$;

-- jobs : entreprise propriétaire, file admin, candidats ayant postulé, et
-- canal public si l'offre est ou était visible (statut active).
create or replace function public.rt_on_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.jobs := case when tg_op = 'DELETE' then old else new end;
  v_was_visible boolean := tg_op <> 'INSERT' and old.status = 'active';
  v_is_visible  boolean := tg_op <> 'DELETE' and new.status = 'active';
begin
  perform public.rt_signal_users(
    array[public.rt_company_user(v_row.company_id)], 'jobs', v_row.id);
  perform public.rt_signal_users(
    array(select cp.user_id
          from public.job_applications ja
          join public.candidate_profiles cp on cp.id = ja.candidate_id
          where ja.job_id = v_row.id),
    'jobs', v_row.id);
  if v_was_visible or v_is_visible then
    perform public.rt_signal_public_jobs(v_row.id);
  end if;
  perform public.rt_signal_admin('jobs');
  return null;
end;
$$;

create or replace function public.rt_on_job_applications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.job_applications := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.rt_signal_users(
    array[public.rt_candidate_user(v_row.candidate_id),
          public.rt_job_company_user(v_row.job_id)],
    'applications', v_row.id);
  perform public.rt_signal_admin('applications');
  return null;
end;
$$;

create or replace function public.rt_on_missions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.missions := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.rt_signal_users(
    array[public.rt_candidate_user(v_row.candidate_id),
          public.rt_job_company_user(v_row.job_id)],
    'missions', v_row.id);
  return null;
end;
$$;

-- Tables filles d'une mission (colonne mission_id) : début, code, avis.
create or replace function public.rt_on_mission_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission uuid := case when tg_op = 'DELETE' then old.mission_id else new.mission_id end;
begin
  perform public.rt_signal_users(public.rt_mission_parties(v_mission), 'missions', v_mission);
  return null;
end;
$$;

create or replace function public.rt_on_contracts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.contracts := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.rt_signal_users(
    array[public.rt_candidate_user(v_row.candidate_id),
          public.rt_company_user(v_row.company_id)],
    'contracts', v_row.id);
  return null;
end;
$$;

create or replace function public.rt_on_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  perform public.rt_signal_users(array[v_user], 'notifications', null);
  return null;
end;
$$;

-- Fonctions internes : jamais appelables par une session.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rt_send(text, text, uuid)',
    'public.rt_signal_users(uuid[], text, uuid)',
    'public.rt_signal_admin(text)',
    'public.rt_signal_public_jobs(uuid)',
    'public.rt_candidate_user(uuid)',
    'public.rt_company_user(uuid)',
    'public.rt_job_company_user(uuid)',
    'public.rt_mission_parties(uuid)',
    'public.rt_on_users()',
    'public.rt_on_candidate_profiles()',
    'public.rt_on_candidate_child()',
    'public.rt_on_candidate_skill_documents()',
    'public.rt_on_company_profiles()',
    'public.rt_on_subscriptions()',
    'public.rt_on_jobs()',
    'public.rt_on_job_applications()',
    'public.rt_on_missions()',
    'public.rt_on_mission_child()',
    'public.rt_on_contracts()',
    'public.rt_on_notifications()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

-- AFTER … FOR EACH ROW : le signal part au commit (realtime.messages est
-- lu par Realtime après validation) ; une transaction annulée n'émet rien.
create trigger trg_rt_users
  after insert or update or delete on public.users
  for each row execute function public.rt_on_users();
create trigger trg_rt_candidate_profiles
  after insert or update or delete on public.candidate_profiles
  for each row execute function public.rt_on_candidate_profiles();
create trigger trg_rt_candidate_skills
  after insert or update or delete on public.candidate_skills
  for each row execute function public.rt_on_candidate_child();
create trigger trg_rt_candidate_documents
  after insert or update or delete on public.candidate_documents
  for each row execute function public.rt_on_candidate_child();
create trigger trg_rt_candidate_availability
  after insert or update or delete on public.candidate_availability
  for each row execute function public.rt_on_candidate_child();
create trigger trg_rt_profile_update_requests
  after insert or update or delete on public.profile_update_requests
  for each row execute function public.rt_on_candidate_child();
create trigger trg_rt_document_expirations
  after insert or update or delete on public.document_expirations
  for each row execute function public.rt_on_candidate_child();
create trigger trg_rt_candidate_skill_documents
  after insert or update or delete on public.candidate_skill_documents
  for each row execute function public.rt_on_candidate_skill_documents();
create trigger trg_rt_company_profiles
  after insert or update or delete on public.company_profiles
  for each row execute function public.rt_on_company_profiles();
create trigger trg_rt_subscriptions
  after insert or update or delete on public.subscriptions
  for each row execute function public.rt_on_subscriptions();
create trigger trg_rt_jobs
  after insert or update or delete on public.jobs
  for each row execute function public.rt_on_jobs();
create trigger trg_rt_job_applications
  after insert or update or delete on public.job_applications
  for each row execute function public.rt_on_job_applications();
create trigger trg_rt_missions
  after insert or update or delete on public.missions
  for each row execute function public.rt_on_missions();
create trigger trg_rt_mission_check_ins
  after insert or update or delete on public.mission_check_ins
  for each row execute function public.rt_on_mission_child();
create trigger trg_rt_mission_completion_codes
  after insert or update or delete on public.mission_completion_codes
  for each row execute function public.rt_on_mission_child();
create trigger trg_rt_reviews
  after insert or update or delete on public.reviews
  for each row execute function public.rt_on_mission_child();
create trigger trg_rt_contracts
  after insert or update or delete on public.contracts
  for each row execute function public.rt_on_contracts();
create trigger trg_rt_notifications
  after insert or update or delete on public.notifications
  for each row execute function public.rt_on_notifications();

-- ── 5. Autorisation des canaux (realtime.messages) ───────────────────
create or replace function public.rt_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active is not false
  );
$$;

create or replace function public.rt_session_is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.is_active is not false
      and u.role::text in ('admin_support', 'admin_ops', 'admin_founder')
  );
$$;

revoke all on function public.rt_session_is_active() from public, anon;
revoke all on function public.rt_session_is_active_admin() from public, anon;
grant execute on function public.rt_session_is_active() to authenticated;
grant execute on function public.rt_session_is_active_admin() to authenticated;

drop policy if exists easyjob_rt_user_topic on realtime.messages;
drop policy if exists easyjob_rt_admin_topic on realtime.messages;
drop policy if exists easyjob_rt_public_jobs_topic on realtime.messages;

create policy easyjob_rt_user_topic on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );

create policy easyjob_rt_admin_topic on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'admin'
    and (select public.rt_session_is_active_admin())
  );

create policy easyjob_rt_public_jobs_topic on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'jobs:public'
    and (select public.rt_session_is_active())
  );

-- ── 6. Plan effectif et état du compte ───────────────────────────────
create or replace function public.company_effective_plan(p_plan text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_plan, 'free')) not in ('starter', 'pro', 'business') then 'free'
    when p_expires_at is not null and p_expires_at <= now() then 'free'
    else lower(p_plan)
  end;
$$;

grant execute on function public.company_effective_plan(text, timestamptz) to authenticated;

-- Lecture pour l'interface : compte courant uniquement, aucun document ni
-- coordonnée. server_now sert à programmer les échéances côté client.
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

  select cp.id, cp.premium_until
  into v_candidate
  from public.candidate_profiles cp where cp.user_id = v_uid;

  select s.plan, s.status, s.auto_renew, s.expires_at
  into v_sub
  from public.subscriptions s
  where s.user_id = v_uid
  order by s.started_at desc
  limit 1;

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
      'premium_until', v_candidate.premium_until,
      -- Règle de /upgrade/candidate : rôle premium ET échéance future.
      'premium', v_user.role = 'candidate_premium'
                 and v_candidate.premium_until is not null
                 and v_candidate.premium_until > now(),
      'renews', case when v_sub.plan is null then null
                     else (v_sub.auto_renew and v_sub.status = 'active') end
    ) end
  );
end;
$$;

revoke all on function public.my_account_state() from public, anon;
grant execute on function public.my_account_state() to authenticated;

-- ── 7. update_job : plan effectif (échéance comprise) ────────────────
-- Reprise de 20261107120000 ; seule la lecture du plan change.
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
  if v_company.verification_status is distinct from 'verified' then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  -- Verrou : une décision admin concurrente attend, ou est attendue.
  select * into v_current from public.jobs j
  where j.id = p_job_id and j.company_id = v_company.id
  for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  if v_current.status = 'active' then
    -- Modification directe des offres actives : plans Pro et Business
    -- (getPlanLimits().directEdit) tant que le plan n'est pas échu (lot 7d),
    -- avec nouvelle modération. Les
    -- conditions d'un candidat déjà sélectionné relèvent du contrat (lot 7).
    if v_company.plan not in ('pro', 'business') then
      raise exception 'job_locked_plan';
    end if;
    if coalesce(v_current.positions_filled, 0) > 0 then
      raise exception 'job_has_selected_candidates';
    end if;
  elsif v_current.status is null
     or v_current.status not in ('draft', 'pending_review', 'rejected') then
    raise exception 'job_not_editable';
  end if;

  v_job := public.job_apply_content(v_current, p_job);

  update public.jobs j set
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
    -- Nouvelle soumission : l'ancienne décision reste dans audit_logs.
    status = 'pending_review',
    rejection_reason = null,
    moderation_notes = null,
    moderated_at = null,
    moderation_by = null,
    published_at = null
  where j.id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.update_job(uuid, jsonb) from public, anon;
grant execute on function public.update_job(uuid, jsonb) to authenticated;
