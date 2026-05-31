export interface CandidateProfileForCompletion {
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  city?: string | null;
  profile_photo_url?: string | null;
  bio?: string | null;
  max_travel_distance_km?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  cni_front_url?: string | null;
  cni_back_url?: string | null;
  cni_selfie_url?: string | null;
  momo_verified?: boolean | null;
  profile_completion_pct?: number;
  sandbox_level?: number;
  average_rating?: number;
  completed_missions?: number | null;
}

export interface CompanyProfileForCompletion {
  company_name?: string;
  sector?: string | null;
  description?: string | null;
  logo_url?: string | null;
  city?: string | null;
  address?: string | null;
  rccm?: string | null;
  niu?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
}

export interface Criterion {
  key: string;
  weight: number;
  done: boolean;
}

export function computeCandidateCriteria(
  profile: CandidateProfileForCompletion,
  skillCount: number,
): Criterion[] {
  return [
    {
      key: "identity",
      weight: 20,
      done: !!(
        profile.first_name &&
        profile.last_name &&
        profile.date_of_birth &&
        profile.city
      ),
    },
    {
      key: "photo",
      weight: 15,
      done: !!profile.profile_photo_url,
    },
    {
      key: "skills",
      weight: 15,
      done: skillCount > 0,
    },
    {
      key: "bio",
      weight: 10,
      done: !!(profile.bio && profile.bio.trim().length > 10),
    },
    {
      key: "availability",
      weight: 10,
      done: typeof profile.max_travel_distance_km === "number",
    },
    {
      key: "location",
      weight: 10,
      done: !!(profile.latitude && profile.longitude),
    },
    {
      key: "cni",
      weight: 15,
      done: !!(
        profile.cni_front_url &&
        profile.cni_back_url &&
        profile.cni_selfie_url
      ),
    },
    {
      key: "momo",
      weight: 5,
      done: !!profile.momo_verified,
    },
  ];
}

export function computeCompanyCriteria(
  profile: CompanyProfileForCompletion,
): Criterion[] {
  return [
    {
      key: "sector",
      weight: 20,
      done: !!profile.sector,
    },
    {
      key: "description",
      weight: 20,
      done: !!(profile.description && profile.description.trim().length > 20),
    },
    {
      key: "logo",
      weight: 15,
      done: !!profile.logo_url,
    },
    {
      key: "address",
      weight: 15,
      done: !!(profile.city && profile.address),
    },
    {
      key: "legal",
      weight: 15,
      done: !!(profile.rccm || profile.niu),
    },
    {
      key: "contact",
      weight: 15,
      done: !!(profile.contact_name && profile.contact_phone),
    },
  ];
}

export function computeCompletion(criteria: Criterion[]): number {
  return criteria.filter((c) => c.done).reduce((sum, c) => sum + c.weight, 0);
}

export interface SandboxLevelConfig {
  level: number;
  icon: string;
  color: string;
  bgColor: string;
  nameKey: "level0" | "level1" | "level2" | "level3";
  requirementKey:
    | "req_registered"
    | "req_m1_r35"
    | "req_m3_r4_p80"
    | "req_m10_r45_verified";
}

export const SANDBOX_LEVELS: SandboxLevelConfig[] = [
  {
    level: 0,
    icon: "🌱",
    color: "#9CA3AF",
    bgColor: "#F3F4F6",
    nameKey: "level0",
    requirementKey: "req_registered",
  },
  {
    level: 1,
    icon: "⭐",
    color: "#3B82F6",
    bgColor: "#EFF6FF",
    nameKey: "level1",
    requirementKey: "req_m1_r35",
  },
  {
    level: 2,
    icon: "🔥",
    color: "#7C3AED",
    bgColor: "#F3E8FF",
    nameKey: "level2",
    requirementKey: "req_m3_r4_p80",
  },
  {
    level: 3,
    icon: "🏆",
    color: "#D97706",
    bgColor: "#FFFBEB",
    nameKey: "level3",
    requirementKey: "req_m10_r45_verified",
  },
];
