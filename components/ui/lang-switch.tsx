"use client";

import { motion } from "framer-motion";
import { Globe } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type LangSwitchVariant = "light" | "dark-translucent" | "dark-muted";
type LangSwitchLabel = "code" | "name";

interface LangSwitchProps {
  className?: string;
  variant?: LangSwitchVariant;
  labelMode?: LangSwitchLabel;
}

const variantClasses: Record<LangSwitchVariant, string> = {
  light:
    "border-[#E5E7EB] bg-white/80 text-[#6B7280] backdrop-blur hover:border-[#7C3AED] hover:text-[#7C3AED]",
  "dark-translucent":
    "border-white/10 text-white/50 hover:border-[#7C3AED]/40 hover:text-white/80",
  "dark-muted":
    "border-white/[0.07] text-white/30 hover:border-white/[0.12] hover:text-white/55",
};

export function LangSwitch({
  className = "",
  variant = "light",
  labelMode = "code",
}: LangSwitchProps) {
  const { locale, setLocale, t } = useI18n();

  const label =
    labelMode === "name"
      ? locale === "fr"
        ? t.landing.language.french
        : t.landing.language.english
      : locale.toUpperCase();

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
      aria-label={locale === "fr" ? "Switch to English" : "Passer en français"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${variantClasses[variant]} ${className}`}
    >
      <Globe className="h-3 w-3" />
      {label}
    </motion.button>
  );
}
