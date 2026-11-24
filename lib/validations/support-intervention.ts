import { z } from "zod";

/**
 * Lot 17d-3 — interventions du support sur les engagements (ANN-17,
 * ANN-18, SAN-08). Schémas partagés par les écrans et les routes ; les RPC
 * revérifient tout en base (grades actifs, état des journées, suspension,
 * réalisation définitive, révisions, échéances, idempotence).
 */

export type EngagementRequestKind =
  | "targeted_removal"
  | "suspension_task"
  | "suspended_candidate";
export type EngagementRequestStatus = "pending" | "accepted" | "refused";
/** État courant d'une journée d'une demande, calculé par la base. */
export type SupportDayState =
  | "open"
  | "begun"
  | "started"
  | "cancelled"
  | "inactive"
  | "missing";

export type FindingOutcome = "established" | "not_established";
export type FindingStatus = "instruction" | "proposed" | "decided";

const uuid = (code: string) => z.string().uuid(code);
const days = z
  .array(uuid("days_invalid"))
  .min(1, "days_invalid")
  .max(31, "days_invalid");
const note = (min: number, max: number) =>
  z
    .string("note_invalid")
    .trim()
    .min(min, "note_invalid")
    .max(max, "note_invalid");

/** Retrait ciblé (entreprise) : motif de 10 à 500 caractères (ANN-15). */
export const targetedRemovalSchema = z.object({
  request_id: uuid("request_invalid"),
  day_ids: days,
  reason: z
    .string("cancellation_reason_required")
    .trim()
    .min(10, "cancellation_reason_required")
    .max(500, "cancellation_reason_too_long"),
});

/** Demande d'un candidat suspendu au support (message facultatif). */
export const supportCancellationSchema = z.object({
  request_id: uuid("request_invalid"),
  day_ids: days,
  message: z.string().trim().max(1000, "note_invalid").nullable(),
});

export const engagementDecisionSchema = z.object({
  decision: z.enum(["accept", "refuse"], "decision_invalid"),
  day_ids: z.array(uuid("days_invalid")).max(31, "days_invalid"),
  note: note(10, 2000),
});

export const findingOpenSchema = z.object({
  incident_id: uuid("incident_not_found"),
});
export const findingAnswerSchema = z.object({
  statement: z
    .string("statement_invalid")
    .trim()
    .min(10, "statement_invalid")
    .max(2000, "statement_invalid"),
});
export const findingProposalSchema = z.object({
  outcome: z.enum(["established", "not_established"], "outcome_invalid"),
  note: note(10, 2000),
  expected_revision: z.number("finding_stale").int("finding_stale"),
});
export const findingValidationSchema = z.object({
  approve: z.boolean("decision_invalid"),
  note: note(10, 2000),
  expected_revision: z.number("finding_stale").int("finding_stale"),
});
export const findingReviewRequestSchema = findingAnswerSchema;
export const findingReviewDecisionSchema = z.object({
  outcome: z.enum(["maintained", "overturned"], "outcome_invalid"),
  note: note(10, 2000),
});

/** Nouvel élément transmis au support (sans réouverture ni délai). */
export const findingElementSchema = z.object({
  text: z
    .string("statement_invalid")
    .trim()
    .min(10, "statement_invalid")
    .max(2000, "statement_invalid"),
});
/** Note d'instruction du support (tout admin actif). */
export const findingNoteSchema = z.object({ note: note(10, 2000) });
/** Réexamen motivé d'un refus de retrait ciblé. */
export const removalReviewSchema = z.object({
  request_id: uuid("request_invalid"),
  reason: z
    .string("cancellation_reason_required")
    .trim()
    .min(10, "cancellation_reason_required")
    .max(500, "cancellation_reason_too_long"),
});

export const FINDING_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/** Refus des RPC (message de l'exception) → statut HTTP. */
export const INTERVENTION_REFUSALS = {
  not_authenticated: 401,
  forbidden: 403,
  not_a_company: 403,
  account_suspended: 403,
  company_not_found: 403,
  job_not_found: 404,
  mission_not_found: 404,
  request_not_found: 404,
  finding_not_found: 404,
  incident_not_found: 404,
  evidence_not_found: 404,
  request_invalid: 400,
  days_invalid: 400,
  note_invalid: 400,
  decision_invalid: 400,
  outcome_invalid: 400,
  statement_invalid: 400,
  evidence_invalid: 400,
  cancellation_reason_required: 400,
  cancellation_reason_too_long: 400,
  evidence_too_large: 413,
  evidence_limit: 409,
  request_conflict: 409,
  request_not_refused: 409,
  reexamination_exists: 409,
  request_already_decided: 409,
  removal_already_requested: 409,
  mission_not_active: 409,
  day_already_cancelled: 409,
  day_started: 409,
  day_already_begun: 409,
  day_not_covered: 409,
  day_already_confirmed: 409,
  suspension_not_active: 409,
  incident_kind_invalid: 409,
  finding_decided: 409,
  finding_stale: 409,
  proposal_pending: 409,
  no_proposal: 409,
  validator_must_differ: 409,
  reviewer_must_differ: 409,
  realization_review_open: 409,
  realization_not_absence: 409,
  work_confirmed: 409,
  realization_ambiguous: 409,
  response_window_open: 409,
  response_window_closed: 409,
  no_decision: 409,
  review_window_closed: 409,
  review_already_requested: 409,
  review_not_requested: 409,
  already_decided: 409,
} as const;
export type InterventionRefusal = keyof typeof INTERVENTION_REFUSALS;

export function interventionRefusal(
  message: string | undefined,
): { code: InterventionRefusal; status: number } | null {
  if (message && message in INTERVENTION_REFUSALS) {
    const code = message as InterventionRefusal;
    return { code, status: INTERVENTION_REFUSALS[code] };
  }
  return null;
}

export function interventionBodyRefusal(
  message: string | undefined,
): InterventionRefusal {
  return message && message in INTERVENTION_REFUSALS
    ? (message as InterventionRefusal)
    : "request_invalid";
}

// ── Lectures ─────────────────────────────────────────────────────────

export type SupportDay = {
  mission_day_id: string;
  mission_id: string;
  job_id?: string;
  job_title: string;
  starts_at: string;
  ends_at: string;
  date: string;
  state?: SupportDayState;
  requested?: boolean;
};

export type TargetedRemoval = {
  id: string;
  status: EngagementRequestStatus;
  reason: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  candidate_id: string;
  reexamination_of: string | null;
  days: { mission_day_id: string; starts_at: string }[];
};

export type SupportRequest = {
  id: string;
  status: EngagementRequestStatus;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  days: SupportDay[];
};

export type AdminEngagementRequest = {
  id: string;
  kind: EngagementRequestKind;
  status: EngagementRequestStatus;
  created_at: string;
  reason: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_by_role: string | null;
  job_id: string | null;
  reexamination_of: string | null;
  job_title: string | null;
  company_name: string | null;
  candidate_id: string;
  candidate_name: string | null;
  candidate_suspended: boolean;
  suspension: {
    id: string;
    cause: string;
    ends_at: string | null;
    active: boolean;
  } | null;
  days: SupportDay[];
};

export type AbsenceFinding = {
  id: string;
  incident_id: string;
  mission_id: string;
  mission_day_id: string;
  job_id: string;
  status: FindingStatus;
  opened_at: string;
  /** Origine des 72 h : création de la notification d'ouverture. */
  candidate_notified_at: string;
  candidate_due_at: string;
  /** Origine des 7 jours : création de la notification de la décision. */
  decision_notified_at: string | null;
  decisions: {
    kind: "decided" | "review_decided";
    outcome: string | null;
    at: string;
    notified_at: string | null;
    review_deadline: string | null;
  }[];
  my_elements: number;
  outcome: FindingOutcome | null;
  decided_at: string | null;
  review_deadline: string | null;
  review_requested_at: string | null;
  review_party: "candidate" | "company" | null;
  review_outcome: "maintained" | "overturned" | null;
  review_decided_at: string | null;
  day_starts_at: string;
  candidate_statement?: string | null;
  candidate_answered_at?: string | null;
  decision_note?: string | null;
  evidence?: { id: string; mime_type: string; created_at: string }[];
  // Administration seulement.
  revision?: number;
  proposed_outcome?: FindingOutcome | null;
  proposed_note?: string | null;
  proposed_by?: string | null;
  validated_by?: string | null;
  review_note?: string | null;
  review_decision_note?: string | null;
  realization?: { state: string; outcome: string | null };
  candidate_name?: string;
  job_title?: string;
  events?: {
    kind: string;
    actor_role: string | null;
    created_at: string;
    note: string | null;
    outcome: string | null;
    evidence_id: string | null;
  }[];
};

export type OpenableAbsence = {
  incident_id: string;
  mission_id: string;
  job_title: string;
  starts_at: string;
  created_at: string;
  realization: { state: string; outcome: string | null };
};

/** Journées encore décidables d'une demande (état « open »). */
export function openDayIds(days: readonly SupportDay[]): string[] {
  return days.filter((d) => d.state === "open").map((d) => d.mission_day_id);
}
