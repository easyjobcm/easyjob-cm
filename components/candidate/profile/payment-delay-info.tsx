"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clock, Zap, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import {
  computePaymentDelayMode,
  type PaymentDelayMode,
} from "@/lib/utils/profile-status";

interface PaymentDelayInfoProps {
  role: string;
  averageRating: number;
}

/**
 * Bloc "Délai de paiement" — affiché sur le profil candidat (premium ou standard).
 * Selon SRS v1.1 :
 *  - premium + 4★    → 48h
 *  - premium OU 4★   → 50% + 50% / 7j
 *  - sinon           → 7 jours
 */
export function PaymentDelayInfo({
  role,
  averageRating,
}: PaymentDelayInfoProps) {
  const { t } = useI18n();
  const tr = t.profile.paymentDelay;
  const mode: PaymentDelayMode = computePaymentDelayMode(role, averageRating);

  const config = {
    fast48h: {
      icon: Zap,
      color: "#22C55E",
      label: tr.premiumFast,
      cta: null as string | null,
    },
    split: {
      icon: TrendingUp,
      color: "#F59E0B",
      label: tr.premiumSplit,
      cta: averageRating < 4 ? tr.improveCta : null,
    },
    standard7d: {
      icon: Clock,
      color: "#6B7280",
      label: tr.standard,
      cta: null as string | null,
    },
  }[mode];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22 }}
    >
      <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${config.color}1A` }}
            >
              <config.icon
                className="h-5 w-5"
                style={{ color: config.color }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                {tr.title}
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {config.label}
              </p>
              {config.cta && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {config.cta}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
