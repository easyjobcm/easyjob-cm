// Helpers de différenciation des statuts utilisateurs (candidat / entreprise).
// Source de vérité : users.role + subscriptions.plan + candidate_profiles.premium_until.

export type UserRole =
  | "candidate"
  | "candidate_premium"
  | "company"
  | "company_premium"
  | "admin_support"
  | "admin_ops"
  | "admin_founder";

export type CompanyPlan = "free" | "starter" | "pro" | "business";

export function isCandidatePremium(role: string): boolean {
  return role === "candidate_premium";
}

export function isCompanyPremium(role: string): boolean {
  return role === "company_premium";
}

export function normalizeCompanyPlan(value?: string | null): CompanyPlan {
  switch ((value ?? "free").toLowerCase()) {
    case "starter":
      return "starter";
    case "pro":
      return "pro";
    case "business":
      return "business";
    default:
      return "free";
  }
}

/**
 * Calcule le délai de paiement applicable pour le candidat selon la règle SRS v1.1.
 * - premium + note >= 4★ → 48h (100%)
 * - premium OU note >= 4★ → 50% immédiat + 50% à 7j (split)
 * - sinon → 7 jours
 */
export type PaymentDelayMode = "fast48h" | "split" | "standard7d";

export function computePaymentDelayMode(
  role: string,
  averageRating: number,
): PaymentDelayMode {
  const premium = isCandidatePremium(role);
  const wellRated = averageRating >= 4;
  if (premium && wellRated) return "fast48h";
  if (premium || wellRated) return "split";
  return "standard7d";
}

export interface PlanLimits {
  jobsLimit: number | "unlimited";
  urgentIncluded: boolean;
  aiRecommendations: boolean;
  reporting: "none" | "basic" | "advanced";
  directEdit: boolean;
  prioritySupport: boolean;
  accent: string; // Couleur signature du plan
  gradient: string; // Tailwind from/to/via
}

export function getPlanLimits(plan: CompanyPlan): PlanLimits {
  switch (plan) {
    case "starter":
      return {
        jobsLimit: 5,
        urgentIncluded: true,
        aiRecommendations: true,
        reporting: "none",
        directEdit: true,
        prioritySupport: false,
        accent: "#3B82F6",
        gradient: "from-blue-50 to-indigo-50",
      };
    case "pro":
      return {
        jobsLimit: "unlimited",
        urgentIncluded: true,
        aiRecommendations: true,
        reporting: "basic",
        directEdit: true,
        prioritySupport: false,
        accent: "#7C3AED",
        gradient: "from-violet-50 to-purple-50",
      };
    case "business":
      return {
        jobsLimit: "unlimited",
        urgentIncluded: true,
        aiRecommendations: true,
        reporting: "advanced",
        directEdit: true,
        prioritySupport: true,
        accent: "#D97706",
        gradient: "from-amber-50 to-yellow-50",
      };
    case "free":
    default:
      return {
        jobsLimit: 2,
        urgentIncluded: false,
        aiRecommendations: false,
        reporting: "none",
        directEdit: false,
        prioritySupport: false,
        accent: "#3B82F6",
        gradient: "from-blue-50 to-sky-50",
      };
  }
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
