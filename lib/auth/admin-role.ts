/**
 * Grades d'administration (`public.users.role`), comme `is_admin_user()` en
 * base. Module pur : utilisable côté serveur, client et dans les tests.
 */
export const ADMIN_ROLES = [
  "admin_support",
  "admin_ops",
  "admin_founder",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(
  role: string | null | undefined,
): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role ?? "");
}
