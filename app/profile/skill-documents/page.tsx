import { redirect } from "next/navigation";

/**
 * Absorbée par /profile/skills (T3) : compétences + justificatifs + section
 * CV/permis sur une page unique. L'ancien chemin reste accessible (menu,
 * profils externes, deep links) via ce redirect serveur (307).
 */
export default function SkillDocumentsRedirectPage() {
  redirect("/profile/skills");
}
