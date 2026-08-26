"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Crown, Briefcase, Rocket, Building2 } from "lucide-react";
import { type CompanyPlan } from "@/lib/utils/profile-status";

interface PlanBadgeProps {
  plan: CompanyPlan;
  label: string;
  size?: "sm" | "md";
}

const PLAN_THEME: Record<
  CompanyPlan,
  {
    from: string;
    to: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  free: { from: "#94A3B8", to: "#64748B", icon: Briefcase },
  starter: { from: "#3B82F6", to: "#1D4ED8", icon: Rocket },
  pro: { from: "#7C3AED", to: "#5B21B6", icon: Crown },
  business: { from: "#F59E0B", to: "#D97706", icon: Building2 },
};

/**
 * Badge plan entreprise — animé (shimmer) pour Starter/Pro/Business.
 */
export function PlanBadge({ plan, label, size = "md" }: PlanBadgeProps) {
  const theme = PLAN_THEME[plan];
  const Icon = theme.icon;
  const isSm = size === "sm";
  const animated = plan !== "free";

  return (
    <motion.div
      className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full font-semibold text-white"
      style={{
        background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`,
        padding: isSm ? "4px 10px" : "6px 14px",
        fontSize: isSm ? 11 : 12,
        boxShadow: `0 4px 16px ${theme.from}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      whileTap={{ scale: 0.95 }}
    >
      {animated && (
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
          }}
          animate={{ x: ["-120%", "120%"] }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            repeatDelay: 1.8,
            ease: "easeInOut",
          }}
        />
      )}
      <Icon className={isSm ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span className="relative z-10 uppercase tracking-wide">{label}</span>
    </motion.div>
  );
}
