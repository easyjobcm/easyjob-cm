"use client";

import { cn, formatXaf } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * Rémunération d'un candidat pour la mission : « 10 000 F CFA pour la
 * mission ». Montant fixe en XAF (jobs.mission_pay_per_candidate ou
 * contract_data.mission_pay_per_candidate), jamais multiplié par une durée
 * ni par le nombre de places. Absent : tiret, jamais un montant inventé.
 */
export function MissionPay({
  amount,
  className,
  amountClassName,
  suffixClassName,
  testId,
}: {
  amount: number | null | undefined;
  className?: string;
  amountClassName?: string;
  suffixClassName?: string;
  testId?: string;
}) {
  const { t, locale } = useI18n();
  if (amount == null || !Number.isFinite(amount)) {
    return (
      <span className={className} data-testid={testId}>
        —
      </span>
    );
  }
  return (
    // Texte en ligne (pas de flex) : « 10 000 F CFA pour la mission » se lit
    // d'un seul tenant, y compris par un lecteur d'écran.
    <span className={className} data-testid={testId}>
      <span className={cn("font-bold whitespace-nowrap", amountClassName)}>
        {formatXaf(amount, locale)}
      </span>{" "}
      <span className={cn("text-xs text-muted-foreground", suffixClassName)}>
        {t.pay.forMission}
      </span>
    </span>
  );
}
