import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const BUCKET = "candidate-documents";

async function getCandidateId(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  return profile?.id ?? null;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const candidateId = await getCandidateId(supabase);
  if (!candidateId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: document } = await supabase
    .from("candidate_documents")
    .select(
      "id, storage_path, candidate_skill_documents ( candidate_skill_id )",
    )
    .eq("id", id)
    .eq("candidate_id", candidateId)
    .single();

  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const linkedSkillIds = (document.candidate_skill_documents ?? []).map(
    (l) => l.candidate_skill_id,
  );

  // La policy RLS refuse la suppression si le document est déjà "verified"
  // (rétention d'audit) — l'erreur remonte simplement comme "aucune ligne affectée".
  const { error, count } = await supabase
    .from("candidate_documents")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error || !count) {
    return NextResponse.json(
      { error: "Cannot delete a verified document" },
      { status: 403 },
    );
  }

  await supabase.storage.from(BUCKET).remove([document.storage_path]);

  const recomputeResults = await Promise.all(
    linkedSkillIds.map((skillId) =>
      supabase.rpc("recompute_skill_verification_status", {
        p_skill_id: skillId,
      }),
    ),
  );
  // Le document est déjà supprimé, mais si le recalcul échoue le statut de
  // la compétence reste incohérent : on propage l'erreur pour que le client
  // le signale et réessaie à la prochaine action.
  if (recomputeResults.some((r) => r.error)) {
    return NextResponse.json(
      { error: "Skill verification status could not be refreshed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
