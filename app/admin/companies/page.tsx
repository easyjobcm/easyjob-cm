import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompaniesAdminClient } from "./companies-admin-client";

/**
 * T8.4a — Vue centralisée des entreprises (/admin/companies).
 *
 * Garde de rôle : `app/admin/layout.tsx` (lecture = 3 grades ; mutation
 * suspend/réactiver = admin_ops/admin_founder). Dérive `canModerate` et
 * délègue au client qui consomme `/api/admin/companies` (lecture
 * service_role : users & company_profiles n'ont pas de policy SELECT
 * admin — voir la route API).
 *
 * Sections (SRS §11.5 / §6.19) :
 *   - Suspendues : users.is_active = false
 *   - Validées   : company_profiles.verification_status = 'verified' ET actif
 *   - En attente : verification_status = 'pending' (les refus y retombent —
 *     pas de suppression de compte, ré-émition possible §6.14.4)
 *
 * Chaque carte : logo (initiales en l'absence d'URL signée), raison
 * sociale, contact (courriel / téléphone), ville, statut de
 * vérification + étoile (vérifiée). Bouton Suspendre/Réactiver.
 * (La page de détail entreprise /admin/companies/[id] sera livrée en
 * T8.4b avec le profil candidat — pas de lien mort pour l'instant.
 * Les boutons CNI/MoMo/Documents sont propres aux candidats.)
 */
export default async function AdminCompaniesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/admin/companies");
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

  return <CompaniesAdminClient canModerate={canModerate} />;
}
