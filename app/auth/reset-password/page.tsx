"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { KeyRound, Eye, EyeOff, CheckCircle2, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { createClient } from "@/lib/supabase/client";

const STAGGER = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.08, ease: "easeOut" },
  }),
};

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const rp = t.auth.resetPage;

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState("");
  const [sessionChecked, setSessionChecked] = React.useState(false);
  const [hasSession, setHasSession] = React.useState(false);

  // Verify there is an active recovery session
  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setSessionChecked(true);
    });
  }, []);

  const isValid =
    password.length >= 8 && confirm.length >= 1 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      setError(rp.errors.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(rp.errors.mismatch);
      return;
    }
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(rp.errors.generic);
        return;
      }

      // Sign out after reset so user goes through normal login
      await supabase.auth.signOut();
      setSuccess(true);
    } catch {
      setError(rp.errors.generic);
    } finally {
      setLoading(false);
    }
  };

  // Loading skeleton while checking session
  if (!sessionChecked) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#7C3AED] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618] flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#7C3AED]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-[#7C3AED]/8 blur-3xl"
      />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-safe-top py-4">
        <Link
          href="/auth/login"
          className="flex items-center gap-1.5 text-[#7C3AED] font-semibold text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{rp.backToLogin}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LangSwitch variant="light" />
          <ThemeToggle variant="light" />
        </div>
      </div>

      <div className="w-full max-w-md z-10 mt-16">
        <AnimatePresence mode="wait">
          {/* ── No session: link expired ── */}
          {!hasSession && (
            <motion.div
              key="expired"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="bg-white dark:bg-[#1A0F2E] border border-[#E5E7EB] dark:border-white/10 rounded-[20px] p-8 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {rp.sessionExpiredTitle}
              </h2>
              <p className="text-sm text-gray-500 dark:text-white/60 leading-relaxed mb-6">
                {rp.errors.sessionExpired}
              </p>
              <motion.div whileTap={{ scale: 0.98 }}>
                <Link
                  href="/auth/forgot-password"
                  className="inline-flex items-center justify-center w-full h-14 bg-[#5B21B6] text-white font-semibold rounded-full shadow"
                >
                  {rp.requestNewCode}
                </Link>
              </motion.div>
            </motion.div>
          )}

          {/* ── Success state ── */}
          {hasSession && success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="bg-white dark:bg-[#1A0F2E] border border-[#E5E7EB] dark:border-white/10 rounded-[20px] p-8 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"
              >
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </motion.div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {rp.successTitle}
              </h2>
              <p className="text-sm text-gray-500 dark:text-white/60 leading-relaxed mb-6">
                {rp.successMessage}
              </p>
              <motion.div whileTap={{ scale: 0.98 }}>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center justify-center w-full h-14 bg-[#5B21B6] text-white font-semibold rounded-full shadow"
                >
                  {rp.goToLogin}
                </Link>
              </motion.div>
            </motion.div>
          )}

          {/* ── Form ── */}
          {hasSession && !success && (
            <motion.div
              key="form"
              initial="hidden"
              animate="show"
              className="space-y-6"
            >
              {/* Hero */}
              <motion.div
                variants={STAGGER}
                custom={0}
                className="text-center space-y-2"
              >
                <div className="w-16 h-16 rounded-2xl bg-[#7C3AED]/10 flex items-center justify-center mx-auto">
                  <KeyRound className="w-8 h-8 text-[#7C3AED]" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{rp.title}</h1>
                <p className="text-sm text-gray-500 dark:text-white/60 leading-relaxed max-w-xs mx-auto">
                  {rp.subtitle}
                </p>
              </motion.div>

              {/* Card */}
              <motion.div
                variants={STAGGER}
                custom={1}
                className="bg-white dark:bg-[#1A0F2E] border border-[#E5E7EB] dark:border-white/10 rounded-[20px] p-6"
              >
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {/* New password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                      {rp.password}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setError("");
                        }}
                        placeholder={rp.passwordPlaceholder}
                        className="w-full h-12 pl-4 pr-12 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#FAFAFA] dark:bg-white/5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/40 focus:border-[#7C3AED] transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70 transition"
                        aria-label={showPassword ? rp.hidePassword : rp.showPassword}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Confirm password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                      {rp.confirm}
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => {
                          setConfirm(e.target.value);
                          setError("");
                        }}
                        placeholder={rp.confirmPlaceholder}
                        className="w-full h-12 pl-4 pr-12 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#FAFAFA] dark:bg-white/5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/40 focus:border-[#7C3AED] transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70 transition"
                        aria-label={showConfirm ? rp.hidePassword : rp.showPassword}
                      >
                        {showConfirm ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Password strength hint */}
                  {password.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex gap-1"
                    >
                      {[1, 2, 3, 4].map((level) => {
                        const strength =
                          password.length >= 12
                            ? 4
                            : password.length >= 10
                              ? 3
                              : password.length >= 8
                                ? 2
                                : 1;
                        return (
                          <div
                            key={level}
                            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                              level <= strength
                                ? strength <= 1
                                  ? "bg-red-400"
                                  : strength === 2
                                    ? "bg-yellow-400"
                                    : strength === 3
                                      ? "bg-blue-500"
                                      : "bg-green-500"
                                : "bg-gray-200"
                            }`}
                          />
                        );
                      })}
                    </motion.div>
                  )}

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.p
                        key="error"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="text-xs text-red-500"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  {/* Submit */}
                  <motion.button
                    type="submit"
                    disabled={!isValid || loading}
                    whileTap={{ scale: 0.98 }}
                    className="w-full h-14 bg-[#5B21B6] text-white font-semibold rounded-full shadow disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    {loading ? rp.saving : rp.submit}
                  </motion.button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
