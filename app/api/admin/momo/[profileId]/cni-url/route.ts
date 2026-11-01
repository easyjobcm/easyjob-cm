import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * T8.2 — URL signée à courte durée pour les photos CNI d'un candidat,
 * destinée à la révue admin Mobile Money (confrontation du nom déclaré
 * au nom du CNI).
 *
 * Le bucket `candidate-documents` est privé : l'admin échange le chemin
 * stocké contre une URL signée (60 s) via cette route, qui vérifie le
 * rôle admin (lecture seule autorisée — admin_support inclus) et
 * s'assure que le chemin appartient bien au candidat (préfixe userId/).
 */

const BUCKET = "candidate-documents";

const CNI_FIELDS = ["cni_front_url", "cni_back_url", "cni_selfie_url"] as const;
type CniField = (typeof CNI_FIELDS)[number];

function isAdminRole(role: string | null | undefined): boolean {
  return (
    role === "admin_support" || role === "admin_ops" || role === "admin_founder"
  );
}

function isCniField(value: unknown): value is CniField {
  return CNI_FIELDS.includes(value as CniField);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
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
  if (!isAdminRole(userData?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const field = request.nextUrl.searchParams.get("field");
  if (!field || !isCniField(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("user_id, cni_front_url, cni_back_url, cni_selfie_url")
    .eq("id", profileId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = profile[field];
  // Le chemin stocké est `<candidateUserId>/<field>-<uuid>.<ext>` :
  // on refuse d'ouvrir un objet qui n'appartient pas à ce candidat.
  if (!path || !path.startsWith(`${profile.user_id}/`)) {
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

  return NextResponse.json(
    { url: data.signedUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
