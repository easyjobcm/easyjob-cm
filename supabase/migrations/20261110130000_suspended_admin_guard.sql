-- Migration : un compte admin suspendu perd ses droits d'administration (lot 10)
-- Date : 2026-11-10
-- Fonctions : is_admin_user, is_ops_admin_user
-- Politiques : audit_logs_select_founder_only, cancellation_penalties_admin_select
--
-- Constat (AUDIT.md §28, preuve admin-centralization I3-I5) : avec le jeton
-- obtenu avant sa suspension (users.is_active = false), un admin_ops lisait
-- encore CNI et Mobile Money des candidats, créait des URL signées du bucket
-- privé, suspendait un candidat par RPC (avec audit) et insérait des
-- notifications. is_admin_user() et is_ops_admin_user() ne lisaient que le
-- rôle ; deux politiques reproduisaient ce contrôle en dur. Le canal
-- Realtime `admin` (rt_session_is_active_admin) et les RPC de contestation
-- et de modération relisaient déjà is_active.
--
-- Règle : un compte d'administration n'exerce son grade que s'il est actif
-- (is_active n'est pas false, même convention que rt_session_is_active_admin).
-- Inchangé : lecture de ses propres données (politiques « propriétaire »,
-- my_account_state) et canal privé user:<uid> (signal de suspension).
-- Toutes les politiques, RPC et politiques Storage qui appellent ces deux
-- fonctions héritent de la règle.
--
-- Rollback :
--   create or replace function public.is_admin_user(uid uuid) returns boolean
--     language sql stable as $$ select exists (select 1 from public.users u
--     where u.id = uid and u.role::text in ('admin_support','admin_ops','admin_founder')); $$;
--   create or replace function public.is_ops_admin_user(uid uuid) returns boolean
--     language sql stable as $$ select exists (select 1 from public.users u
--     where u.id = uid and u.role::text in ('admin_ops','admin_founder')); $$;
--   puis recréer les deux politiques sans la condition is_active.

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.is_active is not false
      and u.role::text in ('admin_support', 'admin_ops', 'admin_founder')
  );
$$;

create or replace function public.is_ops_admin_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.is_active is not false
      and u.role::text in ('admin_ops', 'admin_founder')
  );
$$;

drop policy if exists audit_logs_select_founder_only on public.audit_logs;
create policy audit_logs_select_founder_only on public.audit_logs
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.is_active is not false
        and u.role::text = 'admin_founder'
    )
  );

drop policy if exists cancellation_penalties_admin_select on public.cancellation_penalties;
create policy cancellation_penalties_admin_select on public.cancellation_penalties
  for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
        and users.is_active is not false
        and users.role = any (array['admin_ops'::public.user_role, 'admin_founder'::public.user_role])
    )
  );
