"use client";

import * as React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation, useTranslations } from "@/lib/i18n";
import {
  Briefcase,
  Search,
  ChevronRight,
  MapPin,
  Clock,
  Calendar,
  Building2,
  Loader2,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
import { frozenPayByApplication } from "@/lib/utils/mission-pay";
import { createClient } from "@/lib/supabase/client";
import useSWR from "swr";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { readSessionUser } from "@/lib/supabase/session-user";
import {
  applicationsEmptyState,
  loadState,
  splitApplications,
} from "@/lib/jobs/my-jobs";

type TabType = "applied" | "booked" | "completed";

// Une erreur (réseau compris) est levée au lieu de renvoyer des listes
// vides : SWR garde alors le dernier état connu et l'écran propose de
// réessayer, au lieu d'annoncer « aucune candidature » (lot 9).
function failIf(error: unknown) {
  if (error) throw error;
}

const fetcher = async (_url: string) => {
  const supabase = createClient();
  // Session locale (sans appel réseau) : hors ligne, la page ne se croit
  // pas déconnectée.
  const user = await readSessionUser(supabase);
  if (user === undefined) throw new Error("session_unreadable");
  if (!user) return { applications: [], missions: [] };

  const { data: profile, error: profileError } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  failIf(profileError);

  if (!profile) return { applications: [], missions: [] };

  const { data: applications, error: applicationsError } = await supabase
    .from("job_applications")
    .select(
      `
      id,
      status,
      created_at,
      job:jobs (
        id,
        title,
        city,
        mission_pay_per_candidate,
        start_date,
        start_time,
        end_time,
        company:company_public_profiles (
          company_name
        )
      )
    `,
    )
    .eq("candidate_id", profile.id)
    .order("created_at", { ascending: false });
  failIf(applicationsError);

  const { data: missions, error: missionsError } = await supabase
    .from("missions")
    .select(
      `
      id,
      application_id,
      status,
      scheduled_date,
      scheduled_start_time,
      scheduled_end_time,
      job:jobs (
        id,
        title,
        city,
        company:company_public_profiles (
          company_name
        )
      )
    `,
    )
    .eq("candidate_id", profile.id)
    .order("scheduled_date", { ascending: false });
  failIf(missionsError);

  // Mission : montant figé dans le contrat (jamais relu depuis l'offre).
  const { data: contracts, error: contractsError } = await supabase
    .from("contracts")
    .select("application_id, contract_data")
    .eq("candidate_id", profile.id);
  failIf(contractsError);
  const payByApplication = frozenPayByApplication(contracts);

  return {
    applications: applications || [],
    missions: (missions || []).map((m) => ({
      ...m,
      pay: m.application_id
        ? (payByApplication.get(m.application_id) ?? null)
        : null,
    })),
  };
};

type MyJobsData = Awaited<ReturnType<typeof fetcher>>;
type Application = MyJobsData["applications"][number];
type Mission = MyJobsData["missions"][number];

export default function MyJobsPage() {
  const { locale } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<TabType>("applied");
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    "/api/my-jobs",
    fetcher,
  );
  const tm = useTranslations().myJobs;

  useLiveRefresh(["applications", "missions", "contracts", "jobs"], () =>
    mutate(),
  );

  const tabs: { id: TabType; label: string }[] = [
    { id: "applied", label: tm.tabs.applied },
    { id: "booked", label: tm.tabs.booked },
    { id: "completed", label: tm.tabs.completed },
  ];

  const applications: Application[] = data?.applications ?? [];
  const missions: Mission[] = data?.missions ?? [];
  const state = loadState(data !== undefined, error);

  const { active: pendingApplications, past: pastApplications } =
    splitApplications(applications);
  const appliedEmpty = applicationsEmptyState(applications);
  const bookedMissions = missions.filter(
    (m) =>
      m.status === "pending" ||
      m.status === "confirmed" ||
      m.status === "in_progress",
  );
  const completedMissions = missions.filter((m) => m.status === "completed");

  const badgeVariant: Record<
    string,
    "default" | "success" | "warning" | "destructive"
  > = {
    pending: "warning",
    shortlisted: "default",
    selected: "success",
    rejected: "destructive",
    withdrawn: "default",
    no_show: "destructive",
    confirmed: "success",
    in_progress: "default",
    completed: "success",
    cancelled: "destructive",
  };

  const getStatusBadge = (
    status: string | null,
    kind: "application" | "mission",
  ) => {
    const labels: Record<string, string> =
      kind === "application" ? tm.applicationStatus : tm.missionStatus;
    const label = (status !== null && labels[status]) || status || "—";
    return (
      <Badge variant={(status && badgeVariant[status]) || "default"}>
        {label}
      </Badge>
    );
  };

  const renderEmptyState = (title: string, desc: string) => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="relative mb-6">
        <div className="h-24 w-24 rounded-3xl bg-linear-to-br from-primary/10 to-accent/10 flex items-center justify-center border-2 border-primary/20">
          <Briefcase className="h-10 w-10 text-primary/60" />
          <Search className="h-6 w-6 text-primary absolute -bottom-1 -right-1 bg-card rounded-full p-1" />
        </div>
      </div>

      <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-muted-foreground max-w-xs mb-6">{desc}</p>

      <Link href="/jobs">
        <Button>
          {tm.browseJobs}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </div>
  );

  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutate()}
      disabled={isValidating}
      data-testid="my-jobs-retry"
    >
      {isValidating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {tm.loadError.retry}
    </Button>
  );

  const renderApplicationCard = (application: Application) => (
    <Link key={application.id} href={`/jobs/${application.job?.id}`}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">
              {application.job?.title}
            </h3>
            {getStatusBadge(application.status, "application")}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span>{application.job?.company?.company_name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              <span>{application.job?.city}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>{formatDate(application.job?.start_date, locale)}</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
            <MissionPay
              amount={application.job?.mission_pay_per_candidate}
              amountClassName="text-primary"
            />
            {application.created_at && (
              <span className="text-xs text-muted-foreground">
                {tm.appliedOn} {formatDate(application.created_at, locale)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  const renderMissionCard = (mission: Mission) => (
    <Link key={mission.id} href={`/missions/${mission.id}`}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">
              {mission.job?.title}
            </h3>
            {getStatusBadge(mission.status, "mission")}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span>{mission.job?.company?.company_name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              <span>{mission.job?.city}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>
                {mission.scheduled_start_time?.slice(0, 5)} -{" "}
                {mission.scheduled_end_time?.slice(0, 5)}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
            <MissionPay amount={mission.pay} amountClassName="text-primary" />
            <span className="text-sm font-medium text-foreground">
              {formatDate(mission.scheduled_date, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground italic mb-6">
          {tm.title}
        </h1>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-all relative",
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        {state === "stale" && (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground"
            data-testid="my-jobs-stale"
          >
            <div className="flex items-start gap-2">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>{tm.loadError.stale}</p>
            </div>
            <div>{retryButton}</div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : state === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-12 text-center"
            data-testid="my-jobs-error"
          >
            <WifiOff className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              {tm.loadError.title}
            </h2>
            <p className="max-w-xs text-muted-foreground">
              {tm.loadError.desc}
            </p>
            {retryButton}
          </div>
        ) : (
          <>
            {activeTab === "applied" && (
              <div className="space-y-3" data-testid="my-jobs-applied">
                {pendingApplications.length > 0 ? (
                  pendingApplications.map(renderApplicationCard)
                ) : appliedEmpty === "never" ? (
                  renderEmptyState(tm.empty.neverTitle, tm.empty.neverDesc)
                ) : (
                  // Historique présent : message compact, l'historique
                  // reste visible sans défilement sur mobile.
                  <div
                    className="rounded-2xl border border-border bg-card p-4"
                    data-testid="my-jobs-no-active"
                  >
                    <h2 className="font-semibold text-foreground">
                      {tm.empty.noActiveTitle}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tm.empty.noActiveDesc}
                    </p>
                    <Link href="/jobs" className="mt-3 inline-block">
                      <Button size="sm">
                        {tm.browseJobs}
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                )}
                {pastApplications.length > 0 && (
                  <section className="pt-4" data-testid="my-jobs-history">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {tm.history}
                    </h2>
                    <div className="space-y-3 opacity-80">
                      {pastApplications.map(renderApplicationCard)}
                    </div>
                  </section>
                )}
              </div>
            )}

            {activeTab === "booked" &&
              (bookedMissions.length > 0 ? (
                <div className="space-y-3">
                  {bookedMissions.map(renderMissionCard)}
                </div>
              ) : (
                renderEmptyState(tm.empty.bookedTitle, tm.empty.bookedDesc)
              ))}

            {activeTab === "completed" &&
              (completedMissions.length > 0 ? (
                <div className="space-y-3">
                  {completedMissions.map(renderMissionCard)}
                </div>
              ) : (
                renderEmptyState(
                  tm.empty.completedTitle,
                  tm.empty.completedDesc,
                )
              ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
