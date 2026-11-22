// Helpers de différenciation des statuts utilisateurs (candidat / entreprise).
// Plan candidat effectif : candidate_effective_plan en base (lot 17a) ;
// plan entreprise : company_effective_plan (ABO-07, lib/utils/company-plan.ts).
// Tous deux lus par my_account_state ; jamais le rôle seul.

export type UserRole =
  | "candidate"
  | "candidate_premium"
  | "company"
  | "company_premium"
  | "admin_support"
  | "admin_ops"
  | "admin_founder";

/**
 * Rôle entreprise, standard ou premium : mêmes écrans entreprise, comme les
 * RPC `create_job`, `sign_and_select`, etc. (`role in ('company',
 * 'company_premium')`).
 */
export function isCompanyRole(role: string | null | undefined): boolean {
  return role === "company" || role === "company_premium";
}

export function formatDateShort(
  value: string | Date | null | undefined,
  locale: "fr" | "en" = "fr",
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
