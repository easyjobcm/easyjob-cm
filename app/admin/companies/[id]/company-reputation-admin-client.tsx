"use client";

import type { ReactNode } from "react";
import { ReputationAdminPanel } from "@/components/admin/reputation-admin-panel";
import { useI18n } from "@/lib/i18n";

export function CompanyReputationAdminClient({
  company,
  backLink,
}: {
  company: {
    id: string;
    name: string;
    city: string | null;
    sector: string | null;
    verification: string | null;
  };
  backLink: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <span aria-label={t.common.back}>{backLink}</span>
        <div className="min-w-0">
          <h1
            className="truncate text-lg font-semibold"
            data-testid="admin-company-name"
          >
            {company.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[company.sector, company.city, company.verification]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <ReputationAdminPanel subjectType="company" subjectId={company.id} />
    </div>
  );
}
