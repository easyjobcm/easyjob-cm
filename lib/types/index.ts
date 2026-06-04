// Constantes et types liés aux plans entreprise (SRS v1.2).
// Source unique de vérité pour les règles tarifaires, pénalités d'annulation
// et délais de paiement.

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

export const CANCELLATION_PENALTY_RULES = {
  free: { candidatePremiumPct: 25, easyjobPct: 25, companyRefundPct: 50 },
  starter: { candidatePremiumPct: 25, easyjobPct: 25, companyRefundPct: 50 },
  pro: { candidatePremiumPct: 25, easyjobPct: 0, companyRefundPct: 75 },
  business: { candidatePremiumPct: 0, easyjobPct: 0, companyRefundPct: 100 },
} as const;

export const PAYMENT_DELAY_RULES = {
  premiumAndHighRating: { pct1: 100, delay1: "48h", pct2: 0, delay2: null },
  premiumOrHighRating: { pct1: 50, delay1: "48h", pct2: 50, delay2: "7d" },
  standard: { pct1: 100, delay1: "7d", pct2: 0, delay2: null },
} as const;
