import { z } from "zod";

/**
 * Lot 17d-4a (ANN-14) — confirmation d'intérêt pour un cycle de
 * remplacement : consentement explicite exigé côté client et côté serveur ;
 * la base revérifie tout (`confirm_replacement_interest`).
 */
export const replacementInterestSchema = z.object({
  consent: z.literal(true, { message: "consent_required" }),
});

export type ReplacementInterestInput = z.input<
  typeof replacementInterestSchema
>;

/** Codes de `confirm_replacement_interest` et statut HTTP. */
export const REPLACEMENT_REFUSALS = {
  not_authenticated: 401,
  consent_required: 400,
  profile_not_found: 404,
  replacement_not_found: 404,
  job_not_available: 409,
  job_closed: 409,
  replacement_closed: 409,
  replacement_cancelled: 409,
  no_positions: 409,
  interest_withdrawn: 409,
  replacement_own_withdrawal: 403,
  already_selected: 409,
  account_suspended: 403,
  onboarding_incomplete: 400,
  profile_incomplete: 400,
  cni_expired: 403,
  profile_not_verified: 403,
  document_requirement: 403,
  schedule_conflict: 409,
  job_days_missing: 409,
} as const;

export type ReplacementRefusal = keyof typeof REPLACEMENT_REFUSALS;

export function replacementRefusal(
  message: string | undefined,
): { code: ReplacementRefusal; status: number } | null {
  if (message && message in REPLACEMENT_REFUSALS) {
    const code = message as ReplacementRefusal;
    return { code, status: REPLACEMENT_REFUSALS[code] };
  }
  return null;
}

/** État d'un cycle calculé par la base (`replacement_cycle_state`). */
export const REPLACEMENT_STATES = [
  "open",
  "filled",
  "closed",
  "unavailable",
  "job_closed",
  "cancelled",
] as const;
export type ReplacementState = (typeof REPLACEMENT_STATES)[number];

export function replacementState(value: string | null): ReplacementState {
  return (REPLACEMENT_STATES as readonly string[]).includes(value ?? "")
    ? (value as ReplacementState)
    : "closed";
}
