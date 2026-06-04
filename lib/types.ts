import type { Enums, Tables } from "@/lib/database.types";

// Plans entreprise (SRS v1.2) — constantes et types
export {
  COMPANY_PLAN_FEES,
  CANCELLATION_PENALTY_RULES,
  PAYMENT_DELAY_RULES,
  type CompanyPlan,
} from "./types/index";

// User types (sourced from generated DB schema)
export type UserRole = Enums<"user_role">;
export type Locale = Enums<"locale_type">;
export type User = Tables<"users">;

// Auth types
export interface OTPCode {
  id: string;
  phone: string;
  code: string;
  expires_at: string;
  attempts: number;
  verified: boolean;
  created_at: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

// Form types
export interface SignUpFormData {
  phone: string;
  role: "candidate" | "company";
  locale: Locale;
}

export interface OTPVerifyFormData {
  phone: string;
  code: string;
}

// Profile types (sourced from generated DB schema)
export type CandidateProfile = Tables<"candidate_profiles">;

export type CompanyProfile = Tables<"company_profiles">;

// Navigation types
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}
