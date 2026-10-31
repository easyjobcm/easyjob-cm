-- Migration : Vérification Mobile Money — validation admin manuelle (T6).
-- Date : 2026-09-10
-- Tables : candidate_profiles (nouvelles colonnes)
-- Fonctions : protect_momo_verification (trigger BEFORE UPDATE),
--             candidate_update_momo, apply_momo_verification
--             (SECURITY DEFINER)
-- Contexte : SRS §11.5 (Option D) — le compte MoMo du candidat est
--   auto-déclaré (opérateur, numéro, nom du compte) puis validé par
--   l'ADMINISTRATION (rôles admin_ops/admin_founder, revue ≤ 24 h) :
--   l'admin confronte le nom déclaré au nom CNI (les comptes familiaux
--   / au nom d'un tiers sont refusés avec motif).
--
-- PÉRIMÈTRE T6 (décision produit 2026-09-10) : PAS de preuve de
-- possession par OTP SMS — étape jugée superflue au lancement et
-- coûteuse (1 SMS par numéro). Le numéro est donc la responsabilité du
-- candidat, l'admin arbitre. Un agrégateur « get account name »
-- (T6.1, à l'étude) pourra en plus retourner le nom opérateur du
-- numéro pour automatiser la confrontation.
--
-- Sécurité : la policy RLS « Candidates can update own profile » est
-- large (sans restriction de colonne). Sans garde-fou, un candidat
-- pourrait forcer momo_verified = true en appelant directement l'API
-- Supabase (contournement total).
--   - Le trigger BEFORE UPDATE rétablit l'ancienne valeur des 5 colonnes
--     sensibles si le flag session `easyjob.system_update` n'est pas « on »
--     (même mécanique que protect_candidate_skill_verification_status,
--     T3.1). Colonnes protégées : momo_verified, momo_name_match,
--     momo_verified_by, momo_verified_at, momo_reject_reason.
--   - Les colonnes momo_provider / momo_number / momo_account_name
--     restent écrivables par le candidat (policy RLS directe, y compris
--     onboarding) — la « déclaration » est libre, la « vérification »
--     ne l'est pas.
-- Piège projet : `supabase db query --local -f` = 1 prepared statement →
-- fichier unique = BLOC DO unique (comme T3.1). Trois niveaux de
-- dollar-quoting distincts ($momo$ / $ext$ / $body$) pour la nesting.
-- Rollback :
--   drop trigger if exists trg_protect_momo_verification on public.candidate_profiles;
--   drop function if exists public.protect_momo_verification();
--   drop function if exists public.candidate_update_momo(text, text, text);
--   drop function if exists public.apply_momo_verification(uuid, text, text);
--   alter table public.candidate_profiles
--     drop column if exists momo_account_name,
--     drop column if exists momo_reject_reason,
--     drop column if exists momo_verified_by,
--     drop column if exists momo_verified_at;
--   (l'enum value 'momo_status' ne pourra PAS être retirée — limitation
--    Postgres, acceptée comme pour 'document_status')

DO $momo$
BEGIN
  -- ── 1. candidate_profiles : colonnes de cycle de vie MoMo ─────────
  EXECUTE $ext$
    alter table public.candidate_profiles
    add column if not exists momo_account_name text
      check (momo_account_name is null or char_length(momo_account_name) <= 100)
  $ext$;

  EXECUTE $ext$
    alter table public.candidate_profiles
    add column if not exists momo_reject_reason text
  $ext$;

  EXECUTE $ext$
    alter table public.candidate_profiles
    add column if not exists momo_verified_by uuid
      references public.users(id) on delete set null
  $ext$;

  EXECUTE $ext$
    alter table public.candidate_profiles
    add column if not exists momo_verified_at timestamptz
  $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_account_name is
    'Nom déclaré sur le compte MoMo (auto-déclaré par le candidat, max 100). L''admin confronte ce nom au nom CNI — les comptes au nom d''un tiers / comptes familiaux sont refusés (SRS §11.5).' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_reject_reason is
    'Motif de refus admin (ex. mismatch nom CNI) ; null tant que non refusé. Écrit exclusivement par apply_momo_verification.' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_verified_by is
    'users.id de l''admin ayant validé (null tant que non validé). Écrit exclusivement par apply_momo_verification.' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_verified_at is
    'Horodatage de la validation admin. Écrit exclusivement par apply_momo_verification.' $ext$;

  -- ── 2. Trigger de protection des 5 colonnes sensibles ────────────
  EXECUTE $ext$
    create or replace function public.protect_momo_verification()
    returns trigger
    language plpgsql
    as $body$
    begin
      if coalesce(current_setting('easyjob.system_update', true), 'off') <> 'on' then
        new.momo_verified      := old.momo_verified;
        new.momo_name_match    := old.momo_name_match;
        new.momo_verified_by   := old.momo_verified_by;
        new.momo_verified_at   := old.momo_verified_at;
        new.momo_reject_reason := old.momo_reject_reason;
      end if;
      return new;
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    drop trigger if exists trg_protect_momo_verification on public.candidate_profiles
  $ext$;

  EXECUTE $ext$
    create trigger trg_protect_momo_verification
    before update on public.candidate_profiles
    for each row execute function public.protect_momo_verification()
  $ext$;

  -- ── 3. Écriture CANDIDAT : sauvegarde numéro/opérateur/nom ───────
  -- Réinitialise la vérification (règle SRS §11.5 : tout changement de
  -- numéro/opérateur invalide la vérification en cours — l'admin
  -- re-vérifie).
  EXECUTE $ext$
    create or replace function public.candidate_update_momo(
      p_provider     text,
      p_number       text,
      p_account_name text
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_profile_id uuid;
    begin
      select id into v_profile_id
      from public.candidate_profiles
      where user_id = (select auth.uid())
      limit 1;

      if v_profile_id is null then
        raise exception 'candidate profile not found';
      end if;

      perform set_config('easyjob.system_update', 'on', true);
      update public.candidate_profiles
      set
        momo_provider      = p_provider,
        momo_number        = p_number,
        momo_account_name  = p_account_name,
        momo_verified      = false,
        momo_name_match    = false,
        momo_verified_by   = null,
        momo_verified_at   = null,
        momo_reject_reason = null
      where id = v_profile_id;
      perform set_config('easyjob.system_update', 'off', true);
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.candidate_update_momo(text, text, text) to authenticated
  $ext$;

  -- ── 4. Écriture ADMIN : approche / refus de la vérification ──────
  -- Pré-requis : numéro enregistré (sans quoi l'admin n'a rien à
  -- confronter). Rôles admin_ops/admin_founder (admin_support = lecture
  -- seule, côté route API). Transactionnel : écriture protégée de la
  -- vérification + notification + audit log (acteur = l'admin RÉEL via
  -- auth.uid(), jamais service_role).
  EXECUTE $ext$
    create or replace function public.apply_momo_verification(
      p_profile_id    uuid,
      p_action        text,
      p_reject_reason text
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_user_id uuid;
      v_role  text;
    begin
      select cp.user_id
      into v_user_id
      from public.candidate_profiles cp
      where cp.id = p_profile_id;

      if v_user_id is null then
        raise exception 'profile not found';
      end if;

      if not public.is_admin_user((select auth.uid())) then
        raise exception 'not authorized: admin only';
      end if;

      select role into v_role from public.users where id = (select auth.uid());
      if v_role not in ('admin_ops', 'admin_founder') then
        raise exception 'not authorized: role must be admin_ops or admin_founder';
      end if;

      if p_action not in ('approve', 'reject') then
        raise exception 'invalid action';
      end if;

      if not exists (
        select 1 from public.candidate_profiles
        where id = p_profile_id
          and momo_number is not null
          and char_length(momo_number) > 0
      ) then
        raise exception 'momo number not configured';
      end if;

      if p_action = 'reject' and (p_reject_reason is null or char_length(trim(p_reject_reason)) < 3) then
        raise exception 'reject reason required (min 3 chars)';
      end if;

      perform set_config('easyjob.system_update', 'on', true);
      if p_action = 'approve' then
        update public.candidate_profiles
        set
          momo_verified      = true,
          momo_name_match    = true,
          momo_verified_by   = (select auth.uid()),
          momo_verified_at   = now(),
          momo_reject_reason = null
        where id = p_profile_id;
      else
        update public.candidate_profiles
        set
          momo_verified      = false,
          momo_name_match    = false,
          momo_reject_reason = p_reject_reason
        where id = p_profile_id;
      end if;
      perform set_config('easyjob.system_update', 'off', true);

      insert into public.notifications (
        user_id, notification_type, title, body, data
      ) values (
        v_user_id,
        'momo_status',
        case when p_action = 'approve' then 'Mobile Money vérifié' else 'Mobile Money refusé' end,
        case
          when p_action = 'approve'
            then 'Votre compte Mobile Money a été vérifié. Vos paiements de mission pourront désormais être versés sur ce compte.'
          else 'Votre compte Mobile Money a été refusé. Motif : '
               || coalesce(p_reject_reason, 'non précisé') || '.'
        end,
        jsonb_build_object('momo_action', p_action)
      );

      insert into public.audit_logs (
        actor_id, actor_role, action, resource_type, resource_id, metadata
      ) values (
        (select auth.uid()),
        v_role,
        case when p_action = 'approve' then 'approve_momo' else 'reject_momo' end,
        'candidate_profiles',
        p_profile_id,
        jsonb_build_object('action', p_action, 'reject_reason', p_reject_reason)
      );
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.apply_momo_verification(uuid, text, text) to authenticated
  $ext$;

  -- ── 5. enum notification_type : valeur 'momo_status' ─────────────
  -- Le RPC apply_momo_verification insère notification_type =
  -- 'momo_status'. La valeur est ABSENTE de la baseline remote
  -- (20260526130000) — sans cette déclaration, une base reconstruite
  -- par la CI (db reset = ré-apply migrations depuis la baseline) ne
  -- générerait plus `momo_status` dans les types (diff types en
  -- échec) ET le RPC échouerait au premier run prod
  -- (« invalid input value for enum notification_type »). Postgres ne
  -- permettant pas « add value if not exists » → bloc d'exception
  -- plpgsql idempotent (même mécanique que document_status en T3).
  BEGIN
    EXECUTE $ext$
      alter type public.notification_type add value 'momo_status'
    $ext$;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- valeur déjà présente (base locale / ré-apply) — idempotent
  END;
END;
$momo$;
