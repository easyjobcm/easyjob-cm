"use client";

import Link from "next/link";
import useSWR from "swr";
import { motion } from "framer-motion";
import { Wallet, Clock, Info, RefreshCw, WifiOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readSessionUser } from "@/lib/supabase/session-user";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { BottomNav } from "@/components/layout/bottom-nav";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { formatDate, formatXaf } from "@/lib/utils";
import { frozenPayByApplication } from "@/lib/utils/mission-pay";
import { agreedEarnings, isCompletedMission } from "@/lib/jobs/earnings";
import { loadState } from "@/lib/jobs/my-jobs";
import { useLiveRefresh } from "@/lib/realtime/provider";

/**
 * « Mes gains » (lot 9). L'ancien écran lisait `payments`, qu'aucun
 * parcours n'écrit, et affichait un solde, des retraits et des heures
 * travaillées. Il montre désormais les missions terminées et le montant
 * figé dans leur contrat, sans promettre de versement.
 */
const fetcher = async (_key: string) => {
  const supabase = createClient();
  const user = await readSessionUser(supabase);
  if (user === undefined) throw new Error("session_unreadable");
  if (!user) return { missions: [] };

  const { data: profile, error: profileError } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { missions: [] };

  const { data: missions, error: missionsError } = await supabase
    .from("missions")
    .select(
      `id, application_id, status, scheduled_date,
       job:jobs ( title, company:company_public_profiles ( company_name ) )`,
    )
    .eq("candidate_id", profile.id)
    .order("scheduled_date", { ascending: false });
  if (missionsError) throw missionsError;

  const { data: contracts, error: contractsError } = await supabase
    .from("contracts")
    .select("application_id, contract_data")
    .eq("candidate_id", profile.id);
  if (contractsError) throw contractsError;
  const payByApplication = frozenPayByApplication(contracts);

  return {
    missions: (missions ?? [])
      .filter((m) => isCompletedMission(m.status))
      .map((m) => ({
        ...m,
        pay: m.application_id
          ? (payByApplication.get(m.application_id) ?? null)
          : null,
      })),
  };
};

export default function EarningsPage() {
  const { t, locale } = useI18n();
  const te = t.earnings;
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    "earnings",
    fetcher,
  );
  useLiveRefresh(["missions", "contracts"], () => mutate());

  const missions = data?.missions ?? [];
  const totals = agreedEarnings(missions);
  const state = loadState(data !== undefined, error);

  const retry = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutate()}
      disabled={isValidating}
    >
      {isValidating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {te.retry}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="p-4 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(6rem+env(safe-area-inset-bottom))]">
      {/* En-tête */}
      <div className="bg-linear-to-br from-violet-600 to-violet-800 text-white p-6 rounded-b-3xl">
        <h1 className="text-xl font-bold mb-4">{te.title}</h1>
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm text-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-5 w-5" aria-hidden />
              <span className="text-sm opacity-80">{te.totalLabel}</span>
            </div>
            <div className="text-3xl font-bold" data-testid="earnings-total">
              {formatXaf(totals.total, locale)}
            </div>
            <p className="mt-1 text-sm opacity-80">
              {plural(totals.count, te.missionsCount, locale)}
            </p>
          </CardContent>
        </Card>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/10 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{te.note}</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {state === "stale" && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
          >
            <div className="flex items-start gap-2">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>{te.loadErrorDesc}</p>
            </div>
            <div>{retry}</div>
          </div>
        )}

        {state === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-12 text-center"
          >
            <WifiOff className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{te.loadErrorTitle}</h2>
            <p className="max-w-xs text-muted-foreground">{te.loadErrorDesc}</p>
            {retry}
          </div>
        ) : missions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium text-foreground">{te.emptyTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {te.emptyDesc}
              </p>
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="mt-4 inline-block"
              >
                <Link href="/jobs">
                  <Button>{te.browseJobs}</Button>
                </Link>
              </motion.div>
            </CardContent>
          </Card>
        ) : (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {te.listTitle}
            </h2>
            {missions.map((m) => (
              <Link key={m.id} href={`/missions/${m.id}`}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{m.job?.title}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {m.job?.company?.company_name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(m.scheduled_date, locale)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {te.contractAmount}
                      </p>
                      {m.pay == null ? (
                        <p className="text-sm text-muted-foreground">
                          {te.noAmount}
                        </p>
                      ) : (
                        <MissionPay
                          amount={m.pay}
                          amountClassName="text-primary"
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
