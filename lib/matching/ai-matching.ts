import { createClient } from "@/lib/supabase/server";

interface MatchingCriteria {
  candidateId: string;
  jobId: string;
}

interface MatchResult {
  score: number;
  breakdown: {
    skills: number;
    location: number;
    availability: number;
    experience: number;
    reliability: number;
  };
  reasons: string[];
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
      availability:candidate_availability(day_of_week, start_time, end_time)
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
        location: 0,
        availability: 0,
        experience: 0,
        reliability: 0,
      },
      reasons: ["Candidat ou offre non trouve"],
    };
  }

  const breakdown = {
    skills: 0,
    location: 0,
    availability: 0,
    experience: 0,
    reliability: 0,
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

  // 2. Location Match (25% weight)
  if (
    candidate.latitude &&
    candidate.longitude &&
    job.latitude &&
    job.longitude
  ) {
    const distance = calculateDistance(
      candidate.latitude,
      candidate.longitude,
      job.latitude,
      job.longitude,
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

  // 3. Availability Match (20% weight)
  if (
    job.start_date &&
    candidate.availability &&
    candidate.availability.length > 0
  ) {
    const jobDate = new Date(job.start_date);
    const dayOfWeek = jobDate.getDay();

    const availableForDay = candidate.availability.find(
      (a: { day_of_week: number; is_available: boolean }) =>
        a.day_of_week === dayOfWeek && a.is_available !== false,
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

  // 4. Experience Match (15% weight)
  if (candidate.completed_missions > 0) {
    if (candidate.completed_missions >= 20) {
      breakdown.experience = 100;
      reasons.push("Candidat tres experimente");
    } else if (candidate.completed_missions >= 10) {
      breakdown.experience = 80;
      reasons.push("Candidat experimente");
    } else if (candidate.completed_missions >= 5) {
      breakdown.experience = 60;
    } else {
      breakdown.experience = 40;
    }
  } else {
    breakdown.experience = 30; // New candidate
    if (candidate.is_sandbox) {
      reasons.push("Nouveau candidat (mode sandbox)");
    }
  }

  // 5. Reliability Score (10% weight)
  if (candidate.reliability_score) {
    breakdown.reliability = candidate.reliability_score * 100;

    if (candidate.reliability_score >= 0.9) {
      reasons.push("Excellent score de fiabilite");
    } else if (candidate.reliability_score >= 0.7) {
      reasons.push("Bon score de fiabilite");
    }
  } else {
    breakdown.reliability = 50; // Default for new candidates
  }

  // Calculate weighted total score
  const score = Math.round(
    breakdown.skills * 0.3 +
      breakdown.location * 0.25 +
      breakdown.availability * 0.2 +
      breakdown.experience * 0.15 +
      breakdown.reliability * 0.1,
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

  // Get candidates in the same city or nearby
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

// Update candidate's reliability score after mission
export async function updateReliabilityScore(
  candidateId: string,
): Promise<void> {
  const supabase = await createClient();

  // Get candidate's mission history
  const { data: candidate } = await supabase
    .from("candidate_profiles")
    .select("total_missions, completed_missions, no_show_count")
    .eq("id", candidateId)
    .single();

  if (!candidate) return;

  // Calculate new reliability score
  let reliabilityScore = 0.5; // Default for new candidates

  if (candidate.total_missions > 0) {
    const completionRate =
      candidate.completed_missions / candidate.total_missions;
    const noShowPenalty = (candidate.no_show_count || 0) * 0.1;

    reliabilityScore = Math.max(0, Math.min(1, completionRate - noShowPenalty));
  }

  // Update candidate profile
  await supabase
    .from("candidate_profiles")
    .update({ reliability_score: reliabilityScore })
    .eq("id", candidateId);
}
