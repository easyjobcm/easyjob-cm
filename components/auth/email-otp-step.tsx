"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { OtpInput } from "@/components/auth/otp-input";

export interface EmailOtpStepLabels {
  title: string;
  /** Text before the email address, e.g. "A code was sent to" */
  subtitle: string;
  checkSpam?: string;
  verify: string;
  didntReceive: string;
  resend: string;
  /** Must contain the literal "{seconds}" placeholder */
  resendIn: string;
}

interface EmailOtpStepProps {
  email: string;
  /** Called once the OTP is verified successfully */
  onSuccess: () => void;
  /** Verify the 6-digit token. Returns ok:true on success. */
  onVerify: (token: string) => Promise<{ ok: boolean; errorCode?: string }>;
  /** Resend the OTP code. */
  onResend: () => Promise<{ ok: boolean }>;
  /** Maps an error code string to a human-readable message */
  getErrorMessage: (code: string) => string;
  labels: EmailOtpStepLabels;
}

export function EmailOtpStep({
  email,
  onSuccess,
  onVerify,
  onResend,
  getErrorMessage,
  labels,
}: EmailOtpStepProps) {
  const [token, setToken] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [seconds, setSeconds] = React.useState(60);

  // Resend countdown timer
  React.useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.length !== 6 || loading) return;
    setLoading(true);
    setError(null);
    const res = await onVerify(token);
    setLoading(false);
    if (!res.ok) {
      setError(getErrorMessage(res.errorCode ?? "generic"));
      return;
    }
    onSuccess();
  };

  const handleResend = async () => {
    if (seconds > 0) return;
    await onResend();
    setSeconds(60);
    setToken("");
    setError(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <header>
        <h2 className="text-xl font-bold text-[#1A0A2E]">{labels.title}</h2>
        <p className="mt-1 text-sm text-gray-600">
          {labels.subtitle}{" "}
          <span className="font-semibold text-[#5B21B6]">{email}</span>
        </p>
        {labels.checkSpam && (
          <p className="mt-1 text-xs text-gray-500">{labels.checkSpam}</p>
        )}
      </header>

      <OtpInput
        value={token}
        onChange={(v) => {
          setToken(v);
          setError(null);
        }}
        autoFocus
        invalid={!!error}
        disabled={loading}
      />

      <AnimatePresence>
        {error && (
          <motion.div
            key="otp-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="submit"
        whileTap={{ scale: 0.98 }}
        disabled={loading || token.length !== 6}
        className="flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          labels.verify
        )}
      </motion.button>

      <p className="text-center text-sm text-gray-600">
        {labels.didntReceive}{" "}
        <button
          type="button"
          onClick={handleResend}
          disabled={seconds > 0}
          className="font-semibold text-[#5B21B6] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
        >
          {seconds > 0
            ? labels.resendIn.replace("{seconds}", String(seconds))
            : labels.resend}
        </button>
      </p>
    </form>
  );
}
