import { z } from "zod";

/**
 * Lot 17a — attribution administrative de Premium (aucun paiement).
 *
 * Schéma partagé par le panneau admin et la route
 * `/api/admin/candidates/[id]/premium`. La RPC
 * `admin_manage_candidate_premium` revérifie tout en base : grade
 * (`is_ops_admin_user`), état verrouillé, période, motif, idempotence.
 */

export const PREMIUM_OPERATIONS = ["activate", "extend", "stop"] as const;
export type PremiumOperation = (typeof PREMIUM_OPERATIONS)[number];

/**
 * Borne technique d'une date de fin (exclue), comme
 * `candidate_premium_max_end()` en base : années à quatre chiffres (ISO 8601
 * de l'API et de Zod, champ datetime-local). Aucune durée commerciale.
 */
export const PREMIUM_END_EXCLUSIVE_MS = Date.UTC(10000, 0, 1);

export const PREMIUM_REASON_MIN = 10;
export const PREMIUM_REASON_MAX = 500;

const instant = z.iso.datetime({ offset: true });
const premiumEnd = instant.refine(
  (v) => Date.parse(v) < PREMIUM_END_EXCLUSIVE_MS,
  "period_invalid",
);

export const candidatePremiumActionSchema = z
  .object({
    // Une clé par envoi de formulaire : une relance réseau rejoue la même.
    request_id: z.string().uuid("request_invalid"),
    operation: z.enum(PREMIUM_OPERATIONS, "operation_invalid"),
    ends_at: premiumEnd.nullable(),
    // Fin lue par l'agent : refus si l'état a changé entre-temps.
    expected_until: instant.nullable(),
    reason: z
      .string()
      .trim()
      .min(PREMIUM_REASON_MIN, "reason_invalid")
      .max(PREMIUM_REASON_MAX, "reason_invalid"),
  })
  .superRefine((v, ctx) => {
    if (v.operation !== "stop" && !v.ends_at) {
      ctx.addIssue({
        code: "custom",
        message: "period_invalid",
        path: ["ends_at"],
      });
    }
  });

export type CandidatePremiumAction = z.infer<
  typeof candidatePremiumActionSchema
>;

/** Refus métier de la RPC (message de l'exception) → statut HTTP. */
export const PREMIUM_RPC_REFUSALS = {
  forbidden: 403,
  candidate_not_found: 404,
  request_invalid: 400,
  operation_invalid: 400,
  reason_invalid: 400,
  period_invalid: 400,
  premium_already_active: 409,
  premium_not_active: 409,
  premium_state_changed: 409,
  request_conflict: 409,
} as const;

export type PremiumRefusal = keyof typeof PREMIUM_RPC_REFUSALS;

export function premiumRefusal(
  message: string | undefined,
): { code: PremiumRefusal; status: number } | null {
  if (message && message in PREMIUM_RPC_REFUSALS) {
    const code = message as PremiumRefusal;
    return { code, status: PREMIUM_RPC_REFUSALS[code] };
  }
  return null;
}

/** Premier code d'un corps refusé par Zod, sinon `invalid_request`. */
export function premiumBodyRefusal(issueMessage: string | undefined): string {
  return issueMessage && issueMessage in PREMIUM_RPC_REFUSALS
    ? issueMessage
    : "invalid_request";
}

/** État renvoyé par `admin_candidate_premium` (lecture des trois grades). */
export const candidatePremiumStateSchema = z.object({
  server_now: z.string(),
  plan: z.enum(["free", "premium"]),
  premium_until: z.string().nullable(),
  premium_started_at: z.string().nullable(),
  history: z.array(
    z.object({
      id: z.string().uuid(),
      operation: z.enum(PREMIUM_OPERATIONS),
      period_started_at: z.string().nullable(),
      previous_ends_at: z.string().nullable(),
      ends_at: z.string(),
      reason: z.string(),
      source: z.literal("admin_grant"),
      actor_role: z.string(),
      actor_email: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

export type CandidatePremiumState = z.infer<typeof candidatePremiumStateSchema>;

/** Opérations proposées selon le plan effectif. */
export function allowedPremiumOperations(
  plan: "free" | "premium",
): PremiumOperation[] {
  return plan === "premium" ? ["extend", "stop"] : ["activate"];
}
