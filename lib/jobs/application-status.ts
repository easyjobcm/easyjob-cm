import type { Database } from "@/lib/database.types";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

/**
 * Statut affiché d'une candidature (lot 13).
 *
 * La présélection est retirée : aucune écriture ne produit plus
 * « shortlisted ». Une ancienne candidature présélectionnée garde ce statut
 * en base (historique), s'affiche et se traite comme une candidature en
 * attente (sélection, refus, retrait).
 */
export function displayApplicationStatus<
  S extends ApplicationStatus | string | null | undefined,
>(status: S): Exclude<S, "shortlisted"> | "pending" {
  return status === "shortlisted"
    ? "pending"
    : (status as Exclude<S, "shortlisted">);
}
