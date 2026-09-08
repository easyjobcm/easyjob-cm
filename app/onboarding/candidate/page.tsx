import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OnboardingClient } from "./onboarding-client";

export default async function CandidateOnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?redirect=/onboarding/candidate");
  }

  // Get user data
  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!userData || userData.role !== "candidate") {
    redirect("/");
  }

  // Get or create candidate profile
  let { data: profile } = await supabase
    .from("candidate_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // If profile doesn't exist, create it
  if (!profile) {
    const { data: newProfile } = await supabase
      .from("candidate_profiles")
      .insert({
        user_id: user.id,
        onboarding_status: "in_progress",
        onboarding_step: 1,
      })
      .select()
      .single();
    profile = newProfile;
  }

  // If onboarding is already completed, redirect to the Offres tab
  if (profile?.onboarding_status === "completed") {
    redirect("/jobs");
  }

  // Get job categories for skills selection
  const { data: categories } = await supabase
    .from("job_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  // T3.1 — categories de permis VERIFIÉES à l'instant T (permet d'activer /
  // désactiver les chips de conduite du step 3). L'état des compétences de
  // conduite est calculé côté client depuis cette liste (voir
  // lib/utils/license-requirements.ts — même modèle que le trigger SQL).
  const verifiedLicenseCategories: string[] = [];
  if (profile) {
    const { data: verifiedLicenses } = await supabase
      .from("candidate_documents")
      .select("license_category")
      .eq("candidate_id", profile.id)
      .eq("document_type", "permis_conduire")
      .eq("status", "verified");
    for (const doc of verifiedLicenses ?? []) {
      if (
        doc.license_category &&
        !verifiedLicenseCategories.includes(doc.license_category)
      ) {
        verifiedLicenseCategories.push(doc.license_category);
      }
    }
  }

  return (
    <OnboardingClient
      user={userData}
      profile={profile}
      categories={categories || []}
      verifiedLicenseCategories={verifiedLicenseCategories}
    />
  );
}
