"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./bottom-nav";

// Chemins des 4 onglets candidat. La barre reste montée tant que l'on
// navigue entre eux (aucun remount → indicateur actif animé, pas de flash).
// Les sous-pages de `/profile` (édition, disponibilité, paiement, sécurité,
// notifications...) gardent la barre avec l'onglet Profil actif, ainsi que
// `/help` et `/terms` qui ne sont accessibles que depuis le menu Profil.
// `/profile/company` garde son propre layout (aucune barre candidat dessus).
const CANDIDATE_TAB_PREFIXES = ["/jobs", "/tasks", "/my-jobs", "/profile"];
const CANDIDATE_TAB_EXACT_PATHS = new Set(["/help", "/terms"]);
const EXCLUDED_PREFIXES = ["/profile/company"];

function isCandidateTabPath(pathname: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  if (CANDIDATE_TAB_EXACT_PATHS.has(pathname)) return true;
  return CANDIDATE_TAB_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Barre de navigation basse persistante, rendue au niveau du layout racine.
 * Ne s'affiche que sur les 4 onglets candidat et leurs sous-pages : la
 * navigation entre eux ne démonte plus la barre, ce qui supprime l'effet
 * « changement d'application ».
 */
export function CandidateTabBar() {
  const pathname = usePathname();

  if (!pathname || !isCandidateTabPath(pathname)) {
    return null;
  }

  return <BottomNav />;
}
