"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/layout/bottom-nav";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatTime } from "@/lib/utils";
import { doualaTime } from "@/lib/utils/douala-time";
import type { Database } from "@/lib/database.types";

type MissionRow =
  Database["public"]["Functions"]["get_mission"]["Returns"][number];
/** Colonnes que `get_mission` peut renvoyer à null (types générés stricts). */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };
type Mission = Nullable<
  MissionRow,
  | "started_at"
  | "completed_at"
  | "contract_id"
  | "contract_status"
  | "company_name"
  | "address"
  | "city"
>;

type LoadResult =
  | { kind: "ok"; mission: Mission }
  | { kind: "unauthorized" }
  | { kind: "mission_not_found" }
  | { kind: "load" };

async function fetchMission(missionId: string): Promise<LoadResult> {
  const res = await fetch(`/api/missions/${missionId}`, {
    cache: "no-store",
  }).catch(() => null);
  if (res?.status === 401) return { kind: "unauthorized" };
  const body = ((await res?.json().catch(() => null)) ?? {}) as {
    mission?: Mission;
  };
  if (res?.ok && body.mission) return { kind: "ok", mission: body.mission };
  return { kind: res?.status === 404 ? "mission_not_found" : "load" };
}

/**
 * Détail d'une mission côté candidat (lot 7c) : horaires prévus de l'offre,
 * contrat, début et réalisation confirmés. Les actions (signer, commencer,
 * saisir le code, noter) sont dans Tâches. Aucune géolocalisation.
 */
export default function MissionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t, locale } = useI18n();
  const tm = t.mission;
  const missionId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [mission, setMission] = useState<Mission | null>(null);
  const [loadError, setLoadError] = useState<
    "mission_not_found" | "load" | null
  >(null);

  function applyLoad(result: LoadResult) {
    if (result.kind === "unauthorized") {
      router.push("/auth/login");
      return;
    }
    setMission(result.kind === "ok" ? result.mission : null);
    setLoadError(result.kind === "ok" ? null : result.kind);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    fetchMission(missionId).then((result) => {
      if (active) applyLoad(result);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const calendarDay = (day: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 pb-20 space-y-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
        <BottomNav />
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="min-h-screen bg-background p-4 pb-20 pt-[max(1rem,env(safe-area-inset-top))]">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tm.back}
        </Button>
        <div className="text-center mt-8 space-y-4" role="alert">
          <p className="text-muted-foreground">
            {loadError === "mission_not_found" ? tm.notFound : tm.loadError}
          </p>
          {loadError !== "mission_not_found" && (
            <Button
              variant="outline"
              onClick={() =>
                void fetchMission(missionId).then((r) => applyLoad(r))
              }
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {tm.retry}
            </Button>
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  const status = mission.status ?? "pending";
  const today =
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(
      new Date(),
    ) === mission.scheduled_date;
  const active = !["cancelled", "no_show"].includes(status);
  const pendingTask =
    mission.viewer_party === "candidate" &&
    active &&
    (!mission.completed_at ||
      !mission.candidate_reviewed ||
      (!!mission.contract_id && !mission.candidate_signed));
  const item = (index: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, delay: index * 0.05 },
  });

  return (
    <div className="min-h-screen bg-background pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <div className="bg-linear-to-br from-violet-600 to-violet-800 text-white p-4 pt-[max(1rem,env(safe-area-inset-top))] rounded-b-3xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="text-white hover:bg-white/10 mb-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tm.back}
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold" data-testid="mission-title">
              {mission.job_title}
            </h1>
            <p
              className="text-white/85 flex items-center gap-1"
              data-testid="mission-company"
            >
              <Building2 className="h-4 w-4 shrink-0" aria-hidden />
              {mission.company_name ?? "—"}
            </p>
          </div>
          <Badge
            className="bg-white/15 text-white border-white/30 shrink-0"
            data-testid="mission-status"
          >
            {tm.status[status]}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {pendingTask && (
          <motion.div {...item(0)} whileTap={{ scale: 0.98 }}>
            <Button className="w-full" asChild>
              <Link href="/tasks" data-testid="mission-go-tasks">
                <ClipboardList className="h-4 w-4 mr-2" aria-hidden />
                {tm.goToTasks}
              </Link>
            </Button>
          </motion.div>
        )}

        <motion.div {...item(1)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tm.details}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Calendar
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <span>{calendarDay(mission.scheduled_date)}</span>
                {today && (
                  <Badge variant="success" className="text-xs">
                    {tm.today}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span data-testid="mission-schedule">
                  {tm.schedule
                    .replace(
                      "{start}",
                      formatTime(mission.scheduled_start_time, locale),
                    )
                    .replace(
                      "{end}",
                      formatTime(mission.scheduled_end_time, locale),
                    )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>
                  {[mission.address, mission.city].filter(Boolean).join(", ") ||
                    "—"}
                </span>
              </div>
              <div className="pt-2 border-t space-y-1">
                <span className="text-lg font-bold text-primary">
                  {tm.perHour.replace(
                    "{amount}",
                    formatCurrency(Number(mission.hourly_rate ?? 0)),
                  )}
                </span>
                <p className="text-xs text-muted-foreground">
                  {tm.scheduleNote}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {mission.contract_id && (
          <motion.div {...item(2)} whileTap={{ scale: 0.98 }}>
            <Link href={`/contracts/${mission.contract_id}`} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">{t.contract.open}</div>
                      <div className="text-sm text-muted-foreground">
                        {
                          t.contract.status[
                            mission.contract_status ?? "pending"
                          ]
                        }
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        )}

        <motion.div {...item(3)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tm.tracking}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2" data-testid="mission-tracking">
              {mission.started_at ? (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-4 w-4" aria-hidden />
                  {tm.startedAt.replace(
                    "{time}",
                    doualaTime(mission.started_at, locale),
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground">{tm.notStarted}</div>
              )}
              {mission.completed_at && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-4 w-4" aria-hidden />
                  {tm.completedAt.replace(
                    "{time}",
                    doualaTime(mission.completed_at, locale),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <BottomNav />
    </div>
  );
}
