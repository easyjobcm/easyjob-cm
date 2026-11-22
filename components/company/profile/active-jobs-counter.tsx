"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Infinity as InfinityIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface ActiveJobsCounterProps {
  used: number;
}

/**
 * Offres publiées ou en modération. ABO-10 : offres actives illimitées pour
 * Free et Premium, aucun quota.
 */
export function ActiveJobsCounter({ used }: ActiveJobsCounterProps) {
  const { t } = useI18n();
  const tr = t.profile.activeJobs;
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
    >
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <InfinityIcon className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-primary">
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
