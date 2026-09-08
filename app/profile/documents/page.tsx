import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DocumentsPageClient } from "./documents-client";

/**
 * Page « Mes documents » (T4, SRS §6.14.3) : liste unique et exhaustive de
 * tous les justificatifs `candidate_documents` du candidat (CV, permis,
 * diplôme, attestations…), avec statut effectif (détection « expiré » au
 * vol), compétences liées, et consultation **Voir / Télécharger** (URL
 * signée de courte durée — SRS §6.14 : URLs signées, jamais de lien public).
 *
 * Lecture-only côté candidat : l'ajout de justificatif se fait depuis
 * « Mes compétences » (/profile/skills) ; le remplacement est géré côté
 * admin (T8) — la décision « l'ancien n'est supprimé que si le nouveau est
 * validé par l'admin » y est implémentée.
 */
export default async function DocumentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/documents");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    redirect("/profile");
  }

  const { data: candidateProfile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!candidateProfile) {
    redirect("/onboarding/candidate");
  }

  const { data: documents } = await supabase
    .from("candidate_documents")
    .select(
      `id, document_type, title, issuing_organization, issued_at,
       expires_at, status, rejection_reason, verified_at, created_at,
       storage_path, license_category,
       candidate_skill_documents ( candidate_skills ( skill_name ) )`,
    )
    .eq("candidate_id", candidateProfile.id)
    .order("created_at", { ascending: false });

  return <DocumentsPageClient initialDocuments={documents ?? []} />;
}
