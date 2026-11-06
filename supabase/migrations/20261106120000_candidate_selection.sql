-- Migration : sélection atomique des candidats et visibilité des profils (lot 7a audit)
-- Date : 2026-11-06
-- Tables affectées : job_applications (trigger), missions, contracts (grants,
--   index uniques), notifications (écrites par select_candidate),
--   company_profiles (policy SELECT supprimée)
-- Fonctions : select_candidate, company_job_applicants,
--   protect_job_application_writes (remplacée)
-- Vue : company_public_profiles
--
-- Constats corrigés (docs/audit/AUDIT.md) :
--   F-10 (partie sélection) Aucun code ne créait la mission ni le contrat
--         après la sélection ; l'entreprise passait la candidature à
--         'selected' par UPDATE direct, sans contrôle des places ni
--         notification, et pouvait ensuite la remettre en 'rejected' en
--         libérant la place.
--   F-16  La policy « Companies can view candidate summaries » était posée
--         sur company_profiles : toute entreprise lisait tous les profils
--         entreprise (NIU, contacts). Aucune lecture n'exposait aux
--         entreprises l'identité de leurs candidats.
--
-- Mécanisme :
--   1. select_candidate (SECURITY DEFINER) : entreprise déduite de
--      auth.uid(), candidature d'une offre de l'entreprise, statut
--      pending ou shortlisted, offre active, place disponible. Dans une seule
--      transaction : sélection (positions_filled incrémenté par
--      trg_sync_job_positions_filled, lot 6), mission et contrat 'pending',
--      notification du candidat.
--      Verrous : candidature, puis offre, comme delete_job (lot 6).
--      Relance : une candidature déjà sélectionnée renvoie la mission et le
--      contrat existants, sans nouvelle écriture ; s'ils manquent
--      (sélection antérieure à ce lot), refus selection_incomplete.
--   2. Index uniques missions.application_id et contracts.application_id :
--      au plus une mission et un contrat par candidature.
--   3. protect_job_application_writes : en session, l'entreprise ne peut plus
--      écrire 'selected', ni modifier une candidature sélectionnée ou
--      no_show. Présélection et refus des candidatures pending/shortlisted,
--      candidature et retrait par RPC : inchangés.
--   4. missions et contracts : plus d'INSERT ni de DELETE en session (aucune
--      policy ne les autorisait déjà). Les UPDATE relèvent des lots 7b et 7c.
--   5. F-16 : policy supprimée ; company_job_applicants expose aux
--      entreprises le prénom, l'initiale du nom et la présence d'une photo des
--      candidats de leurs offres ; company_public_profiles expose le nom et la
--      vitrine des entreprises ayant une offre active, ou liées à l'appelant.
--
-- Reprise des données : aucune. Une candidature 'selected' sans mission ni
-- contrat (sélection directe antérieure) reste en l'état ; select_candidate
-- la signale (selection_incomplete). Requête de contrôle (lecture seule) :
--   select a.id, a.job_id, a.selected_at from public.job_applications a
--   where a.status = 'selected'
--     and (not exists (select 1 from public.missions m where m.application_id = a.id)
--          or not exists (select 1 from public.contracts c where c.application_id = a.id));
-- Les index uniques échouent si une candidature a déjà plusieurs missions ou
-- contrats : vérifier avant déploiement (aucun code ne les créait).
--
-- Retour arrière : NE PAS recréer la policy « Companies can view candidate
-- summaries » ni rouvrir 'selected' en session. En dernier recours :
--   drop function if exists public.select_candidate(uuid);
--   drop function if exists public.company_job_applicants(uuid);
--   drop view if exists public.company_public_profiles;
--   drop index if exists public.missions_application_id_key;
--   drop index if exists public.contracts_application_id_key;
-- puis restaurer protect_job_application_writes depuis 20261031130000.
-- La migration est transactionnelle (aucun effet partiel).

-- ── 1. Unicité des engagements ──────────────────────────────────────
create unique index if not exists missions_application_id_key
  on public.missions (application_id) where application_id is not null;
create unique index if not exists contracts_application_id_key
  on public.contracts (application_id);

-- ── 2. Écritures directes ───────────────────────────────────────────
revoke insert, delete, truncate on table public.missions from anon, authenticated;
revoke insert, delete, truncate on table public.contracts from anon, authenticated;

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

  -- Le candidat ne modifie jamais directement sa candidature (retrait :
  -- withdraw_job_application). Sa propre ligne de profil lui est toujours
  -- visible, ce qui rend ce test fiable sous RLS.
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
  -- Une candidature sélectionnée porte une mission et un contrat : la
  -- remettre en attente ou en refus libérerait la place sans eux.
  if old.status in ('selected', 'no_show') then
    raise exception 'job_applications: selected applications change through support only'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('shortlisted', 'rejected') then
    raise exception 'job_applications: use select_candidate to select'
      using errcode = '42501';
  end if;
  if new.selected_at is distinct from old.selected_at
     or new.selected_by is distinct from old.selected_by then
    raise exception 'job_applications: use select_candidate to select'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_job_application_writes() from public, anon, authenticated;

-- ── 3. Sélection ────────────────────────────────────────────────────
-- Format du contrat (SRS §6.7, décision 11.1) : simple sous 3 jours,
-- formalisé au-delà. contract_data fige les conditions de l'offre au moment
-- de la sélection ; la signature relève du lot 7b.
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
      'hourly_rate', v_job.hourly_rate,
      'currency', v_job.currency,
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

-- ── 4. F-16 : profils visibles par les entreprises ──────────────────
drop policy if exists "Companies can view candidate summaries" on public.company_profiles;

-- Candidats d'une offre de l'entreprise appelante : jamais téléphone, email,
-- CNI, Mobile Money, adresse, coordonnées ni documents. La photo n'est
-- signalée que par has_photo ; elle est servie par
-- GET /api/jobs/[id]/applications/[applicationId]/photo après ce contrôle.
create or replace function public.company_job_applicants(p_job_id uuid)
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
  sandbox_level integer,
  reliability_score numeric,
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
         c.sandbox_level,
         c.reliability_score,
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

-- Vitrine publique : remplace, pour les embeds des offres, la lecture que la
-- policy supprimée donnait aux entreprises (et que les candidats n'avaient
-- jamais eue). Entreprises ayant une offre active, ou liées à l'appelant par
-- sa propre candidature, ou son propre profil.
create or replace view public.company_public_profiles
with (security_barrier = true) as
select cp.id, cp.company_name, cp.logo_url, cp.city, cp.sector, cp.description
from public.company_profiles cp
where exists (select 1 from public.jobs j
              where j.company_id = cp.id and j.status = 'active')
   or exists (select 1 from public.jobs j
              join public.job_applications a on a.job_id = j.id
              join public.candidate_profiles c on c.id = a.candidate_id
              where j.company_id = cp.id and c.user_id = (select auth.uid()))
   or cp.user_id = (select auth.uid());

revoke all on public.company_public_profiles from public, anon, authenticated;
grant select on public.company_public_profiles to anon, authenticated;
