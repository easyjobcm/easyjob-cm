-- Migration : création, modération et publication des offres (lot 6 audit)
-- Date : 2026-11-01
-- Tables affectées : jobs (données, contrainte, grants, policies, trigger),
--                    job_applications (trigger de compteur),
--                    notifications et audit_logs (écrits par moderate_job)
-- Fonctions : create_job, update_job, moderate_job, delete_job,
--             job_apply_content, protect_job_writes, sync_job_positions_filled
--
-- Constat corrigé (docs/audit/AUDIT.md) :
--   F-09  L'interface insérait l'offre directement (sans le contrôle de
--         vérification de POST /api/jobs) ; la policy FOR ALL laissait
--         l'entreprise passer son offre à 'active', écrire les champs de
--         modération et les compteurs ; aucun admin ne pouvait lire une offre
--         en attente, et la route de modération réussissait sur 0 ligne.
--         Deux valeurs coexistaient pour l'attente (pending_review et
--         pending_moderation) et pour la publication (active et published).
--         La suppression par l'entreprise effaçait en cascade candidatures
--         sélectionnées et missions.
--
-- Mécanisme (même principe que les lots 1, 2 et 5b) :
--   1. Valeurs canoniques : pending_review pour l'attente et active pour la
--      publication ; les synonymes pending_moderation et published sont
--      interdits par contrainte. Les autres statuts (draft, rejected, filled,
--      expired, cancelled) gardent leur sens. Les valeurs de l'enum restent
--      (un enum ne se réduit pas sans recréer le type).
--   2. Plus aucune écriture en session : création, modification, modération
--      et suppression passent par des RPC SECURITY DEFINER qui déduisent
--      l'appelant de auth.uid() et appliquent elles-mêmes les règles.
--   3. Trigger de défense en profondeur fondé sur current_user.
--   4. Lecture admin : policy SELECT pour les trois grades (admin_support
--      consulte sans décider).
--   5. positions_filled n'est plus écrit par l'entreprise : un trigger sur
--      job_applications le tient à jour lors d'une sélection ou de son
--      annulation (seule écriture légitime existante, app/company/jobs/[id]).
--
-- Transitions (entreprise) :
--   création                    → pending_review
--   draft | pending_review      → pending_review (modification)
--   rejected                    → pending_review (correction, motif effacé)
--   active, plan pro/business, aucun candidat sélectionné
--                               → pending_review (nouvelle modération,
--                                 décision produit du 2026-11-01)
--   active, autres plans        → refus job_locked_plan
--   filled | expired | cancelled → refus job_not_editable
-- Transitions (admin_ops, admin_founder) :
--   pending_review → active (approve) | rejected (reject, motif obligatoire)
-- Suppression (entreprise) : refusée (job_has_commitments) si l'offre ou une
--   sous-offre a une candidature sélectionnée ou no_show, une mission, un
--   contrat ou une pénalité d'annulation. L'annulation relève du lot 7.
--
-- Reprise des données : pending_moderation → pending_review, published →
-- active (déjà fait par 20260526120000 ; refait ici pour les lignes créées
-- depuis par POST /api/jobs).
--
-- Retour arrière : NE PAS rouvrir les grants ni recréer la policy FOR ALL
-- (réintroduirait F-09). En dernier recours :
--   drop trigger if exists trg_protect_job_writes on public.jobs;
--   drop trigger if exists trg_sync_job_positions_filled on public.job_applications;
--   drop function if exists public.create_job(jsonb);
--   drop function if exists public.update_job(uuid, jsonb);
--   drop function if exists public.moderate_job(uuid, text, text, timestamptz);
--   drop function if exists public.delete_job(uuid);
--   drop function if exists public.job_apply_content(public.jobs, jsonb);
--   drop function if exists public.protect_job_writes();
--   drop function if exists public.sync_job_positions_filled();
--   drop policy if exists "Admins can view all jobs" on public.jobs;
--   alter table public.jobs drop constraint if exists jobs_status_canonical_chk;
-- La migration est transactionnelle (aucun effet partiel).

-- ── 1. Statuts uniques ──────────────────────────────────────────────
update public.jobs set status = 'pending_review' where status = 'pending_moderation';
update public.jobs set status = 'active' where status = 'published';

alter table public.jobs drop constraint if exists jobs_status_canonical_chk;
alter table public.jobs add constraint jobs_status_canonical_chk
  check (status is null or status not in ('pending_moderation', 'published'));

-- ── 2. Privilèges ───────────────────────────────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on table public.jobs from anon, authenticated;
grant select on table public.jobs to anon, authenticated;

-- ── 3. Policies ─────────────────────────────────────────────────────
drop policy if exists "Companies can manage own jobs" on public.jobs;

drop policy if exists "Admins can view all jobs" on public.jobs;
create policy "Admins can view all jobs" on public.jobs
  for select to authenticated
  using (public.is_admin_user((select auth.uid())));

-- ── 4. Défense en profondeur ────────────────────────────────────────
create or replace function public.protect_job_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'jobs: use create_job, update_job, moderate_job or delete_job'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_job_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_job_writes on public.jobs;
create trigger trg_protect_job_writes
  before insert or update or delete on public.jobs
  for each row execute function public.protect_job_writes();

-- ── 5. Contenu modifiable par l'entreprise ──────────────────────────
-- Mêmes champs et mêmes règles que jobInputSchema (lib/validations/job.ts).
-- Une donnée invalide lève invalid_job_data, le champ en DETAIL.
create or replace function public.job_apply_content(p_job public.jobs, p_payload jsonb)
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Douala')::date;
  v_field text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_job_data' using detail = 'payload';
  end if;

  begin
    v_field := 'title';
    p_job.title := nullif(btrim(p_payload ->> 'title'), '');
    v_field := 'description';
    p_job.description := nullif(btrim(p_payload ->> 'description'), '');
    v_field := 'address';
    p_job.address := nullif(btrim(p_payload ->> 'address'), '');
    v_field := 'city';
    p_job.city := nullif(btrim(p_payload ->> 'city'), '');
    v_field := 'quartier';
    p_job.quartier := nullif(btrim(p_payload ->> 'quartier'), '');
    v_field := 'category_id';
    p_job.category_id := (p_payload ->> 'category_id')::uuid;
    v_field := 'job_type';
    p_job.job_type := coalesce((p_payload ->> 'job_type')::public.job_type, 'shift');
    v_field := 'latitude';
    p_job.latitude := (p_payload ->> 'latitude')::numeric;
    v_field := 'longitude';
    p_job.longitude := (p_payload ->> 'longitude')::numeric;
    v_field := 'start_date';
    p_job.start_date := (p_payload ->> 'start_date')::date;
    v_field := 'end_date';
    p_job.end_date := (p_payload ->> 'end_date')::date;
    v_field := 'start_time';
    p_job.start_time := (p_payload ->> 'start_time')::time;
    v_field := 'end_time';
    p_job.end_time := (p_payload ->> 'end_time')::time;
    v_field := 'is_recurring';
    p_job.is_recurring := coalesce((p_payload ->> 'is_recurring')::boolean, false);
    v_field := 'recurring_days';
    p_job.recurring_days := case when p_payload ? 'recurring_days'
                                   and jsonb_typeof(p_payload -> 'recurring_days') = 'array'
      then array(select jsonb_array_elements_text(p_payload -> 'recurring_days')::integer)
      else null end;
    v_field := 'hourly_rate';
    p_job.hourly_rate := (p_payload ->> 'hourly_rate')::numeric;
    v_field := 'estimated_hours';
    p_job.estimated_hours := (p_payload ->> 'estimated_hours')::numeric;
    v_field := 'required_skills';
    p_job.required_skills := case when p_payload ? 'required_skills'
                                    and jsonb_typeof(p_payload -> 'required_skills') = 'array'
      then array(select btrim(s) from jsonb_array_elements_text(p_payload -> 'required_skills') s)
      else null end;
    v_field := 'min_experience_months';
    p_job.min_experience_months := coalesce((p_payload ->> 'min_experience_months')::integer, 0);
    v_field := 'dress_code';
    p_job.dress_code := nullif(btrim(p_payload ->> 'dress_code'), '');
    v_field := 'special_instructions';
    p_job.special_instructions := nullif(btrim(p_payload ->> 'special_instructions'), '');
    v_field := 'positions_available';
    p_job.positions_available := coalesce((p_payload ->> 'positions_available')::integer, 1);
    v_field := 'urgency';
    p_job.urgency := coalesce((p_payload ->> 'urgency')::public.urgency_level, 'normal');
  exception
    when invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range
      or invalid_parameter_value then
      raise exception 'invalid_job_data' using detail = v_field;
  end;

  v_field := case
    when p_job.title is null or char_length(p_job.title) > 120 then 'title'
    when p_job.description is null or char_length(p_job.description) > 5000 then 'description'
    when p_job.address is null or char_length(p_job.address) > 200 then 'address'
    when p_job.city is null or char_length(p_job.city) > 100 then 'city'
    when p_job.start_date is null or p_job.start_date < v_today then 'start_date'
    when p_job.end_date is not null and p_job.end_date < p_job.start_date then 'end_date'
    when p_job.start_time is null then 'start_time'
    when p_job.end_time is null then 'end_time'
    when p_job.hourly_rate is null or p_job.hourly_rate <= 0 then 'hourly_rate'
    when p_job.positions_available < 1
      or p_job.positions_available < coalesce(p_job.positions_filled, 0) then 'positions_available'
    when p_job.min_experience_months < 0 then 'min_experience_months'
    -- 'critical' est réservé (non proposé à l'entreprise).
    when p_job.urgency not in ('normal', 'urgent') then 'urgency'
    when exists (select 1 from unnest(p_job.required_skills) s where s is null or s = '') then 'required_skills'
    else null end;
  if v_field is not null then
    raise exception 'invalid_job_data' using detail = v_field;
  end if;

  return p_job;
end;
$$;

revoke all on function public.job_apply_content(public.jobs, jsonb) from public, anon, authenticated;

-- ── 6. Entreprise autorisée à publier ───────────────────────────────
-- Compte actif, rôle entreprise, profil vérifié (company_profiles
-- .verification_status, seule source de vérité). Aucune limite de nombre
-- d'offres : SRS v1.2, offres illimitées pour tous les plans.
create or replace function public.create_job(p_job jsonb)
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

  select cp.id, cp.verification_status, cp.is_active into v_company
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

  -- Seules les colonnes de contenu viennent du client ; propriétaire,
  -- statut, modération, compteurs et montants internes gardent leur défaut.
  v_job := public.job_apply_content(
    jsonb_populate_record(null::public.jobs, '{}'::jsonb), p_job);

  insert into public.jobs (
    company_id, status,
    title, description, category_id, job_type, address, city, quartier,
    latitude, longitude, start_date, end_date, start_time, end_time,
    is_recurring, recurring_days, hourly_rate, estimated_hours,
    required_skills, min_experience_months, dress_code,
    special_instructions, positions_available, urgency
  ) values (
    v_company.id, 'pending_review',
    v_job.title, v_job.description, v_job.category_id, v_job.job_type,
    v_job.address, v_job.city, v_job.quartier, v_job.latitude,
    v_job.longitude, v_job.start_date, v_job.end_date, v_job.start_time,
    v_job.end_time, v_job.is_recurring, v_job.recurring_days,
    v_job.hourly_rate, v_job.estimated_hours, v_job.required_skills,
    v_job.min_experience_months, v_job.dress_code,
    v_job.special_instructions, v_job.positions_available, v_job.urgency
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.create_job(jsonb) from public, anon;
grant execute on function public.create_job(jsonb) to authenticated;

-- ── 7. Modification et nouvelle soumission ──────────────────────────
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
         lower(coalesce(cp.subscription_plan, 'free')) as plan
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
    -- (getPlanLimits().directEdit), avec nouvelle modération. Les
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
    hourly_rate = v_job.hourly_rate,
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

-- ── 8. Modération ───────────────────────────────────────────────────
-- Grades : admin_ops et admin_founder (SRS §6.12, même matrice que
-- moderate_cni). Le verrou FOR UPDATE et le contrôle du statut courant
-- font échouer la seconde décision concurrente (job_not_pending) : ni
-- écrasement, ni seconde notification. p_seen_updated_at refuse une
-- décision prise sur une version modifiée entre-temps (job_changed).
create or replace function public.moderate_job(
  p_job_id uuid,
  p_action text,
  p_reason text default null,
  p_seen_updated_at timestamptz default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_admin_active boolean;
  v_reason text := nullif(btrim(p_reason), '');
  v_job public.jobs;
  v_company record;
  v_locale text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.role::text, u.is_active into v_role, v_admin_active
  from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('admin_ops', 'admin_founder')
     or v_admin_active is false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;
  if p_action = 'reject' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'pending_review' then
    raise exception 'job_not_pending';
  end if;
  if p_seen_updated_at is not null
     and v_job.updated_at is distinct from p_seen_updated_at then
    raise exception 'job_changed';
  end if;

  select cp.user_id, cp.verification_status, cp.is_active as company_active,
         u.is_active as user_active, u.locale::text as locale
  into v_company
  from public.company_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;

  -- Une entreprise suspendue ou repassée en revue (lot 5b) ne publie pas.
  if p_action = 'approve'
     and (v_company.verification_status is distinct from 'verified'
          or v_company.company_active is false
          or v_company.user_active is false) then
    raise exception 'company_not_eligible';
  end if;

  update public.jobs j set
    status = case when p_action = 'approve' then 'active' else 'rejected' end::public.job_status,
    published_at = case when p_action = 'approve' then now() else null end,
    -- Une offre active est lisible par tous : une éventuelle note
    -- d'approbation ne va que dans audit_logs.
    rejection_reason = case when p_action = 'reject' then v_reason else null end,
    moderated_at = now(),
    moderation_by = v_uid
  where j.id = p_job_id
  returning * into v_job;

  v_locale := coalesce(v_company.locale, 'fr');
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id,
      'system',
      case
        when p_action = 'approve' and v_locale = 'en' then 'Job approved'
        when p_action = 'approve' then 'Offre approuvée'
        when v_locale = 'en' then 'Job rejected'
        else 'Offre refusée' end,
      case
        when p_action = 'approve' and v_locale = 'en'
          then 'Your job "' || v_job.title || '" is now visible to candidates.'
        when p_action = 'approve'
          then 'Votre offre « ' || v_job.title || ' » est désormais visible par les candidats.'
        when v_locale = 'en'
          then 'Your job "' || v_job.title || '" was rejected. Reason: ' || v_reason
               || '. You can correct it and submit it again.'
        else 'Votre offre « ' || v_job.title || ' » a été refusée. Motif : ' || v_reason
             || '. Vous pouvez la corriger et la soumettre à nouveau.' end,
      jsonb_build_object('job_id', v_job.id, 'job_action', p_action)
    );
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (
    v_uid,
    v_role,
    case when p_action = 'approve' then 'approve_job' else 'reject_job' end,
    'jobs',
    v_job.id,
    jsonb_build_object('company_id', v_job.company_id, 'reason', v_reason)
  );

  return v_job;
end;
$$;

revoke all on function public.moderate_job(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.moderate_job(uuid, text, text, timestamptz) to authenticated;

-- ── 9. Suppression ──────────────────────────────────────────────────
-- Seule une offre sans engagement se supprime : les cascades effaceraient
-- sinon candidatures sélectionnées et missions. Les sous-offres (cascade
-- parent_job_id) sont contrôlées avec l'offre.
-- Verrous dans l'ordre de la sélection (candidature, puis offre via
-- sync_job_positions_filled) : une sélection concurrente est soit vue par le
-- contrôle, soit bloquée puis sans effet sur une candidature supprimée.
create or replace function public.delete_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company_id uuid;
  v_job_ids uuid[];
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

  select cp.id into v_company_id
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;

  select array_agg(j.id) into v_job_ids
  from public.jobs j
  where j.company_id = v_company_id
    and (j.id = p_job_id or j.parent_job_id = p_job_id);
  if v_job_ids is null or not (p_job_id = any(v_job_ids)) then
    raise exception 'job_not_found';
  end if;

  perform 1 from public.job_applications a
  where a.job_id = any(v_job_ids) order by a.id for update;
  perform 1 from public.jobs j
  where j.id = any(v_job_ids) order by j.id for update;

  if exists (select 1 from public.job_applications a
             where a.job_id = any(v_job_ids) and a.status in ('selected', 'no_show'))
     or exists (select 1 from public.missions m where m.job_id = any(v_job_ids))
     or exists (select 1 from public.contracts c where c.job_id = any(v_job_ids))
     or exists (select 1 from public.cancellation_penalties p
                where p.job_id = any(v_job_ids)) then
    raise exception 'job_has_commitments';
  end if;

  delete from public.jobs j where j.id = p_job_id;
  return p_job_id;
end;
$$;

revoke all on function public.delete_job(uuid) from public, anon;
grant execute on function public.delete_job(uuid) to authenticated;

-- ── 10. Compteur de places pourvues ─────────────────────────────────
-- La sélection (UPDATE de job_applications par l'entreprise, lot 2) ne
-- peut plus écrire jobs. Le verrou de ligne de l'UPDATE sur jobs sérialise
-- les sélections concurrentes. Le contrôle des places et la création de la
-- mission relèvent du lot 7a (select_candidate).
create or replace function public.sync_job_positions_filled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs j
  set positions_filled = greatest(coalesce(j.positions_filled, 0)
    + case when new.status = 'selected' then 1 else -1 end, 0)
  where j.id = new.job_id;
  return null;
end;
$$;

revoke all on function public.sync_job_positions_filled() from public, anon, authenticated;

drop trigger if exists trg_sync_job_positions_filled on public.job_applications;
create trigger trg_sync_job_positions_filled
  after update of status on public.job_applications
  for each row
  when (old.status is distinct from new.status
        and (old.status = 'selected' or new.status = 'selected'))
  execute function public.sync_job_positions_filled();
