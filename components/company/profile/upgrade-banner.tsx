"use client";

import * as React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Rocket, Crown, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Bannière d'incitation à l'upgrade — affichée uniquement aux entreprises standard.
 * Présente les 3 plans en aperçu pour amorcer la décision (effet d'ancrage).
 */
export function UpgradeBanner() {
  const { t } = useI18n();
  const tr = t.profile.upgradeBanner;

  const plans = [
    {
      icon: Rocket,
      label: tr.starter,
      color: "#3B82F6",
    },
    {
      icon: Crown,
      label: tr.pro,
      color: "#7C3AED",
    },
    {
      icon: Building2,
      label: tr.business,
      color: "#D97706",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 220, damping: 24 }}
      className="relative overflow-hidden rounded-[20px] border border-[#7C3AED]/20 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#1A0F2E]"
    >
      {/* Halos décoratifs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full blur-3xl"
        style={{ background: "#7C3AED44" }}
        animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -left-12 h-44 w-44 rounded-full blur-3xl"
        style={{ background: "#F59E0B33" }}
        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.15, 1] }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />

      <div className="relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#7C3AED]">
          {tr.title}
        </p>
        <h3 className="mt-1 text-lg font-bold leading-tight text-foreground">
          {tr.tagline}
        </h3>

        <ul className="mt-4 space-y-2">
          {plans.map((p, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.08 }}
              className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2 text-sm font-medium text-foreground"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${p.color}1A` }}
              >
                <p.icon className="h-4 w-4" style={{ color: p.color }} />
              </div>
              <span className="text-[13px]">{p.label}</span>
            </motion.li>
          ))}
        </ul>

        <Link href="/upgrade/company" className="mt-4 block">
          <motion.div
            whileTap={{ scale: 0.98 }}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#5B21B6] font-bold text-white shadow-lg shadow-[#7C3AED]/40"
          >
            <span>{tr.cta}</span>
            <ArrowRight className="h-4 w-4" />
          </motion.div>
        </Link>
      </div>
    </motion.div>
  );
}
