import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Compteur de notifications non lues — session obligatoire, RLS respectée. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { count, error: countError } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (countError) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
