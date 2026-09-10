import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CandidateProfileAdminClient } from "./candidate-profile-admin-client";

/**
 * T8.4b — Profil candidat complet (/admin/candidates/[id]).
 *
 * Garde de rôle : `app/admin/layout.tsx` (lecture = 3 grades admin).
 * Cette page dérive `canEdit` (admin_founder UNIQUEMENT) — l'édition de
 * l'identité (prénom / nom / date de naissance) est réservée au fondateur
 * (décision produit). Le client consomme `/api/admin/candidates/[id]`
 * (lecture service_role : users / missions / jobs / company_profiles n'ont
 * pas de policy SELECT admin) et expose, pour canEdit, un formulaire
 * d'édition identité qui passe par le RPC `admin_edit_candidate_identity`
 * (sur un CNI vérifié → remise `cni_verified='pending'` + recompute,
 * SRS §6.12).
 *
 * Les statuts documents (CNI / MoMo / compétences / documents) s'affichent
 * ici : l'état de chaque justificatif vit désormais dans cette vue
 * centralisée (les pages de revue ne garderont que « En attente », T8.4c).
 */
export default async function AdminCandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  // Édition réservée à admin_founder (plus strict que le gate ops/founder
  // des autres mutations T8) — la route RPC le re-vérifie en profondeur.
  const canEdit = userData.role === "admin_founder";

  return <CandidateProfileAdminClient id={id} canEdit={canEdit} />;
}
