"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ReviewDialog } from "@/components/missions/review-dialog";
import { doualaDateTime, doualaTime } from "@/lib/utils/douala-time";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  Phone,
  FileText,
  FileSignature,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import type { Database, Tables } from "@/lib/database.types";
import {
  useAccountState,
  useAccountSuspended,
  useLatestRequest,
  useLiveRefresh,
} from "@/lib/realtime/provider";
import { isNetworkError, readSessionUser } from "@/lib/supabase/session-user";
import { plural } from "@/lib/i18n/plural";
import { ReputationStars } from "@/components/reputation/reputation-stars";
import { MissionPay } from "@/components/jobs/mission-pay";
import { isRecruitmentOpen } from "@/lib/jobs/recruitment";
import { useRecruitmentNow } from "@/lib/jobs/use-recruitment";
import { formatDayDate, formatDayHours } from "@/lib/jobs/schedule";
import { displayApplicationStatus } from "@/lib/jobs/application-status";
import { CompanyMissionIncidents } from "@/components/missions/company-mission-incidents";
import { CompanyCancellationPanel } from "@/components/jobs/company-cancellation-panel";
import {
  SelectionContractDialog,
  type SelectionResult,
} from "@/components/contracts/selection-contract-dialog";

type Job = Pick<
  Tables<"jobs">,
  | "id"
  | "title"
  | "city"
  | "quartier"
  | "start_date"
  | "start_time"
  | "end_time"
  | "positions_available"
  | "positions_filled"
  | "description"
  | "address"
  | "mission_pay_per_candidate"
  | "required_skills"
  | "required_documents"
  | "status"
  | "closed_at"
  | "applications_close_at"
  | "schedule_format"
> & {
  /** Lot 12 : calendrier de l'offre (lecture du propriétaire). */
  days: Pick<
    Tables<"job_days">,
    | "id"
    | "day_date"
    | "start_time"
    | "end_time"
    | "mission_pay_per_candidate"
    | "positions_available"
    | "positions_filled"
    | "applications_close_at"
  >[];
};

/** Réponse de GET /api/jobs/[id]/missions (lot 7c ; null possibles). */
type JobMissionRow =
  Database["public"]["Functions"]["company_job_missions"]["Returns"][number];
type JobMission = Omit<
  JobMissionRow,
  | "application_id"
  | "started_at"
  | "completed_at"
  | "completion_code"
  | "completed_via"
  | "mission_completed_at"
> & {
  application_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_code: string | null;
  completed_via:
    | "code"
    | "support"
    | "exceptional"
    | "partial"
    | "partial_support"
    | null;
  mission_completed_at: string | null;
  /** Lot 17b : désistement du candidat sur cette journée. */
  cancelled_at?: string | null;
  /** Lot 17d-2 : auteur de l'annulation (candidat ou entreprise). */
  cancelled_by?: "candidate" | "company" | null;
};

/** Réponse de GET /api/jobs/[id]/applications (colonnes autorisées, F-16). */
type Application = Omit<
  Database["public"]["Functions"]["company_job_applicants"]["Returns"][number],
  "has_photo"
> & { photo_url: string | null };

export default function CompanyJobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const ta = t.companyApplicants;
  const tcomp = ta.completion;
  const jobId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [activeTab, setActiveTab] = useState("pending");
  // Lot 12 : filtre des candidatures par journée (journées au choix).
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] =
    useState<Application | null>(null);
  const [actionType, setActionType] = useState<"select" | "reject" | null>(
    null,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const processingRef = useRef(false);
  // Pointages et heures de chaque candidature sélectionnée (lot 7c).
  // Lot 12 : une ligne par journée de mission (code de chaque journée).
  const [missions, setMissions] = useState<Map<string, JobMission[]>>(
    new Map(),
  );
  const [reviewMission, setReviewMission] = useState<{
    mission: JobMission;
    name: string;
  } | null>(null);

  const suspended = useAccountSuspended();
  // Lot 11 : dossier entreprise plus vérifié → nouvelle sélection refusée
  // en base (company_not_verified) ; le bouton est retiré, les engagements
  // existants (contrats, missions) restent accessibles.
  const account = useAccountState();
  const dossierBlocked =
    !!account?.company && account.company.verification_status !== "verified";
  const latest = useLatestRequest();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Candidature déposée ou retirée, signature, début, code, avis, places,
  // compte suspendu : l'écran relit ce qu'il a le droit de voir.
  useLiveRefresh(
    ["applications", "jobs", "contracts", "missions", "account"],
    () => loadData(),
  );

  /**
   * Relit l'offre, les candidatures, les contrats et les missions, puis les
   * applique ensemble. Seule la dernière lecture lancée est appliquée ; une
   * ressource refusée ou disparue est retirée de l'écran (seule une erreur
   * réseau conserve l'affichage précédent).
   */
  async function loadData() {
    const token = latest.begin();
    const supabase = createClient();
    // Session locale : hors ligne, l'écran garde son état au lieu de
    // rediriger vers la connexion.
    const user = await readSessionUser(supabase);
    if (user === undefined) return;
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select(
        "id, title, description, address, city, quartier, start_date, start_time, end_time, positions_available, positions_filled, mission_pay_per_candidate, required_skills, required_documents, status, closed_at, applications_close_at, schedule_format, days:job_days(id, day_date, start_time, end_time, mission_pay_per_candidate, positions_available, positions_filled, applications_close_at)",
      )
      .eq("id", jobId)
      .single();

    const res = await fetch(`/api/jobs/${jobId}/applications`).catch(
      () => null,
    );
    const nextApplications: Application[] | null = res?.ok
      ? ((await res.json()) as { applications: Application[] }).applications
      : res
        ? []
        : null;

    const missionsRes = await fetch(`/api/jobs/${jobId}/missions`, {
      cache: "no-store",
    }).catch(() => null);
    const missionRows = missionsRes?.ok
      ? (((await missionsRes.json()) as { missions: JobMission[] }).missions ??
        [])
      : [];
    const byApplication = new Map<string, JobMission[]>();
    for (const m of missionRows) {
      if (!m.application_id) continue;
      const list = byApplication.get(m.application_id) ?? [];
      list.push(m);
      byApplication.set(m.application_id, list);
    }
    if (!latest.isLatest(token)) return byApplication;
    // Lecture interrompue par le réseau : rien n'est retiré de l'écran ; la
    // reprise (retour du réseau, reconnexion) relira tout.
    if (isNetworkError(jobError) || !res || !missionsRes) {
      setLoading(false);
      return byApplication;
    }

    setJob(
      jobData
        ? {
            ...jobData,
            days: [...(jobData.days ?? [])].sort((a, b) =>
              `${a.day_date}${a.start_time}`.localeCompare(
                `${b.day_date}${b.start_time}`,
              ),
            ),
          }
        : null,
    );
    if (nextApplications !== null) {
      setApplications(nextApplications);
      // Boîte de dialogue ouverte sur une candidature retirée ou traitée
      // ailleurs : elle se ferme.
      setSelectedApplication((cur) =>
        cur &&
        nextApplications.some(
          (a) =>
            a.application_id === cur.application_id && a.status === cur.status,
        )
          ? cur
          : null,
      );
    }
    if (missionsRes) setMissions(byApplication);

    setLoading(false);
    return byApplication;
  }

  const onCandidateReviewed = async () => {
    setReviewMission(null);
    await loadData();
    toast({ title: t.mission.review.thanks, variant: "success" });
  };

  const name = (app: Application | null) =>
    app
      ? [app.first_name, app.last_initial ? `${app.last_initial}.` : null]
          .filter(Boolean)
          .join(" ")
      : "";

  /**
   * Lot 13 : issue de « Signer et sélectionner ». L'écran relit toujours
   * l'état enregistré (places, statut, contrat) ; une réponse perdue suivie
   * d'une relance retrouve la même sélection.
   */
  const onSelectionDone = async (
    result: SelectionResult | null,
    code: keyof typeof ta.errors | null,
  ) => {
    if (result) {
      toast({
        title: ta.toasts.selectedTitle,
        variant: "success",
        description: ta.toasts.selectedDesc,
      });
      setSelectedApplication(null);
      setActionType(null);
    } else if (code && code !== "terms_mismatch") {
      toast({
        title: ta.toasts.errorTitle,
        description: ta.errors[code],
        variant: "destructive",
      });
    }
    await loadData();
  };

  const handleRejectCandidate = async () => {
    if (!selectedApplication || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    const supabase = createClient();

    const { data: updated, error } = await supabase
      .from("job_applications")
      .update({
        status: "rejected",
        rejection_reason: rejectionReason || null,
      })
      .eq("id", selectedApplication.application_id)
      .select("id");

    if (error || !updated?.length) {
      toast({
        title: ta.toasts.errorTitle,
        description: ta.toasts.rejectError,
        variant: "destructive",
      });
    } else {
      toast({
        title: ta.toasts.rejectedTitle,
        variant: "success",
        description: ta.toasts.rejectedDesc,
      });
    }
    await loadData();

    setSelectedApplication(null);
    setActionType(null);
    setRejectionReason("");
    processingRef.current = false;
    setProcessing(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "en-GB",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
      },
    );
  };

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || "";
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-700">
            {ta.status.pending}
          </Badge>
        );
      case "selected":
        return (
          <Badge className="bg-green-100 text-green-700">
            {ta.status.selected}
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-100 text-red-700">
            {ta.status.rejected}
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status && status in ta.status
              ? ta.status[status as keyof typeof ta.status]
              : status}
          </Badge>
        );
    }
  };

  // Lot 13 : une ancienne présélection est comptée et traitée comme une
  // candidature en attente (statut conservé en base).
  // Lot 17b : candidature retirée après sélection (désistement du
  // candidat) : reste dans « Sélectionnées », avec ses journées annulées.
  const withdrawnAfterSelection = (a: {
    status: string | null;
    application_id: string;
  }) => a.status === "withdrawn" && missions.has(a.application_id);
  const tabOf = (a: { status: string | null; application_id: string }) =>
    withdrawnAfterSelection(a)
      ? "selected"
      : displayApplicationStatus(a.status);
  const countStatus = (status: string) =>
    String(applications.filter((a) => tabOf(a) === status).length);

  const perDay = job?.schedule_format === "per_day";
  const filteredApplications = applications.filter(
    (app) =>
      tabOf(app) === activeTab &&
      (!perDay || !dayFilter || app.job_day_id === dayFilter),
  );
  // Lot 11b : échéance de recrutement (H−24, ou H−2 si publiée en urgence)
  // reflétée à l'heure du serveur sur l'écran ouvert ; la base refuse
  // recruitment_closed. Contrats et missions restent accessibles.
  const recruitmentNow = useRecruitmentNow(job ? [job, ...job.days] : []);
  const recruitmentClosed =
    !!job && job.status === "active" && !isRecruitmentOpen(job, recruitmentNow);
  // Lot 12 : échéance et places propres à la journée d'une candidature.
  const dayOf = (app: Application) =>
    job?.days.find((d) => d.id === app.job_day_id) ?? null;
  const selectionClosedFor = (app: Application) => {
    if (!job || job.status !== "active") return false;
    const day = dayOf(app);
    return day
      ? !isRecruitmentOpen(
          { applications_close_at: day.applications_close_at },
          recruitmentNow,
        )
      : recruitmentClosed;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {ta.back}
        </Button>
        <div className="text-center mt-8">
          <p className="text-muted-foreground">{ta.jobNotFound}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {ta.back}
        </Button>

        {/* Lot 9d : travail demandé, montant par candidat, lieu, date et
            horaires, exigences, puis candidatures (action). */}
        <h1 className="break-words text-xl font-bold">{job.title}</h1>
        {job.description && (
          <p
            className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground"
            data-testid="company-job-work"
          >
            {job.description}
          </p>
        )}

        {!perDay && (
          <div className="mt-3" data-testid="company-job-pay">
            <p className="text-xs text-muted-foreground">
              {job.days.length > 1
                ? t.schedule.payPeriod.replace(
                    "{days}",
                    plural(job.days.length, t.schedule.dayCount, locale),
                  )
                : t.jobDetail.pay}
            </p>
            <MissionPay
              amount={job.mission_pay_per_candidate}
              amountClassName="text-lg text-primary"
            />
          </div>
        )}

        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
          <p className="flex items-start gap-1">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="break-words">
              {job.address ? `${job.address}, ` : ""}
              {job.quartier ? `${job.quartier}, ` : ""}
              {job.city}
            </span>
          </p>
          {job.days.length > 1 || perDay ? (
            <div data-testid="company-job-days">
              <p className="font-medium text-foreground">
                {t.schedule.formats[perDay ? "per_day" : "full_period"].title}
                {" · "}
                {plural(job.days.length, t.schedule.dayCount, locale)}
              </p>
              <ul className="mt-1 space-y-1">
                {job.days.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-baseline gap-x-2"
                    data-testid="company-job-day"
                    data-date={d.day_date}
                  >
                    <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="text-foreground">
                      {formatDayDate(d.day_date, locale)}
                    </span>
                    <span>{formatDayHours(d, t.schedule.nextDay)}</span>
                    {perDay && (
                      <span className="w-full pl-5">
                        <MissionPay
                          amount={d.mission_pay_per_candidate}
                          amountClassName="text-primary"
                        />
                        {" · "}
                        {d.positions_filled}
                        {plural(
                          d.positions_available ?? 1,
                          ta.positionsFilled,
                          locale,
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden />
                {formatDate(job.start_date)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {formatTime(job.start_time)} - {formatTime(job.end_time)}
              </span>
            </p>
          )}
          {/* Lot 17d-1 : offre clôturée par l'entreprise. */}
          {job.closed_at && (
            <p
              className="text-xs text-muted-foreground"
              role="status"
              data-testid="company-job-closed"
            >
              {ta.closedNotice.replace(
                "{date}",
                doualaDateTime(job.closed_at, locale),
              )}
            </p>
          )}
          {/* Lot 12 : au choix, chaque journée a sa propre échéance. */}
          {job.status === "active" &&
            !perDay &&
            (recruitmentClosed ? (
              <p
                className="text-xs text-muted-foreground"
                role="status"
                data-testid="company-recruitment-closed"
              >
                {ta.errors.recruitment_closed}
              </p>
            ) : (
              job.applications_close_at && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="company-recruitment-closes-at"
                >
                  {t.jobDetail.closesAt.replace(
                    "{date}",
                    doualaDateTime(job.applications_close_at, locale),
                  )}
                </p>
              )
            ))}
        </div>

        {((job.required_skills?.length ?? 0) > 0 ||
          (job.required_documents?.length ?? 0) > 0) && (
          <div className="mt-3" data-testid="company-job-requirements">
            <p className="text-xs text-muted-foreground">
              {t.jobDetail.requirements}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(job.required_skills ?? []).map((skill) => (
                <Badge key={skill} variant="secondary" className="text-xs">
                  {skill}
                </Badge>
              ))}
              {(job.required_documents ?? []).map((doc) => (
                <Badge key={doc} variant="outline" className="text-xs">
                  {(t.jobDetail.documentLabels as Record<string, string>)[
                    doc
                  ] ??
                    (t.application.documents.labels as Record<string, string>)[
                      doc
                    ] ??
                    t.application.documents.labels.autre}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-violet-600" />
            <span className="font-medium">{applications.length}</span>
            <span className="text-sm text-muted-foreground">
              {plural(applications.length, ta.applications, locale)}
            </span>
          </div>
          <div className="text-sm">
            <span className="font-medium">{job.positions_filled}</span>
            <span className="text-muted-foreground">
              {plural(job.positions_available ?? 0, ta.positionsFilled, locale)}
            </span>
          </div>
        </div>
      </div>

      {/* Applications */}
      <div className="p-4">
        {/* Lot 17d-2 : annulation de dates après sélection (ANN-06). */}
        <div className="mb-4">
          <CompanyCancellationPanel
            jobId={jobId}
            disabled={suspended}
            onDone={() => void loadData()}
          />
        </div>
        {perDay && job.days.length > 1 && (
          <div
            className="mb-3 flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label={t.schedule.datesLabel}
            data-testid="company-day-filter"
          >
            {[null, ...job.days.map((d) => d.id)].map((id) => {
              const day = job.days.find((d) => d.id === id);
              return (
                <Button
                  key={id ?? "all"}
                  size="sm"
                  variant={dayFilter === id ? "default" : "outline"}
                  aria-pressed={dayFilter === id}
                  className="shrink-0"
                  onClick={() => setDayFilter(id)}
                >
                  {day
                    ? formatDayDate(day.day_date, locale)
                    : t.schedule.allDays}
                </Button>
              );
            })}
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending" className="text-xs">
              {/* Lot 17d-1 : offre clôturée, candidatures figées
                  (historique), jamais « en attente ». */}
              {(job.closed_at ? ta.tabs.jobClosed : ta.tabs.pending).replace(
                "{count}",
                countStatus("pending"),
              )}
            </TabsTrigger>
            <TabsTrigger value="selected" className="text-xs">
              {ta.tabs.selected.replace("{count}", countStatus("selected"))}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs">
              {ta.tabs.rejected.replace("{count}", countStatus("rejected"))}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredApplications.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">{ta.empty}</p>
                </CardContent>
              </Card>
            ) : (
              filteredApplications.map((app) => (
                <Card key={app.application_id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        {app.photo_url && (
                          <AvatarImage src={app.photo_url} alt={name(app)} />
                        )}
                        <AvatarFallback>
                          {app.first_name?.[0]}
                          {app.last_initial}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{name(app)}</span>
                          {withdrawnAfterSelection(app) ? (
                            <Badge
                              variant="destructive"
                              data-testid="company-application-withdrawn"
                            >
                              {t.cancellations.companyDayCancelled}
                            </Badge>
                          ) : (
                            getStatusBadge(
                              job.closed_at &&
                                displayApplicationStatus(app.status) ===
                                  "pending"
                                ? "jobClosed"
                                : displayApplicationStatus(app.status),
                            )
                          )}
                          {app.match_score && (
                            <Badge variant="outline" className="text-xs">
                              {Math.round(app.match_score)}% match
                            </Badge>
                          )}
                        </div>

                        {app.day_date && (
                          <p
                            className="mt-1 text-sm font-medium text-foreground"
                            data-testid="applicant-day"
                            data-date={app.day_date}
                          >
                            {t.schedule.dayHeading.replace(
                              "{date}",
                              formatDayDate(app.day_date, locale),
                            )}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                          {app.distance_km !== null && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {ta.distance.replace(
                                "{km}",
                                Number(app.distance_km).toFixed(1),
                              )}
                            </span>
                          )}
                          {/* Réputation EasyJob (lot 9c) : étoiles seules,
                              sans moyenne, nombre d'avis ni motif. */}
                          <ReputationStars
                            stars={app.reputation_stars}
                            size="sm"
                            testId="applicant-reputation"
                          />
                        </div>

                        {app.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {app.skills.slice(0, 3).map((skill) => (
                              <Badge
                                key={skill}
                                variant="secondary"
                                className="text-xs"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {app.skills.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{app.skills.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}

                        {!suspended &&
                          !job.closed_at &&
                          displayApplicationStatus(app.status) ===
                            "pending" && (
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              {dossierBlocked ? (
                                <p
                                  className="w-full text-xs text-muted-foreground"
                                  data-testid="select-blocked-dossier"
                                >
                                  {ta.errors.company_not_verified}
                                </p>
                              ) : selectionClosedFor(app) ? (
                                <p
                                  className="w-full text-xs text-muted-foreground"
                                  data-testid="select-blocked-closed"
                                >
                                  {ta.errors.recruitment_closed}
                                </p>
                              ) : (
                                <Button
                                  size="sm"
                                  data-testid="select-candidate"
                                  onClick={() => {
                                    setSelectedApplication(app);
                                    setActionType("select");
                                  }}
                                >
                                  <FileSignature className="h-4 w-4 mr-1" />
                                  {ta.actions.select}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedApplication(app);
                                  setActionType("reject");
                                }}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                {ta.actions.reject}
                              </Button>
                            </div>
                          )}

                        {app.status === "selected" && (
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <Button size="sm" variant="outline">
                              <Phone className="h-4 w-4 mr-1" />
                              {ta.actions.contact}
                            </Button>
                            {app.contract_id && (
                              <>
                                <motion.div whileTap={{ scale: 0.97 }}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      router.push(
                                        `/contracts/${app.contract_id}`,
                                      )
                                    }
                                  >
                                    <FileText className="h-4 w-4 mr-1" />
                                    {ta.actions.contract}
                                  </Button>
                                </motion.div>
                                {/* Lot 13 : seule la signature de
                                    l'entreprise est indiquée ici. */}
                                <Badge
                                  variant={
                                    app.contract_to_sign ? "warning" : "success"
                                  }
                                  className="text-xs"
                                  data-testid="applicant-contract-state"
                                >
                                  {app.contract_to_sign
                                    ? ta.contractToSign
                                    : ta.contractSigned}
                                </Badge>
                              </>
                            )}
                          </div>
                        )}

                        {(app.status === "selected" ||
                          withdrawnAfterSelection(app)) &&
                          (() => {
                            const rows = missions.get(app.application_id);
                            if (!rows || rows.length === 0) return null;
                            const multi = rows.length > 1;
                            const done = rows.filter(
                              (r) => r.completed_at,
                            ).length;
                            const missionDone = rows[0].mission_completed_at;
                            return (
                              <div
                                className="mt-3 rounded-lg border p-3 text-sm space-y-3"
                                data-testid="company-mission-completion"
                              >
                                {multi && (
                                  <p
                                    className="font-medium text-foreground"
                                    data-testid="company-mission-progress"
                                  >
                                    {t.schedule.dayProgress
                                      .replace("{done}", String(done))
                                      .replace("{total}", String(rows.length))}
                                  </p>
                                )}
                                {rows.map((m) => (
                                  <div
                                    key={m.mission_day_id}
                                    className={
                                      multi
                                        ? "space-y-2 border-t pt-3 first:border-t-0 first:pt-0"
                                        : "space-y-2"
                                    }
                                    data-testid="company-mission-day"
                                    data-date={m.day_date}
                                  >
                                    <div className="text-muted-foreground">
                                      {tcomp.scheduled
                                        .replace(
                                          "{start}",
                                          doualaDateTime(
                                            m.scheduled_start_at,
                                            locale,
                                          ),
                                        )
                                        .replace(
                                          "{end}",
                                          doualaTime(
                                            m.scheduled_end_at,
                                            locale,
                                          ),
                                        )}
                                    </div>
                                    {m.completion_code && (
                                      <div className="rounded-lg bg-primary/5 p-3 space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">
                                          {multi
                                            ? t.schedule.dayCode.replace(
                                                "{date}",
                                                formatDayDate(
                                                  m.day_date,
                                                  locale,
                                                ),
                                              )
                                            : tcomp.title}
                                        </div>
                                        <div
                                          className="font-mono text-2xl font-bold tracking-[0.3em] text-primary"
                                          data-testid="completion-code"
                                        >
                                          {m.completion_code}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                          {tcomp.instruction}
                                        </p>
                                      </div>
                                    )}
                                    <div data-testid="company-mission-status">
                                      {m.cancelled_at && !m.completed_at ? (
                                        <span
                                          className="text-destructive"
                                          data-testid="company-day-cancelled"
                                        >
                                          {m.cancelled_by === "company"
                                            ? t.companyCancellation
                                                .dayCancelledByCompany
                                            : t.cancellations
                                                .companyDayCancelled}{" "}
                                          ·{" "}
                                          {doualaDateTime(
                                            m.cancelled_at,
                                            locale,
                                          )}
                                        </span>
                                      ) : m.completed_at ? (
                                        <span className="text-success flex items-center gap-1">
                                          <CheckCircle className="h-4 w-4" />
                                          {(m.completed_via === "partial"
                                            ? `${t.partialDay.dayPartial} · {time}`
                                            : m.completed_via ===
                                                "partial_support"
                                              ? `${t.partialDay.dayPartialSupport} · {time}`
                                              : m.completed_via ===
                                                  "exceptional"
                                                ? tcomp.completedByDecisionAt
                                                : m.completed_via === "support"
                                                  ? tcomp.completedBySupportAt
                                                  : tcomp.completedAt
                                          ).replace(
                                            "{time}",
                                            doualaTime(m.completed_at, locale),
                                          )}
                                        </span>
                                      ) : m.started_at ? (
                                        tcomp.startedAt.replace(
                                          "{time}",
                                          doualaTime(m.started_at, locale),
                                        )
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {tcomp.notStarted}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {multi && !missionDone && (
                                  <p className="text-xs text-muted-foreground">
                                    {t.schedule.missionDoneAfterAll}{" "}
                                    {t.schedule.unconfirmedNote}
                                  </p>
                                )}
                                {/* Lot 14 : signalements par journée ; lot 17b :
                                    pas de signalement sur une journée annulée. */}
                                {rows.some((r) => !r.cancelled_at) && (
                                  <CompanyMissionIncidents
                                    missionId={rows[0].mission_id}
                                    jobTitle={job.title}
                                    disabled={suspended}
                                    days={rows
                                      .filter((r) => !r.cancelled_at)
                                      .map((r) => ({
                                        id: r.mission_day_id,
                                        date: r.day_date,
                                        starts_at: r.scheduled_start_at,
                                        confirmed: !!r.completed_at,
                                        started: !!r.started_at,
                                        completion_available_at:
                                          r.scheduled_end_at,
                                      }))}
                                  />
                                )}
                                <p className="text-xs text-muted-foreground">
                                  {tcomp.dispute}{" "}
                                  <Link
                                    href="/help"
                                    className="text-primary underline"
                                  >
                                    {tcomp.support}
                                  </Link>
                                </p>
                                {missionDone &&
                                  (rows[0].company_reviewed ? (
                                    <div className="text-muted-foreground">
                                      {tcomp.rated}
                                    </div>
                                  ) : (
                                    <motion.div whileTap={{ scale: 0.97 }}>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        data-testid="rate-candidate"
                                        onClick={() =>
                                          setReviewMission({
                                            mission: rows[0],
                                            name: name(app),
                                          })
                                        }
                                      >
                                        {tcomp.rate}
                                      </Button>
                                    </motion.div>
                                  ))}
                              </div>
                            );
                          })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {reviewMission && (
        <ReviewDialog
          open={!!reviewMission}
          onOpenChange={(open) => !open && setReviewMission(null)}
          missionId={reviewMission.mission.mission_id}
          reviewer="company"
          name={reviewMission.name}
          onReviewed={() => void onCandidateReviewed()}
        />
      )}

      {/* Lot 13 : contrat proposé, « Signer et sélectionner ». */}
      <SelectionContractDialog
        applicationId={
          actionType === "select" && selectedApplication
            ? selectedApplication.application_id
            : null
        }
        candidateName={name(selectedApplication)}
        blockedReason={
          suspended
            ? t.realtime.actionUnavailable
            : dossierBlocked
              ? ta.errors.company_not_verified
              : selectedApplication && selectionClosedFor(selectedApplication)
                ? ta.errors.recruitment_closed
                : null
        }
        onClose={() => {
          setActionType(null);
          setSelectedApplication(null);
        }}
        onDone={(result, code) => void onSelectionDone(result, code)}
      />

      {/* Rejection Dialog */}
      <Dialog
        open={actionType === "reject" && selectedApplication !== null}
        onOpenChange={() => setActionType(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ta.rejectDialog.title}</DialogTitle>
            <DialogDescription>
              {ta.rejectDialog.description.replace(
                "{name}",
                name(selectedApplication),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={ta.rejectDialog.placeholder}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              {ta.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectCandidate}
              disabled={processing || suspended}
            >
              {processing ? ta.processing : ta.rejectDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
