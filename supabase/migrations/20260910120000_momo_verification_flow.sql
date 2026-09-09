-- Migration : Vérification Mobile Money — preuve de possession (OTP) +
-- validation admin (T6).
-- Date : 2026-09-10
-- Tables : candidate_profiles (nouvelles colonnes), momo_otp (nouvelle table)
-- Fonctions : protect_momo_verification (trigger BEFORE UPDATE),
--             candidate_update_momo, momo_issue_otp, momo_verify_otp
--             (SECURITY DEFINER, écritures candidat),
--             apply_momo_verification (SECURITY DEFINER, écriture admin)
-- Contexte : SRS §11.5 (Option D) — le compte MoMo exige
--   (1) preuve de possession : OTP 6 chiffres SMS sur le numéro
--       (3 échecs = preuve refusée, le statut repasse « rejeté ») et
--   (2) validation admin (nom du compte == nom CNI, 24h ; comptes
--       familiaux refusés).
-- Sécurité : la policy RLS « Candidates can update own profile » est large
-- (sans restriction de colonne). Sans garde-fou, un candidat pourrait
-- forcer momo_verified = true OU se déclarer lui-même comme ayant la
-- preuve OTP en appelant directement l'API Supabase (contournement total).
--   - Le trigger BEFORE UPDATE rétablit l'ancienne valeur des 6 colonnes
--     sensibles si le flag session `easyjob.system_update` n'est pas « on »
--     (même mécanique que protect_candidate_skill_verification_status, T3.1).
--     Colonnes protégées : momo_verified, momo_name_match, momo_verified_by,
--     momo_verified_at, momo_otp_status, momo_reject_reason.
--   - Les colonnes momo_provider / momo_number / momo_account_name restent
--     écrivables par le candidat (policy RLS directe, y compris onboarding).
--   - Le code OTP (hash SHA-256) vit dans `momo_otp` : RLS activée SANS
--     policy = deny-by-default (service_role y compris). Seules les
--     fonctions SECURITY DEFINER owner-postgres ci-dessous y accèdent ;
--     l'app ne transmet que des hash SHA-256 via les RPC. Le hash ne
--     apparaît donc JAMAIS dans un select candidat sur candidate_profiles.
-- États (momo_otp_status) :
--   none     — aucun OTP en cours (numéro non prouvé, ou réinitialisé)
--   awaiting — un code est actif (une ligne dans momo_otp)
--   verified — le code a été saisi correctement (preuve obtenue, en attente
--              de revue admin ; momo_verified ne devient true qu'à l'approval)
--   rejected — 3 échecs sur un code (preuve refusée, momo_reject_reason =
--              'otp_max_attempts') ; émettre un nouveau code ou enregistrer
--              un nouveau numéro réarme.
-- Piège projet : `supabase db query --local -f` = 1 prepared statement →
-- fichier unique = BLOC DO unique (comme T3.1). Trois niveaux de
-- dollar-quoting distincts ($momo$ / $ext$ / $body$) pour la nesting.
-- Rollback :
--   drop trigger if exists trg_protect_momo_verification on public.candidate_profiles;
--   drop function if exists public.protect_momo_verification();
--   drop function if exists public.candidate_update_momo(text, text, text);
--   drop function if exists public.momo_issue_otp(text, timestamptz);
--   drop function if exists public.momo_verify_otp(text);
--   drop function if exists public.apply_momo_verification(uuid, text, text);
--   alter table public.candidate_profiles
--     drop constraint if exists candidate_profiles_momo_otp_status_check,
--     drop column if exists momo_account_name,
--     drop column if exists momo_otp_status,
--     drop column if exists momo_reject_reason,
--     drop column if exists momo_verified_by,
--     drop column if exists momo_verified_at;
--   drop table if exists public.momo_otp;
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
    add column if not exists momo_otp_status text not null default 'none'
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

  EXECUTE $ext$
    alter table public.candidate_profiles
    drop constraint if exists candidate_profiles_momo_otp_status_check
  $ext$;

  EXECUTE $ext$
    alter table public.candidate_profiles
    add constraint candidate_profiles_momo_otp_status_check
    check (momo_otp_status in ('none', 'awaiting', 'verified', 'rejected'))
  $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_account_name is
    'Nom déclaré sur le compte MoMo (auto-déclaré par le candidat, max 100). L''admin confronte ce nom au nom CNI — les comptes au nom d''un tiers / comptes familiaux sont refusés (SRS §11.5).' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_otp_status is
    'Étape de preuve de possession : none | awaiting | verified | rejected. Écrit uniquement par candidate_update_momo / momo_issue_otp / momo_verify_otp.' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_reject_reason is
    'Raison de rejet : otp_max_attempts (3 échecs de code) ou motif libre admin (ex. mismatch nom CNI).' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_verified_by is
    'users.id de l''admin ayant validé (null tant que non validé). Écrit exclusivement par apply_momo_verification.' $ext$;

  EXECUTE $ext$ comment on column public.candidate_profiles.momo_verified_at is
    'Horodatage de la validation admin. Écrit exclusivement par apply_momo_verification.' $ext$;

  -- ── 2. momo_otp : code actif par profil (deny-by-default) ────────
  EXECUTE $ext$
    create table if not exists public.momo_otp (
      profile_id  uuid primary key references public.candidate_profiles(id) on delete cascade,
      token_hash  text        not null,
      expires_at  timestamptz not null,
      attempts    int         not null default 0,
      created_at  timestamptz not null default now()
    )
  $ext$;

  EXECUTE $ext$ alter table public.momo_otp enable row level security $ext$;

  EXECUTE $ext$ comment on table public.momo_otp is
    'T6 — preuve de possession MoMo : 1 seule ligne active par profil (upsert à chaque émission). Le code en clair n''est JAMAIS stocké. La ligne est supprimée à la vérification réussie, à l''épuisement des 3 essais, à l''expiration, et par candidate_update_momo.' $ext$;

  EXECUTE $ext$ comment on column public.momo_otp.token_hash is
    'SHA-256 hex (64) du code 6 chiffres généré côté application.' $ext$;

  EXECUTE $ext$ comment on column public.momo_otp.expires_at is
    'Expiration (now() + TTL 10 min, côté application).' $ext$;

  EXECUTE $ext$ comment on column public.momo_otp.attempts is
    'Essais échoués (0..2) ; 3e échec = statut rejected.' $ext$;

  -- ── 3. Trigger de protection des 6 colonnes sensibles ────────────
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
        new.momo_otp_status    := old.momo_otp_status;
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

  -- ── 4a. Écriture CANDIDAT : sauvegarde numéro/opérateur/nom ─────
  -- Réinitialise TOUS les états de vérification (SRS : changement de
  -- numéro → nouvelle vérification complète) + supprime le code actif.
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
        momo_otp_status    = 'none',
        momo_reject_reason = null
      where id = v_profile_id;
      perform set_config('easyjob.system_update', 'off', true);

      delete from public.momo_otp where profile_id = v_profile_id;
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.candidate_update_momo(text, text, text) to authenticated
  $ext$;

  -- ── 4b. Émission OTP (candidat) : remplace tout code actif et
  -- passe le profil en « awaiting ». Quota : vérifié côté application
  -- (check_sms_send_quota) avant l'appel — la fonction n'envoie AUCUN
  -- SMS (toujours déclenchée par un geste d'utilisateur authentifié).
  EXECUTE $ext$
    create or replace function public.momo_issue_otp(
      p_token_hash  text,
      p_expires_at  timestamptz
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

      if not exists (
        select 1 from public.candidate_profiles
        where id = v_profile_id
          and momo_number is not null
          and char_length(momo_number) > 0
      ) then
        raise exception 'momo number not configured';
      end if;

      delete from public.momo_otp where profile_id = v_profile_id;
      insert into public.momo_otp (profile_id, token_hash, expires_at, attempts)
      values (v_profile_id, p_token_hash, p_expires_at, 0);

      perform set_config('easyjob.system_update', 'on', true);
      update public.candidate_profiles
      set momo_otp_status = 'awaiting', momo_reject_reason = null
      where id = v_profile_id;
      perform set_config('easyjob.system_update', 'off', true);
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.momo_issue_otp(text, timestamptz) to authenticated
  $ext$;

  -- ── 4c. Vérification OTP (candidat) ──────────────────────────────
  -- Résultats : none (aucun code actif) | expired (code expiré, ligne
  -- supprimée + retour none) | verified (code correct, ligne supprimée,
  -- état verified) | wrong (1 essai compté, l'essai reste) | maxed
  -- (3e essai échoué, ligne supprimée, état rejected + motif
  -- otp_max_attempts).
  EXECUTE $ext$
    create or replace function public.momo_verify_otp(p_token_hash text)
    returns text
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_profile_id uuid;
      v_row record;
    begin
      select id into v_profile_id
      from public.candidate_profiles
      where user_id = (select auth.uid())
      limit 1;

      if v_profile_id is null then
        raise exception 'candidate profile not found';
      end if;

      select * into v_row
      from public.momo_otp
      where profile_id = v_profile_id;

      if not found then
        return 'none';
      end if;

      if v_row.expires_at < now() then
        delete from public.momo_otp where profile_id = v_profile_id;
        perform set_config('easyjob.system_update', 'on', true);
        update public.candidate_profiles
        set momo_otp_status = 'none'
        where id = v_profile_id;
        perform set_config('easyjob.system_update', 'off', true);
        return 'expired';
      end if;

      if v_row.token_hash = p_token_hash then
        delete from public.momo_otp where profile_id = v_profile_id;
        perform set_config('easyjob.system_update', 'on', true);
        update public.candidate_profiles
        set momo_otp_status = 'verified', momo_reject_reason = null
        where id = v_profile_id;
        perform set_config('easyjob.system_update', 'off', true);
        return 'verified';
      end if;

      if v_row.attempts + 1 >= 3 then
        delete from public.momo_otp where profile_id = v_profile_id;
        perform set_config('easyjob.system_update', 'on', true);
        update public.candidate_profiles
        set momo_otp_status = 'rejected',
            momo_reject_reason = 'otp_max_attempts'
        where id = v_profile_id;
        perform set_config('easyjob.system_update', 'off', true);
        return 'maxed';
      end if;

      update public.momo_otp
      set attempts = v_row.attempts + 1
      where profile_id = v_profile_id;

      return 'wrong';
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.momo_verify_otp(text) to authenticated
  $ext$;

  -- ── 4d. Écriture ADMIN : approche / refus de la vérification ─────
  -- Pré-requis : preuve OTP déjà obtenue (momo_otp_status = 'verified') :
  -- un admin ne peut pas valider un numéro dont la possession n'a pas
  -- été prouvée. Rôles admin_ops/admin_founder. Transactionnel.
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
      v_otp   text;
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

      select momo_otp_status into v_otp
      from public.candidate_profiles
      where id = p_profile_id;

      if v_otp <> 'verified' then
        raise exception 'otp proof required before review';
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

  -- ── 5. notification_type : valeur 'momo_status' ──────────────────
  -- (les valeurs d'un ENUM ne peuvent pas être retirées en Postgres —
  -- idem 'document_status' en 2026-09-03)
  EXECUTE $ext$
    do $$
    begin
      if exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
          and t.typname = 'notification_type'
      ) then
        alter type public.notification_type add value if not exists 'momo_status';
      else
        raise notice 'Type public.notification_type absent, etape ignoree.';
      end if;
    end;
    $$
  $ext$;
END;
$momo$;
