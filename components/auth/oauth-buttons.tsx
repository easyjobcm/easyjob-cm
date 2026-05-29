"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

interface OAuthButtonsProps {
  /** Rôle à attacher comme metadata + utilisé pour la redirection post-callback. */
  role: "candidate" | "company";
  /** Texte du bouton Google traduit. */
  googleLabel: string;
  /** Label "Ou continuer avec" traduit (centré au-dessus). */
  dividerLabel: string;
  disabled?: boolean;
}

export function OAuthButtons({
  role,
  googleLabel,
  dividerLabel,
  disabled,
}: OAuthButtonsProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Affiché par défaut. Pour masquer (ex. provider non configuré côté Supabase),
  // mettre NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false dans .env.local.
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "false";
  if (!googleEnabled) return null;

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const next =
        role === "candidate"
          ? "/auth/signup/candidate?step=phone"
          : "/auth/signup/company?step=phone";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#E5E7EB]" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {dividerLabel}
        </span>
        <div className="h-px flex-1 bg-[#E5E7EB]" />
      </div>

      <motion.button
        type="button"
        onClick={handleGoogle}
        disabled={disabled || loading}
        whileTap={{ scale: 0.98 }}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#E5E7EB] bg-white text-sm font-semibold text-[#1A0A2E] shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <GoogleIcon className="h-5 w-5" />
        )}
        {googleLabel}
      </motion.button>

      {error && (
        <p className="text-center text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.46c-.28 1.5-1.12 2.77-2.39 3.62v3.01h3.86c2.26-2.08 3.56-5.15 3.56-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.86-3c-1.07.72-2.45 1.16-4.08 1.16-3.13 0-5.79-2.11-6.74-4.96H1.27v3.11C3.25 21.31 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.26 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.6H1.27C.46 8.23 0 10.06 0 12s.46 3.77 1.27 5.4l3.99-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.27 6.6l3.99 3.11C6.21 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
