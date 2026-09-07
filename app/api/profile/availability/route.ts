import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { availabilitySchema } from "@/lib/validations/profile";

async function getAuthorizedCandidateId(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    return null;
  }

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  return profile?.id ?? null;
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const candidateId = await getAuthorizedCandidateId(supabase);

  if (!candidateId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = availabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Journées en doublon interdites (contrainte unique candidate_id+day_of_week+start_time
  // de toute façon, mais on refuse deux plages sur le même jour ici pour rester simple).
  const days = new Set(parsed.data.days.map((d) => d.day_of_week));
  if (days.size !== parsed.data.days.length) {
    return NextResponse.json({ error: "Duplicate day" }, { status: 400 });
  }

  const { error: distanceError } = await supabase
    .from("candidate_profiles")
    .update({ max_travel_distance_km: parsed.data.max_travel_distance_km })
    .eq("id", candidateId);

  if (distanceError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("candidate_availability")
    .delete()
    .eq("candidate_id", candidateId);

  if (deleteError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  if (parsed.data.days.length > 0) {
    const { error: insertError } = await supabase
      .from("candidate_availability")
      .insert(
        parsed.data.days.map((d) => ({
          candidate_id: candidateId,
          day_of_week: d.day_of_week,
          start_time: d.start_time,
          end_time: d.end_time,
          is_available: true,
        })),
      );

    if (insertError) {
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
