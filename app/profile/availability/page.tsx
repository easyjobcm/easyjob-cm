import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AvailabilityClient } from "./availability-client";

export default async function AvailabilityPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/availability");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    redirect("/profile");
  }

  const { data: candidateProfile } = await supabase
    .from("candidate_profiles")
    .select("id, max_travel_distance_km")
    .eq("user_id", user.id)
    .single();

  const { data: availability } = candidateProfile
    ? await supabase
        .from("candidate_availability")
        .select("day_of_week, start_time, end_time")
        .eq("candidate_id", candidateProfile.id)
        .order("day_of_week", { ascending: true })
    : { data: [] };

  return (
    <AvailabilityClient
      maxTravelDistanceKm={candidateProfile?.max_travel_distance_km ?? 10}
      initialDays={(availability ?? []).map((a) => ({
        day_of_week: a.day_of_week,
        start_time: a.start_time.slice(0, 5),
        end_time: a.end_time.slice(0, 5),
      }))}
    />
  );
}
