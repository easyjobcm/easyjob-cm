"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Check, X, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import {
  type CompanyPlan,
  type PlanLimits,
  formatDateShort,
} from "@/lib/utils/profile-status";

interface PlanFeaturesProps {
  plan: CompanyPlan;
  limits: PlanLimits;
  expiresAt: string | null;
  locale?: "fr" | "en";
}

/**
 * Liste détaillée des fonctionnalités du plan actuel + date d'expiration.
 */
export function PlanFeatures({
  plan,
  limits,
  expiresAt,
  locale = "fr",
}: PlanFeaturesProps) {
  const { t } = useI18n();
  const tr = t.profile.plan;

  const jobsLabel = (() => {
    switch (plan) {
      case "starter":
        return tr.features.jobsLimitStarter;
      case "pro":
        return tr.features.jobsLimitPro;
      case "business":
        return tr.features.jobsLimitBusiness;
      default:
        return tr.features.jobsLimitFree;
    }
  })();

  const items: Array<{ on: boolean; label: string }> = [
    { on: true, label: jobsLabel },
    {
      on: limits.urgentIncluded,
      label: limits.urgentIncluded
        ? tr.features.urgentFree
        : tr.features.urgentPaid,
    },
    {
      on: limits.aiRecommendations,
      label: limits.aiRecommendations
        ? tr.features.aiRecoOn
        : tr.features.aiRecoOff,
    },
    {
      on: limits.reporting !== "none",
      label:
        limits.reporting === "advanced"
          ? tr.features.reportingAdvanced
          : limits.reporting === "basic"
            ? tr.features.reportingBasic
            : tr.features.reportingOff,
    },
    {
      on: limits.directEdit,
      label: limits.directEdit ? tr.features.editOn : tr.features.editOff,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
    >
      <Card
        className={`relative overflow-hidden border bg-linear-to-br ${limits.gradient} dark:border-white/10 dark:from-[#1A0F2E] dark:to-[#2A1158]`}
        style={{ borderColor: `${limits.accent}33` }}
      >
        <CardContent className="relative z-10 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {tr.features.title}
            </h3>
            {expiresAt && (
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{
                  background: `${limits.accent}1A`,
                  color: limits.accent,
                }}
              >
                {tr.expiresOn.replace(
                  "{date}",
                  formatDateShort(expiresAt, locale),
                )}
              </span>
            )}
          </div>

          <ul className="space-y-2">
            {items.map((it, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.06 }}
                className="flex items-start gap-2.5 text-sm"
              >
                <div
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: it.on
                      ? `${limits.accent}26`
                      : "rgba(107,114,128,0.15)",
                  }}
                >
                  {it.on ? (
                    <Check
                      className="h-3 w-3"
                      style={{ color: limits.accent }}
                    />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <span
                  className={
                    it.on
                      ? "font-medium text-foreground"
                      : "text-muted-foreground line-through decoration-1"
                  }
                >
                  {it.label}
                </span>
              </motion.li>
            ))}
          </ul>

          {limits.prioritySupport && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-4 flex items-center gap-2 rounded-xl bg-white/60 p-2.5 dark:bg-white/5"
            >
              <ShieldCheck
                className="h-4 w-4"
                style={{ color: limits.accent }}
              />
              <span
                className="text-xs font-semibold"
                style={{ color: limits.accent }}
              >
                {tr.prioritySupport}
              </span>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
