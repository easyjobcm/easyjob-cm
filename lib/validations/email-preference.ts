import { z } from "zod";

/**
 * Lot 17d-4b (ANN-21, `[UV]` 2026-11-26) — alertes de remplacement par
 * e-mail : activation explicite (texte accepté versionné), désactivation
 * libre. La base revérifie le rôle, la version et l'adresse confirmée
 * (`set_replacement_email_alerts`).
 */
export const REPLACEMENT_EMAIL_CONSENT_VERSION = "replacement-email-v1";

export const replacementEmailPreferenceSchema = z.discriminatedUnion(
  "enabled",
  [
    z.object({
      enabled: z.literal(true),
      consentVersion: z.literal(REPLACEMENT_EMAIL_CONSENT_VERSION, {
        message: "consent_required",
      }),
    }),
    z.object({ enabled: z.literal(false) }),
  ],
);
export type ReplacementEmailPreferenceInput = z.input<
  typeof replacementEmailPreferenceSchema
>;

/** Codes de la base et statut HTTP. */
export const EMAIL_PREFERENCE_REFUSALS = {
  not_authenticated: 401,
  not_a_candidate: 403,
  invalid_preference: 400,
  consent_required: 400,
  email_missing: 409,
} as const;
export type EmailPreferenceRefusal = keyof typeof EMAIL_PREFERENCE_REFUSALS;

export function emailPreferenceRefusal(
  message: string | undefined,
): { code: EmailPreferenceRefusal; status: number } | null {
  if (message && message in EMAIL_PREFERENCE_REFUSALS) {
    const code = message as EmailPreferenceRefusal;
    return { code, status: EMAIL_PREFERENCE_REFUSALS[code] };
  }
  return null;
}
