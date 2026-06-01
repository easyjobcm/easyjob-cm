"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/hooks/use-theme";
import { useI18n } from "@/lib/i18n";

type ThemeToggleVariant = "light" | "dark-translucent" | "dark-muted";

interface ThemeToggleProps {
  className?: string;
  variant?: ThemeToggleVariant;
}

const variantClasses: Record<ThemeToggleVariant, string> = {
  light:
    "border-[#E5E7EB] bg-white/80 text-[#6B7280] backdrop-blur hover:border-[#7C3AED] hover:text-[#7C3AED]",
  "dark-translucent":
    "border-white/10 text-white/60 hover:border-white/30 hover:text-white",
  "dark-muted":
    "border-white/[0.07] text-white/30 hover:border-white/[0.12] hover:text-white/55",
};

export function ThemeToggle({
  className = "",
  variant = "light",
}: ThemeToggleProps) {
  const { theme, toggleTheme, mounted } = useTheme();
  const { t } = useI18n();
  // isDark is false during SSR/first hydration (mounted=false from ThemeProvider).
  // After mount it reflects the real stored theme.
  const isDark = mounted && theme === "dark";

  const label = isDark ? t.landing.theme.lightMode : t.landing.theme.darkMode;

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${variantClasses[variant]} ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "sun" : "moon"}
          initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="inline-flex"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
