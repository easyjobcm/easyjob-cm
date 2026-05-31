"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/ui/lang-switch";
import { EmailOtpStep } from "@/components/auth/email-otp-step";
import {
  sendPasswordResetOtpAction,
  verifyPasswordResetOtpAction,
} from "@/lib/actions/auth";

const STAGGER = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.08, ease: "easeOut" },
  }),
};

type ForgotStep = "email" | "otp";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const fp = t.auth.forgotPage;

  const [step, setStep] = React.useState<ForgotStep>("email");
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const isValid = email.includes("@") && email.includes(".");

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setLoading(true);
    setError("");
    // Always ok:true (anti-enumeration) — action hides unknown-email errors
    await sendPasswordResetOtpAction({ email: email.trim().toLowerCase() });
    setLoading(false);
    setStep("otp");
  };

  return (
    <div className="relative min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center px-4 overflow-hidden">
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
        <button
          type="button"
          onClick={() =>
            step === "otp" ? setStep("email") : router.push("/auth/login")
          }
          className="flex items-center gap-1.5 text-[#7C3AED] font-semibold text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{step === "otp" ? t.common.back : fp.backToLogin}</span>
        </button>
        <LangSwitch variant="light" />
      </div>

      <div className="w-full max-w-md z-10 mt-16">
        <AnimatePresence mode="wait">
          {/* ── Step 1: Email ── */}
          {step === "email" && (
            <motion.div
              key="email"
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
              className="space-y-6"
            >
              <motion.div
                variants={STAGGER}
                custom={0}
                className="text-center space-y-2"
              >
                <div className="w-16 h-16 rounded-2xl bg-[#7C3AED]/10 flex items-center justify-center mx-auto">
                  <Mail className="w-8 h-8 text-[#7C3AED]" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">{fp.title}</h1>
                <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">
                  {fp.subtitle}
                </p>
              </motion.div>

              <motion.div
                variants={STAGGER}
                custom={1}
                className="bg-white border border-[#E5E7EB] rounded-[20px] p-6"
              >
                <form
                  onSubmit={handleSubmitEmail}
                  className="space-y-4"
                  noValidate
                >
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                      {fp.email}
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError("");
                      }}
                      placeholder={fp.emailPlaceholder}
                      className="w-full h-12 px-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/40 focus:border-[#7C3AED] transition"
                    />
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        key="err"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="text-xs text-red-500"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <motion.button
                    type="submit"
                    disabled={!isValid || loading}
                    whileTap={{ scale: 0.98 }}
                    className="w-full h-14 bg-[#5B21B6] text-white font-semibold rounded-full shadow disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    {loading ? fp.sending : fp.submit}
                  </motion.button>
                </form>
              </motion.div>

              <motion.p
                variants={STAGGER}
                custom={2}
                className="text-center text-sm"
              >
                <Link
                  href="/auth/login"
                  className="font-semibold text-[#5B21B6] hover:underline"
                >
                  {fp.backToLogin}
                </Link>
              </motion.p>
            </motion.div>
          )}

          {/* ── Step 2: OTP ── */}
          {step === "otp" && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-[20px] p-6"
            >
              <EmailOtpStep
                email={email}
                onSuccess={() => router.push("/auth/reset-password")}
                onVerify={(otp) =>
                  verifyPasswordResetOtpAction({
                    email: email.trim().toLowerCase(),
                    token: otp,
                  })
                }
                onResend={() =>
                  sendPasswordResetOtpAction({
                    email: email.trim().toLowerCase(),
                  })
                }
                getErrorMessage={(code) =>
                  t.signup.errors[code as keyof typeof t.signup.errors] ??
                  fp.errors.generic
                }
                labels={fp.otp}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
