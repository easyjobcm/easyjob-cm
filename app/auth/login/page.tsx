"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import {
  computeCandidateCriteria,
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";

const STAGGER = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.07, ease: "easeOut" },
  }),
};

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const isValid = email.includes("@") && password.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();

      const { data, error: authError } = await supabase.auth.signInWithPassword(
        { email: email.trim().toLowerCase(), password },
      );

      if (authError) {
        setError(t.auth.loginPage.errors.invalidCredentials);
        return;
      }

      if (!data.user) {
        setError(t.auth.loginPage.errors.generic);
        return;
      }

      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", data.user.id)
        .single();

      const role = userData?.role ?? "candidate";

      if (
        role === "admin_support" ||
        role === "admin_ops" ||
        role === "admin_founder"
      ) {
        router.push("/admin");
        return;
      }

      let completionPct = 0;

      if (role === "candidate" || role === "candidate_premium") {
        const { data: candidateProfile } = await supabase
          .from("candidate_profiles")
          .select(
            "id, profile_completion_pct, first_name, last_name, date_of_birth, city, profile_photo_url, bio, max_travel_distance_km, latitude, longitude, cni_front_url, cni_back_url, cni_selfie_url, momo_verified",
          )
          .eq("user_id", data.user.id)
          .single();

        if (candidateProfile) {
          if (
            typeof candidateProfile.profile_completion_pct === "number" &&
            candidateProfile.profile_completion_pct > 0
          ) {
            completionPct = candidateProfile.profile_completion_pct;
          } else {
            const { count } = await supabase
              .from("candidate_skills")
              .select("id", { count: "exact", head: true })
              .eq("candidate_id", candidateProfile.id);
            const criteria = computeCandidateCriteria(
              candidateProfile,
              count ?? 0,
            );
            completionPct = computeCompletion(criteria);
          }
        }
      } else {
        const { data: companyProfile } = await supabase
          .from("company_profiles")
          .select(
            "sector, description, logo_url, city, address, rccm, niu, contact_name, contact_phone",
          )
          .eq("user_id", data.user.id)
          .single();

        if (companyProfile) {
          const criteria = computeCompanyCriteria(companyProfile);
          completionPct = computeCompletion(criteria);
        }
      }

      if (completionPct < 60) {
        router.push("/profile");
      } else if (role === "candidate" || role === "candidate_premium") {
        router.push("/jobs");
      } else {
        router.push("/company/dashboard");
      }
    } catch {
      setError(t.auth.loginPage.errors.generic);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAFAFA] dark:bg-[#0D0618]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#7C3AED]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-[#F472B6]/10 blur-3xl"
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-10 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* Top nav */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-semibold text-[#7C3AED] transition-opacity hover:opacity-80"
          >
            ← EasyJob
          </Link>
          <div className="flex items-center gap-2">
            <LangSwitch />
            <ThemeToggle />
          </div>
        </div>

        {/* Hero */}
        <motion.div
          custom={0}
          variants={STAGGER}
          initial="hidden"
          animate="show"
          className="mt-10 flex flex-col items-center text-center"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#7C3AED] shadow-lg shadow-[#7C3AED]/30">
            <LogIn className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-4 text-3xl font-bold text-[#1A0A2E] dark:text-white">
            {t.auth.loginPage.title}
          </h1>
          <p className="mt-2 text-base text-gray-500 dark:text-white/60">
            {t.auth.loginPage.subtitle}
          </p>
        </motion.div>

        {/* Form card */}
        <motion.div
          custom={1}
          variants={STAGGER}
          initial="hidden"
          animate="show"
          className="mt-8 rounded-[20px] border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#1A0F2E] p-6 shadow-sm"
        >
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
            noValidate
          >
            {/* Email */}
            <motion.div
              custom={2}
              variants={STAGGER}
              initial="hidden"
              animate="show"
            >
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-white/80"
              >
                {t.auth.loginPage.email}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder={t.auth.loginPage.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#FAFAFA] dark:bg-white/5 px-4 text-sm text-gray-900 dark:text-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-white/30 focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                required
              />
            </motion.div>

            {/* Password */}
            <motion.div
              custom={3}
              variants={STAGGER}
              initial="hidden"
              animate="show"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="login-password"
                  className="text-sm font-medium text-gray-700 dark:text-white/80"
                >
                  {t.auth.loginPage.password}
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA] transition-opacity hover:opacity-70"
                >
                  {t.auth.loginPage.forgot}
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#FAFAFA] dark:bg-white/5 px-4 pr-12 text-sm text-gray-900 dark:text-white outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-white/30 focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  required
                />
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </motion.button>
              </div>
            </motion.div>

            {/* Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-red-100 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"
              >
                {error}
              </motion.p>
            )}

            {/* Submit */}
            <motion.button
              custom={4}
              variants={STAGGER}
              initial="hidden"
              animate="show"
              type="submit"
              disabled={loading || !isValid}
              whileTap={{ scale: 0.98 }}
              className="h-14 w-full rounded-full bg-[#5B21B6] font-bold text-white shadow-lg shadow-[#5B21B6]/30 transition-all hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                  {t.common.loading}
                </span>
              ) : (
                t.auth.loginPage.submit
              )}
            </motion.button>
          </form>
        </motion.div>

        {/* Sign up link */}
        <motion.p
          custom={5}
          variants={STAGGER}
          initial="hidden"
          animate="show"
          className="mt-8 text-center text-sm text-gray-500"
        >
          {t.auth.loginPage.noAccount}{" "}
          <Link
            href="/auth/signup"
            className="font-semibold text-[#7C3AED] hover:underline"
          >
            {t.auth.loginPage.createAccount}
          </Link>
        </motion.p>
      </main>
    </div>
  );
}
