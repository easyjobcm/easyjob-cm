-- Lot 11b — échéances de candidature et de sélection (décisions produit
-- validées le 2026-11-11). Non déployée.
--
-- Règles :
--   * offre publiée en régime normal : candidatures et sélections jusqu'à
--     H−24 exclu ; offre publiée en régime urgent : jusqu'à H−2 exclu ;
--     à l'instant exact de clôture, refus (recruitment_closed) ;
--   * publication urgente : au moins 4 h avant le début (H−4 inclus) et
--     moins de 24 h avant celui-ci ; publication normale : avant H−24.
--     À l'instant exact H−24, ni l'un ni l'autre : publication refusée
--     (job_start_too_close), comme un début à moins de 4 h ou passé ;
--   * H = début de l'offre, start_date + start_time lus en Africa/Douala ;
--     toutes les comparaisons utilisent now() (heure de la base, début de
--     la transaction), jamais l'horloge du navigateur ni pg_cron.
--
-- Inventaire avant ce lot :
--   * jobs.urgency (urgency_level) : ancienne option manuelle fournie par
--     le client, plus lue depuis le lot 9d ; elle ne détermine rien ici ;
--   * badge « Urgente » : calculé à l'affichage (lib/jobs/urgency.ts, début
--     dans 24 h ou moins) ; il reste indépendant du régime et ne prolonge
--     jamais une échéance ;
--   * jobs.published_at : remis à null par update_job puis réécrit à chaque
--     approbation : ne garde pas la première publication ;
--   * jobs.expires_at : jamais renseigné ; statut 'expired' jamais posé.
--
-- Source de vérité ajoutée (colonnes en lecture seule pour les sessions :
-- aucun privilège d'écriture sur jobs depuis 20261101140000) :
--   * first_published_at : première publication effective (passage à
--     'active'), jamais modifiée ensuite ;
--   * publication_regime : 'normal' ou 'urgent', déduit à cet instant de
--     l'horaire alors approuvé, jamais recalculé ;
--   * applications_close_at : échéance calculée et stockée à la première
--     publication, jamais recalculée ensuite.
--
-- Ce qui n'est PAS une publication : le retour d'une offre après
-- revalidation du dossier entreprise (statut inchangé, lot 11), une
-- écriture de service qui remet 'active' depuis un autre statut que
-- draft / pending_review. Le régime et l'échéance ne bougent pas.
--
-- Règle de lancement (décision validée le 2026-11-11) : après la première
-- publication, dates et horaires (start_date, end_date, start_time,
-- end_time) ne changent plus, quel que soit le plan ou le statut ultérieur,
-- même sans candidat sélectionné ; première publication, régime et
-- échéance non plus. Le trigger le refuse à tout auteur, clé service
-- comprise (job_schedule_locked, publication_regime_locked) ; update_job
-- accepte les mêmes valeurs renvoyées et refuse un changement. Les autres
-- corrections restent possibles selon les règles existantes (Pro et
-- Business pour une offre active, sans candidat sélectionné) et repassent
-- en modération ; la nouvelle approbation ne change ni le régime ni
-- l'échéance. Déplacer une mission publiée : créer une nouvelle offre
-- (nouvelle modération, régime calculé à sa première publication), sans
-- transfert des candidatures ni annulation de l'ancienne. Aucun
-- contournement support dans ce lot (parcours prévu : PLAN_ACTION.md).
--
-- Données existantes (décision validée) : aucune date de première
-- publication fiable (published_at réécrit, horaires modifiables après
-- l'approbation tracée dans audit_logs). Rien n'est inventé ni republié :
-- une offre déjà publiée avant ce lot est marquée legacy_publication ; elle
-- reste close (aucun régime ni échéance, même après une nouvelle
-- approbation) et ses dates et horaires sont figés comme ceux d'une offre
-- publiée (diagnostic en fin de migration).
--
-- Clôture du recrutement ≠ fin de mission : aucun statut d'offre n'est
-- modifié ; candidatures, contrats et missions gardent leurs parcours.

-- ── 1. Colonnes ────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists first_published_at timestamptz,
  add column if not exists publication_regime text,
  add column if not exists applications_close_at timestamptz,
  add column if not exists legacy_publication boolean not null default false;

-- Offres déjà publiées avant le lot : statut publié ou passé, date de
-- publication, ou approbation tracée (offre corrigée revenue en attente).
update public.jobs j
set legacy_publication = true
where j.status in ('active', 'filled', 'expired', 'cancelled')
   or j.published_at is not null
   or exists (select 1 from public.audit_logs l
              where l.resource_type = 'jobs' and l.resource_id = j.id
                and l.action = 'approve_job');

alter table public.jobs drop constraint if exists jobs_publication_regime_chk;
alter table public.jobs add constraint jobs_publication_regime_chk
  check (publication_regime is null or publication_regime in ('normal', 'urgent'));

alter table public.jobs drop constraint if exists jobs_publication_consistent_chk;
alter table public.jobs add constraint jobs_publication_consistent_chk
  check ((first_published_at is null) = (publication_regime is null)
         and (first_published_at is null) = (applications_close_at is null));

create index if not exists idx_jobs_applications_close_at
  on public.jobs (applications_close_at);

comment on column public.jobs.first_published_at is
  'Lot 11b : première publication effective (passage à active), jamais modifiée.';
comment on column public.jobs.publication_regime is
  'Lot 11b : normal (clôture H−24) ou urgent (clôture H−2), figé à la première publication.';
comment on column public.jobs.legacy_publication is
  'Lot 11b : offre publiée avant le lot, sans historique fiable : close, dates et horaires figés, jamais de régime.';
comment on column public.jobs.applications_close_at is
  'Lot 11b : fin des candidatures et sélections, fixée à l''approbation de la version publiée.';
comment on column public.jobs.urgency is
  'Ancienne option manuelle (lot 9d : plus lue). Ne détermine ni le régime ni l''échéance.';

-- ── 2. Règles temporelles partagées ───────────────────────────────
create or replace function public.job_start_instant(p_date date, p_time time)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_date + p_time) at time zone 'Africa/Douala';
$$;

-- Régime d'une première publication à l'instant p_at, ou null si le début
-- n'est plus publiable.
create or replace function public.job_publication_regime(p_start timestamptz, p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_at is null then null
    when p_at < p_start - interval '24 hours' then 'normal'
    when p_at > p_start - interval '24 hours'
         and p_at <= p_start - interval '4 hours' then 'urgent'
    else null end;
$$;

create or replace function public.job_recruitment_close(p_start timestamptz, p_regime text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_start - case when p_regime = 'urgent'
                        then interval '2 hours' else interval '24 hours' end;
$$;

revoke all on function public.job_start_instant(date, time) from public, anon, authenticated;
revoke all on function public.job_publication_regime(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.job_recruitment_close(timestamptz, text) from public, anon, authenticated;
-- Trigger exécuté avec les droits de l'auteur de l'écriture (RPC du
-- propriétaire, ou clé service pour le seed et les preuves).
grant execute on function public.job_start_instant(date, time) to service_role;
grant execute on function public.job_publication_regime(timestamptz, timestamptz) to service_role;
grant execute on function public.job_recruitment_close(timestamptz, text) to service_role;

-- Champ calculé PostgREST (listes) : recrutement ouvert à l'heure de la base.
create or replace function public.recruitment_open(j public.jobs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select j.status = 'active'
     and j.applications_close_at is not null
     and now() < j.applications_close_at;
$$;
revoke all on function public.recruitment_open(public.jobs) from public;
grant execute on function public.recruitment_open(public.jobs) to anon, authenticated;

-- ── 3. Régime figé à la première publication (tout auteur) ─────────
create or replace function public.job_publication_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_regime text;
begin
  -- Après la première publication, pour tout auteur (clé service comprise) :
  -- première publication, régime et échéance figés ; dates et horaires
  -- aussi (règle de lancement).
  if tg_op = 'UPDATE' and new.legacy_publication is distinct from old.legacy_publication then
    raise exception 'publication_regime_locked' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.first_published_at is not null or old.legacy_publication) then
    if (new.first_published_at, new.publication_regime, new.applications_close_at)
       is distinct from
       (old.first_published_at, old.publication_regime, old.applications_close_at) then
      raise exception 'publication_regime_locked' using errcode = '42501';
    end if;
    if (new.start_date, new.end_date, new.start_time, new.end_time)
       is distinct from (old.start_date, old.end_date, old.start_time, old.end_time) then
      raise exception 'job_schedule_locked' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from 'active' then
    return new;
  end if;
  -- Déjà active (places, retour après revalidation du dossier…) ou retour
  -- depuis un autre statut par une écriture de service : pas une publication.
  if tg_op = 'UPDATE' and (old.status = 'active'
       or (old.status is not null and old.status not in ('draft', 'pending_review'))) then
    return new;
  end if;
  -- Insertion déjà publiée par un auteur de confiance (clé service : seed,
  -- preuve) qui fournit les trois valeurs ; les sessions n'insèrent jamais.
  if tg_op = 'INSERT' and new.first_published_at is not null
     and new.publication_regime is not null
     and new.applications_close_at is not null then
    return new;
  end if;

  -- Nouvelle approbation après une correction : rien ne change (régime,
  -- échéance et horaires figés ci-dessus). Offre antérieure au lot : jamais
  -- de régime, elle reste close.
  if new.legacy_publication
     or (tg_op = 'UPDATE' and old.first_published_at is not null) then
    return new;
  end if;

  v_start := public.job_start_instant(new.start_date, new.start_time);
  v_regime := public.job_publication_regime(v_start, now());
  if v_regime is null then
    raise exception 'job_start_too_close';
  end if;
  new.first_published_at := now();
  new.publication_regime := v_regime;
  new.applications_close_at := public.job_recruitment_close(v_start, v_regime);
  return new;
end;
$$;
revoke all on function public.job_publication_guard() from public, anon, authenticated;

drop trigger if exists trg_job_publication_guard on public.jobs;
create trigger trg_job_publication_guard
  before insert or update on public.jobs
  for each row execute function public.job_publication_guard();

-- ── 4. Saisie et modification des offres ─────────────────────────
-- Reprises à l'identique des définitions du lot 11 (20261111120000),
-- plus le refus des champs de publication et du début non publiable.

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
  -- Lot 11 : dossier complet vérifié (trois contrôles sur la version courante).
  if not public.company_verification_complete(v_company.id) then
    raise exception 'company_not_verified' using errcode = '42501';
  end if;

  -- Seules les colonnes de contenu viennent du client ; propriétaire,
  -- statut, modération, compteurs, devise et montants internes gardent leur
  -- défaut.

  -- Lot 11b : régime, première publication et échéance ne viennent jamais
  -- du client (refus explicite plutôt qu'un champ ignoré).
  if p_job ?| array['first_published_at', 'publication_regime',
                    'applications_close_at', 'published_at'] then
    raise exception 'invalid_job_data' using detail = 'publication';
  end if;

  v_job := public.job_apply_content(
    jsonb_populate_record(null::public.jobs, '{}'::jsonb), p_job);

  -- Lot 11b : un début qui ne pourrait plus être publié (moins de 4 h,
  -- exactement 24 h ou passé) est refusé dès la saisie.
  if public.job_publication_regime(
       public.job_start_instant(v_job.start_date, v_job.start_time), now()) is null then
    raise exception 'job_start_too_close';
  end if;

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
  -- Lot 11 : dossier complet vérifié (trois contrôles sur la version courante).
  if not public.company_verification_complete(v_company.id) then
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


  -- Lot 11b : régime, première publication et échéance ne viennent jamais
  -- du client (refus explicite plutôt qu'un champ ignoré).
  if p_job ?| array['first_published_at', 'publication_regime',
                    'applications_close_at', 'published_at'] then
    raise exception 'invalid_job_data' using detail = 'publication';
  end if;

  if v_current.first_published_at is not null or v_current.legacy_publication then
    -- Lot 11b, règle de lancement : dates et horaires figés après la
    -- première publication. Les mêmes valeurs renvoyées sont acceptées
    -- (une fin absente vaut le jour du début, comme le formulaire l'envoie) ;
    -- tout changement est refusé.
    begin
      if (p_job ? 'start_date'
          and (p_job ->> 'start_date')::date is distinct from v_current.start_date)
         or (p_job ? 'start_time'
          and (p_job ->> 'start_time')::time is distinct from v_current.start_time)
         or (p_job ? 'end_time'
          and (p_job ->> 'end_time')::time is distinct from v_current.end_time)
         or (p_job ? 'end_date'
          and coalesce((p_job ->> 'end_date')::date,
                       coalesce((p_job ->> 'start_date')::date, v_current.start_date))
              is distinct from coalesce(v_current.end_date, v_current.start_date)) then
        raise exception 'job_schedule_locked' using errcode = '42501';
      end if;
    exception
      when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow then
        raise exception 'invalid_job_data' using detail = 'schedule';
    end;
    -- Validation des autres champs ; la date déjà publiée peut être passée
    -- (offre close), elle n'est donc pas revalidée et reste inchangée.
    v_job := public.job_apply_content(v_current,
      p_job || jsonb_build_object(
        'start_date', greatest(v_current.start_date, (now() at time zone 'Africa/Douala')::date),
        'end_date', null,
        'start_time', v_current.start_time,
        'end_time', v_current.end_time));
    v_job.start_date := v_current.start_date;
    v_job.end_date := v_current.end_date;
    v_job.start_time := v_current.start_time;
    v_job.end_time := v_current.end_time;
  else
    v_job := public.job_apply_content(v_current, p_job);
    -- Jamais publiée : la version corrigée doit rester publiable.
    if public.job_publication_regime(
         public.job_start_instant(v_job.start_date, v_job.start_time), now()) is null then
      raise exception 'job_start_too_close';
    end if;
  end if;

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

-- ── 5. Modération ───────────────────────────────────────────────
-- Reprise du lot 11, plus le contrôle du début à l'approbation.

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
     -- Lot 11 : dossier complet, relu au moment de l'approbation.
     and (not public.company_verification_complete(v_job.company_id)
          or v_company.company_active is false
          or v_company.user_active is false) then
    raise exception 'company_not_eligible';
  end if;

  -- Lot 11b : première publication avec un début trop proche ou passé (le
  -- trigger trg_job_publication_guard revérifie et fige le régime). Une
  -- nouvelle approbation après correction ne change ni horaires, ni régime,
  -- ni échéance : elle n'est pas bornée dans le temps.
  if p_action = 'approve' and v_job.first_published_at is null
     and not v_job.legacy_publication
     and public.job_publication_regime(
       public.job_start_instant(v_job.start_date, v_job.start_time), now()) is null then
    raise exception 'job_start_too_close';
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

-- ── 6. Candidature, sélection et disponibilité ───────────────────
-- Reprises de 20261111130000, plus l'échéance de recrutement.

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
  select j.id, j.status, j.positions_available, j.positions_filled, j.company_id,
         j.applications_close_at
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
  -- Lot 11b : échéance figée à la publication (H−24 ou H−2), comparée à
  -- l'heure de la base. Sans échéance (offre antérieure au lot) : close.
  if v_job.applications_close_at is null or now() >= v_job.applications_close_at then
    raise exception 'recruitment_closed';
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
  -- Lot 11b : même échéance que la candidature, après la relance
  -- idempotente ci-dessus (une sélection réussie garde son résultat).
  if v_job.applications_close_at is null or now() >= v_job.applications_close_at then
    raise exception 'recruitment_closed';
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

create or replace function public.job_availability(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when j.id is null or j.status is distinct from 'active' then 'not_found'
    when not public.company_dossier_valid(j.company_id) then 'unavailable'
    -- Lot 11b : offre lisible mais recrutement clos (échéance atteinte).
    when j.applications_close_at is null or now() >= j.applications_close_at then 'closed'
    else 'available' end
  from (select 1) one
  left join public.jobs j on j.id = p_job_id;
$$;
revoke all on function public.job_availability(uuid) from public;
grant execute on function public.job_availability(uuid) to anon, authenticated;

-- ── 7. Données existantes : diagnostic, sans reprise ──────────────
-- Aucune date de première publication fiable n'existe (published_at est
-- réécrit à chaque approbation ; l'horaire approuvé alors n'est pas tracé).
-- Rien n'est inventé ni republié : les offres marquées legacy_publication
-- restent lisibles mais closes (apply_to_job et select_candidate refusent
-- recruitment_closed), dates et horaires figés, même après une nouvelle
-- approbation ; candidatures, contrats et missions existants conservés.
do $$
declare
  v_legacy integer;
  v_active integer;
  v_engaged integer;
  v_never integer;
begin
  select count(*) into v_legacy from public.jobs where legacy_publication;
  select count(*) into v_active from public.jobs
  where legacy_publication and status = 'active';
  select count(distinct j.id) into v_engaged from public.jobs j
  join public.job_applications a on a.job_id = j.id
  where j.legacy_publication and j.status = 'active';
  select count(*) into v_never from public.jobs
  where not legacy_publication and status in ('draft', 'pending_review', 'rejected');
  raise notice 'lot 11b: % offre(s) publiée(s) avant le lot (closes, horaires figés), dont % active(s) et % active(s) avec candidatures ; % offre(s) jamais publiée(s) (régime fixé à la première approbation)',
    v_legacy, v_active, v_engaged, v_never;
end $$;
