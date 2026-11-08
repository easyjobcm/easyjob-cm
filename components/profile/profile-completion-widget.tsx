"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, Circle, ShieldCheck, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  type Criterion,
  getCandidateCompletionCtaHref,
} from "@/lib/utils/profile-completion";
import { isCandidatePremium } from "@/lib/utils/profile-status";

interface ProfileCompletionWidgetProps {
  role: string;
  completionPct: number;
  criteria: Criterion[];
  /** Requis pour les candidats : détermine la route réelle du CTA (onboarding vs édition). */
  onboardingStatus?: string | null;
}

export function ProfileCompletionWidget({
  role,
  completionPct,
  criteria,
  onboardingStatus,
}: ProfileCompletionWidgetProps) {
  const { t } = useI18n();

  const isCandidate = role === "candidate" || role === "candidate_premium";

  const clampedPct = Math.min(100, Math.max(0, completionPct));
  const needsAttention = clampedPct < 60;

  const tc = t.profile.completion;

  return (
    <div className="space-y-4">
      {/* Progress card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-[20px] border border-[#E5E7EB] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#1A0F2E]"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {tc.title}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              {needsAttention ? tc.required60 : tc.subtitle}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-sm font-bold"
            style={{
              color: clampedPct >= 60 ? "#7C3AED" : "#D97706",
              background: clampedPct >= 60 ? "#F3E8FF" : "#FFFBEB",
            }}
          >
            {clampedPct}%
          </span>
        </div>

        {/* Bar */}
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${clampedPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
            className="h-full rounded-full"
            style={{
              background:
                clampedPct >= 60
                  ? "linear-gradient(90deg,#7C3AED,#A78BFA)"
                  : "linear-gradient(90deg,#D97706,#FCD34D)",
            }}
          />
        </div>

        {/* 60% marker label */}
        <div className="relative mt-1 h-4">
          <span
            className="absolute text-[10px] text-gray-400"
            style={{ left: "60%", transform: "translateX(-50%)" }}
          >
            60%
          </span>
        </div>

        {/* Criteria list — les critères "essentiels" (identité, CNI,
            Mobile Money) encadrés en premier : sans eux, pas de postulation,
            indépendamment du pourcentage. */}
        <EssentialsSection criteria={criteria} isCandidate={isCandidate} />
        <OptionalCriteria criteria={criteria} isCandidate={isCandidate} />

        {/* CTA */}
        {clampedPct < 100 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-5"
          >
            <Link
              href={
                isCandidate
                  ? getCandidateCompletionCtaHref(criteria, onboardingStatus)
                  : "/onboarding/company"
              }
            >
              <motion.span
                whileTap={{ scale: 0.98 }}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#5B21B6] font-semibold text-sm text-white shadow shadow-[#5B21B6]/30 transition-colors hover:bg-[#7C3AED]"
              >
                {clampedPct >= 60 ? t.profile.editProfile : tc.cta}
              </motion.span>
            </Link>
          </motion.div>
        ) : (
          isCandidate &&
          !isCandidatePremium(role) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-5"
            >
              <Link href="/upgrade/candidate">
                <motion.span
                  whileTap={{ scale: 0.98 }}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full font-bold text-white shadow-lg shadow-[#7C3AED]/40"
                  style={{
                    background:
                      "linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%)",
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  {tc.premiumCta}
                </motion.span>
              </Link>
            </motion.div>
          )
        )}
      </motion.div>
    </div>
  );
}

// ── Critères essentiels vs options ──────────────────────────────
// Sans ces trois, la candidature est bloquée côté serveur (gate), même si
// le pourcentage global atteint 60%. Ils sont affichés en priorité.
const ESSENTIAL_KEYS = new Set(["identity", "cni", "momo"]);

interface CriterionItemProps {
  criterion: Criterion;
  label: string;
  index: number;
  required?: boolean;
  requiredLabel?: string;
}

function CriterionItem({
  criterion,
  label,
  index,
  required,
  requiredLabel,
}: CriterionItemProps) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 + index * 0.05 }}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        required ? "bg-[#7C3AED]/[0.06] dark:bg-[#7C3AED]/10" : ""
      }`}
    >
      {criterion.done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7C3AED]" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-gray-300" />
      )}
      <span
        className={`text-sm ${
          criterion.done ? "text-gray-800" : "text-gray-500"
        }`}
      >
        {label}
        {required && (
          <span className="ml-1.5 rounded-full bg-[#7C3AED]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7C3AED]">
            {requiredLabel ?? "Requis"}
          </span>
        )}
        {!criterion.done && (
          <span className="ml-1 text-[11px] text-amber-500">
            +{criterion.weight}%
          </span>
        )}
      </span>
    </motion.li>
  );
}

function EssentialsSection({
  criteria,
  isCandidate,
}: {
  criteria: Criterion[];
  isCandidate: boolean;
}) {
  const { t } = useI18n();
  const tc = t.profile.completion;
  if (!isCandidate) return null;
  const essential = criteria.filter((c) => ESSENTIAL_KEYS.has(c.key));
  const missingEssential = essential.some((c) => !c.done);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-[#7C3AED]" aria-hidden />
        <p className="text-[10px] font-semibold uppercase tracking-[1.2px] text-gray-500">
          {tc.essentialsTitle}
        </p>
        {missingEssential && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
            {tc.todo}
          </span>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {essential.map((c, i) => (
          <CriterionItem
            key={c.key}
            criterion={c}
            label={tc.criteria[c.key as keyof typeof tc.criteria] ?? c.key}
            index={i}
            required
            requiredLabel={t.profile.essential.required}
          />
        ))}
      </ul>
    </div>
  );
}

function OptionalCriteria({
  criteria,
  isCandidate,
}: {
  criteria: Criterion[];
  isCandidate: boolean;
}) {
  const { t } = useI18n();
  const tc = t.profile.completion;
  const labels: Record<string, string> = {
    photo: tc.criteria.photo,
    skills: tc.criteria.skills,
    bio: tc.criteria.bio,
    availability: tc.criteria.availability,
    location: tc.criteria.location,
    identity: tc.criteria.identity,
    cni: tc.criteria.cni,
    momo: tc.criteria.momo,
    sector: tc.criteria.sector,
    description: tc.criteria.description,
    logo: tc.criteria.logo,
    address: tc.criteria.address,
    legal: tc.criteria.legal,
    contact: tc.criteria.contact,
  };
  const optional = criteria.filter((c) => !ESSENTIAL_KEYS.has(c.key));
  if (optional.length === 0) return null;
  return (
    <div className="mt-3">
      {isCandidate && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[1.2px] text-gray-400">
          {tc.optionalTitle}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {optional.map((c, i) => (
          <CriterionItem
            key={c.key}
            criterion={c}
            label={labels[c.key] ?? c.key}
            index={i}
          />
        ))}
      </ul>
    </div>
  );
}
