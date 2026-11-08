"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface PaymentDelayInfoProps {
  role: string;
  averageRating: number;
}

/**
 * Bloc « Rémunération » du profil candidat (lot 9). Le SRS prévoit des
 * délais de versement (48 h, 50/50, 7 jours) qui ne sont pas implémentés :
 * aucun versement n'est effectué par l'application. Le bloc rappelle que le
 * montant fixe est inscrit dans chaque contrat et réglé par l'entreprise.
 */
export function PaymentDelayInfo({
  role,
  averageRating,
}: PaymentDelayInfoProps) {
  const { t } = useI18n();
  const tr = t.profile.paymentDelay;
  // Aucun délai de versement n'existe (lot 9) : le montant fixe est inscrit
  // dans chaque contrat et réglé par l'entreprise. `role` et
  // `averageRating` restent acceptés pour compatibilité.
  void role;
  void averageRating;
  const config = {
    icon: Clock,
    color: "#7C3AED",
    label: tr.standard,
    cta: tr.note as string | null,
  };
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
                <p className="mt-1 text-xs text-muted-foreground">
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
