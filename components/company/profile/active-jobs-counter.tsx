"use client";

import * as React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Briefcase,
  Infinity as InfinityIcon,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface ActiveJobsCounterProps {
  used: number;
  limit: number | "unlimited";
}

/**
 * Compteur d'offres actives avec barre de progression visuelle.
 * - "unlimited" → badge infini sans barre
 * - sinon → barre + alerte si plein
 */
export function ActiveJobsCounter({ used, limit }: ActiveJobsCounterProps) {
  const { t } = useI18n();
  const tr = t.profile.activeJobs;

  if (limit === "unlimited") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
      >
        <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED]/10">
                <InfinityIcon className="h-5 w-5 text-[#7C3AED]" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                  {tr.title}
                </p>
                <p className="mt-0.5 font-semibold text-foreground">
                  {used} · {tr.unlimited}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const isFull = used >= limit;
  const barColor = isFull ? "#EF4444" : pct >= 75 ? "#F59E0B" : "#7C3AED";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
    >
      <Card
        className={`border ${
          isFull
            ? "border-red-200 dark:border-red-500/30"
            : "border-[#E5E7EB] dark:border-white/10"
        } dark:bg-[#1A0F2E]`}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${barColor}1A` }}
            >
              <Briefcase className="h-5 w-5" style={{ color: barColor }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                {tr.title}
              </p>
              <p className="mt-0.5 font-semibold text-foreground">
                {tr.used
                  .replace("{used}", String(used))
                  .replace("{total}", String(limit))}
              </p>
            </div>
          </div>

          {/* Barre de progression */}
          <motion.div
            className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
            animate={isFull ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
            transition={
              isFull
                ? { duration: 0.4, repeat: Infinity, repeatDelay: 2.5 }
                : { duration: 0 }
            }
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
              className="h-full rounded-full"
              style={{ background: barColor }}
            />
          </motion.div>

          {isFull && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-2.5 dark:bg-red-500/10"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              <Link
                href="/upgrade/company"
                className="text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-300"
              >
                {tr.full}
              </Link>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
