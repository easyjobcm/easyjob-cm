"use client";

import * as React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Zap, Star, Sparkles, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Bannière d'incitation Premium pour candidats standard.
 * Construite pour maximiser la conversion (loss aversion + social proof + micro-engagement).
 */
export function PremiumBanner() {
  const { t } = useI18n();
  const tr = t.profile.upgradePremium;

  const bullets = [
    { icon: Zap, label: tr.bullets.fastPayment },
    { icon: Star, label: tr.bullets.priority },
    { icon: Sparkles, label: tr.bullets.exclusive },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 220, damping: 24 }}
      className="relative overflow-hidden rounded-[20px] border border-[#7C3AED]/20 bg-white shadow-sm dark:border-white/10 dark:bg-[#1A0F2E]"
    >
      {/* Halo doré subtil en fond pour effet "premium" */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: "#7C3AED44" }}
        animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: "#F59E0B33" }}
        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.15, 1] }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />

      <div className="relative z-10 p-5">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#7C3AED]">
              {tr.title}
            </p>
            <h3 className="mt-1 text-lg font-bold leading-tight text-foreground">
              {tr.tagline}
            </h3>
          </div>
          <motion.div
            initial={{ rotate: -10 }}
            animate={{ rotate: [-10, 10, -10] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
              boxShadow: "0 8px 24px #7C3AED55",
            }}
          >
            <Sparkles className="h-6 w-6 text-white" />
          </motion.div>
        </div>

        {/* Bullets */}
        <ul className="mb-4 space-y-2">
          {bullets.map((b, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.08 }}
              className="flex items-center gap-2.5 text-sm text-foreground/80"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/10">
                <b.icon className="h-3.5 w-3.5 text-[#7C3AED]" />
              </div>
              <span className="font-medium">{b.label}</span>
            </motion.li>
          ))}
        </ul>

        {/* Prix */}
        <div className="mb-4 flex items-baseline gap-1.5">
          <span className="text-3xl font-extrabold text-[#5B21B6]">
            {tr.price}
          </span>
          <span className="text-sm text-muted-foreground">
            {tr.pricePeriod}
          </span>
        </div>

        {/* CTA */}
        <Link href="/upgrade/candidate" className="block">
          <motion.div
            whileTap={{ scale: 0.98 }}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#5B21B6] font-bold text-white shadow-lg shadow-[#7C3AED]/40"
          >
            <span>{tr.ctaPrimary}</span>
            <ArrowRight className="h-4 w-4" />
          </motion.div>
        </Link>

        {/* Micro-engagement (réduit le frein) */}
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
          {tr.microCommitment}
        </p>

        {/* Social proof */}
        <p className="mt-1 text-center text-[11px] font-medium text-[#7C3AED]/80">
          {tr.socialProof}
        </p>
      </div>
    </motion.div>
  );
}
