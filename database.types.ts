export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string
          updated_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_availability: {
        Row: {
          candidate_id: string
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean | null
          start_time: string
        }
        Insert: {
          candidate_id: string
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_available?: boolean | null
          start_time: string
        }
        Update: {
          candidate_id?: string
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_availability_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profiles: {
        Row: {
          address: string | null
          average_rating: number
          bio: string | null
          city: string | null
          cni_back_url: string | null
          cni_expires_at: string | null
          cni_front_url: string | null
          cni_number: string | null
          cni_rejection_reason: string | null
          cni_selfie_url: string | null
          cni_verified:
            | Database["public"]["Enums"]["verification_status"]
            | null
          completed_missions: number | null
          created_at: string | null
          date_of_birth: string | null
          driving_license_expires_at: string | null
          driving_license_verified: boolean
          first_name: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_sandbox: boolean | null
          last_name: string | null
          latitude: number | null
          longitude: number | null
          max_travel_distance_km: number | null
          momo_name_match: boolean
          momo_number: string | null
          momo_provider: string | null
          momo_verified: boolean | null
          no_show_count: number | null
          onboarding_status:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step: number | null
          premium_until: string | null
          profile_completion_pct: number
          profile_photo_url: string | null
          quartier: string | null
          reliability_score: number | null
          sandbox_level: number
          sandbox_missions_completed: number | null
          total_missions: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          average_rating?: number
          bio?: string | null
          city?: string | null
          cni_back_url?: string | null
          cni_expires_at?: string | null
          cni_front_url?: string | null
          cni_number?: string | null
          cni_rejection_reason?: string | null
          cni_selfie_url?: string | null
          cni_verified?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          completed_missions?: number | null
          created_at?: string | null
          date_of_birth?: string | null
          driving_license_expires_at?: string | null
          driving_license_verified?: boolean
          first_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_sandbox?: boolean | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_distance_km?: number | null
          momo_name_match?: boolean
          momo_number?: string | null
          momo_provider?: string | null
          momo_verified?: boolean | null
          no_show_count?: number | null
          onboarding_status?:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step?: number | null
          premium_until?: string | null
          profile_completion_pct?: number
          profile_photo_url?: string | null
          quartier?: string | null
          reliability_score?: number | null
          sandbox_level?: number
          sandbox_missions_completed?: number | null
          total_missions?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          average_rating?: number
          bio?: string | null
          city?: string | null
          cni_back_url?: string | null
          cni_expires_at?: string | null
          cni_front_url?: string | null
          cni_number?: string | null
          cni_rejection_reason?: string | null
          cni_selfie_url?: string | null
          cni_verified?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          completed_missions?: number | null
          created_at?: string | null
          date_of_birth?: string | null
          driving_license_expires_at?: string | null
          driving_license_verified?: boolean
          first_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_sandbox?: boolean | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_distance_km?: number | null
          momo_name_match?: boolean
          momo_number?: string | null
          momo_provider?: string | null
          momo_verified?: boolean | null
          no_show_count?: number | null
          onboarding_status?:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step?: number | null
          premium_until?: string | null
          profile_completion_pct?: number
          profile_photo_url?: string | null
          quartier?: string | null
          reliability_score?: number | null
          sandbox_level?: number
          sandbox_missions_completed?: number | null
          total_missions?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_skills: {
        Row: {
          candidate_id: string
          created_at: string | null
          id: string
          is_ai_suggested: boolean | null
          skill_level: number | null
          skill_name: string
        }
        Insert: {
          candidate_id: string
          created_at?: string | null
          id?: string
          is_ai_suggested?: boolean | null
          skill_level?: number | null
          skill_name: string
        }
        Update: {
          candidate_id?: string
          created_at?: string | null
          id?: string
          is_ai_suggested?: boolean | null
          skill_level?: number | null
          skill_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_skills_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          address: string | null
          city: string | null
          company_name: string
          company_size: Database["public"]["Enums"]["company_size"] | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          description: string | null
          documents_url: string[] | null
          id: string
          is_active: boolean | null
          latitude: number | null
          legal_name: string | null
          logo_url: string | null
          longitude: number | null
          niu: string | null
          onboarding_status:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step: number | null
          quartier: string | null
          rccm: string | null
          sector: string | null
          subscription_expires_at: string | null
          subscription_tier: string | null
          updated_at: string | null
          user_id: string
          verification_rejection_reason: string | null
          verification_status:
            | Database["public"]["Enums"]["verification_status"]
            | null
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name: string
          company_size?: Database["public"]["Enums"]["company_size"] | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          documents_url?: string[] | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          niu?: string | null
          onboarding_status?:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step?: number | null
          quartier?: string | null
          rccm?: string | null
          sector?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
          user_id: string
          verification_rejection_reason?: string | null
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string
          company_size?: Database["public"]["Enums"]["company_size"] | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          documents_url?: string[] | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          niu?: string | null
          onboarding_status?:
            | Database["public"]["Enums"]["onboarding_status"]
            | null
          onboarding_step?: number | null
          quartier?: string | null
          rccm?: string | null
          sector?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
          user_id?: string
          verification_rejection_reason?: string | null
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          application_id: string
          candidate_id: string
          candidate_ip: string | null
          candidate_signature_url: string | null
          candidate_signed_at: string | null
          company_id: string
          company_ip: string | null
          company_signature_url: string | null
          company_signed_at: string | null
          contract_data: Json | null
          contract_template: string
          created_at: string | null
          expires_at: string | null
          final_contract_url: string | null
          id: string
          job_id: string
          status: Database["public"]["Enums"]["contract_status"] | null
          updated_at: string | null
        }
        Insert: {
          application_id: string
          candidate_id: string
          candidate_ip?: string | null
          candidate_signature_url?: string | null
          candidate_signed_at?: string | null
          company_id: string
          company_ip?: string | null
          company_signature_url?: string | null
          company_signed_at?: string | null
          contract_data?: Json | null
          contract_template: string
          created_at?: string | null
          expires_at?: string | null
          final_contract_url?: string | null
          id?: string
          job_id: string
          status?: Database["public"]["Enums"]["contract_status"] | null
          updated_at?: string | null
        }
        Update: {
          application_id?: string
          candidate_id?: string
          candidate_ip?: string | null
          candidate_signature_url?: string | null
          candidate_signed_at?: string | null
          company_id?: string
          company_ip?: string | null
          company_signature_url?: string | null
          company_signed_at?: string | null
          contract_data?: Json | null
          contract_template?: string
          created_at?: string | null
          expires_at?: string | null
          final_contract_url?: string | null
          id?: string
          job_id?: string
          status?: Database["public"]["Enums"]["contract_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          description: string
          evidence_urls: string[]
          id: string
          mission_id: string
          opened_by: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          evidence_urls?: string[]
          id?: string
          mission_id: string
          opened_by: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          evidence_urls?: string[]
          id?: string
          mission_id?: string
          opened_by?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_expirations: {
        Row: {
          candidate_id: string
          created_at: string
          document_type: string
          expires_at: string
          id: string
          notified_30d: boolean
          notified_7d: boolean
          notified_expired: boolean
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          document_type: string
          expires_at: string
          id?: string
          notified_30d?: boolean
          notified_7d?: boolean
          notified_expired?: boolean
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          document_type?: string
          expires_at?: string
          id?: string
          notified_30d?: boolean
          notified_7d?: boolean
          notified_expired?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_expirations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          ai_score: number | null
          candidate_id: string
          contract_signed: boolean | null
          contract_signed_at: string | null
          contract_url: string | null
          created_at: string | null
          distance_km: number | null
          has_worked_here_before: boolean
          id: string
          job_id: string
          match_score: number | null
          previous_rating: number | null
          rejection_reason: string | null
          selected_at: string | null
          selected_by: string | null
          status: Database["public"]["Enums"]["application_status"] | null
          updated_at: string | null
        }
        Insert: {
          ai_score?: number | null
          candidate_id: string
          contract_signed?: boolean | null
          contract_signed_at?: string | null
          contract_url?: string | null
          created_at?: string | null
          distance_km?: number | null
          has_worked_here_before?: boolean
          id?: string
          job_id: string
          match_score?: number | null
          previous_rating?: number | null
          rejection_reason?: string | null
          selected_at?: string | null
          selected_by?: string | null
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string | null
        }
        Update: {
          ai_score?: number | null
          candidate_id?: string
          contract_signed?: boolean | null
          contract_signed_at?: string | null
          contract_url?: string | null
          created_at?: string | null
          distance_km?: number | null
          has_worked_here_before?: boolean
          id?: string
          job_id?: string
          match_score?: number | null
          previous_rating?: number | null
          rejection_reason?: string | null
          selected_at?: string | null
          selected_by?: string | null
          status?: Database["public"]["Enums"]["application_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      job_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name_en: string
          name_fr: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name_en: string
          name_fr: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string
          name_fr?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      job_favorites: {
        Row: {
          candidate_id: string
          created_at: string | null
          id: string
          job_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string | null
          id?: string
          job_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string | null
          id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_favorites_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_favorites_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          address: string
          benefits: string[]
          break_duration_minutes: number
          category_id: string | null
          city: string
          company_id: string
          created_at: string | null
          currency: string | null
          description: string
          dress_code: string | null
          effective_hours: number | null
          end_date: string | null
          end_time: string
          estimated_hours: number | null
          expires_at: string | null
          hourly_rate: number
          id: string
          is_recurring: boolean | null
          is_sandbox: boolean | null
          job_type: Database["public"]["Enums"]["job_type"] | null
          latitude: number | null
          location_map_url: string | null
          location_photo_url: string | null
          location_reference: string | null
          longitude: number | null
          min_experience_months: number | null
          moderated_at: string | null
          moderation_by: string | null
          moderation_notes: string | null
          parent_job_id: string | null
          positions_available: number | null
          positions_filled: number | null
          provided_equipment: string[]
          published_at: string | null
          quartier: string | null
          recurring_days: number[] | null
          rejection_reason: string | null
          required_candidates_count: number
          required_skills: string[] | null
          salary_per_person_per_day: number | null
          sandbox_level_required: number
          special_instructions: string | null
          start_date: string
          start_time: string
          status: Database["public"]["Enums"]["job_status"] | null
          title: string
          updated_at: string | null
          urgency: Database["public"]["Enums"]["urgency_level"] | null
        }
        Insert: {
          address: string
          benefits?: string[]
          break_duration_minutes?: number
          category_id?: string | null
          city: string
          company_id: string
          created_at?: string | null
          currency?: string | null
          description: string
          dress_code?: string | null
          effective_hours?: number | null
          end_date?: string | null
          end_time: string
          estimated_hours?: number | null
          expires_at?: string | null
          hourly_rate: number
          id?: string
          is_recurring?: boolean | null
          is_sandbox?: boolean | null
          job_type?: Database["public"]["Enums"]["job_type"] | null
          latitude?: number | null
          location_map_url?: string | null
          location_photo_url?: string | null
          location_reference?: string | null
          longitude?: number | null
          min_experience_months?: number | null
          moderated_at?: string | null
          moderation_by?: string | null
          moderation_notes?: string | null
          parent_job_id?: string | null
          positions_available?: number | null
          positions_filled?: number | null
          provided_equipment?: string[]
          published_at?: string | null
          quartier?: string | null
          recurring_days?: number[] | null
          rejection_reason?: string | null
          required_candidates_count?: number
          required_skills?: string[] | null
          salary_per_person_per_day?: number | null
          sandbox_level_required?: number
          special_instructions?: string | null
          start_date: string
          start_time: string
          status?: Database["public"]["Enums"]["job_status"] | null
          title: string
          updated_at?: string | null
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Update: {
          address?: string
          benefits?: string[]
          break_duration_minutes?: number
          category_id?: string | null
          city?: string
          company_id?: string
          created_at?: string | null
          currency?: string | null
          description?: string
          dress_code?: string | null
          effective_hours?: number | null
          end_date?: string | null
          end_time?: string
          estimated_hours?: number | null
          expires_at?: string | null
          hourly_rate?: number
          id?: string
          is_recurring?: boolean | null
          is_sandbox?: boolean | null
          job_type?: Database["public"]["Enums"]["job_type"] | null
          latitude?: number | null
          location_map_url?: string | null
          location_photo_url?: string | null
          location_reference?: string | null
          longitude?: number | null
          min_experience_months?: number | null
          moderated_at?: string | null
          moderation_by?: string | null
          moderation_notes?: string | null
          parent_job_id?: string | null
          positions_available?: number | null
          positions_filled?: number | null
          provided_equipment?: string[]
          published_at?: string | null
          quartier?: string | null
          recurring_days?: number[] | null
          rejection_reason?: string | null
          required_candidates_count?: number
          required_skills?: string[] | null
          salary_per_person_per_day?: number | null
          sandbox_level_required?: number
          special_instructions?: string | null
          start_date?: string
          start_time?: string
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string
          updated_at?: string | null
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "job_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_moderation_by_fkey"
            columns: ["moderation_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_check_ins: {
        Row: {
          check_in_type: Database["public"]["Enums"]["check_in_type"]
          checked_at: string | null
          created_at: string | null
          distance_from_job_meters: number | null
          id: string
          latitude: number | null
          longitude: number | null
          mission_id: string
          photo_url: string | null
          validated_by_company: boolean | null
          validation_code: string | null
        }
        Insert: {
          check_in_type: Database["public"]["Enums"]["check_in_type"]
          checked_at?: string | null
          created_at?: string | null
          distance_from_job_meters?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          mission_id: string
          photo_url?: string | null
          validated_by_company?: boolean | null
          validation_code?: string | null
        }
        Update: {
          check_in_type?: Database["public"]["Enums"]["check_in_type"]
          checked_at?: string | null
          created_at?: string | null
          distance_from_job_meters?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          mission_id?: string
          photo_url?: string | null
          validated_by_company?: boolean | null
          validation_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mission_check_ins_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          actual_end_time: string | null
          actual_start_time: string | null
          application_id: string | null
          arrival_distance_meters: number | null
          arrival_latitude: number | null
          arrival_longitude: number | null
          arrival_validated: boolean | null
          break_minutes: number | null
          cancellation_reason: string | null
          candidate_id: string
          candidate_notes: string | null
          candidate_validation_code: string | null
          company_notes: string | null
          company_validation_code: string | null
          contract_type: string
          created_at: string | null
          departure_validated: boolean | null
          id: string
          is_sandbox: boolean | null
          job_id: string
          payment_first_tranche_at: string | null
          payment_second_tranche_at: string | null
          payment_status: string
          platform_fee: number
          scheduled_date: string
          scheduled_end_time: string
          scheduled_start_time: string
          status: Database["public"]["Enums"]["mission_status"] | null
          updated_at: string | null
          validated_at: string | null
        }
        Insert: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          application_id?: string | null
          arrival_distance_meters?: number | null
          arrival_latitude?: number | null
          arrival_longitude?: number | null
          arrival_validated?: boolean | null
          break_minutes?: number | null
          cancellation_reason?: string | null
          candidate_id: string
          candidate_notes?: string | null
          candidate_validation_code?: string | null
          company_notes?: string | null
          company_validation_code?: string | null
          contract_type?: string
          created_at?: string | null
          departure_validated?: boolean | null
          id?: string
          is_sandbox?: boolean | null
          job_id: string
          payment_first_tranche_at?: string | null
          payment_second_tranche_at?: string | null
          payment_status?: string
          platform_fee?: number
          scheduled_date: string
          scheduled_end_time: string
          scheduled_start_time: string
          status?: Database["public"]["Enums"]["mission_status"] | null
          updated_at?: string | null
          validated_at?: string | null
        }
        Update: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          application_id?: string | null
          arrival_distance_meters?: number | null
          arrival_latitude?: number | null
          arrival_longitude?: number | null
          arrival_validated?: boolean | null
          break_minutes?: number | null
          cancellation_reason?: string | null
          candidate_id?: string
          candidate_notes?: string | null
          candidate_validation_code?: string | null
          company_notes?: string | null
          company_validation_code?: string | null
          contract_type?: string
          created_at?: string | null
          departure_validated?: boolean | null
          id?: string
          is_sandbox?: boolean | null
          job_id?: string
          payment_first_tranche_at?: string | null
          payment_second_tranche_at?: string | null
          payment_status?: string
          platform_fee?: number
          scheduled_date?: string
          scheduled_end_time?: string
          scheduled_start_time?: string
          status?: Database["public"]["Enums"]["mission_status"] | null
          updated_at?: string | null
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          data: Json | null
          id: string
          is_read: boolean | null
          notification_type: Database["public"]["Enums"]["notification_type"]
          read_at: string | null
          sent_email: boolean | null
          sent_push: boolean | null
          sent_sms: boolean | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          notification_type: Database["public"]["Enums"]["notification_type"]
          read_at?: string | null
          sent_email?: boolean | null
          sent_push?: boolean | null
          sent_sms?: boolean | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string | null
          data?: Json | null
          id?: string
          is_read?: boolean | null
          notification_type?: Database["public"]["Enums"]["notification_type"]
          read_at?: string | null
          sent_email?: boolean | null
          sent_push?: boolean | null
          sent_sms?: boolean | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          attempts: number | null
          code: string
          created_at: string | null
          expires_at: string
          id: string
          phone: string
          verified: boolean | null
        }
        Insert: {
          attempts?: number | null
          code: string
          created_at?: string | null
          expires_at: string
          id?: string
          phone: string
          verified?: boolean | null
        }
        Update: {
          attempts?: number | null
          code?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          phone?: string
          verified?: boolean | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          bonus_amount: number | null
          candidate_id: string
          company_id: string
          created_at: string | null
          currency: string | null
          deduction_amount: number | null
          deduction_reason: string | null
          gross_amount: number
          hourly_rate: number
          hours_worked: number
          id: string
          mission_id: string
          net_amount: number
          notes: string | null
          overtime_hours: number | null
          overtime_rate: number | null
          platform_fee: number | null
          processed_at: string | null
          processed_by: string | null
          reference_number: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          updated_at: string | null
        }
        Insert: {
          bonus_amount?: number | null
          candidate_id: string
          company_id: string
          created_at?: string | null
          currency?: string | null
          deduction_amount?: number | null
          deduction_reason?: string | null
          gross_amount: number
          hourly_rate: number
          hours_worked: number
          id?: string
          mission_id: string
          net_amount: number
          notes?: string | null
          overtime_hours?: number | null
          overtime_rate?: number | null
          platform_fee?: number | null
          processed_at?: string | null
          processed_by?: string | null
          reference_number?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          updated_at?: string | null
        }
        Update: {
          bonus_amount?: number | null
          candidate_id?: string
          company_id?: string
          created_at?: string | null
          currency?: string | null
          deduction_amount?: number | null
          deduction_reason?: string | null
          gross_amount?: number
          hourly_rate?: number
          hours_worked?: number
          id?: string
          mission_id?: string
          net_amount?: number
          notes?: string | null
          overtime_hours?: number | null
          overtime_rate?: number | null
          platform_fee?: number | null
          processed_at?: string | null
          processed_by?: string | null
          reference_number?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          communication_rating: number | null
          created_at: string | null
          id: string
          is_public: boolean | null
          mission_id: string
          overall_rating: number
          professionalism_rating: number | null
          punctuality_rating: number | null
          reviewed_id: string
          reviewed_type: string
          reviewer_id: string
          reviewer_type: string
          work_quality_rating: number | null
        }
        Insert: {
          comment?: string | null
          communication_rating?: number | null
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          mission_id: string
          overall_rating: number
          professionalism_rating?: number | null
          punctuality_rating?: number | null
          reviewed_id: string
          reviewed_type: string
          reviewer_id: string
          reviewer_type: string
          work_quality_rating?: number | null
        }
        Update: {
          comment?: string | null
          communication_rating?: number | null
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          mission_id?: string
          overall_rating?: number
          professionalism_rating?: number | null
          punctuality_rating?: number | null
          reviewed_id?: string
          reviewed_type?: string
          reviewer_id?: string
          reviewer_type?: string
          work_quality_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_config: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label_en: string
          label_fr: string
          level: number
          min_missions: number
          min_profile_pct: number | null
          min_rating: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label_en: string
          label_fr: string
          level: number
          min_missions: number
          min_profile_pct?: number | null
          min_rating?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label_en?: string
          label_fr?: string
          level?: number
          min_missions?: number
          min_profile_pct?: number | null
          min_rating?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sandbox_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          auto_renew: boolean
          created_at: string
          expires_at: string | null
          id: string
          is_trial: boolean
          plan: string
          price: number
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_renew?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          is_trial?: boolean
          plan: string
          price: number
          started_at: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_renew?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          is_trial?: boolean
          plan?: string
          price?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string | null
          description: string | null
          id: string
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string | null
          description?: string | null
          id?: string
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string | null
          description?: string | null
          id?: string
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
          wallet_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          ban_expires_at: string | null
          ban_reason: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          locale: Database["public"]["Enums"]["locale_type"] | null
          no_show_count: number | null
          phone: string | null
          phone_verified: boolean | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          ban_expires_at?: string | null
          ban_reason?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          is_active?: boolean | null
          is_verified?: boolean | null
          locale?: Database["public"]["Enums"]["locale_type"] | null
          no_show_count?: number | null
          phone?: string | null
          phone_verified?: boolean | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          ban_expires_at?: string | null
          ban_reason?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          locale?: Database["public"]["Enums"]["locale_type"] | null
          no_show_count?: number | null
          phone?: string | null
          phone_verified?: boolean | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_otp: { Args: never; Returns: undefined }
      is_admin_user: { Args: { uid: string }; Returns: boolean }
      is_candidate_user: { Args: { uid: string }; Returns: boolean }
      is_company_user: { Args: { uid: string }; Returns: boolean }
    }
    Enums: {
      application_status:
        | "pending"
        | "shortlisted"
        | "selected"
        | "rejected"
        | "withdrawn"
        | "no_show"
      check_in_type: "arrival" | "departure" | "break_start" | "break_end"
      company_size: "tpe" | "pme" | "eti" | "ge"
      contract_status:
        | "pending"
        | "signed_candidate"
        | "signed_company"
        | "fully_signed"
        | "rejected"
        | "expired"
        | "candidate_signed"
        | "company_signed"
        | "completed"
      gender_type: "male" | "female" | "other"
      job_status:
        | "draft"
        | "pending_moderation"
        | "published"
        | "rejected"
        | "filled"
        | "cancelled"
        | "expired"
        | "pending_review"
        | "active"
      job_type: "shift" | "mission" | "contract"
      locale_type: "fr" | "en"
      mission_status:
        | "pending"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
        | "en_route"
        | "arrived"
        | "validated"
        | "disputed"
      notification_type:
        | "job_match"
        | "application_update"
        | "mission_reminder"
        | "mission_update"
        | "payment"
        | "review_request"
        | "system"
      onboarding_status: "pending" | "in_progress" | "completed" | "rejected"
      payment_method: "mtn_momo" | "orange_money" | "bank_transfer" | "cash"
      payment_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "refunded"
        | "cancelled"
        | "partial"
        | "full"
      urgency_level: "normal" | "urgent" | "critical"
      user_role:
        | "candidate"
        | "company"
        | "admin_support"
        | "admin_ops"
        | "admin_founder"
        | "candidate_premium"
        | "company_premium"
      verification_status: "pending" | "verified" | "rejected"
      withdrawal_status:
        | "pending"
        | "approved"
        | "processing"
        | "completed"
        | "rejected"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_status: [
        "pending",
        "shortlisted",
        "selected",
        "rejected",
        "withdrawn",
        "no_show",
      ],
      check_in_type: ["arrival", "departure", "break_start", "break_end"],
      company_size: ["tpe", "pme", "eti", "ge"],
      contract_status: [
        "pending",
        "signed_candidate",
        "signed_company",
        "fully_signed",
        "rejected",
        "expired",
        "candidate_signed",
        "company_signed",
        "completed",
      ],
      gender_type: ["male", "female", "other"],
      job_status: [
        "draft",
        "pending_moderation",
        "published",
        "rejected",
        "filled",
        "cancelled",
        "expired",
        "pending_review",
        "active",
      ],
      job_type: ["shift", "mission", "contract"],
      locale_type: ["fr", "en"],
      mission_status: [
        "pending",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
        "en_route",
        "arrived",
        "validated",
        "disputed",
      ],
      notification_type: [
        "job_match",
        "application_update",
        "mission_reminder",
        "mission_update",
        "payment",
        "review_request",
        "system",
      ],
      onboarding_status: ["pending", "in_progress", "completed", "rejected"],
      payment_method: ["mtn_momo", "orange_money", "bank_transfer", "cash"],
      payment_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "refunded",
        "cancelled",
        "partial",
        "full",
      ],
      urgency_level: ["normal", "urgent", "critical"],
      user_role: [
        "candidate",
        "company",
        "admin_support",
        "admin_ops",
        "admin_founder",
        "candidate_premium",
        "company_premium",
      ],
      verification_status: ["pending", "verified", "rejected"],
      withdrawal_status: [
        "pending",
        "approved",
        "processing",
        "completed",
        "rejected",
        "failed",
      ],
    },
  },
} as const
