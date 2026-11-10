import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalErrorResponse } from "@/lib/api/errors";

const markReadSchema = z.object({
  id: z.string().uuid(),
});

/** Liste des notifications de l'utilisateur connecté (centre de notifications). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error: listError } = await supabase
    .from("notifications")
    .select("id, title, body, notification_type, is_read, created_at, data")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (listError) {
    return internalErrorResponse("notifications.list", listError, {
      code: "notifications_failed",
      request,
    });
  }

  return NextResponse.json({ notifications: data ?? [] });
}

/** Marque une notification comme lue (le candidat ne peut marquer que les siennes, RLS). */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (updateError) {
    return internalErrorResponse("notifications.mark_read", updateError, {
      code: "notifications_failed",
      request,
    });
  }

  return NextResponse.json({ ok: true });
}
