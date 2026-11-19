/**
 * Classement des candidatures de « Mes jobs » (lot 9).
 *
 * L'onglet Candidatures montre les candidatures en cours. Les candidatures
 * retirées, refusées ou marquées absentes restent visibles dans
 * l'historique : après un retrait, l'écran dit « aucune candidature en
 * cours », pas « vous n'avez jamais postulé ». Une candidature sélectionnée
 * apparaît sous forme de mission (onglet Réservées).
 *
 * Lot 17d-1 : une candidature sur une offre clôturée par l'entreprise est
 * figée et passe dans l'historique, quel que soit son statut (jamais « en
 * cours »).
 */

export const ACTIVE_APPLICATION_STATUSES = ["pending", "shortlisted"] as const;
export const PAST_APPLICATION_STATUSES = [
  "withdrawn",
  "rejected",
  "no_show",
] as const;

export type ApplicationsEmptyState = "never" | "noActive" | null;

type ClassifiedApplication = {
  status: string | null;
  job?: { closed_at?: string | null } | null;
};

export function splitApplications<T extends ClassifiedApplication>(
  applications: readonly T[],
): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const a of applications) {
    if (a.job?.closed_at) {
      past.push(a);
    } else if (
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
  applications: readonly ClassifiedApplication[],
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
