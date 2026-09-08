import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SkillDocumentsClient } from "./skill-documents-client";

export default async function SkillDocumentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/skill-documents");
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

  const [{ data: skills }, { data: documents }] = candidateProfile
    ? await Promise.all([
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
             candidate_skill_documents ( candidate_skill_id )`,
          )
          .eq("candidate_id", candidateProfile.id)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <SkillDocumentsClient
      initialSkills={skills ?? []}
      initialDocuments={documents ?? []}
    />
  );
}
