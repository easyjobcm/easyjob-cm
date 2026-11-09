"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Award } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { formatDate } from "@/lib/utils";
import {
  computeProgress,
  formatStars,
  formatStarsNumber,
  type CategoryAction,
  type CategoryProgress,
} from "@/lib/reputation/progress";
import { ReputationStars } from "./reputation-stars";
import { useMyReputation } from "./use-my-reputation";

/** Rappel d'échéance affiché à J−30, comme les notifications. */
const EXPIRY_NOTICE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Progression privée vers le prochain palier (lot 9c) : visible par le seul
 * titulaire. Les tiers ne voient que les étoiles.
 */
export function ReputationProgressCard() {
  const { t, locale } = useI18n();
  const tp = t.reputation.progress;
  const reduce = useReducedMotion();
  const { data, error } = useMyReputation();

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {tp.loadError}
      </p>
    );
  }
  if (!data) return null;

  const progress = computeProgress(data);
  const starsText = (value: number) =>
    formatStars(value, locale, t.reputation.stars);

  const actionText = (action: CategoryAction | null): string => {
    if (!action) return tp.actions.done;
    switch (action.kind) {
      case "missions":
        return plural(action.count, tp.actions.missions, locale);
      case "offers":
        return plural(action.count, tp.actions.offers, locale);
      case "reviews":
        return plural(action.count, tp.actions.reviews, locale);
      case "profile":
        return action.target === 50
          ? tp.actions.profile50
          : tp.actions.profile100;
      case "skills":
        return tp.actions.skills;
    }
  };

  const categoryName = (c: CategoryProgress): string => {
    if (c.key === "experience") {
      return data.subject_type === "company"
        ? tp.categories.experienceCompany
        : tp.categories.experience;
    }
    return tp.categories[c.key];
  };

  const primary = progress.primary;
  const breaches = data.experience.breaches;

  return (
    <Card
      id="reputation"
      className="scroll-mt-20"
      data-testid="reputation-progress"
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Award className="h-4 w-4 shrink-0 text-[#7C3AED]" aria-hidden />
              {tp.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.subject_type === "candidate"
                ? tp.candidateNote
                : tp.companyNote}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ReputationStars
              stars={data.stars}
              size="md"
              testId="my-reputation-stars"
            />
            <span
              className="text-xs font-semibold"
              data-testid="my-reputation-value"
            >
              {starsText(data.stars)}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium" data-testid="reputation-next-tier">
            {progress.nextTier === null
              ? tp.maxTier
              : tp.nextTier.replace("{stars}", starsText(progress.nextTier))}
          </p>
          {progress.nextTier !== null && primary && (
            <>
              <div
                role="progressbar"
                aria-label={tp.barLabel.replace(
                  "{stars}",
                  starsText(progress.nextTier),
                )}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(primary.progress * 100)}
                className="h-2.5 w-full overflow-hidden rounded-full bg-[#7C3AED]/15"
              >
                <motion.div
                  className="h-full rounded-full bg-[#7C3AED]"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.max(4, primary.progress * 100)}%` }}
                  transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
                />
              </div>
              <p
                className="text-sm text-[#7C3AED]"
                data-testid="reputation-primary-action"
              >
                {actionText(primary.action)}
              </p>
            </>
          )}
        </div>

        <ul className="space-y-3" aria-label={tp.title}>
          {progress.categories.map((c) => (
            <li key={c.key} data-testid={`reputation-category-${c.key}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 font-medium">{categoryName(c)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tp.categoryValue
                    .replace("{stars}", formatStarsNumber(c.stars, locale))
                    .replace("{max}", formatStarsNumber(c.max, locale))}
                </span>
              </div>
              <div
                aria-hidden
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-[#A78BFA]"
                  style={{
                    width: `${Math.min(100, (c.stars / c.max) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {actionText(c.action)}
              </p>
            </li>
          ))}
        </ul>

        {breaches > 0 && (
          <p className="text-xs text-muted-foreground">
            {plural(
              breaches,
              data.subject_type === "company"
                ? tp.companyBreaches
                : tp.breaches,
              locale,
            )}
          </p>
        )}

        {data.next_expiry_at &&
          Date.parse(data.next_expiry_at) - Date.parse(data.server_now) <=
            EXPIRY_NOTICE_MS && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              {tp.expiry.replace(
                "{date}",
                formatDate(data.next_expiry_at, locale),
              )}
            </p>
          )}
      </CardContent>
    </Card>
  );
}
