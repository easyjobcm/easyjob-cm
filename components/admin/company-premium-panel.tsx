"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n";
import { PlanGrantPanel } from "@/components/admin/plan-grant-panel";
import {
  companyPremiumRefusal,
  companyPremiumStateSchema,
} from "@/lib/validations/company-premium";

interface CompanyPremiumPanelProps {
  /** company_profiles.id (identifiant de la fiche admin). */
  companyId: string;
  /** admin_ops / admin_founder : la RPC le revérifie en base. */
  canManage: boolean;
}

/**
 * ABO-07 — plan entreprise sur la fiche admin : plan effectif, fin,
 * historique (dont la reprise des anciens plans) ; activer, prolonger ou
 * arrêter Premium avec un motif (ops et fondateur ; support en lecture).
 */
export function CompanyPremiumPanel({
  companyId,
  canManage,
}: CompanyPremiumPanelProps) {
  const { t } = useI18n();
  return (
    <PlanGrantPanel
      url={`/api/admin/companies/${companyId}/premium`}
      canManage={canManage}
      texts={t.admin.companyPremium}
      testId="admin-company-premium"
      parse={(raw) => companyPremiumStateSchema.parse(raw)}
      refusal={companyPremiumRefusal}
    />
  );
}
