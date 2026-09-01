"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./bottom-nav";

// Chemins exacts des 4 onglets candidat. La barre reste montée tant que l'on
// navigue entre eux (aucun remount → indicateur actif animé, pas de flash).
// `/profile` est inclus pour couvrir le court instant de redirection
// `/profile` → `/profile/candidate`.
const CANDIDATE_TAB_PATHS = new Set([
  "/jobs",
  "/tasks",
  "/my-jobs",
  "/profile",
  "/profile/candidate",
]);

/**
 * Barre de navigation basse persistante, rendue au niveau du layout racine.
 * Ne s'affiche que sur les 4 onglets candidat : la navigation entre eux ne
 * démonte plus la barre, ce qui supprime l'effet « changement d'application ».
 */
export function CandidateTabBar() {
  const pathname = usePathname();

  if (!pathname || !CANDIDATE_TAB_PATHS.has(pathname)) {
    return null;
  }

  return <BottomNav />;
}
