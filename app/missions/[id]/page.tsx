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
  Flag,
  KeyRound,
  LifeBuoy,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/layout/bottom-nav";
import { useI18n } from "@/lib/i18n";
import { formatTime } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
import { doualaDateTime, doualaTime } from "@/lib/utils/douala-time";
import type { Database } from "@/lib/database.types";
import {
  useAccountSuspended,
  useLatestRequest,
  useLiveRefresh,
} from "@/lib/realtime/provider";
import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import {
  dayEndReached,
  missionDays,
  missionTaskInstants,
  partialCodeOpen,
} from "@/lib/tasks/candidate-tasks";
import { formatDayDate } from "@/lib/jobs/schedule";
import { formatXaf } from "@/lib/utils";
import { plural } from "@/lib/i18n/plural";
import {
  IncidentList,
  useMissionIncidents,
} from "@/components/missions/incident-list";
import {
  IncidentReportDialog,
  incidentDaysOf,
} from "@/components/missions/incident-report-dialog";
import { CompletionCodeDialog } from "@/components/missions/completion-code-dialog";
import { CancellationPanel } from "@/components/missions/cancellation-panel";
import { AcquiredAmountCard } from "@/components/missions/acquired-amount-card";
import { useToast } from "@/hooks/use-toast";

type MissionRow =
  Database["public"]["Functions"]["get_mission"]["Returns"][number];
/** Colonnes que `get_mission` peut renvoyer à null (types générés stricts). */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };
type Mission = Nullable<
  MissionRow,
  | "started_at"
  | "completed_at"
  | "contract_id"
  | "contract_viewer_signed"
  | "company_name"
  | "address"
  | "city"
  | "mission_pay_per_candidate"
  | "currency"
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
    // Erreur réseau ou serveur sur une relecture : la mission affichée reste.
    if (result.kind === "load" && mission) {
      setLoading(false);
      return;
    }
    setMission(result.kind === "ok" ? result.mission : null);
    setLoadError(result.kind === "ok" ? null : result.kind);
    setLoading(false);
  }

  const latest = useLatestRequest();
  const loadMission = async () => {
    const token = latest.begin();
    const result = await fetchMission(missionId);
    if (latest.isLatest(token)) applyLoad(result);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  useLiveRefresh(["missions", "contracts"], loadMission);
  // Lot 14 : signalements de la mission (parties seulement).
  const { incidents, reload: reloadIncidents } = useMissionIncidents(
    mission ? missionId : null,
  );
  const [reportOpen, setReportOpen] = useState(false);
  // Lot 15 : actions de fin de journée à l'échéance (heure du serveur),
  // sur un écran déjà ouvert : saisie du code ou contact du support.
  const { toast } = useToast();
  const suspended = useAccountSuspended();
  const [reportPreset, setReportPreset] = useState<string | null>(null);
  const [codeDay, setCodeDay] = useState<string | null>(null);
  const serverNow = useDeadlineNow(
    mission
      ? missionTaskInstants({
          status: mission.status,
          contract_id: mission.contract_id,
          candidate_signed: null,
          started_at: mission.started_at,
          completed_at: mission.completed_at,
          candidate_reviewed: mission.candidate_reviewed,
          start_available_at: mission.start_available_at,
          scheduled_end_at: mission.scheduled_end_at,
          days: mission.days,
        })
      : [],
  );

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
      (!!mission.contract_id && mission.contract_viewer_signed === false));
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
            {tm.statusLabel.replace("{status}", tm.status[status])}
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
                <p className="text-xs text-muted-foreground">
                  {t.pay.perCandidate}
                </p>
                <MissionPay
                  amount={mission.mission_pay_per_candidate}
                  amountClassName="text-lg text-primary"
                  testId="mission-pay"
                />
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
                      {/* Lot 13 : signature du lecteur seulement, distincte
                          de l'état de la mission ci-dessus. */}
                      <div
                        className="text-sm text-muted-foreground"
                        data-testid="mission-contract-state"
                      >
                        {mission.contract_viewer_signed
                          ? t.contract.viewerState.signed
                          : t.contract.viewerState.toSign}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        )}

        {mission.viewer_party === "candidate" &&
          active &&
          (() => {
            const days = missionDays(mission.days);
            const open = days.filter((d) => d.started_at && !d.completed_at);
            if (open.length === 0) return null;
            const multi = days.length > 1;
            return (
              <motion.div {...item(3)}>
                <Card data-testid="mission-day-actions">
                  <CardContent className="space-y-3 p-4">
                    {open.map((d) => {
                      const reached =
                        partialCodeOpen(d) || dayEndReached(d, serverNow);
                      return (
                        <div
                          key={d.id}
                          className="space-y-2"
                          data-testid="mission-day-action"
                          data-reached={reached ? "true" : "false"}
                        >
                          <p className="flex items-center gap-2 font-medium">
                            <KeyRound
                              className="h-4 w-4 text-primary"
                              aria-hidden
                            />
                            {reached
                              ? tm.tasks.validateDay
                              : d.interruption?.blocks_completion
                                ? t.partialDay.dayInterrupted
                                : tm.tasks.inProgress.replace(
                                    "{time}",
                                    doualaTime(d.ends_at, locale),
                                  )}
                            {multi ? ` · ${formatDayDate(d.date, locale)}` : ""}
                          </p>
                          {/* Interruption : étape du dossier ; accord des
                              deux parties : code reçu au montant accepté. */}
                          {d.interruption && (
                            <p
                              className="rounded-lg bg-primary/5 p-2 text-sm"
                              data-testid="mission-interruption-state"
                              data-stage={d.interruption.stage ?? ""}
                            >
                              {d.interruption.agreement
                                ? t.partialDay.codeAmount.replace(
                                    "{amount}",
                                    formatXaf(
                                      d.interruption.agreement.amount,
                                      locale,
                                    ),
                                  )
                                : d.interruption.stage
                                  ? t.partialDay.stage[d.interruption.stage]
                                  : t.partialDay.dayInterrupted}
                            </p>
                          )}
                          {reached ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <motion.div whileTap={{ scale: 0.98 }}>
                                <Button
                                  className="w-full"
                                  onClick={() => setCodeDay(d.id)}
                                  disabled={suspended}
                                  data-testid="mission-validate-day"
                                >
                                  {tm.tasks.validateDay}
                                </Button>
                              </motion.div>
                              <motion.div whileTap={{ scale: 0.98 }}>
                                <Button
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => {
                                    setReportPreset(d.id);
                                    setReportOpen(true);
                                  }}
                                  disabled={suspended}
                                  data-testid="mission-contact-support"
                                >
                                  <LifeBuoy
                                    className="mr-1 h-4 w-4"
                                    aria-hidden
                                  />
                                  {tm.tasks.contactSupport}
                                </Button>
                              </motion.div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {tm.tasks.completionAvailableAt.replace(
                                "{time}",
                                doualaDateTime(
                                  d.completion_available_at,
                                  locale,
                                ),
                              )}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })()}

        <motion.div {...item(3)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tm.tracking}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2" data-testid="mission-tracking">
              {(() => {
                // Lot 12 : état de chaque journée ; la mission n'est réalisée
                // qu'avec toutes ses journées confirmées.
                const days = missionDays(mission.days);
                if (days.length <= 1) return null;
                return (
                  <div className="space-y-2" data-testid="mission-days">
                    <p className="font-medium text-foreground">
                      {t.schedule.formats.full_period.title} ·{" "}
                      {plural(days.length, t.schedule.dayCount, locale)} ·{" "}
                      {t.schedule.dayProgress
                        .replace(
                          "{done}",
                          String(days.filter((d) => d.completed_at).length),
                        )
                        .replace("{total}", String(days.length))}
                    </p>
                    <ul className="divide-y divide-border text-sm">
                      {days.map((d) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"
                          data-testid="mission-day"
                          data-date={d.date}
                        >
                          <span>
                            {formatDayDate(d.date, locale)} ·{" "}
                            {doualaTime(d.starts_at, locale)} →{" "}
                            {doualaTime(d.ends_at, locale)}
                          </span>
                          <span
                            className={
                              d.completed_at
                                ? "text-success"
                                : d.cancelled_at
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                            }
                            data-cancelled={d.cancelled_at ? "true" : undefined}
                          >
                            {d.completed_via === "partial"
                              ? t.partialDay.dayPartial
                              : d.completed_via === "partial_support"
                                ? t.partialDay.dayPartialSupport
                                : d.cancelled_at && !d.completed_at
                                  ? mission.viewer_party === "company"
                                    ? t.cancellations.companyDayCancelled
                                    : t.cancellations.dayCancelled
                                  : d.completed_at
                                    ? d.completed_via === "exceptional"
                                      ? t.schedule.dayConfirmedByDecision
                                      : d.completed_via === "support"
                                        ? t.schedule.dayConfirmedBySupport
                                        : t.schedule.dayConfirmed
                                    : d.interruption?.closure_outcome ===
                                        "disagreement"
                                      ? t.partialDay.dayState.unresolved
                                      : d.interruption?.blocks_completion
                                        ? d.interruption.agreement
                                          ? t.partialDay.dayState.agreement
                                          : t.partialDay.dayState.under_review
                                        : d.started_at
                                          ? t.schedule.dayStarted
                                          : t.schedule.dayUpcoming}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {!mission.completed_at &&
                      !days.some((d) => d.cancelled_at) && (
                        <p className="text-xs text-muted-foreground">
                          {t.schedule.missionDoneAfterAll}{" "}
                          {t.schedule.unconfirmedNote}
                        </p>
                      )}
                  </div>
                );
              })()}
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
                  {missionDays(mission.days).some(
                    (d) =>
                      d.completed_via === "support" ||
                      d.completed_via === "exceptional",
                  ) && ` · ${t.schedule.dayConfirmedBySupport}`}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {active && (
          <motion.div {...item(4)}>
            <Card data-testid="mission-incidents">
              <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{t.incidents.title}</CardTitle>
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReportOpen(true)}
                    data-testid="mission-report-incident"
                  >
                    <Flag className="h-4 w-4 mr-1" aria-hidden />
                    {t.incidents.report}
                  </Button>
                </motion.div>
              </CardHeader>
              <CardContent>
                <IncidentList
                  incidents={incidents ?? []}
                  onChanged={() => void reloadIncidents()}
                />
              </CardContent>
            </Card>
          </motion.div>
        )}
        {/* Lots 17b–17c : annulation (candidat) et montant acquis d'un
            forfait interrompu (parties). */}
        {mission.viewer_party === "candidate" && (
          <motion.div {...item(5)}>
            <CancellationPanel missionId={mission.mission_id} />
          </motion.div>
        )}
        {missionDays(mission.days).some((d) => d.cancelled_at) &&
          missionDays(mission.days).some((d) => d.completed_at) && (
            <motion.div {...item(6)}>
              <AcquiredAmountCard missionId={mission.mission_id} />
            </motion.div>
          )}
      </div>

      <IncidentReportDialog
        open={reportOpen}
        onClose={() => {
          setReportOpen(false);
          setReportPreset(null);
        }}
        onDone={() => {
          setReportOpen(false);
          setReportPreset(null);
          void reloadIncidents();
        }}
        missionId={mission.mission_id}
        jobTitle={mission.job_title}
        party={mission.viewer_party === "company" ? "company" : "candidate"}
        days={incidentDaysOf(
          Array.isArray(mission.days)
            ? mission.days.filter(
                (d) => !(d as { cancelled_at?: string | null }).cancelled_at,
              )
            : mission.days,
        )}
        initialDayId={reportPreset}
        initialKind={reportPreset ? "code_not_received" : null}
        serverNow={serverNow}
      />

      {codeDay && (
        <CompletionCodeDialog
          open={!!codeDay}
          onOpenChange={(o) => !o && setCodeDay(null)}
          missionId={mission.mission_id}
          missionDayId={missionDays(mission.days).length > 1 ? codeDay : null}
          agreedAmount={(() => {
            const day = missionDays(mission.days).find((x) => x.id === codeDay);
            return day && partialCodeOpen(day)
              ? (day.interruption?.agreement?.amount ?? null)
              : null;
          })()}
          jobTitle={mission.job_title}
          onCompleted={(_at, done) => {
            setCodeDay(null);
            toast({
              title: done ? tm.code.successTitle : t.schedule.dayConfirmed,
              description: done ? undefined : t.schedule.missionDoneAfterAll,
              variant: "success",
            });
            void loadMission();
          }}
        />
      )}

      <BottomNav />
    </div>
  );
}
