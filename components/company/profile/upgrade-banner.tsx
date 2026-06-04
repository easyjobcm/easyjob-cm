"use client";

import * as React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Rocket,
  Crown,
  Building2,
  Sparkles,
  Zap,
  Gift,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { type CompanyPlan } from "@/lib/utils/profile-status";

interface UpgradeBannerProps {
  currentPlan?: CompanyPlan;
  /** Passer true si l'entreprise a déjà utilisé son essai gratuit */
  hasUsedTrial?: boolean;
}

const PLAN_CONFIG: Record<
  "starter" | "pro" | "business",
  {
    icon: typeof Rocket;
    color: string;
    shimmer: boolean;
    shimmerRgba: string;
    trial: boolean;
    recommended: boolean;
  }
> = {
  starter: {
    icon: Rocket,
    color: "#2563EB",
    shimmer: false,
    shimmerRgba: "rgba(37,99,235,0.15)",
    trial: false,
    recommended: false,
  },
  pro: {
    icon: Crown,
    color: "#7C3AED",
    shimmer: true,
    shimmerRgba: "rgba(167,139,250,0.15)",
    trial: true,
    recommended: true,
  },
  business: {
    icon: Building2,
    color: "#D97706",
    shimmer: true,
    shimmerRgba: "rgba(251,191,36,0.15)",
    trial: true,
    recommended: false,
  },
};

/** Étoiles scintillantes décoratives */
function Sparkle({
  x,
  y,
  size,
  delay,
}: {
  x: string;
  y: string;
  size: number;
  delay: number;
}) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: x, top: y }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0.6, 1.2, 0.6],
        rotate: [0, 20, 0],
      }}
      transition={{ duration: 2.4, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      <Sparkles style={{ width: size, height: size, color: "#A78BFA" }} />
    </motion.div>
  );
}

/**
 * Bannière d'upgrade scintillante — affichée pour free et starter.
 * Met le plan Pro en avant avec badge "Recommandé" + essai gratuit 7 jours.
 */
export function UpgradeBanner({
  currentPlan = "free",
  hasUsedTrial = false,
}: UpgradeBannerProps) {
  const { t } = useI18n();
  const tr = t.profile.upgradeBanner;

  const ORDER: CompanyPlan[] = ["free", "starter", "pro", "business"];
  const visibleKeys = (["starter", "pro", "business"] as const).filter(
    (k) => ORDER.indexOf(k) > ORDER.indexOf(currentPlan),
  );

  // CTA principal → essai Pro si pas encore utilisé
  const showTrial = !hasUsedTrial;
  const primaryHref = showTrial
    ? "/upgrade/company?plan=pro&trial=true"
    : "/upgrade/company";
  const primaryLabel = showTrial ? tr.ctaTrial : tr.cta;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 22 }}
      className="relative overflow-hidden rounded-[20px] border border-[#7C3AED]/30 bg-[#0F0720] p-5 shadow-xl"
    >
      {/* ── Fond dégradé ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse at 80% 0%, #3B0764 0%, transparent 60%), radial-gradient(ellipse at 10% 100%, #1E3A8A 0%, transparent 55%)",
        }}
      />

      {/* ── Halos animés ── */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: "#7C3AED55" }}
        animate={{ opacity: [0.5, 0.9, 0.5], scale: [1, 1.15, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full blur-3xl"
        style={{ background: "#D9770633" }}
        animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.2, 1] }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />

      {/* ── Étoiles scintillantes ── */}
      <Sparkle x="72%" y="8%" size={14} delay={0} />
      <Sparkle x="85%" y="40%" size={10} delay={0.8} />
      <Sparkle x="5%" y="60%" size={12} delay={1.4} />
      <Sparkle x="55%" y="82%" size={9} delay={0.4} />

      {/* ── Contenu ── */}
      <div className="relative z-10">
        {/* Label section */}
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-[#A78BFA]" />
          <p className="text-[10px] font-bold uppercase tracking-[1.6px] text-[#A78BFA]">
            {tr.title}
          </p>
        </div>

        {/* Headline */}
        <h3 className="mt-2 text-[17px] font-extrabold leading-snug text-white">
          {currentPlan === "starter" ? tr.taglineStarter : tr.tagline}
        </h3>

        {/* Plans */}
        <ul className="mt-4 space-y-2">
          {visibleKeys.map((key, i) => {
            const cfg = PLAN_CONFIG[key];
            const isHighlight = cfg.shimmer || cfg.trial;
            return (
              <motion.li
                key={key}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.09 }}
                className="relative overflow-hidden rounded-2xl px-3 py-2.5"
                style={{
                  background: isHighlight
                    ? `linear-gradient(135deg, ${cfg.color}22 0%, ${cfg.color}0A 100%)`
                    : "rgba(255,255,255,0.05)",
                  border: isHighlight
                    ? `1px solid ${cfg.color}50`
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {/* Shimmer sur Pro/Business */}
                {isHighlight && (
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl"
                    style={{
                      background: `linear-gradient(90deg, transparent 0%, ${cfg.shimmerRgba} 50%, transparent 100%)`,
                    }}
                    animate={{ x: ["-100%", "200%"] }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      ease: "linear",
                      repeatDelay: 1.5,
                    }}
                  />
                )}

                <div className="relative flex items-start gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${cfg.color}25` }}
                  >
                    <cfg.icon
                      className="h-4 w-4"
                      style={{ color: cfg.color }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[13px] font-bold"
                        style={{ color: isHighlight ? cfg.color : "#E2E8F0" }}
                      >
                        {tr[key as "starter" | "pro" | "business"]}
                      </span>
                      {cfg.recommended && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                          style={{
                            background: `${cfg.color}30`,
                            color: cfg.color,
                          }}
                        >
                          {tr.recommended}
                        </span>
                      )}
                      {cfg.trial && showTrial && (
                        <motion.span
                          animate={{ scale: [1, 1.06, 1] }}
                          transition={{
                            duration: 1.8,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                          className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400"
                        >
                          <Gift className="h-2.5 w-2.5" />
                          {tr.trialBadge}
                        </motion.span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">
                      {
                        tr[
                          `${key}Kicker` as
                            | "starterKicker"
                            | "proKicker"
                            | "businessKicker"
                        ]
                      }
                    </p>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>

        {/* CTA primaire */}
        <Link href={primaryHref} className="mt-5 block">
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-full font-bold text-white"
            style={{
              background:
                "linear-gradient(135deg, #5B21B6 0%, #7C3AED 50%, #A855F7 100%)",
              boxShadow: "0 8px 24px #7C3AED55, 0 0 0 1px #A78BFA33",
            }}
          >
            {/* Shimmer sur le bouton */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
              }}
              animate={{ x: ["-100%", "200%"] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear",
                repeatDelay: 2,
              }}
            />
            <Sparkles className="h-4 w-4" />
            <span>{primaryLabel}</span>
            <ArrowRight className="h-4 w-4" />
          </motion.div>
        </Link>

        {/* Lien secondaire Business si free */}
        {currentPlan === "free" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-3 text-center"
          >
            <Link
              href="/upgrade/company?plan=business"
              className="text-[11px] text-white/40 underline-offset-2 transition-colors hover:text-white/70 hover:underline"
            >
              {tr.businessCta} →
            </Link>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
