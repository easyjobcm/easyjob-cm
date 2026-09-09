import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SkillDocumentsAdminClient } from "./skill-documents-admin-client";

/**
 * Garde de rôle admin : assurée par `app/admin/layout.tsx`
 * (T8.1). Cette page ne fait plus que charger les données et
 * dériver `canModerate` (ops + founder uniquement).
 */
export default async function AdminSkillDocumentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Le layout admin garde déjà le rôle ; ce filet protège un accès
  // direct (SSR) sans session valide.
  if (!user) {
    redirect("/");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const { data: documents } = await supabase
    .from("candidate_documents")
    .select(
      `id, document_type, title, issuing_organization, issued_at, expires_at,
       status, rejection_reason, verified_at, created_at,
       candidate:candidate_profiles!inner ( id, first_name, last_name ),
       candidate_skill_documents ( candidate_skill_id, candidate_skills ( skill_name ) )`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const normalized = (documents ?? []).map((doc) => {
    const candidate = Array.isArray(doc.candidate)
      ? doc.candidate[0]
      : doc.candidate;
    return {
      ...doc,
      candidate: candidate
        ? {
            first_name: candidate.first_name,
            last_name: candidate.last_name,
          }
        : null,
      candidate_skill_documents: (doc.candidate_skill_documents ?? []).map(
        (link) => {
          const skill = Array.isArray(link.candidate_skills)
            ? link.candidate_skills[0]
            : link.candidate_skills;
          return { skill_name: skill?.skill_name ?? "" };
        },
      ),
    };
  });

  return (
    <SkillDocumentsAdminClient
      initialDocuments={normalized}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
