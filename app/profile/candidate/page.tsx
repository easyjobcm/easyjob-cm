import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  computeCandidateCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
import { CandidateProfileClient } from "./candidate-profile-client";

export default async function CandidateProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?redirect=/profile/candidate");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role, phone, email")
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
    .select(
      `id, first_name, last_name, date_of_birth, average_rating, city, quartier,
       address, latitude, longitude, max_travel_distance_km,
       profile_photo_url, bio,
       cni_front_url, cni_back_url, cni_selfie_url, momo_verified,
       total_missions, completed_missions, sandbox_level,
       profile_completion_pct, premium_until`,
    )
    .eq("user_id", user.id)
    .single();

  const { data: candidateSkills } = candidateProfile
    ? await supabase
        .from("candidate_skills")
        .select("id, skill_name")
        .eq("candidate_id", candidateProfile.id)
    : { data: [] };

  const skills = candidateSkills ?? [];
  const sandboxLevel = candidateProfile?.sandbox_level ?? 0;
  const criteria = computeCandidateCriteria(
    candidateProfile ?? {},
    skills.length,
  );

  const completionPct =
    typeof candidateProfile?.profile_completion_pct === "number" &&
    candidateProfile.profile_completion_pct > 0
      ? candidateProfile.profile_completion_pct
      : computeCompletion(criteria);

  return (
    <CandidateProfileClient
      user={{
        role: userData.role,
        phone: userData.phone ?? null,
        email: userData.email ?? null,
      }}
      profile={
        candidateProfile
          ? {
              first_name: candidateProfile.first_name,
              last_name: candidateProfile.last_name,
              average_rating: candidateProfile.average_rating,
              city: candidateProfile.city,
              quartier: candidateProfile.quartier,
              premium_until: candidateProfile.premium_until ?? null,
            }
          : null
      }
      skills={skills}
      completionPct={completionPct}
      sandboxLevel={sandboxLevel}
      criteria={criteria}
      totalMissions={candidateProfile?.total_missions ?? 0}
    />
  );
}
