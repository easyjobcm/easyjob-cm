-- Migration : visibilité et disponibilité des offres selon le dossier entreprise (lot 11)
-- Date : 2026-11-11
-- Tables affectées : jobs (politique SELECT), company_profiles (trigger Realtime)
-- Fonctions : company_dossier_valid, candidate_applied_to_job, job_availability,
--             company_verification_complete (reprise), rt_on_company_dossier ;
--             apply_to_job, select_candidate (reprises : seul le contrôle du
--             dossier sous verrou est ajouté)
--
-- Décision produit (2026-11-11) : quand une entreprise perd la validation
-- complète de son dossier (remise en revue, correction demandée) :
--   - ses offres actives disparaissent des recherches, listes et liens
--     directs pour les nouveaux candidats (politique SELECT de jobs) ;
--   - toute nouvelle candidature (apply_to_job → job_not_available) et toute
--     nouvelle sélection (select_candidate → company_not_verified) sont
--     refusées ;
--   - les candidatures existantes restent lisibles par leurs candidats et
--     par l'entreprise ; le retrait suit les règles existantes ;
--   - missions, contrats et engagements existants sont conservés avec leurs
--     actions (signature, début, code, avis) : aucune RPC de mission ou de
--     contrat n'est modifiée ;
--   - le statut métier de l'offre n'est pas modifié (ni cancelled, ni
--     rejected, ni suppression) : la visibilité et la disponibilité sont
--     calculées à partir du dossier.
-- La suspension d'un compte garde ses propres règles : company_dossier_valid
-- ne lit ni users.is_active ni company_profiles.is_active.
--
-- Retour après validation (décision validée le 2026-11-11) : une offre
-- redevient visible dès que le dossier est de nouveau valide, sans nouvelle
-- modération, seulement si elle est toujours admissible selon les règles
-- existantes (statut active, places, date de la liste, restrictions du
-- compte). Une offre modifiée repasse en modération (update_job) : aucune
-- ancienne approbation n'est réutilisée (AUDIT.md §29).
--
-- Concurrence : apply_to_job (offre FOR SHARE puis entreprise FOR SHARE) et
-- select_candidate (candidature, offre FOR UPDATE, puis entreprise FOR SHARE)
-- lisent le dossier après avoir verrouillé la ligne entreprise. Une remise en
-- revue (UPDATE de company_profiles) attend la fin d'une candidature ou d'une
-- sélection déjà engagée, dont les effets sont conservés ; une candidature ou
-- une sélection engagée après la remise en revue attend son commit puis est
-- refusée. Aucune remise en revue ne verrouille d'offre : pas de cycle.
-- La relance d'une sélection déjà réussie reste traitée avant ce contrôle :
-- même résultat, aucun nouvel engagement.
--
-- Rollback : reprendre apply_to_job (20261110120000), select_candidate
-- (20261107120000), la politique « Published jobs are viewable by all »
-- (status = 'active' ou entreprise propriétaire) et
-- company_verification_complete (20261111120000) ; supprimer le trigger
-- trg_rt_company_dossier et les fonctions ajoutées.

-- ── 1. Dossier valide (sans les règles de suspension) ─────────────
create or replace function public.company_dossier_valid(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.company_profiles;
begin
  select * into v_company from public.company_profiles cp where cp.id = p_company_id;
  if not found then
    return false;
  end if;
  return v_company.verification_status = 'verified'
     and cardinality(public.company_dossier_missing(v_company)) = 0
     and (select status from public.company_check_status(v_company, 'rccm')) = 'approved'
     and (select status from public.company_check_status(v_company, 'niu')) = 'approved'
     and (select status from public.company_check_status(v_company, 'representative')) = 'approved';
end;
$$;
-- Évaluée par la politique SELECT de jobs, donc exécutable par tout appelant ;
-- ne renvoie qu'un booléen déjà déductible de la visibilité des offres.
revoke all on function public.company_dossier_valid(uuid) from public;
grant execute on function public.company_dossier_valid(uuid) to anon, authenticated;

-- Droit de publier : dossier valide + comptes actifs (inchangé sur le fond).
create or replace function public.company_verification_complete(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_active boolean;
  v_user_active boolean;
  v_role text;
begin
  select cp.is_active, u.is_active, u.role::text
  into v_company_active, v_user_active, v_role
  from public.company_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_company_id;
  if not found then
    return false;
  end if;
  return v_company_active is not false
     and v_user_active is not false
     and v_role in ('company', 'company_premium')
     and public.company_dossier_valid(p_company_id);
end;
$$;
revoke all on function public.company_verification_complete(uuid) from public, anon, authenticated;

-- ── 2. Candidat ayant déjà postulé ───────────────────────────────
-- SECURITY DEFINER : la politique de jobs ne peut pas lire job_applications
-- directement (ses politiques lisent jobs : récursion).
create or replace function public.candidate_applied_to_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_applications ja
    join public.candidate_profiles cp on cp.id = ja.candidate_id
    where ja.job_id = p_job_id
      and cp.user_id = (select auth.uid())
  );
$$;
revoke all on function public.candidate_applied_to_job(uuid) from public;
grant execute on function public.candidate_applied_to_job(uuid) to anon, authenticated;

-- ── 3. Lecture des offres ────────────────────────────────────────
-- Offre active : visible si le dossier de l'entreprise est valide, ou par un
-- candidat qui y a déjà postulé (candidature consultable). L'entreprise
-- propriétaire et les admins (politique distincte) gardent leur accès. Les
-- offres non actives gardent la règle antérieure (propriétaire seulement).
drop policy if exists "Published jobs are viewable by all" on public.jobs;
create policy "Published jobs are viewable by all" on public.jobs
  for select
  using (
    (status = 'active'::public.job_status
     and (public.company_dossier_valid(company_id)
          or public.candidate_applied_to_job(id)))
    or company_id in (
      select company_profiles.id from public.company_profiles
      where company_profiles.user_id = (select auth.uid()))
  );

-- Disponibilité d'une offre pour l'écran de détail : un lien direct vers une
-- offre masquée affiche « indisponible » sans aucune donnée de l'offre.
create or replace function public.job_availability(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when j.id is null or j.status is distinct from 'active' then 'not_found'
    when public.company_dossier_valid(j.company_id) then 'available'
    else 'unavailable' end
  from (select 1) one
  left join public.jobs j on j.id = p_job_id;
$$;
revoke all on function public.job_availability(uuid) from public;
grant execute on function public.job_availability(uuid) to anon, authenticated;

-- ── 4. Signaux Realtime ──────────────────────────────────────────
-- Changement de statut du dossier : les listes publiques, les candidats
-- ayant postulé et l'entreprise relisent ses offres actives. Charge { d, r }.
create or replace function public.rt_on_company_dossier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
begin
  if new.verification_status is distinct from old.verification_status then
    for v_job in
      select j.id from public.jobs j
      where j.company_id = new.id and j.status = 'active'
    loop
      perform public.rt_signal_public_jobs(v_job);
      perform public.rt_signal_users(
        array(select cp.user_id
              from public.job_applications ja
              join public.candidate_profiles cp on cp.id = ja.candidate_id
              where ja.job_id = v_job),
        'jobs', v_job);
    end loop;
    perform public.rt_signal_users(array[new.user_id], 'jobs', null);
  end if;
  return null;
end;
$$;
revoke all on function public.rt_on_company_dossier() from public, anon, authenticated;

drop trigger if exists trg_rt_company_dossier on public.company_profiles;
-- Sans liste de colonnes : « UPDATE OF » ne voit que les colonnes du SET,
-- or la remise en revue change le statut dans le trigger BEFORE du lot 5b.
create trigger trg_rt_company_dossier
  after update on public.company_profiles
  for each row
  when (old.verification_status is distinct from new.verification_status)
  execute function public.rt_on_company_dossier();

-- ── 5. Candidature et sélection ──────────────────────────────────

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
  select j.id, j.status, j.positions_available, j.positions_filled, j.company_id
  into v_job
  from public.jobs j where j.id = p_job_id
  for share;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  -- Lot 11 : dossier de l'entreprise valide, lu sous verrou partagé de sa
  -- ligne (ordre : offre puis entreprise). Une remise en revue concurrente
  -- attend cette candidature, ou cette candidature attend la remise en revue
  -- puis est refusée.
  perform 1 from public.company_profiles cp where cp.id = v_job.company_id for share;
  if not public.company_dossier_valid(v_job.company_id) then
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
  -- Lot 11 : dossier valide, lu sous verrou partagé de la ligne entreprise
  -- (ordre : candidature, offre, entreprise). Après la relance idempotente
  -- ci-dessus : une sélection déjà réussie garde son résultat.
  perform 1 from public.company_profiles cp where cp.id = v_company.id for share;
  if not public.company_dossier_valid(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
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
