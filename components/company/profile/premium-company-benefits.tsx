"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Settings2,
  Shield,
  Zap,
  Sparkles,
  Infinity as InfinityIcon,
  BarChart3,
  HeadphonesIcon,
  Users,
  Palette,
  Crown,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import {
  type CompanyPlan,
  type PlanLimits,
  formatDateShort,
} from "@/lib/utils/profile-status";

interface PremiumCompanyBenefitsProps {
  plan: CompanyPlan;
  limits: PlanLimits;
  expiresAt: string | null;
  locale?: "fr" | "en";
}

type BenefitKey =
  | "directEdit"
  | "verifiedCandidates"
  | "urgentBoost"
  | "aiMatch"
  | "unlimited"
  | "reporting"
  | "accountManager"
  | "multiUser"
  | "branding";

const BENEFIT_ICONS: Record<BenefitKey, LucideIcon> = {
  directEdit: Settings2,
  verifiedCandidates: Shield,
  urgentBoost: Zap,
  aiMatch: Sparkles,
  unlimited: InfinityIcon,
  reporting: BarChart3,
  accountManager: HeadphonesIcon,
  multiUser: Users,
  branding: Palette,
};

const BENEFIT_COLORS: Record<BenefitKey, string> = {
  directEdit: "#3B82F6",
  verifiedCandidates: "#10B981",
  urgentBoost: "#F59E0B",
  aiMatch: "#7C3AED",
  unlimited: "#3B82F6",
  reporting: "#6366F1",
  accountManager: "#D97706",
  multiUser: "#0EA5E9",
  branding: "#EC4899",
};

function benefitsForPlan(plan: CompanyPlan): BenefitKey[] {
  switch (plan) {
    case "starter":
      return ["directEdit", "verifiedCandidates", "urgentBoost"];
    case "pro":
      return ["aiMatch", "unlimited", "reporting"];
    case "business":
      return ["accountManager", "multiUser", "branding"];
    default:
      return [];
  }
}

/**
 * Bloc "Mes avantages" — affiché uniquement pour les entreprises premium.
 * Même style card que PremiumBenefits (candidat) : icône + titre + description.
 */
export function PremiumCompanyBenefits({
  plan,
  limits,
  expiresAt,
  locale = "fr",
}: PremiumCompanyBenefitsProps) {
  const { t } = useI18n();
  const tr = t.profile.premiumCompanyBenefits;
  const planTr = t.profile.plan;
  const accent = limits.accent;

  const keys = benefitsForPlan(plan);
  const benefits = keys.map((key) => ({
    key,
    Icon: BENEFIT_ICONS[key],
    color: BENEFIT_COLORS[key],
    title: tr[key].title,
    desc: tr[key].desc,
  }));

  // Libellé plan actuel
  const planLabel =
    plan === "business"
      ? planTr.business
      : plan === "pro"
        ? planTr.pro
        : planTr.starter;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <Card
        className="relative overflow-hidden border"
        style={{
          borderColor: `${accent}40`,
          background: `linear-gradient(135deg, ${accent}0A 0%, ${accent}05 60%, transparent 100%)`,
        }}
      >
        {/* Ornement Crown en fond — adapté à la couleur du plan */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-4"
          animate={{ rotate: [0, 8, -4, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Crown
            className="h-24 w-24 opacity-[0.07]"
            style={{ color: accent }}
          />
        </motion.div>

        <CardContent className="relative z-10 p-5">
          {/* En-tête : titre + date expiration */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3
              className="text-[11px] font-semibold uppercase tracking-[1.2px]"
              style={{ color: accent }}
            >
              {tr.sectionTitle} {planLabel}
            </h3>
            {expiresAt && (
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{ background: `${accent}15`, color: accent }}
              >
                {tr.expiresOn.replace(
                  "{date}",
                  formatDateShort(expiresAt, locale),
                )}
              </span>
            )}
          </div>

          {/* Liste des 3 avantages */}
          <ul className="space-y-3">
            {benefits.map((b, i) => (
              <motion.li
                key={b.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="flex items-start gap-3"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${b.color}1A` }}
                >
                  <b.Icon className="h-4 w-4" style={{ color: b.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {b.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {b.desc}
                  </p>
                </div>
              </motion.li>
            ))}
          </ul>

          {/* CTA upgrade si plan inférieur à Business */}
          {plan !== "business" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4 border-t pt-4"
              style={{ borderColor: `${accent}20` }}
            >
              <Link href="/upgrade/company">
                <motion.div
                  whileTap={{ scale: 0.98 }}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-white shadow"
                  style={{
                    background: `linear-gradient(135deg, ${accent} 0%, ${accent}CC 100%)`,
                    boxShadow: `0 6px 16px ${accent}44`,
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {t.profile.premiumCompany.upgradePlan.replace(
                      "{plan}",
                      plan === "starter" ? planTr.pro : planTr.business,
                    )}
                  </span>
                </motion.div>
              </Link>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
