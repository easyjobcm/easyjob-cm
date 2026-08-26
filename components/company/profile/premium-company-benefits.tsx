"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Infinity as InfinityIcon,
  Percent,
  Zap,
  ShieldCheck,
  History,
  TrendingDown,
  Eye,
  Headphones,
  Sparkles,
  Heart,
  UserPlus,
  FileText,
  BarChart3,
  FileOutput,
  Crown,
  RefreshCw,
  Users,
  Star,
  Bell,
  Activity,
  ScrollText,
  LineChart,
  PhoneCall,
  Clock,
  Rocket,
  AlertTriangle,
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
  | "jobsUnlimited"
  | "serviceFee10"
  | "urgentPaid"
  | "securePayment"
  | "historyAccess"
  | "reducedFee"
  | "urgentReduced"
  | "visibility"
  | "standardSupport"
  | "zeroFee"
  | "freeUrgent"
  | "aiMatch"
  | "favorites"
  | "directInvite"
  | "templates"
  | "monthlyReport"
  | "pdfExport"
  | "directEdit"
  | "trialFree"
  | "guaranteedReplacement"
  | "bulkHiring"
  | "priorityInvite"
  | "availabilityAlerts"
  | "presenceDashboard"
  | "sectorContracts"
  | "advancedReporting"
  | "dedicatedManager"
  | "prioritySLA"
  | "immediateModeration";

const BENEFIT_ICONS: Record<BenefitKey, LucideIcon> = {
  jobsUnlimited: InfinityIcon,
  serviceFee10: Percent,
  urgentPaid: Zap,
  securePayment: ShieldCheck,
  historyAccess: History,
  reducedFee: TrendingDown,
  urgentReduced: Zap,
  visibility: Eye,
  standardSupport: Headphones,
  zeroFee: Sparkles,
  freeUrgent: Zap,
  aiMatch: Sparkles,
  favorites: Heart,
  directInvite: UserPlus,
  templates: FileText,
  monthlyReport: BarChart3,
  pdfExport: FileOutput,
  directEdit: Crown,
  trialFree: Rocket,
  guaranteedReplacement: RefreshCw,
  bulkHiring: Users,
  priorityInvite: Star,
  availabilityAlerts: Bell,
  presenceDashboard: Activity,
  sectorContracts: ScrollText,
  advancedReporting: LineChart,
  dedicatedManager: PhoneCall,
  prioritySLA: Clock,
  immediateModeration: Rocket,
};

const PLAN_THEME: Record<CompanyPlan, { accent: string }> = {
  free: { accent: "#6B7280" },
  starter: { accent: "#2563EB" },
  pro: { accent: "#7C3AED" },
  business: { accent: "#D97706" },
};

const BENEFITS_BY_PLAN: Record<CompanyPlan, BenefitKey[]> = {
  free: [
    "jobsUnlimited",
    "serviceFee10",
    "urgentPaid",
    "securePayment",
    "historyAccess",
  ],
  starter: ["reducedFee", "urgentReduced", "visibility", "standardSupport"],
  pro: [
    "zeroFee",
    "freeUrgent",
    "aiMatch",
    "favorites",
    "directInvite",
    "templates",
    "monthlyReport",
    "pdfExport",
    "directEdit",
    "trialFree",
  ],
  business: [
    "guaranteedReplacement",
    "bulkHiring",
    "priorityInvite",
    "availabilityAlerts",
    "presenceDashboard",
    "sectorContracts",
    "advancedReporting",
    "dedicatedManager",
    "prioritySLA",
    "immediateModeration",
  ],
};

/**
 * "Mes avantages" — affiché pour TOUS les plans (free/starter/pro/business).
 * Contenu et couleurs adaptés au plan effectif (SRS v1.2).
 */
export function PremiumCompanyBenefits({
  plan,
  limits: _limits,
  expiresAt,
  locale = "fr",
}: PremiumCompanyBenefitsProps) {
  const { t } = useI18n();
  const tr = t.profile.premiumCompanyBenefits;
  const planTr = t.profile.plan;
  const accent = PLAN_THEME[plan].accent;

  const keys = BENEFITS_BY_PLAN[plan];
  const benefits = keys.map((key) => {
    const item = (
      tr as unknown as Record<string, { title: string; desc: string }>
    )[key];
    return {
      key,
      Icon: BENEFIT_ICONS[key],
      title: item?.title ?? key,
      desc: item?.desc ?? "",
    };
  });

  const planLabel =
    plan === "business"
      ? planTr.business
      : plan === "pro"
        ? planTr.pro
        : plan === "starter"
          ? planTr.starter
          : planTr.free;

  const nextPlan: CompanyPlan | null =
    plan === "free"
      ? "starter"
      : plan === "starter"
        ? "pro"
        : plan === "pro"
          ? "business"
          : null;

  const penaltyKey: "freeStarter" | "pro" | "business" =
    plan === "free" || plan === "starter"
      ? "freeStarter"
      : (plan as "pro" | "business");
  const penaltyText = tr.cancellationPenalty[penaltyKey];

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
        {plan !== "free" && (
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
        )}

        <CardContent className="relative z-10 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3
              className="text-[11px] font-semibold uppercase tracking-[1.2px]"
              style={{ color: accent }}
            >
              {tr.sectionTitle} {planLabel}
            </h3>
            {expiresAt && plan !== "free" && (
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

          <ul className="space-y-3">
            {benefits.map((b, i) => (
              <motion.li
                key={b.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
                className="flex items-start gap-3"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${accent}1A` }}
                >
                  <b.Icon className="h-4 w-4" style={{ color: accent }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {b.title}
                  </p>
                  {b.desc && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {b.desc}
                    </p>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>

          <div
            className="mt-4 flex items-start gap-2 rounded-xl border p-3"
            style={{ borderColor: `${accent}25`, background: `${accent}08` }}
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: accent }}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">
                {tr.cancellationPenalty.label}
              </span>{" "}
              {penaltyText}
            </p>
          </div>

          {nextPlan && (
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
                      planTr[nextPlan],
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
