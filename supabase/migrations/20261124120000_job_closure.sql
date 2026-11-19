-- Migration : clôture tracée d'une offre publiée sans engagement (lot 17d-1)
-- Date : 2026-11-24
--
-- Tables : jobs (colonne closed_at), job_applications (trigger) ; nouvelle :
--   job_closures (motif, auteur, instant ; entreprise propriétaire et
--   admins seulement, aucune écriture de session).
-- Fonctions : job_offer_ids, job_has_commitments, job_was_published,
--   delete_job (reprise), close_job, my_job_removal_actions,
--   job_availability (reprise) ; triggers job_closure_guard,
--   block_closed_job_applications, protect_job_closures.
-- Politique : « Published jobs are viewable by all » (reprise : offre
--   clôturée lisible par les candidats qui y ont postulé).
--
-- Règles validées (2026-11-24) :
--   * Offre jamais publiée, sans engagement : suppression autorisée
--     (contrôles d'accès existants de delete_job).
--   * Offre déjà publiée, sans engagement : suppression physique refusée
--     (`job_published`) ; clôture par l'entreprise propriétaire active,
--     motif obligatoire (10 à 500 caractères), conservée dans l'historique ;
--     candidats ayant une candidature en cours (en attente ou ancienne
--     présélection) notifiés une fois ; plus aucune candidature ni
--     sélection ensuite.
--   * « Déjà publiée » ne dépend pas du statut courant : première
--     publication enregistrée (lot 11b), offre historique
--     (`legacy_publication`), date d'approbation (`published_at`) ou statut
--     qui suppose une publication (active, published, filled, expired,
--     cancelled). Une offre publiée puis revenue en modération reste
--     publiée.
--   * Offre avec engagement (candidature sélectionnée ou absente, mission,
--     contrat, pénalité, sur l'offre ou ses sous-offres) : ni suppression
--     ni clôture (`job_has_commitments`), orientation vers le support.
--     L'annulation après sélection relève d'un autre sous-lot.
--   * La perte de validation du dossier entreprise n'empêche pas la
--     clôture. Aucune sanction, aucun retrait d'unité, aucun paiement ni
--     remboursement : la clôture est un fait tracé, pas un manquement.
--   * Statut existant `cancelled` + `closed_at` : aucune nouvelle échéance.
--     Candidatures conservées telles quelles (jamais effacées ni changées
--     en refus). Une offre clôturée ne revient jamais à un autre statut,
--     pour tout auteur (revalidation du dossier, modération, clé service).
--   * Offre de plusieurs journées : clôture de l'offre entière seulement ;
--     aucune clôture partielle de journées.
--   * Candidatures d'une offre clôturée figées (décision du 2026-11-24) :
--     ni refus par l'entreprise, ni retrait par le candidat ; elles sont
--     présentées comme historique, jamais « en cours ».
--   * Historique d'une offre publiée : ni l'offre, ni ses candidatures, ni
--     sa clôture ne s'effacent par l'application, clé service et cascades
--     comprises (`job_history_protected`) ; seule une maintenance directe
--     de la base (session_user postgres ou supabase_admin, hors
--     application) le peut, aucun parcours administratif de purge n'étant
--     validé. Les preuves nettoient leurs fixtures par cette voie.
--
-- Verrous (ordre de delete_job et de sign_and_select) : candidatures de
-- l'offre (ordre des identifiants), puis offres (ordre des identifiants).
-- La candidature prend l'offre en partage (apply_to_job_core) : la clôture
-- attend qu'elle se termine et notifie aussi ce candidat, ou la candidature
-- attend la clôture et est refusée. Une sélection qui gagne rend la clôture
-- impossible (`job_has_commitments`), sans effet partiel.
--
-- Retour arrière (pile locale ; aucune clôture ne doit exister) :
--   drop function if exists public.close_job(uuid, text);
--   drop function if exists public.my_job_removal_actions();
--   drop trigger if exists trg_block_closed_job_applications on public.job_applications;
--   drop trigger if exists trg_job_application_history_guard on public.job_applications;
--   drop trigger if exists trg_job_history_guard on public.jobs;
--   drop function if exists public.job_history_guard();
--   drop function if exists public.job_history_maintenance();
--   drop trigger if exists trg_job_closure_guard on public.jobs;
--   drop table if exists public.job_closures;
--   recréer delete_job (20261101140000), job_availability (20261112120000)
--   et la politique (20261111130000) ;
--   alter table public.jobs drop column closed_at;

-- ════════════════════════════════════════════════════════════════════
-- 1. Données
-- ════════════════════════════════════════════════════════════════════
alter table public.jobs add column if not exists closed_at timestamptz;

comment on column public.jobs.closed_at is
  'Lot 17d-1 : clôture par l''entreprise (statut cancelled). Détail privé dans job_closures.';

create table if not exists public.job_closures (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  closed_by uuid not null references public.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 10 and 500),
  previous_status public.job_status not null,
  open_applications integer not null check (open_applications >= 0),
  notified_users integer not null check (notified_users >= 0),
  closed_at timestamptz not null default now()
);

alter table public.job_closures enable row level security;
revoke all on table public.job_closures from public, anon, authenticated;
grant select on table public.job_closures to authenticated;

drop policy if exists job_closures_owner_select on public.job_closures;
create policy job_closures_owner_select on public.job_closures
  for select to authenticated
  using (company_id in (select cp.id from public.company_profiles cp
                        where cp.user_id = (select auth.uid())));

drop policy if exists job_closures_admin_select on public.job_closures;
create policy job_closures_admin_select on public.job_closures
  for select to authenticated
  using (public.is_admin_user((select auth.uid())));

-- Maintenance hors application : connexion directe à la base sous un rôle
-- d'administration de la plateforme (session_user). Une requête de
-- l'application passe toujours par PostgREST (session `authenticator`, clé
-- anon ou service) : elle n'est jamais une maintenance, même en clé
-- service, même dans une fonction SECURITY DEFINER ou une cascade.
create or replace function public.job_history_maintenance()
returns boolean
language sql
stable
set search_path = ''
as $$
  select session_user in ('postgres', 'supabase_admin');
$$;
revoke all on function public.job_history_maintenance() from public, anon, authenticated;

-- Historique en ajout seul : aucune modification ; suppression réservée à
-- la maintenance (cascade d'une purge de l'offre).
create or replace function public.protect_job_closures()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'job_closures: append only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if not public.job_history_maintenance() then
      raise exception 'job_history_protected' using errcode = '42501';
    end if;
    return old;
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'job_closures: use close_job' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_job_closures() from public, anon, authenticated;

drop trigger if exists trg_protect_job_closures on public.job_closures;
create trigger trg_protect_job_closures
  before insert or update or delete on public.job_closures
  for each row execute function public.protect_job_closures();

-- ════════════════════════════════════════════════════════════════════
-- 2. Notions partagées
-- ════════════════════════════════════════════════════════════════════
-- Offre et sous-offres historiques de l'entreprise (même périmètre que
-- delete_job, lot 6).
create or replace function public.job_offer_ids(p_job_id uuid, p_company_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(j.id order by j.id)
  from public.jobs j
  where j.company_id = p_company_id
    and (j.id = p_job_id or j.parent_job_id = p_job_id);
$$;
revoke all on function public.job_offer_ids(uuid, uuid) from public, anon, authenticated;

-- Engagement : jamais réduit au compteur de places.
create or replace function public.job_has_commitments(p_job_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.job_applications a
                 where a.job_id = any (p_job_ids) and a.status in ('selected', 'no_show'))
      or exists (select 1 from public.missions m where m.job_id = any (p_job_ids))
      or exists (select 1 from public.contracts c where c.job_id = any (p_job_ids))
      or exists (select 1 from public.cancellation_penalties p
                 where p.job_id = any (p_job_ids));
$$;
revoke all on function public.job_has_commitments(uuid[]) from public, anon, authenticated;

-- Preuve de publication, indépendante du statut courant.
create or replace function public.job_was_published(p_job_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = any (p_job_ids)
      and (j.first_published_at is not null
           or j.legacy_publication
           or j.published_at is not null
           or j.closed_at is not null
           or j.status in ('active', 'published', 'filled', 'expired', 'cancelled')));
$$;
revoke all on function public.job_was_published(uuid[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. Gardes (tout auteur)
-- ════════════════════════════════════════════════════════════════════
-- Une offre clôturée ne change plus de statut ni de clôture ; une clôture
-- ne s'écrit qu'avec le statut cancelled, hors session (close_job).
create or replace function public.job_closure_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.closed_at is not null then
    if new.closed_at is distinct from old.closed_at
       or new.status is distinct from old.status then
      raise exception 'job_closed' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.closed_at is not null then
    if new.status is distinct from 'cancelled'
       or current_user in ('anon', 'authenticated') then
      raise exception 'job_closed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_closure_guard() from public, anon, authenticated;

drop trigger if exists trg_job_closure_guard on public.jobs;
create trigger trg_job_closure_guard
  before update on public.jobs
  for each row execute function public.job_closure_guard();

-- Candidatures d'une offre clôturée : historique figé à la clôture. Aucune
-- candidature, sélection, refus par l'entreprise ni retrait par le
-- candidat (décision du 2026-11-24 : « plus aucun refus » vaut pour tout
-- changement de statut). Pour tout auteur, clé service comprise.
create or replace function public.block_closed_job_applications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.jobs j
                 where j.id = new.job_id and j.closed_at is not null) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'job_closed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'job_closed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.block_closed_job_applications() from public, anon, authenticated;

drop trigger if exists trg_block_closed_job_applications on public.job_applications;
create trigger trg_block_closed_job_applications
  before insert or update on public.job_applications
  for each row execute function public.block_closed_job_applications();

-- Historique d'une offre publiée : ni l'offre ni ses candidatures ne
-- s'effacent hors maintenance (aucun parcours administratif de purge n'est
-- validé). Couvre la suppression directe en clé service et les cascades
-- (suppression d'une entreprise, d'un profil ou d'un compte). Une offre
-- jamais publiée reste supprimable (delete_job).
create or replace function public.job_history_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- jobs : l'offre elle-même ; job_applications : son offre.
  v_job uuid := coalesce((to_jsonb(old) ->> 'job_id')::uuid, old.id);
begin
  if public.job_history_maintenance() then
    return old;
  end if;
  if public.job_was_published(array[v_job]) then
    raise exception 'job_history_protected' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.job_history_guard() from public, anon, authenticated;

drop trigger if exists trg_job_history_guard on public.jobs;
create trigger trg_job_history_guard
  before delete on public.jobs
  for each row execute function public.job_history_guard();

drop trigger if exists trg_job_application_history_guard on public.job_applications;
create trigger trg_job_application_history_guard
  before delete on public.job_applications
  for each row execute function public.job_history_guard();

-- ════════════════════════════════════════════════════════════════════
-- 4. Suppression (reprise de 20261101140000) : jamais après publication
-- ════════════════════════════════════════════════════════════════════
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

  v_job_ids := public.job_offer_ids(p_job_id, v_company_id);
  if v_job_ids is null or not (p_job_id = any (v_job_ids)) then
    raise exception 'job_not_found';
  end if;

  perform 1 from public.job_applications a
  where a.job_id = any (v_job_ids) order by a.id for update;
  perform 1 from public.jobs j
  where j.id = any (v_job_ids) order by j.id for update;

  if public.job_has_commitments(v_job_ids) then
    raise exception 'job_has_commitments';
  end if;
  -- Lot 17d-1 : une offre déjà publiée se clôture (close_job), elle ne
  -- s'efface pas.
  if public.job_was_published(v_job_ids) then
    raise exception 'job_published';
  end if;

  delete from public.jobs j where j.id = p_job_id;
  return p_job_id;
end;
$$;

revoke all on function public.delete_job(uuid) from public, anon;
grant execute on function public.delete_job(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Clôture
-- ════════════════════════════════════════════════════════════════════
create or replace function public.close_job(p_job_id uuid, p_reason text)
returns table (
  job_id uuid,
  status public.job_status,
  closed_at timestamptz,
  notified_users integer,
  already_closed boolean
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
  v_job_ids uuid[];
  v_job public.jobs;
  v_closure public.job_closures;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_open integer;
  v_users uuid[];
  v_user uuid;
  v_locale text;
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

  -- Dossier non exigé : une entreprise en revue clôt ses offres.
  select cp.id, cp.is_active into v_company
  from public.company_profiles cp where cp.user_id = v_uid;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  v_job_ids := public.job_offer_ids(p_job_id, v_company.id);
  if v_job_ids is null or not (p_job_id = any (v_job_ids)) then
    raise exception 'job_not_found';
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'closure_reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'closure_reason_too_long';
  end if;

  perform 1 from public.job_applications a
  where a.job_id = any (v_job_ids) order by a.id for update;
  perform 1 from public.jobs j
  where j.id = any (v_job_ids) order by j.id for update;

  select j.* into v_job from public.jobs j where j.id = p_job_id;

  -- Relance après succès : résultat d'origine, sans nouvelle écriture.
  select c.* into v_closure from public.job_closures c where c.job_id = p_job_id;
  if found then
    return query select p_job_id, v_job.status, v_closure.closed_at,
      v_closure.notified_users, true;
    return;
  end if;

  if public.job_has_commitments(v_job_ids) then
    raise exception 'job_has_commitments';
  end if;
  if not public.job_was_published(v_job_ids) then
    raise exception 'job_not_published';
  end if;
  -- Offre déjà annulée hors de ce parcours (historique) : rien à clore.
  if v_job.status = 'cancelled' then
    raise exception 'job_not_closable';
  end if;

  select count(*)::integer,
         coalesce(array_agg(distinct cp.user_id) filter (where cp.user_id is not null), '{}')
  into v_open, v_users
  from public.job_applications a
  join public.candidate_profiles cp on cp.id = a.candidate_id
  where a.job_id = any (v_job_ids) and a.status in ('pending', 'shortlisted');

  update public.jobs j
  set status = 'cancelled', closed_at = now()
  where j.id = any (v_job_ids);

  insert into public.job_closures (
    job_id, company_id, closed_by, reason, previous_status,
    open_applications, notified_users, closed_at)
  values (p_job_id, v_company.id, v_uid, v_reason, v_job.status,
          v_open, cardinality(v_users), now())
  returning * into v_closure;

  foreach v_user in array v_users loop
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_user;
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_user, 'application_update',
      case when v_locale = 'en' then 'Job closed by the company' else 'Offre clôturée par l''entreprise' end,
      case when v_locale = 'en'
        then 'The company closed the job "' || v_job.title || '". No one will be selected for it. Your application stays in your history; it was not rejected.'
        else 'L''entreprise a clôturé l''offre « ' || v_job.title || ' ». Aucune sélection n''aura lieu. Votre candidature reste dans votre historique ; elle n''a pas été refusée.'
      end,
      jsonb_build_object('kind', 'job_closed', 'job_id', p_job_id, 'href', '/my-jobs'));
  end loop;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'close_job', 'jobs', p_job_id,
          jsonb_build_object('company_id', v_company.id,
                             'previous_status', v_job.status,
                             'job_ids', to_jsonb(v_job_ids),
                             'open_applications', v_open,
                             'notified_users', cardinality(v_users)));

  return query select p_job_id, 'cancelled'::public.job_status, v_closure.closed_at,
    v_closure.notified_users, false;
end;
$$;

revoke all on function public.close_job(uuid, text) from public, anon;
grant execute on function public.close_job(uuid, text) to authenticated;

-- Action proposée par l'écran entreprise pour chacune de ses offres
-- (calculée par la base ; la RPC tranche de nouveau à l'envoi).
create or replace function public.my_job_removal_actions()
returns table (job_id uuid, action text, closed_at timestamptz, closure_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id,
         case
           when j.closed_at is not null then 'closed'
           when public.job_has_commitments(public.job_offer_ids(j.id, j.company_id)) then 'support'
           when j.status = 'cancelled' then 'none'
           when public.job_was_published(public.job_offer_ids(j.id, j.company_id)) then 'close'
           else 'delete' end,
         j.closed_at,
         c.reason
  from public.jobs j
  join public.company_profiles cp on cp.id = j.company_id
  left join public.job_closures c on c.job_id = j.id
  where cp.user_id = (select auth.uid())
    and j.parent_job_id is null;
$$;
revoke all on function public.my_job_removal_actions() from public, anon;
grant execute on function public.my_job_removal_actions() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Visibilité
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261111130000 : une offre clôturée reste lisible par les
-- candidats qui y ont postulé (historique) ; jamais par un nouveau candidat.
drop policy if exists "Published jobs are viewable by all" on public.jobs;
create policy "Published jobs are viewable by all" on public.jobs
  for select
  using (
    (status = 'active'::public.job_status
     and (public.company_dossier_valid(company_id)
          or public.candidate_applied_to_job(id)))
    or (closed_at is not null and public.candidate_applied_to_job(id))
    or company_id in (
      select company_profiles.id from public.company_profiles
      where company_profiles.user_id = (select auth.uid()))
  );

-- Reprise de 20261112120000 : lien direct vers une offre clôturée →
-- « clôturée par l'entreprise », jamais candidature possible.
create or replace function public.job_availability(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when j.id is not null and j.closed_at is not null then 'closed_by_company'
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
