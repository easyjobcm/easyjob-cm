"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Crown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { doualaFullDateTime } from "@/lib/utils/douala-time";
import type { CandidatePlanView } from "@/hooks/use-candidate-plan";

interface CandidatePlanCardProps {
  view: CandidatePlanView;
  /** Lien vers /upgrade/candidate (profil) ; absent sur cette page. */
  linkToDetails?: boolean;
  /** Mentions détaillées (page « Mon plan »). */
  detailed?: boolean;
}

/**
 * Lot 17a — plan effectif (Free ou Premium) et date de fin, en heure de
 * Douala. Premium est une attribution de l'équipe : aucun prix, aucun
 * avantage non livré n'est annoncé.
 */
export function CandidatePlanCard({
  view,
  linkToDetails = false,
  detailed = false,
}: CandidatePlanCardProps) {
  const { t, locale } = useI18n();
  const tp = t.profile.candidatePlan;
  const reduce = useReducedMotion();
  const premium = view.plan === "premium";
  const planLabel = premium ? tp.premium : tp.free;

  const content = (
    <Card
      className={
        premium ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      }
      data-testid="candidate-plan-card"
      data-plan={view.plan}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            premium ? "bg-primary text-white" : "bg-muted text-muted-foreground"
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
            data-testid="candidate-plan-label"
          >
            {tp.current.replace("{plan}", planLabel)}
          </p>
          {premium && view.premiumUntil && (
            <p
              className="text-sm text-foreground/80"
              data-testid="candidate-plan-until"
            >
              {tp.until.replace(
                "{date}",
                doualaFullDateTime(view.premiumUntil, locale),
              )}
            </p>
          )}
          {premium && detailed && view.premiumStartedAt && (
            <p className="text-xs text-muted-foreground">
              {tp.since.replace(
                "{date}",
                doualaFullDateTime(view.premiumStartedAt, locale),
              )}
            </p>
          )}
          {!premium && detailed && view.premiumUntil && (
            <p className="text-xs text-muted-foreground">
              {tp.ended.replace(
                "{date}",
                doualaFullDateTime(view.premiumUntil, locale),
              )}
            </p>
          )}
          {detailed && (
            <>
              <p className="pt-1 text-xs text-muted-foreground">{tp.granted}</p>
              <p className="text-xs text-muted-foreground">{tp.sameRules}</p>
            </>
          )}
        </div>
        {linkToDetails && (
          <ChevronRight
            className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
      </CardContent>
    </Card>
  );

  const animated = (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      whileTap={linkToDetails && !reduce ? { scale: 0.98 } : undefined}
    >
      {content}
    </motion.div>
  );

  return linkToDetails ? (
    <Link href="/upgrade/candidate" className="block">
      {animated}
    </Link>
  ) : (
    animated
  );
}
