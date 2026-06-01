import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProfileClient } from "./profile-client";
import {
  computeCandidateCriteria,
  computeCompanyCriteria,
  computeCompletion,
  type Criterion,
} from "@/lib/utils/profile-completion";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login?redirect=/profile");
  }

  // Get user data
  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!userData) {
    redirect("/auth/login");
  }

  // Get profile based on role
  let profile = null;
  let skills: Array<{ id: string; skill_name: string }> = [];
  let completionPct = 0;
  let sandboxLevel = 0;
  let criteria: Criterion[] = [];
  let totalMissions = 0;

  if (userData.role === "candidate" || userData.role === "candidate_premium") {
    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    profile = candidateProfile;

    if (candidateProfile) {
      const { data: candidateSkills } = await supabase
        .from("candidate_skills")
        .select("*")
        .eq("candidate_id", candidateProfile.id);

      skills = candidateSkills || [];
      sandboxLevel = candidateProfile.sandbox_level ?? 0;
      criteria = computeCandidateCriteria(candidateProfile, skills.length);

      if (
        typeof candidateProfile.profile_completion_pct === "number" &&
        candidateProfile.profile_completion_pct > 0
      ) {
        completionPct = candidateProfile.profile_completion_pct;
      } else {
        completionPct = computeCompletion(criteria);
      }
      totalMissions = candidateProfile.total_missions ?? 0;
    }
  } else if (
    userData.role === "company" ||
    userData.role === "company_premium"
  ) {
    const { data: companyProfile } = await supabase
      .from("company_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    profile = companyProfile;

    if (companyProfile) {
      criteria = computeCompanyCriteria(companyProfile);
      completionPct = computeCompletion(criteria);
      totalMissions = companyProfile.total_missions_posted ?? 0;
    }
  }

  return (
    <ProfileClient
      user={userData}
      profile={profile}
      skills={skills}
      completionPct={completionPct}
      sandboxLevel={sandboxLevel}
      criteria={criteria}
      totalMissions={totalMissions}
    />
  );
}
