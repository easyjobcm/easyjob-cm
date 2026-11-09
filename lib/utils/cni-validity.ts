import { z } from "zod";

/**
 * État de la CNI d'un candidat (lot 9d). Miroir de la fonction SQL
 * `candidate_cni_state` (migration 20261110120000), seule source de vérité
 * pour la candidature : ce module ne sert qu'à l'affichage.
 *
 * Convention d'échéance (inchangée depuis apply_to_job et
 * `reputation_document_valid`) : `cni_expires_at` est une date SQL ; la CNI
 * est expirée quand `date::timestamp at time zone 'UTC' < now()`, soit
 * valide jusqu'à 00:00:00 UTC du jour d'échéance inclus et expirée juste
 * après (comme `new Date("YYYY-MM-DD") < new Date()`). Sans date, elle est
 * valide.
 */
export const CNI_STATES = [
  "valid",
  "expired",
  "renewal_pending",
  "renewal_rejected",
  "pending",
  "rejected",
  "missing",
] as const;

export type CniState = (typeof CNI_STATES)[number];

/** États renvoyés par `apply_to_job` avec le code `cni_expired`. */
export const CNI_EXPIRED_STATES = [
  "expired",
  "renewal_pending",
  "renewal_rejected",
] as const;

export type CniExpiredState = (typeof CNI_EXPIRED_STATES)[number];

export const cniExpiredDetailSchema = z.object({
  state: z.enum(CNI_EXPIRED_STATES),
});

export interface CniProfileFields {
  cni_verified: string | null;
  cni_expires_at: string | null;
  cni_front_url?: string | null;
  cni_back_url?: string | null;
  cni_selfie_url?: string | null;
  /** Motif d'un refus admin (affiché pour un renouvellement refusé). */
  cni_rejection_reason?: string | null;
}

/** Instant (ms) à partir duquel la CNI est expirée, ou null sans date. */
export function cniExpiryInstant(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(`${expiresAt.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/** Vrai si la date d'échéance est passée à l'instant `now` (ms). */
export function cniDateExpired(expiresAt: string | null, now: number): boolean {
  const at = cniExpiryInstant(expiresAt);
  return at !== null && at < now;
}

export function cniState(p: CniProfileFields, now: number): CniState {
  const expired = cniDateExpired(p.cni_expires_at, now);
  if (p.cni_verified === "verified" && !expired) return "valid";
  if (expired) {
    if (p.cni_verified === "verified") return "expired";
    if (p.cni_verified === "rejected") return "renewal_rejected";
    return "renewal_pending";
  }
  if (p.cni_verified === "rejected") return "rejected";
  if (!p.cni_front_url || !p.cni_back_url || !p.cni_selfie_url) {
    return "missing";
  }
  return "pending";
}

export function isCniExpiredState(state: CniState): state is CniExpiredState {
  return (CNI_EXPIRED_STATES as readonly string[]).includes(state);
}

/** Date d'échéance (jour civil, sans décalage de fuseau). */
export function formatCniDate(expiresAt: string, locale: string): string {
  const at = cniExpiryInstant(expiresAt);
  if (at === null) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(at));
}
