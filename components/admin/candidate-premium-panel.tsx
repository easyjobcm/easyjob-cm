"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n";
import { PlanGrantPanel } from "@/components/admin/plan-grant-panel";
import {
  candidatePremiumStateSchema,
  premiumRefusal,
} from "@/lib/validations/candidate-premium";

interface CandidatePremiumPanelProps {
  /** users.id du candidat (identifiant de la fiche admin). */
  candidateUserId: string;
  /** admin_ops / admin_founder : la RPC le revérifie en base. */
  canManage: boolean;
}

/**
 * Lot 17a — Premium d'un candidat sur sa fiche admin : plan effectif, fin,
 * historique ; activer, prolonger ou arrêter avec un motif (ops et
 * fondateur). Attribution administrative, jamais un paiement.
 */
export function CandidatePremiumPanel({
  candidateUserId,
  canManage,
}: CandidatePremiumPanelProps) {
  const { t } = useI18n();
  return (
    <PlanGrantPanel
      url={`/api/admin/candidates/${candidateUserId}/premium`}
      canManage={canManage}
      texts={t.admin.candidatePremium}
      testId="admin-candidate-premium"
      parse={(raw) => candidatePremiumStateSchema.parse(raw)}
      refusal={premiumRefusal}
    />
  );
}
