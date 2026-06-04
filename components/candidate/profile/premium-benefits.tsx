"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Zap, Star, Sparkles, Crown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { formatDateShort } from "@/lib/utils/profile-status";

interface PremiumBenefitsProps {
  averageRating: number;
  premiumUntil: string | null;
  locale?: "fr" | "en";
}

/**
 * Bloc "Mon avantage Premium" — affiché uniquement pour candidate_premium.
 * Met en valeur les 3 avantages concrets + rassure (date d'expiration).
 */
export function PremiumBenefits({
  averageRating,
  premiumUntil,
  locale = "fr",
}: PremiumBenefitsProps) {
  const { t } = useI18n();
  const tr = t.profile.premium;

  const fastPaymentDesc =
    averageRating >= 4
      ? tr.benefits.fastPayment.desc4Stars
      : tr.benefits.fastPayment.descDefault;

  const benefits = [
    {
      icon: Zap,
      title: tr.benefits.fastPayment.title,
      desc: fastPaymentDesc,
      color: "#22C55E",
    },
    {
      icon: Star,
      title: tr.benefits.priority.title,
      desc: tr.benefits.priority.desc,
      color: "#F59E0B",
    },
    {
      icon: Sparkles,
      title: tr.benefits.exclusive.title,
      desc: tr.benefits.exclusive.desc,
      color: "#7C3AED",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <Card className="relative overflow-hidden border border-[#7C3AED]/30 bg-linear-to-br from-violet-50 to-purple-50 dark:border-white/10 dark:from-[#1A0F2E] dark:to-[#2A1158]">
        {/* Ornement Crown en fond */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-4"
          animate={{ rotate: [0, 8, -4, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Crown className="h-24 w-24 text-[#7C3AED]/10" />
        </motion.div>

        <CardContent className="relative z-10 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {tr.sectionTitle}
            </h3>
            {premiumUntil && (
              <span className="rounded-full bg-[#7C3AED]/10 px-2.5 py-1 text-[10px] font-semibold text-[#7C3AED]">
                {tr.expiresOn.replace(
                  "{date}",
                  formatDateShort(premiumUntil, locale),
                )}
              </span>
            )}
          </div>

          <ul className="space-y-3">
            {benefits.map((b, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="flex items-start gap-3"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${b.color}1A` }}
                >
                  <b.icon className="h-4.5 w-4.5" style={{ color: b.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {b.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {b.desc}
                  </p>
                </div>
              </motion.li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}
