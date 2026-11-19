import { z } from "zod";

/**
 * Interruption d'une journée commencée (décisions du 2026-11-19 et du
 * 2026-11-20).
 *
 * Une partie signale l'interruption (travail déclaré, raison, heure, cause)
 * dans un dossier du support ; l'autre partie donne sa version (72 h). Le
 * support et les opérations recueillent justificatifs et contacts ; seul le
 * fondateur actif propose un montant motivé, prolonge son délai, clôt le
 * dossier ou finalise un accord. Chaque partie accepte ou refuse la même
 * version pour son propre compte (48 h) ; le silence ne vaut jamais accord.
 * Bornes validées (2026-11-21) : entier en XAF, de 0 au plafond lu dans le
 * contrat figé (montant d'une mission d'une journée, sinon part de la
 * journée au prorata des horaires contractuels, arrondie à l'entier
 * inférieur). Une partie peut demander le réexamen d'une décision du
 * fondateur. L'entreprise ne fixe jamais le montant. La base revérifie
 * tout, à l'heure du serveur.
 */

export const INTERRUPTION_CAUSES = [
  "candidate_left",
  "company_stopped",
] as const;
export type InterruptionCause = (typeof INTERRUPTION_CAUSES)[number];

export const INTERRUPTION_STAGES = [
  "instruction",
  "founder_review",
  "awaiting_parties",
  "agreement",
  "closed",
] as const;
export type InterruptionStage = (typeof INTERRUPTION_STAGES)[number];

export const PROPOSAL_STATUSES = [
  "open",
  "accepted",
  "refused",
  "expired",
  "superseded",
] as const;

export const CLOSURE_OUTCOMES = [
  "not_established",
  "disagreement",
  "settled",
] as const;

/** Clôtures motivées ouvertes au fondateur (« réglé » vient de l'accord). */
export const FOUNDER_CLOSURES = ["not_established", "disagreement"] as const;

export const NOTICE_KINDS = [
  "version_request",
  "version_reminder",
  "version_expired",
  "info_request",
  "info_reminder",
  "info_expired",
  "proposal",
  "proposal_reminder",
  "proposal_expired",
  "proposal_refused",
  "agreement",
  "review_extended",
  "founder_overdue",
  "recourse",
  "closure",
  "finalized",
  "new_element",
  "reexam_request",
  "reexam_decision",
] as const;

export const REEXAM_DECISIONS = [
  "maintained",
  "reopened",
  "separate_handling",
] as const;

const text = (code: string) => z.string().trim().min(10, code).max(2000, code);
const party = z.enum(["candidate", "company"]);

export const interruptionReportSchema = z.object({
  mission_day_id: z.string().uuid("mission_not_found"),
  cause: z.enum(INTERRUPTION_CAUSES, "interruption_cause_invalid"),
  declared_at: z.iso.datetime({
    offset: true,
    message: "declared_time_invalid",
  }),
  work_done: text("work_done_invalid"),
  statement: text("statement_invalid"),
});
export type InterruptionReport = z.infer<typeof interruptionReportSchema>;

// ── Actions des parties (POST /api/interruptions/[id]) ──

export const partyInterruptionActionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("respond"),
      proposal_id: z.string().uuid("settlement_not_found"),
      version: z
        .number("settlement_changed")
        .int()
        .min(1, "settlement_changed"),
      decision: z.enum(["accept", "refuse"], "decision_invalid"),
    }),
    z.object({ action: z.literal("recourse") }),
    z.object({ action: z.literal("viewed") }),
    z.object({
      action: z.literal("reexamination"),
      reason: text("motivation_invalid"),
    }),
  ],
  "invalid_request",
);
export type PartyInterruptionAction = z.infer<
  typeof partyInterruptionActionSchema
>;

// ── Actions du fondateur (POST /api/admin/incidents/[id]/interruption) ──

const motivation = text("motivation_invalid");

export const founderInterruptionActionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("propose"),
      amount: z
        .number("amount_invalid")
        .int("amount_invalid")
        .min(0, "amount_invalid"),
      motivation,
      expected_version: z
        .number("settlement_changed")
        .int("settlement_changed")
        .min(0, "settlement_changed"),
    }),
    z.object({
      action: z.literal("close"),
      outcome: z.enum(FOUNDER_CLOSURES, "closure_outcome_invalid"),
      motivation,
    }),
    z.object({
      action: z.literal("extend"),
      ends_at: z.iso.datetime({
        offset: true,
        message: "extension_date_invalid",
      }),
      reason: z
        .string()
        .trim()
        .min(10, "note_invalid")
        .max(1000, "note_invalid"),
    }),
    z.object({
      action: z.literal("finalize"),
      version: z
        .number("settlement_changed")
        .int()
        .min(1, "settlement_changed"),
      motivation,
    }),
    z.object({
      action: z.literal("reexamination"),
      reexamination_id: z.string().uuid("reexamination_not_found"),
      decision: z.enum(REEXAM_DECISIONS, "decision_invalid"),
      motivation,
    }),
    z.object({ action: z.literal("viewed") }),
  ],
  "invalid_request",
);
export type FounderInterruptionAction = z.infer<
  typeof founderInterruptionActionSchema
>;

/** Codes des RPC d'interruption et statut HTTP de chacun. */
export const INTERRUPTION_REFUSALS = {
  not_authenticated: 401,
  account_suspended: 403,
  forbidden: 403,
  invalid_request: 400,
  mission_not_found: 404,
  incident_not_found: 404,
  settlement_not_found: 404,
  decision_invalid: 400,
  motivation_invalid: 400,
  amount_invalid: 400,
  amount_above_cap: 400,
  settlement_cap_unavailable: 409,
  extension_already_used: 409,
  no_decision: 409,
  reexamination_not_found: 404,
  reexamination_decided: 409,
  reexamination_obsolete: 409,
  requires_separate_handling: 409,
  note_invalid: 400,
  closure_outcome_invalid: 400,
  extension_date_invalid: 400,
  settlement_changed: 409,
  already_responded: 409,
  proposal_refused: 409,
  proposal_expired: 409,
  incident_closed: 409,
  settlement_not_accepted: 409,
  settlement_accepted: 409,
  settlement_rule_pending: 409,
  instruction_pending: 409,
  proposal_open: 409,
  review_not_open: 409,
  recourse_required: 409,
  day_already_confirmed: 409,
  mission_not_active: 409,
} as const;
export type InterruptionRefusal = keyof typeof INTERRUPTION_REFUSALS;

export function interruptionRefusal(
  message: string | undefined,
): { code: InterruptionRefusal; status: number } | null {
  if (message && message in INTERRUPTION_REFUSALS) {
    const code = message as InterruptionRefusal;
    return { code, status: INTERRUPTION_REFUSALS[code] };
  }
  return null;
}

// ── Lectures ──

/** État d'interruption d'une journée (`mission_days_json`). */
export const dayInterruptionSchema = z.object({
  incident_id: z.string().uuid(),
  status: z.string(),
  outcome: z.string().nullable(),
  stage: z.enum(INTERRUPTION_STAGES).nullable(),
  blocks_completion: z.boolean(),
  /** Accord valide des deux parties (code ouvert, même avant la fin). */
  agreement: z
    .object({
      proposal_id: z.string().uuid(),
      version: z.number(),
      amount: z.number(),
    })
    .nullable(),
  settled_amount: z.number().nullable(),
  closure_outcome: z.enum(CLOSURE_OUTCOMES).nullable().optional(),
});
export type DayInterruption = z.infer<typeof dayInterruptionSchema>;

export function parseDayInterruption(raw: unknown): DayInterruption | null {
  const parsed = dayInterruptionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const interruptionStateSchema = z.object({
  stage: z.enum(INTERRUPTION_STAGES),
  due_at: z.string().nullable(),
  overdue: z.boolean(),
  review_since: z.string().optional(),
  extended: z.boolean().optional(),
  outcome: z.enum(CLOSURE_OUTCOMES).optional(),
  proposal_status: z.enum(PROPOSAL_STATUSES).nullable(),
  version_due_at: z.string(),
});
export type InterruptionState = z.infer<typeof interruptionStateSchema>;

export const interruptionProposalSchema = z.object({
  id: z.string().uuid(),
  version: z.number(),
  amount: z.number(),
  motivation: z.string(),
  proposed_at: z.string(),
  respond_by: z.string(),
  superseded_at: z.string().nullable(),
  current: z.boolean(),
  status: z.enum(PROPOSAL_STATUSES),
  responses: z.array(
    z.object({
      party,
      decision: z.enum(["accept", "refuse"]),
      responded_at: z.string(),
    }),
  ),
});
export type InterruptionProposal = z.infer<typeof interruptionProposalSchema>;

export const interruptionNoticeSchema = z.object({
  kind: z.enum(NOTICE_KINDS),
  recipient: z.enum(["candidate", "company", "founder"]),
  made_available_at: z.string(),
  viewed_at: z.string().nullable(),
});

/** Détail d'une interruption (`mission_interruptions_for_party`). */
export const interruptionDetailSchema = z.object({
  incident_id: z.string().uuid(),
  mission_day_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  cause: z.enum(INTERRUPTION_CAUSES),
  declared_at: z.string(),
  work_done: z.string(),
  reported_by_party: party,
  status: z.string(),
  outcome: z.string().nullable(),
  viewer: z.enum(["candidate", "company", "admin"]),
  server_now: z.string(),
  state: interruptionStateSchema,
  blocks_completion: z.boolean(),
  instruction_open: z.boolean(),
  amount_state: z.enum([
    "settled",
    "unresolved",
    "not_applicable",
    "under_review",
  ]),
  versions: z.array(
    z.object({
      party,
      cause: z.enum(INTERRUPTION_CAUSES),
      declared_at: z.string(),
      work_done: z.string(),
      reason: z.string(),
      created_at: z.string(),
    }),
  ),
  version_request: z.object({
    party,
    due_at: z.string(),
    given_at: z.string().nullable(),
    open: z.boolean(),
  }),
  requests: z.array(
    z.object({
      id: z.string().uuid(),
      party,
      question: z.string(),
      created_at: z.string(),
      respond_by: z.string(),
      answered_at: z.string().nullable(),
      open: z.boolean(),
      expired: z.boolean(),
    }),
  ),
  proposals: z.array(interruptionProposalSchema),
  current_proposal_id: z.string().uuid().nullable(),
  closure: z
    .object({
      outcome: z.enum(CLOSURE_OUTCOMES),
      motivation: z.string().nullable(),
      amount: z.number().nullable(),
      completion_source: z.enum(["partial", "partial_support"]).nullable(),
      decided_at: z.string(),
    })
    .nullable(),
  recourses: z.array(z.object({ party, created_at: z.string() })),
  notices: z.array(interruptionNoticeSchema),
  unviewed: z.number(),
  finance: z.object({
    currency: z.string(),
    cap: z.number().nullable(),
    recognized_total: z.number().nullable(),
    recognized_status: z.string().nullable(),
    pending_amount: z.number().nullable(),
    accepted_amount: z.number().nullable(),
    settled_amount: z.number().nullable(),
    finalized: z.boolean().nullable(),
    completion_source: z.enum(["partial", "partial_support"]).nullable(),
  }),
  day_state: z.enum([
    "under_review",
    "agreement",
    "settled",
    "unresolved",
    "normal",
    "confirmed",
  ]),
  mission_days: z.object({
    total: z.number(),
    confirmed: z.number(),
    cancelled: z.number(),
  }),
  reexaminations: z.array(
    z.object({
      id: z.string().uuid(),
      party,
      reason: z.string(),
      created_at: z.string(),
      closure_outcome: z.string(),
      decision: z.enum(REEXAM_DECISIONS).nullable(),
      decision_motivation: z.string().nullable(),
      decided_at: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
  closure_history: z.array(
    z.object({
      outcome: z.string(),
      motivation: z.string().nullable(),
      decided_at: z.string(),
      revoked_at: z.string(),
    }),
  ),
  can: z.object({
    give_version: z.boolean(),
    respond: z.boolean(),
    request_recourse: z.boolean(),
    request_reexamination: z.boolean(),
  }),
});
export type InterruptionDetail = z.infer<typeof interruptionDetailSchema>;

export function parseInterruptionDetail(
  raw: unknown,
): InterruptionDetail | null {
  const parsed = interruptionDetailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Vue du support (`admin_mission_interruption`). */
export const adminInterruptionSchema = interruptionDetailSchema.extend({
  policy: z.object({
    validated: z.boolean(),
    min_amount: z.number().nullable(),
    rounding_unit: z.number().nullable(),
    cap_rule: z.string().optional(),
  }),
  viewer_is_founder: z.boolean(),
  extensions: z.array(
    z.object({
      ends_at: z.string(),
      extends_due: z.string(),
      reason: z.string(),
      created_at: z.string(),
    }),
  ),
  founder: z.object({
    can_propose: z.boolean(),
    propose_blocked: z.string().nullable(),
    can_close: z.boolean(),
    can_extend: z.boolean(),
    extension_used: z.boolean(),
    can_decide_reexamination: z.boolean(),
    can_finalize: z.boolean(),
  }),
});
export type AdminInterruption = z.infer<typeof adminInterruptionSchema>;

/** Tâche persistante d'une partie (`my_interruption_tasks`). */
export const interruptionTaskSchema = z.object({
  incident_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  job_id: z.string().uuid(),
  job_title: z.string(),
  day_date: z.string(),
  viewer: party,
  stage: z.enum(INTERRUPTION_STAGES),
  action: z.enum([
    "give_version",
    "answer_request",
    "respond_proposal",
    "agreement_code",
  ]),
  due_at: z.string().nullable(),
  request_id: z.string().uuid().optional(),
  proposal_id: z.string().uuid().optional(),
  version: z.number().optional(),
  amount: z.number().optional(),
  recourse_requested: z.boolean().optional(),
});
export type InterruptionTask = z.infer<typeof interruptionTaskSchema>;

export function parseInterruptionTasks(raw: unknown): InterruptionTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const parsed = interruptionTaskSchema.safeParse(t);
    return parsed.success ? [parsed.data] : [];
  });
}
