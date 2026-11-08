import { createClient } from "@/lib/supabase/server";
import { haversineKm } from "@/lib/validations/geo-schema";

interface MatchingCriteria {
  candidateId: string;
  jobId: string;
}

interface MatchResult {
  score: number;
  breakdown: {
    skills: number;
    rating: number;
    completion: number;
    availability: number;
    location: number;
    premium: number;
  };
  reasons: string[];
}

// (Le Haversine est centralisé dans `lib/validations/geo-schema.ts` —
//  source unique, partagée avec la validation de zone T5.1.)

export async function calculateMatchScore(
  criteria: MatchingCriteria,
): Promise<MatchResult> {
  const supabase = await createClient();

  // Get candidate profile with skills
  const { data: candidate } = await supabase
    .from("candidate_profiles")
    .select(
      `
      *,
      skills:candidate_skills(skill_name, skill_level),
      availability:candidate_availability(day_of_week, start_time, end_time, is_available)
    `,
    )
    .eq("id", criteria.candidateId)
    .single();

  // Get job details
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", criteria.jobId)
    .single();

  if (!candidate || !job) {
    return {
      score: 0,
      breakdown: {
        skills: 0,
        rating: 0,
        completion: 0,
        availability: 0,
        location: 0,
        premium: 0,
      },
      reasons: ["Candidat ou offre non trouve"],
    };
  }

  const breakdown = {
    skills: 0,
    rating: 0,
    completion: 0,
    availability: 0,
    location: 0,
    premium: 0,
  };
  const reasons: string[] = [];

  // 1. Skills Match (30% weight)
  if (
    job.required_skills &&
    job.required_skills.length > 0 &&
    candidate.skills
  ) {
    const candidateSkillNames = candidate.skills.map(
      (s: { skill_name: string }) => s.skill_name.toLowerCase(),
    );
    const matchedSkills = job.required_skills.filter((skill: string) =>
      candidateSkillNames.includes(skill.toLowerCase()),
    );
    breakdown.skills =
      (matchedSkills.length / job.required_skills.length) * 100;

    if (breakdown.skills >= 80) {
      reasons.push("Excellente correspondance des competences");
    } else if (breakdown.skills >= 50) {
      reasons.push("Bonne correspondance des competences");
    }
  } else {
    breakdown.skills = 70; // Default if no skills required
  }

  // 6. Location proximity (10% — SRS §6.5)
  if (
    candidate.latitude &&
    candidate.longitude &&
    job.latitude &&
    job.longitude
  ) {
    const distance = haversineKm(
      { lat: candidate.latitude, lng: candidate.longitude },
      { lat: job.latitude, lng: job.longitude },
    );
    const maxDistance = candidate.max_travel_distance_km || 10;

    if (distance <= maxDistance) {
      breakdown.location = 100;
      reasons.push(`A ${distance.toFixed(1)} km du lieu de travail`);
    } else if (distance <= maxDistance * 1.5) {
      breakdown.location = 70;
      reasons.push(`A ${distance.toFixed(1)} km (un peu loin)`);
    } else if (distance <= maxDistance * 2) {
      breakdown.location = 40;
    } else {
      breakdown.location = 20;
    }
  } else if (candidate.city?.toLowerCase() === job.city?.toLowerCase()) {
    breakdown.location = 80;
    reasons.push("Meme ville");
  } else {
    breakdown.location = 30;
  }

  // 7. Premium status (5% — SRS §6.5)
  const isPremium =
    candidate.premium_until && new Date(candidate.premium_until) > new Date();
  breakdown.premium = isPremium ? 100 : 0;
  if (isPremium) reasons.push("Candidat premium");

  // 5. Availability Match (10% — SRS §6.5)
  if (
    job.start_date &&
    candidate.availability &&
    candidate.availability.length > 0
  ) {
    const jobDate = new Date(job.start_date);
    const dayOfWeek = jobDate.getDay();

    const availableForDay = candidate.availability.find(
      (a) => a.day_of_week === dayOfWeek && a.is_available !== false,
    );

    if (availableForDay) {
      // Check time overlap
      const jobStart = job.start_time?.slice(0, 5);
      const jobEnd = job.end_time?.slice(0, 5);
      const availStart = availableForDay.start_time?.slice(0, 5);
      const availEnd = availableForDay.end_time?.slice(0, 5);

      if (jobStart >= availStart && jobEnd <= availEnd) {
        breakdown.availability = 100;
        reasons.push("Disponible aux horaires demandes");
      } else {
        breakdown.availability = 60;
      }
    } else {
      breakdown.availability = 30;
    }
  } else {
    breakdown.availability = 50; // Default
  }

  // 3. Average rating (15% — SRS §6.5)
  const avgRating: number = candidate.average_rating ?? 0;
  if (avgRating >= 4.5) {
    breakdown.rating = 100;
    reasons.push("Note excellente (≥4.5★)");
  } else if (avgRating >= 4) {
    breakdown.rating = 80;
    reasons.push("Bonne note (≥4★)");
  } else if (avgRating >= 3.5) {
    breakdown.rating = 60;
  } else if (avgRating > 0) {
    breakdown.rating = 40;
  } else {
    breakdown.rating = 50; // nouveau candidat sans note
  }

  // 4. Profile completion (10% — SRS §6.5)
  const completion: number = candidate.profile_completion_pct ?? 0;
  breakdown.completion = completion;
  if (completion >= 90) reasons.push("Profil très complet");
  else if (completion >= 60) reasons.push("Profil complet");

  // Pondérations SRS §6.5 sans le niveau Sandbox (20 %, retiré au lot 9b) :
  // 30/15/10/10/10/5, ramenées sur 100 en gardant leurs proportions. La
  // note n'est ni un seuil ni un critère de tri à part.
  const score = Math.round(
    (breakdown.skills * 0.3 +
      breakdown.rating * 0.15 +
      breakdown.completion * 0.1 +
      breakdown.availability * 0.1 +
      breakdown.location * 0.1 +
      breakdown.premium * 0.05) /
      0.8,
  );

  return {
    score,
    breakdown,
    reasons,
  };
}

// Batch calculate scores for all candidates matching a job
export async function findMatchingCandidates(
  jobId: string,
  limit: number = 50,
): Promise<Array<{ candidateId: string; score: number; reasons: string[] }>> {
  const supabase = await createClient();

  // Get job details
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (!job) return [];

  // Candidats ayant terminé leur inscription (aucun critère de niveau).
  const { data: candidates } = await supabase
    .from("candidate_profiles")
    .select("id, city")
    .eq("onboarding_status", "completed")
    .limit(100);

  if (!candidates || candidates.length === 0) return [];

  // Calculate scores for all candidates
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const match = await calculateMatchScore({
        candidateId: candidate.id,
        jobId,
      });
      return {
        candidateId: candidate.id,
        score: match.score,
        reasons: match.reasons,
      };
    }),
  );

  // Sort by score and return top matches
  return results
    .filter((r) => r.score >= 30) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
