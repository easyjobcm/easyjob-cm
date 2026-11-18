import { requireAdminPage } from "@/lib/auth/admin-page";
import { CandidateProfileAdminClient } from "./candidate-profile-admin-client";

/**
 * T8.4b — Profil candidat complet (/admin/candidates/[id]).
 *
 * Garde de rôle : `requireAdminPage` (trois grades, compte actif), en plus
 * du layout.
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
  // Garde commune (lot 17a) : session, grade admin et compte actif relus en
  // base à chaque rendu, comme is_admin_user() ; un admin suspendu, même
  // avec un jeton émis avant la suspension, est renvoyé à l'accueil.
  const { role } = await requireAdminPage(`/admin/candidates/${id}`);

  // Édition réservée à admin_founder (plus strict que le gate ops/founder
  // des autres mutations T8) — la route RPC le re-vérifie en profondeur.
  const canEdit = role === "admin_founder";

  // T8.5 — Mises à jour de profil : demande/annulation/purge réservées à
  // admin_ops + admin_founder (admin_support = lecture seule des 3 grades).
  // Lot 17a : même règle pour Premium (revérifiée par la RPC).
  const canModerate = role === "admin_ops" || role === "admin_founder";

  return (
    <CandidateProfileAdminClient
      id={id}
      canEdit={canEdit}
      canModerate={canModerate}
    />
  );
}
