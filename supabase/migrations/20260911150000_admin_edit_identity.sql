-- Migration : édition d'identité candidat par admin_founder (T8.4b)
-- Date : 2026-09-11
-- Tables affectées : candidate_profiles (first_name / last_name /
--                     date_of_birth / cni_verified / cni_rejection_reason),
--                     users (is_verified — via recompute_user_verification),
--                     notifications (type 'document_status'),
--                     audit_logs (action 'admin_edit_identity')
--
-- Objectif (SRS §6.12, vue centralisée T8.4b) :
--   /admin/candidates/[id] expose le profil candidat complet en lecture
--   seule pour les 3 grades admin ; l'éDITION directe (prénom / nom /
--   date de naissance) est réservée à admin_founder (décision produit :
--   « juste modifiable par l'admin founder »).
--
--   `admin_edit_candidate_identity(uuid, text, text, date)` :
--   SECURITY DEFINER, réservé à admin_founder UNIQUEMENT (plus strict
--   que le gate ops/founder des autres mutations T8 — le fondateur est
--   le seul habilité à corriger une identité, car tout changement sur
--   un CNI vérifié force la re-vérification). Cible : un compte
--   candidat/ex-candidat premium ayant un candidate_profiles (un admin
--   n'a pas de profile candidat → « profile not found »).
--
--   Comportement :
--     * écriture des 3 champs d'identité (prénom / nom non vides,
--       date de naissance valide — validés en amont par Zod) ;
--     * SI cni_verified = 'verified' → le changement de nom / de date
--       de naissance invalide la certification : cni_verified remise à
--       'pending' + cni_rejection_reason NULL (transition legale : le
--       trigger trg_protect_cni_verification ne protège que la
--       transition VERS 'verified') + recompute_user_verification qui
--       fait retomber users.is_verified (le flag porte le gate de
--       postulation — T8.3) ;
--     * notification `document_status` au candidat (motif : re-vérification
--       demandée OU mise à jour enregistrée) ;
--     * audit `admin_edit_identity` (acteur = admin réel, auth.uid()).
--
-- Dépendances : migrations 20260526130000 (baseline), 20260911120000
-- (recompute_user_verification, trg_protect_cni_verification),
-- 20260910120000 (momo_reject_reason — non touchée ici).
--
-- Rollback :
--   drop function if exists public.admin_edit_candidate_identity(
--     uuid, text, text, date);
--   revert app/api/admin/candidates/[id]/identity/route.ts

DO $identity$
BEGIN
  EXECUTE $ext$
    create or replace function public.admin_edit_candidate_identity(
      p_user_id       uuid,
      p_first_name    text,
      p_last_name     text,
      p_date_of_birth date
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_role       text;
      v_profile    public.candidate_profiles%rowtype;
      v_was_verified boolean := false;
      v_changes    jsonb := '{}'::jsonb;
      v_reset      boolean := false;
    begin
      if not public.is_admin_user((select auth.uid())) then
        raise exception 'not authorized: admin only';
      end if;

      select role into v_role
      from public.users
      where id = (select auth.uid());

      -- T8.4b : édition réservée à admin_founder (décision produit).
      if v_role <> 'admin_founder' then
        raise exception 'not authorized: admin_founder only';
      end if;

      select u.role into v_role
      from public.users u
      where u.id = p_user_id;

      if v_role is null then
        raise exception 'user not found';
      end if;

      if v_role not in ('candidate', 'candidate_premium') then
        raise exception 'profile not found';
      end if;

      select * into v_profile
      from public.candidate_profiles
      where user_id = p_user_id
      limit 1;

      if not found or v_profile.id is null then
        raise exception 'profile not found';
      end if;

      if trim(p_first_name) = '' then
        raise exception 'first_name cannot be empty';
      end if;

      if trim(p_last_name) = '' then
        raise exception 'last_name cannot be empty';
      end if;

      if p_date_of_birth is null then
        raise exception 'date_of_birth cannot be null';
      end if;

      v_was_verified := (v_profile.cni_verified = 'verified');

      -- Le changement d'identité sur un CNI vérifié invalide la
      -- certification : le nom du compte MoMo / la CNI correspondent
      -- aux anciens valeurs, la revue doit repasser.
      v_reset := v_was_verified
        and (v_profile.first_name <> p_first_name
             or v_profile.last_name <> p_last_name
             or v_profile.date_of_birth <> p_date_of_birth);

      perform jsonb_set(
        v_changes,
        '{first_name}',
        to_jsonb(jsonb_build_object('was', v_profile.first_name, 'now', p_first_name))
      );
      perform jsonb_set(
        v_changes,
        '{last_name}',
        to_jsonb(jsonb_build_object('was', v_profile.last_name, 'now', p_last_name))
      );
      perform jsonb_set(
        v_changes,
        '{date_of_birth}',
        to_jsonb(jsonb_build_object('was', v_profile.date_of_birth, 'now', p_date_of_birth))
      );

      -- GUC requis : la remise de cni_verified à 'pending' est legale
      -- sans GUC (le trigger ne protège que le passage VERS 'verified'),
      -- mais on pose le GUC par cohérence avec le pattern maison —
      -- l'écriture system sur CNI est une écriture system.
      perform set_config('easyjob.system_update', 'on', true);
      update public.candidate_profiles
      set first_name         = trim(p_first_name),
          last_name          = trim(p_last_name),
          date_of_birth      = p_date_of_birth,
          cni_verified       = case when v_reset then 'pending' else cni_verified end,
          cni_rejection_reason = case when v_reset then null else cni_rejection_reason end
      where id = v_profile.id;
      perform set_config('easyjob.system_update', 'off', true);

      -- Recompute du flag de synthèse : si v_reset, is_verified
      -- retombe à false (la recompute porte sur l'ÉTAT cni_verified).
      perform public.recompute_user_verification(p_user_id);

      insert into public.audit_logs (
        actor_id, actor_role, action, resource_type, resource_id, metadata
      ) values (
        (select auth.uid()),
        (select role::text from public.users where id = (select auth.uid())),
        'admin_edit_identity',
        'candidate_profiles',
        (select id from public.candidate_profiles where user_id = p_user_id limit 1),
        jsonb_build_object(
          'user_id', p_user_id,
          'was_cni_verified', v_was_verified,
          'cni_reset', v_reset,
          'changes', v_changes
        )
      );

      insert into public.notifications (
        user_id, notification_type, title, body, data
      ) values (
        p_user_id,
        'document_status',
        case when v_reset
          then 'Re-vérification de votre identité demandée'
          else 'Vos informations ont été mises à jour'
        end,
        case when v_reset
          then 'L''administration a modifié votre nom ou votre date de naissance. Votre CNI doit être re-vérifiée : merci de renvoyer une nouvelle CNI dans votre espace (« Mes documents »).'
          else 'L''administration a mis à jour certaines de vos informations.'
        end,
        jsonb_build_object('action', 'admin_edit_identity', 'cni_reset', v_reset)
      );
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.admin_edit_candidate_identity(
      uuid, text, text, date
    ) to authenticated
  $ext$;
END;
$identity$;
