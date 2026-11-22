// Plan entreprise effectif (ABO-07, docs/product/DECISIONS.md).
// Source de vérité : company_effective_plan en base, lu par
// my_account_state (`company.effective_plan`). Jamais user.role : le rôle
// company_premium seul n'accorde aucun avantage (ABO-11).

import type { CompanyPlan } from "@/lib/types";

export type { CompanyPlan };

/**
 * Valeur renvoyée par la base → plan connu. Toute autre valeur (absente,
 * inattendue) vaut Free : l'écran n'accorde jamais un droit que la base ne
 * confirme pas ; la base revérifie chaque action.
 */
export function normalizeCompanyPlan(value?: string | null): CompanyPlan {
  return value === "premium" ? "premium" : "free";
}

/**
 * ABO-08 : modification directe d'une offre active réservée à Premium
 * (aucun candidat sélectionné, nouvelle modération, calendrier figé :
 * contrôlés par `update_job`).
 */
export function companyCanDirectEdit(plan: CompanyPlan): boolean {
  return plan === "premium";
}

/**
 * Premium candidat effectif (lot 7d), miroir de `my_account_state` : rôle
 * `candidate_premium` ET `premium_until` dans le futur.
 */
export function isCandidatePremiumActive(
  role: string | null | undefined,
  premiumUntil: string | null | undefined,
  nowMs: number,
): boolean {
  if (role !== "candidate_premium" || !premiumUntil) return false;
  const end = Date.parse(premiumUntil);
  return Number.isFinite(end) && end > nowMs;
}
