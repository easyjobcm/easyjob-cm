"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";

interface PremiumBadgeProps {
  label: string;
  /** Couleur du halo lumineux. */
  color?: string;
  /** Taille texte : sm = pill compacte, md = pill standard. */
  size?: "sm" | "md";
}

/**
 * Badge "Premium" animé avec un shimmer lent + glow violet.
 * Utilisé pour signaler visuellement les statuts payants (candidate_premium).
 */
export function PremiumBadge({
  label,
  color = "#7C3AED",
  size = "md",
}: PremiumBadgeProps) {
  const isSm = size === "sm";
  return (
    <motion.div
      className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full font-semibold text-white"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, #5B21B6 100%)`,
        padding: isSm ? "4px 10px" : "6px 14px",
        fontSize: isSm ? 11 : 12,
        boxShadow: `0 4px 16px ${color}66, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Shimmer balayage */}
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
          repeatDelay: 1.6,
          ease: "easeInOut",
        }}
      />
      <Crown className={isSm ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span className="relative z-10 uppercase tracking-wide">{label}</span>
    </motion.div>
  );
}
