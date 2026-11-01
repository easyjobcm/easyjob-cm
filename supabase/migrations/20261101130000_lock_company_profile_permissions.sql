-- Migration : verrouillage des colonnes porteuses de droits de company_profiles (lot 5b audit)
-- Date : 2026-11-01
-- Tables affectées : company_profiles (grants, policies INSERT/UPDATE, trigger)
-- Fonction : protect_company_profile_columns
--
-- Constat corrigé (docs/audit/AUDIT.md) :
--   F-41  company_profiles héritait du GRANT ALL de la baseline et n'avait
--         qu'une policy UPDATE « user_id = auth.uid() » sans WITH CHECK ni
--         restriction de colonnes. Une entreprise pouvait, par appel direct à
--         PostgREST, s'attribuer verification_status = 'verified' (contrôle
--         de POST /api/jobs), niu_verified, un plan (subscription_plan,
--         subscription_tier, échéances, essai), modifier son NIU, ses
--         statistiques (trust_score, notes, compteurs) ou son propriétaire
--         (user_id). La policy INSERT (sans clause TO) permettait aussi de
--         créer sa ligne avec ces valeurs.
--
-- Mécanisme (même principe que les lots 1 et 2) :
--   1. Privilèges de colonnes : frontière principale. authenticated ne garde
--      que UPDATE sur les colonnes écrites par PUT /api/company/onboarding,
--      seul chemin d'écriture en session. Aucun INSERT ni DELETE : le profil
--      est créé par finalizeSignup (service_role) et supprimé avec le compte.
--      Une suppression suivie d'une recréation est donc impossible en
--      session. Refus explicite 42501 pour tout appel PostgREST/GraphQL hors
--      liste.
--   2. Trigger de défense en profondeur fondé sur current_user (rôle
--      d'exécution, non modifiable par le client), jamais sur le GUC
--      easyjob.system_update. Les écritures de confiance passent par
--      service_role ; aucune fonction SECURITY DEFINER n'écrit cette table
--      à la date de la migration. Les suppressions en cascade (compte
--      supprimé) s'exécutent en propriétaire de la table.
--   3. RLS : policy INSERT supprimée (un futur « GRANT ALL » ne rouvre rien) ;
--      policy UPDATE limitée à authenticated, avec WITH CHECK.
--   4. Données vérifiées (décision produit du 2026-11-01, « nouvelle revue ») :
--      une entreprise vérifiée qui modifie sa raison sociale, son RCCM ou son
--      document RCCM repasse en 'pending' dans la même écriture. Le NIU n'est
--      jamais modifiable en session, donc niu_verified n'est pas touché.
--
-- La policy SELECT « Companies can view candidate summaries » (lecture de
-- tous les profils entreprise par une entreprise) relève de F-16 (lot 7a) et
-- n'est pas modifiée ici.
--
-- Reprise des données : aucune. Les valeurs existantes de verification_status,
-- niu_verified et des colonnes de plan ne sont PAS corrigées : leur
-- éventuelle falsification passée se vérifie séparément (requête dans
-- AUDIT.md §16, à exécuter en lecture seule).
--
-- Retour arrière : NE PAS rouvrir les grants ni recréer la policy INSERT
-- (réintroduirait F-41). Si un flux légitime est bloqué, le faire passer par
-- service_role ou une RPC SECURITY DEFINER gardée. En dernier recours, seul
-- le trigger peut être retiré (les privilèges de colonnes restent la
-- protection principale, mais la nouvelle revue disparaît) :
--   drop trigger if exists trg_protect_company_profile_columns on public.company_profiles;
--   drop function if exists public.protect_company_profile_columns();
-- La migration est transactionnelle (aucun effet partiel).

-- ── 1. Privilèges de table / colonnes ───────────────────────────────
-- SELECT est conservé : plusieurs policies d'autres tables (jobs,
-- job_applications, payments…) lisent company_profiles en session.
revoke insert, update, delete, truncate, references, trigger
  on table public.company_profiles from anon, authenticated;
grant select on table public.company_profiles to anon, authenticated;

grant update (
  company_name, sector, company_size, website, description, rccm,
  city, quartier, address, documents_url, onboarding_status, onboarding_step
) on table public.company_profiles to authenticated;

-- ── 2. Policies d'écriture ──────────────────────────────────────────
drop policy if exists "Companies can insert own profile" on public.company_profiles;

drop policy if exists "Companies can update own profile" on public.company_profiles;
create policy "Companies can update own profile" on public.company_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── 3. Défense en profondeur et nouvelle revue ──────────────────────
-- Nom choisi pour s'exécuter après on_company_profiles_updated (ordre
-- alphabétique des triggers BEFORE) : updated_at est déjà posé.
create or replace function public.protect_company_profile_columns()
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

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'company_profiles: profile creation and deletion are server-side only'
      using errcode = '42501';
  end if;

  -- Même liste que le GRANT UPDATE ci-dessus (plus updated_at). Les
  -- colonnes ajoutées plus tard sont protégées par défaut.
  if (to_jsonb(new) - array[
        'company_name', 'sector', 'company_size', 'website', 'description',
        'rccm', 'city', 'quartier', 'address', 'documents_url',
        'onboarding_status', 'onboarding_step', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array[
        'company_name', 'sector', 'company_size', 'website', 'description',
        'rccm', 'city', 'quartier', 'address', 'documents_url',
        'onboarding_status', 'onboarding_step', 'updated_at'])
  then
    raise exception 'company_profiles: protected columns are server-side only'
      using errcode = '42501';
  end if;

  -- Le document RCCM est examiné par l'admin comme celui de l'entreprise :
  -- il doit se trouver dans le dossier de l'entreprise (bucket
  -- company-documents, un dossier par auth.uid()).
  if new.documents_url is distinct from old.documents_url
     and exists (
       select 1 from unnest(new.documents_url) p
       where p is null
          or split_part(p, '/', 1) <> (select auth.uid())::text
          or p like '%..%')
  then
    raise exception 'company_profiles: documents must belong to the company'
      using errcode = '42501';
  end if;

  if old.verification_status = 'verified'
     and (new.company_name is distinct from old.company_name
          or new.rccm is distinct from old.rccm
          or new.documents_url is distinct from old.documents_url)
  then
    new.verification_status := 'pending';
    new.verification_rejection_reason := null;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_company_profile_columns() from public, anon, authenticated;

drop trigger if exists trg_protect_company_profile_columns on public.company_profiles;
create trigger trg_protect_company_profile_columns
  before insert or update or delete on public.company_profiles
  for each row execute function public.protect_company_profile_columns();
