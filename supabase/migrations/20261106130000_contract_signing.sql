-- Migration : signature contrôlée des contrats (lot 7b audit, F-07 partie contrat)
-- Date : 2026-11-06
-- Tables affectées : contracts (colonnes, trigger, privilèges, policy UPDATE
--   supprimée), contract_clause_versions (nouvelle), notifications (écrites
--   par la signature)
-- Fonctions : contract_terms_hash, current_contract_clauses,
--   protect_contract_writes, protect_contract_clause_versions, get_contract,
--   contract_sign_core, sign_contract, sign_contract_observed
--
-- Constat corrigé (docs/audit/AUDIT.md, F-07) : la policy « Users can update
-- own contracts » laissait chaque partie modifier toutes les colonnes de son
-- contrat. Le navigateur calculait l'heure et le statut, et stockait la
-- signature dessinée en data-URL dans la ligne. Un candidat pouvait passer
-- son contrat à 'completed' seul, modifier contract_data ou effacer la
-- signature de l'entreprise. Les parties lisaient aussi l'IP de l'autre.
--
-- Mode de signature (SRS §6.7, §11.1, §11.8 ; US-CONT-02) : consentement
-- électronique explicite (« Signer et accepter » après lecture, case
-- cochée), horodatage serveur et adresse IP, pour les contrats simples
-- comme formalisés au MVP. Aucune image n'est plus produite : les colonnes
-- *_signature_url ne sont plus écrites (valeurs existantes conservées, jamais
-- exposées). Le SRS n'impose aucun ordre : chaque partie peut signer en
-- premier.
--
-- Mécanisme :
--   1. terms_hash : SHA-256 (hex) de la version canonique (jsonb) de
--      { v: 1, contract_id, application_id, job_id, candidate_id, company_id,
--        template, terms: contract_data }.
--      Elle couvre les parties, le format, les conditions figées par
--      select_candidate (intitulé, entreprise, dates, horaires, pause,
--      adresse, ville, taux horaire, devise, mission) et contract_data.clauses :
--      les clauses générales en FR et en EN et la phrase de consentement,
--      copiées à l'insertion depuis la version courante de
--      contract_clause_versions (identifiant de version compris). C'est
--      exactement ce que couvre la case « J'accepte ». Elle ne couvre pas
--      l'identité civile des parties (à figer avec le contrat formalisé et le
--      PDF). Calculée à l'insertion par le trigger, jamais fournie par un
--      client.
--   1b. contract_clause_versions : versions immuables des clauses (UPDATE
--      interdit à tous ; DELETE seulement si aucun contrat ne la cite). La
--      version courante d'un format est la plus récente. Faire évoluer les
--      clauses = insérer une nouvelle version (migration) ; les contrats
--      existants gardent la leur, et l'écran affiche celle du contrat.
--   2. protect_contract_writes (BEFORE INSERT OR UPDATE, tous rôles) :
--      aucune écriture en session ; parties, format, conditions et empreinte
--      immuables ; une signature enregistrée ne change plus ; une nouvelle
--      signature porte l'empreinte courante ; le statut de signature découle
--      des signatures (pending, candidate_signed, company_signed,
--      completed) ; 'completed' est définitif.
--   3. Privilèges : plus d'UPDATE en session (policy supprimée, privilège
--      retiré) ; SELECT limité aux colonnes non sensibles (sans IP, sans
--      identifiant du signataire, sans image).
--   4. get_contract : lecture pour les parties (rôle déduit de auth.uid()),
--      nom de l'entreprise figé, nom du candidat (prénom et initiale pour
--      l'entreprise, F-16), état des signatures, contrôle d'intégrité.
--   5. sign_contract : partie déduite de auth.uid() et du contrat, verrou de
--      la ligne, empreinte présentée = empreinte en base, heure now(),
--      transition calculée, notification de l'autre partie. Relance : une
--      signature déjà enregistrée est renvoyée telle quelle (heure
--      d'origine), sans écriture.
--
-- 'completed' signifie « signé par les deux parties » (valeur SRS v1.1 de
-- l'ancien 'fully_signed') et ne dit rien de l'exécution de la mission
-- (missions.status, lot 7c). La signature ne bloque ni le pointage ni le
-- paiement : décision produit à prendre au lot 7c (SRS §6.7 « les deux
-- parties doivent signer avant que la mission ne démarre officiellement »).
--
-- IP observée : seule la route POST /api/contracts/[id]/sign peut en
-- enregistrer une, via sign_contract_observed (rôle service uniquement).
-- La route déduit l'utilisateur de sa session (auth.getUser) et ne lit
-- l'adresse que sur Vercel, qui écrase x-forwarded-for et fournit
-- x-vercel-forwarded-for (un client ne peut pas les imposer). Hors Vercel,
-- aucune source fiable : l'IP reste absente (null). sign_contract (session,
-- appel direct) n'accepte aucune IP et l'enregistre absente. Une valeur qui
-- n'est pas une adresse est ignorée (null).
--
-- Reprise des données : aucune signature n'est déduite d'un statut.
--   - terms_hash est calculé pour les contrats existants sur leur contenu
--     actuel (qui a pu être modifié par une partie avant cette migration).
--   - Une signature antérieure (signed_at présent, empreinte absente) est
--     conservée mais non vérifiable : get_contract signale needs_review et
--     sign_contract refuse la seconde signature (contract_needs_review).
--   - Un statut incohérent avec les signatures (ex. 'completed' sans les
--     deux) est signalé de même.
--   - Clauses : un contrat sans aucune signature reçoit la version courante
--     (personne n'a encore consenti). Un contrat déjà signé, en tout ou
--     partie, sans clauses figées est conservé tel quel : aucun texte ne lui
--     est attribué ; il est signalé (needs_review) et sa seconde signature est
--     refusée.
--   Requête de contrôle (lecture seule) avant déploiement :
--     select id, status, candidate_signed_at, company_signed_at, created_at
--     from public.contracts
--     where (candidate_signed_at is not null and candidate_terms_hash is null)
--        or (company_signed_at is not null and company_terms_hash is null)
--        or coalesce(status::text, 'pending') not in ('rejected', 'expired',
--           case when candidate_signed_at is not null and company_signed_at is not null then 'completed'
--                when candidate_signed_at is not null then 'candidate_signed'
--                when company_signed_at is not null then 'company_signed'
--                else 'pending' end)
--        or candidate_signature_url like 'data:%'
--        or company_signature_url like 'data:%'
--        or ((candidate_signed_at is not null or company_signed_at is not null)
--            and jsonb_typeof(contract_data->'clauses') is distinct from 'object');
--   Aucun code ne créait de contrat avant le lot 7a : en production, toute
--   ligne antérieure au déploiement de 7a est à examiner.
--
-- Retour arrière : NE PAS recréer la policy UPDATE ni rendre le SELECT de
-- toutes les colonnes. En dernier recours :
--   drop function if exists public.sign_contract(uuid, text);
--   drop function if exists public.sign_contract_observed(uuid, uuid, text, text);
--   drop function if exists public.contract_sign_core(uuid, uuid, text, text);
--   drop function if exists public.get_contract(uuid);
--   drop trigger if exists trg_protect_contract_writes on public.contracts;
--   drop function if exists public.protect_contract_writes();
-- Les colonnes ajoutées et contract_clause_versions peuvent rester (les
-- clauses figées des contrats y renvoient). Transactionnelle et rejouable.

-- ── 1. Colonnes ─────────────────────────────────────────────────────
alter table public.contracts
  add column if not exists terms_hash text,
  add column if not exists candidate_signed_by uuid,
  add column if not exists candidate_terms_hash text,
  add column if not exists company_signed_by uuid,
  add column if not exists company_terms_hash text;

comment on column public.contracts.terms_hash is
  'SHA-256 hex de {v:1, contract_id, application_id, job_id, candidate_id, company_id, template, terms: contract_data} (jsonb canonique). Calculé par trigger, immuable.';
comment on column public.contracts.candidate_terms_hash is
  'Empreinte acceptée par le candidat (= terms_hash au moment de la signature).';
comment on column public.contracts.company_terms_hash is
  'Empreinte acceptée par l''entreprise (= terms_hash au moment de la signature).';
comment on column public.contracts.status is
  'Statut de SIGNATURE : pending, candidate_signed, company_signed, completed (= signé par les deux parties, sans lien avec l''exécution de la mission).';

-- ── 2. Empreinte ────────────────────────────────────────────────────
create or replace function public.contract_terms_hash(c public.contracts)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'contract_id', c.id,
    'application_id', c.application_id,
    'job_id', c.job_id,
    'candidate_id', c.candidate_id,
    'company_id', c.company_id,
    'template', c.contract_template,
    'terms', coalesce(c.contract_data, '{}'::jsonb)
  )::text, 'UTF8')), 'hex');
$$;

revoke all on function public.contract_terms_hash(public.contracts) from public, anon, authenticated;
grant execute on function public.contract_terms_hash(public.contracts) to service_role;

-- Statut attendu d'après les signatures (rejected/expired hors signature).
create or replace function public.contract_expected_status(
  p_candidate_signed_at timestamptz,
  p_company_signed_at timestamptz
)
returns public.contract_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_candidate_signed_at is not null and p_company_signed_at is not null
      then 'completed'::public.contract_status
    when p_candidate_signed_at is not null then 'candidate_signed'::public.contract_status
    when p_company_signed_at is not null then 'company_signed'::public.contract_status
    else 'pending'::public.contract_status
  end;
$$;

revoke all on function public.contract_expected_status(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.contract_expected_status(timestamptz, timestamptz) to service_role;

-- ── 2b. Clauses générales versionnées ──────────────────────────────
create table if not exists public.contract_clause_versions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  contract_template text not null check (contract_template in ('simple', 'formal')),
  body jsonb not null check (
    jsonb_typeof(body->'fr') = 'object' and jsonb_typeof(body->'en') = 'object'
    and (body->'fr') ?& array['intro', 'candidate_title', 'candidate', 'company_title', 'company', 'consent']
    and (body->'en') ?& array['intro', 'candidate_title', 'candidate', 'company_title', 'company', 'consent']
    and jsonb_typeof(body->'fr'->'candidate') = 'array'
    and jsonb_typeof(body->'fr'->'company') = 'array'
    and jsonb_typeof(body->'en'->'candidate') = 'array'
    and jsonb_typeof(body->'en'->'company') = 'array'
  ),
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.contract_clause_versions is
  'Clauses générales et phrase de consentement (FR/EN), immuables. Copiées dans contracts.contract_data.clauses à la création du contrat.';

alter table public.contract_clause_versions enable row level security;
revoke all on table public.contract_clause_versions from public, anon, authenticated;
grant select, insert, delete on table public.contract_clause_versions to service_role;

create or replace function public.protect_contract_clause_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'contract_clause_versions: versions are immutable, insert a new one'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts c
             where c.contract_data->'clauses'->>'version' = old.id) then
    raise exception 'contract_clause_versions: version is referenced by a contract'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_contract_clause_versions() from public, anon, authenticated;

drop trigger if exists trg_protect_contract_clause_versions on public.contract_clause_versions;
create trigger trg_protect_contract_clause_versions
  before update or delete on public.contract_clause_versions
  for each row execute function public.protect_contract_clause_versions();

-- Version initiale : texte affiché par l'écran du contrat avant ce lot.
-- Le contrat formalisé reprend le même texte en attendant la validation
-- juridique (SRS §11.1).
insert into public.contract_clause_versions (id, contract_template, body)
select v.id, v.template, jsonb_build_object(
  'fr', jsonb_build_object(
    'intro', 'Le présent contrat est conclu entre les parties ci-dessus pour la mission décrite.',
    'candidate_title', 'Le candidat s''engage à',
    'candidate', jsonb_build_array(
      'se présenter à l''heure convenue sur le lieu de la mission ;',
      'exécuter les tâches confiées avec professionnalisme ;',
      'respecter les règles de sécurité et d''hygiène ;',
      'utiliser le pointage EasyJob.'),
    'company_title', 'L''entreprise s''engage à',
    'company', jsonb_build_array(
      'fournir un environnement de travail sûr ;',
      'valider les heures effectuées ;',
      'régler la mission selon les conditions de la plateforme.'),
    'consent', 'J''ai lu les conditions ci-dessus et je les accepte. Je comprends que cette acceptation électronique, horodatée, vaut signature.'),
  'en', jsonb_build_object(
    'intro', 'This contract is concluded between the parties above for the mission described.',
    'candidate_title', 'The candidate agrees to',
    'candidate', jsonb_build_array(
      'arrive at the agreed time at the mission location;',
      'carry out the assigned tasks professionally;',
      'follow safety and hygiene rules;',
      'use EasyJob check-in.'),
    'company_title', 'The company agrees to',
    'company', jsonb_build_array(
      'provide a safe working environment;',
      'validate the hours worked;',
      'pay for the mission under the platform''s terms.'),
    'consent', 'I have read the terms above and accept them. I understand that this timestamped electronic acceptance counts as my signature.'))
from (values ('simple-v1', 'simple'), ('formal-v1', 'formal')) as v(id, template)
on conflict (id) do nothing;

-- Version courante d'un format, sous la forme figée dans contract_data.
create or replace function public.current_contract_clauses(p_template text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', v.id) || v.body
  from public.contract_clause_versions v
  where v.contract_template = p_template
  order by v.created_at desc, v.id desc
  limit 1;
$$;

revoke all on function public.current_contract_clauses(text) from public, anon, authenticated;
grant execute on function public.current_contract_clauses(text) to service_role;

-- Reprise (le trigger est retiré le temps de la reprise, puis recréé plus
-- bas ; migration rejouable). Clauses courantes pour les contrats que
-- personne n'a signés ; rien pour les autres.
drop trigger if exists trg_protect_contract_writes on public.contracts;

update public.contracts c
set contract_data = coalesce(c.contract_data, '{}'::jsonb)
  || jsonb_build_object('clauses', public.current_contract_clauses(c.contract_template))
where jsonb_typeof(c.contract_data->'clauses') is distinct from 'object'
  and public.current_contract_clauses(c.contract_template) is not null
  and c.candidate_signed_at is null and c.company_signed_at is null
  and c.candidate_terms_hash is null and c.company_terms_hash is null;

-- Contrats existants : empreinte du contenu actuel (avant le trigger), et
-- recalcul pour les contrats sans signature (clauses ajoutées ci-dessus).
update public.contracts c
set terms_hash = public.contract_terms_hash(c)
where c.terms_hash is null
   or (c.candidate_signed_at is null and c.company_signed_at is null
       and c.candidate_terms_hash is null and c.company_terms_hash is null);

-- ── 3. Écritures ────────────────────────────────────────────────────
create or replace function public.protect_contract_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clauses jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'contracts: use sign_contract'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.candidate_signed_at is not null or new.company_signed_at is not null
       or new.candidate_signed_by is not null or new.company_signed_by is not null
       or new.candidate_terms_hash is not null or new.company_terms_hash is not null
       or new.candidate_signature_url is not null or new.company_signature_url is not null
    then
      raise exception 'contracts: signatures are recorded by sign_contract'
        using errcode = '42501';
    end if;
    new.status := 'pending';
    -- Clauses acceptées : toujours la version courante du format, jamais
    -- une valeur fournie par l'appelant.
    v_clauses := public.current_contract_clauses(new.contract_template);
    if v_clauses is null then
      raise exception 'contracts: no clause version for template %', new.contract_template
        using errcode = '23514';
    end if;
    new.contract_data := coalesce(new.contract_data, '{}'::jsonb)
      || jsonb_build_object('clauses', v_clauses);
    new.terms_hash := public.contract_terms_hash(new);
    return new;
  end if;

  -- UPDATE, tous rôles (y compris clé service et fonctions SECURITY DEFINER).
  if new.id is distinct from old.id
     or new.application_id is distinct from old.application_id
     or new.job_id is distinct from old.job_id
     or new.candidate_id is distinct from old.candidate_id
     or new.company_id is distinct from old.company_id
     or new.contract_template is distinct from old.contract_template
     or new.contract_data is distinct from old.contract_data
     or new.terms_hash is distinct from old.terms_hash
     or new.created_at is distinct from old.created_at
  then
    raise exception 'contracts: parties and terms are frozen'
      using errcode = '42501';
  end if;

  if old.candidate_signed_at is not null and (
       new.candidate_signed_at, new.candidate_signed_by, new.candidate_ip,
       new.candidate_terms_hash, new.candidate_signature_url
     ) is distinct from (
       old.candidate_signed_at, old.candidate_signed_by, old.candidate_ip,
       old.candidate_terms_hash, old.candidate_signature_url
     )
  then
    raise exception 'contracts: signature already recorded'
      using errcode = '42501';
  end if;
  if old.company_signed_at is not null and (
       new.company_signed_at, new.company_signed_by, new.company_ip,
       new.company_terms_hash, new.company_signature_url
     ) is distinct from (
       old.company_signed_at, old.company_signed_by, old.company_ip,
       old.company_terms_hash, old.company_signature_url
     )
  then
    raise exception 'contracts: signature already recorded'
      using errcode = '42501';
  end if;

  -- Une signature non encore donnée ne s'écrit que complète, sur l'empreinte
  -- courante, et sans image.
  if old.candidate_signed_at is null and (
       new.candidate_signed_at, new.candidate_signed_by, new.candidate_ip,
       new.candidate_terms_hash, new.candidate_signature_url
     ) is distinct from (
       old.candidate_signed_at, old.candidate_signed_by, old.candidate_ip,
       old.candidate_terms_hash, old.candidate_signature_url
     )
     and (new.candidate_signed_at is null or new.candidate_signed_by is null
          or new.candidate_terms_hash is distinct from new.terms_hash
          or new.candidate_signature_url is distinct from old.candidate_signature_url)
  then
    raise exception 'contracts: invalid signature'
      using errcode = '42501';
  end if;
  if old.company_signed_at is null and (
       new.company_signed_at, new.company_signed_by, new.company_ip,
       new.company_terms_hash, new.company_signature_url
     ) is distinct from (
       old.company_signed_at, old.company_signed_by, old.company_ip,
       old.company_terms_hash, old.company_signature_url
     )
     and (new.company_signed_at is null or new.company_signed_by is null
          or new.company_terms_hash is distinct from new.terms_hash
          or new.company_signature_url is distinct from old.company_signature_url)
  then
    raise exception 'contracts: invalid signature'
      using errcode = '42501';
  end if;

  if old.status = 'completed' and new.status is distinct from old.status then
    raise exception 'contracts: a fully signed contract is final'
      using errcode = '42501';
  end if;

  -- Statut de signature cohérent dès qu'une signature ou le statut change.
  if (new.status is distinct from old.status
      or new.candidate_signed_at is distinct from old.candidate_signed_at
      or new.company_signed_at is distinct from old.company_signed_at)
     and new.status is distinct from 'rejected'
     and new.status is distinct from 'expired'
     and new.status is distinct from public.contract_expected_status(
           new.candidate_signed_at, new.company_signed_at)
  then
    raise exception 'contracts: status must follow signatures'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_contract_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_contract_writes on public.contracts;
create trigger trg_protect_contract_writes
  before insert or update on public.contracts
  for each row execute function public.protect_contract_writes();

-- ── 4. Privilèges ───────────────────────────────────────────────────
drop policy if exists "Users can update own contracts" on public.contracts;

revoke all on table public.contracts from anon, authenticated;
grant select (
  id, application_id, job_id, candidate_id, company_id, contract_template,
  contract_data, status, terms_hash, candidate_signed_at, candidate_terms_hash,
  company_signed_at, company_terms_hash, final_contract_url, expires_at,
  created_at, updated_at
) on table public.contracts to authenticated;

-- ── 5. Lecture par les parties ──────────────────────────────────────
create or replace function public.get_contract(p_contract_id uuid)
returns table (
  contract_id uuid,
  application_id uuid,
  mission_id uuid,
  job_id uuid,
  viewer_party text,
  contract_template text,
  status public.contract_status,
  terms jsonb,
  terms_hash text,
  company_name text,
  candidate_name text,
  candidate_signed_at timestamptz,
  company_signed_at timestamptz,
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
    v_contract.status,
    coalesce(v_contract.contract_data, '{}'::jsonb) - 'mission_id',
    v_contract.terms_hash,
    v_company_name,
    case when v_party = 'candidate'
      then nullif(btrim(concat_ws(' ', v_candidate.first_name, v_candidate.last_name)), '')
      else nullif(btrim(concat_ws(' ', v_candidate.first_name,
             nullif(upper(left(btrim(coalesce(v_candidate.last_name, '')), 1)) || '.', '.'))), '')
    end,
    v_contract.candidate_signed_at,
    v_contract.company_signed_at,
    v_review,
    not v_review
      and coalesce(v_contract.status, 'pending') in ('pending', 'candidate_signed', 'company_signed')
      and case when v_party = 'candidate'
            then v_contract.candidate_signed_at is null
            else v_contract.company_signed_at is null end,
    v_contract.created_at;
end;
$$;

revoke all on function public.get_contract(uuid) from public, anon;
grant execute on function public.get_contract(uuid) to authenticated;

-- ── 6. Signature ────────────────────────────────────────────────────
-- Noyau commun, jamais exposé : p_uid vient de auth.uid() (sign_contract)
-- ou de la session vérifiée par la route (sign_contract_observed).
drop function if exists public.sign_contract(uuid, text, text);

create or replace function public.contract_sign_core(
  p_uid uuid,
  p_contract_id uuid,
  p_terms_hash text,
  p_observed_ip text
)
returns table (
  contract_id uuid,
  status public.contract_status,
  signed_party text,
  candidate_signed_at timestamptz,
  company_signed_at timestamptz,
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
  v_title text;
  v_job_title text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  -- Verrou : deux signatures (ou un double clic) s'exécutent l'une après
  -- l'autre ; la seconde voit la première.
  select c.* into v_contract
  from public.contracts c where c.id = p_contract_id
  for update;
  if not found then
    raise exception 'contract_not_found';
  end if;

  select cp.user_id, cp.first_name, u.locale::text as locale
  into v_candidate
  from public.candidate_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = v_contract.candidate_id;
  select cp.user_id, cp.company_name, cp.is_active, u.locale::text as locale
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

  -- Relance (double clic, réponse perdue) : signature d'origine, sans écriture.
  if (v_party = 'candidate' and v_contract.candidate_signed_at is not null)
     or (v_party = 'company' and v_contract.company_signed_at is not null) then
    return query select v_contract.id, v_contract.status, v_party,
      v_contract.candidate_signed_at, v_contract.company_signed_at, true;
    return;
  end if;

  if not v_party_active then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  if v_contract.status in ('rejected', 'expired') then
    raise exception 'contract_not_signable';
  end if;

  -- Contrat ancien ou incohérent (dont : signé avant que les clauses ne
  -- soient figées) : rien n'est déduit, examen par le support.
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

  -- L'utilisateur consent à la version qu'il a lue.
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
    v_notify_user := v_candidate.user_id;
    v_notify_locale := v_candidate.locale;
  end if;

  v_job_title := coalesce(v_contract.contract_data->>'job_title', '');
  v_title := case
    when v_contract.status = 'completed' then
      case when v_notify_locale = 'en' then 'Contract signed by both parties'
           else 'Contrat signé par les deux parties' end
    else
      case when v_notify_locale = 'en' then 'Contract to sign'
           else 'Contrat à signer' end
  end;

  if v_notify_user is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_notify_user,
      'mission_update',
      v_title,
      case
        when v_contract.status = 'completed' and v_notify_locale = 'en' then
          'The contract for "' || v_job_title || '" is now signed by both parties.'
        when v_contract.status = 'completed' then
          'Le contrat « ' || v_job_title || ' » est signé par les deux parties.'
        when v_party = 'candidate' and v_notify_locale = 'en' then
          coalesce(v_candidate.first_name, 'The candidate') || ' signed the contract for "'
          || v_job_title || '". Your signature is awaited.'
        when v_party = 'candidate' then
          coalesce(v_candidate.first_name, 'Le candidat') || ' a signé le contrat « '
          || v_job_title || ' ». Votre signature est attendue.'
        when v_notify_locale = 'en' then
          coalesce(v_company.company_name, 'The company') || ' signed your contract for "'
          || v_job_title || '". Your signature is awaited.'
        else
          coalesce(v_company.company_name, 'L''entreprise') || ' a signé votre contrat « '
          || v_job_title || ' ». Votre signature est attendue.'
      end,
      jsonb_build_object(
        'contract_id', v_contract.id,
        'application_id', v_contract.application_id,
        'job_id', v_contract.job_id,
        'mission_id', v_contract.contract_data->>'mission_id',
        'contract_status', v_contract.status
      )
    );
  end if;

  return query select v_contract.id, v_contract.status, v_party,
    v_contract.candidate_signed_at, v_contract.company_signed_at, false;
end;
$$;

revoke all on function public.contract_sign_core(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Appel direct en session : identité = auth.uid(), aucune IP acceptée.
create or replace function public.sign_contract(
  p_contract_id uuid,
  p_terms_hash text
)
returns table (
  contract_id uuid,
  status public.contract_status,
  signed_party text,
  candidate_signed_at timestamptz,
  company_signed_at timestamptz,
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

-- Route de l'application (clé service, côté serveur) : utilisateur déduit de
-- la session par auth.getUser(), IP observée par l'infrastructure ou null.
create or replace function public.sign_contract_observed(
  p_user_id uuid,
  p_contract_id uuid,
  p_terms_hash text,
  p_observed_ip text default null
)
returns table (
  contract_id uuid,
  status public.contract_status,
  signed_party text,
  candidate_signed_at timestamptz,
  company_signed_at timestamptz,
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
