"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  CheckCircle2,
  Circle,
  Clock,
  FileWarning,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { doualaDateTime } from "@/lib/utils/douala-time";
import {
  companyReviewState,
  type CompanyReviewState,
  type MyCompanyVerification,
} from "@/lib/utils/company-verification";
import { COMPANY_CHECKS } from "@/lib/validations/company";

const STYLE: Record<
  CompanyReviewState,
  { icon: LucideIcon; tone: string; iconTone: string }
> = {
  incomplete: {
    icon: FileWarning,
    tone: "border-warning/40 bg-warning/5",
    iconTone: "text-warning",
  },
  in_review: {
    icon: Clock,
    tone: "border-primary/30 bg-primary/5",
    iconTone: "text-primary",
  },
  correction: {
    icon: FileWarning,
    tone: "border-destructive/40 bg-destructive/5",
    iconTone: "text-destructive",
  },
  verified: {
    icon: BadgeCheck,
    tone: "border-success/40 bg-success/5",
    iconTone: "text-success",
  },
};

const CHECK_ICON = {
  approved: { icon: CheckCircle2, tone: "text-success" },
  rejected: { icon: XCircle, tone: "text-destructive" },
  pending: { icon: Circle, tone: "text-muted-foreground" },
} as const;

/**
 * État du dossier entreprise (lot 11) : état global, contrôle par contrôle
 * (RCCM, NIU, représentant) avec motif de refus, pièces manquantes et action
 * possible. `dossier` vient de `my_company_verification()` (jamais la note
 * interne de l'équipe). `action = false` masque le bouton (onboarding).
 */
export function CompanyVerificationCard({
  dossier,
  action = true,
  className,
}: {
  dossier: MyCompanyVerification;
  action?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const tv = t.companyVerification;
  const reduceMotion = useReducedMotion();
  const state = companyReviewState({
    verification_status: dossier.status,
    verification_submitted_at: dossier.submitted_at,
  });
  const { icon: Icon, tone, iconTone } = STYLE[state];
  const copy = tv.states[state];
  const missing = dossier.missing;
  const anyRejected = COMPANY_CHECKS.some(
    (c) => dossier.checks[c].status === "rejected",
  );

  const cta =
    !action || state === "verified" || (state === "in_review" && !anyRejected)
      ? null
      : state === "correction" || anyRejected
        ? tv.correct
        : tv.complete;

  return (
    <motion.div
      key={state}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      <Card className={cn("border", tone)} data-testid="company-verification">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconTone)} />
            <div className="min-w-0 flex-1">
              <p
                className="font-semibold text-foreground"
                data-testid="company-verification-state"
                data-state={state}
              >
                {copy.title}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {copy.body}
              </p>
            </div>
          </div>

          {state === "correction" && dossier.rejection_reason && (
            <p
              className="break-words rounded-lg bg-background/70 p-3 text-sm text-foreground"
              data-testid="company-verification-reason"
            >
              <span className="font-medium">{tv.reasonLabel} : </span>
              {dossier.rejection_reason}
            </p>
          )}

          {state !== "verified" && (
            <ul
              className="space-y-1.5"
              data-testid="company-verification-checks"
            >
              {COMPANY_CHECKS.map((check) => {
                const c = dossier.checks[check];
                const { icon: CheckIcon, tone: checkTone } =
                  CHECK_ICON[c.status];
                return (
                  <li
                    key={check}
                    className="text-sm"
                    data-testid={`company-check-${check}`}
                    data-status={c.status}
                  >
                    <span className="flex items-center gap-2">
                      <CheckIcon
                        className={cn("h-4 w-4 shrink-0", checkTone)}
                      />
                      <span className="font-medium text-foreground">
                        {tv.checks[check]}
                      </span>
                      <span className="text-muted-foreground">
                        · {tv.checkStatus[c.status]}
                      </span>
                    </span>
                    {c.status === "rejected" && c.reason && (
                      <span className="ml-6 block break-words text-xs text-destructive">
                        {tv.reasonLabel} : {c.reason}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {state !== "verified" && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="company-verification-offers-hidden"
            >
              {tv.offersHidden}
            </p>
          )}

          {missing.length > 0 && state !== "verified" && (
            <div
              className="rounded-lg bg-background/70 p-3 text-sm"
              data-testid="company-verification-missing"
            >
              <p className="font-medium text-foreground">{tv.missingTitle}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {missing.map((piece) => (
                  <li key={piece}>{tv.pieces[piece]}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {state === "in_review" && dossier.submitted_at && (
              <span>
                {tv.submittedOn.replace(
                  "{date}",
                  doualaDateTime(dossier.submitted_at, locale),
                )}
              </span>
            )}
            {(state === "correction" || state === "verified") &&
              dossier.reviewed_at && (
                <span>
                  {tv.reviewedOn.replace(
                    "{date}",
                    doualaDateTime(dossier.reviewed_at, locale),
                  )}
                </span>
              )}
          </div>

          {cta && (
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link
                href="/onboarding/company?step=documents"
                data-testid="company-verification-cta"
              >
                {cta}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
