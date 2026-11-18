"use client";

import { useAccountState, useServerNow } from "@/lib/realtime/provider";
import { isCandidatePremiumActive } from "@/lib/utils/company-plan";

export type CandidatePlan = "free" | "premium";

export interface CandidatePlanView {
  plan: CandidatePlan;
  /** Fin de la période en cours (Premium) ou dernière fin connue (Free). */
  premiumUntil: string | null;
  /** Début de la période en cours ; null si inconnu ou Free. */
  premiumStartedAt: string | null;
}

/**
 * Lot 17a — plan effectif du candidat connecté.
 *
 * Source : `my_account_state` (calcul en base, `candidate_effective_plan`),
 * relu à chaque signal et basculé à l'échéance par le fournisseur temps
 * réel (heure du serveur). En attendant la première lecture, le rendu
 * serveur applique la même règle (rôle premium ET fin future, fin exacte
 * exclue).
 */
export function useCandidatePlan(initial: {
  role: string;
  premiumUntil: string | null;
}): CandidatePlanView {
  const account = useAccountState();
  const serverNow = useServerNow();
  const c = account?.candidate;
  if (c) {
    const plan: CandidatePlan = c.plan ?? (c.premium ? "premium" : "free");
    return {
      plan,
      premiumUntil: c.premium_until,
      premiumStartedAt:
        plan === "premium" ? (c.premium_started_at ?? null) : null,
    };
  }
  const premium = isCandidatePremiumActive(
    initial.role,
    initial.premiumUntil,
    serverNow(),
  );
  return {
    plan: premium ? "premium" : "free",
    premiumUntil: initial.premiumUntil,
    premiumStartedAt: null,
  };
}
