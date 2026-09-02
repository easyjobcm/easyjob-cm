import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const BUCKET = "candidate-documents";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const DOCUMENT_FIELDS = [
  "profile_photo_url",
  "cni_front_url",
  "cni_back_url",
  "cni_selfie_url",
] as const;
type DocumentField = (typeof DOCUMENT_FIELDS)[number];

function isDocumentField(value: unknown): value is DocumentField {
  return (
    typeof value === "string" &&
    (DOCUMENT_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Détecte le vrai type MIME depuis les octets du fichier (magic bytes),
 * pour ne jamais se fier uniquement à l'extension ou au Content-Type déclaré.
 */
function detectImageMime(bytes: Uint8Array): string | null {
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
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function getAuthorizedCandidate() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, candidateId: null };

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
    .select(
      "id, profile_photo_url, cni_front_url, cni_back_url, cni_selfie_url",
    )
    .eq("user_id", user.id)
    .single();

  return { supabase, user, candidateId: profile?.id ?? null, profile };
}

export async function POST(request: NextRequest) {
  const { supabase, user, candidateId, profile } =
    await getAuthorizedCandidate();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!candidateId || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const field = formData.get("field");
  const file = formData.get("file");

  if (!isDocumentField(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }

  const previousPath = (profile as Record<string, string | null>)[field];
  const path = `${user.id}/${field}-${randomUUID()}.${EXT_BY_MIME[mime]}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const isCniField = field !== "profile_photo_url";
  const { error: updateError } = await supabase
    .from("candidate_profiles")
    .update({
      [field]: path,
      ...(isCniField
        ? { cni_verified: "pending", cni_rejection_reason: null }
        : {}),
    })
    .eq("id", candidateId);

  if (updateError) {
    // Nettoyage du fichier orphelin si l'écriture DB échoue.
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  if (previousPath && previousPath !== path) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  return NextResponse.json({ ok: true, field });
}

export async function GET(request: NextRequest) {
  const { supabase, user, candidateId, profile } =
    await getAuthorizedCandidate();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!candidateId || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const field = request.nextUrl.searchParams.get("field");
  if (!isDocumentField(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const path = (profile as Record<string, string | null>)[field];
  if (!path || !path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not generate URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: data.signedUrl });
}
