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
