"use client";

import { motion } from "framer-motion";
import { Info } from "lucide-react";

/**
 * Bannière visible uniquement en développement local.
 * Rappelle les numéros + OTP de test configurés dans supabase/config.toml
 * (section [auth.sms.test_otp]).
 *
 * En production (NODE_ENV=production), le composant retourne null.
 */
export function DevPhoneHint() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">Mode dev — aucun SMS envoyé</p>
        <p>
          Utilise <span className="font-mono">600 000 000</span> ou{" "}
          <span className="font-mono">699 999 999</span> · OTP{" "}
          <span className="font-mono">123456</span>
        </p>
      </div>
    </motion.div>
  );
}
