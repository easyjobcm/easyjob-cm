import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { UpgradeCandidateClient } from "./upgrade-candidate-client";

export default async function UpgradeCandidatePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/upgrade/candidate");
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
    .select("average_rating, premium_until")
    .eq("user_id", user.id)
    .single();

  return (
    <UpgradeCandidateClient
      role={userData.role}
      averageRating={candidateProfile?.average_rating ?? 0}
      premiumUntil={candidateProfile?.premium_until ?? null}
    />
  );
}
