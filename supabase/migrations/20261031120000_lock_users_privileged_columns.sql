-- Migration : verrouillage des colonnes porteuses de droits de public.users (lot 1 audit)
-- Date : 2026-10-31
-- Tables affectées : users (grants, policy INSERT, trigger), fonction handle_new_user
--
-- Constats corrigés (docs/audit/AUDIT.md) :
--   F-01  policy UPDATE « Users can update own profile » sans restriction de
--         colonnes : un utilisateur pouvait écrire role, is_active,
--         phone_verified, no_show_count, ban_*… sur sa propre ligne.
--   F-02  policy INSERT « Service role can insert users » WITH CHECK (true)
--         sans clause TO + GRANT ALL à anon/authenticated : un compte sans
--         ligne users pouvait s'insérer avec role = admin_founder.
--   F-03  (partie base) handle_new_user() recopiait raw_user_meta_data->>'role'
--         (métadonnée modifiable par le client) sans liste blanche. La
--         fonction n'est rattachée à aucun trigger dans les migrations, mais
--         un trigger sur auth.users n'apparaîtrait pas dans la baseline
--         (dump du schéma public uniquement) : elle est neutralisée ici.
--
-- Mécanisme retenu :
--   1. Privilèges de colonnes : anon/authenticated perdent INSERT, UPDATE,
--      DELETE, TRUNCATE, REFERENCES, TRIGGER sur users. authenticated
--      récupère UPDATE (locale) — seule préférence modifiable par
--      l'utilisateur (aucun écran ne modifie d'autre colonne en session).
--      SELECT est conservé pour anon et authenticated : plusieurs policies
--      d'autres tables (et is_admin_user, SECURITY INVOKER) lisent users,
--      la RLS « Users can view own profile » limite déjà les lignes.
--      → Refus explicite par Postgres (42501) pour tout appel PostgREST /
--        GraphQL, indépendamment de la RLS.
--   2. Trigger de défense en profondeur (refus explicite, 42501) si, malgré
--      tout, une écriture arrive avec current_user ∈ {anon, authenticated}
--      et modifie autre chose que locale/updated_at, ou insère une ligne.
--      Protège contre un futur « GRANT ALL » (cas de la baseline). Il ne
--      dépend PAS du GUC easyjob.system_update : les écritures de confiance
--      sont identifiées par le rôle d'exécution — service_role (serveur
--      Next.js) ou propriétaire d'une fonction SECURITY DEFINER (RPC admin
--      gardées : admin_set_user_active, recompute_user_verification…).
--      Le client ne peut pas changer current_user.
--   3. Suppression de la policy INSERT permissive (service_role contourne la
--      RLS ; aucune création de ligne users n'a lieu en session client).
--   4. handle_new_user() : rôle initial limité à candidate | company
--      (sinon candidate), locale limitée à fr | en, EXECUTE retiré.
--
-- Effets attendus :
--   - Les parcours applicatifs (finalizeSignup, callback OAuth, RPC admin)
--     écrivent via service_role ou SECURITY DEFINER : inchangés.
--   - app/onboarding/company/page.tsx tente users.is_verified = true en
--     session : déjà neutralisé silencieusement par trg_protect_user_is_verified,
--     désormais refusé (42501). L'erreur est ignorée par la page (constat F-14,
--     lot 5) : aucun changement visible pour l'utilisateur.
--
-- Reprise en cas d'échec : migration transactionnelle (une seule
-- transaction appliquée par la CLI) — aucun effet partiel.
-- Retour arrière : NE PAS rouvrir les grants ni recréer la policy INSERT
-- (réintroduirait F-01/F-02). Si un flux légitime est bloqué, le faire
-- passer par service_role ou une RPC SECURITY DEFINER gardée. En dernier
-- recours, seul le trigger peut être retiré (les privilèges de colonnes
-- restent la protection principale) :
--   drop trigger if exists trg_protect_user_account_columns on public.users;
--   drop function if exists public.protect_user_account_columns();

-- ── 1. Policy INSERT permissive ─────────────────────────────────────
drop policy if exists "Service role can insert users" on public.users;

-- ── 2. Privilèges de table / colonnes ───────────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on table public.users from anon, authenticated;

grant select on table public.users to anon, authenticated;
grant update (locale) on table public.users to authenticated;

-- ── 3. Trigger de défense en profondeur ─────────────────────────────
-- Nom choisi pour s'exécuter AVANT trg_protect_user_is_verified (ordre
-- alphabétique des triggers BEFORE) : une tentative sur is_verified est
-- refusée explicitement au lieu d'être silencieusement annulée.
create or replace function public.protect_user_account_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Écritures de confiance : service_role, postgres, ou propriétaire d'une
  -- fonction SECURITY DEFINER (qui porte son propre contrôle d'accès).
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'users: account creation is server-side only'
      using errcode = '42501';
  end if;

  -- Toute colonne hors préférences est porteuse de droits ou d'identité
  -- (role, is_active, is_verified, phone, phone_verified, email,
  -- no_show_count, ban_*, device_fingerprint, id, created_at). Les colonnes
  -- ajoutées plus tard sont protégées par défaut.
  if (to_jsonb(new) - 'locale' - 'updated_at')
     is distinct from (to_jsonb(old) - 'locale' - 'updated_at') then
    raise exception 'users: only preference columns can be changed by the account owner'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_user_account_columns() from public, anon, authenticated;

drop trigger if exists trg_protect_user_account_columns on public.users;
create trigger trg_protect_user_account_columns
  before insert or update on public.users
  for each row execute function public.protect_user_account_columns();

-- ── 4. handle_new_user : liste blanche du rôle initial ──────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.user_role;
  v_locale public.locale_type;
begin
  -- raw_user_meta_data est modifiable par le client : seuls les choix
  -- publics d'inscription sont acceptés, jamais un rôle admin ou premium.
  v_role := case new.raw_user_meta_data->>'role'
              when 'company' then 'company'::public.user_role
              else 'candidate'::public.user_role
            end;
  v_locale := case new.raw_user_meta_data->>'locale'
                when 'en' then 'en'::public.locale_type
                else 'fr'::public.locale_type
              end;

  insert into public.users (id, email, phone, role, locale)
  values (new.id, new.email, new.phone, v_role, v_locale)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
