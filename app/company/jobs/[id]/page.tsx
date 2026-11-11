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
  | "applications_close_at"
>;

/** Réponse de GET /api/jobs/[id]/missions (lot 7c ; null possibles). */
type JobMissionRow =
  Database["public"]["Functions"]["company_job_missions"]["Returns"][number];
type JobMission = Omit<
  JobMissionRow,
  "application_id" | "started_at" | "completed_at" | "completion_code"
> & {
  application_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_code: string | null;
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
  const [selectedApplication, setSelectedApplication] =
    useState<Application | null>(null);
  const [actionType, setActionType] = useState<"select" | "reject" | null>(
    null,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  // Contrat de chaque candidature sélectionnée (colonnes lisibles, lot 7b).
  const [contracts, setContracts] = useState<
    Map<string, Pick<Tables<"contracts">, "id" | "status">>
  >(new Map());
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const processingRef = useRef(false);
  // Pointages et heures de chaque candidature sélectionnée (lot 7c).
  const [missions, setMissions] = useState<Map<string, JobMission>>(new Map());
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
        "id, title, description, address, city, quartier, start_date, start_time, end_time, positions_available, positions_filled, mission_pay_per_candidate, required_skills, required_documents, status, applications_close_at",
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

    const { data: contractRows, error: contractsError } = await supabase
      .from("contracts")
      .select("id, application_id, status")
      .eq("job_id", jobId);

    const missionsRes = await fetch(`/api/jobs/${jobId}/missions`, {
      cache: "no-store",
    }).catch(() => null);
    const missionRows = missionsRes?.ok
      ? (((await missionsRes.json()) as { missions: JobMission[] }).missions ??
        [])
      : [];
    const byApplication = new Map(
      missionRows
        .filter((m) => m.application_id)
        .map((m) => [m.application_id as string, m]),
    );
    if (!latest.isLatest(token)) return byApplication;
    // Lecture interrompue par le réseau : rien n'est retiré de l'écran ; la
    // reprise (retour du réseau, reconnexion) relira tout.
    if (
      isNetworkError(jobError) ||
      isNetworkError(contractsError) ||
      !res ||
      !missionsRes
    ) {
      setLoading(false);
      return byApplication;
    }

    setJob(jobData ?? null);
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
    setContracts(
      new Map(
        (contractRows ?? []).map((c) => [
          c.application_id,
          { id: c.id, status: c.status },
        ]),
      ),
    );
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

  const handleSelectCandidate = async () => {
    if (!selectedApplication || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    const res = await fetch(
      `/api/applications/${selectedApplication.application_id}/select`,
      { method: "POST" },
    ).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      selection?: { status?: string };
    };

    // Succès seulement si la base a bien enregistré la sélection.
    if (res?.ok && body.selection?.status === "selected") {
      toast({
        title: ta.toasts.selectedTitle,
        variant: "success",
        description: ta.toasts.selectedDesc,
      });
    } else {
      toast({
        title: ta.toasts.errorTitle,
        // Requête non aboutie : message réseau ; sinon le code métier.
        description: !res
          ? ta.errors.network
          : body.code && body.code in ta.errors
            ? ta.errors[body.code as keyof typeof ta.errors]
            : ta.errors.generic,
        variant: "destructive",
      });
    }
    // L'écran affiche toujours l'état relu (places, statut).
    await loadData();

    setSelectedApplication(null);
    setActionType(null);
    processingRef.current = false;
    setProcessing(false);
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
      case "shortlisted":
        return (
          <Badge className="bg-blue-100 text-blue-700">
            {ta.status.shortlisted}
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

  const countStatus = (status: string) =>
    String(applications.filter((a) => a.status === status).length);

  const filteredApplications = applications.filter(
    (app) => app.status === activeTab,
  );
  const isFull =
    !!job && (job.positions_filled ?? 0) >= (job.positions_available ?? 1);
  // Lot 11b : échéance de recrutement (H−24, ou H−2 si publiée en urgence)
  // reflétée à l'heure du serveur sur l'écran ouvert ; la base refuse
  // recruitment_closed. Contrats et missions restent accessibles.
  const recruitmentNow = useRecruitmentNow(job ? [job] : []);
  const recruitmentClosed =
    !!job && job.status === "active" && !isRecruitmentOpen(job, recruitmentNow);

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

        <div className="mt-3" data-testid="company-job-pay">
          <p className="text-xs text-muted-foreground">{t.jobDetail.pay}</p>
          <MissionPay
            amount={job.mission_pay_per_candidate}
            amountClassName="text-lg text-primary"
          />
        </div>

        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
          <p className="flex items-start gap-1">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="break-words">
              {job.address ? `${job.address}, ` : ""}
              {job.quartier ? `${job.quartier}, ` : ""}
              {job.city}
            </span>
          </p>
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
          {job.status === "active" &&
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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" className="text-xs">
              {ta.tabs.pending.replace("{count}", countStatus("pending"))}
            </TabsTrigger>
            <TabsTrigger value="shortlisted" className="text-xs">
              {ta.tabs.shortlisted.replace(
                "{count}",
                countStatus("shortlisted"),
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
                          {getStatusBadge(app.status)}
                          {app.match_score && (
                            <Badge variant="outline" className="text-xs">
                              {Math.round(app.match_score)}% match
                            </Badge>
                          )}
                        </div>

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
                          (app.status === "pending" ||
                            app.status === "shortlisted") && (
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              {dossierBlocked ? (
                                <p
                                  className="w-full text-xs text-muted-foreground"
                                  data-testid="select-blocked-dossier"
                                >
                                  {ta.errors.company_not_verified}
                                </p>
                              ) : recruitmentClosed ? (
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
                                  <CheckCircle className="h-4 w-4 mr-1" />
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
                            {(() => {
                              const contract = contracts.get(
                                app.application_id,
                              );
                              if (!contract) return null;
                              return (
                                <>
                                  <motion.div whileTap={{ scale: 0.97 }}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        router.push(`/contracts/${contract.id}`)
                                      }
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      {ta.actions.contract}
                                    </Button>
                                  </motion.div>
                                  <Badge
                                    variant={
                                      contract.status === "completed"
                                        ? "success"
                                        : "warning"
                                    }
                                    className="text-xs"
                                  >
                                    {
                                      t.contract.status[
                                        contract.status ?? "pending"
                                      ]
                                    }
                                  </Badge>
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {app.status === "selected" &&
                          (() => {
                            const m = missions.get(app.application_id);
                            if (!m) return null;
                            return (
                              <div
                                className="mt-3 rounded-lg border p-3 text-sm space-y-2"
                                data-testid="company-mission-completion"
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
                                      doualaTime(m.scheduled_end_at, locale),
                                    )}
                                </div>
                                {m.completion_code && (
                                  <div className="rounded-lg bg-primary/5 p-3 space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      {tcomp.title}
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
                                    <p className="text-xs text-muted-foreground">
                                      {tcomp.dispute}{" "}
                                      <Link
                                        href="/help"
                                        className="text-primary underline"
                                      >
                                        {tcomp.support}
                                      </Link>
                                    </p>
                                  </div>
                                )}
                                <div data-testid="company-mission-status">
                                  {m.completed_at ? (
                                    <span className="text-success flex items-center gap-1">
                                      <CheckCircle className="h-4 w-4" />
                                      {tcomp.completedAt.replace(
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
                                {m.completed_at &&
                                  (m.company_reviewed ? (
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
                                            mission: m,
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

      {/* Selection Dialog */}
      <Dialog
        open={actionType === "select" && selectedApplication !== null}
        onOpenChange={() => setActionType(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ta.selectDialog.title}</DialogTitle>
            <DialogDescription>
              {ta.selectDialog.description.replace(
                "{name}",
                name(selectedApplication),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {isFull ? ta.errors.no_positions : ta.selectDialog.notice}
            </p>
            {suspended && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {t.realtime.actionUnavailable}
              </p>
            )}
            {!suspended && dossierBlocked && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {ta.errors.company_not_verified}
              </p>
            )}
            {!suspended && !dossierBlocked && recruitmentClosed && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {ta.errors.recruitment_closed}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              {ta.cancel}
            </Button>
            <Button
              onClick={handleSelectCandidate}
              disabled={
                processing || suspended || dossierBlocked || recruitmentClosed
              }
              data-testid="select-confirm"
            >
              {processing ? ta.processing : ta.selectDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
