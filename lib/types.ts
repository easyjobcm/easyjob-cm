// User types
export type UserRole = 'candidate' | 'company' | 'admin_support' | 'admin_ops' | 'admin_founder'
export type Locale = 'fr' | 'en'

export interface User {
  id: string
  email: string | null
  phone: string | null
  phone_verified: boolean
  role: UserRole
  locale: Locale
  is_active: boolean
  is_verified: boolean
  ban_reason: string | null
  ban_expires_at: string | null
  no_show_count: number
  created_at: string
  updated_at: string
}

// Auth types
export interface OTPCode {
  id: string
  phone: string
  code: string
  expires_at: string
  attempts: number
  verified: boolean
  created_at: string
}

// API Response types
export interface ApiResponse<T> {
  data: T | null
  error: string | null
  success: boolean
}

// Form types
export interface SignUpFormData {
  phone: string
  role: 'candidate' | 'company'
  locale: Locale
}

export interface OTPVerifyFormData {
  phone: string
  code: string
}

// Candidate profile (will be extended in Sprint 2)
export interface CandidateProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  birth_date: string | null
  gender: 'male' | 'female' | 'other' | null
  avatar_url: string | null
  bio: string | null
  // Location
  city: string | null
  neighborhood: string | null
  latitude: number | null
  longitude: number | null
  // Status
  is_onboarded: boolean
  sandbox_mode: boolean
  reliability_score: number
  created_at: string
  updated_at: string
}

// Company profile (will be extended in Sprint 2)
export interface CompanyProfile {
  id: string
  user_id: string
  company_name: string
  niu: string | null // Tax ID
  logo_url: string | null
  description: string | null
  // Location
  city: string | null
  address: string | null
  // Status
  is_verified: boolean
  is_premium: boolean
  subscription_tier: 'free' | 'basic' | 'premium' | 'enterprise'
  created_at: string
  updated_at: string
}

// Navigation types
export interface NavItem {
  label: string
  href: string
  icon: string
  badge?: number
}
