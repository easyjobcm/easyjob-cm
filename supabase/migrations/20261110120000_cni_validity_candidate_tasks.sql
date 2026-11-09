-- Migration : CNI en cours de validité pour postuler, tâches du candidat (lot 9d)
-- Date : 2026-11-10
-- Tables : candidate_application_blockers (nouvelle)
-- Fonctions : candidate_cni_state, candidate_document_blocker (nouvelles,
--   internes), apply_to_job, protect_verified_candidate_data, moderate_cni,
--   record_application_blocker, candidate_action_tasks (nouvelles),
--   rt_on_candidate_application_blockers (signal Realtime),
--   candidate_profile_completion_pct (CNI en renouvellement)
--
-- Décision produit (2026-11-10, AUDIT.md §27) : toute NOUVELLE candidature
-- exige une CNI vérifiée et en cours de validité, y compris sur une offre
-- sans document requis.
--
--   - Source de la date : candidate_profiles.cni_expires_at (posée par
--     moderate_cni). Convention d'échéance inchangée (apply_to_job,
--     reputation_document_valid) : cni_expires_at est une date ; la CNI
--     est expirée quand cni_expires_at::timestamp at time zone 'UTC' < now(),
--     soit valide jusqu'à 00:00:00 UTC du jour d'échéance inclus et expirée
--     juste après ; sans date, elle est valide. Le contrôle compare à
--     now() au moment de la candidature : il ne dépend pas du passage de
--     reputation_expiry_sweep (pg_cron, rappels).
--   - Refus : code stable 'cni_expired', détail {"state": ...} :
--       expired           CNI vérifiée dont la date est passée ;
--       renewal_pending   nouvelle CNI soumise, en attente de vérification ;
--       renewal_rejected  nouvelle CNI refusée (complément demandé).
--     Placé après la suspension du compte et avant profile_not_verified :
--     la soumission d'une nouvelle CNI repasse cni_verified à 'pending' et
--     users.is_verified à false, le candidat doit pourtant voir l'état de
--     son renouvellement. Les autres refus et leur ordre sont inchangés.
--   - Renouvellement : une CNI vérifiée mais expirée ne verrouille plus ses
--     photos (protect_verified_candidate_data) : le candidat les remplace
--     sans demande admin ; l'identité reste verrouillée. L'accès reprend à
--     l'approbation (moderate_cni), qui exige désormais une date
--     d'échéance non dépassée.
--   - Portée : nouvelles candidatures seulement. Candidatures, sélections,
--     contrats et missions existants ne sont pas relus. La réputation
--     (reputation_*) ne lit pas la CNI : les étoiles acquises sont
--     conservées. La complétude reste acquise tant que les trois photos
--     sont présentes (candidate_profile_completion_pct).
--
-- Tâches du candidat : candidate_action_tasks() dérive de l'état en base
-- les actions qui débloquent une candidature (profil, identité, téléphone,
-- Mobile Money, CNI, justificatifs exigés par une offre). Les justificatifs
-- dépendent d'une offre : la route de candidature mémorise l'offre refusée
-- (record_application_blocker, recalculé en base) dans
-- candidate_application_blockers. Rien n'est stocké pour les autres
-- tâches : elles se retrouvent après reconnexion parce qu'elles sont
-- recalculées.
--
-- Rollback :
--   drop function public.candidate_action_tasks(), public.record_application_blocker(uuid),
--     public.candidate_document_blocker(public.candidate_profiles, uuid),
--     public.candidate_cni_state(public.candidate_profiles, timestamptz),
--     public.rt_on_candidate_application_blockers() cascade ;
--   drop table public.candidate_application_blockers ;
--   rejouer apply_to_job de 20261108130000, protect_verified_candidate_data
--   et candidate_profile_completion_pct de 20261031130000 (puis sa reprise
--   de complétude) et moderate_cni de 20260911120000.

-- ════════════════════════════════════════════════════════════════════
-- 1. État de la CNI à un instant
-- ════════════════════════════════════════════════════════════════════
-- valid             vérifiée, non expirée (reputation_document_valid) ;
-- expired           vérifiée, date passée ;
-- renewal_pending   date passée, nouvelle pièce en attente ;
-- renewal_rejected  date passée, nouvelle pièce refusée ;
-- pending / rejected / missing : première vérification (aucune date passée).
-- Une première soumission refusée garde ses chemins : « missing » ne
-- correspond qu'à l'absence d'une des trois photos.
create or replace function public.candidate_cni_state(
  p public.candidate_profiles, p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when public.reputation_document_valid(p.cni_verified::text, p.cni_expires_at, p_at)
      then 'valid'
    when p.cni_expires_at is not null
         and p.cni_expires_at::timestamp at time zone 'UTC' < p_at then
      case p.cni_verified::text
        when 'verified' then 'expired'
        when 'rejected' then 'renewal_rejected'
        else 'renewal_pending' end
    when p.cni_verified::text = 'rejected' then 'rejected'
    when coalesce(p.cni_front_url, '') = '' or coalesce(p.cni_back_url, '') = ''
         or coalesce(p.cni_selfie_url, '') = '' then 'missing'
    else 'pending'
  end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. Justificatifs exigés par une offre
-- ════════════════════════════════════════════════════════════════════
-- Boucles de apply_to_job (20261108130000), sorties dans une fonction pour
-- être relues par les tâches. Renvoie le premier justificatif manquant,
-- en attente, refusé ou expiré ({document_type, skill_name?, state}), ou
-- null. Même ordre, mêmes états, même convention d'échéance.
create or replace function public.candidate_document_blocker(
  p_profile public.candidate_profiles, p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required text[];
  v_doc text;
  v_state text;
  v_req record;
  v_skill_id uuid;
begin
  select j.required_documents into v_required from public.jobs j where j.id = p_job_id;

  foreach v_doc in array coalesce(v_required, '{}'::text[]) loop
    if v_doc = 'cni' then
      continue when p_profile.cni_verified = 'verified'
        and not coalesce(p_profile.cni_expires_at::timestamp at time zone 'UTC' < now(), false);
      v_state := case
        when p_profile.cni_expires_at::timestamp at time zone 'UTC' < now() then 'expired'
        when p_profile.cni_verified = 'pending' then 'pending'
        when p_profile.cni_verified = 'rejected' then 'rejected'
        else 'missing' end;
    elsif v_doc = 'driving_license' then
      continue when p_profile.driving_license_verified
        and not coalesce(p_profile.driving_license_expires_at::timestamp at time zone 'UTC' < now(), false);
      v_state := case
        when p_profile.driving_license_expires_at::timestamp at time zone 'UTC' < now() then 'expired'
        else 'missing' end;
    else
      select case
               when bool_or(d.status = 'verified' and not coalesce(d.expires_at::timestamp at time zone 'UTC' < now(), false)) then 'ok'
               when bool_or(d.status = 'verified') then 'expired'
               when bool_or(d.status = 'pending') then 'pending'
               when bool_or(d.status = 'rejected') then 'rejected'
               else 'missing' end
      into v_state
      from public.candidate_documents d
      where d.candidate_id = p_profile.id and d.document_type = v_doc;
      continue when v_state = 'ok';
    end if;
    return jsonb_build_object('document_type', v_doc, 'state', v_state);
  end loop;

  for v_req in
    select r.skill_name, r.document_type
    from public.job_required_skill_documents r
    where r.job_id = p_job_id
    order by r.skill_name, r.document_type
  loop
    v_skill_id := null;
    select s.id into v_skill_id
    from public.candidate_skills s
    where s.candidate_id = p_profile.id and lower(s.skill_name) = lower(v_req.skill_name)
    order by s.id
    limit 1;

    if v_skill_id is null then
      v_state := 'missing';
    else
      select case
               when bool_or(d.status = 'verified' and not coalesce(d.expires_at::timestamp at time zone 'UTC' < now(), false)) then 'ok'
               when bool_or(d.status = 'verified') then 'expired'
               when bool_or(d.status = 'pending') then 'pending'
               when bool_or(d.status = 'rejected') then 'rejected'
               else 'missing' end
      into v_state
      from public.candidate_skill_documents l
      join public.candidate_documents d on d.id = l.candidate_document_id
      where l.candidate_skill_id = v_skill_id and d.document_type = v_req.document_type;
    end if;

    continue when v_state = 'ok';
    return jsonb_build_object(
      'document_type', v_req.document_type,
      'skill_name', v_req.skill_name,
      'state', v_state);
  end loop;

  return null;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Candidature : CNI en cours de validité
-- ════════════════════════════════════════════════════════════════════
-- Définition de 20261108130000 avec, après account_suspended, le contrôle
-- de la CNI ; les boucles de justificatifs passent par
-- candidate_document_blocker (mêmes refus, même ordre).
create or replace function public.apply_to_job(p_job_id uuid)
returns public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.candidate_profiles;
  v_is_active boolean;
  v_is_verified boolean;
  v_cni_state text;
  v_job record;
  v_blocker jsonb;
  v_application public.job_applications;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_profile from public.candidate_profiles where user_id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if v_profile.onboarding_status is distinct from 'completed' then
    raise exception 'onboarding_incomplete';
  end if;
  if v_profile.profile_completion_pct < 60 then
    raise exception 'profile_incomplete';
  end if;

  select u.is_active, u.is_verified into v_is_active, v_is_verified
  from public.users u where u.id = v_uid;
  if v_is_active is false then
    raise exception 'account_suspended';
  end if;

  -- CNI expirée (ou renouvellement non encore approuvé) : refus, quelle que
  -- soit l'offre. Comparaison à now() : indépendante de pg_cron.
  v_cni_state := public.candidate_cni_state(v_profile, now());
  if v_cni_state in ('expired', 'renewal_pending', 'renewal_rejected') then
    raise exception 'cni_expired'
      using errcode = '42501',
            detail = jsonb_build_object('state', v_cni_state)::text;
  end if;

  if not coalesce(v_is_verified, false) or v_cni_state <> 'valid' then
    raise exception 'profile_not_verified';
  end if;

  -- FOR SHARE : l'offre ne peut pas changer de statut pendant la création.
  select j.id, j.status, j.positions_available, j.positions_filled
  into v_job
  from public.jobs j where j.id = p_job_id
  for share;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  if v_job.positions_filled >= v_job.positions_available then
    raise exception 'no_positions';
  end if;

  v_blocker := public.candidate_document_blocker(v_profile, p_job_id);
  if v_blocker is not null then
    raise exception 'document_requirement' using detail = v_blocker::text;
  end if;

  -- Double soumission : la contrainte unique tranche entre transactions
  -- concurrentes ; la seconde n'insère rien et reçoit already_applied.
  insert into public.job_applications (job_id, candidate_id, status)
  values (p_job_id, v_profile.id, 'pending')
  on conflict (job_id, candidate_id) do nothing
  returning * into v_application;

  if v_application.id is null then
    raise exception 'already_applied';
  end if;

  -- L'offre n'attend plus de justificatif de ce candidat.
  delete from public.candidate_application_blockers b
  where b.candidate_id = v_profile.id and b.job_id = p_job_id;

  return v_application;
end;
$$;

revoke all on function public.apply_to_job(uuid) from public, anon;
grant execute on function public.apply_to_job(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Renouvellement : photos d'une CNI expirée déverrouillées
-- ════════════════════════════════════════════════════════════════════
-- Définition de 20261031130000. Seul ajout : quand la CNI vérifiée est
-- expirée (même convention), le groupe cni_documents est couvert comme par
-- une demande admin. L'écriture repasse la CNI en 'pending' (renouvellement
-- soumis) ; l'identité reste verrouillée.
create or replace function public.protect_verified_candidate_data()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_touched text[] := '{}';
  v_covered text[];
  v_locked text[];
begin
  if current_user not in ('anon', 'authenticated')
     or old.cni_verified is distinct from 'verified' then
    return new;
  end if;

  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.date_of_birth is distinct from old.date_of_birth then
    v_touched := v_touched || 'identity'::text;
  end if;
  if new.cni_front_url is distinct from old.cni_front_url
     or new.cni_back_url is distinct from old.cni_back_url
     or new.cni_selfie_url is distinct from old.cni_selfie_url then
    v_touched := v_touched || 'cni_documents'::text;
  end if;

  if cardinality(v_touched) = 0 then
    if new.cni_verified is distinct from old.cni_verified
       or new.cni_rejection_reason is distinct from old.cni_rejection_reason then
      raise exception 'candidate_profiles: protected columns are server-side only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- FOR UPDATE : une demande ne déverrouille qu'une seule écriture, même
  -- concurrente. La RLS limite la lecture aux demandes du candidat.
  select coalesce(array_agg(distinct f), '{}')
  into v_covered
  from (
    select r.fields
    from public.profile_update_requests r
    where r.candidate_id = old.id
      and r.status = 'pending'
      and r.fields && v_touched
    for update
  ) pending, unnest(pending.fields) f;

  -- Lot 9d : CNI expirée → renouvellement des photos sans demande.
  if old.cni_expires_at is not null
     and old.cni_expires_at::timestamp at time zone 'UTC' < now() then
    v_covered := v_covered || 'cni_documents'::text;
  end if;

  v_locked := array(select g from unnest(v_touched) g where g <> all (v_covered));
  if cardinality(v_locked) > 0 then
    raise exception 'field_locked'
      using errcode = '42501', detail = array_to_json(v_locked)::text;
  end if;

  update public.profile_update_requests
  set status = 'done', completed_at = now()
  where candidate_id = old.id
    and status = 'pending'
    and fields && v_touched;

  new.cni_verified := 'pending';
  new.cni_rejection_reason := null;
  return new;
end;
$$;

revoke all on function public.protect_verified_candidate_data() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Approbation d'une CNI : date d'échéance non dépassée
-- ════════════════════════════════════════════════════════════════════
-- Définition de 20260911120000. Le défaut « naissance + 10 ans » est
-- conservé, mais une approbation dont la date résultante est absente ou
-- déjà passée est refusée ('cni_expiry_invalid') : sinon une CNI
-- approuvée serait aussitôt refusée par apply_to_job (cas d'un adulte sans
-- date saisie) et un renouvellement ne rétablirait pas l'accès.
create or replace function public.moderate_cni(
  p_profile_id    uuid,
  p_action        text,
  p_reject_reason text,
  p_expires_at    date
) returns void
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_user_id uuid;
  v_role    text;
  v_dob     date;
  v_expires date;
begin
  select cp.user_id, cp.date_of_birth
  into v_user_id, v_dob
  from public.candidate_profiles cp
  where cp.id = p_profile_id;

  if v_user_id is null then
    raise exception 'profile not found';
  end if;

  if not public.is_admin_user((select auth.uid())) then
    raise exception 'not authorized: admin only';
  end if;

  select role into v_role from public.users where id = (select auth.uid());
  if v_role not in ('admin_ops', 'admin_founder') then
    raise exception 'not authorized: role must be admin_ops or admin_founder';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action';
  end if;

  if p_action = 'reject'
     and (p_reject_reason is null or char_length(trim(p_reject_reason)) < 3) then
    raise exception 'reject reason required (min 3 chars)';
  end if;

  perform set_config('easyjob.system_update', 'on', true);
  if p_action = 'approve' then
    if not exists (
      select 1 from public.candidate_profiles
      where id = p_profile_id
        and cni_front_url  is not null
        and cni_back_url   is not null
        and cni_selfie_url is not null
    ) then
      raise exception 'cni documents not submitted';
    end if;
    if not exists (
      select 1 from public.candidate_profiles
      where id = p_profile_id
        and (trim(first_name) <> '')
        and (trim(last_name) <> '')
    ) then
      raise exception 'candidate identity incomplete (first/last name required)';
    end if;
    v_expires := coalesce(p_expires_at, (v_dob + '10 years'::interval)::date);
    if v_expires is null or v_expires::timestamp at time zone 'UTC' < now() then
      raise exception 'cni_expiry_invalid';
    end if;
    update public.candidate_profiles
    set
      cni_verified       = 'verified',
      cni_rejection_reason = null,
      cni_expires_at     = v_expires
    where id = p_profile_id;

    delete from public.document_expirations
    where candidate_id = p_profile_id and document_type = 'cni';
    insert into public.document_expirations
      (candidate_id, document_type, expires_at)
    values (p_profile_id, 'cni', v_expires);
  else
    update public.candidate_profiles
    set
      cni_verified       = 'rejected',
      cni_rejection_reason = p_reject_reason
    where id = p_profile_id;
  end if;
  perform set_config('easyjob.system_update', 'off', true);

  insert into public.notifications (
    user_id, notification_type, title, body, data
  ) values (
    v_user_id,
    'document_status',
    case when p_action = 'approve' then 'CNI vérifiée' else 'CNI refusée' end,
    case
      when p_action = 'approve'
        then 'Votre pièce d''identité a été vérifiée. Votre profil est désormais conforme (Mobile Money vérifié requis pour postuler).'
      else 'Votre pièce d''identité a été refusée. Motif : '
           || coalesce(p_reject_reason, 'non précisé') || '.'
    end,
    jsonb_build_object('cni_action', p_action, 'href', '/tasks?task=cni')
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, resource_type, resource_id, metadata
  ) values (
    (select auth.uid()),
    v_role,
    case when p_action = 'approve' then 'approve_cni' else 'reject_cni' end,
    'candidate_profiles',
    p_profile_id,
    jsonb_build_object('action', p_action, 'reject_reason', p_reject_reason, 'expires_at', v_expires)
  );

  perform public.recompute_user_verification(v_user_id);
end;
$body$;

grant execute on function public.moderate_cni(uuid, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Offres refusées faute de justificatif
-- ════════════════════════════════════════════════════════════════════
-- Une ligne par (candidat, offre) : la tâche « justificatif » reste
-- visible après reconnexion. Jamais lisible ni écrite en session : écrite
-- par record_application_blocker (recalcul en base, jamais une valeur du
-- client), lue par candidate_action_tasks, effacée par apply_to_job à la
-- candidature et par la suppression du profil ou de l'offre.
create table if not exists public.candidate_application_blockers (
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_id, job_id)
);

comment on table public.candidate_application_blockers is
  'Offres refusées à un candidat faute de justificatif (lot 9d). Source des tâches « justificatif » ; état recalculé à chaque lecture.';

alter table public.candidate_application_blockers enable row level security;
revoke all on table public.candidate_application_blockers from public, anon, authenticated;

create index if not exists candidate_application_blockers_job_idx
  on public.candidate_application_blockers (job_id);

-- Mémorise l'offre si elle attend encore un justificatif du candidat
-- connecté ; renvoie le justificatif attendu (ou null). Offre non active :
-- rien n'est mémorisé.
create or replace function public.record_application_blocker(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.candidate_profiles;
  v_blocker jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_profile from public.candidate_profiles where user_id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if not exists (select 1 from public.jobs j where j.id = p_job_id and j.status = 'active') then
    return null;
  end if;

  v_blocker := public.candidate_document_blocker(v_profile, p_job_id);
  if v_blocker is null then
    delete from public.candidate_application_blockers b
    where b.candidate_id = v_profile.id and b.job_id = p_job_id;
  else
    insert into public.candidate_application_blockers (candidate_id, job_id)
    values (v_profile.id, p_job_id)
    on conflict (candidate_id, job_id) do nothing;
  end if;
  return v_blocker;
end;
$$;

revoke all on function public.record_application_blocker(uuid) from public, anon;
grant execute on function public.record_application_blocker(uuid) to authenticated;

-- Signal Realtime « profile » au titulaire : le point des Tâches se met à
-- jour dans ses autres onglets.
create or replace function public.rt_on_candidate_application_blockers()
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
  return null;
end;
$$;

revoke all on function public.rt_on_candidate_application_blockers() from public, anon, authenticated;

drop trigger if exists trg_rt_candidate_application_blockers on public.candidate_application_blockers;
create trigger trg_rt_candidate_application_blockers
  after insert or delete on public.candidate_application_blockers
  for each row execute function public.rt_on_candidate_application_blockers();

-- ════════════════════════════════════════════════════════════════════
-- 7. Tâches qui débloquent une candidature
-- ════════════════════════════════════════════════════════════════════
-- Tableau JSON d'objets {key, kind, state, action_required, ...} :
--   profile   onboarding | incomplete (pct)
--   identity  missing                                 (nom, prénom, naissance)
--   phone     missing
--   momo      missing | pending | rejected (reason)
--   cni       expired | renewal_pending | renewal_rejected | missing |
--             pending | rejected (reason, expires_at, complement_requested)
--   document  missing | pending | rejected | expired
--             (document_type, skill_name, jobs [{id, title}])
-- action_required : le candidat a quelque chose à faire. Une pièce en
-- attente de vérification reste visible en suivi (false), sauf si une
-- demande admin de complément la couvre. Aucun identifiant de tiers,
-- aucune donnée d'entreprise hors titre de l'offre publiée.
create or replace function public.candidate_action_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.candidate_profiles;
  v_phone text;
  v_tasks jsonb := '[]'::jsonb;
  v_cni text;
  v_complement boolean;
  v_docs jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_profile from public.candidate_profiles where user_id = v_uid;
  if not found then
    return v_tasks;
  end if;
  select u.phone into v_phone from public.users u where u.id = v_uid;

  if v_profile.onboarding_status is distinct from 'completed' then
    v_tasks := v_tasks || jsonb_build_object('key', 'profile', 'kind', 'profile',
      'state', 'onboarding', 'action_required', true);
  elsif v_profile.profile_completion_pct < 60 then
    v_tasks := v_tasks || jsonb_build_object('key', 'profile', 'kind', 'profile',
      'state', 'incomplete', 'pct', v_profile.profile_completion_pct, 'action_required', true);
  end if;

  if coalesce(btrim(v_profile.first_name), '') = '' or coalesce(btrim(v_profile.last_name), '') = ''
     or v_profile.date_of_birth is null then
    v_tasks := v_tasks || jsonb_build_object('key', 'identity', 'kind', 'identity',
      'state', 'missing', 'action_required', true);
  end if;

  if v_phone is null then
    v_tasks := v_tasks || jsonb_build_object('key', 'phone', 'kind', 'phone',
      'state', 'missing', 'action_required', true);
  end if;

  if not coalesce(v_profile.momo_verified, false) then
    v_tasks := v_tasks || jsonb_build_object('key', 'momo', 'kind', 'momo',
      'state', case when v_profile.momo_reject_reason is not null then 'rejected'
                    when v_profile.momo_number is not null then 'pending'
                    else 'missing' end,
      'reason', v_profile.momo_reject_reason,
      'action_required', v_profile.momo_reject_reason is not null or v_profile.momo_number is null);
  end if;

  v_cni := public.candidate_cni_state(v_profile, now());
  if v_cni <> 'valid' then
    v_complement := exists (
      select 1 from public.profile_update_requests r
      where r.candidate_id = v_profile.id and r.status = 'pending'
        and r.fields && array['cni_documents', 'identity']);
    v_tasks := v_tasks || jsonb_build_object('key', 'cni', 'kind', 'cni',
      'state', v_cni,
      'expires_at', v_profile.cni_expires_at,
      'reason', case when v_cni in ('rejected', 'renewal_rejected') then v_profile.cni_rejection_reason end,
      'complement_requested', v_complement,
      'action_required', v_cni not in ('pending', 'renewal_pending') or v_complement);
  end if;

  -- Justificatifs : un par (type, compétence), avec les offres concernées
  -- encore ouvertes et sans candidature du candidat.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', 'document:' || (g.blocker ->> 'document_type') || ':' || coalesce(g.blocker ->> 'skill_name', ''),
           'kind', 'document',
           'state', g.blocker ->> 'state',
           'document_type', g.blocker ->> 'document_type',
           'skill_name', g.blocker ->> 'skill_name',
           'jobs', g.jobs,
           'action_required', (g.blocker ->> 'state') <> 'pending')
         order by g.first_at), '[]'::jsonb)
  into v_docs
  from (
    select b.blocker,
           jsonb_agg(jsonb_build_object('id', b.job_id, 'title', b.title) order by b.created_at) as jobs,
           min(b.created_at) as first_at
    from (
      select x.job_id, x.created_at, j.title,
             public.candidate_document_blocker(v_profile, x.job_id) as blocker
      from public.candidate_application_blockers x
      join public.jobs j on j.id = x.job_id
      where x.candidate_id = v_profile.id
        and j.status = 'active'
        and not exists (select 1 from public.job_applications a
                        where a.job_id = x.job_id and a.candidate_id = v_profile.id)
    ) b
    where b.blocker is not null
    group by b.blocker
  ) g;

  return v_tasks || v_docs;
end;
$$;

revoke all on function public.candidate_action_tasks() from public, anon;
grant execute on function public.candidate_action_tasks() to authenticated;

-- Fonctions internes : jamais exécutables en session.
revoke all on function public.candidate_cni_state(public.candidate_profiles, timestamptz) from public, anon, authenticated;
revoke all on function public.candidate_document_blocker(public.candidate_profiles, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Complétude pendant un renouvellement
-- ════════════════════════════════════════════════════════════════════
-- Définition de 20261031130000. L'approbation supprime les photos (T8.4) :
-- au premier envoi d'une nouvelle CNI, le critère « CNI » (15 %) tombait
-- jusqu'au troisième envoi, et avec lui l'étoile « profil » acquise. Une
-- CNI en renouvellement (date d'échéance posée par l'approbation et
-- passée, nouvelle pièce en attente ou refusée) reste comptée. Une
-- révérification d'identité d'une CNI encore valide perd toujours ces
-- points tant que les photos manquent (règle de 20261031130000, preuve
-- business-permissions G5). Fonction « stable » : elle lit now(), à
-- l'écriture du profil seulement. Même règle dans computeCandidateCriteria
-- (lib/utils/profile-completion.ts).
create or replace function public.candidate_profile_completion_pct(
  p public.candidate_profiles,
  p_skill_count integer
)
returns integer
language sql
stable
set search_path = ''
as $$
  select
      (case when coalesce(p.first_name, '') <> '' and coalesce(p.last_name, '') <> ''
                 and p.date_of_birth is not null and coalesce(p.city, '') <> ''
            then 20 else 0 end)
    + (case when coalesce(p.profile_photo_url, '') <> '' then 15 else 0 end)
    + (case when coalesce(p_skill_count, 0) > 0 then 15 else 0 end)
    + (case when char_length(regexp_replace(coalesce(p.bio, ''), '^\s+|\s+$', '', 'g')) > 10
            then 10 else 0 end)
    + (case when p.max_travel_distance_km is not null then 10 else 0 end)
    + (case when coalesce(p.latitude, 0) <> 0 and coalesce(p.longitude, 0) <> 0
            then 10 else 0 end)
    + (case when p.cni_verified = 'verified'
                 or (p.cni_expires_at is not null
                     and p.cni_expires_at::timestamp at time zone 'UTC' < now())
                 or (coalesce(p.cni_front_url, '') <> '' and coalesce(p.cni_back_url, '') <> ''
                     and coalesce(p.cni_selfie_url, '') <> '')
            then 15 else 0 end)
    + (case when coalesce(p.momo_verified, false) then 5 else 0 end);
$$;

revoke all on function public.candidate_profile_completion_pct(public.candidate_profiles, integer)
  from public, anon;
grant execute on function public.candidate_profile_completion_pct(public.candidate_profiles, integer)
  to authenticated;

-- Reprise : seuls les profils dont la valeur change sont réécrits.
update public.candidate_profiles cp
set profile_completion_pct = public.candidate_profile_completion_pct(
  cp, (select count(*)::integer from public.candidate_skills s where s.candidate_id = cp.id))
where cp.profile_completion_pct is distinct from public.candidate_profile_completion_pct(
  cp, (select count(*)::integer from public.candidate_skills s where s.candidate_id = cp.id));
