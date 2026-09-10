import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SkillDocumentsAdminClient } from "./skill-documents-admin-client";

/**
 * Garde de rôle admin : assurée par `app/admin/layout.tsx`
 * (T8.1). Cette page ne fait plus que charger les données et
 * dériver `canModerate` (ops + founder uniquement).
 *
 * T8.4c — vue centralisée : la page ne liste QUE les documents
 * « En attente » (`status='pending'`) — le statut de chaque document
 * (validé / refusé + motif / expiré) s'affiche désormais sur la section
 * de l'utilisateur (`/admin/candidates/[id]`, T8.4b) et la carte de la
 * vue centralisée (T8.4a). Un document REJETÉ a son FICHIER storage
 * supprimé immédiatement (purge, voir
 * `app/api/admin/skill-documents/[id]/route.ts`) ; la LIGNE reste en
 * base (statut `rejected` + motif) car elle porte l'historique.
 *
 * `?userId=<uuid>` (depuis la carte T8.4a) : filtre sur ce candidat
 * uniquement. La table est clé sur `candidate_id` (= `candidate_profiles.id`),
 * donc on résout d'abord `user_id` → `candidate_id` avant de filtrer.
 */

type SkillDocsSearch = { userId?: string | string[] };

export default async function AdminSkillDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SkillDocsSearch>;
}) {
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

  const sp = await searchParams;
  const targetUserId =
    typeof sp.userId === "string" && sp.userId.length > 0 ? sp.userId : null;

  // T8.4c : si `?userId=` est donné, on résout d'abord le profil du
  // candidat (la table `candidate_documents` est clé sur `candidate_id`
  // = `candidate_profiles.id`, pas sur `user_id`).
  let targetCandidateId: string | null = null;
  if (targetUserId) {
    const { data: profile } = await supabase
      .from("candidate_profiles")
      .select("id")
      .eq("user_id", targetUserId)
      .maybeSingle();
    targetCandidateId = profile?.id ?? null;
  }

  let query = supabase
    .from("candidate_documents")
    .select(
      `id, document_type, title, issuing_organization, issued_at, expires_at,
       status, rejection_reason, verified_at, created_at,
       candidate:candidate_profiles!inner ( id, first_name, last_name ),
       candidate_skill_documents ( candidate_skill_id, candidate_skills ( skill_name ) )`,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  if (targetCandidateId) {
    query = query.eq("candidate_id", targetCandidateId);
  }

  const { data: documents } = await query;

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
      filterUserId={targetUserId}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
