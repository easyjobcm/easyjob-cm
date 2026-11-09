"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Star, TrendingDown, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAccountState } from "@/lib/realtime/provider";
import {
  celebrationFor,
  formatStars,
  type ReputationChange,
} from "@/lib/reputation/progress";
import { isReviewReason } from "@/lib/reputation/review-reasons";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import { supportMailto } from "@/lib/support";
import { ReputationStars } from "./reputation-stars";
import { useMyReputation } from "./use-my-reputation";

const GAIN_MS = 4500;
const LOSS_MS = 12000;
const PARTICLES = 10;

/**
 * Animation des variations de réputation (lot 9c), montée une fois pour
 * l'application. La notification durable est écrite en base avec la
 * variation ; ici, seule l'animation :
 *   - l'onglet qui obtient l'accusé (POST /api/reputation/acknowledge) la
 *     joue ; les autres onglets, une reconnexion ou un rechargement ne la
 *     rejouent pas ;
 *   - gain : courte félicitation ; baisse : carte discrète avec l'action
 *     adaptée (motifs de l'avis, renouvellement d'un justificatif…) ;
 *   - prefers-reduced-motion : aucune trajectoire, simple apparition.
 */
export function ReputationCelebration() {
  const account = useAccountState();
  const role = account?.role ?? "";
  const enabled =
    !!account?.is_active &&
    (role.startsWith("candidate") || role.startsWith("company"));
  const { data } = useMyReputation(enabled);
  const [shown, setShown] = React.useState<{
    change: ReputationChange;
    subject: "candidate" | "company";
  } | null>(null);
  const inFlight = React.useRef(new Set<string>());

  const pending = data?.pending_changes;
  const subject = data?.subject_type;
  React.useEffect(() => {
    if (!pending || !subject) return;
    const ids = pending
      .map((c) => c.id)
      .filter((id) => !inFlight.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => inFlight.current.add(id));
    void fetch("/api/reputation/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((res) => (res.ok ? res.json() : { acknowledged: [] }))
      .then((body: { acknowledged?: string[] }) => {
        const mine = new Set(body.acknowledged ?? []);
        const change = celebrationFor(pending.filter((c) => mine.has(c.id)));
        if (change) setShown({ change, subject });
      })
      .catch(() => {
        // Réseau : la variation reste à acquitter, rejouée à la reprise.
        ids.forEach((id) => inFlight.current.delete(id));
      });
  }, [pending, subject]);

  React.useEffect(() => {
    if (!shown) return;
    const handle = window.setTimeout(
      () => setShown(null),
      shown.change.direction === "gain" ? GAIN_MS : LOSS_MS,
    );
    return () => window.clearTimeout(handle);
  }, [shown]);

  return (
    <AnimatePresence>
      {shown &&
        (shown.change.direction === "gain" ? (
          <GainCard
            key={shown.change.id}
            change={shown.change}
            subject={shown.subject}
            onClose={() => setShown(null)}
          />
        ) : (
          <LossCard
            key={shown.change.id}
            change={shown.change}
            subject={shown.subject}
            onClose={() => setShown(null)}
          />
        ))}
    </AnimatePresence>
  );
}

type CardProps = {
  change: ReputationChange;
  subject: "candidate" | "company";
  onClose: () => void;
};

function progressHref(subject: "candidate" | "company"): string {
  return subject === "candidate"
    ? "/profile/candidate#reputation"
    : "/profile/company#reputation";
}

function GainCard({ change, subject, onClose }: CardProps) {
  const { t, locale } = useI18n();
  const tc = t.reputation.celebration;
  const reduce = useReducedMotion();
  const stars = formatStars(change.to, locale, t.reputation.stars);
  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-testid="reputation-celebration"
      data-direction="gain"
      className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[calc(1rem+env(safe-area-inset-top))]"
      initial={{ opacity: 0, y: reduce ? 0 : -24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -16 }}
      transition={{ duration: reduce ? 0.01 : 0.35 }}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-linear-to-br from-[#3B0764] to-[#7C3AED] p-4 text-white shadow-2xl shadow-[#7C3AED]/40">
        {!reduce &&
          Array.from({ length: PARTICLES }).map((_, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute left-1/2 top-10 h-1.5 w-1.5 rounded-full bg-yellow-300"
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{
                x: Math.cos((i / PARTICLES) * Math.PI * 2) * 120,
                y: Math.sin((i / PARTICLES) * Math.PI * 2) * 50,
                opacity: 0,
                scale: 0.4,
              }}
              transition={{ duration: 1.1, ease: "easeOut", delay: 0.15 }}
            />
          ))}
        <button
          type="button"
          onClick={onClose}
          aria-label={tc.close}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3 pr-8">
          <motion.div
            aria-hidden
            initial={reduce ? false : { scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 14 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-yellow-400/20"
          >
            <Star className="h-7 w-7 fill-yellow-300 text-yellow-300" />
          </motion.div>
          <div className="min-w-0">
            <p className="font-semibold">{tc.gainTitle}</p>
            <p className="text-sm text-white/85">
              {tc.gainBody.replace("{stars}", stars)}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <ReputationStars
            stars={change.to}
            tone="light"
            testId="celebration-stars"
          />
          <Link
            href={progressHref(subject)}
            onClick={onClose}
            className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
          >
            {tc.view}
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

function LossCard({ change, subject, onClose }: CardProps) {
  const { t, locale } = useI18n();
  const tc = t.reputation.celebration;
  const reduce = useReducedMotion();
  const stars = formatStars(change.to, locale, t.reputation.stars);
  const reasons = (change.details.reasons ?? [])
    .filter(isReviewReason)
    .map((code) => t.reputation.reasons[code]);
  const documents = (change.details.documents ?? [])
    .map((d) => d.title || d.type)
    .filter((v): v is string => !!v);

  let action: { href: string; label: string; external?: boolean };
  if (change.cause === "document_expired") {
    action = { href: "/profile/skills", label: tc.renew };
  } else if (change.cause === "skill") {
    action = { href: "/profile/skills", label: tc.skills };
  } else if (change.cause === "profile") {
    action = {
      href:
        subject === "candidate"
          ? "/profile/candidate/edit"
          : "/profile/company",
      label: tc.completeProfile,
    };
  } else if (change.cause === "review") {
    action = {
      href: supportMailto(tc.contestSubject),
      label: tc.contest,
      external: true,
    };
  } else {
    action = {
      href: safeInternalPath(change.details.href, progressHref(subject)),
      label: tc.view,
    };
  }

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-testid="reputation-celebration"
      data-direction="loss"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
      initial={{ opacity: 0, y: reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.01 : 0.25 }}
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-background p-4 shadow-lg">
        <button
          type="button"
          onClick={onClose}
          aria-label={tc.close}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-8">
          <TrendingDown
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">{tc.lossTitle}</p>
            <p className="text-sm text-muted-foreground">
              {tc.lossBody.replace("{stars}", stars)}
            </p>
            {reasons.length > 0 && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="loss-reasons"
              >
                {tc.lossReasons.replace("{reasons}", reasons.join(", "))}
              </p>
            )}
            {documents.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {tc.lossDocument.replace("{documents}", documents.join(", "))}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <ReputationStars stars={change.to} size="sm" />
          {action.external ? (
            <a
              href={action.href}
              className="rounded-full bg-[#7C3AED] px-3 py-1.5 text-xs font-medium text-white"
              data-testid="loss-action"
            >
              {action.label}
            </a>
          ) : (
            <Link
              href={action.href}
              onClick={onClose}
              className="rounded-full bg-[#7C3AED] px-3 py-1.5 text-xs font-medium text-white"
              data-testid="loss-action"
            >
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}
