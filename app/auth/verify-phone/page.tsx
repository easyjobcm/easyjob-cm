"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneInput } from "@/components/auth/phone-input";
import { OtpInput } from "@/components/auth/otp-input";
import { useI18n } from "@/lib/i18n";
import {
  sendPhoneOtpAction,
  verifyPhoneOtpAction,
} from "@/lib/actions/auth";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";


type Step = "phone" | "otp";
type ErrorCode = string;

const RESEND_DELAY = 60;

export default function VerifyPhonePage() {
  const router = useRouter();
  const { t } = useI18n();

  const [step, setStep] = React.useState<Step>("phone");
  const [phone, setPhone] = React.useState("");
  const [token, setToken] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<ErrorCode | null>(null);
  const [resendCountdown, setResendCountdown] = React.useState(0);

  // Countdown timer for OTP resend
  React.useEffect(() => {
    if (resendCountdown <= 0) return;
    const id = setTimeout(
      () => setResendCountdown((c) => c - 1),
      1000,
    );
    return () => clearTimeout(id);
  }, [resendCountdown]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await sendPhoneOtpAction({ phone });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode);
      return;
    }
    setResendCountdown(RESEND_DELAY);
    setStep("otp");
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await verifyPhoneOtpAction({ phone, token });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode);
      return;
    }

    const role = res.data?.role ?? "candidate";
    if (
      role === "admin_support" ||
      role === "admin_ops" ||
      role === "admin_founder"
    ) {
      router.push("/admin");
    } else if (role === "company" || role === "company_premium") {
      router.push("/company/dashboard");
    } else {
      router.push("/jobs");
    }
  };

  const handleResend = async () => {
    if (resendCountdown > 0) return;
    setError(null);
    setLoading(true);
    const res = await sendPhoneOtpAction({ phone });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode);
      return;
    }
    setResendCountdown(RESEND_DELAY);
    setToken("");
  };

  const errors = t.signup.errors as Record<string, string>;
  const errorMessage = error ? (errors[error] ?? t.signup.errors.generic) : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAFAFA] px-4 dark:bg-[#0D0618]">
    
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
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-sm"
            >
                {/* Logo / Brand */}
                <div className="mb-8 text-center">
                    <img
                    src="/images/easyjob-logo.png"
                    alt="EasyJob CM"
                    className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#7C3AED]"
                    />
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    EasyJob CM
                </h1>
                </div>

                <AnimatePresence mode="wait">
                {step === "phone" ? (
                    <motion.form
                    key="phone"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    onSubmit={handleSendOtp}
                    className="space-y-5"
                    >
                    <div className="text-center">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {t.signup.phoneStep.title}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-white/60">
                        {t.signup.phoneStep.subtitle}
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <PhoneInput
                        value={phone}
                        onChange={setPhone}
                        autoFocus
                        disabled={loading}
                        invalid={!!error}
                        />
                        <p className="text-xs text-gray-400 dark:text-white/40">
                        {t.signup.phoneStep.hint}
                        </p>
                    </div>

                    {errorMessage && (
                        <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl bg-red-50 px-4 py-2.5 text-center text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
                        >
                        {errorMessage}
                        </motion.p>
                    )}

                    <motion.button
                        type="submit"
                        disabled={phone.length !== 9 || loading}
                        className="h-14 w-full rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition disabled:opacity-50"
                        whileTap={{ scale: 0.98 }}
                    >
                        {loading ? t.auth.verifying : t.signup.phoneStep.sendCode}
                    </motion.button>
                    </motion.form>
                ) : (
                    <motion.form
                    key="otp"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    onSubmit={handleVerifyOtp}
                    className="space-y-5"
                    >
                    <div className="text-center">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {t.signup.otp.title}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-white/60">
                        {t.signup.otp.subtitle}{" "}
                        <span className="font-semibold text-[#7C3AED]">
                            +237 {phone.slice(0, 3)} {phone.slice(3, 6)}{" "}
                            {phone.slice(6)}
                        </span>
                        </p>
                    </div>

                    <div className="flex justify-center">
                        <OtpInput
                        value={token}
                        onChange={setToken}
                        autoFocus
                        disabled={loading}
                        invalid={!!error}
                        />
                    </div>

                    {errorMessage && (
                        <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl bg-red-50 px-4 py-2.5 text-center text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
                        >
                        {errorMessage}
                        </motion.p>
                    )}

                    <motion.button
                        type="submit"
                        disabled={token.length !== 6 || loading}
                        className="h-14 w-full rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition disabled:opacity-50"
                        whileTap={{ scale: 0.98 }}
                    >
                        {loading ? t.auth.verifying : t.signup.otp.verify}
                    </motion.button>

                    {/* Resend */}
                    <p className="text-center text-sm text-gray-500 dark:text-white/50">
                        {t.signup.otp.didntReceive}{" "}
                        {resendCountdown > 0 ? (
                        <span>
                            {t.signup.otp.resendIn.replace(
                            "{seconds}",
                            String(resendCountdown),
                            )}
                        </span>
                        ) : (
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={loading}
                            className="font-semibold text-[#7C3AED] disabled:opacity-50"
                        >
                            {t.signup.otp.resend}
                        </button>
                        )}
                    </p>

                    <button
                        type="button"
                        onClick={() => {
                        setStep("phone");
                        setToken("");
                        setError(null);
                        }}
                        className="w-full text-center text-sm text-gray-400 dark:text-white/30"
                    >
                        ← {t.auth.phone}
                    </button>
                    </motion.form>
                )}
                </AnimatePresence>
            </motion.div>
        </main>
    </div>
  );
}
