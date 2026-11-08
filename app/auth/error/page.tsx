"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, LogIn, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Destination des échecs du retour OAuth (`/auth/callback`, F-13). Aucun
 * détail du fournisseur n'est affiché : seulement une action pour reprendre.
 */
export default function AuthErrorPage() {
  const { t } = useI18n();
  const e = t.auth.oauthError;

  return (
    <div className="relative min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618] flex flex-col items-center justify-center px-4 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#7C3AED]/10 blur-3xl"
      />
      <div className="absolute top-0 left-0 right-0 flex items-center justify-end gap-2 px-4 pt-safe-top py-4">
        <LangSwitch variant="light" />
        <ThemeToggle variant="light" />
      </div>

      <motion.main
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md z-10 space-y-6 text-center pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#7C3AED]/10 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-[#7C3AED]" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#1A0A2E] dark:text-white">
            {e.title}
          </h1>
          <p className="text-sm text-gray-600 dark:text-white/70">
            {e.description}
          </p>
        </div>

        <div className="space-y-3">
          <motion.div whileTap={{ scale: 0.98 }}>
            <Link
              href="/auth/login"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#7C3AED] text-sm font-semibold text-white shadow-sm hover:bg-[#6D28D9]"
            >
              <LogIn className="w-4 h-4" aria-hidden />
              {e.retry}
            </Link>
          </motion.div>
          <motion.div whileTap={{ scale: 0.98 }}>
            <Link
              href="/auth/signup"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#7C3AED]/30 text-sm font-semibold text-[#7C3AED]"
            >
              <UserPlus className="w-4 h-4" aria-hidden />
              {e.signup}
            </Link>
          </motion.div>
          <Link
            href="/"
            className="inline-block text-sm text-gray-500 dark:text-white/60 underline"
          >
            {e.home}
          </Link>
        </div>
      </motion.main>
    </div>
  );
}
