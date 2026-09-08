import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { skillDocumentModerateSchema } from "@/lib/validations/skill-documents";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  // Validation/refus réservé à admin_ops et admin_founder (US-ADMIN-05) —
  // admin_support garde un accès lecture seule, jamais de mutation ici.
  if (
    !userData?.role ||
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = skillDocumentModerateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { action, rejection_reason } = parsed.data;

  const { data: document } = await supabase
    .from("candidate_documents")
    .select(
      `id, status, expires_at, candidate_id,
       candidate_profiles!inner ( user_id ),
       candidate_skill_documents ( candidate_skill_id )`,
    )
    .eq("id", id)
    .single();

  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const previousStatus = document.status;
  const newStatus = action === "approve" ? "verified" : "rejected";

  // La policy RLS "candidate_documents_update_ops_admin" est le vrai garde-fou :
  // un candidat ne peut jamais atteindre ce chemin avec un compte non-admin.
  const { error: updateError } = await supabase
    .from("candidate_documents")
    .update({
      status: newStatus,
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      rejection_reason: action === "reject" ? rejection_reason : null,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update document" },
      { status: 500 },
    );
  }

  const linkedSkillIds = (document.candidate_skill_documents ?? []).map(
    (l) => l.candidate_skill_id,
  );
  const recomputeResults = await Promise.all(
    linkedSkillIds.map((skillId) =>
      supabase.rpc("recompute_skill_verification_status", {
        p_skill_id: skillId,
      }),
    ),
  );
  // Échec du recalcul = statut dérivé incohérent avec le document :
  // on stoppe avant audit/notification pour que l'action ne paraîsse pas
  // conclue sans mise à jour du statut.
  if (recomputeResults.some((r) => r.error)) {
    return NextResponse.json(
      { error: "Failed to update skill verification status" },
      { status: 500 },
    );
  }

  // Le suivi d'expiration ne démarre qu'une fois le document réellement vérifié.
  if (action === "approve" && document.expires_at) {
    await supabase.from("document_expirations").insert({
      candidate_id: document.candidate_id,
      document_type: "skill_document",
      candidate_document_id: document.id,
      expires_at: document.expires_at,
    });
  }

  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    actor_role: userData.role,
    action:
      action === "approve" ? "approve_skill_document" : "reject_skill_document",
    resource_type: "candidate_documents",
    resource_id: id,
    metadata: { before: previousStatus, after: newStatus, rejection_reason },
  });

  const candidateUserId = document.candidate_profiles as unknown as
    | { user_id: string }
    | { user_id: string }[];
  const targetUserId = Array.isArray(candidateUserId)
    ? candidateUserId[0]?.user_id
    : candidateUserId?.user_id;

  if (targetUserId) {
    await supabase.from("notifications").insert({
      user_id: targetUserId,
      notification_type: "document_status",
      title:
        action === "approve" ? "Justificatif validé" : "Justificatif refusé",
      body:
        action === "approve"
          ? "Votre justificatif a été validé. La ou les compétences associées sont désormais vérifiées."
          : `Votre justificatif a été refusé. Motif : ${rejection_reason}`,
      data: { candidate_document_id: id },
    });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
