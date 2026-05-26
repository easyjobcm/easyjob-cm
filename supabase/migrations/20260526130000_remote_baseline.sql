


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."application_status" AS ENUM (
    'pending',
    'shortlisted',
    'selected',
    'rejected',
    'withdrawn',
    'no_show'
);


ALTER TYPE "public"."application_status" OWNER TO "postgres";


CREATE TYPE "public"."check_in_type" AS ENUM (
    'arrival',
    'departure',
    'break_start',
    'break_end'
);


ALTER TYPE "public"."check_in_type" OWNER TO "postgres";


CREATE TYPE "public"."company_size" AS ENUM (
    'tpe',
    'pme',
    'eti',
    'ge'
);


ALTER TYPE "public"."company_size" OWNER TO "postgres";


CREATE TYPE "public"."contract_status" AS ENUM (
    'pending',
    'signed_candidate',
    'signed_company',
    'fully_signed',
    'rejected',
    'expired',
    'candidate_signed',
    'company_signed',
    'completed'
);


ALTER TYPE "public"."contract_status" OWNER TO "postgres";


CREATE TYPE "public"."gender_type" AS ENUM (
    'male',
    'female',
    'other'
);


ALTER TYPE "public"."gender_type" OWNER TO "postgres";


CREATE TYPE "public"."job_status" AS ENUM (
    'draft',
    'pending_moderation',
    'published',
    'rejected',
    'filled',
    'cancelled',
    'expired',
    'pending_review',
    'active'
);


ALTER TYPE "public"."job_status" OWNER TO "postgres";


CREATE TYPE "public"."job_type" AS ENUM (
    'shift',
    'mission',
    'contract'
);


ALTER TYPE "public"."job_type" OWNER TO "postgres";


CREATE TYPE "public"."locale_type" AS ENUM (
    'fr',
    'en'
);


ALTER TYPE "public"."locale_type" OWNER TO "postgres";


CREATE TYPE "public"."mission_status" AS ENUM (
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'en_route',
    'arrived',
    'validated',
    'disputed'
);


ALTER TYPE "public"."mission_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_type" AS ENUM (
    'job_match',
    'application_update',
    'mission_reminder',
    'mission_update',
    'payment',
    'review_request',
    'system'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";


CREATE TYPE "public"."onboarding_status" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'rejected'
);


ALTER TYPE "public"."onboarding_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'mtn_momo',
    'orange_money',
    'bank_transfer',
    'cash'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'refunded',
    'cancelled',
    'partial',
    'full'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."urgency_level" AS ENUM (
    'normal',
    'urgent',
    'critical'
);


ALTER TYPE "public"."urgency_level" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'candidate',
    'company',
    'admin_support',
    'admin_ops',
    'admin_founder',
    'candidate_premium',
    'company_premium'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE TYPE "public"."verification_status" AS ENUM (
    'pending',
    'verified',
    'rejected'
);


ALTER TYPE "public"."verification_status" OWNER TO "postgres";


CREATE TYPE "public"."withdrawal_status" AS ENUM (
    'pending',
    'approved',
    'processing',
    'completed',
    'rejected',
    'failed'
);


ALTER TYPE "public"."withdrawal_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_otp"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM public.otp_codes WHERE expires_at < NOW();
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_otp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_candidate_wallet"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.wallets (candidate_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_candidate_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role_value user_role;
BEGIN
  -- Determine role from metadata, default to candidate
  user_role_value := COALESCE(
    (NEW.raw_user_meta_data->>'role')::user_role,
    'candidate'::user_role
  );

  INSERT INTO public.users (id, email, phone, role, locale)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    user_role_value,
    COALESCE((NEW.raw_user_meta_data->>'locale')::locale_type, 'fr'::locale_type)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('admin_support','admin_ops','admin_founder')
  );
$$;


ALTER FUNCTION "public"."is_admin_user"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_candidate_user"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('candidate','candidate_premium')
  );
$$;


ALTER FUNCTION "public"."is_candidate_user"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_user"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role::text in ('company','company_premium')
  );
$$;


ALTER FUNCTION "public"."is_company_user"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_logs" IS 'Journal d''audit des actions sensibles et operations admin.';



COMMENT ON COLUMN "public"."audit_logs"."id" IS 'Identifiant unique du log d''audit.';



COMMENT ON COLUMN "public"."audit_logs"."actor_id" IS 'Utilisateur ayant execute l''action (si authentifie).';



COMMENT ON COLUMN "public"."audit_logs"."actor_role" IS 'Role systeme au moment de l''action.';



COMMENT ON COLUMN "public"."audit_logs"."action" IS 'Nom de l''action executee (approve_job, resolve_dispute, etc.).';



COMMENT ON COLUMN "public"."audit_logs"."resource_type" IS 'Type de ressource ciblee (job, mission, user, dispute, etc.).';



COMMENT ON COLUMN "public"."audit_logs"."resource_id" IS 'Identifiant de la ressource ciblee.';



COMMENT ON COLUMN "public"."audit_logs"."metadata" IS 'Contexte additionnel de l''action (JSON structure).';



COMMENT ON COLUMN "public"."audit_logs"."ip_address" IS 'Adresse IP source de la requete.';



COMMENT ON COLUMN "public"."audit_logs"."created_at" IS 'Date de creation du log.';



COMMENT ON COLUMN "public"."audit_logs"."updated_at" IS 'Date de derniere mise a jour du log.';



CREATE TABLE IF NOT EXISTS "public"."candidate_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "candidate_availability_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."candidate_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."candidate_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "gender" "public"."gender_type",
    "date_of_birth" "date",
    "profile_photo_url" "text",
    "cni_number" "text",
    "cni_front_url" "text",
    "cni_back_url" "text",
    "cni_verified" "public"."verification_status" DEFAULT 'pending'::"public"."verification_status",
    "cni_rejection_reason" "text",
    "address" "text",
    "city" "text",
    "quartier" "text",
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "max_travel_distance_km" integer DEFAULT 10,
    "momo_provider" "text",
    "momo_number" "text",
    "momo_verified" boolean DEFAULT false,
    "bio" "text",
    "onboarding_status" "public"."onboarding_status" DEFAULT 'pending'::"public"."onboarding_status",
    "onboarding_step" integer DEFAULT 1,
    "reliability_score" numeric(3,2) DEFAULT 0.00,
    "total_missions" integer DEFAULT 0,
    "completed_missions" integer DEFAULT 0,
    "no_show_count" integer DEFAULT 0,
    "is_sandbox" boolean DEFAULT true,
    "sandbox_missions_completed" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sandbox_level" integer DEFAULT 0 NOT NULL,
    "cni_selfie_url" "text",
    "cni_expires_at" "date",
    "driving_license_verified" boolean DEFAULT false NOT NULL,
    "driving_license_expires_at" "date",
    "momo_name_match" boolean DEFAULT false NOT NULL,
    "premium_until" timestamp with time zone,
    "average_rating" numeric(3,2) DEFAULT 0.00 NOT NULL,
    "profile_completion_pct" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "candidate_profiles_profile_completion_pct_chk" CHECK ((("profile_completion_pct" >= 0) AND ("profile_completion_pct" <= 100))),
    CONSTRAINT "candidate_profiles_sandbox_level_chk" CHECK ((("sandbox_level" >= 0) AND ("sandbox_level" <= 3)))
);


ALTER TABLE "public"."candidate_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."candidate_profiles"."sandbox_level" IS 'Niveau de confiance Sandbox du candidat (0 nouveau -> 3 expert).';



COMMENT ON COLUMN "public"."candidate_profiles"."cni_selfie_url" IS 'URL du selfie candidat tenant la CNI pour verification d''identite.';



COMMENT ON COLUMN "public"."candidate_profiles"."cni_expires_at" IS 'Date d''expiration de la CNI du candidat pour blocage/postulation conditionnelle.';



COMMENT ON COLUMN "public"."candidate_profiles"."driving_license_verified" IS 'Indique si le permis de conduire a ete verifie par l''equipe admin.';



COMMENT ON COLUMN "public"."candidate_profiles"."driving_license_expires_at" IS 'Date d''expiration du permis de conduire.';



COMMENT ON COLUMN "public"."candidate_profiles"."momo_name_match" IS 'Vrai si le nom du compte Mobile Money correspond au nom CNI du candidat.';



COMMENT ON COLUMN "public"."candidate_profiles"."premium_until" IS 'Date de fin du statut candidat premium.';



COMMENT ON COLUMN "public"."candidate_profiles"."average_rating" IS 'Note moyenne agregee du candidat (1 a 5, precision 2 decimales).';



COMMENT ON COLUMN "public"."candidate_profiles"."profile_completion_pct" IS 'Pourcentage de completude du profil (0 a 100).';



CREATE TABLE IF NOT EXISTS "public"."candidate_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "skill_name" "text" NOT NULL,
    "skill_level" integer DEFAULT 1,
    "is_ai_suggested" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."candidate_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "legal_name" "text",
    "niu" "text",
    "rccm" "text",
    "contact_name" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "address" "text",
    "city" "text",
    "quartier" "text",
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "sector" "text",
    "company_size" "public"."company_size",
    "description" "text",
    "logo_url" "text",
    "website" "text",
    "verification_status" "public"."verification_status" DEFAULT 'pending'::"public"."verification_status",
    "verification_rejection_reason" "text",
    "documents_url" "text"[],
    "onboarding_status" "public"."onboarding_status" DEFAULT 'pending'::"public"."onboarding_status",
    "onboarding_step" integer DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "subscription_tier" "text" DEFAULT 'free'::"text",
    "subscription_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."company_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contracts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "contract_template" "text" NOT NULL,
    "contract_data" "jsonb",
    "status" "public"."contract_status" DEFAULT 'pending'::"public"."contract_status",
    "candidate_signature_url" "text",
    "candidate_signed_at" timestamp with time zone,
    "candidate_ip" "text",
    "company_signature_url" "text",
    "company_signed_at" timestamp with time zone,
    "company_ip" "text",
    "final_contract_url" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."contracts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mission_id" "uuid" NOT NULL,
    "opened_by" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "description" "text" NOT NULL,
    "evidence_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolution" "text",
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone
);


ALTER TABLE "public"."disputes" OWNER TO "postgres";


COMMENT ON TABLE "public"."disputes" IS 'Gestion des litiges mission avec pieces justificatives et resolution admin.';



COMMENT ON COLUMN "public"."disputes"."id" IS 'Identifiant unique du litige.';



COMMENT ON COLUMN "public"."disputes"."mission_id" IS 'Mission concernee par le litige.';



COMMENT ON COLUMN "public"."disputes"."opened_by" IS 'Utilisateur ayant ouvert le litige.';



COMMENT ON COLUMN "public"."disputes"."type" IS 'Type de litige (absence, paiement, comportement, etc.).';



COMMENT ON COLUMN "public"."disputes"."description" IS 'Description detaillee du litige.';



COMMENT ON COLUMN "public"."disputes"."evidence_urls" IS 'URLs des preuves jointes (photos, documents, captures).';



COMMENT ON COLUMN "public"."disputes"."status" IS 'Etat du litige (open, under_review, resolved, escalated).';



COMMENT ON COLUMN "public"."disputes"."resolution" IS 'Decision/resolution finale du litige.';



COMMENT ON COLUMN "public"."disputes"."resolved_by" IS 'Admin ayant cloture le litige.';



COMMENT ON COLUMN "public"."disputes"."created_at" IS 'Date de creation du litige.';



COMMENT ON COLUMN "public"."disputes"."updated_at" IS 'Date de derniere mise a jour du litige.';



COMMENT ON COLUMN "public"."disputes"."resolved_at" IS 'Date de resolution du litige.';



CREATE TABLE IF NOT EXISTS "public"."document_expirations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "expires_at" "date" NOT NULL,
    "notified_30d" boolean DEFAULT false NOT NULL,
    "notified_7d" boolean DEFAULT false NOT NULL,
    "notified_expired" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_expirations_document_type_chk" CHECK (("document_type" = ANY (ARRAY['cni'::"text", 'driving_license'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."document_expirations" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_expirations" IS 'Suivi des dates d''expiration des documents candidats et notifications associees.';



COMMENT ON COLUMN "public"."document_expirations"."id" IS 'Identifiant unique de la ligne d''expiration document.';



COMMENT ON COLUMN "public"."document_expirations"."candidate_id" IS 'Reference du candidat concerne.';



COMMENT ON COLUMN "public"."document_expirations"."document_type" IS 'Type de document surveille (cni, driving_license, other).';



COMMENT ON COLUMN "public"."document_expirations"."expires_at" IS 'Date d''expiration effective du document.';



COMMENT ON COLUMN "public"."document_expirations"."notified_30d" IS 'Vrai si la notification J-30 a ete envoyee.';



COMMENT ON COLUMN "public"."document_expirations"."notified_7d" IS 'Vrai si la notification J-7 a ete envoyee.';



COMMENT ON COLUMN "public"."document_expirations"."notified_expired" IS 'Vrai si la notification de document expire a ete envoyee.';



COMMENT ON COLUMN "public"."document_expirations"."created_at" IS 'Date de creation de l''enregistrement.';



COMMENT ON COLUMN "public"."document_expirations"."updated_at" IS 'Date de derniere mise a jour de l''enregistrement.';



CREATE TABLE IF NOT EXISTS "public"."job_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "status" "public"."application_status" DEFAULT 'pending'::"public"."application_status",
    "match_score" numeric(5,2),
    "distance_km" numeric(6,2),
    "selected_at" timestamp with time zone,
    "selected_by" "uuid",
    "rejection_reason" "text",
    "contract_signed" boolean DEFAULT false,
    "contract_signed_at" timestamp with time zone,
    "contract_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ai_score" numeric(5,2),
    "has_worked_here_before" boolean DEFAULT false NOT NULL,
    "previous_rating" numeric(3,2)
);


ALTER TABLE "public"."job_applications" OWNER TO "postgres";


COMMENT ON COLUMN "public"."job_applications"."ai_score" IS 'Score de matching IA (0-100) entre le candidat et l''offre.';



COMMENT ON COLUMN "public"."job_applications"."has_worked_here_before" IS 'Indique si le candidat a deja travaille pour cette entreprise.';



COMMENT ON COLUMN "public"."job_applications"."previous_rating" IS 'Derniere note recue chez cette entreprise (si historique disponible).';



CREATE TABLE IF NOT EXISTS "public"."job_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name_fr" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "icon" "text",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."job_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."job_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "category_id" "uuid",
    "job_type" "public"."job_type" DEFAULT 'shift'::"public"."job_type",
    "address" "text" NOT NULL,
    "city" "text" NOT NULL,
    "quartier" "text",
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_recurring" boolean DEFAULT false,
    "recurring_days" integer[],
    "hourly_rate" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'XAF'::"text",
    "estimated_hours" numeric(5,2),
    "required_skills" "text"[],
    "min_experience_months" integer DEFAULT 0,
    "dress_code" "text",
    "special_instructions" "text",
    "positions_available" integer DEFAULT 1,
    "positions_filled" integer DEFAULT 0,
    "status" "public"."job_status" DEFAULT 'draft'::"public"."job_status",
    "urgency" "public"."urgency_level" DEFAULT 'normal'::"public"."urgency_level",
    "moderation_notes" "text",
    "moderation_by" "uuid",
    "moderated_at" timestamp with time zone,
    "rejection_reason" "text",
    "is_sandbox" boolean DEFAULT false,
    "published_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "parent_job_id" "uuid",
    "break_duration_minutes" integer DEFAULT 0 NOT NULL,
    "effective_hours" numeric(4,2),
    "location_reference" "text",
    "location_photo_url" "text",
    "location_map_url" "text",
    "provided_equipment" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "benefits" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "salary_per_person_per_day" numeric(10,2),
    "required_candidates_count" integer DEFAULT 1 NOT NULL,
    "sandbox_level_required" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "jobs_break_duration_minutes_chk" CHECK (("break_duration_minutes" >= 0)),
    CONSTRAINT "jobs_required_candidates_count_chk" CHECK (("required_candidates_count" >= 1)),
    CONSTRAINT "jobs_sandbox_level_required_chk" CHECK ((("sandbox_level_required" >= 0) AND ("sandbox_level_required" <= 3)))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."jobs"."parent_job_id" IS 'Reference vers l''offre parent pour les offres multi-jours decomposees.';



COMMENT ON COLUMN "public"."jobs"."break_duration_minutes" IS 'Duree de pause obligatoire en minutes (selon regles metier).';



COMMENT ON COLUMN "public"."jobs"."effective_hours" IS 'Duree effective de travail (heures brutes moins pause).';



COMMENT ON COLUMN "public"."jobs"."location_reference" IS 'Point de repere local pour faciliter l''arrivee du candidat.';



COMMENT ON COLUMN "public"."jobs"."location_photo_url" IS 'Photo optionnelle du lieu de mission.';



COMMENT ON COLUMN "public"."jobs"."location_map_url" IS 'Lien map (Google Maps ou equivalent) du lieu de mission.';



COMMENT ON COLUMN "public"."jobs"."provided_equipment" IS 'Liste des equipements fournis par l''entreprise.';



COMMENT ON COLUMN "public"."jobs"."benefits" IS 'Liste des avantages proposes (repas, taxi, prime, etc.).';



COMMENT ON COLUMN "public"."jobs"."salary_per_person_per_day" IS 'Salaire journalier brut par candidat.';



COMMENT ON COLUMN "public"."jobs"."required_candidates_count" IS 'Nombre de candidats requis pour la mission/journee.';



COMMENT ON COLUMN "public"."jobs"."sandbox_level_required" IS 'Niveau Sandbox minimum requis pour postuler.';



CREATE TABLE IF NOT EXISTS "public"."mission_check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mission_id" "uuid" NOT NULL,
    "check_in_type" "public"."check_in_type" NOT NULL,
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "distance_from_job_meters" numeric(10,2),
    "validated_by_company" boolean DEFAULT false,
    "validation_code" "text",
    "photo_url" "text",
    "checked_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."mission_check_ins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."missions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "application_id" "uuid",
    "scheduled_date" "date" NOT NULL,
    "scheduled_start_time" time without time zone NOT NULL,
    "scheduled_end_time" time without time zone NOT NULL,
    "actual_start_time" timestamp with time zone,
    "actual_end_time" timestamp with time zone,
    "break_minutes" integer DEFAULT 0,
    "status" "public"."mission_status" DEFAULT 'pending'::"public"."mission_status",
    "company_validation_code" "text",
    "candidate_validation_code" "text",
    "arrival_validated" boolean DEFAULT false,
    "departure_validated" boolean DEFAULT false,
    "arrival_latitude" numeric(10,8),
    "arrival_longitude" numeric(11,8),
    "arrival_distance_meters" numeric(10,2),
    "company_notes" "text",
    "candidate_notes" "text",
    "cancellation_reason" "text",
    "is_sandbox" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "contract_type" "text" DEFAULT 'simple'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payment_first_tranche_at" timestamp with time zone,
    "payment_second_tranche_at" timestamp with time zone,
    "platform_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "validated_at" timestamp with time zone,
    CONSTRAINT "missions_contract_type_chk" CHECK (("contract_type" = ANY (ARRAY['simple'::"text", 'formal'::"text"])))
);


ALTER TABLE "public"."missions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."missions"."contract_type" IS 'Type de contrat applique : simple (<3 jours) ou formal (>=3 jours).';



COMMENT ON COLUMN "public"."missions"."payment_status" IS 'Etat de paiement mission (pending, partial, full, failed, refunded).';



COMMENT ON COLUMN "public"."missions"."payment_first_tranche_at" IS 'Horodatage du premier versement candidat (si paiement fractionne).';



COMMENT ON COLUMN "public"."missions"."payment_second_tranche_at" IS 'Horodatage du second versement candidat (si paiement fractionne).';



COMMENT ON COLUMN "public"."missions"."platform_fee" IS 'Frais plateforme preleves sur la mission.';



COMMENT ON COLUMN "public"."missions"."validated_at" IS 'Horodatage de validation finale de mission par entreprise/admin.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_type" "public"."notification_type" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "sent_push" boolean DEFAULT false,
    "sent_email" boolean DEFAULT false,
    "sent_sms" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."otp_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "code" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0,
    "verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."otp_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mission_id" "uuid" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "gross_amount" numeric(12,2) NOT NULL,
    "platform_fee" numeric(12,2) DEFAULT 0.00,
    "net_amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'XAF'::"text",
    "hours_worked" numeric(5,2) NOT NULL,
    "hourly_rate" numeric(10,2) NOT NULL,
    "overtime_hours" numeric(5,2) DEFAULT 0.00,
    "overtime_rate" numeric(10,2) DEFAULT 0.00,
    "bonus_amount" numeric(10,2) DEFAULT 0.00,
    "deduction_amount" numeric(10,2) DEFAULT 0.00,
    "deduction_reason" "text",
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "processed_at" timestamp with time zone,
    "processed_by" "uuid",
    "reference_number" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mission_id" "uuid" NOT NULL,
    "reviewer_type" "text" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "reviewed_type" "text" NOT NULL,
    "reviewed_id" "uuid" NOT NULL,
    "overall_rating" integer NOT NULL,
    "punctuality_rating" integer,
    "professionalism_rating" integer,
    "communication_rating" integer,
    "work_quality_rating" integer,
    "comment" "text",
    "is_public" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_communication_rating_check" CHECK ((("communication_rating" >= 1) AND ("communication_rating" <= 5))),
    CONSTRAINT "reviews_overall_rating_check" CHECK ((("overall_rating" >= 1) AND ("overall_rating" <= 5))),
    CONSTRAINT "reviews_professionalism_rating_check" CHECK ((("professionalism_rating" >= 1) AND ("professionalism_rating" <= 5))),
    CONSTRAINT "reviews_punctuality_rating_check" CHECK ((("punctuality_rating" >= 1) AND ("punctuality_rating" <= 5))),
    CONSTRAINT "reviews_reviewed_type_check" CHECK (("reviewed_type" = ANY (ARRAY['candidate'::"text", 'company'::"text"]))),
    CONSTRAINT "reviews_reviewer_type_check" CHECK (("reviewer_type" = ANY (ARRAY['candidate'::"text", 'company'::"text"]))),
    CONSTRAINT "reviews_work_quality_rating_check" CHECK ((("work_quality_rating" >= 1) AND ("work_quality_rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sandbox_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level" integer NOT NULL,
    "label_fr" "text" NOT NULL,
    "label_en" "text" NOT NULL,
    "min_missions" integer NOT NULL,
    "min_rating" numeric(3,2),
    "min_profile_pct" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "sandbox_config_level_chk" CHECK ((("level" >= 0) AND ("level" <= 3))),
    CONSTRAINT "sandbox_config_min_missions_chk" CHECK (("min_missions" >= 0)),
    CONSTRAINT "sandbox_config_min_profile_pct_chk" CHECK ((("min_profile_pct" IS NULL) OR (("min_profile_pct" >= 0) AND ("min_profile_pct" <= 100))))
);


ALTER TABLE "public"."sandbox_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."sandbox_config" IS 'Parametrage dynamique des seuils Sandbox sans redeploiement.';



COMMENT ON COLUMN "public"."sandbox_config"."id" IS 'Identifiant unique de configuration Sandbox.';



COMMENT ON COLUMN "public"."sandbox_config"."level" IS 'Niveau Sandbox configure (0 a 3).';



COMMENT ON COLUMN "public"."sandbox_config"."label_fr" IS 'Libelle FR du niveau Sandbox.';



COMMENT ON COLUMN "public"."sandbox_config"."label_en" IS 'Libelle EN du niveau Sandbox.';



COMMENT ON COLUMN "public"."sandbox_config"."min_missions" IS 'Nombre minimum de missions reussies pour debloquer le niveau.';



COMMENT ON COLUMN "public"."sandbox_config"."min_rating" IS 'Note minimale moyenne requise pour debloquer le niveau.';



COMMENT ON COLUMN "public"."sandbox_config"."min_profile_pct" IS 'Pourcentage minimal de completude profil requis.';



COMMENT ON COLUMN "public"."sandbox_config"."is_active" IS 'Indique si cette regle niveau est active.';



COMMENT ON COLUMN "public"."sandbox_config"."created_at" IS 'Date de creation de la regle.';



COMMENT ON COLUMN "public"."sandbox_config"."updated_at" IS 'Date de derniere mise a jour de la regle.';



COMMENT ON COLUMN "public"."sandbox_config"."updated_by" IS 'Admin ayant effectue la derniere mise a jour.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone,
    "is_trial" boolean DEFAULT false NOT NULL,
    "auto_renew" boolean DEFAULT true NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'Abonnements candidats/entreprises (essai, renouvellement, statut).';



COMMENT ON COLUMN "public"."subscriptions"."id" IS 'Identifiant unique de l''abonnement.';



COMMENT ON COLUMN "public"."subscriptions"."user_id" IS 'Utilisateur proprietaire de l''abonnement.';



COMMENT ON COLUMN "public"."subscriptions"."plan" IS 'Nom du plan (gratuit, starter, pro, business, premium).';



COMMENT ON COLUMN "public"."subscriptions"."price" IS 'Montant periodique de l''abonnement.';



COMMENT ON COLUMN "public"."subscriptions"."started_at" IS 'Date de debut de validite.';



COMMENT ON COLUMN "public"."subscriptions"."expires_at" IS 'Date de fin de validite.';



COMMENT ON COLUMN "public"."subscriptions"."is_trial" IS 'Vrai si l''abonnement est en periode d''essai.';



COMMENT ON COLUMN "public"."subscriptions"."auto_renew" IS 'Vrai si le renouvellement automatique est actif.';



COMMENT ON COLUMN "public"."subscriptions"."status" IS 'Etat de l''abonnement (active, cancelled, expired).';



COMMENT ON COLUMN "public"."subscriptions"."created_at" IS 'Date de creation de l''abonnement.';



COMMENT ON COLUMN "public"."subscriptions"."updated_at" IS 'Date de derniere mise a jour de l''abonnement.';



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "transaction_type" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['credit'::"text", 'debit'::"text", 'withdrawal'::"text", 'refund'::"text", 'bonus'::"text", 'fee'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "phone" "text",
    "phone_verified" boolean DEFAULT false,
    "role" "public"."user_role" DEFAULT 'candidate'::"public"."user_role" NOT NULL,
    "locale" "public"."locale_type" DEFAULT 'fr'::"public"."locale_type",
    "is_active" boolean DEFAULT true,
    "is_verified" boolean DEFAULT false,
    "ban_reason" "text",
    "ban_expires_at" timestamp with time zone,
    "no_show_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidate_availability"
    ADD CONSTRAINT "candidate_availability_candidate_id_day_of_week_start_time_key" UNIQUE ("candidate_id", "day_of_week", "start_time");



ALTER TABLE ONLY "public"."candidate_availability"
    ADD CONSTRAINT "candidate_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidate_profiles"
    ADD CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidate_profiles"
    ADD CONSTRAINT "candidate_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."candidate_skills"
    ADD CONSTRAINT "candidate_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_niu_key" UNIQUE ("niu");



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_expirations"
    ADD CONSTRAINT "document_expirations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_job_id_candidate_id_key" UNIQUE ("job_id", "candidate_id");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_categories"
    ADD CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_favorites"
    ADD CONSTRAINT "job_favorites_job_id_candidate_id_key" UNIQUE ("job_id", "candidate_id");



ALTER TABLE ONLY "public"."job_favorites"
    ADD CONSTRAINT "job_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mission_check_ins"
    ADD CONSTRAINT "mission_check_ins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."missions"
    ADD CONSTRAINT "missions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."otp_codes"
    ADD CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_reference_number_key" UNIQUE ("reference_number");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sandbox_config"
    ADD CONSTRAINT "sandbox_config_level_key" UNIQUE ("level");



ALTER TABLE ONLY "public"."sandbox_config"
    ADD CONSTRAINT "sandbox_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_logs_actor_id" ON "public"."audit_logs" USING "btree" ("actor_id");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_candidate_availability_candidate_id" ON "public"."candidate_availability" USING "btree" ("candidate_id");



CREATE INDEX "idx_candidate_profiles_city" ON "public"."candidate_profiles" USING "btree" ("city");



CREATE INDEX "idx_candidate_profiles_user_id" ON "public"."candidate_profiles" USING "btree" ("user_id");



CREATE INDEX "idx_candidate_skills_candidate_id" ON "public"."candidate_skills" USING "btree" ("candidate_id");



CREATE INDEX "idx_company_profiles_city" ON "public"."company_profiles" USING "btree" ("city");



CREATE INDEX "idx_company_profiles_user_id" ON "public"."company_profiles" USING "btree" ("user_id");



CREATE INDEX "idx_contracts_application_id" ON "public"."contracts" USING "btree" ("application_id");



CREATE INDEX "idx_contracts_candidate_id" ON "public"."contracts" USING "btree" ("candidate_id");



CREATE INDEX "idx_disputes_created_at" ON "public"."disputes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_disputes_mission_id" ON "public"."disputes" USING "btree" ("mission_id");



CREATE INDEX "idx_disputes_opened_by" ON "public"."disputes" USING "btree" ("opened_by");



CREATE INDEX "idx_disputes_resolved_by" ON "public"."disputes" USING "btree" ("resolved_by");



CREATE INDEX "idx_disputes_status" ON "public"."disputes" USING "btree" ("status");



CREATE INDEX "idx_document_expirations_candidate_id" ON "public"."document_expirations" USING "btree" ("candidate_id");



CREATE INDEX "idx_document_expirations_doc_type" ON "public"."document_expirations" USING "btree" ("document_type");



CREATE INDEX "idx_document_expirations_expires_at" ON "public"."document_expirations" USING "btree" ("expires_at");



CREATE INDEX "idx_job_applications_candidate_id" ON "public"."job_applications" USING "btree" ("candidate_id");



CREATE INDEX "idx_job_applications_job_id" ON "public"."job_applications" USING "btree" ("job_id");



CREATE INDEX "idx_job_applications_status" ON "public"."job_applications" USING "btree" ("status");



CREATE INDEX "idx_job_favorites_candidate_id" ON "public"."job_favorites" USING "btree" ("candidate_id");



CREATE INDEX "idx_jobs_category_id" ON "public"."jobs" USING "btree" ("category_id");



CREATE INDEX "idx_jobs_city" ON "public"."jobs" USING "btree" ("city");



CREATE INDEX "idx_jobs_company_id" ON "public"."jobs" USING "btree" ("company_id");



CREATE INDEX "idx_jobs_parent_job_id" ON "public"."jobs" USING "btree" ("parent_job_id");



CREATE INDEX "idx_jobs_published_at" ON "public"."jobs" USING "btree" ("published_at");



CREATE INDEX "idx_jobs_start_date" ON "public"."jobs" USING "btree" ("start_date");



CREATE INDEX "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");



CREATE INDEX "idx_mission_check_ins_mission_id" ON "public"."mission_check_ins" USING "btree" ("mission_id");



CREATE INDEX "idx_missions_candidate_id" ON "public"."missions" USING "btree" ("candidate_id");



CREATE INDEX "idx_missions_job_id" ON "public"."missions" USING "btree" ("job_id");



CREATE INDEX "idx_missions_scheduled_date" ON "public"."missions" USING "btree" ("scheduled_date");



CREATE INDEX "idx_missions_status" ON "public"."missions" USING "btree" ("status");



CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_otp_codes_expires_at" ON "public"."otp_codes" USING "btree" ("expires_at");



CREATE INDEX "idx_otp_codes_phone" ON "public"."otp_codes" USING "btree" ("phone");



CREATE INDEX "idx_payments_candidate_id" ON "public"."payments" USING "btree" ("candidate_id");



CREATE INDEX "idx_payments_company_id" ON "public"."payments" USING "btree" ("company_id");



CREATE INDEX "idx_payments_mission_id" ON "public"."payments" USING "btree" ("mission_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_reviews_mission_id" ON "public"."reviews" USING "btree" ("mission_id");



CREATE INDEX "idx_reviews_reviewed_id" ON "public"."reviews" USING "btree" ("reviewed_id");



CREATE INDEX "idx_sandbox_config_is_active" ON "public"."sandbox_config" USING "btree" ("is_active");



CREATE INDEX "idx_sandbox_config_updated_by" ON "public"."sandbox_config" USING "btree" ("updated_by");



CREATE INDEX "idx_subscriptions_expires_at" ON "public"."subscriptions" USING "btree" ("expires_at");



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_transactions_wallet_id" ON "public"."transactions" USING "btree" ("wallet_id");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_phone" ON "public"."users" USING "btree" ("phone");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE OR REPLACE TRIGGER "on_candidate_created" AFTER INSERT ON "public"."candidate_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."create_candidate_wallet"();



CREATE OR REPLACE TRIGGER "on_candidate_profiles_updated" BEFORE UPDATE ON "public"."candidate_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_company_profiles_updated" BEFORE UPDATE ON "public"."company_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_contracts_updated" BEFORE UPDATE ON "public"."contracts" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_job_applications_updated" BEFORE UPDATE ON "public"."job_applications" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_jobs_updated" BEFORE UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_missions_updated" BEFORE UPDATE ON "public"."missions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_payments_updated" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_users_updated" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_audit_logs_set_updated_at" BEFORE UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_disputes_set_updated_at" BEFORE UPDATE ON "public"."disputes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_document_expirations_set_updated_at" BEFORE UPDATE ON "public"."document_expirations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sandbox_config_set_updated_at" BEFORE UPDATE ON "public"."sandbox_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_subscriptions_set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."candidate_availability"
    ADD CONSTRAINT "candidate_availability_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."candidate_profiles"
    ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."candidate_skills"
    ADD CONSTRAINT "candidate_skills_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_profiles"("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_expirations"
    ADD CONSTRAINT "document_expirations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_selected_by_fkey" FOREIGN KEY ("selected_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."job_favorites"
    ADD CONSTRAINT "job_favorites_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_favorites"
    ADD CONSTRAINT "job_favorites_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."job_categories"("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_moderation_by_fkey" FOREIGN KEY ("moderation_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_parent_job_id_fkey" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mission_check_ins"
    ADD CONSTRAINT "mission_check_ins_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."missions"
    ADD CONSTRAINT "missions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id");



ALTER TABLE ONLY "public"."missions"
    ADD CONSTRAINT "missions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."missions"
    ADD CONSTRAINT "missions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sandbox_config"
    ADD CONSTRAINT "sandbox_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can insert OTP codes" ON "public"."otp_codes" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can update OTP codes" ON "public"."otp_codes" FOR UPDATE USING (true);



CREATE POLICY "Anyone can view job categories" ON "public"."job_categories" FOR SELECT USING (true);



CREATE POLICY "Anyone can view public reviews" ON "public"."reviews" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Candidates can create applications" ON "public"."job_applications" FOR INSERT WITH CHECK (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can create check-ins" ON "public"."mission_check_ins" FOR INSERT WITH CHECK (("mission_id" IN ( SELECT "m"."id"
   FROM ("public"."missions" "m"
     JOIN "public"."candidate_profiles" "cp" ON (("m"."candidate_id" = "cp"."id")))
  WHERE ("cp"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can insert own profile" ON "public"."candidate_profiles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Candidates can manage own availability" ON "public"."candidate_availability" USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can manage own favorites" ON "public"."job_favorites" USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can manage own skills" ON "public"."candidate_skills" USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can update own applications" ON "public"."job_applications" FOR UPDATE USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can update own profile" ON "public"."candidate_profiles" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Candidates can view own applications" ON "public"."job_applications" FOR SELECT USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can view own missions" ON "public"."missions" FOR SELECT USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can view own payments" ON "public"."payments" FOR SELECT USING (("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Candidates can view own profile" ON "public"."candidate_profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Companies can insert own profile" ON "public"."company_profiles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Companies can manage own jobs" ON "public"."jobs" USING (("company_id" IN ( SELECT "company_profiles"."id"
   FROM "public"."company_profiles"
  WHERE ("company_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Companies can update applications for their jobs" ON "public"."job_applications" FOR UPDATE USING (("job_id" IN ( SELECT "j"."id"
   FROM ("public"."jobs" "j"
     JOIN "public"."company_profiles" "cp" ON (("j"."company_id" = "cp"."id")))
  WHERE ("cp"."user_id" = "auth"."uid"()))));



CREATE POLICY "Companies can update own profile" ON "public"."company_profiles" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Companies can update their job missions" ON "public"."missions" FOR UPDATE USING (("job_id" IN ( SELECT "j"."id"
   FROM ("public"."jobs" "j"
     JOIN "public"."company_profiles" "cp" ON (("j"."company_id" = "cp"."id")))
  WHERE ("cp"."user_id" = "auth"."uid"()))));



CREATE POLICY "Companies can view applications for their jobs" ON "public"."job_applications" FOR SELECT USING (("job_id" IN ( SELECT "j"."id"
   FROM ("public"."jobs" "j"
     JOIN "public"."company_profiles" "cp" ON (("j"."company_id" = "cp"."id")))
  WHERE ("cp"."user_id" = "auth"."uid"()))));



CREATE POLICY "Companies can view candidate summaries" ON "public"."company_profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'company'::"public"."user_role")))));



CREATE POLICY "Companies can view own profile" ON "public"."company_profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Companies can view their job missions" ON "public"."missions" FOR SELECT USING (("job_id" IN ( SELECT "j"."id"
   FROM ("public"."jobs" "j"
     JOIN "public"."company_profiles" "cp" ON (("j"."company_id" = "cp"."id")))
  WHERE ("cp"."user_id" = "auth"."uid"()))));



CREATE POLICY "Companies can view their payments" ON "public"."payments" FOR SELECT USING (("company_id" IN ( SELECT "company_profiles"."id"
   FROM "public"."company_profiles"
  WHERE ("company_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Published jobs are viewable by all" ON "public"."jobs" FOR SELECT USING ((("status" = 'published'::"public"."job_status") OR ("company_id" IN ( SELECT "company_profiles"."id"
   FROM "public"."company_profiles"
  WHERE ("company_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Service role can insert users" ON "public"."users" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can create reviews for their missions" ON "public"."reviews" FOR INSERT WITH CHECK (("mission_id" IN ( SELECT "m"."id"
   FROM ((("public"."missions" "m"
     LEFT JOIN "public"."candidate_profiles" "cp" ON (("m"."candidate_id" = "cp"."id")))
     LEFT JOIN "public"."jobs" "j" ON (("m"."job_id" = "j"."id")))
     LEFT JOIN "public"."company_profiles" "comp" ON (("j"."company_id" = "comp"."id")))
  WHERE (("cp"."user_id" = "auth"."uid"()) OR ("comp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own contracts" ON "public"."contracts" FOR UPDATE USING ((("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))) OR ("company_id" IN ( SELECT "company_profiles"."id"
   FROM "public"."company_profiles"
  WHERE ("company_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view check-ins for their missions" ON "public"."mission_check_ins" FOR SELECT USING (("mission_id" IN ( SELECT "m"."id"
   FROM ((("public"."missions" "m"
     LEFT JOIN "public"."candidate_profiles" "cp" ON (("m"."candidate_id" = "cp"."id")))
     LEFT JOIN "public"."jobs" "j" ON (("m"."job_id" = "j"."id")))
     LEFT JOIN "public"."company_profiles" "comp" ON (("j"."company_id" = "comp"."id")))
  WHERE (("cp"."user_id" = "auth"."uid"()) OR ("comp"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own OTP codes" ON "public"."otp_codes" FOR SELECT USING (true);



CREATE POLICY "Users can view own contracts" ON "public"."contracts" FOR SELECT USING ((("candidate_id" IN ( SELECT "candidate_profiles"."id"
   FROM "public"."candidate_profiles"
  WHERE ("candidate_profiles"."user_id" = "auth"."uid"()))) OR ("company_id" IN ( SELECT "company_profiles"."id"
   FROM "public"."company_profiles"
  WHERE ("company_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_admin_only" ON "public"."audit_logs" FOR INSERT WITH CHECK ("public"."is_admin_user"("auth"."uid"()));



CREATE POLICY "audit_logs_select_founder_only" ON "public"."audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (("u"."role")::"text" = 'admin_founder'::"text")))));



ALTER TABLE "public"."candidate_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."candidate_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."candidate_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contracts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "disputes_insert_party_or_admin" ON "public"."disputes" FOR INSERT WITH CHECK ((("opened_by" = "auth"."uid"()) OR "public"."is_admin_user"("auth"."uid"())));



CREATE POLICY "disputes_select_party_or_admin" ON "public"."disputes" FOR SELECT USING ((("opened_by" = "auth"."uid"()) OR "public"."is_admin_user"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ((("public"."missions" "m"
     LEFT JOIN "public"."jobs" "j" ON (("j"."id" = "m"."job_id")))
     LEFT JOIN "public"."candidate_profiles" "cp" ON (("cp"."id" = "m"."candidate_id")))
     LEFT JOIN "public"."company_profiles" "cmp" ON (("cmp"."id" = "j"."company_id")))
  WHERE (("m"."id" = "disputes"."mission_id") AND (("cp"."user_id" = "auth"."uid"()) OR ("cmp"."user_id" = "auth"."uid"())))))));



CREATE POLICY "disputes_update_admin_only" ON "public"."disputes" FOR UPDATE USING ("public"."is_admin_user"("auth"."uid"())) WITH CHECK ("public"."is_admin_user"("auth"."uid"()));



ALTER TABLE "public"."document_expirations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "document_expirations_insert_admin" ON "public"."document_expirations" FOR INSERT WITH CHECK ("public"."is_admin_user"("auth"."uid"()));



CREATE POLICY "document_expirations_select_own_or_admin" ON "public"."document_expirations" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."candidate_profiles" "cp"
  WHERE (("cp"."id" = "document_expirations"."candidate_id") AND ("cp"."user_id" = "auth"."uid"())))) OR "public"."is_admin_user"("auth"."uid"())));



CREATE POLICY "document_expirations_update_own_or_admin" ON "public"."document_expirations" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."candidate_profiles" "cp"
  WHERE (("cp"."id" = "document_expirations"."candidate_id") AND ("cp"."user_id" = "auth"."uid"())))) OR "public"."is_admin_user"("auth"."uid"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."candidate_profiles" "cp"
  WHERE (("cp"."id" = "document_expirations"."candidate_id") AND ("cp"."user_id" = "auth"."uid"())))) OR "public"."is_admin_user"("auth"."uid"())));



ALTER TABLE "public"."job_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mission_check_ins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."missions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."otp_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sandbox_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sandbox_config_mutate_admin_ops_founder" ON "public"."sandbox_config" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (("u"."role")::"text" = ANY (ARRAY['admin_ops'::"text", 'admin_founder'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (("u"."role")::"text" = ANY (ARRAY['admin_ops'::"text", 'admin_founder'::"text"]))))));



CREATE POLICY "sandbox_config_select_authenticated" ON "public"."sandbox_config" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_insert_admin_or_self" ON "public"."subscriptions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin_user"("auth"."uid"())));



CREATE POLICY "subscriptions_select_own_or_admin" ON "public"."subscriptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin_user"("auth"."uid"())));



CREATE POLICY "subscriptions_update_admin_only" ON "public"."subscriptions" FOR UPDATE USING ("public"."is_admin_user"("auth"."uid"())) WITH CHECK ("public"."is_admin_user"("auth"."uid"()));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_otp"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_otp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_otp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_candidate_wallet"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_candidate_wallet"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_candidate_wallet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_candidate_user"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_candidate_user"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_candidate_user"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_company_user"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_company_user"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_company_user"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."candidate_availability" TO "anon";
GRANT ALL ON TABLE "public"."candidate_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."candidate_availability" TO "service_role";



GRANT ALL ON TABLE "public"."candidate_profiles" TO "anon";
GRANT ALL ON TABLE "public"."candidate_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."candidate_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."candidate_skills" TO "anon";
GRANT ALL ON TABLE "public"."candidate_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."candidate_skills" TO "service_role";



GRANT ALL ON TABLE "public"."company_profiles" TO "anon";
GRANT ALL ON TABLE "public"."company_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."company_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."contracts" TO "anon";
GRANT ALL ON TABLE "public"."contracts" TO "authenticated";
GRANT ALL ON TABLE "public"."contracts" TO "service_role";



GRANT ALL ON TABLE "public"."disputes" TO "anon";
GRANT ALL ON TABLE "public"."disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."disputes" TO "service_role";



GRANT ALL ON TABLE "public"."document_expirations" TO "anon";
GRANT ALL ON TABLE "public"."document_expirations" TO "authenticated";
GRANT ALL ON TABLE "public"."document_expirations" TO "service_role";



GRANT ALL ON TABLE "public"."job_applications" TO "anon";
GRANT ALL ON TABLE "public"."job_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."job_applications" TO "service_role";



GRANT ALL ON TABLE "public"."job_categories" TO "anon";
GRANT ALL ON TABLE "public"."job_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."job_categories" TO "service_role";



GRANT ALL ON TABLE "public"."job_favorites" TO "anon";
GRANT ALL ON TABLE "public"."job_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."job_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON TABLE "public"."mission_check_ins" TO "anon";
GRANT ALL ON TABLE "public"."mission_check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."mission_check_ins" TO "service_role";



GRANT ALL ON TABLE "public"."missions" TO "anon";
GRANT ALL ON TABLE "public"."missions" TO "authenticated";
GRANT ALL ON TABLE "public"."missions" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."otp_codes" TO "anon";
GRANT ALL ON TABLE "public"."otp_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."otp_codes" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."sandbox_config" TO "anon";
GRANT ALL ON TABLE "public"."sandbox_config" TO "authenticated";
GRANT ALL ON TABLE "public"."sandbox_config" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







