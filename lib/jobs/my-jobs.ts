/**
 * Classement des candidatures de « Mes jobs » (lot 9).
 *
 * L'onglet Candidatures montre les candidatures en cours. Les candidatures
 * retirées, refusées ou marquées absentes restent visibles dans
 * l'historique : après un retrait, l'écran dit « aucune candidature en
 * cours », pas « vous n'avez jamais postulé ». Une candidature sélectionnée
 * apparaît sous forme de mission (onglet Réservées).
 */

export const ACTIVE_APPLICATION_STATUSES = ["pending", "shortlisted"] as const;
export const PAST_APPLICATION_STATUSES = [
  "withdrawn",
  "rejected",
  "no_show",
] as const;

export type ApplicationsEmptyState = "never" | "noActive" | null;

export function splitApplications<T extends { status: string | null }>(
  applications: readonly T[],
): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const a of applications) {
    if (
      (ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(
        a.status ?? "",
      )
    ) {
      active.push(a);
    } else if (
      (PAST_APPLICATION_STATUSES as readonly string[]).includes(a.status ?? "")
    ) {
      past.push(a);
    }
  }
  return { active, past };
}

/** Message vide de l'onglet Candidatures, ou `null` s'il y a des candidatures en cours. */
export function applicationsEmptyState(
  applications: readonly { status: string | null }[],
): ApplicationsEmptyState {
  if (applications.length === 0) return "never";
  return splitApplications(applications).active.length > 0 ? null : "noActive";
}

/** État d'affichage après une lecture : données, dernier état connu, ou erreur seule. */
export function loadState(
  hasData: boolean,
  error: unknown,
): "ok" | "stale" | "error" {
  if (!error) return "ok";
  return hasData ? "stale" : "error";
}
