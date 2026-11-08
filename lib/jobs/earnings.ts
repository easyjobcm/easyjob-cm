/**
 * Écran « Mes gains » (lot 9) : somme des montants FIGÉS dans les contrats
 * des missions terminées. Aucun solde, aucun retrait : l'application ne
 * verse rien (les tables de paiement ne sont écrites par aucun parcours).
 */

/** Statuts d'une mission dont la fin a été confirmée. */
export const COMPLETED_MISSION_STATUSES = ["completed", "validated"] as const;

export function isCompletedMission(status: string | null): boolean {
  return (COMPLETED_MISSION_STATUSES as readonly string[]).includes(
    status ?? "",
  );
}

/**
 * Total des montants convenus. Une mission sans montant lisible n'est pas
 * comptée dans le total (jamais de montant inventé) mais reste listée.
 */
export function agreedEarnings(
  missions: readonly { status: string | null; pay: number | null }[],
): { count: number; total: number; withoutAmount: number } {
  let count = 0;
  let total = 0;
  let withoutAmount = 0;
  for (const m of missions) {
    if (!isCompletedMission(m.status)) continue;
    count += 1;
    if (m.pay == null) withoutAmount += 1;
    else total += m.pay;
  }
  return { count, total, withoutAmount };
}
