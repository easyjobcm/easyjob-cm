import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CandidateProfileEditClient } from "./edit-client";

export default async function CandidateProfileEditPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/candidate/edit");
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
    .select(
      "id, first_name, last_name, city, quartier, bio, latitude, longitude, profile_photo_url, cni_front_url, cni_back_url, cni_selfie_url, cni_verified, cni_rejection_reason, cni_expires_at",
    )
    .eq("user_id", user.id)
    .single();

  const { data: candidateSkills } = candidateProfile
    ? await supabase
        .from("candidate_skills")
        .select("id, skill_name")
        .eq("candidate_id", candidateProfile.id)
    : { data: [] };

  return (
    <CandidateProfileEditClient
      userId={user.id}
      profile={
        candidateProfile ?? {
          id: null,
          first_name: "",
          last_name: "",
          city: "",
          quartier: "",
          bio: "",
          latitude: null,
          longitude: null,
          profile_photo_url: null,
          cni_front_url: null,
          cni_back_url: null,
          cni_selfie_url: null,
          cni_verified: null,
          cni_rejection_reason: null,
          cni_expires_at: null,
        }
      }
      initialSkills={(candidateSkills ?? []).map((s) => s.skill_name)}
    />
  );
}
