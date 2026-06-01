"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  SANDBOX_LEVELS,
  type Criterion,
  type SandboxLevelConfig,
} from "@/lib/utils/profile-completion";

interface ProfileCompletionWidgetProps {
  role: string;
  completionPct: number;
  criteria: Criterion[];
  sandboxLevel?: number;
}

export function ProfileCompletionWidget({
  role,
  completionPct,
  criteria,
  sandboxLevel = 0,
}: ProfileCompletionWidgetProps) {
  const { t } = useI18n();
  const [expandedLevel, setExpandedLevel] = React.useState<number | null>(null);

  const isCandidate = role === "candidate" || role === "candidate_premium";

  const nextLevel: SandboxLevelConfig | undefined =
    SANDBOX_LEVELS[sandboxLevel + 1];

  const clampedPct = Math.min(100, Math.max(0, completionPct));
  const needsAttention = clampedPct < 60;

  // i18n helpers
  const tc = t.profile.completion;
  const ts = tc.sandbox;

  const getLevelName = (levelKey: SandboxLevelConfig["nameKey"]) => {
    const map: Record<SandboxLevelConfig["nameKey"], string> = {
      level0: ts.level0,
      level1: ts.level1,
      level2: ts.level2,
      level3: ts.level3,
    };
    return map[levelKey];
  };

  const getMissionsLabel = (level: number) => {
    const labels = [ts.missions0, ts.missions1, ts.missions2, ts.missions3];
    return labels[Math.min(level, 3)];
  };

  const getRequirement = (reqKey: SandboxLevelConfig["requirementKey"]) => {
    const map: Record<SandboxLevelConfig["requirementKey"], string> = {
      req_registered: ts.req_registered,
      req_m1_r35: ts.req_m1_r35,
      req_m3_r4_p80: ts.req_m3_r4_p80,
      req_m10_r45_verified: ts.req_m10_r45_verified,
    };
    return map[reqKey];
  };

  const getCriterionLabel = (key: string): string => {
    const labels: Record<string, string> = {
      identity: tc.criteria.identity,
      photo: tc.criteria.photo,
      skills: tc.criteria.skills,
      bio: tc.criteria.bio,
      availability: tc.criteria.availability,
      location: tc.criteria.location,
      cni: tc.criteria.cni,
      momo: tc.criteria.momo,
      sector: tc.criteria.sector,
      description: tc.criteria.description,
      logo: tc.criteria.logo,
      address: tc.criteria.address,
      legal: tc.criteria.legal,
      contact: tc.criteria.contact,
    };
    return labels[key] ?? key;
  };

  return (
    <div className="space-y-4">
      {/* Progress card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-[20px] border border-[#E5E7EB] bg-white p-5 shadow-sm"
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

        {/* Criteria list */}
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {criteria.map((c, i) => (
            <motion.li
              key={c.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="flex items-center gap-2"
            >
              {c.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7C3AED]" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-gray-300" />
              )}
              <span
                className={`text-sm ${c.done ? "text-gray-800" : "text-gray-400"}`}
              >
                {getCriterionLabel(c.key)}
                {!c.done && (
                  <span className="ml-1 text-[11px] text-amber-500">
                    +{c.weight}%
                  </span>
                )}
              </span>
            </motion.li>
          ))}
        </ul>

        {/* CTA */}
        {clampedPct < 100 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-5"
          >
            <Link href="/onboarding">
              <motion.span
                whileTap={{ scale: 0.98 }}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#5B21B6] font-semibold text-sm text-white shadow shadow-[#5B21B6]/30 transition-colors hover:bg-[#7C3AED]"
              >
                {tc.cta}
              </motion.span>
            </Link>
          </motion.div>
        )}
      </motion.div>

      {/* Sandbox levels card — candidates only */}
      {isCandidate && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="rounded-[20px] border border-[#E5E7EB] bg-white p-5 shadow-sm"
        >
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
            {ts.title}
          </p>

          {/* Level row */}
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            {SANDBOX_LEVELS.map((lvl) => {
              const isActive = lvl.level === sandboxLevel;
              const isPast = lvl.level < sandboxLevel;
              const isNext = nextLevel?.level === lvl.level;
              const isExpanded = expandedLevel === lvl.level;

              return (
                <div key={lvl.level} className="flex flex-col items-center">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() =>
                      setExpandedLevel(isExpanded ? null : lvl.level)
                    }
                    className="flex flex-col items-center gap-1.5 rounded-2xl border-2 px-3 py-3 transition-all min-w-19"
                    style={{
                      borderColor: isActive ? lvl.color : "#E5E7EB",
                      background: isActive ? lvl.bgColor : "transparent",
                      opacity: !isActive && !isPast && !isNext ? 0.5 : 1,
                    }}
                  >
                    <lvl.icon
                      className="h-6 w-6"
                      style={{ color: isActive ? lvl.color : "#9CA3AF" }}
                    />
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: isActive ? lvl.color : "#6B7280" }}
                    >
                      {getLevelName(lvl.nameKey)}
                    </span>
                    {isActive && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                        style={{ background: lvl.color, color: "#fff" }}
                      >
                        {ts.current}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-gray-400" />
                    )}
                  </motion.button>
                </div>
              );
            })}
          </div>

          {/* Missions label */}
          <p className="mt-3 text-center text-sm text-gray-500">
            {getMissionsLabel(sandboxLevel)}
          </p>

          {/* Expanded level details */}
          <AnimatePresence>
            {expandedLevel !== null && (
              <motion.div
                key={expandedLevel}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div
                  className="mt-4 rounded-xl p-4"
                  style={{
                    background: SANDBOX_LEVELS[expandedLevel]?.bgColor,
                  }}
                >
                  {expandedLevel > sandboxLevel && (
                    <p className="mb-2 text-xs font-semibold text-gray-600">
                      {ts.unlockNext}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {SANDBOX_LEVELS[expandedLevel] && (
                      <li className="flex items-center gap-2 text-sm text-gray-700">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: SANDBOX_LEVELS[expandedLevel].color,
                          }}
                        />
                        {getRequirement(
                          SANDBOX_LEVELS[expandedLevel].requirementKey,
                        )}
                      </li>
                    )}
                  </ul>
                  <p className="mt-2 flex items-center gap-1 text-xs font-medium text-gray-500">
                    {SANDBOX_LEVELS[expandedLevel] &&
                      (() => {
                        const Icon = SANDBOX_LEVELS[expandedLevel].icon;
                        return (
                          <Icon
                            className="h-3.5 w-3.5"
                            style={{
                              color: SANDBOX_LEVELS[expandedLevel].color,
                            }}
                          />
                        );
                      })()}
                    {getMissionsLabel(expandedLevel)}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
