"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { CandidatePlanCard } from "@/components/candidate/profile/candidate-plan-card";
import { useI18n } from "@/lib/i18n";
import { useCandidatePlan } from "@/hooks/use-candidate-plan";

interface UpgradeCandidateClientProps {
  role: string;
  premiumUntil: string | null;
}

/**
 * Lot 17a — « Mon plan » : plan effectif et date de fin, relus en direct
 * (my_account_state, minuterie sur l'heure du serveur). Premium est
 * attribué par l'équipe EasyJob ; aucun prix ni avantage non livré n'est
 * annoncé, aucun parcours de paiement n'est simulé.
 */
export function UpgradeCandidateClient({
  role,
  premiumUntil,
}: UpgradeCandidateClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const tp = t.profile.candidatePlan;
  const view = useCandidatePlan({ role, premiumUntil });

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 pb-4 pt-safe-top dark:border-white/10 dark:bg-[#1A0F2E]">
          <button
            type="button"
            onClick={() => router.push("/profile/candidate")}
            aria-label={t.common.back}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">{tp.title}</h1>
        </div>

        <div className="space-y-4 px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-6">
          <CandidatePlanCard view={view} detailed />
          <Button asChild variant="outline" size="sm">
            <Link href="/help">{tp.contactSupport}</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
