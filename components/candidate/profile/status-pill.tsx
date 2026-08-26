"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";

interface StatusPillProps {
  label: string;
  Icon: LucideIcon;
  /** Couleur de fond légère + texte. */
  variant: "neutral" | "blue" | "premium" | "gold";
}

const VARIANTS = {
  neutral: {
    bg: "bg-[#F3F4F6] dark:bg-white/5",
    text: "text-[#374151] dark:text-white/80",
    iconColor: "#6B7280",
  },
  blue: {
    bg: "bg-[#EFF6FF] dark:bg-blue-500/10",
    text: "text-[#1D4ED8] dark:text-blue-300",
    iconColor: "#1D4ED8",
  },
  premium: {
    bg: "bg-[#F5F3FF] dark:bg-[#7C3AED]/15",
    text: "text-[#5B21B6] dark:text-[#C4B5FD]",
    iconColor: "#7C3AED",
  },
  gold: {
    bg: "bg-[#FEF3C7] dark:bg-amber-500/15",
    text: "text-[#92400E] dark:text-amber-300",
    iconColor: "#D97706",
  },
} as const;

export function StatusPill({ label, Icon, variant }: StatusPillProps) {
  const v = VARIANTS[variant];
  return (
    <motion.span
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${v.bg} ${v.text}`}
    >
      <Icon className="h-3 w-3" style={{ color: v.iconColor }} />
      {label}
    </motion.span>
  );
}
