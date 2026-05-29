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
import { OtpInput } from "@/components/auth/otp-input";
import { WelcomeModal } from "@/components/auth/welcome-modal";
import { DevPhoneHint } from "@/components/auth/dev-phone-hint";
import {
  resendEmailOtpAction,
  sendPhoneOtpAction,
  signUpCandidateAction,
  verifyEmailOtpAction,
  verifyPhoneOtpAction,
} from "@/lib/actions/auth";

type Step = "account" | "verifyEmail" | "phone" | "otp";
type SignupError = keyof ReturnType<typeof useI18n>["t"]["signup"]["errors"];

export default function CandidateSignupPage() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();

  // Si OAuth Google renvoie ici avec ?step=phone, on saute l'étape compte.
  const initialStep: Step =
    searchParams.get("step") === "phone" ? "phone" : "account";
  const [step, setStep] = React.useState<Step>(initialStep);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [acceptTerms, setAcceptTerms] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [emailToken, setEmailToken] = React.useState("");
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<SignupError | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);

  const steps = [
    t.signup.steps.account,
    t.signup.steps.email,
    t.signup.steps.phone,
    t.signup.steps.verify,
  ] as const;
  const currentIndex =
    step === "account"
      ? 0
      : step === "verifyEmail"
        ? 1
        : step === "phone"
          ? 2
          : 3;

  const handleSubmitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }
    setLoading(true);
    const res = await signUpCandidateAction({
      email,
      password,
      acceptTerms,
      locale,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode as SignupError);
      return;
    }
    setStep("verifyEmail");
  };

  const handleSubmitEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await verifyEmailOtpAction({ email, token: emailToken });
    setLoading(false);
    if (!res.ok) {
      setError(res.errorCode as SignupError);
      return;
    }
    setStep("phone");
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
        variant="candidate"
        heroTitle={t.signup.candidate.heroTitle}
        heroSubtitle={t.signup.candidate.heroSubtitle}
        backLabel={t.common.back}
      >
        <SignupProgress steps={steps} current={currentIndex} />

        {step !== "account" && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(
                step === "otp"
                  ? "phone"
                  : step === "phone"
                    ? "verifyEmail"
                    : "account",
              );
            }}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#5B21B6] hover:underline"
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
            {step === "account" && (
              <form onSubmit={handleSubmitAccount} className="space-y-4">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E]">
                    {t.signup.account.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t.signup.account.subtitle}
                  </p>
                </header>

                <div className="space-y-1">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-[#1A0A2E]"
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
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white px-4 text-base outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-[#1A0A2E]"
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
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white px-4 text-base outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                  <p className="text-xs text-gray-500">
                    {t.signup.account.passwordHint}
                  </p>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium text-[#1A0A2E]"
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
                    className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white px-4 text-base outline-none transition-colors focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20"
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="mt-0.5 h-5 w-5 accent-[#7C3AED]"
                  />
                  <span className="text-xs leading-relaxed text-gray-700">
                    {t.signup.account.terms}{" "}
                    <Link
                      href="/legal/terms"
                      className="font-semibold text-[#5B21B6] hover:underline"
                    >
                      {t.signup.account.termsLink}
                    </Link>{" "}
                    {t.signup.account.and}{" "}
                    <Link
                      href="/legal/privacy"
                      className="font-semibold text-[#5B21B6] hover:underline"
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
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 transition-opacity disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t.auth.signUp
                  )}
                </motion.button>

                <p className="pt-2 text-center text-sm text-gray-600">
                  {t.signup.chooseRole.alreadyAccount}{" "}
                  <Link
                    href="/auth/login"
                    className="font-semibold text-[#5B21B6] hover:underline"
                  >
                    {t.auth.signIn}
                  </Link>
                </p>
              </form>
            )}

            {step === "verifyEmail" && (
              <form onSubmit={handleSubmitEmailOtp} className="space-y-5">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E]">
                    {t.signup.emailOtp.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t.signup.emailOtp.subtitle}{" "}
                    <span className="font-semibold text-[#5B21B6]">
                      {email}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t.signup.emailOtp.checkSpam}
                  </p>
                </header>

                <OtpInput
                  value={emailToken}
                  onChange={setEmailToken}
                  invalid={error === "otpWrong" || error === "otpInvalid"}
                />

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || emailToken.length !== 6}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t.signup.emailOtp.verify
                  )}
                </motion.button>

                <ResendOtp
                  onResend={() => resendEmailOtpAction({ email })}
                  label={t.signup.emailOtp.didntReceive}
                  resendLabel={t.signup.emailOtp.resend}
                  resendInLabel={t.signup.emailOtp.resendIn}
                />
              </form>
            )}

            {step === "phone" && (
              <form onSubmit={handleSubmitPhone} className="space-y-4">
                <header>
                  <h2 className="text-xl font-bold text-[#1A0A2E]">
                    {t.signup.phoneStep.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t.signup.phoneStep.subtitle}
                  </p>
                </header>

                <div className="space-y-1">
                  <label
                    htmlFor="phone"
                    className="text-sm font-medium text-[#1A0A2E]"
                  >
                    {t.auth.phone}
                  </label>
                  <PhoneInput
                    value={phone}
                    onChange={setPhone}
                    autoFocus
                    invalid={error === "phoneInvalid"}
                  />
                  <p className="text-xs text-gray-500">
                    {t.signup.phoneStep.hint}
                  </p>
                </div>

                <DevPhoneHint />

                {error && <ErrorBanner code={error} />}

                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || phone.length !== 9}
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 transition-opacity disabled:opacity-60"
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
                  <h2 className="text-xl font-bold text-[#1A0A2E]">
                    {t.signup.otp.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t.signup.otp.subtitle}{" "}
                    <span className="font-semibold text-[#5B21B6]">
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
                  className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 transition-opacity disabled:opacity-60"
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
        subtitle={t.signup.welcome.subtitleCandidate}
        ctaLabel={t.signup.welcome.continue}
        ctaHref="/onboarding/candidate"
      />
    </>
  );
}

/* ───────────────────── reusable bits ───────────────────── */

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
    <p className="text-center text-sm text-gray-600">
      {label}{" "}
      <button
        type="button"
        onClick={handle}
        disabled={seconds > 0}
        className="font-semibold text-[#5B21B6] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
      >
        {seconds > 0
          ? resendInLabel.replace("{seconds}", String(seconds))
          : resendLabel}
      </button>
    </p>
  );
}
