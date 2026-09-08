import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const BUCKET = "candidate-documents";

export async function GET(
  _request: Request,
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

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { data: document } = await supabase
    .from("candidate_documents")
    .select("storage_path")
    .eq("id", id)
    .eq("candidate_id", profile.id)
    .single();

  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(document.storage_path, 60);

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
