import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CandidatesAdminClient } from "./candidates-admin-client";

/**
 * T8.4a — Vue centralisée des candidats (/admin/candidates).
 *
 * Garde de rôle : `app/admin/layout.tsx` (lecture = 3 grades admin ;
 * mutation suspend/réactiver = admin_ops/admin_founder). Cette page ne
 * dérive que `canModerate` (ops + founder) et délègue au client, qui
 * consomme `/api/admin/candidates` (lecture service_role : users n'a pas
 * de policy SELECT admin — voir la route API) avec recherche libre +
 * sections En attente / Validés / Suspendus.
 *
 * Chaque carte utilisateur affiche : photo de profil (URL signée via
 * /api/admin/profiles/[id]/photo-url), nom complet, e-mail, Mobile Money,
 * statut CNI / MoMo + étoile (is_verified). Boutons : Voir le profil
 * (/admin/candidates/[id], édition réservée à admin_founder), CNI, MoMo,
 * Documents (→ leurs pages de revue), Suspendre/Réactiver.
 *
 * Sections (SRS §6.14.4 / §6.19) : les candidats REJETÉS ne sont pas
 * supprimés du compte (ré-émission possible) — leurs justificatifs
 * rejetés sont purgés (T8.4c) et ils restent en « En attente » jusqu'à
 * ré-émission validée. « Suspendus » = users.is_active = false.
 */
export default async function AdminCandidatesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/admin/candidates");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData?.role ||
    !["admin_support", "admin_ops", "admin_founder"].includes(userData.role)
  ) {
    redirect("/");
  }

  const canModerate = ["admin_ops", "admin_founder"].includes(userData.role);

  return <CandidatesAdminClient canModerate={canModerate} />;
}
