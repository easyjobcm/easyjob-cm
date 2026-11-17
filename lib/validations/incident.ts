import { z } from "zod";

/**
 * Incidents de mission par journée (lot 14) : schémas partagés entre les
 * écrans et les routes. La base revérifie tout (partie, journée, état).
 */
export const INCIDENT_KINDS = ["late", "absence", "code_not_received"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** Natures ouvertes à chaque partie (mêmes règles que la base). */
export const INCIDENT_KINDS_BY_PARTY = {
  candidate: ["late", "absence", "code_not_received"],
  company: ["late", "absence"],
} as const satisfies Record<"candidate" | "company", readonly IncidentKind[]>;

const statement = z
  .string()
  .trim()
  .min(10, "statement_invalid")
  .max(2000, "statement_invalid");

export const incidentReportSchema = z
  .object({
    mission_day_id: z.string().uuid("mission_not_found"),
    kind: z.enum(INCIDENT_KINDS, { message: "incident_kind_invalid" }),
    statement,
    late_minutes: z
      .number()
      .int("late_minutes_invalid")
      .min(1, "late_minutes_invalid")
      .max(720, "late_minutes_invalid")
      .nullish(),
  })
  .refine((d) => d.kind === "late" || d.late_minutes == null, {
    message: "late_minutes_invalid",
    path: ["late_minutes"],
  });

export type IncidentReportInput = z.infer<typeof incidentReportSchema>;

export const incidentStatementSchema = z.object({ statement });

export const incidentDecisionSchema = z.object({
  outcome: z.enum(["established", "not_established"], {
    message: "outcome_invalid",
  }),
  note: z.string().trim().min(10, "note_invalid").max(2000, "note_invalid"),
});

/**
 * Contact du support avec l'entreprise (lot 15) : une demande (request)
 * se distingue de la réponse effectivement obtenue (response). Une
 * confirmation du travail porte toujours sa référence privée.
 */
export const CONTACT_CHANNELS = [
  "phone",
  "sms",
  "whatsapp",
  "email",
  "in_person",
  "other",
] as const;
export const CONTACT_RESULTS = {
  request: ["sent", "no_answer", "unreachable"],
  response: ["work_confirmed", "work_disputed", "other"],
} as const;
export type ContactEntryType = keyof typeof CONTACT_RESULTS;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export type ContactResult = (typeof CONTACT_RESULTS)[ContactEntryType][number];

export const incidentContactSchema = z
  .object({
    // Lot 16 : canal vérifié (numéro ou adresse vérifiés de l'entreprise).
    channel_verified: z.boolean().optional().default(false),
    entry_type: z.enum(["request", "response"], { message: "contact_invalid" }),
    channel: z.enum(CONTACT_CHANNELS, { message: "contact_invalid" }),
    occurred_at: z.iso.datetime({
      offset: true,
      message: "contact_date_invalid",
    }),
    result: z.string({ message: "contact_invalid" }),
    reference: z
      .string()
      .trim()
      .max(500, "contact_invalid")
      .nullish()
      .transform((v) => (v ? v : null)),
    note: z
      .string()
      .trim()
      .max(2000, "contact_invalid")
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((d, ctx) => {
    const allowed: readonly string[] = CONTACT_RESULTS[d.entry_type];
    if (!allowed.includes(d.result)) {
      ctx.addIssue({ code: "custom", message: "contact_invalid" });
      return;
    }
    if (d.result === "work_confirmed" && !d.reference) {
      ctx.addIssue({ code: "custom", message: "reference_required" });
      return;
    }
    if (d.reference && d.reference.length < 3) {
      ctx.addIssue({ code: "custom", message: "contact_invalid" });
    }
  });

export type IncidentContactInput = z.infer<typeof incidentContactSchema>;

/** Confirmation de la journée par le support (lot 15). */
export const dayConfirmationSchema = z.object({
  contact_id: z.string().uuid("company_confirmation_required"),
  reason: z.string().trim().min(10, "note_invalid").max(2000, "note_invalid"),
});

// ── Lot 16 : instruction, double validation et révision interne ──

/** Situations qualifiées par le support. */
export const INCIDENT_SITUATIONS = [
  "company_unreachable",
  "presence_disputed",
  "partial_work",
  "quality_disputed",
  "late_or_conduct",
] as const;
export type IncidentSituation = (typeof INCIDENT_SITUATIONS)[number];

/** Résultats d'une décision instruite. */
export const DISPUTE_OUTCOMES = [
  "established",
  "not_established",
  "partial",
  "disagreement",
] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const situationSchema = z.object({
  situation: z.enum(INCIDENT_SITUATIONS, { message: "situation_invalid" }),
});

export const incidentNoteSchema = z.object({
  body: z.string().trim().min(3, "note_invalid").max(2000, "note_invalid"),
});

export const deadlineExtensionSchema = z.object({
  hours: z
    .number({ message: "extension_invalid" })
    .int("extension_invalid")
    .min(1, "extension_invalid")
    .max(168, "extension_invalid"),
  reason: z.string().trim().min(10, "note_invalid").max(1000, "note_invalid"),
});

export const infoRequestSchema = z.object({
  party: z.enum(["candidate", "company"], { message: "party_invalid" }),
  question: z
    .string()
    .trim()
    .min(10, "question_invalid")
    .max(1000, "question_invalid"),
});

export const infoAnswerSchema = z.object({ statement });

/** Déclaration de conflit d'intérêts exigée à chaque étape. */
const conflict = z.enum(["none", "concerned"], {
  message: "conflict_declaration_required",
});

const decisionText = z
  .string()
  .trim()
  .min(10, "decision_text_invalid")
  .max(4000, "decision_text_invalid");
const followup = z
  .string()
  .trim()
  .max(2000, "disagreement_followup_required")
  .nullish()
  .transform((v) => (v ? v : null));

const decisionBody = {
  facts_retained: decisionText,
  elements_verified: decisionText,
  contradictions: decisionText,
  justification: decisionText,
  amicable_attempt: followup,
  orientation: followup,
};

/** Désaccord persistant : tentative amiable et orientation exigées. */
function requireFollowup(
  outcome: string | null | undefined,
  d: { amicable_attempt: string | null; orientation: string | null },
  ctx: z.RefinementCtx,
) {
  if (
    outcome === "disagreement" &&
    (!d.amicable_attempt ||
      !d.orientation ||
      d.amicable_attempt.length < 10 ||
      d.orientation.length < 10)
  ) {
    ctx.addIssue({ code: "custom", message: "disagreement_followup_required" });
  }
}

export const proposalSchema = z
  .object({
    outcome: z.enum(DISPUTE_OUTCOMES, { message: "outcome_invalid" }),
    ...decisionBody,
    conflict,
  })
  .superRefine((d, ctx) => requireFollowup(d.outcome, d, ctx));

export const proposalReviewSchema = z.object({
  approve: z.boolean({ message: "outcome_invalid" }),
  note: z.string().trim().min(10, "note_invalid").max(2000, "note_invalid"),
  conflict,
});

export const appealTakeSchema = z.object({ conflict });

export const appealDecisionSchema = z
  .object({
    result: z.enum(["upheld", "revised", "arbitration_required"], {
      message: "outcome_invalid",
    }),
    new_outcome: z
      .enum(DISPUTE_OUTCOMES, { message: "outcome_invalid" })
      .nullish()
      .transform((v) => v ?? null),
    ...decisionBody,
  })
  .superRefine((d, ctx) => {
    if (d.result === "revised" && !d.new_outcome) {
      ctx.addIssue({ code: "custom", message: "outcome_invalid" });
      return;
    }
    if (d.result === "revised") requireFollowup(d.new_outcome, d, ctx);
  });

export const reviewRequestSchema = z.object({ statement });

/** Codes des RPC d'incident et statut HTTP de chacun. */
export const INCIDENT_RPC_REFUSALS = {
  not_authenticated: 401,
  account_suspended: 403,
  forbidden: 403,
  mission_not_found: 404,
  incident_not_found: 404,
  evidence_not_found: 404,
  incident_kind_invalid: 400,
  statement_invalid: 400,
  late_minutes_invalid: 400,
  outcome_invalid: 400,
  note_invalid: 400,
  evidence_invalid: 400,
  mission_not_active: 409,
  day_already_confirmed: 409,
  day_not_started: 409,
  incident_closed: 409,
  incident_already_decided: 409,
  statement_limit: 409,
  evidence_limit: 409,
  // Lot 15 : « code non remis » à la fin prévue, journée commencée.
  day_not_ended: 409,
  start_not_confirmed: 409,
  // Lot 15 : contacts et confirmation de la journée par le support.
  use_day_confirmation: 409,
  company_confirmation_required: 409,
  contact_invalid: 400,
  contact_date_invalid: 400,
  reference_required: 400,
  // Lot 16 : instruction, double validation et révision interne.
  use_dispute_decision: 409,
  situation_invalid: 400,
  extension_invalid: 400,
  party_invalid: 400,
  question_invalid: 400,
  decision_text_invalid: 400,
  disagreement_followup_required: 400,
  conflict_declaration_required: 400,
  conflict_of_interest: 409,
  outcome_not_applicable: 409,
  escalation_pending: 409,
  second_channel_required: 409,
  proposal_not_found: 404,
  proposal_closed: 409,
  self_review_forbidden: 409,
  proposer_conflict: 409,
  proposal_stale: 409,
  no_decision: 409,
  review_window_closed: 409,
  review_already_decided: 409,
  appeal_not_found: 404,
  reviewer_not_eligible: 409,
  appeal_already_assigned: 409,
  appeal_not_assigned: 409,
  arbitration_required: 409,
} as const;

export type IncidentRefusal = keyof typeof INCIDENT_RPC_REFUSALS;

export function incidentRefusal(
  message: string | undefined,
): { code: IncidentRefusal; status: number } | null {
  if (message && message in INCIDENT_RPC_REFUSALS) {
    const code = message as IncidentRefusal;
    return { code, status: INCIDENT_RPC_REFUSALS[code] };
  }
  return null;
}

/** Premier code d'un corps refusé par Zod (400), sinon invalid_request. */
export function incidentBodyRefusal(issueMessage: string | undefined): string {
  return issueMessage && issueMessage in INCIDENT_RPC_REFUSALS
    ? issueMessage
    : "invalid_request";
}

export const INCIDENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
