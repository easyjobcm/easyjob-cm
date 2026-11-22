import { z } from "zod";

/**
 * Lots 17b–17c — annulation par le candidat, justification, recours,
 * fraude présumée et suspensions. Schémas partagés par les écrans et les
 * routes ; les RPC revérifient tout en base (classement des journées,
 * délais, grades, états, idempotence).
 */

export const CANCELLATION_REASONS = [
  "illness",
  "family_emergency",
  "transport",
  // Décision du 2026-11-18 : examinée avant toute sanction.
  "late_notification",
  "other",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const EVIDENCE_CHOICES = ["provided", "none"] as const;
export type EvidenceChoice = (typeof EVIDENCE_CHOICES)[number];

export type DayClassification =
  | "in_time"
  | "reaction_window"
  | "late"
  | "legacy";

export type CancellationStatus =
  | "closed_no_sanction"
  | "awaiting_evidence"
  | "under_review"
  | "sanctioned_no_evidence"
  | "accepted"
  | "refused";

const note = (min: number, max: number) =>
  z.string().trim().min(min, "note_invalid").max(max, "note_invalid");

export const cancellationRequestSchema = z.object({
  // Une clé par confirmation : une relance réseau rejoue la même demande.
  request_id: z.string().uuid("request_invalid"),
  day_ids: z
    .array(z.string().uuid("days_invalid"))
    .min(1, "days_invalid")
    .max(31, "days_invalid"),
  reason_code: z.enum(CANCELLATION_REASONS, "reason_required").nullable(),
  reason_text: z.string().trim().max(1000, "reason_too_long").nullable(),
  evidence_choice: z
    .enum(EVIDENCE_CHOICES, "evidence_choice_required")
    .nullable(),
});
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;

export const reviewRequestSchema = z.object({ note: note(10, 1000) });

export const cancellationDecisionSchema = z.object({
  decision: z.enum(["accepted", "refused"], "decision_invalid"),
  note: note(10, 2000),
});

export const cancellationReviewDecisionSchema = z.object({
  outcome: z.enum(["maintained", "overturned"], "decision_invalid"),
  note: note(10, 2000),
});

export const fraudReportSchema = z.object({
  subject_user_id: z.string().uuid("user_not_found"),
  cancellation_id: z.string().uuid("cancellation_not_found").nullable(),
  reason: note(10, 2000),
});

export const fraudSuspensionSchema = z.object({
  ends_at: z.iso
    .datetime({ offset: true })
    .refine((v) => Date.parse(v) < Date.UTC(10000, 0, 1), "period_invalid")
    .nullable(),
  reason: note(10, 2000),
});

export const suspensionNoteSchema = z.object({ note: note(10, 2000) });

export const CANCELLATION_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/** Refus des RPC (message de l'exception) → statut HTTP. */
export const CANCELLATION_RPC_REFUSALS = {
  not_authenticated: 401,
  forbidden: 403,
  account_suspended: 403,
  mission_not_found: 404,
  job_not_found: 404,
  cancellation_not_found: 404,
  suspension_not_found: 404,
  fraud_report_not_found: 404,
  user_not_found: 404,
  evidence_not_found: 404,
  request_invalid: 400,
  days_invalid: 400,
  reason_required: 400,
  reason_too_long: 400,
  evidence_choice_required: 400,
  note_invalid: 400,
  decision_invalid: 400,
  period_invalid: 400,
  evidence_invalid: 400,
  evidence_too_large: 413,
  evidence_limit: 409,
  request_conflict: 409,
  mission_not_active: 409,
  day_already_cancelled: 409,
  day_started: 409,
  day_already_begun: 409,
  day_cancelled: 409,
  cancellation_closed: 409,
  cancellation_not_reviewable: 409,
  already_decided: 409,
  review_not_available: 409,
  review_deadline_passed: 409,
  review_not_requested: 409,
  reviewer_must_differ: 409,
  suspension_not_active: 409,
} as const;
export type CancellationRefusal = keyof typeof CANCELLATION_RPC_REFUSALS;

export function cancellationRefusal(
  message: string | undefined,
): { code: CancellationRefusal; status: number } | null {
  if (message && message in CANCELLATION_RPC_REFUSALS) {
    const code = message as CancellationRefusal;
    return { code, status: CANCELLATION_RPC_REFUSALS[code] };
  }
  return null;
}

/** Premier code d'un corps refusé par Zod, sinon `invalid_request`. */
export function cancellationBodyRefusal(message: string | undefined): string {
  return message && message in CANCELLATION_RPC_REFUSALS
    ? message
    : "invalid_request";
}

/** Une demande doit-elle porter motif et choix de justificatif ? */
export function requiresJustification(
  classes: readonly DayClassification[],
): boolean {
  return classes.includes("late");
}

// ── Lectures ─────────────────────────────────────────────────────────

const iso = z.string();
const isoOrNull = z.string().nullable();

export const cancellationPreviewDaySchema = z.object({
  mission_day_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  day_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  starts_at: iso,
  classification: z.enum(["in_time", "reaction_window", "late", "legacy"]),
  deadline_at: isoOrNull,
  reaction_until: isoOrNull,
  server_now: iso,
});
export type CancellationPreviewDay = z.infer<
  typeof cancellationPreviewDaySchema
>;

export const cancellationSchema = z.object({
  id: z.string().uuid(),
  created_at: iso,
  job_id: z.string().uuid(),
  job_title: z.string().nullable(),
  status: z.enum([
    "closed_no_sanction",
    "awaiting_evidence",
    "under_review",
    "sanctioned_no_evidence",
    "accepted",
    "refused",
  ]),
  day_count: z.number(),
  late_day_count: z.number(),
  reason_code: z.string().nullable(),
  reason_text: z.string().nullable(),
  evidence_choice: z.string().nullable(),
  evidence_count: z.number(),
  decided_at: isoOrNull,
  decision_note: z.string().nullable(),
  sanctioned: z.boolean(),
  review_requested_at: isoOrNull,
  review_note: z.string().nullable(),
  review_deadline_at: isoOrNull,
  review_decided_at: isoOrNull,
  review_outcome: z.string().nullable(),
  review_decision_note: z.string().nullable(),
  days: z
    .array(
      z.object({
        mission_day_id: z.string().uuid(),
        mission_id: z.string().uuid(),
        starts_at: iso,
        classification: z.enum([
          "in_time",
          "reaction_window",
          "late",
          "legacy",
        ]),
        deadline_at: isoOrNull,
        reaction_until: isoOrNull,
      }),
    )
    .nullable(),
});
export type Cancellation = z.infer<typeof cancellationSchema>;

export const acquiredAmountSchema = z.object({
  mission_id: z.string().uuid(),
  currency: z.string(),
  contract_pay: z.number(),
  planned_minutes_total: z.number(),
  realized_minutes: z.number(),
  acquired_exact: z.number(),
  acquired_rounded: z.number(),
  is_integer: z.boolean(),
  /** Somme des seuls règlements partiels finalisés (aucun montant implicite). */
  settled_total: z.number(),
  /**
   * « settlement_pending » : une journée interrompue ou partielle attend un
   * règlement ; elle n'ajoute aucun montant tant qu'il n'est pas finalisé.
   */
  status: z.enum(["final", "in_progress", "settlement_pending"]),
  /** Lot 17d-2 : journées annulées par l'entreprise, hors du montant. */
  company_cancelled_days: z.number().optional(),
  days: z.array(
    z.object({
      date: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      planned_minutes: z.number(),
      realized: z.boolean(),
      cancelled: z.boolean(),
      cancelled_by: z.enum(["candidate", "company"]).nullable().optional(),
      realized_via: z.string().nullable(),
      awaiting_settlement: z.boolean(),
      /** Désaccord non résolu : aucun montant définitif (jamais zéro acquis). */
      unresolved: z.boolean().optional(),
      settled_amount: z.number().nullable(),
    }),
  ),
});
export type AcquiredAmount = z.infer<typeof acquiredAmountSchema>;

/** Montant acquis, calcul exact (référence des tests et de la base). */
export function prorataAmount(
  pay: number,
  realizedMinutes: number,
  totalMinutes: number,
): number {
  return totalMinutes > 0 ? (pay * realizedMinutes) / totalMinutes : 0;
}

/** Durée prévue d'une journée en minutes ; nuit → lendemain. */
export function plannedMinutes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const d = toMin(end) - toMin(start);
  return d <= 0 ? d + 1440 : d;
}
