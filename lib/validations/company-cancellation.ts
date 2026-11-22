import { z } from "zod";

/**
 * Lot 17d-2 — annulation par l'entreprise après sélection (ANN-06 ;
 * ANN-08 en partie, à confirmer). Schémas partagés par l'écran et la route ;
 * la RPC `request_company_cancellation` revérifie tout en base (propriété,
 * compte actif, journées futures non commencées, dates entières,
 * conditions figées à la sélection, idempotence).
 */

/** Qualification ANN-06, sans conséquence : ni sanction, ni frais. */
export type CompanyDayClassification = "in_time" | "late" | "legacy";

/** Journée annulable, ou début prévu atteint (interruption, support). */
export type CompanyDayState = "cancellable" | "begun";

export const COMPANY_CANCELLATION_REASON_MIN = 10;
export const COMPANY_CANCELLATION_REASON_MAX = 500;

export const companyCancellationRequestSchema = z.object({
  // Une clé par confirmation : une relance réseau rejoue la même demande.
  request_id: z.string().uuid("request_invalid"),
  day_ids: z
    .array(z.string().uuid("days_invalid"))
    .min(1, "days_invalid")
    .max(1000, "days_invalid"),
  reason: z
    .string("cancellation_reason_required")
    .trim()
    .min(COMPANY_CANCELLATION_REASON_MIN, "cancellation_reason_required")
    .max(COMPANY_CANCELLATION_REASON_MAX, "cancellation_reason_too_long"),
  // L'entreprise a vu au moins une journée qualifiée de tardive.
  acknowledge_late: z.boolean("request_invalid"),
});
export type CompanyCancellationRequest = z.infer<
  typeof companyCancellationRequestSchema
>;

/** Refus des RPC (message de l'exception) → statut HTTP. */
export const COMPANY_CANCELLATION_REFUSALS = {
  not_authenticated: 401,
  not_a_company: 403,
  account_suspended: 403,
  company_not_found: 403,
  job_not_found: 404,
  request_invalid: 400,
  days_invalid: 400,
  cancellation_reason_required: 400,
  cancellation_reason_too_long: 400,
  request_conflict: 409,
  mission_not_active: 409,
  day_already_cancelled: 409,
  day_started: 409,
  day_already_begun: 409,
  cancellation_preview_stale: 409,
  late_not_acknowledged: 409,
} as const;
export type CompanyCancellationRefusal =
  keyof typeof COMPANY_CANCELLATION_REFUSALS;

export function companyCancellationRefusal(
  message: string | undefined,
): { code: CompanyCancellationRefusal; status: number } | null {
  if (message && message in COMPANY_CANCELLATION_REFUSALS) {
    const code = message as CompanyCancellationRefusal;
    return { code, status: COMPANY_CANCELLATION_REFUSALS[code] };
  }
  return null;
}

/** Premier code d'un corps refusé par Zod, sinon `request_invalid`. */
export function companyCancellationBodyRefusal(
  message: string | undefined,
): CompanyCancellationRefusal {
  return message && message in COMPANY_CANCELLATION_REFUSALS
    ? (message as CompanyCancellationRefusal)
    : "request_invalid";
}

// ── Lectures ─────────────────────────────────────────────────────────

export type CompanyCancellationPreviewDay = {
  mission_day_id: string;
  mission_id: string;
  application_id: string;
  job_id: string;
  day_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  first_name: string | null;
  last_initial: string | null;
  state: CompanyDayState;
  classification: CompanyDayClassification;
  company_plan: "free" | "premium" | null;
  cancellation_notice_hours: number | null;
  deadline_at: string | null;
};

export type CompanyCancellationEvent = {
  id: string;
  created_at: string;
  reason: string;
  day_count: number;
  date_count: number;
  candidate_count: number;
  in_time_count: number;
  late_count: number;
  legacy_count: number;
  dates: string[];
};

/** Une date de l'offre et les journées (une par candidat) qu'elle porte. */
export type CompanyCancellationDate = {
  key: string;
  job_id: string;
  day_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  state: CompanyDayState;
  days: CompanyCancellationPreviewDay[];
};

/**
 * Regroupe l'aperçu par date de l'offre (sous-offre comprise) : la demande
 * porte sur des dates entières, tous les candidats encore engagés ce
 * jour-là (aucun retrait ciblé, ANN-08). Une date dont le début est atteint
 * pour l'un d'eux n'est pas sélectionnable.
 */
export function groupPreviewByDate(
  days: readonly CompanyCancellationPreviewDay[],
): CompanyCancellationDate[] {
  const map = new Map<string, CompanyCancellationDate>();
  for (const d of days) {
    const key = `${d.job_id}:${d.day_date}`;
    const cur = map.get(key);
    if (cur) {
      cur.days.push(d);
      if (d.state === "begun") cur.state = "begun";
    } else {
      map.set(key, {
        key,
        job_id: d.job_id,
        day_date: d.day_date,
        start_time: d.start_time,
        end_time: d.end_time,
        starts_at: d.starts_at,
        state: d.state,
        days: [d],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}

/** Journées d'une demande portant sur les dates choisies (annulables). */
export function dayIdsForDates(
  dates: readonly CompanyCancellationDate[],
  keys: ReadonlySet<string>,
): string[] {
  return dates
    .filter((d) => keys.has(d.key) && d.state === "cancellable")
    .flatMap((d) => d.days.map((x) => x.mission_day_id));
}
