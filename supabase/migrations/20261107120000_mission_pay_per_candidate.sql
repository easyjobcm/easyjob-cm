-- Migration : rémunération forfaitaire par candidat pour la mission (lot 7c-bis)
-- Date : 2026-11-07
-- Tables affectées : jobs (colonne mission_pay_per_candidate, contraintes,
--   suppression de hourly_rate, salary_per_person_per_day et salary_locked),
--   contract_clause_versions (versions simple-v2 et formal-v2)
-- Fonctions : job_apply_content, create_job, update_job, select_candidate,
--   get_mission (recréées) ; prevent_salary_modification (supprimée)
--
-- Modèle produit (décision du 2026-11-07, AUDIT.md §20) : une offre annonce
-- un montant fixe en francs CFA (XAF) pour la mission de CHAQUE candidat
-- sélectionné. Exemple : 3 places pour un inventaire de 8 h à 12 h à
-- 10 000 F CFA = 10 000 F CFA pour chacun des trois candidats. Terminer à
-- 11 h 30 ou à 12 h 30 conserve le montant. Les dates et horaires restent
-- affichés (organisation du candidat, appréciation par le support) mais
-- n'entrent dans aucun calcul de rémunération. Il n'existe plus qu'un
-- modèle : le taux horaire (hourly_rate) et le salaire journalier jamais
-- utilisé (salary_per_person_per_day, avec son verrou salary_locked et le
-- trigger enforce_salary_lock) sont supprimés.
--
-- Règles du montant (mêmes que jobInputSchema, lib/validations/job.ts) :
--   - nombre JSON entier strictement positif, au plus 2 147 483 647 (borne
--     du type integer) ; une chaîne, une fraction, zéro ou un négatif lève
--     invalid_job_data avec DETAIL = 'mission_pay_per_candidate' ;
--   - une charge utile qui contient encore hourly_rate est refusée
--     (DETAIL = 'hourly_rate') plutôt que silencieusement ignorée ;
--   - devise : XAF uniquement (contrainte jobs_currency_xaf_chk).
--   Le minimum de 500 F/h du formulaire n'est pas repris : il portait sur une
--   heure, pas sur une mission. Aucune autre borne n'existait côté base
--   (hourly_rate > 0, numeric(10,2)).
--
-- Contrat (select_candidate) : contract_data fige mission_pay_per_candidate,
-- currency = 'XAF' et pay_basis = 'per_mission'. L'empreinte du lot 7b porte
-- sur tout contract_data : ces trois valeurs sont couvertes sans changer
-- contract_terms_hash. Les clauses v2 remplacent « valider les heures
-- effectuées » (sans objet depuis le lot 7c) par la remise du code de fin et
-- le versement du montant forfaitaire convenu. get_mission renvoie le
-- montant et la devise figés dans le contrat, jamais ceux de l'offre.
--
-- Reprise des données : AUCUNE conversion. Un taux horaire ne se convertit
-- pas en forfait sans connaître la durée réellement convenue. La migration
-- échoue si une offre existe déjà (diagnostic : nombre d'offres et de
-- contrats concernés). Le projet distant n'a aucune offre (phase de test) ;
-- une pile locale de développement seedée doit être réinitialisée
-- (supabase db reset) puis reseedée avec scripts/seed-test-data.ts.
-- Requête de contrôle (lecture seule) avant déploiement :
--   select count(*) as jobs, count(*) filter (where hourly_rate is not null) as with_rate
--   from public.jobs;
--   select count(*) from public.contracts where contract_data ? 'hourly_rate';
--
-- Retour arrière : pas de retour automatique (colonnes supprimées). En
-- dernier recours, rejouer les définitions des migrations 20261101140000
-- (lot 6), 20261106120000 (lot 7a) et 20261106140000 (lot 7c) après avoir
-- recréé hourly_rate. Les versions de clauses v2 restent (immuables).
-- Transactionnelle (aucun effet partiel).

-- ── 1. Aucune conversion arbitraire ─────────────────────────────────
do $$
declare
  v_jobs bigint;
  v_contracts bigint;
begin
  select count(*) into v_jobs from public.jobs;
  select count(*) into v_contracts from public.contracts
  where contract_data ? 'hourly_rate';
  if v_jobs > 0 or v_contracts > 0 then
    raise exception 'mission_pay_migration_blocked: % offre(s) et % contrat(s) portent un taux horaire',
      v_jobs, v_contracts
      using detail = 'Le taux horaire (jobs.hourly_rate, contract_data.hourly_rate) ne se convertit pas en montant par mission sans la durée convenue.',
            hint = 'Fixer le montant de chaque offre à la main avant de rejouer, ou réinitialiser la pile locale de test (supabase db reset) puis la reseeder.';
  end if;
end;
$$;

-- ── 2. Un seul modèle de rémunération ──────────────────────────────
drop trigger if exists enforce_salary_lock on public.jobs;
drop function if exists public.prevent_salary_modification();

alter table public.jobs
  drop column if exists hourly_rate,
  drop column if exists salary_per_person_per_day,
  drop column if exists salary_locked,
  add column mission_pay_per_candidate integer not null;

alter table public.jobs
  add constraint jobs_mission_pay_per_candidate_chk
    check (mission_pay_per_candidate > 0);

update public.jobs set currency = 'XAF' where currency is null;
alter table public.jobs
  alter column currency set default 'XAF',
  alter column currency set not null,
  add constraint jobs_currency_xaf_chk check (currency = 'XAF');

comment on column public.jobs.mission_pay_per_candidate is
  'Montant fixe en XAF (entier > 0) versé à CHAQUE candidat sélectionné pour la mission, quelle que soit la durée effective. Jamais multiplié par les heures ni par le nombre de places.';
comment on column public.jobs.currency is
  'Devise du montant par mission : XAF uniquement.';

-- ── 3. Contenu modifiable par l'entreprise ──────────────────────────
-- Identique au lot 6, hourly_rate remplacé par mission_pay_per_candidate.
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

-- ── 4. Création (contrôles du lot 6 inchangés) ──────────────────────
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
  -- statut, modération, compteurs, devise et montants internes gardent leur
  -- défaut.
  v_job := public.job_apply_content(
    jsonb_populate_record(null::public.jobs, '{}'::jsonb), p_job);

  insert into public.jobs (
    company_id, status,
    title, description, category_id, job_type, address, city, quartier,
    latitude, longitude, start_date, end_date, start_time, end_time,
    is_recurring, recurring_days, mission_pay_per_candidate, estimated_hours,
    required_skills, min_experience_months, dress_code,
    special_instructions, positions_available, urgency
  ) values (
    v_company.id, 'pending_review',
    v_job.title, v_job.description, v_job.category_id, v_job.job_type,
    v_job.address, v_job.city, v_job.quartier, v_job.latitude,
    v_job.longitude, v_job.start_date, v_job.end_date, v_job.start_time,
    v_job.end_time, v_job.is_recurring, v_job.recurring_days,
    v_job.mission_pay_per_candidate, v_job.estimated_hours, v_job.required_skills,
    v_job.min_experience_months, v_job.dress_code,
    v_job.special_instructions, v_job.positions_available, v_job.urgency
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.create_job(jsonb) from public, anon;
grant execute on function public.create_job(jsonb) to authenticated;

-- ── 5. Modification et nouvelle soumission (transitions du lot 6) ───
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

-- ── 6. Clauses v2 (le montant est un forfait par mission) ───────────
-- Insérées après v1 : current_contract_clauses les retient pour tout
-- nouveau contrat ; les contrats existants gardent leur version.
insert into public.contract_clause_versions (id, contract_template, body)
select v.id, v.template, jsonb_build_object(
  'fr', jsonb_build_object(
    'intro', 'Le présent contrat est conclu entre les parties ci-dessus pour la mission décrite.',
    'candidate_title', 'Le candidat s''engage à',
    'candidate', jsonb_build_array(
      'se présenter à l''heure convenue sur le lieu de la mission ;',
      'exécuter les tâches confiées avec professionnalisme ;',
      'respecter les règles de sécurité et d''hygiène ;',
      'confirmer le début de la mission et saisir le code de fin dans EasyJob.'),
    'company_title', 'L''entreprise s''engage à',
    'company', jsonb_build_array(
      'fournir un environnement de travail sûr ;',
      'remettre le code de fin au candidat une fois le travail effectué ;',
      'régler au candidat le montant forfaitaire convenu pour la mission, quelle que soit l''heure de fin effective, selon les conditions de la plateforme.'),
    'consent', 'J''ai lu les conditions ci-dessus et je les accepte. Je comprends que cette acceptation électronique, horodatée, vaut signature.'),
  'en', jsonb_build_object(
    'intro', 'This contract is concluded between the parties above for the mission described.',
    'candidate_title', 'The candidate agrees to',
    'candidate', jsonb_build_array(
      'arrive at the agreed time at the mission location;',
      'carry out the assigned tasks professionally;',
      'follow safety and hygiene rules;',
      'confirm the start of the mission and enter the completion code in EasyJob.'),
    'company_title', 'The company agrees to',
    'company', jsonb_build_array(
      'provide a safe working environment;',
      'give the completion code to the candidate once the work is done;',
      'pay the candidate the agreed flat amount for the mission, whatever the actual finishing time, under the platform''s terms.'),
    'consent', 'I have read the terms above and accept them. I understand that this timestamped electronic acceptance counts as my signature.'))
from (values ('simple-v2', 'simple'), ('formal-v2', 'formal')) as v(id, template)
on conflict (id) do nothing;

-- ── 7. Sélection : conditions figées (contrôles du lot 7a inchangés) ─
create or replace function public.select_candidate(p_application_id uuid)
returns table (
  application_id uuid,
  status public.application_status,
  mission_id uuid,
  contract_id uuid,
  already_selected boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_candidate record;
  v_contract_type text;
  v_mission_id uuid;
  v_contract_id uuid;
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

  select cp.id, cp.company_name, cp.is_active into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select a.* into v_application
  from public.job_applications a where a.id = p_application_id
  for update;
  if not found then
    raise exception 'application_not_found';
  end if;

  select j.* into v_job
  from public.jobs j where j.id = v_application.job_id
  for update;
  -- Candidature d'une autre entreprise : même réponse qu'inexistante.
  if not found or v_job.company_id is distinct from v_company.id then
    raise exception 'application_not_found';
  end if;

  if v_application.status = 'selected' then
    select m.id into v_mission_id from public.missions m
    where m.application_id = v_application.id;
    select c.id into v_contract_id from public.contracts c
    where c.application_id = v_application.id;
    if v_mission_id is null or v_contract_id is null then
      raise exception 'selection_incomplete';
    end if;
    return query select v_application.id, v_application.status,
      v_mission_id, v_contract_id, true;
    return;
  end if;

  if v_application.status not in ('pending', 'shortlisted') then
    raise exception 'application_not_selectable';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  if coalesce(v_job.positions_filled, 0) >= coalesce(v_job.positions_available, 1) then
    raise exception 'no_positions';
  end if;

  select cp.id, cp.user_id, cp.first_name, u.is_active, u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_application.candidate_id;
  if not found or v_candidate.is_active is false then
    raise exception 'candidate_unavailable';
  end if;

  update public.job_applications a
  set status = 'selected', selected_at = now(), selected_by = v_uid
  where a.id = v_application.id
  returning a.* into v_application;

  v_contract_type := case
    when coalesce(v_job.end_date, v_job.start_date) - v_job.start_date + 1 >= 3
      then 'formal' else 'simple' end;

  insert into public.missions (
    job_id, candidate_id, application_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, break_minutes, contract_type
  ) values (
    v_job.id, v_candidate.id, v_application.id, v_job.start_date,
    v_job.start_time, v_job.end_time, v_job.break_duration_minutes,
    v_contract_type
  )
  returning id into v_mission_id;

  -- Montant du candidat : celui de l'offre, tel quel (jamais multiplié par
  -- la durée ni par le nombre de places). Horaires figés pour information.
  insert into public.contracts (
    application_id, job_id, candidate_id, company_id, contract_template,
    contract_data
  ) values (
    v_application.id, v_job.id, v_candidate.id, v_company.id, v_contract_type,
    jsonb_build_object(
      'job_title', v_job.title,
      'company_name', v_company.company_name,
      'start_date', v_job.start_date,
      'end_date', v_job.end_date,
      'start_time', v_job.start_time,
      'end_time', v_job.end_time,
      'break_minutes', v_job.break_duration_minutes,
      'address', v_job.address,
      'city', v_job.city,
      'mission_pay_per_candidate', v_job.mission_pay_per_candidate,
      'currency', 'XAF',
      'pay_basis', 'per_mission',
      'mission_id', v_mission_id
    )
  )
  returning id into v_contract_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_candidate.user_id,
    'application_update',
    case when v_candidate.locale = 'en' then 'You have been selected'
         else 'Vous êtes sélectionné(e)' end,
    case when v_candidate.locale = 'en'
      then v_company.company_name || ' selected you for "' || v_job.title
           || '" on ' || to_char(v_job.start_date, 'YYYY-MM-DD')
           || '. Your mission and contract have been created.'
      else v_company.company_name || ' vous a sélectionné(e) pour « ' || v_job.title
           || ' » le ' || to_char(v_job.start_date, 'DD/MM/YYYY')
           || '. Votre mission et votre contrat ont été créés.' end,
    jsonb_build_object(
      'job_id', v_job.id,
      'application_id', v_application.id,
      'mission_id', v_mission_id,
      'contract_id', v_contract_id,
      'application_status', 'selected'
    )
  );

  return query select v_application.id, v_application.status,
    v_mission_id, v_contract_id, false;
end;
$$;

revoke all on function public.select_candidate(uuid) from public, anon;
grant execute on function public.select_candidate(uuid) to authenticated;

-- ── 8. Lecture d'une mission : montant figé dans le contrat ─────────
-- Type de retour modifié (hourly_rate → mission_pay_per_candidate,
-- currency) : la fonction est recréée. Montant absent (null) si la mission
-- n'a pas de contrat ; jamais relu depuis l'offre.
drop function if exists public.get_mission(uuid);

create function public.get_mission(p_mission_id uuid)
returns table (
  mission_id uuid,
  application_id uuid,
  job_id uuid,
  viewer_party text,
  status public.mission_status,
  job_title text,
  company_id uuid,
  company_name text,
  address text,
  city text,
  mission_pay_per_candidate integer,
  currency text,
  scheduled_date date,
  scheduled_start_time time,
  scheduled_end_time time,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  start_available_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  contract_id uuid,
  contract_status public.contract_status,
  candidate_signed boolean,
  candidate_reviewed boolean,
  company_reviewed boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_job public.jobs;
  v_party text;
  v_bounds record;
  v_contract record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;

  if exists (select 1 from public.candidate_profiles cp
             where cp.id = v_mission.candidate_id and cp.user_id = v_uid) then
    v_party := 'candidate';
  elsif exists (select 1 from public.company_profiles cp
                where cp.id = v_job.company_id and cp.user_id = v_uid) then
    v_party := 'company';
  else
    raise exception 'mission_not_found';
  end if;

  select * into v_bounds from public.mission_schedule_bounds(
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time);
  select c.id, c.status, c.candidate_signed_at,
         case when jsonb_typeof(c.contract_data -> 'mission_pay_per_candidate') = 'number'
           then (c.contract_data ->> 'mission_pay_per_candidate')::integer end as pay,
         c.contract_data ->> 'currency' as currency
  into v_contract
  from public.contracts c where c.application_id = v_mission.application_id;

  return query select
    v_mission.id, v_mission.application_id, v_mission.job_id, v_party,
    v_mission.status, v_job.title, v_job.company_id,
    (select cp.company_name from public.company_profiles cp where cp.id = v_job.company_id),
    v_job.address, v_job.city, v_contract.pay, v_contract.currency,
    v_mission.scheduled_date, v_mission.scheduled_start_time, v_mission.scheduled_end_time,
    v_bounds.starts_at, v_bounds.ends_at, v_bounds.starts_at - interval '15 minutes',
    v_mission.actual_start_time, v_mission.actual_end_time,
    v_contract.id, v_contract.status, v_contract.candidate_signed_at is not null,
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'candidate' and r.origin = 'mission_flow'),
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'company' and r.origin = 'mission_flow'),
    now();
end;
$$;

revoke all on function public.get_mission(uuid) from public, anon;
grant execute on function public.get_mission(uuid) to authenticated;
