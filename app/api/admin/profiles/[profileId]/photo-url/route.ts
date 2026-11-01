import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * T8.4a — URL signée à courte durée pour la photo de profil d'un
 * candidat, destinée à la vue centralisée /admin/candidates.
 *
 * Même pattern que `cni-url` (T8.2) : bucket `candidate-documents`
 * privé, rôle admin (les 3 grades — lecture seule), préfixe
 * `<candidateUserId>/` vérifié, URL signée 60 s, jamais de chemin
 * brut renvoyé au client.
 */

const BUCKET = "candidate-documents";

function isAdminRole(role: string | null | undefined): boolean {
  return (
    role === "admin_support" || role === "admin_ops" || role === "admin_founder"
  );
}

export async function GET(
  _request: NextRequest,
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

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("user_id, profile_photo_url")
    .eq("id", profileId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = profile.profile_photo_url;
  // Le chemin stocké est `<candidateUserId>/profile_photo_url-<uuid>.<ext>`
  // : on refuse d'ouvrir un objet qui n'appartient pas à ce candidat.
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
