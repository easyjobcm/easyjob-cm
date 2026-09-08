-- Migration : catégories de permis de conduire + garde-fou de déclaration
-- Date : 2026-09-08  (T3.1)
-- Tables affectées : candidate_documents (colonne license_category + CHECK),
--                     functions public.skill_requires_license /
--                     public.has_verified_license_for + trigger avant INSERT
--                     sur candidate_skills.
-- Référence : SRS §6.14.1 (section permis) et §6.2/onboarding.
--
-- Objectifs :
--   1. Stocker la CATÉGORIE d'un permis de conduire (colonnes texte libre du
--      titre ne suffisent pas : le garde-fou doit être lisible à la machine).
--      Catégories : moto / voiture / fourgon / camion / bus / tous_types.
--   2. Interdire de DÉCLARER une compétence de conduite (candidate_skills.INSERT)
--      tant que le candidat n'a pas un PERMIS de la bonne catégorie VERIFIÉ
--      (candidate_documents.status = 'verified'). Source de vérité = RLS/DB :
--      le trigger refuse l'insert ; l'UI ne fait qu'afficher le blocage.
--      Le message levé commence par le token `EASYJOB_LICENSE_REQUIRED:` —
--      le client s'appuie sur ce préfixe (stable) pour détecter le cas, sans
--      dépendre d'un code SQLSTATE (RAISE ne peut pas forcer d'errcode custom).
--
-- Idempotent : IF NOT EXISTS / DO blocs. Sûr à rejouer.
-- Rollback (à exécuter manuellement, ordre inverse) :
--   drop trigger if exists trg_enforce_license_for_driving_skill on public.candidate_skills;
--   drop function if exists public.enforce_license_for_driving_skill();
--   drop function if exists public.has_verified_license_for(uuid, text);
--   drop function if exists public.skill_requires_license(text);
--   alter table public.candidate_documents drop constraint if exists candidate_documents_license_category_chk;
--   alter table public.candidate_documents drop column if exists license_category;

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. candidate_documents — catégorie de permis (nulle sinon ; porteuse de
--    sens uniquement quand document_type = 'permis_conduire').
-- ────────────────────────────────────────────────────────────────────
alter table public.candidate_documents
  add column if not exists license_category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'candidate_documents_license_category_chk'
  ) then
    alter table public.candidate_documents
      add constraint candidate_documents_license_category_chk
      check (
        license_category is null
        or license_category = any (array['moto','voiture','fourgon','camion','bus','tous_types'])
      );
  end if;
end $$;

comment on column public.candidate_documents.license_category is
  'Catégorie du permis (moto, voiture, fourgon, camion, bus, tous_types). '
  'Nulle sauf pour document_type = permis_conduire.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Mapping « compétence de conduite -> catégorie de permis requise ».
--    Les noms sont ceux du catalogue (non accentués, texte libre en DB).
--    Cas insensible : lower + trim côté comparaison. Retourne NULL si la
--    compétence n'exige aucun permis (la grande majorité des skills).
-- ────────────────────────────────────────────────────────────────────
create or replace function public.skill_requires_license(p_skill_name text)
returns text
language sql
stable
as $$
  select m.req
  from (values
    ('conduite moto',       'moto'),
    ('taxi moto',           'moto'),
    ('livraison moto',      'moto'),
    ('conduite voiture',    'voiture'),
    ('livraison voiture',   'voiture'),
    ('conduite fourgon',    'fourgon'),
    ('conduite camion',     'camion'),
    ('conduite bus',        'bus')
  ) as m(name, req)
  where lower(coalesce(trim(p_skill_name), '')) = m.name
  limit 1;
$$;

comment on function public.skill_requires_license(text) is
  'Catégorie de permis requise pour déclarer une compétence (NULL = aucun).';

-- ────────────────────────────────────────────────────────────────────
-- 3. Prédicat « le candidat possède-t-il un permis VERIFIÉ dont la catégorie
--    SATISFAIT l'exigence requise pour cette compétence ? » — lecture seule,
--    réutilisable.
--    Modèle par ensemble de « satisfait par » (strict, sans hiérarchie
--    transitive) :
--      moto -> [moto]
--      voiture -> [voiture]
--      fourgon -> [fourgon, camion]   (un permis camion couvre un fourgon)
--      camion -> [camion]
--      bus   -> [bus]
--      tous_types -> [tous_types]
--    ET : un document de catégorie `tous_types` (permis international / tous
--    types) satisfait TOUTE exigence (wildcard). Modèle délibérément simple
--    et testable — pas de notion « bus couvre camion » ni transitive.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.has_verified_license_for(p_candidate_id uuid, p_skill_name text)
returns boolean
language sql
stable
as $$
  with req as (select public.skill_requires_license(p_skill_name) as cat)
  select
    (select cat from req) is null
    or exists (
      select 1
      from (values
        ('moto',       '{moto}'::text[]),
        ('voiture',    '{voiture}'::text[]),
        ('fourgon',    '{fourgon,camion}'::text[]),
        ('camion',     '{camion}'::text[]),
        ('bus',        '{bus}'::text[]),
        ('tous_types', '{tous_types}'::text[])
      ) as v(cat, allowed)
      cross join req
      where v.cat = req.cat
        and exists (
          select 1
          from public.candidate_documents cd
          where cd.candidate_id = p_candidate_id
            and cd.document_type = 'permis_conduire'
            and cd.status = 'verified'
            and (
              cd.license_category = any (v.allowed)
              or cd.license_category = 'tous_types'
            )
        )
    );
$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. Garde-fou : refuse l'INSERT d'une compétence de conduite tant que la
--    catégorie correspondante n'est pas vérifiée (même mécanisme de bypass
--    que le trigger T0 de protection du statut : `easyjob.system_update`).
--    Le message levé commence par le token stable `EASYJOB_LICENSE_REQUIRED:`
--    (préfixe que le client teste) ; aucun errcode custom (impossible en
--    RAISE) — on s'en tient au message, qui est la source lisible.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.enforce_license_for_driving_skill()
returns trigger
language plpgsql
as $$
declare
  v_required text;
begin
  if coalesce(current_setting('easyjob.system_update', true), 'off') <> 'on' then
    v_required := public.skill_requires_license(new.skill_name);
    if v_required is not null
       and not public.has_verified_license_for(new.candidate_id, new.skill_name)
    then
      raise exception 'EASYJOB_LICENSE_REQUIRED: permis ''%'' non verifie',
        v_required;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_license_for_driving_skill on public.candidate_skills;
create trigger trg_enforce_license_for_driving_skill
  before insert on public.candidate_skills
  for each row
  execute function public.enforce_license_for_driving_skill();

end;
