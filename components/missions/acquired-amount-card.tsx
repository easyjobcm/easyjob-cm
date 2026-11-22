"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { formatXaf } from "@/lib/utils";
import {
  acquiredAmountSchema,
  type AcquiredAmount,
} from "@/lib/validations/cancellation";

/**
 * Lot 17c — montant acquis d'un forfait interrompu, sur le contrat figé
 * (calcul de la base). Valeur exacte et arrondi au franc à valider ; aucun
 * versement n'est effectué par l'application.
 */
export function AcquiredAmountCard({ missionId }: { missionId: string }) {
  const { t, locale } = useI18n();
  const tc = t.cancellations;
  const { data, mutate } = useSWR<AcquiredAmount | null>(
    `/api/missions/${missionId}/acquired-amount`,
    async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { amount?: unknown };
      const parsed = acquiredAmountSchema.safeParse(body.amount);
      return parsed.success ? parsed.data : null;
    },
  );
  useLiveRefresh(["missions", "incidents"], () => void mutate());
  if (!data) return null;

  return (
    <Card data-testid="mission-acquired-amount">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">{tc.amountTitle}</CardTitle>
        <Badge variant={data.status === "final" ? "secondary" : "outline"}>
          {tc.amountStatus[data.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-semibold" data-testid="acquired-amount-value">
          {tc.amountValue
            .replace("{amount}", formatXaf(data.acquired_rounded, locale))
            .replace("{total}", formatXaf(data.contract_pay, locale))}
        </p>
        {!data.is_integer && (
          <p className="text-xs text-muted-foreground">
            {tc.amountExact.replace(
              "{exact}",
              new Intl.NumberFormat(locale === "en" ? "en-US" : "fr-FR", {
                maximumFractionDigits: 4,
              }).format(data.acquired_exact),
            )}
          </p>
        )}
        {data.status === "settlement_pending" && (
          <p
            className="text-xs font-medium"
            data-testid="acquired-amount-pending"
          >
            {tc.amountPendingNote}
          </p>
        )}
        {data.days.some((d) => d.unresolved) && (
          <p
            className="text-xs font-medium"
            data-testid="acquired-amount-unresolved"
          >
            {tc.amountUnresolvedNote}
          </p>
        )}
        {/* Lot 17d-2 : aucune indemnité décidée (MNT-04) ; les journées
            annulées par l'entreprise sont seulement signalées. */}
        {(data.company_cancelled_days ?? 0) > 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="acquired-amount-company-cancelled"
          >
            {t.companyCancellation.amountCompanyCancelled}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{tc.amountNote}</p>
      </CardContent>
    </Card>
  );
}
