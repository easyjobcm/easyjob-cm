-- =====================================================================
-- SRS v1.2 — Alignement plans entreprise + favoris + alertes + templates
-- =====================================================================
-- Idempotent : utilise IF NOT EXISTS sur toutes les tables, colonnes,
-- index et policies. Sûr à rejouer plusieurs fois.

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. candidate_profiles — colonnes manquantes
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS cni_selfie_url text,
  ADD COLUMN IF NOT EXISTS cni_expires_at date,
  ADD COLUMN IF NOT EXISTS momo_name_match boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_until timestamptz,
  ADD COLUMN IF NOT EXISTS profile_completion_pct integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sandbox_level integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_rating numeric(3, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS driving_license_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS driving_license_expires_at date;

-- Contrainte sandbox_level (idempotent via DO bloc)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_profiles_sandbox_level_chk'
  ) THEN
    ALTER TABLE public.candidate_profiles
      ADD CONSTRAINT candidate_profiles_sandbox_level_chk
      CHECK (sandbox_level >= 0 AND sandbox_level <= 3);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2. company_profiles — colonnes manquantes
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS niu_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_score numeric(3, 2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS average_rating numeric(3, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_missions_posted integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_cancellation_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS device_fingerprint text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_profiles_subscription_plan_chk'
  ) THEN
    ALTER TABLE public.company_profiles
      ADD CONSTRAINT company_profiles_subscription_plan_chk
      CHECK (subscription_plan IN ('free', 'starter', 'pro', 'business'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 3. job_templates — créer AVANT jobs (référencée par FK)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  title text,
  description text,
  category_id uuid REFERENCES public.job_categories(id) ON DELETE SET NULL,
  required_skills text[],
  required_documents text[],
  dress_code text,
  special_instructions text,
  required_equipment text[],
  provided_equipment text[],
  benefits text[],
  sandbox_level_required integer DEFAULT 0,
  start_time time,
  end_time time,
  created_at timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────
-- 4. jobs — colonnes manquantes
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS parent_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.job_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_reference text,
  ADD COLUMN IF NOT EXISTS location_photo_url text,
  ADD COLUMN IF NOT EXISTS location_map_url text,
  ADD COLUMN IF NOT EXISTS break_duration_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_hours numeric(4, 2),
  ADD COLUMN IF NOT EXISTS required_candidates_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS salary_per_person_per_day numeric(10, 2),
  ADD COLUMN IF NOT EXISTS salary_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS required_equipment text[],
  ADD COLUMN IF NOT EXISTS provided_equipment text[],
  ADD COLUMN IF NOT EXISTS benefits text[],
  ADD COLUMN IF NOT EXISTS sandbox_level_required integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urgency_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selection_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS late_cancellation_threshold timestamptz;

-- ────────────────────────────────────────────────────────────────────
-- 5. missions — colonnes manquantes
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS contract_type text DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS validation_code_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_first_tranche_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_second_tranche_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancellation_penalty_applied boolean DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'missions_contract_type_chk'
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_contract_type_chk
      CHECK (contract_type IN ('simple', 'formal', 'sector_template'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'missions_cancelled_by_chk'
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_cancelled_by_chk
      CHECK (cancelled_by IS NULL OR cancelled_by IN ('company', 'candidate', 'admin'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 6. job_applications — colonnes manquantes
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS is_direct_invite boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_worked_here_before boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS previous_rating numeric(3, 2),
  ADD COLUMN IF NOT EXISTS ai_score numeric(5, 2);

-- ────────────────────────────────────────────────────────────────────
-- 7. users — device_fingerprint
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS device_fingerprint text;

-- ────────────────────────────────────────────────────────────────────
-- 8. company_favorite_candidates
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_favorite_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  UNIQUE (company_id, candidate_id)
);

-- ────────────────────────────────────────────────────────────────────
-- 9. company_availability_alerts
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_availability_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.job_categories(id) ON DELETE SET NULL,
  sandbox_level_min integer DEFAULT 0,
  city text,
  quartier text,
  min_rating numeric(3, 2),
  day_of_week integer[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────
-- 10. cancellation_penalties
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cancellation_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.company_profiles(id) ON DELETE RESTRICT,
  company_plan text NOT NULL,
  total_blocked_amount numeric NOT NULL,
  penalty_to_candidates_pct numeric DEFAULT 0,
  penalty_to_easyjob_pct numeric DEFAULT 0,
  refund_to_company_pct numeric DEFAULT 100,
  candidates_affected uuid[],
  applied_at timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────
-- 11. Trigger : interdiction de modifier salary après lock
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_salary_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.salary_locked = true
     AND NEW.salary_per_person_per_day IS DISTINCT FROM OLD.salary_per_person_per_day
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'admin_founder'
  THEN
    RAISE EXCEPTION 'Le salaire ne peut pas être modifié après soumission (salary_locked).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_salary_lock ON public.jobs;
CREATE TRIGGER enforce_salary_lock
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_salary_modification();

-- ────────────────────────────────────────────────────────────────────
-- 12. RLS — activer + policies (idempotent via DROP IF EXISTS)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.company_favorite_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_availability_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_penalties ENABLE ROW LEVEL SECURITY;

-- company_favorite_candidates : owner via company_profiles.user_id
DROP POLICY IF EXISTS company_favorite_candidates_owner_select ON public.company_favorite_candidates;
CREATE POLICY company_favorite_candidates_owner_select ON public.company_favorite_candidates
  FOR SELECT USING (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS company_favorite_candidates_owner_insert ON public.company_favorite_candidates;
CREATE POLICY company_favorite_candidates_owner_insert ON public.company_favorite_candidates
  FOR INSERT WITH CHECK (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS company_favorite_candidates_owner_delete ON public.company_favorite_candidates;
CREATE POLICY company_favorite_candidates_owner_delete ON public.company_favorite_candidates
  FOR DELETE USING (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );

-- company_availability_alerts : owner full CRUD
DROP POLICY IF EXISTS company_availability_alerts_owner_all ON public.company_availability_alerts;
CREATE POLICY company_availability_alerts_owner_all ON public.company_availability_alerts
  FOR ALL
  USING (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );

-- job_templates : owner full CRUD
DROP POLICY IF EXISTS job_templates_owner_all ON public.job_templates;
CREATE POLICY job_templates_owner_all ON public.job_templates
  FOR ALL
  USING (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.company_profiles WHERE user_id = auth.uid())
  );

-- cancellation_penalties : SELECT admin_ops + admin_founder ; INSERT service_role
DROP POLICY IF EXISTS cancellation_penalties_admin_select ON public.cancellation_penalties;
CREATE POLICY cancellation_penalties_admin_select ON public.cancellation_penalties
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin_ops', 'admin_founder')
    )
  );

DROP POLICY IF EXISTS cancellation_penalties_service_insert ON public.cancellation_penalties;
CREATE POLICY cancellation_penalties_service_insert ON public.cancellation_penalties
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────────────
-- 13. Indexes
-- ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_favorite_candidates_company
  ON public.company_favorite_candidates (company_id);

CREATE INDEX IF NOT EXISTS idx_company_availability_alerts_company_active
  ON public.company_availability_alerts (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_job_templates_company
  ON public.job_templates (company_id);

CREATE INDEX IF NOT EXISTS idx_jobs_parent
  ON public.jobs (parent_job_id);

CREATE INDEX IF NOT EXISTS idx_jobs_company_status
  ON public.jobs (company_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_selection_deadline
  ON public.jobs (selection_deadline);

CREATE INDEX IF NOT EXISTS idx_missions_candidate_status
  ON public.missions (candidate_id, status);

CREATE INDEX IF NOT EXISTS idx_missions_job_status
  ON public.missions (job_id, status);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_sandbox_level
  ON public.candidate_profiles (sandbox_level);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_premium_until
  ON public.candidate_profiles (premium_until);

-- ────────────────────────────────────────────────────────────────────
-- 14. Recopie d'origine : subscription_tier (legacy) → subscription_plan
-- ────────────────────────────────────────────────────────────────────
UPDATE public.company_profiles
SET subscription_plan = subscription_tier
WHERE subscription_plan = 'free'
  AND subscription_tier IS NOT NULL
  AND subscription_tier IN ('free', 'starter', 'pro', 'business');

COMMIT;
