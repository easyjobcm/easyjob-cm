"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { SignupShell } from "@/components/auth/signup-shell";
import { SignupProgress } from "@/components/auth/signup-progress";
import { PhoneInput } from "@/components/auth/phone-input";
import { EmailOtpStep } from "@/components/auth/email-otp-step";
import { OtpInput } from "@/components/auth/otp-input";
import { WelcomeModal } from "@/components/auth/welcome-modal";
import { DevPhoneHint } from "@/components/auth/dev-phone-hint";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import {
  resendEmailOtpAction,
  sendPhoneOtpAction,
  signUpCompanyAction,
  verifyEmailOtpAction,
  verifyPhoneOtpAction,
} from "@/lib/actions/auth";

type Step = "company" | "account" | "verifyEmail" | "phone" | "otp";
type SignupError = keyof ReturnType<typeof useI18n>["t"]["signup"]["errors"];

export default function CompanySignupPage() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();

  // OAuth Google : on n'a pas demandé NIU avant. On garde le NIU step prioritaire.
  const initialStep: Step =
    searchParams.get("step") === "phone" ? "phone" : "company";
  const [step, setStep] = React.useState<Step>(initialStep);

  const [companyName, setCompanyName] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [acceptTerms, setAcceptTerms] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<SignupError | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);

  React.useEffect(() => {
    if (!showWelcome) return;
    void createBrowserSupabase().auth.signOut();
  }, [showWelcome]);

  const steps = [
    t.signup.steps.company,
    t.signup.steps.account,
    t.signup.steps.email,
    t.signup.steps.phone,
    t.signup.steps.verify,
  ] as const;
  const currentIndex =
    step === "company"
      ? 0
      : step === "account"
        ? 1
        : step === "verifyEmail"
          ? 2
          : step === "phone"
            ? 3
            : 4;

  const handleSubmitCompany = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (companyName.trim().length < 2) {
      setError("companyNameTooShort");
      return;
    }
    if (!/^[A-Z0-9]{14}$/.test(niu.trim().toUpperCase())) {
      setError("niuInvalid");
      return;
    }
    setStep("account");
  };

  const handleSubmitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }
    setLoading(true);
    const res = await signUpCompanyAction({
      email,
      password,
      acceptTerms,
      companyName,
      niu: niu.trim().toUpperCase(),
      locale,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode as SignupError);
      if (res.errorCode === "niuAlreadyUsed") setStep("company");
      return;
    }
    setStep("verifyEmail");
  };

  const handleSubmitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await sendPhoneOtpAction({ phone });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode as SignupError);
      return;
    }
    setStep("otp");
  };

  const handleSubmitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await verifyPhoneOtpAction({ phone, token });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode as SignupError);
      return;
    }
    setShowWelcome(true);
  };

  return (
    <>
      <SignupShell
        variant="company"
        heroTitle={t.signup.company.heroTitle}
        heroSubtitle={t.signup.company.heroSubtitle}
        backLabel={t.common.back}
      >
        <SignupProgress steps={steps} current={currentIndex} />

        {step !== "company" && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(
                step === "otp"
                  ? "phone"
                  : step === "phone"
                    ? "verifyEmail"
                    : step === "verifyEmail"
                      ? "account"
                      : step === "account"
                        ? "company"
                        : "company",
              );
            }}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#5B21B6] dark:text-[#A78BFA] hover:underline"
          >
            ← {t.common.back}
          </button>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {step === "company" && (
              <form onSubmit={handleSubmitCompany} className="space-y-4">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E] dark:text-white">
                    {t.signup.steps.company}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-white/60">
                    {t.signup.company.heroSubtitle}
                  </p>
                </header>

                <div className="space-y-1">
                  <label
                    htmlFor="companyName"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.signup.company.companyName}
                  </label>
                  <input
                    id="companyName"
                    type="text"
                    autoComplete="organization"
                    required
                    placeholder={t.signup.company.companyNamePlaceholder}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-white/5 px-4 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="niu"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.signup.company.niu}
                  </label>
                  <input
                    id="niu"
                    type="text"
                    required
                    maxLength={14}
                    placeholder={t.signup.company.niuPlaceholder}
                    value={niu}
                    onChange={(e) => setNiu(e.target.value.toUpperCase())}
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-white/5 px-4 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 font-mono tracking-wider uppercase outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                  <p className="text-xs text-gray-500 dark:text-white/40">
                    {t.signup.company.niuHelp}
                  </p>
                </div>

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30"
                >
                  {t.common.next}
                </motion.button>
              </form>
            )}

            {step === "account" && (
              <form onSubmit={handleSubmitAccount} className="space-y-4">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E] dark:text-white">
                    {t.signup.account.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-white/60">
                    {t.signup.account.subtitle}
                  </p>
                </header>

                <div className="space-y-1">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.signup.account.email}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder={t.signup.account.emailPlaceholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-white/5 px-4 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.signup.account.password}
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-white/5 px-4 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                  <p className="text-xs text-gray-500 dark:text-white/40">
                    {t.signup.account.passwordHint}
                  </p>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.signup.account.confirmPassword}
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-white/5 px-4 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#FAFAFA] dark:bg-white/5 p-3">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="mt-0.5 h-5 w-5 accent-[#7C3AED]"
                  />
                  <span className="text-xs leading-relaxed text-gray-700 dark:text-white/70">
                    {t.signup.account.terms}{" "}
                    <Link
                      href="/legal/terms"
                      className="font-semibold text-[#5B21B6] dark:text-[#A78BFA] hover:underline"
                    >
                      {t.signup.account.termsLink}
                    </Link>{" "}
                    {t.signup.account.and}{" "}
                    <Link
                      href="/legal/privacy"
                      className="font-semibold text-[#5B21B6] dark:text-[#A78BFA] hover:underline"
                    >
                      {t.signup.account.privacyLink}
                    </Link>
                    .
                  </span>
                </label>

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || !acceptTerms}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t.auth.signUp
                  )}
                </motion.button>
              </form>
            )}

            {step === "verifyEmail" && (
              <EmailOtpStep
                email={email}
                onSuccess={() => setStep("phone")}
                onVerify={(otp) => verifyEmailOtpAction({ email, token: otp })}
                onResend={() => resendEmailOtpAction({ email })}
                getErrorMessage={(code) =>
                  t.signup.errors[code as keyof typeof t.signup.errors] ??
                  t.signup.errors.generic
                }
                labels={{
                  title: t.signup.emailOtp.title,
                  subtitle: t.signup.emailOtp.subtitle,
                  checkSpam: t.signup.emailOtp.checkSpam,
                  verify: t.signup.emailOtp.verify,
                  didntReceive: t.signup.emailOtp.didntReceive,
                  resend: t.signup.emailOtp.resend,
                  resendIn: t.signup.emailOtp.resendIn,
                }}
              />
            )}

            {step === "phone" && (
              <form onSubmit={handleSubmitPhone} className="space-y-4">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E] dark:text-white">
                    {t.signup.phoneStep.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-white/60">
                    {t.signup.phoneStep.subtitle}
                  </p>
                </header>

                <div className="space-y-1">
                  <label
                    htmlFor="phone"
                    className="text-sm font-medium text-[#1A0A2E] dark:text-white/80"
                  >
                    {t.auth.phone}
                  </label>
                  <PhoneInput
                    value={phone}
                    onChange={setPhone}
                    autoFocus
                    invalid={error === "phoneInvalid"}
                  />
                  <p className="text-xs text-gray-500 dark:text-white/40">
                    {t.signup.phoneStep.hint}
                  </p>
                </div>

                <DevPhoneHint />

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || phone.length !== 9}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t.signup.phoneStep.sendCode
                  )}
                </motion.button>
              </form>
            )}

            {step === "otp" && (
              <form onSubmit={handleSubmitOtp} className="space-y-5">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E] dark:text-white">
                    {t.signup.otp.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-white/60">
                    {t.signup.otp.subtitle}{" "}
                    <span className="font-semibold text-[#5B21B6] dark:text-[#A78BFA]">
                      +237 {phone}
                    </span>
                  </p>
                </header>

                <OtpInput
                  value={token}
                  onChange={setToken}
                  autoFocus
                  invalid={error === "otpWrong" || error === "otpInvalid"}
                />

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || token.length !== 6}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t.signup.otp.verify
                  )}
                </motion.button>

                <ResendOtp
                  onResend={() => sendPhoneOtpAction({ phone })}
                  label={t.signup.otp.didntReceive}
                  resendLabel={t.signup.otp.resend}
                  resendInLabel={t.signup.otp.resendIn}
                />
              </form>
            )}
          </motion.div>
        </AnimatePresence>
      </SignupShell>

      <WelcomeModal
        open={showWelcome}
        title={t.signup.welcome.title}
        subtitle={t.signup.welcome.subtitleCompany}
        ctaLabel={t.signup.welcome.continue}
        ctaHref="/auth/login"
      />
    </>
  );
}

function ErrorBanner({ code }: { code: SignupError }) {
  const { t } = useI18n();
  const message = t.signup.errors[code] ?? t.signup.errors.generic;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {message}
    </motion.div>
  );
}

function ResendOtp({
  onResend,
  label,
  resendLabel,
  resendInLabel,
}: {
  onResend: () => Promise<unknown>;
  label: string;
  resendLabel: string;
  resendInLabel: string;
}) {
  const [seconds, setSeconds] = React.useState(60);
  React.useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const handle = async () => {
    if (seconds > 0) return;
    await onResend();
    setSeconds(60);
  };

  return (
    <p className="text-center text-sm text-gray-600 dark:text-white/60">
      {label}{" "}
      <button
        type="button"
        onClick={handle}
        disabled={seconds > 0}
        className="font-semibold text-[#5B21B6] dark:text-[#A78BFA] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
      >
        {seconds > 0
          ? resendInLabel.replace("{seconds}", String(seconds))
          : resendLabel}
      </button>
    </p>
  );
}
