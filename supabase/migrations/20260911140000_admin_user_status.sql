-- Migration : Suspension / réactivation de compte (T8.4a)
-- Date : 2026-09-11
-- Tables affectées : users (is_active — colonne existante de la baseline,
--                    jamais écrite jusqu'ici), notifications (type 'system'),
--                    audit_logs (actions suspend_user / activate_user)
--
-- Objectif (SRS §5.8 / §6.19, vue centralisée T8.4a) :
--   Les pages /admin/candidates et /admin/composent une vue centralisée
--   (carte par utilisateur : identité, MoMo, statuts CNI/MoMo, étoiles).
--   Un compte « suspendu » = users.is_active = false : l'utilisateur ne
--   peut plus postuler (gate apply → 403 account_suspended) ni publier
--   d'offre (gate /api/jobs POST → 403 account_suspended), sans jamais
--   toucher aux flags de vérification (is_verified, cni_verified, ...).
--
--   `admin_set_user_active(uuid, boolean)` : SECURITY DEFINER, réservé à
--   admin_ops/admin_founder (admin_support = lecture seule, cohérent avec
--   toutes les mutations T8). Cibles : candidats (candidate /
--   candidate_premium) et entreprises (company / company_premium) —
--   jamais un compte admin, jamais soi-même (un admin ne se verrouille
--   pas lui-même). Écrit la notification `system`, l'audit et laisse
--   `is_active` seul levier (le gate lit la colonne).
--
-- Dépendances : migrations 20260526130000 (baseline : users.is_active,
-- audit_logs policy admin insert, notifications policy admin insert,
-- enum notification_type incluant 'system'), 20260910120000 (fonction
-- is_admin_user déjà en production).
--
-- Rollback :
--   drop function if exists public.admin_set_user_active(uuid, boolean);
--   revert app/api/jobs/[id]/apply/route.ts (gate is_active)
--   revert app/api/jobs/route.ts (gate is_active)

DO $status$
BEGIN
  EXECUTE $ext$
    create or replace function public.admin_set_user_active(
      p_user_id uuid,
      p_active  boolean
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_role    text;
      v_was     boolean;
    begin
      if not public.is_admin_user((select auth.uid())) then
        raise exception 'not authorized: admin only';
      end if;

      select role into v_role from public.users where id = (select auth.uid());
      if v_role not in ('admin_ops', 'admin_founder') then
        raise exception 'not authorized: role must be admin_ops or admin_founder';
      end if;

      -- Jamais un compte admin (ni soi-même) : la suspension n'existe
      -- que pour les comptes métier (candidats / entreprises).
      if p_user_id = (select auth.uid()) or p_user_id is null then
        raise exception 'cannot modify own account';
      end if;

      select role, is_active into v_role, v_was
      from public.users
      where id = p_user_id;

      if v_role is null then
        raise exception 'user not found';
      end if;

      if v_role not in ('candidate', 'candidate_premium',
                        'company', 'company_premium') then
        raise exception 'cannot modify admin account';
      end if;

      -- Idempotent : même état → aucun effet, aucune notification.
      if p_active = v_was then
        return;
      end if;

      update public.users
      set is_active = p_active
      where id = p_user_id;

      insert into public.audit_logs (
        actor_id, actor_role, action, resource_type, resource_id, metadata
      ) values (
        (select auth.uid()),
        (select role::text from public.users where id = (select auth.uid())),
        case when p_active then 'activate_user' else 'suspend_user' end,
        'users',
        p_user_id,
        jsonb_build_object('was_active', v_was, 'is_active', p_active)
      );

      insert into public.notifications (
        user_id, notification_type, title, body, data
      ) values (
        p_user_id,
        'system',
        case when p_active then 'Compte réactivé' else 'Compte suspendu' end,
        case
          when p_active
            then 'Votre compte a été réactivé. Vous pouvez de nouveau postuler aux offres et travailler.'
          else 'Votre compte a été suspendu par l''administration. Vous ne pouvez plus postuler ni travailler. Contactez le support pour plus d''information.'
        end,
        jsonb_build_object('action', case when p_active then 'activate' else 'suspend' end)
      );
    end;
    $body$
  $ext$;

  EXECUTE $ext$
    grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated
  $ext$;
END;
$status$;
