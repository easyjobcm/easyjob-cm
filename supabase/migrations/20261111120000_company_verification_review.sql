-- Migration : vérification du dossier entreprise par l'équipe EasyJob (lot 11)
-- Date : 2026-11-11
-- Tables affectées : company_profiles (colonnes, privilèges, trigger),
--                    company_verification_checks (nouvelle, historique),
--                    audit_logs (traces), notifications (décision)
-- Fonctions : protect_company_profile_columns (reprise du lot 5b),
--             company_dossier_missing, company_check_status,
--             company_verification_complete, my_company_verification,
--             submit_company_verification, admin_record_company_check,
--             admin_review_company ; create_job, update_job, moderate_job
--             (reprises : seul le contrôle du dossier change)
--
-- Décision produit (2026-11-11) : au lancement, seules les entreprises dont le
-- dossier est vérifié publient. Particuliers et professionnels non formalisés
-- sont reportés (PLAN_ACTION.md).
--
-- Dossier exigé (company_dossier_missing) :
--   RCCM          : numéro + document (documents_url) ;
--   NIU           : numéro (saisi à l'inscription) + attestation
--                   (niu_document_path) ;
--   représentant  : nom, fonction, habilitation (`listed_officer` : dirigeant
--                   mentionné dans les justificatifs ; `mandate` : mandat de
--                   l'entreprise), pièce d'identité, mandat si `mandate`.
-- Tous les fichiers sont dans le bucket privé company-documents, dossier
-- <auth.uid()>/ (politiques du lot 5b : propriétaire et admins actifs).
--
-- Contrôles manuels (admin_record_company_check, admin_ops/admin_founder
-- actifs) : un contrôle par élément, sur la révision courante de l'élément.
--   rccm           : source `official_registry` ou `court_registry` (greffe) ;
--   niu            : source `dgi_online` ou `dgi_office` (service officiel DGI) ;
--   representative : source `rccm_extract` (dirigeant mentionné) ou `mandate`.
-- Décisions : approved (source + référence ou note interne obligatoires),
-- rejected (motif communiqué à l'entreprise), unverifiable (vérification
-- externe impossible : note obligatoire, le dossier reste en attente).
-- Aucune vérification automatique : la base enregistre ce que l'admin a
-- constaté auprès de la source officielle.
--
-- Historique : company_verification_checks est en ajout seul (UPDATE refusé),
-- illisible en session (RLS sans politique, aucun privilège) : la note
-- interne n'est jamais lue par l'entreprise. L'entreprise lit l'état de ses
-- contrôles et les motifs par my_company_verification().
--
-- Révisions : chaque élément a sa révision (rccm_revision, niu_revision,
-- representative_revision), le dossier la sienne (verification_revision).
-- Le trigger les augmente pour TOUT auteur (session, clé service, support) :
--   identité de l'entreprise (raison sociale, nom légal) → les trois
--     contrôles : elle doit correspondre au registre, à la DGI et à
--     l'habilitation du représentant ;
--   rccm           ← numéro RCCM, document RCCM ;
--   niu            ← NIU, attestation NIU (niu_verified := false) ;
--   representative ← champs et pièces du représentant, numéro et document
--                    RCCM (le dirigeant est vérifié sur l'immatriculation).
-- Une approbation porte sur la révision de l'élément : toute modification de
-- l'élément l'invalide sans effacer l'historique. Une entreprise vérifiée qui
-- modifie un élément repasse en revue (file admin).
--
-- Publication : company_verification_complete() (statut verified, trois
-- contrôles approuvés sur les révisions courantes, pièces présentes, compte et
-- entreprise actifs) remplace le seul test du statut dans create_job,
-- update_job et moderate_job. Les offres déjà actives et les missions,
-- contrats et engagements ne sont pas modifiés par une remise en revue
-- (décision produit en attente, AUDIT.md §29).
--
-- Reprise des données : aucun ancien dossier n'est réputé NIU ou représentant
-- vérifié. Les entreprises 'verified' repassent en 'pending' non soumis et
-- niu_verified repasse à false ; l'état précédent est conservé dans
-- audit_logs (`legacy_company_verification_reset`). Elles complètent leur
-- dossier puis le soumettent.
--
-- Rollback : NE PAS ouvrir en écriture de session les colonnes de revue ni la
-- table des contrôles. Retour arrière complet :
--   reprendre create_job (20261107120000), update_job (20261107150000),
--   moderate_job (20261101140000) et protect_company_profile_columns
--   (20261101130000) ;
--   drop function public.admin_review_company(uuid, text, text, integer),
--     public.admin_record_company_check(uuid, text, text, text, text, text, integer, uuid),
--     public.submit_company_verification(), public.my_company_verification(),
--     public.company_verification_complete(uuid),
--     public.company_check_status(public.company_profiles, text),
--     public.company_dossier_missing(public.company_profiles);
--   drop table public.company_verification_checks;
--   alter table public.company_profiles drop column … (colonnes ci-dessous).
-- Les statuts remis en 'pending' par la reprise ne sont pas restaurés
-- automatiquement (audit_logs les liste).

-- ── 1. Colonnes ────────────────────────────────────────────────────
alter table public.company_profiles
  add column if not exists verification_revision integer not null default 1,
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_reviewed_revision integer,
  add column if not exists rccm_revision integer not null default 1,
  add column if not exists niu_revision integer not null default 1,
  add column if not exists representative_revision integer not null default 1,
  add column if not exists niu_document_path text,
  add column if not exists representative_name text,
  add column if not exists representative_title text,
  add column if not exists representative_authority text,
  add column if not exists representative_id_document_path text,
  add column if not exists representative_mandate_path text;

alter table public.company_profiles
  drop constraint if exists company_profiles_representative_authority_check;
alter table public.company_profiles
  add constraint company_profiles_representative_authority_check
  check (representative_authority is null
         or representative_authority in ('listed_officer', 'mandate'));

comment on column public.company_profiles.verification_revision is
  'Version du dossier (tous éléments contrôlés) : +1 à chaque changement ou soumission. Trigger et RPC uniquement.';
comment on column public.company_profiles.rccm_revision is
  'Version de l''élément RCCM (raison sociale, numéro, document). Trigger uniquement.';
comment on column public.company_profiles.niu_revision is
  'Version de l''élément NIU (raison sociale, NIU, attestation). Trigger uniquement.';
comment on column public.company_profiles.representative_revision is
  'Version de l''élément représentant (identité, habilitation, pièces, document RCCM). Trigger uniquement.';
comment on column public.company_profiles.verification_submitted_at is
  'Dernière soumission du dossier à la revue EasyJob (file admin).';
comment on column public.company_profiles.verification_reviewed_at is
  'Dernière décision finale sur le dossier.';
comment on column public.company_profiles.verification_reviewed_revision is
  'Version du dossier sur laquelle porte la dernière décision finale.';
comment on column public.company_profiles.representative_authority is
  'listed_officer : dirigeant mentionné dans les justificatifs ; mandate : mandat de l''entreprise.';

-- Pièces et identité du représentant : écrites par PUT /api/company/onboarding
-- en session (colonnes ajoutées au GRANT du lot 5b, chemins contrôlés par le
-- trigger). Les colonnes de revue restent hors GRANT.
grant update (
  niu_document_path, representative_name, representative_title,
  representative_authority, representative_id_document_path,
  representative_mandate_path
) on table public.company_profiles to authenticated;

-- ── 2. Historique des contrôles ────────────────────────────────────
create table if not exists public.company_verification_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  check_type text not null check (check_type in ('rccm', 'niu', 'representative')),
  decision text not null check (decision in ('approved', 'rejected', 'unverifiable')),
  check_revision integer not null,
  dossier_revision integer not null,
  source text,
  reference_note text,
  reason text,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_role text,
  decided_at timestamptz not null default now(),
  constraint company_verification_checks_source_check check (
    source is null
    or (check_type = 'rccm' and source in ('official_registry', 'court_registry'))
    or (check_type = 'niu' and source in ('dgi_online', 'dgi_office'))
    or (check_type = 'representative' and source in ('rccm_extract', 'mandate'))
  ),
  constraint company_verification_checks_decision_fields check (
    (decision = 'approved' and source is not null and reference_note is not null)
    or (decision = 'rejected' and reason is not null)
    or (decision = 'unverifiable' and reference_note is not null)
  )
);

comment on table public.company_verification_checks is
  'Historique des contrôles manuels du dossier entreprise (lot 11). Ajout seul, lecture en clé service ou par RPC.';
comment on column public.company_verification_checks.reference_note is
  'Référence ou note interne (jamais montrée à l''entreprise).';
comment on column public.company_verification_checks.reason is
  'Motif communiqué à l''entreprise (refus).';

create index if not exists company_verification_checks_company_idx
  on public.company_verification_checks (company_id, check_type, decided_at desc);

alter table public.company_verification_checks enable row level security;
revoke all on table public.company_verification_checks from public, anon, authenticated;

create or replace function public.protect_company_verification_checks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'company_verification_checks: history is append-only'
    using errcode = '42501';
end;
$$;
revoke all on function public.protect_company_verification_checks() from public, anon, authenticated;

drop trigger if exists trg_protect_company_verification_checks on public.company_verification_checks;
create trigger trg_protect_company_verification_checks
  before update on public.company_verification_checks
  for each row execute function public.protect_company_verification_checks();

-- Signal minimal (lot 7d) : l'entreprise et la file admin relisent.
create or replace function public.rt_on_company_verification_checks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_users(
    array[public.rt_company_user(new.company_id)], 'profile', new.company_id);
  perform public.rt_signal_admin('profile');
  return null;
end;
$$;
revoke all on function public.rt_on_company_verification_checks() from public, anon, authenticated;

drop trigger if exists trg_rt_company_verification_checks on public.company_verification_checks;
create trigger trg_rt_company_verification_checks
  after insert on public.company_verification_checks
  for each row execute function public.rt_on_company_verification_checks();

-- ── 3. Trigger de protection et révisions ──────────────────────────
-- Reprise du lot 5b. Session : liste blanche et dossier des fichiers.
-- Tout auteur : révisions des éléments contrôlés et nouvelle revue.
create or replace function public.protect_company_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session boolean := current_user in ('anon', 'authenticated');
  v_identity boolean;
  v_rccm boolean;
  v_niu boolean;
  v_rep boolean;
  v_path text;
begin
  if tg_op = 'DELETE' then
    if v_session then
      raise exception 'company_profiles: profile creation and deletion are server-side only'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_session then
      raise exception 'company_profiles: profile creation and deletion are server-side only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_session then
    -- Même liste que les GRANT UPDATE (lot 5b et ci-dessus), plus updated_at.
    if (to_jsonb(new) - array[
          'company_name', 'sector', 'company_size', 'website', 'description',
          'rccm', 'city', 'quartier', 'address', 'documents_url',
          'onboarding_status', 'onboarding_step', 'updated_at',
          'niu_document_path', 'representative_name', 'representative_title',
          'representative_authority', 'representative_id_document_path',
          'representative_mandate_path'])
       is distinct from
       (to_jsonb(old) - array[
          'company_name', 'sector', 'company_size', 'website', 'description',
          'rccm', 'city', 'quartier', 'address', 'documents_url',
          'onboarding_status', 'onboarding_step', 'updated_at',
          'niu_document_path', 'representative_name', 'representative_title',
          'representative_authority', 'representative_id_document_path',
          'representative_mandate_path'])
    then
      raise exception 'company_profiles: protected columns are server-side only'
        using errcode = '42501';
    end if;

    -- Toute pièce examinée par l'admin doit être dans le dossier de
    -- l'entreprise (bucket company-documents, un dossier par auth.uid()).
    for v_path in
      select p from unnest(
        case when new.documents_url is distinct from old.documents_url
             then coalesce(new.documents_url, '{}'::text[]) else '{}'::text[] end
        || array_remove(array[
             case when new.niu_document_path is distinct from old.niu_document_path
                  then coalesce(new.niu_document_path, '') end,
             case when new.representative_id_document_path
                       is distinct from old.representative_id_document_path
                  then coalesce(new.representative_id_document_path, '') end,
             case when new.representative_mandate_path
                       is distinct from old.representative_mandate_path
                  then coalesce(new.representative_mandate_path, '') end], null)
      ) as p
    loop
      if v_path is null
         or (v_path <> '' and (split_part(v_path, '/', 1) <> (select auth.uid())::text
                               or v_path like '%..%'))
      then
        raise exception 'company_profiles: documents must belong to the company'
          using errcode = '42501';
      end if;
    end loop;
  end if;

  -- Dépendances entre éléments et contrôles (AUDIT.md §29) : l'identité de
  -- l'entreprise touche les trois correspondances.
  v_identity := (new.company_name, new.legal_name)
                is distinct from (old.company_name, old.legal_name);
  v_rccm := v_identity
            or (new.rccm, new.documents_url)
               is distinct from (old.rccm, old.documents_url);
  v_niu := v_identity
           or (new.niu, new.niu_document_path)
              is distinct from (old.niu, old.niu_document_path);
  v_rep := v_identity
           or (new.representative_name, new.representative_title,
               new.representative_authority, new.representative_id_document_path,
               new.representative_mandate_path, new.rccm, new.documents_url)
              is distinct from
              (old.representative_name, old.representative_title,
               old.representative_authority, old.representative_id_document_path,
               old.representative_mandate_path, old.rccm, old.documents_url);

  if v_rccm then
    new.rccm_revision := old.rccm_revision + 1;
  end if;
  if v_niu then
    new.niu_revision := old.niu_revision + 1;
    -- Le NIU certifié l'était pour l'ancienne version de l'élément.
    new.niu_verified := false;
  end if;
  if v_rep then
    new.representative_revision := old.representative_revision + 1;
  end if;

  if v_rccm or v_niu or v_rep then
    -- Une fiche admin ouverte sur l'ancienne version ne peut plus décider.
    new.verification_revision := old.verification_revision + 1;
    -- Lot 5b : une entreprise vérifiée qui modifie son dossier repasse en
    -- revue et retourne dans la file admin.
    if old.verification_status = 'verified' then
      new.verification_status := 'pending';
      new.verification_rejection_reason := null;
      new.verification_submitted_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_company_profile_columns() from public, anon, authenticated;

-- ── 4. Règles partagées ────────────────────────────────────────────
-- Pièces manquantes, en codes stables (traduits par l'interface).
create or replace function public.company_dossier_missing(p public.company_profiles)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when nullif(btrim(p.rccm), '') is null then 'rccm_number' end,
    case when coalesce(cardinality(p.documents_url), 0) = 0 then 'rccm_document' end,
    case when nullif(btrim(p.niu), '') is null then 'niu_number' end,
    case when nullif(btrim(p.niu_document_path), '') is null then 'niu_document' end,
    case when nullif(btrim(p.representative_name), '') is null then 'representative_name' end,
    case when nullif(btrim(p.representative_title), '') is null then 'representative_title' end,
    case when p.representative_authority is null then 'representative_authority' end,
    case when nullif(btrim(p.representative_id_document_path), '') is null
         then 'representative_id_document' end,
    case when p.representative_authority = 'mandate'
              and nullif(btrim(p.representative_mandate_path), '') is null
         then 'mandate_document' end
  ], null);
$$;
revoke all on function public.company_dossier_missing(public.company_profiles) from public, anon, authenticated;

-- État d'un contrôle sur la révision COURANTE de l'élément : dernière
-- décision portant sur cette révision, sinon 'pending'.
create or replace function public.company_check_status(p public.company_profiles, p_check text)
returns table (status text, reason text, decided_at timestamptz, decision_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.decision, 'pending'), c.reason, c.decided_at, c.id
  from (select 1) one
  left join lateral (
    select k.decision, k.reason, k.decided_at, k.id
    from public.company_verification_checks k
    where k.company_id = p.id
      and k.check_type = p_check
      and k.check_revision = case p_check
            when 'rccm' then p.rccm_revision
            when 'niu' then p.niu_revision
            else p.representative_revision end
    order by k.decided_at desc, k.id desc
    limit 1
  ) c on true;
$$;
revoke all on function public.company_check_status(public.company_profiles, text) from public, anon, authenticated;

-- Droit de publier : relu par create_job, update_job et moderate_job.
create or replace function public.company_verification_complete(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.company_profiles;
  v_user_active boolean;
  v_role text;
begin
  select * into v_company from public.company_profiles cp where cp.id = p_company_id;
  if not found then
    return false;
  end if;
  select u.is_active, u.role::text into v_user_active, v_role
  from public.users u where u.id = v_company.user_id;

  return v_company.verification_status = 'verified'
     and v_company.is_active is not false
     and v_user_active is not false
     and v_role in ('company', 'company_premium')
     and cardinality(public.company_dossier_missing(v_company)) = 0
     and (select status from public.company_check_status(v_company, 'rccm')) = 'approved'
     and (select status from public.company_check_status(v_company, 'niu')) = 'approved'
     and (select status from public.company_check_status(v_company, 'representative')) = 'approved';
end;
$$;
revoke all on function public.company_verification_complete(uuid) from public, anon, authenticated;

-- ── 5. Lecture par l'entreprise ────────────────────────────────────
-- Statut de ses contrôles et motifs, jamais la note interne ni l'auteur.
create or replace function public.my_company_verification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.company_profiles;
  v_checks jsonb := '{}'::jsonb;
  v_check text;
  v_state record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_company from public.company_profiles cp where cp.user_id = auth.uid();
  if not found then
    return null;
  end if;
  foreach v_check in array array['rccm', 'niu', 'representative'] loop
    select * into v_state from public.company_check_status(v_company, v_check);
    v_checks := v_checks || jsonb_build_object(v_check, jsonb_build_object(
      -- « Vérification impossible » reste « en cours » pour l'entreprise.
      'status', case when v_state.status = 'unverifiable' then 'pending' else v_state.status end,
      'reason', case when v_state.status = 'rejected' then v_state.reason end));
  end loop;
  return jsonb_build_object(
    'status', v_company.verification_status,
    'submitted_at', v_company.verification_submitted_at,
    'reviewed_at', v_company.verification_reviewed_at,
    'rejection_reason', case when v_company.verification_status = 'rejected'
                             then v_company.verification_rejection_reason end,
    'missing', to_jsonb(public.company_dossier_missing(v_company)),
    'checks', v_checks);
end;
$$;
revoke all on function public.my_company_verification() from public, anon;
grant execute on function public.my_company_verification() to authenticated;

-- ── 6. Soumission par l'entreprise ─────────────────────────────────
create or replace function public.submit_company_verification()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_active boolean;
  v_company public.company_profiles;
  v_outcome text;
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

  select * into v_company
  from public.company_profiles cp where cp.user_id = v_uid
  for update;
  if not found then
    raise exception 'company_not_found' using errcode = '42501';
  end if;
  if v_company.is_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  if v_company.verification_status = 'verified' then
    return jsonb_build_object('outcome', 'already_verified', 'status', 'verified',
                              'revision', v_company.verification_revision);
  end if;
  if v_company.verification_status = 'pending'
     and v_company.verification_submitted_at is not null then
    return jsonb_build_object('outcome', 'already_pending', 'status', 'pending',
                              'revision', v_company.verification_revision);
  end if;

  if v_company.onboarding_status is distinct from 'completed'
     or cardinality(public.company_dossier_missing(v_company)) > 0 then
    raise exception 'dossier_incomplete';
  end if;
  if v_company.verification_status = 'rejected'
     and v_company.verification_revision
         <= coalesce(v_company.verification_reviewed_revision, 0) then
    raise exception 'nothing_changed';
  end if;

  v_outcome := case when v_company.verification_status = 'rejected'
                    then 'resubmitted' else 'submitted' end;

  update public.company_profiles cp set
    verification_status = 'pending',
    verification_rejection_reason = null,
    verification_submitted_at = now(),
    verification_revision = cp.verification_revision + 1
  where cp.id = v_company.id
  returning * into v_company;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'submit_company_verification', 'company_profiles', v_company.id,
          jsonb_build_object('outcome', v_outcome, 'revision', v_company.verification_revision));

  return jsonb_build_object('outcome', v_outcome, 'status', 'pending',
                            'revision', v_company.verification_revision);
end;
$$;
revoke all on function public.submit_company_verification() from public, anon;
grant execute on function public.submit_company_verification() to authenticated;

-- ── 7. Contrôle d'un élément par l'admin ───────────────────────────
-- p_seen_revision : version du dossier lue ; p_seen_check : dernière
-- décision de ce contrôle affichée (null si aucune). Deux clics ou deux
-- admins sur la même vue : la seconde écriture reçoit check_changed.
create or replace function public.admin_record_company_check(
  p_company_id uuid,
  p_check text,
  p_decision text,
  p_source text,
  p_reference text,
  p_reason text,
  p_seen_revision integer,
  p_seen_check uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_company public.company_profiles;
  v_reference text := nullif(btrim(p_reference), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_source text := nullif(btrim(p_source), '');
  v_last uuid;
  v_check_revision integer;
  v_missing text[];
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;

  if p_check is null or p_check not in ('rccm', 'niu', 'representative') then
    raise exception 'invalid_check';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected', 'unverifiable') then
    raise exception 'invalid_action';
  end if;
  if p_decision = 'approved' and (
       v_source is null
       or (p_check = 'rccm' and v_source not in ('official_registry', 'court_registry'))
       or (p_check = 'niu' and v_source not in ('dgi_online', 'dgi_office'))
       or (p_check = 'representative' and v_source not in ('rccm_extract', 'mandate'))) then
    raise exception 'source_required';
  end if;
  if v_source is not null and (
       (p_check = 'rccm' and v_source not in ('official_registry', 'court_registry'))
       or (p_check = 'niu' and v_source not in ('dgi_online', 'dgi_office'))
       or (p_check = 'representative' and v_source not in ('rccm_extract', 'mandate'))) then
    raise exception 'source_required';
  end if;
  if p_decision in ('approved', 'unverifiable')
     and (v_reference is null or char_length(v_reference) < 3) then
    raise exception 'reference_required';
  end if;
  if char_length(v_reference) > 300 then
    raise exception 'reference_too_long';
  end if;
  if p_decision = 'rejected' and (v_reason is null or char_length(v_reason) < 10) then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into v_company
  from public.company_profiles cp where cp.id = p_company_id
  for update;
  if not found then
    raise exception 'company_not_found';
  end if;
  if v_company.verification_status is distinct from 'pending' then
    raise exception 'company_not_pending';
  end if;
  if v_company.verification_submitted_at is null then
    raise exception 'dossier_not_submitted';
  end if;
  if p_seen_revision is null
     or v_company.verification_revision is distinct from p_seen_revision then
    raise exception 'company_changed';
  end if;

  select k.id into v_last
  from public.company_verification_checks k
  where k.company_id = v_company.id and k.check_type = p_check
  order by k.decided_at desc, k.id desc
  limit 1;
  if v_last is distinct from p_seen_check then
    raise exception 'check_changed';
  end if;

  if p_decision = 'approved' then
    v_missing := public.company_dossier_missing(v_company);
    if (p_check = 'rccm' and v_missing && array['rccm_number', 'rccm_document'])
       or (p_check = 'niu' and v_missing && array['niu_number', 'niu_document'])
       or (p_check = 'representative' and v_missing && array[
             'representative_name', 'representative_title', 'representative_authority',
             'representative_id_document', 'mandate_document', 'rccm_document']) then
      raise exception 'dossier_incomplete';
    end if;
  end if;

  v_check_revision := case p_check
    when 'rccm' then v_company.rccm_revision
    when 'niu' then v_company.niu_revision
    else v_company.representative_revision end;

  insert into public.company_verification_checks (
    company_id, check_type, decision, check_revision, dossier_revision,
    source, reference_note, reason, decided_by, decided_by_role)
  values (
    v_company.id, p_check, p_decision, v_check_revision, v_company.verification_revision,
    v_source, v_reference,
    case when p_decision = 'rejected' then v_reason end,
    v_uid, v_role)
  returning id into v_id;

  -- niu_verified reflète le contrôle NIU de la version courante.
  if p_check = 'niu' then
    update public.company_profiles cp
    set niu_verified = (p_decision = 'approved')
    where cp.id = v_company.id;
  end if;

  -- Ni référence, ni motif, ni numéro dans la trace : ils restent dans
  -- l'historique des contrôles.
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'record_company_check', 'company_profiles', v_company.id,
          jsonb_build_object('check', p_check, 'decision', p_decision, 'source', v_source,
                             'check_id', v_id, 'check_revision', v_check_revision,
                             'dossier_revision', v_company.verification_revision));

  return jsonb_build_object('check_id', v_id, 'check', p_check, 'decision', p_decision,
                            'revision', v_company.verification_revision);
end;
$$;
revoke all on function public.admin_record_company_check(uuid, text, text, text, text, text, integer, uuid) from public, anon;
grant execute on function public.admin_record_company_check(uuid, text, text, text, text, text, integer, uuid) to authenticated;

-- ── 8. Décision finale ─────────────────────────────────────────────
-- approve : exige les trois contrôles approuvés sur les révisions courantes.
-- request_correction : motif (10 à 500 caractères) communiqué à l'entreprise.
create or replace function public.admin_review_company(
  p_company_id uuid,
  p_action text,
  p_reason text,
  p_seen_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_company public.company_profiles;
  v_previous text;
  v_locale text;
  v_user_id uuid;
  v_checks jsonb := '{}'::jsonb;
  v_check text;
  v_state record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;

  if p_action is null or p_action not in ('approve', 'request_correction') then
    raise exception 'invalid_action';
  end if;
  if p_action = 'request_correction'
     and (v_reason is null or char_length(v_reason) < 10) then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into v_company
  from public.company_profiles cp where cp.id = p_company_id
  for update;
  if not found then
    raise exception 'company_not_found';
  end if;
  if v_company.verification_status is distinct from 'pending' then
    raise exception 'company_not_pending';
  end if;
  if v_company.verification_submitted_at is null then
    raise exception 'dossier_not_submitted';
  end if;
  if p_seen_revision is null
     or v_company.verification_revision is distinct from p_seen_revision then
    raise exception 'company_changed';
  end if;

  foreach v_check in array array['rccm', 'niu', 'representative'] loop
    select * into v_state from public.company_check_status(v_company, v_check);
    v_checks := v_checks || jsonb_build_object(v_check, v_state.decision_id);
    if p_action = 'approve' and v_state.status is distinct from 'approved' then
      raise exception 'checks_incomplete';
    end if;
  end loop;
  if p_action = 'approve'
     and cardinality(public.company_dossier_missing(v_company)) > 0 then
    raise exception 'dossier_incomplete';
  end if;

  v_previous := v_company.verification_status::text;
  v_user_id := v_company.user_id;

  -- Seules les colonnes de revue changent : NIU, plan, réputation,
  -- is_active et contenu du profil restent intacts.
  update public.company_profiles cp set
    verification_status = case when p_action = 'approve' then 'verified' else 'rejected' end::public.verification_status,
    verification_rejection_reason = case when p_action = 'approve' then null else v_reason end,
    verification_reviewed_at = now(),
    verification_reviewed_revision = cp.verification_revision
  where cp.id = v_company.id
  returning * into v_company;

  select coalesce(u.locale::text, 'fr') into v_locale
  from public.users u where u.id = v_user_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_user_id,
    'document_status',
    case
      when p_action = 'approve' and v_locale = 'en' then 'File verified by EasyJob'
      when p_action = 'approve' then 'Dossier vérifié par EasyJob'
      when v_locale = 'en' then 'Company file: correction requested'
      else 'Dossier entreprise : correction demandée' end,
    case
      when p_action = 'approve' and v_locale = 'en'
        then 'Your company file has been verified by EasyJob. You can now post jobs.'
      when p_action = 'approve'
        then 'Votre dossier entreprise est vérifié par EasyJob. Vous pouvez publier des offres.'
      when v_locale = 'en'
        then 'Reason: ' || v_reason || '. Correct your file, then submit it again.'
      else 'Motif : ' || v_reason || '. Corrigez votre dossier puis soumettez-le à nouveau.' end,
    jsonb_build_object(
      'kind', 'company_verification',
      'decision', p_action,
      'href', case when p_action = 'approve' then '/company/dashboard'
                   else '/onboarding/company?step=documents' end)
  );

  -- Contrôles retenus par identifiant ; ni motif, ni numéro, ni chemin.
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (
    v_uid, v_role,
    case when p_action = 'approve' then 'approve_company_verification'
         else 'request_company_correction' end,
    'company_profiles', v_company.id,
    jsonb_build_object('previous_status', v_previous,
                       'revision', v_company.verification_revision,
                       'checks', v_checks));

  return jsonb_build_object('status', v_company.verification_status,
                            'revision', v_company.verification_revision);
end;
$$;
revoke all on function public.admin_review_company(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_review_company(uuid, text, text, integer) to authenticated;

-- ── 9. Reprise des anciens dossiers ────────────────────────────────
-- Aucune ancienne vérification n'est réputée couvrir le NIU et le
-- représentant : trace de l'état précédent, puis remise à zéro.
insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
select null, 'system', 'legacy_company_verification_reset', 'company_profiles', cp.id,
       jsonb_build_object('previous_status', cp.verification_status,
                          'previous_niu_verified', cp.niu_verified,
                          'migration', '20261111120000')
from public.company_profiles cp
where cp.verification_status = 'verified' or cp.niu_verified is true;

update public.company_profiles cp set
  verification_status = case when cp.verification_status = 'verified'
                             then 'pending'::public.verification_status
                             else cp.verification_status end,
  niu_verified = false,
  verification_submitted_at = null
where cp.verification_status = 'verified' or cp.niu_verified is true;

-- Refus antérieurs : une modification est exigée avant resoumission.
update public.company_profiles
set verification_reviewed_revision = verification_revision
where verification_status = 'rejected'
  and verification_reviewed_revision is null;

create index if not exists company_profiles_review_queue_idx
  on public.company_profiles (verification_submitted_at)
  where verification_status = 'pending' and verification_submitted_at is not null;

-- ── 10. Droit de publier dans les RPC d'offres ─────────────────────
-- Reprises à l'identique des dernières définitions, sauf le contrôle du
-- dossier : company_verification_complete() au lieu du seul statut.
-- moderate_job refuse donc d'approuver l'offre d'un recruteur qui a perdu
-- son autorisation après la création de l'offre (company_not_eligible).

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
