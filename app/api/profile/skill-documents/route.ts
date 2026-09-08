import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  skillDocumentUploadSchema,
  type SkillDocumentType,
} from "@/lib/validations/skill-documents";

const BUCKET = "candidate-documents";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Détecte le vrai type MIME depuis les octets du fichier (magic bytes) —
 * jamais confiance dans l'extension ou le Content-Type déclaré par le client.
 */
function detectDocumentMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

async function getAuthorizedCandidate() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, candidateId: null };

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    return { supabase, user, candidateId: null };
  }

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  return { supabase, user, candidateId: profile?.id ?? null };
}

export async function GET() {
  const { supabase, user, candidateId } = await getAuthorizedCandidate();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!candidateId) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const [{ data: skills }, { data: documents }] = await Promise.all([
    supabase
      .from("candidate_skills")
      .select("id, skill_name, verification_status")
      .eq("candidate_id", candidateId)
      .order("skill_name", { ascending: true }),
    supabase
      .from("candidate_documents")
      .select(
        `id, document_type, title, issuing_organization, issued_at,
         expires_at, status, rejection_reason, verified_at, created_at,
         candidate_skill_documents ( candidate_skill_id )`,
      )
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
  ]);

  return NextResponse.json({
    skills: skills ?? [],
    documents: documents ?? [],
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user, candidateId } = await getAuthorizedCandidate();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!candidateId) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  let skillIds: string[] = [];
  try {
    const raw = formData.get("skill_ids");
    skillIds = typeof raw === "string" && raw ? JSON.parse(raw) : [];
  } catch {
    return NextResponse.json({ error: "Invalid skill_ids" }, { status: 400 });
  }

  const parsed = skillDocumentUploadSchema.safeParse({
    document_type: formData.get("document_type"),
    title: formData.get("title"),
    issuing_organization: formData.get("issuing_organization") ?? "",
    issued_at: formData.get("issued_at") ?? "",
    expires_at: formData.get("expires_at") ?? "",
    skill_ids: skillIds,
    confirm_accurate: formData.get("confirm_accurate") === "true",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Les compétences liées doivent appartenir au candidat authentifié.
  if (input.skill_ids.length > 0) {
    const { data: ownedSkills } = await supabase
      .from("candidate_skills")
      .select("id")
      .eq("candidate_id", candidateId)
      .in("id", input.skill_ids);

    if ((ownedSkills?.length ?? 0) !== input.skill_ids.length) {
      return NextResponse.json(
        { error: "One or more skills do not belong to your profile" },
        { status: 403 },
      );
    }
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = detectDocumentMime(buffer);
  if (!mime) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }

  const path = `${user.id}/skill-${randomUUID()}.${EXT_BY_MIME[mime]}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: document, error: insertError } = await supabase
    .from("candidate_documents")
    .insert({
      candidate_id: candidateId,
      document_type: input.document_type as SkillDocumentType,
      title: input.title,
      issuing_organization: input.issuing_organization || null,
      issued_at: input.issued_at || null,
      expires_at: input.expires_at || null,
      storage_path: path,
    })
    .select("id")
    .single();

  if (insertError || !document) {
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  if (input.skill_ids.length > 0) {
    const { error: linkError } = await supabase
      .from("candidate_skill_documents")
      .insert(
        input.skill_ids.map((skillId) => ({
          candidate_skill_id: skillId,
          candidate_document_id: document.id,
        })),
      );

    if (linkError) {
      await supabase.storage.from(BUCKET).remove([path]);
      await supabase.from("candidate_documents").delete().eq("id", document.id);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    const recomputeResults = await Promise.all(
      input.skill_ids.map((skillId) =>
        supabase.rpc("recompute_skill_verification_status", {
          p_skill_id: skillId,
        }),
      ),
    );
    // Échec du recalcul = statut dérivé incohérent : on annule l'upload
    // (document supprimé, liens cascade) puis on recalcule pour restaurer
    // l'état réel des compétences concernées.
    if (recomputeResults.some((r) => r.error)) {
      await supabase.storage.from(BUCKET).remove([path]);
      await supabase.from("candidate_documents").delete().eq("id", document.id);
      await Promise.all(
        input.skill_ids.map((skillId) =>
          supabase.rpc("recompute_skill_verification_status", {
            p_skill_id: skillId,
          }),
        ),
      );
      return NextResponse.json(
        { error: "Failed to link the document to your skills" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, id: document.id });
}
