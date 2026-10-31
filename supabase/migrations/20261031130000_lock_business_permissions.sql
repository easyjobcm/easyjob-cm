-- Migration : verrouillage des colonnes et tables porteuses de droits (lot 2 audit)
-- Date : 2026-10-31
-- Tables affectées : candidate_profiles, candidate_skills (trigger),
--   job_applications, subscriptions, otp_codes (grants, policies, triggers) ;
--   profile_update_requests et users (écrits par trigger, sans changement
--   de droits)
-- Fonctions : protect_candidate_profile_columns, candidate_profile_completion_pct,
--   sync_candidate_profile_derived, refresh_candidate_profile_completion,
--   protect_verified_candidate_data, sync_user_verification_from_profile,
--   protect_job_application_writes, apply_to_job, withdraw_job_application ;
--   cleanup_expired_otp (EXECUTE retiré)
--
-- Constats corrigés (docs/audit/AUDIT.md) :
--   F-04  candidate_profiles : INSERT/UPDATE sans restriction de colonnes.
--         Le candidat pouvait écrire sandbox_level, premium_until,
--         driving_license_verified, profile_completion_pct, onboarding_status,
--         reliability_score, completed_missions… et, à la création, les
--         colonnes de vérification CNI/MoMo (protégées en UPDATE seulement).
--   F-05  job_applications : INSERT direct du candidat (contourne tous les
--         contrôles de /api/jobs/[id]/apply) et UPDATE libre de sa candidature
--         (auto-sélection, score). L'UPDATE entreprise n'avait pas de
--         WITH CHECK ni de restriction de colonnes.
--   F-06  subscriptions : auto-attribution d'un abonnement (INSERT self).
--   F-11  otp_codes (table héritée, inutilisée) : lecture/écriture par tous,
--         et cleanup_expired_otp() SECURITY DEFINER exécutable par anon.
--   F-17  aucun chemin de retrait : la route annonçait un succès sans effet.
--   F-35  verrou de l'identité vérifiée et réinitialisation MoMo appliqués
--         seulement dans les routes : contournables par PATCH direct ;
--         users.is_verified non recalculé après ces changements.
--   F-34  profile_completion_pct jamais écrit par l'application (gate 60 %
--         inopérant) ; critère CNI perdu après la purge des photos.
--
-- Mécanisme (même principe que 20261031120000, lot 1) :
--   1. Privilèges de colonnes : frontière principale, refus explicite 42501
--      pour tout appel PostgREST/GraphQL hors liste.
--   2. Triggers de défense en profondeur fondés sur current_user (rôle
--      d'exécution, non modifiable par le client), jamais sur le GUC
--      easyjob.system_update. Les écritures de confiance passent par
--      service_role ou par une fonction SECURITY DEFINER à garde interne.
--   3. RLS : suppression des policies d'écriture devenues sans objet, pour
--      qu'un futur « GRANT ALL » ne rouvre rien (RLS active sans policy =
--      refus).
--   4. Valeurs dérivées calculées en base : profile_completion_pct (toujours)
--      et onboarding_status (pour les écritures candidat).
--   5. Candidature et retrait par RPC transactionnelles qui déduisent le
--      candidat de auth.uid() ; elles sont la source de référence des règles
--      de candidature (la route ne fait plus que traduire les codes).
--
-- Reprise des données : profile_completion_pct est recalculé avec les
-- règles ci-dessus, uniquement pour les profils dont la valeur stockée
-- diffère (les autres ne sont pas réécrits). Pour les lignes réécrites :
-- updated_at prend l'heure de la migration (on_candidate_profiles_updated) ;
-- les triggers de protection laissent passer (rôle propriétaire) sans rien
-- modifier ; onboarding_status, les vérifications et users.is_verified ne
-- changent pas (aucune colonne surveillée par §1e n'est écrite). Aucun
-- événement Realtime selon les migrations du dépôt (candidate_profiles
-- n'est pas dans la publication supabase_realtime). Les valeurs protégées
-- existantes (sandbox_level, premium_until, is_verified…) ne sont PAS
-- corrigées : leur éventuelle falsification passée relève de H-01/H-02
-- (lot 0).
--
-- Retour arrière : NE PAS rouvrir les grants ni les policies d'écriture
-- (réintroduirait F-04 à F-06). Si un flux légitime est bloqué, le faire
-- passer par service_role ou une RPC SECURITY DEFINER gardée. En dernier
-- recours, retirer seulement les triggers de défense :
--   drop trigger if exists trg_protect_candidate_profile_columns on public.candidate_profiles;
--   drop trigger if exists trg_protect_job_application_writes on public.job_applications;
-- Le verrou des données vérifiées (§1d) n'a pas d'équivalent par les
-- droits de colonnes : ne pas le retirer sans rétablir le verrou ailleurs.
-- La migration est transactionnelle (aucun effet partiel).

-- ════════════════════════════════════════════════════════════════════
-- 1. candidate_profiles (F-04)
-- ════════════════════════════════════════════════════════════════════

-- Colonnes écrites en session par les flux existants : onboarding
-- (app/onboarding/candidate), /api/profile/identity, /api/profile/documents,
-- /api/profile/availability. cni_verified reste écrivable pour le flux de
-- ré-soumission ('pending'/'rejected') ; le saut vers 'verified' est bloqué
-- par trg_protect_cni_verification, et une CNI vérifiée est gardée par
-- trg_protect_verified_candidate_data (§1d). La déclaration MoMo
-- (opérateur, numéro, nom du compte) passe uniquement par
-- candidate_update_momo, qui réinitialise la vérification (F-35). Toute
-- autre colonne (vérifications, niveau, premium, statistiques, valeurs
-- dérivées, cni_number, address) s'écrit par service_role ou RPC.
revoke insert, update, delete, truncate, references, trigger
  on table public.candidate_profiles from anon, authenticated;
grant select on table public.candidate_profiles to anon, authenticated;

grant insert (
  user_id, first_name, last_name, gender, date_of_birth, city, quartier,
  latitude, longitude, bio, profile_photo_url, max_travel_distance_km,
  onboarding_step
) on table public.candidate_profiles to authenticated;

grant update (
  first_name, last_name, gender, date_of_birth, city, quartier,
  latitude, longitude, bio, profile_photo_url, max_travel_distance_km,
  cni_front_url, cni_back_url, cni_selfie_url, cni_verified, cni_rejection_reason,
  onboarding_step
) on table public.candidate_profiles to authenticated;

-- La policy UPDATE n'avait pas de WITH CHECK explicite (équivalent USING) :
-- on l'explicite pour lever toute ambiguïté.
drop policy if exists "Candidates can update own profile" on public.candidate_profiles;
create policy "Candidates can update own profile" on public.candidate_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Candidates can insert own profile" on public.candidate_profiles;
create policy "Candidates can insert own profile" on public.candidate_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ── 1a. Défense en profondeur ───────────────────────────────────────
-- Nom choisi pour s'exécuter avant trg_protect_cni_verification,
-- trg_protect_momo_verification et trg_sync_candidate_profile_derived
-- (ordre alphabétique des triggers BEFORE) : une tentative est refusée
-- explicitement avant tout recalcul.
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
       or new.sandbox_level is distinct from 0
       or new.premium_until is not null
       or new.driving_license_verified is distinct from false
       or new.driving_license_expires_at is not null
       or new.reliability_score is distinct from 0
       or new.total_missions is distinct from 0
       or new.completed_missions is distinct from 0
       or new.no_show_count is distinct from 0
       or new.sandbox_missions_completed is distinct from 0
       or new.is_sandbox is distinct from true
       or new.average_rating is distinct from 0
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

  -- Même liste que le GRANT UPDATE ci-dessus (plus updated_at, posé par
  -- handle_updated_at). Les colonnes ajoutées plus tard sont protégées par
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

drop trigger if exists trg_protect_candidate_profile_columns on public.candidate_profiles;
create trigger trg_protect_candidate_profile_columns
  before insert or update on public.candidate_profiles
  for each row execute function public.protect_candidate_profile_columns();

-- ── 1b. Complétude : traduction SQL de computeCandidateCriteria ─────
-- Source de référence pour le seuil de candidature (60 %) :
-- lib/utils/profile-completion.ts (computeCandidateCriteria). Toute
-- modification des critères ou des poids doit être reportée dans les deux,
-- la preuve scripts/proof-business-permissions.ts (A7) vérifie la
-- cohérence. Les tests JS de « vérité » sont reproduits : chaîne non vide,
-- nombre non nul pour les coordonnées, bio > 10 caractères après trim.
-- Critère CNI : une CNI vérifiée le satisfait (les photos sont supprimées
-- après approbation, T8.4 ; même règle que recompute_user_verification),
-- sinon les trois photos soumises.
create or replace function public.candidate_profile_completion_pct(
  p public.candidate_profiles,
  p_skill_count integer
)
returns integer
language sql
immutable
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
                 or (coalesce(p.cni_front_url, '') <> '' and coalesce(p.cni_back_url, '') <> ''
                     and coalesce(p.cni_selfie_url, '') <> '')
            then 15 else 0 end)
    + (case when coalesce(p.momo_verified, false) then 5 else 0 end);
$$;

-- Fonction pure (aucun accès aux données) : authenticated doit pouvoir
-- l'exécuter, car le trigger de synchronisation tourne avec ses droits.
revoke all on function public.candidate_profile_completion_pct(public.candidate_profiles, integer)
  from public, anon;
grant execute on function public.candidate_profile_completion_pct(public.candidate_profiles, integer)
  to authenticated;

-- ── 1c. Valeurs dérivées ────────────────────────────────────────────
-- profile_completion_pct : toujours recalculé, quel que soit l'auteur.
-- onboarding_status : pour une écriture candidat, dérivé des règles de
-- l'assistant (app/onboarding/candidate/onboarding-client.tsx, handleNext) :
-- prénom et nom, ville, au moins 2 compétences, opérateur et numéro MoMo,
-- et étape finale atteinte (onboarding_step > 4). Un profil completed ou
-- rejected ne change plus par écriture candidat. Les rôles de confiance
-- (administration, fixtures) gardent la valeur qu'ils écrivent.
create or replace function public.sync_candidate_profile_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_skill_count integer;
begin
  select count(*) into v_skill_count
  from public.candidate_skills
  where candidate_id = new.id;

  new.profile_completion_pct := public.candidate_profile_completion_pct(new, v_skill_count);

  if current_user in ('anon', 'authenticated') then
    if tg_op = 'UPDATE' and old.onboarding_status in ('completed', 'rejected') then
      new.onboarding_status := old.onboarding_status;
    elsif coalesce(new.onboarding_step, 1) > 4
          and coalesce(new.first_name, '') <> ''
          and coalesce(new.last_name, '') <> ''
          and coalesce(new.city, '') <> ''
          and coalesce(new.momo_provider, '') <> ''
          and coalesce(new.momo_number, '') <> ''
          and v_skill_count >= 2 then
      new.onboarding_status := 'completed';
    else
      new.onboarding_status := 'in_progress';
      -- L'étape 5 signifie « terminé » pour l'assistant : on reste à la
      -- dernière étape tant que les conditions ne sont pas réunies.
      if coalesce(new.onboarding_step, 1) > 4 then
        new.onboarding_step := 4;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_candidate_profile_derived() from public, anon, authenticated;

drop trigger if exists trg_sync_candidate_profile_derived on public.candidate_profiles;
create trigger trg_sync_candidate_profile_derived
  before insert or update on public.candidate_profiles
  for each row execute function public.sync_candidate_profile_derived();

-- Les compétences entrent dans la complétude : leur ajout ou retrait
-- relance le calcul, seulement si la valeur change (pas de réécriture ni
-- de mise à jour de updated_at sinon). SECURITY DEFINER car le candidat
-- n'a pas le droit d'écrire profile_completion_pct ; la fonction ne fait
-- que provoquer le recalcul (aucune valeur fournie par l'appelant).
create or replace function public.refresh_candidate_profile_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.candidate_profiles cp
  set profile_completion_pct = cp.profile_completion_pct
  where cp.id in (
      select new.candidate_id where tg_op in ('INSERT', 'UPDATE')
      union
      select old.candidate_id where tg_op in ('DELETE', 'UPDATE'))
    and cp.profile_completion_pct is distinct from public.candidate_profile_completion_pct(
      cp, (select count(*)::integer from public.candidate_skills s where s.candidate_id = cp.id));
  return null;
end;
$$;

revoke all on function public.refresh_candidate_profile_completion() from public, anon, authenticated;

drop trigger if exists trg_refresh_candidate_profile_completion on public.candidate_skills;
create trigger trg_refresh_candidate_profile_completion
  after insert or delete or update of candidate_id on public.candidate_skills
  for each row execute function public.refresh_candidate_profile_completion();

-- ── 1d. Données vérifiées (F-35) ────────────────────────────────────
-- Règle existante (SRS §5.1, lib/utils/profile-lock.ts, routes
-- /api/profile/identity et /api/profile/documents) appliquée en base pour
-- les écritures candidat : une CNI vérifiée verrouille l'identité (prénom,
-- nom, date de naissance) et les photos CNI. Une modification n'est permise
-- que si une demande admin pending (profile_update_requests) couvre le
-- groupe touché ; dans la même écriture, la CNI repasse en revue
-- ('pending', motif effacé) et les demandes couvrant ce groupe sont
-- clôturées en 'done' (auparavant par les routes, non atomique). Sans
-- modification verrouillée, le statut CNI d'un profil vérifié ne change pas
-- par écriture candidat (sinon : rétrogradation puis modification libre).
-- Les corrections d'administration (admin_edit_candidate_identity,
-- moderate_cni) s'exécutent en propriétaire et ne sont pas concernées.
-- Nom choisi pour s'exécuter après trg_protect_cni_verification et avant
-- trg_sync_candidate_profile_derived (la complétude voit le statut final).
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

drop trigger if exists trg_protect_verified_candidate_data on public.candidate_profiles;
create trigger trg_protect_verified_candidate_data
  before update on public.candidate_profiles
  for each row execute function public.protect_verified_candidate_data();

-- ── 1e. Synthèse users.is_verified ──────────────────────────────────
-- users.is_verified (gate de candidature) dépend de cni_verified,
-- momo_verified, prénom, nom et date de naissance. Il n'était recalculé
-- que par les RPC d'administration : une réinitialisation MoMo
-- (candidate_update_momo) ou une re-vérification CNI demandée par le
-- candidat le laissaient à true. Tout changement de ces colonnes, quel que
-- soit l'auteur, relance la fonction existante recompute_user_verification
-- dans la même transaction. Le GUC easyjob.system_update, que la fonction
-- remet à 'off', est restauré pour ne pas couper une RPC appelante.
create or replace function public.sync_user_verification_from_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_system_update text := current_setting('easyjob.system_update', true);
begin
  perform public.recompute_user_verification(new.user_id);
  perform set_config('easyjob.system_update', coalesce(v_system_update, 'off'), true);
  return null;
end;
$$;

revoke all on function public.sync_user_verification_from_profile() from public, anon, authenticated;

drop trigger if exists trg_sync_user_verification_from_profile on public.candidate_profiles;
create trigger trg_sync_user_verification_from_profile
  after update of cni_verified, momo_verified, first_name, last_name, date_of_birth
  on public.candidate_profiles
  for each row
  when (old.cni_verified is distinct from new.cni_verified
        or old.momo_verified is distinct from new.momo_verified
        or old.first_name is distinct from new.first_name
        or old.last_name is distinct from new.last_name
        or old.date_of_birth is distinct from new.date_of_birth)
  execute function public.sync_user_verification_from_profile();

-- Reprise : recalcul des profils existants (exécuté en propriétaire, donc
-- onboarding_status n'est pas touché).
update public.candidate_profiles cp
set profile_completion_pct = public.candidate_profile_completion_pct(
  cp, (select count(*)::integer from public.candidate_skills s where s.candidate_id = cp.id))
where cp.profile_completion_pct is distinct from public.candidate_profile_completion_pct(
  cp, (select count(*)::integer from public.candidate_skills s where s.candidate_id = cp.id));

-- ════════════════════════════════════════════════════════════════════
-- 2. job_applications (F-05, F-17)
-- ════════════════════════════════════════════════════════════════════

-- Création et retrait : RPC uniquement. L'entreprise garde l'UPDATE des
-- colonnes de décision utilisées par app/company/jobs/[id] (sélection,
-- rejet motivé) ; la sélection atomique avec places et mission relève du
-- lot 7.
revoke insert, update, delete, truncate, references, trigger
  on table public.job_applications from anon, authenticated;
grant select on table public.job_applications to anon, authenticated;
grant update (status, selected_at, selected_by, rejection_reason)
  on table public.job_applications to authenticated;

drop policy if exists "Candidates can create applications" on public.job_applications;
drop policy if exists "Candidates can update own applications" on public.job_applications;

drop policy if exists "Companies can update applications for their jobs" on public.job_applications;
create policy "Companies can update applications for their jobs" on public.job_applications
  for update to authenticated
  using (job_id in (
    select j.id from public.jobs j
    join public.company_profiles cp on cp.id = j.company_id
    where cp.user_id = (select auth.uid())))
  with check (job_id in (
    select j.id from public.jobs j
    join public.company_profiles cp on cp.id = j.company_id
    where cp.user_id = (select auth.uid())));

-- ── 2a. Défense en profondeur ───────────────────────────────────────
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

  -- Décision de l'entreprise : jamais sur une candidature retirée, jamais
  -- vers pending/withdrawn (états du candidat), sélection en son nom.
  if old.status = 'withdrawn' then
    raise exception 'job_applications: application was withdrawn'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('shortlisted', 'selected', 'rejected') then
    raise exception 'job_applications: status not allowed for companies'
      using errcode = '42501';
  end if;
  if new.selected_by is distinct from old.selected_by
     and new.selected_by is distinct from (select auth.uid()) then
    raise exception 'job_applications: selected_by must be the caller'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_job_application_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_job_application_writes on public.job_applications;
create trigger trg_protect_job_application_writes
  before insert or update or delete on public.job_applications
  for each row execute function public.protect_job_application_writes();

-- ── 2b. Candidature ─────────────────────────────────────────────────
-- Règles reprises de app/api/jobs/[id]/apply/route.ts et
-- lib/matching/skill-document-requirements.ts, dans le même ordre (le
-- premier refus est renvoyé). Chaque refus lève une exception dont le
-- message est un code machine traduit par la route ; le détail des
-- documents est passé en JSON dans DETAIL. Aucune place n'est réservée :
-- positions_filled ne bouge qu'à la sélection.
-- Recandidature : une seule candidature par offre (SRS §6.6, contrainte
-- job_applications_job_id_candidate_id_key), y compris après retrait.
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
         j.sandbox_level_required, j.required_documents
  into v_job
  from public.jobs j where j.id = p_job_id
  for share;
  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status is distinct from 'active' then
    raise exception 'job_not_available';
  end if;
  if coalesce(v_job.sandbox_level_required, 0) > coalesce(v_profile.sandbox_level, 0) then
    raise exception 'sandbox_level_too_low';
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

-- ── 2c. Retrait ─────────────────────────────────────────────────────
-- Seule une candidature pending est retirable (règle de l'ancienne route
-- DELETE). Un retrait répété renvoie la ligne déjà withdrawn, sans écriture.
-- FOR UPDATE sérialise le retrait avec une décision concurrente de
-- l'entreprise.
create or replace function public.withdraw_job_application(p_job_id uuid)
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
  for update of a;

  if not found then
    raise exception 'application_not_found';
  end if;
  if v_application.status = 'withdrawn' then
    return v_application;
  end if;
  if v_application.status is distinct from 'pending' then
    raise exception 'application_not_withdrawable';
  end if;

  update public.job_applications
  set status = 'withdrawn'
  where id = v_application.id
  returning * into v_application;

  return v_application;
end;
$$;

revoke all on function public.withdraw_job_application(uuid) from public, anon;
grant execute on function public.withdraw_job_application(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. subscriptions (F-06)
-- ════════════════════════════════════════════════════════════════════
-- Aucun flux applicatif n'écrit d'abonnement : les écritures sont
-- réservées au serveur (service_role), y compris pour les administrateurs.
-- La lecture (propriétaire ou admin) est conservée.
revoke insert, update, delete, truncate, references, trigger
  on table public.subscriptions from anon, authenticated;
revoke select on table public.subscriptions from anon;
grant select on table public.subscriptions to authenticated;

drop policy if exists "subscriptions_insert_admin_or_self" on public.subscriptions;
drop policy if exists "subscriptions_update_admin_only" on public.subscriptions;

-- ════════════════════════════════════════════════════════════════════
-- 4. otp_codes (F-11)
-- ════════════════════════════════════════════════════════════════════
-- Table héritée, sans usage dans le dépôt (les OTP passent par Supabase
-- Auth). Conservée avec ses données, état distant inconnu ; seul le serveur
-- y accède. RLS reste active, sans policy.
revoke all on table public.otp_codes from anon, authenticated;

drop policy if exists "Anyone can insert OTP codes" on public.otp_codes;
drop policy if exists "Anyone can update OTP codes" on public.otp_codes;
drop policy if exists "Users can view own OTP codes" on public.otp_codes;

revoke all on function public.cleanup_expired_otp() from public, anon, authenticated;
alter function public.cleanup_expired_otp() set search_path = '';
