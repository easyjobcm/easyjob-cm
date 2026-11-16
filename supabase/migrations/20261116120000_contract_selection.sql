-- Lot 13 — contrat signé par l'entreprise au moment de la sélection.
-- Non déployée.
--
-- Tables affectées : contracts (privilèges de lecture), job_applications
--   (trigger : présélection retirée), notifications (écrites par la
--   sélection et la signature).
-- Fonctions : contract_proposal_hash, selection_company_of,
--   selection_prepare, contract_selection_preview, contract_select_core,
--   sign_and_select, sign_and_select_observed (nouvelles) ;
--   select_candidate (supprimée) ; contract_sign_core, sign_contract,
--   sign_contract_observed, get_contract, get_mission,
--   company_job_applicants, protect_job_application_writes,
--   withdraw_job_application,
--   rt_on_contracts (remplacées).
--
-- Parcours (PLAN_ACTION.md, lot 13) :
--   1. Aperçu : contract_selection_preview(candidature) refait, sans verrou
--      ni écriture, tous les contrôles de la sélection (identité et droits
--      de l'entreprise, dossier, candidature, offre, échéance, places,
--      conflits de 3 h du lot 12) et renvoie le contrat qui serait créé :
--      candidat (prénom et initiale, F-16), format, conditions (dates,
--      journées, horaires, lieu, montant en XAF) et clauses courantes, avec
--      leur empreinte de proposition. Fermer l'aperçu ne laisse rien :
--      aucune ligne n'a été écrite, la place reste libre.
--   2. « Signer et sélectionner » : sign_and_select(candidature, empreinte)
--      prend les verrous de la sélection du lot 12 (candidature, offre,
--      entreprise en partage, journée, verrou consultatif du candidat),
--      refait les mêmes contrôles sur l'état verrouillé, compare l'empreinte
--      présentée à celle des conditions courantes (terms_mismatch sinon),
--      puis, dans la même transaction : candidature sélectionnée, mission,
--      journées et codes (triggers du lot 12), contrat (clauses figées et
--      terms_hash par trg_protect_contract_writes, lot 7b), contrôle que le
--      contrat inséré porte exactement l'empreinte présentée, signature de
--      l'entreprise (horodatage serveur, empreinte, IP observée par la route
--      ou absente) et notification du candidat. Tout refus annule
--      l'ensemble : ni signature ni engagement partiel.
--      Relance (double clic, réponse perdue) : une candidature déjà
--      sélectionnée renvoie sa mission et son contrat d'origine, sans
--      écriture ; elle ne signe jamais un contrat existant à la place de
--      l'entreprise.
--   3. L'ancien chemin est fermé : select_candidate(uuid) est supprimée ;
--      une sélection passe toujours par la signature de l'entreprise.
--
-- Empreinte de proposition (contract_proposal_hash) : SHA-256 (hex) de
--   { v: 1, kind: 'selection_proposal', application_id, job_id,
--     candidate_id, company_id, template, terms: contract_data sans
--     mission_id } — mêmes parties, format, conditions et clauses que
--   terms_hash (lot 7b), sans les identifiants de contrat et de mission
--   qui n'existent pas encore à l'aperçu. Le consentement porte donc sur le
--   texte exact qui sera figé.
--
-- Confidentialité des signatures : chaque partie ne voit que l'action
--   qu'elle doit accomplir. get_contract et get_mission renvoient
--   viewer_signed (signature du lecteur) au lieu du statut de signature et
--   des horodatages ; company_job_applicants renvoie contract_to_sign
--   (signature attendue de l'entreprise) ; la signature ne renvoie que la
--   partie signataire ; status, *_signed_at, *_terms_hash et updated_at ne
--   sont plus lisibles en session ; la notification d'une signature ne va
--   qu'à une partie qui doit encore signer, sans dire qui a signé ; le
--   signal temps réel d'une signature ne va qu'au signataire. Le détail
--   (horodatages, IP, empreintes acceptées) reste en base pour le support
--   (clé service).
--
-- Présélection retirée : une session ne peut plus écrire 'shortlisted'.
--   Les candidatures déjà présélectionnées restent en l'état (aucune
--   réécriture), consultables, et peuvent être sélectionnées, refusées ou
--   retirées comme une candidature en attente.
--
-- Reprise : aucune donnée modifiée. Les contrats existants gardent leurs
--   conditions, clauses, empreintes et signatures ; un contrat créé avant ce
--   lot sans signature de l'entreprise le reste (aucune signature déduite) :
--   l'entreprise peut le signer elle-même par sign_contract, comme avant.
--
-- Retour arrière (dernier recours, pile non déployée) : recréer
--   select_candidate depuis 20261113120000 ; recréer contract_sign_core,
--   sign_contract, sign_contract_observed et get_contract depuis
--   20261106130000, get_mission et company_job_applicants depuis
--   20261113120000, protect_job_application_writes depuis 20261106120000,
--   rt_on_contracts depuis 20261107150000, et le grant de colonnes de
--   20261106130000 ; puis drop des fonctions nouvelles.

-- ════════════════════════════════════════════════════════════════════
-- 1. Empreinte de proposition
-- ════════════════════════════════════════════════════════════════════
create or replace function public.contract_proposal_hash(
  p_application_id uuid,
  p_job_id uuid,
  p_candidate_id uuid,
  p_company_id uuid,
  p_template text,
  p_terms jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'kind', 'selection_proposal',
    'application_id', p_application_id,
    'job_id', p_job_id,
    'candidate_id', p_candidate_id,
    'company_id', p_company_id,
    'template', p_template,
    'terms', coalesce(p_terms, '{}'::jsonb) - 'mission_id'
  )::text, 'UTF8')), 'hex');
$$;

revoke all on function public.contract_proposal_hash(uuid, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.contract_proposal_hash(uuid, uuid, uuid, uuid, text, jsonb)
  to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. Contrôles et conditions communs à l'aperçu et à la sélection
-- ════════════════════════════════════════════════════════════════════
-- Entreprise active de l'utilisateur (mêmes codes que select_candidate).
create or replace function public.selection_company_of(
  p_uid uuid,
  out id uuid,
  out company_name text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text;
  v_user_active boolean;
  v_company record;
begin
  if p_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.role::text, u.is_active into v_role, v_user_active
  from public.users u where u.id = p_uid;
  if v_role is null or v_role not in ('company', 'company_premium') then
    raise exception 'not_a_company' using errcode = '42501';
  end if;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  select cp.id, cp.company_name, cp.is_active into v_company
  from public.company_profiles cp where cp.user_id = p_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  id := v_company.id;
  company_name := v_company.company_name;
end;
$$;

revoke all on function public.selection_company_of(uuid) from public, anon, authenticated;

-- Contrôles de la sélection (lots 7a, 11, 11b, 12) et contrat qui en
-- résulterait, sans verrou ni écriture. L'appelant qui écrit prend les
-- verrous AVANT l'appel : l'état lu est alors celui qu'il verrouille.
-- Conditions : exactement celles que select_candidate figeait (lot 12),
-- plus les clauses courantes du format (copiées à l'insertion par
-- trg_protect_contract_writes).
create or replace function public.selection_prepare(p_uid uuid, p_application_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_day public.job_days;
  v_candidate record;
  v_days jsonb;
  v_ranges tstzrange[];
  v_count integer;
  v_pay integer;
  v_first record;
  v_last_date date;
  v_template text;
  v_terms jsonb;
  v_clauses jsonb;
begin
  select * into v_company from public.selection_company_of(p_uid);

  select a.* into v_application
  from public.job_applications a where a.id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  select j.* into v_job from public.jobs j where j.id = v_application.job_id;
  if not found or v_job.company_id is distinct from v_company.id then
    raise exception 'application_not_found';
  end if;

  -- Présélection (retirée au lot 13) : une candidature encore
  -- présélectionnée se traite comme une candidature en attente.
  if v_application.status not in ('pending', 'shortlisted') then
    raise exception 'application_not_selectable';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  if not public.company_dossier_valid(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  if v_application.job_day_id is not null then
    select d.* into v_day from public.job_days d
    where d.id = v_application.job_day_id and d.job_id = v_job.id;
    if not found then
      raise exception 'application_not_found';
    end if;
    if v_day.applications_close_at is null or now() >= v_day.applications_close_at then
      raise exception 'recruitment_closed';
    end if;
    if v_day.positions_filled >= coalesce(v_day.positions_available, 1) then
      raise exception 'no_positions';
    end if;
  else
    if v_job.applications_close_at is null or now() >= v_job.applications_close_at then
      raise exception 'recruitment_closed';
    end if;
    if coalesce(v_job.positions_filled, 0) >= coalesce(v_job.positions_available, 1) then
      raise exception 'no_positions';
    end if;
  end if;

  select cp.id, cp.user_id, cp.first_name, cp.last_name, u.is_active,
         u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_application.candidate_id;
  if not found or v_candidate.is_active is false then
    raise exception 'candidate_unavailable';
  end if;

  if v_application.job_day_id is not null then
    v_days := jsonb_build_array(jsonb_build_object(
      'job_day_id', v_day.id, 'date', v_day.day_date,
      'start_time', v_day.start_time, 'end_time', v_day.end_time,
      'starts_at', v_day.starts_at, 'ends_at', v_day.ends_at));
    v_ranges := array[tstzrange(v_day.starts_at, v_day.ends_at)];
    v_pay := v_day.mission_pay_per_candidate;
  else
    select jsonb_agg(jsonb_build_object(
             'job_day_id', e.day_id, 'date', e.day_date,
             'start_time', e.start_time, 'end_time', e.end_time,
             'starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.starts_at),
           array_agg(tstzrange(e.starts_at, e.ends_at) order by e.starts_at)
    into v_days, v_ranges
    from public.job_effective_days(v_job.id) e;
    if v_days is null then
      raise exception 'job_days_missing';
    end if;
    v_pay := v_job.mission_pay_per_candidate;
  end if;

  -- Aucun détail des autres engagements n'est renvoyé à l'entreprise.
  if cardinality(public.candidate_schedule_conflicts(v_candidate.id, v_ranges)) > 0 then
    raise exception 'candidate_schedule_conflict';
  end if;

  v_count := jsonb_array_length(v_days);
  -- SRS §6.7 : 3 journées travaillées ou plus → formalisé.
  v_template := case when v_count >= 3 then 'formal' else 'simple' end;

  select (x ->> 'date')::date as d, (x ->> 'start_time')::time as st,
         (x ->> 'end_time')::time as et
  into v_first
  from jsonb_array_elements(v_days) with ordinality t(x, ord) where t.ord = 1;
  v_last_date := (v_days -> (v_count - 1) ->> 'date')::date;

  v_clauses := public.current_contract_clauses(v_template);
  if v_clauses is null then
    raise exception 'contracts: no clause version for template %', v_template
      using errcode = '23514';
  end if;

  v_terms := jsonb_build_object(
    'job_title', v_job.title,
    'company_name', v_company.company_name,
    'schedule_format', v_job.schedule_format,
    'start_date', v_first.d,
    'end_date', v_last_date,
    'start_time', v_first.st,
    'end_time', v_first.et,
    'day_count', v_count,
    'days', (select jsonb_agg(t.x - 'job_day_id' order by t.ord)
             from jsonb_array_elements(v_days) with ordinality t(x, ord)),
    'break_minutes', v_job.break_duration_minutes,
    'address', v_job.address,
    'city', v_job.city,
    'mission_pay_per_candidate', v_pay,
    'currency', 'XAF',
    'pay_basis', 'per_mission',
    'clauses', v_clauses
  );

  return jsonb_build_object(
    'application_id', v_application.id,
    'job_id', v_job.id,
    'job_day_id', v_application.job_day_id,
    'job_title', v_job.title,
    'company_id', v_company.id,
    'company_name', v_company.company_name,
    'candidate_id', v_candidate.id,
    'candidate_user_id', v_candidate.user_id,
    'candidate_locale', v_candidate.locale,
    'candidate_name', nullif(btrim(concat_ws(' ', v_candidate.first_name,
        nullif(upper(left(btrim(coalesce(v_candidate.last_name, '')), 1)) || '.', '.'))), ''),
    'template', v_template,
    'days', v_days,
    'day_count', v_count,
    'first_date', v_first.d,
    'first_start', v_first.st,
    'first_end', v_first.et,
    'last_date', v_last_date,
    'break_minutes', v_job.break_duration_minutes,
    'terms', v_terms,
    'proposal_hash', public.contract_proposal_hash(
      v_application.id, v_job.id, v_candidate.id, v_company.id, v_template, v_terms)
  );
end;
$$;

revoke all on function public.selection_prepare(uuid, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. Aperçu du contrat proposé (lecture seule)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.contract_selection_preview(p_application_id uuid)
returns table (
  application_id uuid,
  job_id uuid,
  job_day_id uuid,
  candidate_name text,
  company_name text,
  contract_template text,
  terms jsonb,
  terms_hash text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
begin
  v_p := public.selection_prepare(auth.uid(), p_application_id);
  return query select
    (v_p ->> 'application_id')::uuid,
    (v_p ->> 'job_id')::uuid,
    (v_p ->> 'job_day_id')::uuid,
    v_p ->> 'candidate_name',
    v_p ->> 'company_name',
    v_p ->> 'template',
    v_p -> 'terms',
    v_p ->> 'proposal_hash';
end;
$$;

revoke all on function public.contract_selection_preview(uuid) from public, anon;
grant execute on function public.contract_selection_preview(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Signer et sélectionner
-- ════════════════════════════════════════════════════════════════════
-- Noyau, jamais exposé : p_uid vient de auth.uid() (sign_and_select) ou de
-- la session vérifiée par la route (sign_and_select_observed).
create or replace function public.contract_select_core(
  p_uid uuid,
  p_application_id uuid,
  p_terms_hash text,
  p_observed_ip text
)
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
  v_company record;
  v_application public.job_applications;
  v_job public.jobs;
  v_p jsonb;
  v_hash text := lower(btrim(coalesce(p_terms_hash, '')));
  v_mission_id uuid;
  v_contract public.contracts;
  v_contract_id uuid;
  v_ip text;
  v_count integer;
  v_first date;
  v_last date;
  v_locale text;
  v_company_name text;
  v_title text;
begin
  select * into v_company from public.selection_company_of(p_uid);

  -- Verrous dans l'ordre de select_candidate (lots 7a à 12) : candidature,
  -- offre, entreprise (partage), journée, puis candidat (consultatif).
  select a.* into v_application
  from public.job_applications a where a.id = p_application_id
  for update;
  if not found then
    raise exception 'application_not_found';
  end if;

  select j.* into v_job
  from public.jobs j where j.id = v_application.job_id
  for update;
  if not found or v_job.company_id is distinct from v_company.id then
    raise exception 'application_not_found';
  end if;

  -- Relance : résultat d'origine, sans écriture ni signature.
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

  perform 1 from public.company_profiles cp where cp.id = v_company.id for share;
  if v_application.job_day_id is not null then
    perform 1 from public.job_days d
    where d.id = v_application.job_day_id and d.job_id = v_job.id
    for update;
  end if;
  -- Deux entreprises qui sélectionnent ce candidat au même moment
  -- s'attendent ici ; la seconde relit les engagements validés.
  perform public.lock_candidate_engagements(v_application.candidate_id);

  -- Mêmes contrôles que l'aperçu, sur l'état verrouillé.
  v_p := public.selection_prepare(p_uid, p_application_id);

  -- Le consentement porte sur les conditions présentées : si elles ont
  -- changé depuis l'aperçu (offre, clauses), rien n'est écrit.
  if v_hash is distinct from v_p ->> 'proposal_hash' then
    raise exception 'terms_mismatch';
  end if;

  update public.job_applications a
  set status = 'selected', selected_at = now(), selected_by = p_uid
  where a.id = v_application.id
  returning a.* into v_application;

  insert into public.missions (
    job_id, candidate_id, application_id, scheduled_date,
    scheduled_start_time, scheduled_end_time, break_minutes, contract_type
  ) values (
    v_job.id, v_application.candidate_id, v_application.id,
    (v_p ->> 'first_date')::date, (v_p ->> 'first_start')::time,
    (v_p ->> 'first_end')::time, (v_p ->> 'break_minutes')::integer,
    v_p ->> 'template'
  )
  returning id into v_mission_id;

  -- Journées suivantes d'une période complète (la première est créée par
  -- trg_create_mission_first_day) ; un code par journée (trigger).
  insert into public.mission_days (
    mission_id, job_day_id, scheduled_date, scheduled_start_time, scheduled_end_time,
    starts_at, ends_at
  )
  select v_mission_id, nullif(x ->> 'job_day_id', '')::uuid, (x ->> 'date')::date,
         (x ->> 'start_time')::time, (x ->> 'end_time')::time,
         now(), now() + interval '1 second'
  from jsonb_array_elements(v_p -> 'days') with ordinality t(x, ord)
  where t.ord > 1;

  -- Clauses copiées et terms_hash calculé par trg_protect_contract_writes.
  insert into public.contracts (
    application_id, job_id, candidate_id, company_id, contract_template,
    contract_data
  ) values (
    v_application.id, v_job.id, v_application.candidate_id, v_company.id,
    v_p ->> 'template',
    ((v_p -> 'terms') - 'clauses') || jsonb_build_object('mission_id', v_mission_id)
  )
  returning * into v_contract;

  -- Le contrat enregistré est exactement celui que l'entreprise a lu.
  if public.contract_proposal_hash(
       v_contract.application_id, v_contract.job_id, v_contract.candidate_id,
       v_contract.company_id, v_contract.contract_template, v_contract.contract_data)
     is distinct from v_hash then
    raise exception 'terms_mismatch';
  end if;

  begin
    v_ip := case when length(p_observed_ip) <= 64
                 then host(btrim(p_observed_ip)::inet) end;
  exception when others then
    v_ip := null;
  end;

  update public.contracts c
  set company_signed_at = now(),
      company_signed_by = p_uid,
      company_ip = v_ip,
      company_terms_hash = c.terms_hash,
      status = public.contract_expected_status(c.candidate_signed_at, now())
  where c.id = v_contract.id;

  v_count := (v_p ->> 'day_count')::integer;
  v_first := (v_p ->> 'first_date')::date;
  v_last := (v_p ->> 'last_date')::date;
  v_locale := v_p ->> 'candidate_locale';
  v_company_name := coalesce(v_p ->> 'company_name', '');
  v_title := coalesce(v_p ->> 'job_title', '');

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    (v_p ->> 'candidate_user_id')::uuid,
    'application_update',
    case when v_locale = 'en' then 'You have been selected'
         else 'Vous êtes sélectionné(e)' end,
    case when v_locale = 'en'
      then v_company_name || ' selected you for "' || v_title || '" '
           || case when v_count > 1
                then 'from ' || to_char(v_first, 'YYYY-MM-DD') || ' to '
                     || to_char(v_last, 'YYYY-MM-DD') || ' (' || v_count || ' days)'
                else 'on ' || to_char(v_first, 'YYYY-MM-DD') end
           || '. Sign your contract from your tasks.'
      else v_company_name || ' vous a sélectionné(e) pour « ' || v_title || ' » '
           || case when v_count > 1
                then 'du ' || to_char(v_first, 'DD/MM/YYYY') || ' au '
                     || to_char(v_last, 'DD/MM/YYYY') || ' (' || v_count || ' journées)'
                else 'le ' || to_char(v_first, 'DD/MM/YYYY') end
           || '. Signez votre contrat depuis vos tâches.' end,
    jsonb_build_object(
      'job_id', v_job.id,
      'application_id', v_application.id,
      'mission_id', v_mission_id,
      'contract_id', v_contract.id,
      'application_status', 'selected'
    )
  );

  return query select v_application.id, v_application.status,
    v_mission_id, v_contract.id, false;
end;
$$;

revoke all on function public.contract_select_core(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Appel direct en session : identité = auth.uid(), aucune IP acceptée.
create or replace function public.sign_and_select(
  p_application_id uuid,
  p_terms_hash text
)
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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return query select s.* from public.contract_select_core(
    auth.uid(), p_application_id, p_terms_hash, null) s;
end;
$$;

revoke all on function public.sign_and_select(uuid, text) from public, anon;
grant execute on function public.sign_and_select(uuid, text) to authenticated;

-- Route de l'application (clé service) : utilisateur de la session vérifiée
-- par auth.getUser(), IP observée par l'infrastructure ou null.
create or replace function public.sign_and_select_observed(
  p_user_id uuid,
  p_application_id uuid,
  p_terms_hash text,
  p_observed_ip text default null
)
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
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return query select s.* from public.contract_select_core(
    p_user_id, p_application_id, p_terms_hash, p_observed_ip) s;
end;
$$;

revoke all on function public.sign_and_select_observed(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sign_and_select_observed(uuid, uuid, text, text)
  to service_role;

-- Ancien chemin : sélection sans signature de l'entreprise.
drop function if exists public.select_candidate(uuid);

-- ════════════════════════════════════════════════════════════════════
-- 5. Présélection retirée des écritures en session
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261106120000 ; seule différence : le refus est la seule
-- décision écrite directement par l'entreprise.
create or replace function public.protect_job_application_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'job_applications: use apply_to_job / withdraw_job_application'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - array['status', 'selected_at', 'selected_by', 'rejection_reason', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'selected_at', 'selected_by', 'rejection_reason', 'updated_at'])
  then
    raise exception 'job_applications: identity, job and internal columns are read-only'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.candidate_profiles cp
    where cp.id = old.candidate_id and cp.user_id = (select auth.uid())
  ) then
    raise exception 'job_applications: candidates cannot update their application directly'
      using errcode = '42501';
  end if;

  if old.status = 'withdrawn' then
    raise exception 'job_applications: application was withdrawn'
      using errcode = '42501';
  end if;
  if old.status in ('selected', 'no_show') then
    raise exception 'job_applications: selected applications change through support only'
      using errcode = '42501';
  end if;
  -- Lot 13 : plus de présélection ; une candidature encore présélectionnée
  -- peut être refusée (ou sélectionnée par sign_and_select).
  if new.status is distinct from old.status
     and new.status is distinct from 'rejected' then
    raise exception 'job_applications: use sign_and_select to select'
      using errcode = '42501';
  end if;
  if new.selected_at is distinct from old.selected_at
     or new.selected_by is distinct from old.selected_by then
    raise exception 'job_applications: use sign_and_select to select'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_job_application_writes() from public, anon, authenticated;

-- Retrait (reprise de 20261113120000) : une candidature encore
-- présélectionnée se retire comme une candidature en attente.
create or replace function public.withdraw_job_application(
  p_job_id uuid,
  p_application_id uuid default null
)
returns public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.job_applications;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select a.* into v_application
  from public.job_applications a
  join public.candidate_profiles cp on cp.id = a.candidate_id
  where a.job_id = p_job_id and cp.user_id = v_uid
    and (case when p_application_id is null then a.job_day_id is null
              else a.id = p_application_id end)
  for update of a;

  if not found then
    raise exception 'application_not_found';
  end if;
  if v_application.status = 'withdrawn' then
    return v_application;
  end if;
  if v_application.status not in ('pending', 'shortlisted') then
    raise exception 'application_not_withdrawable';
  end if;

  update public.job_applications
  set status = 'withdrawn'
  where id = v_application.id
  returning * into v_application;

  return v_application;
end;
$$;
revoke all on function public.withdraw_job_application(uuid, uuid) from public, anon;
grant execute on function public.withdraw_job_application(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Signature : réponse et notification limitées à la partie concernée
-- ════════════════════════════════════════════════════════════════════
drop function if exists public.sign_contract(uuid, text);
drop function if exists public.sign_contract_observed(uuid, uuid, text, text);
drop function if exists public.contract_sign_core(uuid, uuid, text, text);

-- Reprise de 20261106130000 : mêmes contrôles et écritures ; la réponse ne
-- contient plus l'état de l'autre partie, et la notification ne va qu'à une
-- partie dont la signature est encore attendue (sans dire qui a signé).
create function public.contract_sign_core(
  p_uid uuid,
  p_contract_id uuid,
  p_terms_hash text,
  p_observed_ip text
)
returns table (
  contract_id uuid,
  signed_party text,
  already_signed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := p_uid;
  v_user_active boolean;
  v_contract public.contracts;
  v_party text;
  v_party_active boolean;
  v_ip text;
  v_candidate record;
  v_company record;
  v_application_status public.application_status;
  v_notify_user uuid;
  v_notify_locale text;
  v_other_signed boolean;
  v_job_title text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select c.* into v_contract
  from public.contracts c where c.id = p_contract_id
  for update;
  if not found then
    raise exception 'contract_not_found';
  end if;

  select cp.user_id, u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_contract.candidate_id;
  select cp.user_id, cp.is_active, u.locale::text as locale
  into v_company
  from public.company_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_contract.company_id;

  if v_candidate.user_id = v_uid then
    v_party := 'candidate';
    v_party_active := true;
  elsif v_company.user_id = v_uid then
    v_party := 'company';
    v_party_active := v_company.is_active is not false;
  else
    raise exception 'contract_not_found';
  end if;

  -- Relance (double clic, réponse perdue) : sans écriture.
  if (v_party = 'candidate' and v_contract.candidate_signed_at is not null)
     or (v_party = 'company' and v_contract.company_signed_at is not null) then
    return query select v_contract.id, v_party, true;
    return;
  end if;

  if not v_party_active then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  if v_contract.status in ('rejected', 'expired') then
    raise exception 'contract_not_signable';
  end if;

  if jsonb_typeof(v_contract.contract_data->'clauses') is distinct from 'object'
     or v_contract.terms_hash is distinct from public.contract_terms_hash(v_contract)
     or (v_contract.candidate_signed_at is not null
         and v_contract.candidate_terms_hash is distinct from v_contract.terms_hash)
     or (v_contract.company_signed_at is not null
         and v_contract.company_terms_hash is distinct from v_contract.terms_hash)
     or coalesce(v_contract.status, 'pending') is distinct from
        public.contract_expected_status(v_contract.candidate_signed_at,
                                        v_contract.company_signed_at)
  then
    raise exception 'contract_needs_review';
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_contract.application_id;
  if v_application_status is distinct from 'selected' then
    raise exception 'contract_not_signable';
  end if;

  if p_terms_hash is null or lower(btrim(p_terms_hash)) is distinct from v_contract.terms_hash then
    raise exception 'terms_mismatch';
  end if;

  begin
    v_ip := case when length(p_observed_ip) <= 64
                 then host(btrim(p_observed_ip)::inet) end;
  exception when others then
    v_ip := null;
  end;

  if v_party = 'candidate' then
    update public.contracts c
    set candidate_signed_at = now(),
        candidate_signed_by = v_uid,
        candidate_ip = v_ip,
        candidate_terms_hash = c.terms_hash,
        status = public.contract_expected_status(now(), c.company_signed_at)
    where c.id = v_contract.id
    returning c.* into v_contract;
    v_other_signed := v_contract.company_signed_at is not null;
    v_notify_user := v_company.user_id;
    v_notify_locale := v_company.locale;
  else
    update public.contracts c
    set company_signed_at = now(),
        company_signed_by = v_uid,
        company_ip = v_ip,
        company_terms_hash = c.terms_hash,
        status = public.contract_expected_status(c.candidate_signed_at, now())
    where c.id = v_contract.id
    returning c.* into v_contract;
    v_other_signed := v_contract.candidate_signed_at is not null;
    v_notify_user := v_candidate.user_id;
    v_notify_locale := v_candidate.locale;
  end if;

  -- Seule une action encore attendue est notifiée.
  if v_notify_user is not null and not v_other_signed then
    v_job_title := coalesce(v_contract.contract_data->>'job_title', '');
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_notify_user,
      'mission_update',
      case when v_notify_locale = 'en' then 'Contract to sign'
           else 'Contrat à signer' end,
      case when v_notify_locale = 'en'
        then 'Your signature is awaited for the contract "' || v_job_title || '".'
        else 'Votre signature est attendue pour le contrat « ' || v_job_title || ' ».' end,
      jsonb_build_object(
        'contract_id', v_contract.id,
        'application_id', v_contract.application_id,
        'job_id', v_contract.job_id,
        'mission_id', v_contract.contract_data->>'mission_id'
      )
    );
  end if;

  return query select v_contract.id, v_party, false;
end;
$$;

revoke all on function public.contract_sign_core(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.sign_contract(
  p_contract_id uuid,
  p_terms_hash text
)
returns table (
  contract_id uuid,
  signed_party text,
  already_signed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return query select s.* from public.contract_sign_core(
    auth.uid(), p_contract_id, p_terms_hash, null) s;
end;
$$;

revoke all on function public.sign_contract(uuid, text) from public, anon;
grant execute on function public.sign_contract(uuid, text) to authenticated;

create function public.sign_contract_observed(
  p_user_id uuid,
  p_contract_id uuid,
  p_terms_hash text,
  p_observed_ip text default null
)
returns table (
  contract_id uuid,
  signed_party text,
  already_signed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return query select s.* from public.contract_sign_core(
    p_user_id, p_contract_id, p_terms_hash, p_observed_ip) s;
end;
$$;

revoke all on function public.sign_contract_observed(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sign_contract_observed(uuid, uuid, text, text)
  to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 7. Lectures limitées à l'action du lecteur
-- ════════════════════════════════════════════════════════════════════
-- Colonnes lisibles en session : plus de statut de signature, d'horodatage,
-- d'empreinte acceptée ni de date de mise à jour (qui trahirait une
-- signature).
revoke select on table public.contracts from anon, authenticated;
grant select (
  id, application_id, job_id, candidate_id, company_id, contract_template,
  contract_data, terms_hash, final_contract_url, expires_at, created_at
) on table public.contracts to authenticated;

drop function if exists public.get_contract(uuid);
create function public.get_contract(p_contract_id uuid)
returns table (
  contract_id uuid,
  application_id uuid,
  mission_id uuid,
  job_id uuid,
  viewer_party text,
  contract_template text,
  terms jsonb,
  terms_hash text,
  company_name text,
  candidate_name text,
  viewer_signed boolean,
  needs_review boolean,
  can_sign boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_contract public.contracts;
  v_party text;
  v_review boolean;
  v_signed boolean;
  v_candidate record;
  v_company_name text;
  v_mission_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_contract from public.contracts c where c.id = p_contract_id;
  if not found then
    raise exception 'contract_not_found';
  end if;

  if exists (select 1 from public.candidate_profiles cp
             where cp.id = v_contract.candidate_id and cp.user_id = v_uid) then
    v_party := 'candidate';
  elsif exists (select 1 from public.company_profiles cp
                where cp.id = v_contract.company_id and cp.user_id = v_uid) then
    v_party := 'company';
  else
    -- Contrat d'un tiers : même réponse qu'inexistant.
    raise exception 'contract_not_found';
  end if;

  v_review :=
    jsonb_typeof(v_contract.contract_data->'clauses') is distinct from 'object'
    or v_contract.terms_hash is distinct from public.contract_terms_hash(v_contract)
    or (v_contract.candidate_signed_at is not null
        and v_contract.candidate_terms_hash is distinct from v_contract.terms_hash)
    or (v_contract.company_signed_at is not null
        and v_contract.company_terms_hash is distinct from v_contract.terms_hash)
    or (coalesce(v_contract.status, 'pending') not in ('rejected', 'expired')
        and coalesce(v_contract.status, 'pending') is distinct from
            public.contract_expected_status(v_contract.candidate_signed_at,
                                            v_contract.company_signed_at));
  v_signed := case when v_party = 'candidate'
                then v_contract.candidate_signed_at is not null
                else v_contract.company_signed_at is not null end;

  select cp.first_name, cp.last_name into v_candidate
  from public.candidate_profiles cp where cp.id = v_contract.candidate_id;

  v_company_name := nullif(btrim(coalesce(v_contract.contract_data->>'company_name', '')), '');
  if v_company_name is null then
    select cp.company_name into v_company_name
    from public.company_profiles cp where cp.id = v_contract.company_id;
  end if;

  select m.id into v_mission_id from public.missions m
  where m.application_id = v_contract.application_id;

  return query select
    v_contract.id,
    v_contract.application_id,
    v_mission_id,
    v_contract.job_id,
    v_party,
    v_contract.contract_template,
    coalesce(v_contract.contract_data, '{}'::jsonb) - 'mission_id',
    v_contract.terms_hash,
    v_company_name,
    case when v_party = 'candidate'
      then nullif(btrim(concat_ws(' ', v_candidate.first_name, v_candidate.last_name)), '')
      else nullif(btrim(concat_ws(' ', v_candidate.first_name,
             nullif(upper(left(btrim(coalesce(v_candidate.last_name, '')), 1)) || '.', '.'))), '')
    end,
    v_signed,
    v_review,
    not v_review and not v_signed
      and coalesce(v_contract.status, 'pending') in ('pending', 'candidate_signed', 'company_signed'),
    v_contract.created_at;
end;
$$;

revoke all on function public.get_contract(uuid) from public, anon;
grant execute on function public.get_contract(uuid) to authenticated;

-- Reprise de 20261113120000 : contract_status et candidate_signed
-- remplacés par contract_viewer_signed (signature du lecteur seulement).
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
  contract_viewer_signed boolean,
  candidate_reviewed boolean,
  company_reviewed boolean,
  schedule_format text,
  days jsonb,
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

  select min(d.starts_at) as starts_at, max(d.ends_at) as ends_at into v_bounds
  from public.mission_days d where d.mission_id = v_mission.id;
  select c.id,
         case when v_party = 'candidate' then c.candidate_signed_at is not null
              else c.company_signed_at is not null end as viewer_signed,
         case when jsonb_typeof(c.contract_data -> 'mission_pay_per_candidate') = 'number'
           then (c.contract_data ->> 'mission_pay_per_candidate')::integer end as pay,
         c.contract_data ->> 'currency' as currency,
         coalesce(c.contract_data ->> 'schedule_format', 'full_period') as format
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
    v_contract.id, v_contract.viewer_signed,
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'candidate' and r.origin = 'mission_flow'),
    exists (select 1 from public.reviews r where r.mission_id = v_mission.id
            and r.reviewer_type = 'company' and r.origin = 'mission_flow'),
    coalesce(v_contract.format, v_job.schedule_format),
    public.mission_days_json(v_mission.id),
    now();
end;
$$;
revoke all on function public.get_mission(uuid) from public, anon;
grant execute on function public.get_mission(uuid) to authenticated;

-- Reprise de 20261113120000, plus le contrat de la candidature et la
-- signature attendue de l'entreprise (contrats créés avant ce lot).
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
  reputation_stars numeric,
  skills text[],
  job_day_id uuid,
  day_date date,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  contract_id uuid,
  contract_to_sign boolean
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
         public.reputation_stars_for('candidate', c.id),
         coalesce((select array_agg(s.skill_name order by s.skill_name)
                   from public.candidate_skills s
                   where s.candidate_id = c.id), '{}'::text[]),
         d.id, d.day_date, d.starts_at, d.ends_at,
         k.id,
         k.id is not null and k.company_signed_at is null
           and coalesce(k.status, 'pending') not in ('rejected', 'expired')
  from public.job_applications a
  join public.candidate_profiles c on c.id = a.candidate_id
  left join public.job_days d on d.id = a.job_day_id
  left join public.contracts k on k.application_id = a.id
  where a.job_id = p_job_id
  order by d.starts_at nulls first, a.match_score desc nulls last, a.created_at;
end;
$$;
revoke all on function public.company_job_applicants(uuid) from public, anon;
grant execute on function public.company_job_applicants(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Temps réel : une signature n'est signalée qu'au signataire
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261107150000. Création, refus ou expiration : les deux
-- parties. Signature d'une seule partie : ses seules sessions (ses écrans
-- retirent l'action « Signer ») ; l'autre partie n'en est pas informée.
create or replace function public.rt_on_contracts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.contracts := case when tg_op = 'DELETE' then old else new end;
  v_candidate_changed boolean := false;
  v_company_changed boolean := false;
  v_other_changed boolean := tg_op <> 'UPDATE';
begin
  if tg_op = 'UPDATE' then
    v_candidate_changed := new.candidate_signed_at is distinct from old.candidate_signed_at;
    v_company_changed := new.company_signed_at is distinct from old.company_signed_at;
    v_other_changed :=
      (to_jsonb(new) - array['candidate_signed_at', 'candidate_signed_by', 'candidate_ip',
                             'candidate_terms_hash', 'company_signed_at', 'company_signed_by',
                             'company_ip', 'company_terms_hash', 'status', 'updated_at'])
      is distinct from
      (to_jsonb(old) - array['candidate_signed_at', 'candidate_signed_by', 'candidate_ip',
                             'candidate_terms_hash', 'company_signed_at', 'company_signed_by',
                             'company_ip', 'company_terms_hash', 'status', 'updated_at'])
      or (new.status in ('rejected', 'expired') and new.status is distinct from old.status);
  end if;

  if v_other_changed then
    perform public.rt_signal_users(
      array[public.rt_candidate_user(v_row.candidate_id),
            public.rt_company_user(v_row.company_id)],
      'contracts', v_row.id);
    return null;
  end if;
  if v_candidate_changed then
    perform public.rt_signal_users(
      array[public.rt_candidate_user(v_row.candidate_id)], 'contracts', v_row.id);
  end if;
  if v_company_changed then
    perform public.rt_signal_users(
      array[public.rt_company_user(v_row.company_id)], 'contracts', v_row.id);
  end if;
  return null;
end;
$$;

revoke all on function public.rt_on_contracts() from public, anon, authenticated;
