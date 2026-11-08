-- Migration : retrait définitif des niveaux Sandbox (lot 9b)
-- Date : 2026-11-08
-- Tables affectées : candidate_profiles (review_count ajoutée ; sandbox_level,
--   sandbox_missions_completed, is_sandbox supprimées), jobs
--   (sandbox_level_required, is_sandbox supprimées), missions (is_sandbox
--   supprimée), job_templates (sandbox_level_required supprimée),
--   company_availability_alerts (sandbox_level_min supprimée), sandbox_config
--   (supprimée)
-- Fonctions : refresh_review_rating, protect_candidate_profile_columns,
--   apply_to_job, company_job_applicants (type de retour), job_apply_content
--
-- Décision produit (2026-11-08, AUDIT.md §25) : les étoiles issues des
-- évaluations de missions (origin = 'mission_flow') sont le seul indicateur
-- de réputation affiché. Les niveaux Sandbox (Nouveau, Confirmé, Fiable,
-- Expert), le niveau minimum des offres et le « mode Sandbox » (missions
-- d'initiation, jamais appliqué) disparaissent. Un compte sans avis peut
-- postuler à sa première mission.
--
--   - Aucun seuil d'étoiles pour postuler, aucun classement par la note,
--     aucune conversion d'un ancien niveau en note : les niveaux existants
--     sont supprimés sans report.
--   - Les autres refus de apply_to_job sont inchangés et dans le même ordre
--     (compte, inscription, complétude, identité, statut de l'offre, places,
--     documents dont le permis, justificatifs de compétences).
--   - average_rating n'est pas modifiée. review_count est le nombre
--     d'évaluations prises en compte dans average_rating ; le même trigger
--     écrit les deux dans la même instruction.
--   - reliability_score reste en base (jamais calculée, 0 par défaut) mais
--     n'est plus renvoyée aux entreprises : ce n'est pas une note d'avis.
--
-- Rollback (les valeurs des niveaux sont perdues) : recréer les colonnes
-- (defaults d'origine : sandbox_level 0, sandbox_missions_completed 0,
-- is_sandbox true côté candidat et false côté offre et mission,
-- sandbox_level_required 0, sandbox_level_min 0) et la table sandbox_config
-- (20260526130000_remote_baseline), puis rejouer apply_to_job et
-- protect_candidate_profile_columns de 20261031130000,
-- company_job_applicants de 20261106120000 (drop function avant),
-- job_apply_content de 20261107120000 et refresh_review_rating de
-- 20261106140000 ; enfin
-- alter table public.candidate_profiles drop column review_count.

-- ── 1. Nombre d'avis ───────────────────────────────────────────────
alter table public.candidate_profiles
  add column if not exists review_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'candidate_profiles_review_count_chk') then
    alter table public.candidate_profiles
      add constraint candidate_profiles_review_count_chk check (review_count >= 0);
  end if;
end $$;

comment on column public.candidate_profiles.review_count is
  'Nombre d''évaluations de missions (origin = mission_flow) prises en compte dans average_rating. Écrit par refresh_review_rating.';

-- Rattrapage : mêmes évaluations que celles de average_rating. Seules les
-- lignes concernées sont réécrites ; average_rating n'est pas touchée.
update public.candidate_profiles cp
set review_count = r.n
from (
  select reviewed_id, count(*)::integer as n
  from public.reviews
  where reviewed_type = 'candidate' and origin = 'mission_flow'
  group by reviewed_id
) r
where cp.id = r.reviewed_id and cp.review_count is distinct from r.n;

-- Étoiles et nombre d'avis du profil évalué, dans la même instruction.
-- Trigger non exécutable en session (garde-fou F-41, lot 5b). L'unicité
-- reviews_mission_flow_unique (mission, côté) garantit qu'une relance de
-- submit_mission_review ne compte pas deux fois le même avis.
create or replace function public.refresh_review_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin is distinct from 'mission_flow' then
    return new;
  end if;
  if new.reviewed_type = 'company' then
    update public.company_profiles cp
    set average_rating = coalesce((
      select round(avg(r.overall_rating)::numeric, 1) from public.reviews r
      where r.reviewed_type = 'company' and r.reviewed_id = new.reviewed_id
        and r.origin = 'mission_flow'), 0)
    where cp.id = new.reviewed_id;
  elsif new.reviewed_type = 'candidate' then
    update public.candidate_profiles cp
    set (average_rating, review_count) = (
      select coalesce(round(avg(r.overall_rating)::numeric, 1), 0), count(*)::integer
      from public.reviews r
      where r.reviewed_type = 'candidate' and r.reviewed_id = new.reviewed_id
        and r.origin = 'mission_flow')
    where cp.id = new.reviewed_id;
  end if;
  return new;
end;
$$;

revoke all on function public.refresh_review_rating() from public, anon, authenticated;

-- ── 2. Colonnes protégées du profil candidat ───────────────────────
-- Définition de 20261031130000 : les colonnes Sandbox sortent de la liste,
-- review_count y entre (écrite par le seul trigger d'évaluation). La branche
-- UPDATE protège déjà toute colonne hors liste blanche.
create or replace function public.protect_candidate_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Toutes les colonnes hors GRANT INSERT doivent garder leur défaut.
    -- Les valeurs dérivées seraient recalculées ensuite, mais une valeur
    -- fournie est refusée explicitement plutôt qu'ignorée.
    if new.profile_completion_pct is distinct from 0
       or new.onboarding_status is distinct from 'pending'
       or new.premium_until is not null
       or new.driving_license_verified is distinct from false
       or new.driving_license_expires_at is not null
       or new.reliability_score is distinct from 0
       or new.total_missions is distinct from 0
       or new.completed_missions is distinct from 0
       or new.no_show_count is distinct from 0
       or new.average_rating is distinct from 0
       or new.review_count is distinct from 0
       or new.cni_verified is distinct from 'pending'
       or new.cni_expires_at is not null
       or new.cni_number is not null
       or new.cni_rejection_reason is not null
       or new.momo_provider is not null
       or new.momo_number is not null
       or new.momo_account_name is not null
       or new.momo_verified is distinct from false
       or new.momo_name_match is distinct from false
       or new.momo_verified_by is not null
       or new.momo_verified_at is not null
       or new.momo_reject_reason is not null
    then
      raise exception 'candidate_profiles: protected columns are server-side only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Même liste que le GRANT UPDATE de 20261031130000 (plus updated_at,
  -- posé par handle_updated_at). Les colonnes ajoutées plus tard sont protégées par
  -- défaut.
  if (to_jsonb(new) - array[
        'first_name', 'last_name', 'gender', 'date_of_birth', 'city', 'quartier',
        'latitude', 'longitude', 'bio', 'profile_photo_url', 'max_travel_distance_km',
        'cni_front_url', 'cni_back_url', 'cni_selfie_url', 'cni_verified',
        'cni_rejection_reason', 'onboarding_step', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array[
        'first_name', 'last_name', 'gender', 'date_of_birth', 'city', 'quartier',
        'latitude', 'longitude', 'bio', 'profile_photo_url', 'max_travel_distance_km',
        'cni_front_url', 'cni_back_url', 'cni_selfie_url', 'cni_verified',
        'cni_rejection_reason', 'onboarding_step', 'updated_at'])
  then
    raise exception 'candidate_profiles: protected columns are server-side only'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_candidate_profile_columns() from public, anon, authenticated;

-- ── 3. Candidature sans critère de niveau ──────────────────────────
-- Définition de 20261031130000 sans le contrôle sandbox_level_too_low.
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
  v_job record;
  v_doc text;
  v_state text;
  v_req record;
  v_skill_id uuid;
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
  if not coalesce(v_is_verified, false) then
    raise exception 'profile_not_verified';
  end if;

  -- FOR SHARE : l'offre ne peut pas changer de statut pendant la création.
  select j.id, j.status, j.positions_available, j.positions_filled,
         j.required_documents
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

  -- Documents requis par l'offre. Une date sans heure expire à minuit UTC,
  -- comme new Date('YYYY-MM-DD') côté TypeScript.
  foreach v_doc in array coalesce(v_job.required_documents, '{}'::text[]) loop
    if v_doc = 'cni' then
      continue when v_profile.cni_verified = 'verified'
        and not coalesce(v_profile.cni_expires_at::timestamp at time zone 'UTC' < now(), false);
      v_state := case
        when v_profile.cni_expires_at::timestamp at time zone 'UTC' < now() then 'expired'
        when v_profile.cni_verified = 'pending' then 'pending'
        when v_profile.cni_verified = 'rejected' then 'rejected'
        else 'missing' end;
    elsif v_doc = 'driving_license' then
      continue when v_profile.driving_license_verified
        and not coalesce(v_profile.driving_license_expires_at::timestamp at time zone 'UTC' < now(), false);
      v_state := case
        when v_profile.driving_license_expires_at::timestamp at time zone 'UTC' < now() then 'expired'
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
      where d.candidate_id = v_profile.id and d.document_type = v_doc;
      continue when v_state = 'ok';
    end if;
    raise exception 'document_requirement'
      using detail = jsonb_build_object('document_type', v_doc, 'state', v_state)::text;
  end loop;

  for v_req in
    select r.skill_name, r.document_type
    from public.job_required_skill_documents r
    where r.job_id = p_job_id
    order by r.skill_name, r.document_type
  loop
    select s.id into v_skill_id
    from public.candidate_skills s
    where s.candidate_id = v_profile.id and lower(s.skill_name) = lower(v_req.skill_name)
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
    raise exception 'document_requirement'
      using detail = jsonb_build_object(
        'document_type', v_req.document_type,
        'skill_name', v_req.skill_name,
        'state', v_state)::text;
  end loop;

  -- Double soumission : la contrainte unique tranche entre transactions
  -- concurrentes ; la seconde n'insère rien et reçoit already_applied.
  insert into public.job_applications (job_id, candidate_id, status)
  values (p_job_id, v_profile.id, 'pending')
  on conflict (job_id, candidate_id) do nothing
  returning * into v_application;

  if v_application.id is null then
    raise exception 'already_applied';
  end if;

  return v_application;
end;
$$;

revoke all on function public.apply_to_job(uuid) from public, anon;
grant execute on function public.apply_to_job(uuid) to authenticated;

-- ── 4. Candidats vus par l'entreprise ──────────────────────────────
-- Type de retour modifié : sandbox_level et reliability_score sont
-- remplacés par average_rating et review_count. L'ordre reste celui du
-- lot 7a (match_score, puis date) : la note ne classe pas les candidats.
-- Toujours aucun téléphone, email, CNI, Mobile Money, adresse, coordonnée
-- ni document (F-16).
drop function if exists public.company_job_applicants(uuid);

create function public.company_job_applicants(p_job_id uuid)
returns table (
  application_id uuid,
  status public.application_status,
  match_score numeric,
  distance_km numeric,
  rejection_reason text,
  created_at timestamptz,
  first_name text,
  last_initial text,
  has_photo boolean,
  average_rating numeric,
  review_count integer,
  completed_missions integer,
  skills text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs j
    join public.company_profiles cp on cp.id = j.company_id
    where j.id = p_job_id and cp.user_id = (select auth.uid())
  ) then
    raise exception 'job_not_found';
  end if;

  return query
  select a.id, a.status, a.match_score, a.distance_km, a.rejection_reason,
         a.created_at,
         c.first_name,
         nullif(upper(left(btrim(coalesce(c.last_name, '')), 1)), ''),
         c.profile_photo_url is not null,
         c.average_rating::numeric,
         c.review_count,
         c.completed_missions,
         coalesce((select array_agg(s.skill_name order by s.skill_name)
                   from public.candidate_skills s
                   where s.candidate_id = c.id), '{}'::text[])
  from public.job_applications a
  join public.candidate_profiles c on c.id = a.candidate_id
  where a.job_id = p_job_id
  order by a.match_score desc nulls last, a.created_at;
end;
$$;

revoke all on function public.company_job_applicants(uuid) from public, anon;
grant execute on function public.company_job_applicants(uuid) to authenticated;

-- ── 5. Contenu d'offre : refus explicite de l'ancien champ ─────────
-- Définition de 20261107120000. create_job et update_job n'écrivaient déjà
-- plus le niveau ; un client qui l'envoie reçoit invalid_job_data plutôt
-- qu'un champ ignoré, comme pour hourly_rate.
create or replace function public.job_apply_content(p_job public.jobs, p_payload jsonb)
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Douala')::date;
  v_field text;
  v_pay numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_job_data' using detail = 'payload';
  end if;
  -- Ancien modèle : refus explicite plutôt qu'un champ ignoré.
  if p_payload ? 'hourly_rate' then
    raise exception 'invalid_job_data' using detail = 'hourly_rate';
  end if;
  -- Niveau Sandbox minimum retiré (lot 9b) : même règle.
  if p_payload ? 'sandbox_level_required' then
    raise exception 'invalid_job_data' using detail = 'sandbox_level_required';
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
    -- Montant par candidat : nombre JSON entier (pas de chaîne, pas de
    -- fraction) ; le dépassement de integer lève numeric_value_out_of_range.
    v_field := 'mission_pay_per_candidate';
    if jsonb_typeof(p_payload -> 'mission_pay_per_candidate') is distinct from 'number' then
      raise exception 'invalid_job_data' using detail = v_field;
    end if;
    v_pay := (p_payload ->> 'mission_pay_per_candidate')::numeric;
    if v_pay <> trunc(v_pay) then
      raise exception 'invalid_job_data' using detail = v_field;
    end if;
    p_job.mission_pay_per_candidate := v_pay::integer;
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
    when p_job.mission_pay_per_candidate is null
      or p_job.mission_pay_per_candidate <= 0 then 'mission_pay_per_candidate'
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

-- ── 6. Suppression des objets Sandbox ──────────────────────────────
-- Garde-fou : plus aucune fonction du schéma public ne doit lire ces
-- colonnes (le corps PL/pgSQL n'est pas suivi par pg_depend : un oubli ne
-- se verrait qu'à l'exécution). job_apply_content ne cite le nom que pour
-- refuser le champ.
do $$
declare
  v_names text;
  v_levels integer;
  v_jobs integer;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_names
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname <> 'job_apply_content'
    and (p.prosrc ~* 'sandbox_(level|config|missions_completed)'
         or p.prosrc ~* 'is_sandbox');
  if v_names is not null then
    raise exception 'lot 9b: fonctions encore liées aux niveaux Sandbox : %', v_names;
  end if;

  -- Trace des valeurs supprimées sans conversion (journal de migration).
  select count(*) into v_levels from public.candidate_profiles where sandbox_level > 0;
  select count(*) into v_jobs from public.jobs where sandbox_level_required > 0;
  raise notice 'lot 9b: % profil(s) avec un niveau > 0 et % offre(s) avec un niveau minimum > 0, supprimés sans conversion',
    v_levels, v_jobs;
end $$;

-- Sans CASCADE : une vue, une contrainte ou une policy oubliée fait
-- échouer la migration au lieu d'être supprimée en silence.
drop index if exists public.idx_candidate_profiles_sandbox_level;
alter table public.candidate_profiles
  drop constraint if exists candidate_profiles_sandbox_level_chk,
  drop column if exists sandbox_level,
  drop column if exists sandbox_missions_completed,
  drop column if exists is_sandbox;

alter table public.jobs
  drop constraint if exists jobs_sandbox_level_required_chk,
  drop column if exists sandbox_level_required,
  drop column if exists is_sandbox;

alter table public.missions drop column if exists is_sandbox;
alter table public.job_templates drop column if exists sandbox_level_required;
alter table public.company_availability_alerts drop column if exists sandbox_level_min;

-- Seuils des niveaux (jamais lus par l'application) : policies, index,
-- trigger et contraintes partent avec la table ; aucune clé étrangère ne la
-- vise.
drop table if exists public.sandbox_config;
