// Constantes et types liés aux plans entreprise (SRS v1.2).
// Les pénalités d'annulation et les délais de versement du SRS ne sont pas
// implémentés (lots « Engagements et annulations » et paiement).

export type CompanyPlan = "free" | "starter" | "pro" | "business";

export const COMPANY_PLAN_FEES = {
  free: {
    serviceFeePct: 10,
    urgentFee: 2000,
    selectionDeadlineHours: 48,
    lateCancellationHours: 48,
    trialDays: 0,
  },
  starter: {
    serviceFeePct: 8,
    urgentFee: 1000,
    selectionDeadlineHours: 24,
    lateCancellationHours: 48,
    trialDays: 0,
  },
  pro: {
    serviceFeePct: 0,
    urgentFee: 0,
    selectionDeadlineHours: 12,
    lateCancellationHours: 24,
    trialDays: 7,
  },
  business: {
    serviceFeePct: 0,
    urgentFee: 0,
    selectionDeadlineHours: 6,
    lateCancellationHours: 12,
    trialDays: 7,
  },
} as const;
