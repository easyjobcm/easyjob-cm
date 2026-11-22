"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crown, PencilLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { doualaFullDateTime } from "@/lib/utils/douala-time";
import {
  companyCanDirectEdit,
  type CompanyPlan,
} from "@/lib/utils/company-plan";
import { supportMailto } from "@/lib/support";

interface CompanyPlanCardProps {
  plan: CompanyPlan;
  /** Fin de la période en cours (Premium) ou dernière fin connue (Free). */
  premiumUntil: string | null;
  /** Début de la période en cours ; null si inconnu ou Free. */
  premiumStartedAt: string | null;
}

/**
 * ABO-07 — plan entreprise effectif (Free ou Premium), date de fin en heure
 * de Douala, « attribué par l'équipe EasyJob ». Seule la fonction liée au
 * plan réellement disponible est décrite (ABO-08) ; aucun prix ni avantage
 * non livré.
 */
export function CompanyPlanCard({
  plan,
  premiumUntil,
  premiumStartedAt,
}: CompanyPlanCardProps) {
  const { t, locale } = useI18n();
  const tp = t.profile.companyPlan;
  const reduce = useReducedMotion();
  const premium = plan === "premium";
  const planLabel = premium ? tp.premium : tp.free;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <Card
        className={
          premium ? "border-primary/40 bg-primary/5" : "border-border bg-card"
        }
        data-testid="company-plan-card"
        data-plan={plan}
      >
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                premium
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Crown className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-primary">
                {tp.title}
              </p>
              <p
                className="text-base font-semibold text-foreground"
                data-testid="company-plan-label"
              >
                {tp.current.replace("{plan}", planLabel)}
              </p>
              {premium && premiumUntil && (
                <p
                  className="text-sm text-foreground/80"
                  data-testid="company-plan-until"
                >
                  {tp.until.replace(
                    "{date}",
                    doualaFullDateTime(premiumUntil, locale),
                  )}
                </p>
              )}
              {premium && premiumStartedAt && (
                <p className="text-xs text-muted-foreground">
                  {tp.since.replace(
                    "{date}",
                    doualaFullDateTime(premiumStartedAt, locale),
                  )}
                </p>
              )}
              {!premium && premiumUntil && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="company-plan-ended"
                >
                  {tp.ended.replace(
                    "{date}",
                    doualaFullDateTime(premiumUntil, locale),
                  )}
                </p>
              )}
              <p className="pt-1 text-xs text-muted-foreground">{tp.granted}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
            <PencilLine
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <p
              className="text-xs text-foreground/80"
              data-testid="company-plan-edit"
            >
              {companyCanDirectEdit(plan) ? tp.directEditOn : tp.directEditOff}
            </p>
          </div>
          <a
            href={supportMailto(tp.title)}
            className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {tp.contactSupport}
          </a>
        </CardContent>
      </Card>
    </motion.div>
  );
}
