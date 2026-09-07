"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Info } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PremiumBenefits } from "@/components/candidate/profile/premium-benefits";
import { useI18n } from "@/lib/i18n";
import { formatDateShort } from "@/lib/utils/profile-status";

interface UpgradeCandidateClientProps {
  role: string;
  averageRating: number;
  premiumUntil: string | null;
}

export function UpgradeCandidateClient({
  role,
  averageRating,
  premiumUntil,
}: UpgradeCandidateClientProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const tr = t.profile.upgradePremium;

  const isPremiumRole = role === "candidate_premium";
  const isActive =
    isPremiumRole && !!premiumUntil && new Date(premiumUntil) > new Date();
  const isExpired =
    isPremiumRole && !!premiumUntil && new Date(premiumUntil) <= new Date();

  const statusLabel = isActive
    ? tr.statusActive.replace("{date}", formatDateShort(premiumUntil!, locale))
    : isExpired
      ? tr.statusExpired.replace(
          "{date}",
          formatDateShort(premiumUntil!, locale),
        )
      : tr.statusNone;

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
          <h1 className="text-lg font-semibold text-foreground">{tr.title}</h1>
        </div>

        <div className="space-y-4 px-4 pb-10 pt-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-foreground">
                {statusLabel}
              </p>
            </CardContent>
          </Card>

          {isActive ? (
            <PremiumBenefits
              averageRating={averageRating}
              premiumUntil={premiumUntil}
              locale={locale}
            />
          ) : (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold text-[#5B21B6]">
                    {tr.price}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {tr.pricePeriod}
                  </span>
                </div>
                <ul className="space-y-2">
                  {[
                    tr.bullets.fastPayment,
                    tr.bullets.priority,
                    tr.bullets.exclusive,
                  ].map((label) => (
                    <li
                      key={label}
                      className="flex items-center gap-2.5 text-sm text-foreground/80"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7C3AED]" />
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Souscription : aucune infrastructure de paiement d'abonnement
              n'existe encore (pas d'API, pas de webhook) — on ne simule pas
              un parcours de paiement fonctionnel. */}
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-2">
                <p className="text-sm text-amber-800 dark:text-amber-400">
                  {tr.subscribeUnavailable}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-500/80">
                  {tr.renewalNote}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/help">{tr.contactSupport}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
