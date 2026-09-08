import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import {
  checkEssentialCriteria,
  type EssentialKey,
} from "@/lib/utils/profile-completion";
import { JobDetailClient } from "./job-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch job with company and category
  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      `
      *,
      company:company_profiles(
        id, 
        company_name, 
        logo_url, 
        city, 
        sector,
        description
      ),
      category:job_categories(id, name_fr, name_en, icon)
    `,
    )
    .eq("id", id)
    .single();

  if (error || !job) {
    notFound();
  }

  // Check if user has applied
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let userApplication = null;
  let isFavorite = false;
  let missingEssentials: EssentialKey[] = [];

  if (user) {
    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select(
        `id, onboarding_status, profile_completion_pct,
         first_name, last_name, date_of_birth,
         cni_verified, cni_expires_at, momo_verified`,
      )
      .eq("user_id", user.id)
      .single();

    if (candidateProfile) {
      // Pré-calcul du gate pour désactiver le bouton et afficher directement
      // la liste des essentiels manquants (le serveur reste la source de vérité).
      if (
        candidateProfile.onboarding_status === "completed" &&
        (candidateProfile.profile_completion_pct ?? 0) >= 60
      ) {
        const essentials = checkEssentialCriteria(candidateProfile);
        if (!essentials.ok) {
          missingEssentials = essentials.missing;
        }
      }
      const { data: application } = await supabase
        .from("job_applications")
        .select("id, status, created_at")
        .eq("job_id", id)
        .eq("candidate_id", candidateProfile.id)
        .single();

      userApplication = application;

      const { data: favorite } = await supabase
        .from("job_favorites")
        .select("id")
        .eq("job_id", id)
        .eq("candidate_id", candidateProfile.id)
        .single();

      isFavorite = !!favorite;
    }
  }

  return (
    <JobDetailClient
      job={job}
      userApplication={userApplication}
      isFavorite={isFavorite}
      isLoggedIn={!!user}
      missingEssentials={missingEssentials}
    />
  );
}
