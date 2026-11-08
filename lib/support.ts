/**
 * Contact du support EasyJob CM : seul canal disponible pour ce qui n'a pas
 * encore de parcours dans l'application (activation d'un abonnement,
 * signalement), lot 9.
 */
export const SUPPORT_EMAIL = "support@easyjob.cm";

/** Lien `mailto:` vers le support, avec un objet facultatif. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

export const SUPPORT_MAILTO = supportMailto();
