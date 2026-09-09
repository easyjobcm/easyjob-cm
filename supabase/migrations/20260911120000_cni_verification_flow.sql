-- Migration : Flux de vérification CNI (T8.3)
-- Date : 2026-09-11
-- Tables affectées : candidate_profiles (trigger de protection CNI + is_verified),
--                    users (is_verified protégé), document_expirations (type cni,
--                    déjà présent dans le CHECK depuis la baseline)
--
-- Objectif (SRS §6.2 / §6.6 / §8.4 / §11.5) :
--   1. Protéger les colonnes de vérification CNI (cni_verified,
--      cni_rejection_reason, cni_expires_at) : un candidat NE PEUT PAS
--      s'auto-marquer cni_verified='verified' via la RLS "update own
--      profile" (avant T8.3 : aucun trigger, colonne librement écri-
--      table). Seuls les RPC SECURITY DEFINER `moderate_cni` (admin) et
--      `candidate_update_cni` (candidat, pose 'pending') les écrivent.
--   2. `moderate_cni` : revue admin (admin_ops/admin_founder). Approbation
--      → cni_verified='verified' (+ cni_expires_at par défaut = naissance
--         + 10 ans si non fourni) + ligne document_expirations (type
--         'cni', upsert) ; rejet → motif obligatoire ≥ 3 car. Écrit
--      notification `document_status` + audit (`approve_cni`/
--      `reject_cni`). (La suppression des photos après approbation est
--      livrée par T8.4 — la route API supprime les objets du bucket
--      privé via service_role.)
--   3. `candidate_update_cni` : le candidat ré-soumet ses photos
--      (recto/verso/selfie + n° CNI + date d'expiration facultative) →
--      cni_verified='pending', motif effacé.
--   4. `recompute_user_verification` : `users.is_verified` est la
--      SOURCE DE VÉRITÉ du gate de postulation. Vrai si et seulement si
--      : CNI vérifiée (cni_verified='verified' — la certification, pas la
--        présence des photos : la route T8.4 les supprime du bucket privé
--        APRÈS l'approbation, donc la condition ne porte que sur l'état
--        vérifié) ET momo_verified=true ET infos personnelles complètes
--        (prénom, nom, date de naissance) ET téléphone présent. Appelé par
--        `moderate_cni` et `apply_momo_verification` (altéré ici). Passe
--        notification `document_status` « profil vérifié » à la bascule
--        false→true.
--   5. Trigger `protect_user_is_verified` : users.is_verified n'est
--      écrit QUE par recompute_user_verification (flag de synthèse,
--      jamais manuellement).
--
-- Dépendances : migrations 20260526130000 (baseline : enum
-- verification_status, document_expirations, is_admin_user),
-- 20260903100000 (is_ops_admin_user), 20260910120000 (pattern
-- easyjob.system_update — GUC transactionnel déjà utilisé par le
-- trigger MoMo).
--
-- Rollback :
--   drop trigger if exists trg_protect_cni_verification on public.candidate_profiles;
--   drop function if exists public.protect_cni_verification();
--   drop trigger if exists trg_protect_user_is_verified on public.users;
--   drop function if exists public.protect_user_is_verified();
--   drop function if exists public.recompute_user_verification(uuid);
--   drop function if exists public.candidate_update_cni(uuid, text, text, text, text, date);
--   drop function if exists public.moderate_cni(uuid, text, text, date);
--   revert app/api/jobs/[id]/apply/route.ts (gate essentials → is_verified)
--   (le recompute ajouté à apply_momo_verification — revert 20260910120000)

DO $cni$
BEGIN
  -- ── 1. Trigger de protection des colonnes CNI (pattern T6 MoMo) ──
  EXECUTE $ext$
    create or replace function public.protect_cni_verification()
    returns trigger
    language plpgsql
    as $body$
    begin
      if coalesce(current_setting('easyjob.system_update', true), 'off') <> 'on' then
        new.cni_verified        := old.cni_verified;
        new.cni_rejection_reason := old.cni_rejection_reason;
        new.cni_expires_at      := old.cni_expires_at;
      end if;
      return new;
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    drop trigger if exists trg_protect_cni_verification on public.candidate_profiles
  $ext$;

  EXECUTE $ext$
    create trigger trg_protect_cni_verification
    before update on public.candidate_profiles
    for each row execute function public.protect_cni_verification()
  $ext$;

  -- ── 2. Recompute users.is_verified (source de vérité du gate) ─────
  -- Appelable par les RPC d'appréciation (SECURITY DEFINER) et depuis
  -- Postgres (recovery). Ne pose de notification QUE lors de la bascule
  -- false→true (GUC local de transaction pour éviter le double envoi si
  -- CNI + MoMo sont validés en même transaction).
  EXECUTE $ext$
    create or replace function public.recompute_user_verification(p_user_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      cp record;
      v_should_be_verified boolean;
      v_old_verified boolean;
    begin
      if p_user_id is null then
        return;
      end if;

      select * into cp
      from public.candidate_profiles
      where user_id = p_user_id
      limit 1;

      if cp is null then
        return;
      end if;

      v_old_verified := (select is_verified from public.users where id = p_user_id);

      -- La certification CNI est porteuse de la preuve (pas la présence
      -- des photos : la route T8.4 les supprime APRES l'approbation).
      v_should_be_verified := exists (
        select 1
        from public.candidate_profiles cp2
        where cp2.id = cp.id
          and cp2.cni_verified = 'verified'
          and cp2.momo_verified = true
          and (select phone from public.users u where u.id = p_user_id) is not null
          and (trim(cp2.first_name) <> '')
          and (trim(cp2.last_name) <> '')
          and (cp2.date_of_birth is not null)
      );

      -- GUC `easyjob.system_update` requis : le trigger
      -- `trg_protect_user_is_verified` protège users.is_verified des
      -- écritures directes (RLS). Le recompute est le SEUL écrivain
      -- autorisé ; il le signale en posant le GUC sur la transaction.
      perform set_config('easyjob.system_update', 'on', true);
      update public.users
      set is_verified = v_should_be_verified
      where id = p_user_id;
      perform set_config('easyjob.system_update', 'off', true);

      if v_should_be_verified and not coalesce(v_old_verified, false) then
        if coalesce(current_setting('easyjob.verification_notified', true), 'off') <> 'on' then
          insert into public.notifications (
            user_id, notification_type, title, body, data
          ) values (
            p_user_id,
            'document_status',
            'Profil vérifié',
            'Toutes vos informations sont vérifiées (identité, CNI, Mobile Money). Vous pouvez désormais postuler aux offres.',
            jsonb_build_object('verification', 'profile_complete')
          );
          perform set_config('easyjob.verification_notified', 'on', true);
        end if;
      end if;
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.recompute_user_verification(uuid) to authenticated
  $ext$;

  -- ── 3. Trigger de protection users.is_verified ────────────────────
  EXECUTE $ext$
    create or replace function public.protect_user_is_verified()
    returns trigger
    language plpgsql
    as $body$
    begin
      if coalesce(current_setting('easyjob.system_update', true), 'off') <> 'on' then
        new.is_verified := old.is_verified;
      end if;
      return new;
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    drop trigger if exists trg_protect_user_is_verified on public.users
  $ext$;

  EXECUTE $ext$
    create trigger trg_protect_user_is_verified
    before update on public.users
    for each row execute function public.protect_user_is_verified()
  $ext$;

  -- ── 4. Écriture CANDIDAT : soumission / ré-émission du CNI ────────
  -- Les chemins sont fournis par l'app (l'upload objet est fait par
  -- /api/profile/documents ; ce RPC ne fait que pointer les chemins et
  -- ré-ouvrir la revue à 'pending'). `p_cni_number` et `p_expires_at`
  -- sont optionnelles ; passer NULL laisse la valeur existante.
  EXECUTE $ext$
    create or replace function public.candidate_update_cni(
      p_profile_id uuid,
      p_front_url  text,
      p_back_url   text,
      p_selfie_url text,
      p_cni_number text,
      p_expires_at date
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      if not exists (
        select 1 from public.candidate_profiles cp
        where cp.id = p_profile_id and cp.user_id = (select auth.uid())
      ) then
        raise exception 'candidate profile not found';
      end if;

      perform set_config('easyjob.system_update', 'on', true);
      update public.candidate_profiles
      set
        cni_front_url      = coalesce(p_front_url,  cni_front_url),
        cni_back_url       = coalesce(p_back_url,   cni_back_url),
        cni_selfie_url     = coalesce(p_selfie_url, cni_selfie_url),
        cni_number         = coalesce(p_cni_number, cni_number),
        cni_expires_at     = coalesce(p_expires_at, cni_expires_at),
        cni_verified       = 'pending',
        cni_rejection_reason = null
      where id = p_profile_id;
      perform set_config('easyjob.system_update', 'off', true);
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.candidate_update_cni(uuid, text, text, text, text, date) to authenticated
  $ext$;

  -- ── 5. Écriture ADMIN : approbation / rejet du CNI ───────────────
  -- Pré-requis à l'approbation : 3 photos soumises + nom complet (sans
  -- quoi l'admin n'a rien à confronter). À l'approbation, si
  -- p_expires_at n'est pas fourni, défaut = date de naissance + 10 ans
  -- (CNI camerounaise). Écrit la ligne document_expirations (type 'cni',
  -- upsert sur la dernière date), notification + audit, recompute du
  -- flag is_verified.
  EXECUTE $ext$
    create or replace function public.moderate_cni(
      p_profile_id    uuid,
      p_action        text,
      p_reject_reason text,
      p_expires_at    date
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_user_id uuid;
      v_role    text;
      v_dob     date;
      v_expires date;
    begin
      select cp.user_id, cp.date_of_birth
      into v_user_id, v_dob
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

      if p_action = 'reject'
         and (p_reject_reason is null or char_length(trim(p_reject_reason)) < 3) then
        raise exception 'reject reason required (min 3 chars)';
      end if;

      perform set_config('easyjob.system_update', 'on', true);
      if p_action = 'approve' then
        if not exists (
          select 1 from public.candidate_profiles
          where id = p_profile_id
            and cni_front_url  is not null
            and cni_back_url   is not null
            and cni_selfie_url is not null
        ) then
          raise exception 'cni documents not submitted';
        end if;
        if not exists (
          select 1 from public.candidate_profiles
          where id = p_profile_id
            and (trim(first_name) <> '')
            and (trim(last_name) <> '')
        ) then
          raise exception 'candidate identity incomplete (first/last name required)';
        end if;
        -- Date d'expiration CNI : celle fournie par l'admin, sinon défaut
        -- = date de naissance + 10 ans (CNI camerounaise). Si
        -- `date_of_birth` est inconnue ET que l'admin n'en a pas fourni,
        -- on laisse NULL (pas de ligne de suivi d'expiration possible :
        -- column NOT NULL).
        v_expires := coalesce(p_expires_at, (v_dob + '10 years'::interval)::date);
        update public.candidate_profiles
        set
          cni_verified       = 'verified',
          cni_rejection_reason = null,
          cni_expires_at     = v_expires
        where id = p_profile_id;

        -- Ligne de suivi d'expiration (type 'cni' — déjà dans le CHECK
        -- de la baseline), SEULEMENT si une date d'expiration est connue
        -- (colonne expires_at NOT NULL). Delete+insert idempotent car
        -- (candidate_id, document_type) n'a pas de contrainte unique.
        if v_expires is not null then
          delete from public.document_expirations
          where candidate_id = p_profile_id and document_type = 'cni';
          insert into public.document_expirations
            (candidate_id, document_type, expires_at)
          values (p_profile_id, 'cni', v_expires);
        end if;
      else
        update public.candidate_profiles
        set
          cni_verified       = 'rejected',
          cni_rejection_reason = p_reject_reason
        where id = p_profile_id;
      end if;
      perform set_config('easyjob.system_update', 'off', true);

      insert into public.notifications (
        user_id, notification_type, title, body, data
      ) values (
        v_user_id,
        'document_status',
        case when p_action = 'approve' then 'CNI vérifiée' else 'CNI refusée' end,
        case
          when p_action = 'approve'
            then 'Votre pièce d''identité a été vérifiée. Votre profil est désormais conforme (Mobile Money vérifié requis pour postuler).'
          else 'Votre pièce d''identité a été refusée. Motif : '
               || coalesce(p_reject_reason, 'non précisé') || '.'
        end,
        jsonb_build_object('cni_action', p_action)
      );

      insert into public.audit_logs (
        actor_id, actor_role, action, resource_type, resource_id, metadata
      ) values (
        (select auth.uid()),
        v_role,
        case when p_action = 'approve' then 'approve_cni' else 'reject_cni' end,
        'candidate_profiles',
        p_profile_id,
        jsonb_build_object('action', p_action, 'reject_reason', p_reject_reason, 'expires_at', v_expires)
      );

      perform public.recompute_user_verification(v_user_id);
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.moderate_cni(uuid, text, text, date) to authenticated
  $ext$;

  -- ── 6. apply_momo_verification : recompute is_verified en fin ─────
  -- Re-création de la fonction T6 avec un seul ajout : l'appel à
  -- recompute_user_verification à la fin (validation MoMo peut rendre
  -- users.is_verified = true une fois la CNI déjà vérifiée).
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

      perform public.recompute_user_verification(v_user_id);
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.apply_momo_verification(uuid, text, text) to authenticated
  $ext$;
END;
$cni$;
