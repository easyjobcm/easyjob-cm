import { z } from "zod";
import { Constants } from "@/lib/database.types";

/** Date du jour à Douala (YYYY-MM-DD), comme `create_job` côté base. */
export function doualaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Borne de `jobs.mission_pay_per_candidate` (type integer). */
export const MISSION_PAY_MAX = 2_147_483_647;

/**
 * Montant fixe en XAF versé à CHAQUE candidat sélectionné pour la mission
 * (forfait, indépendant de la durée et du nombre de places). Entier
 * strictement positif : mêmes règles que `public.job_apply_content`.
 */
export const missionPaySchema = z
  .number({ error: "missionPayRequired" })
  .int("missionPayInteger")
  .positive("missionPayInvalid")
  .max(MISSION_PAY_MAX, "missionPayTooHigh");

/**
 * Contenu d'une offre écrit par l'entreprise (création et modification).
 * Mêmes champs et mêmes règles que `public.job_apply_content` : les RPC
 * `create_job` et `update_job` les réappliquent pour un appel direct.
 * Propriétaire, statut, modération et compteurs n'en font pas partie.
 * Les messages sont des clés de `companyJobs.errors`.
 */
const jobFields = z.object({
  title: z.string().trim().min(1, "titleRequired").max(120, "titleTooLong"),
  description: z
    .string()
    .trim()
    .min(1, "descriptionRequired")
    .max(5000, "descriptionTooLong"),
  address: z
    .string()
    .trim()
    .min(1, "addressRequired")
    .max(200, "addressTooLong"),
  city: z.string().trim().min(1, "cityRequired").max(100, "cityRequired"),
  start_date: isoDate.refine((d) => d >= doualaToday(), "startDatePast"),
  start_time: time,
  end_time: time,
  mission_pay_per_candidate: missionPaySchema,
  category_id: z.string().uuid().optional(),
  job_type: z.enum(Constants.public.Enums.job_type).optional().default("shift"),
  quartier: optionalText(100),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  end_date: isoDate.optional(),
  is_recurring: z.boolean().optional().default(false),
  recurring_days: z.array(z.number().int()).optional(),
  estimated_hours: z.number().optional(),
  required_skills: z.array(z.string().trim().min(1)).optional(),
  min_experience_months: z.number().int().min(0).optional().default(0),
  dress_code: optionalText(500),
  special_instructions: optionalText(2000),
  positions_available: z
    .number()
    .int()
    .positive("positionsInvalid")
    .optional()
    .default(1),
  urgency: z.enum(["normal", "urgent"]).optional().default("normal"),
});

const END_AFTER_START = {
  path: ["end_date"],
  message: "endDateBeforeStart",
};
const endAfterStart = (d: { start_date: string; end_date?: string }) =>
  !d.end_date || d.end_date >= d.start_date;

/** Création : début à partir d'aujourd'hui (heure de Douala). */
export const jobInputSchema = jobFields.refine(endAfterStart, END_AFTER_START);

/**
 * Modification (lot 11b) : après la première publication, dates et
 * horaires sont figés et renvoyés tels quels, même passés ; la base
 * (`update_job`) vérifie qu'ils n'ont pas changé, et revérifie la date
 * d'une offre jamais publiée.
 */
export const jobUpdateSchema = jobFields
  .extend({ start_date: isoDate })
  .refine(endAfterStart, END_AFTER_START);

export type JobInput = z.input<typeof jobInputSchema>;
export type JobInputData = z.output<typeof jobInputSchema>;

/**
 * Codes renvoyés par les RPC `create_job`, `update_job`, `moderate_job`,
 * `delete_job`, `select_candidate` et `company_job_applicants` (message de
 * l'exception), traduits dans `companyJobs.errors`, `companyApplicants.errors`
 * et `admin.moderation.errors`.
 */
export const JOB_RPC_REFUSALS = {
  not_authenticated: 401,
  not_a_company: 403,
  account_suspended: 403,
  company_not_found: 403,
  company_not_verified: 403,
  invalid_job_data: 400,
  job_not_found: 404,
  job_locked_plan: 403,
  job_has_selected_candidates: 409,
  job_not_editable: 409,
  job_has_commitments: 409,
  forbidden: 403,
  invalid_action: 400,
  reason_required: 400,
  reason_too_long: 400,
  job_not_pending: 409,
  job_changed: 409,
  company_not_eligible: 409,
  // Lot 11b : début non publiable (moins de 4 h, exactement H−24, passé) ;
  // échéance de recrutement atteinte (H−24, ou H−2 en publication urgente).
  job_start_too_close: 409,
  // Lot 11b : dates et horaires figés après la première publication.
  job_schedule_locked: 409,
  recruitment_closed: 409,
  application_not_found: 404,
  application_not_selectable: 409,
  job_not_available: 409,
  no_positions: 409,
  candidate_unavailable: 409,
  selection_incomplete: 409,
} as const;

export type JobRpcRefusal = keyof typeof JOB_RPC_REFUSALS;

export function jobRefusal(
  message: string | undefined,
): { code: JobRpcRefusal; status: number } | null {
  if (message && message in JOB_RPC_REFUSALS) {
    const code = message as JobRpcRefusal;
    return { code, status: JOB_RPC_REFUSALS[code] };
  }
  return null;
}

/** Motif de modération (refus obligatoire), mêmes bornes que `moderate_job`. */
export const jobModerationSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500, "reason_too_long").optional(),
    seen_updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .refine((d) => d.action !== "reject" || (d.reason?.length ?? 0) >= 3, {
    path: ["reason"],
    message: "reason_required",
  });
