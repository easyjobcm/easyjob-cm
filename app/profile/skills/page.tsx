import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SkillsPageClient } from "./skills-client";

/**
 * Page « Mes compétences » (T3) : compétences + justificatifs (absorbe
 * /profile/skill-documents, conservé en redirect) + section CV/permis au
 * dessus de la liste. Le chargement est identique à la page T0 :
 * candidate_skills (avec statut de vérification) et candidate_documents
 * (avec liens vers les skills).
 */
export default async function SkillsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/skills");
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

  const [{ data: skills }, { data: documents }] = await Promise.all([
    supabase
      .from("candidate_skills")
      .select("id, skill_name, verification_status")
      .eq("candidate_id", candidateProfile.id)
      .order("skill_name", { ascending: true }),
    supabase
      .from("candidate_documents")
      .select(
        `id, document_type, title, issuing_organization, issued_at,
         expires_at, status, rejection_reason, verified_at, created_at,
         license_category,
         candidate_skill_documents ( candidate_skill_id )`,
      )
      .eq("candidate_id", candidateProfile.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <SkillsPageClient
      candidateId={candidateProfile.id}
      initialSkills={skills ?? []}
      initialDocuments={documents ?? []}
    />
  );
}
