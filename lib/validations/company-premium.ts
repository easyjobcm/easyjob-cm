import { z } from "zod";
import {
  candidatePremiumActionSchema,
  premiumBodyRefusal as candidateBodyRefusal,
  PREMIUM_OPERATIONS,
  type PremiumOperation,
} from "@/lib/validations/candidate-premium";

/**
 * ABO-07 — plan entreprise Premium attribué par l'équipe (aucun paiement).
 *
 * Même corps de requête que le lot 17a (opération, fin explicite sous la
 * borne technique du 10000-01-01 UTC, fin attendue, motif de 10 à 500
 * caractères, clé d'idempotence). La RPC `admin_manage_company_premium`
 * revérifie tout en base.
 */
export const companyPremiumActionSchema = candidatePremiumActionSchema;
export type CompanyPremiumAction = z.infer<typeof companyPremiumActionSchema>;

/** Refus métier de la RPC (message de l'exception) → statut HTTP. */
export const COMPANY_PREMIUM_RPC_REFUSALS = {
  forbidden: 403,
  company_not_found: 404,
  request_invalid: 400,
  operation_invalid: 400,
  reason_invalid: 400,
  period_invalid: 400,
  premium_already_active: 409,
  premium_not_active: 409,
  premium_state_changed: 409,
  request_conflict: 409,
} as const;

export type CompanyPremiumRefusal = keyof typeof COMPANY_PREMIUM_RPC_REFUSALS;

export function companyPremiumRefusal(
  message: string | undefined,
): { code: CompanyPremiumRefusal; status: number } | null {
  if (message && message in COMPANY_PREMIUM_RPC_REFUSALS) {
    const code = message as CompanyPremiumRefusal;
    return { code, status: COMPANY_PREMIUM_RPC_REFUSALS[code] };
  }
  return null;
}

/** Premier code d'un corps refusé par Zod, sinon `invalid_request`. */
export function companyPremiumBodyRefusal(
  issueMessage: string | undefined,
): string {
  return candidateBodyRefusal(issueMessage);
}

const COMPANY_HISTORY_OPERATIONS = [
  ...PREMIUM_OPERATIONS,
  "requalify",
] as const;

/** État renvoyé par `admin_company_premium` (lecture des trois grades). */
export const companyPremiumStateSchema = z.object({
  server_now: z.string(),
  plan: z.enum(["free", "premium"]),
  premium_until: z.string().nullable(),
  premium_started_at: z.string().nullable(),
  history: z.array(
    z.object({
      id: z.string().uuid(),
      operation: z.enum(COMPANY_HISTORY_OPERATIONS),
      resulting_plan: z.enum(["free", "premium"]),
      period_started_at: z.string().nullable(),
      previous_ends_at: z.string().nullable(),
      ends_at: z.string().nullable(),
      legacy_plan: z.enum(["starter", "pro", "business"]).nullable(),
      legacy_expires_at: z.string().nullable(),
      reason: z.string(),
      source: z.enum(["admin_grant", "requalification"]),
      actor_role: z.string(),
      actor_email: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

export type CompanyPremiumState = z.infer<typeof companyPremiumStateSchema>;
export type { PremiumOperation };
