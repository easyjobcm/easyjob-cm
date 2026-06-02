import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ModerateSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const parsed = ModerateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const { action } = parsed.data;

    const supabase = await createClient();

    // Verify admin role
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

    if (
      !userData?.role ||
      !["admin_ops", "admin_founder"].includes(userData.role)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update job status
    const newStatus = action === "approve" ? "active" : "rejected";

    const { error } = await supabase
      .from("jobs")
      .update({
        status: newStatus,
        moderated_at: new Date().toISOString(),
        moderated_by: user.id,
      })
      .eq("id", id);

    if (error) {
      console.error("Moderation error:", error);
      return NextResponse.json(
        { error: "Failed to moderate job" },
        { status: 500 },
      );
    }

    // TODO: Send notification to company

    return NextResponse.json({
      success: true,
      status: newStatus,
    });
  } catch (error) {
    console.error("Moderation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
