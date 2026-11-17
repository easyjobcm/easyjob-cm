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
