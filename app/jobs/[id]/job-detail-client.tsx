"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { displayApplicationStatus } from "@/lib/jobs/application-status";
import { LoadingSpinner } from "@/components/ui/loading";
import { toast } from "@/hooks/use-toast";
import type { EssentialKey } from "@/lib/utils/profile-completion";
import { formatDate, formatTime } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useAccountSuspended, useLiveRefresh } from "@/lib/realtime/provider";
import { ReputationStars } from "@/components/reputation/reputation-stars";
import {
  MapPin,
  Clock,
  Calendar,
  Briefcase,
  Info,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  ChevronRight,
  Share2,
  Zap,
  ClipboardCheck,
  Banknote,
  IdCard,
} from "lucide-react";
import { loginHref } from "@/lib/auth/safe-redirect";
import {
  applyRefusalFeedback,
  essentialTaskHref,
} from "@/lib/jobs/application-feedback";
import { parseDocumentRequirementDetail } from "@/lib/matching/skill-document-requirements";
import { useCniState } from "@/lib/utils/use-cni-state";
import {
  cniExpiredDetailSchema,
  isCniExpiredState,
  type CniExpiredState,
  type CniProfileFields,
} from "@/lib/utils/cni-validity";
import { taskHref } from "@/lib/tasks/candidate-tasks";
import { useJobUrgent } from "@/lib/jobs/use-job-urgency";
import { isRecruitmentOpen } from "@/lib/jobs/recruitment";
import { useRecruitmentNow } from "@/lib/jobs/use-recruitment";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { JobDaysList } from "@/components/jobs/job-days-list";
import {
  dayChoosable as isDayChoosable,
  dayState,
  droppedSelection,
  type CandidateJobDay,
} from "@/lib/jobs/day-state";
import { useJobDays } from "@/lib/jobs/use-job-days";
import {
  formatDayDate,
  formatDayHours,
  parseBlockedDays,
  type DayBlockReason,
} from "@/lib/jobs/schedule";
import { plural } from "@/lib/i18n/plural";
import { formatXaf } from "@/lib/utils";

interface JobDetailClientProps {
  job: {
    id: string;
    title: string;
    address: string;
    quartier?: string | null;
    city: string;
    latitude?: number | null;
    longitude?: number | null;
    description: string;
    mission_pay_per_candidate: number;
    start_date: string;
    end_date?: string | null;
    start_time: string;
    end_time: string;
    status?: string | null;
    /** Lot 12 : période complète ou journées au choix. */
    schedule_format?: string | null;
    positions_available: number | null;
    positions_filled: number | null;
    /** Lot 11b : fin des candidatures (H−24, ou H−2 si publiée en urgence). */
    applications_close_at?: string | null;
    company?: {
      company_name?: string | null;
      logo_url?: string | null;
      sector?: string | null;
      description?: string | null;
      /** Réputation EasyJob de l'entreprise (étoiles seules, lot 9c). */
      reputation_stars?: number | null;
      [key: string]: string | number | null | undefined;
    };
    category?: {
      name_fr?: string;
      name_en?: string;
    } | null;
    required_skills?: string[] | null;
    required_documents?: string[] | null;
    dress_code?: string | null;
    special_instructions?: string | null;
  };
  /** Lot 12 : journées de l'offre (`job_days_for_candidate`). */
  days?: CandidateJobDay[];
  /**
   * Lot 12 : la lecture serveur des journées a échoué. Rien n'est alors
   * présenté comme disponible (vérification impossible, « Réessayer »).
   */
  daysFailed?: boolean;
  userApplication: {
    id: string;
    status?: string | null;
  } | null;
  isLoggedIn: boolean;
  /** Essentiels manquants (identité/CNI/Momo) — postulation bloquée côté serveur. */
  missingEssentials?: EssentialKey[];
  /** Champs CNI du candidat connecté (affichage du refus « CNI expirée »). */
  cni?: CniProfileFields | null;
  /**
   * Lot 11 : false si le dossier de l'entreprise n'est plus vérifié (offre
   * lisible seulement par un candidat ayant déjà postulé). La base refuse
   * de toute façon la candidature (`job_not_available`).
   */
  acceptingApplications?: boolean;
  /**
   * Lot 11b : échéance atteinte à la lecture serveur (`job_availability` =
   * `closed`). L'écran ouvert bascule aussi seul à l'échéance.
   */
  recruitmentClosedAtLoad?: boolean;
}

/** Section du détail : titre visible, contenu en carte. */
function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-4" data-testid={id}>
      <h2
        id={id}
        className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary"
      >
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      <Card>
        <CardContent className="p-4">{children}</CardContent>
      </Card>
    </section>
  );
}

export function JobDetailClient({
  job,
  days: initialDays = [],
  daysFailed = false,
  userApplication,
  isLoggedIn,
  missingEssentials: initialMissingEssentials = [],
  cni = null,
  acceptingApplications = true,
  recruitmentClosedAtLoad = false,
}: JobDetailClientProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const tj = t.jobDetail;
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);
  const [showBlockedModal, setShowBlockedModal] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  // Statut réel de la candidature (lot 9) : une candidature retirée ou
  // refusée n'est plus présentée comme « envoyée ».
  // Lot 13 : une ancienne présélection s'affiche et se retire comme une
  // candidature en attente.
  const statusOf = (a: typeof userApplication) =>
    a ? (displayApplicationStatus(a.status) ?? "pending") : null;
  const [applicationStatus, setApplicationStatus] = React.useState<
    string | null
  >(statusOf(userApplication));
  // Lot 12 : au choix, l'offre reste proposée tant qu'une journée est
  // accessible ; « déjà postulé » quand il ne reste rien à choisir.
  const hasApplied = applicationStatus !== null;
  const [showWithdrawModal, setShowWithdrawModal] = React.useState(false);
  // Lot 12 : candidature d'une journée précise (journées au choix).
  const [withdrawTarget, setWithdrawTarget] = React.useState<string | null>(
    null,
  );
  const [withdrawing, setWithdrawing] = React.useState(false);
  // Pré-rempli côté serveur (page) ; le POST renvoie la liste à jour.
  const [missingEssentials, setMissingEssentials] = React.useState(
    initialMissingEssentials,
  );
  // État de la CNI renvoyé par un refus `cni_expired` (prioritaire sur le
  // calcul local, la base tranche).
  const [refusedCni, setRefusedCni] = React.useState<CniExpiredState | null>(
    null,
  );
  // Relecture serveur (router.refresh) : l'état local suit les nouvelles
  // props (candidature retirée ou refusée ailleurs, profil vérifié…).
  const [seenProps, setSeenProps] = React.useState({
    userApplication,
    initialMissingEssentials,
    cni,
  });
  if (
    seenProps.userApplication !== userApplication ||
    seenProps.initialMissingEssentials !== initialMissingEssentials ||
    seenProps.cni !== cni
  ) {
    setSeenProps({ userApplication, initialMissingEssentials, cni });
    setApplicationStatus(statusOf(userApplication));
    setMissingEssentials(initialMissingEssentials);
    setRefusedCni(null);
  }

  const suspended = useAccountSuspended();
  // Offre retirée, modifiée ou complète ; candidature ; vérification du
  // profil : la page serveur est relue (une offre devenue invisible mène à
  // la page introuvable).
  // Lot 12 : journées et compatibilité avec les engagements déjà
  // sélectionnés du candidat, relues par la RPC (verdict de la base) à
  // chaque signal privé, reconnexion ou retour au premier plan, sans
  // relecture périodique. Une sélection reçue ailleurs pendant la
  // consultation arrive par le signal « applications ».
  const {
    days,
    status: daysStatus,
    loading: daysLoading,
    reload: reloadDays,
  } = useJobDays(job.id, initialDays, daysFailed);
  // Lecture en échec : jamais interprétée comme « disponible ».
  const daysUnverified = daysStatus === "error";
  const refreshAll = () => {
    router.refresh();
    void reloadDays();
  };
  useLiveRefresh(
    ["public:jobs", "jobs", "applications", "missions", "profile", "account"],
    refreshAll,
  );

  const urgent = useJobUrgent(job);
  // Lot 11b : minuterie locale sur l'heure du serveur ; la base refuse de
  // toute façon après l'échéance (recruitment_closed). Le badge « Urgente »
  // n'entre pas dans ce calcul.
  // Lot 12 : chaque journée a sa propre échéance (format au choix) ; la
  // même minuterie couvre l'offre et ses journées.
  const recruitmentNow = useRecruitmentNow([job, ...days]);
  const perDay = job.schedule_format === "per_day";
  const multiDay = days.length > 1;
  const [selectedDays, setSelectedDays] = React.useState<string[]>([]);
  const dayChoosable = (d: CandidateJobDay) =>
    perDay && isDayChoosable(d, recruitmentNow);
  const anyChoosable = days.some(dayChoosable);
  // Journée encore en recrutement, même incompatible pour ce candidat : une
  // incompatibilité n'est pas une clôture.
  const anyRecruiting =
    perDay &&
    days.some((d) => {
      const state = dayState(d, recruitmentNow);
      return state === "open" || state === "conflict";
    });
  const anyConflict = days.some(
    (d) => dayState(d, recruitmentNow) === "conflict",
  );
  const anyDayApplied = days.some((d) => d.my_application_status);
  // Seules les journées encore accessibles restent cochées.
  const chosenDays = days.filter(
    (d) => dayChoosable(d) && !!d.day_id && selectedDays.includes(d.day_id),
  );
  // Journée cochée devenue inaccessible (sélection reçue ailleurs, échéance,
  // dernière place prise) : elle est décochée et le changement est expliqué
  // avant toute confirmation. Sans lecture vérifiée, rien n'est déduit.
  const [selectionNotice, setSelectionNotice] = React.useState<
    { id: string; date: string; reason: DayBlockReason }[]
  >([]);
  const dropped =
    perDay && !daysUnverified
      ? droppedSelection(selectedDays, days, recruitmentNow)
      : [];
  if (dropped.length > 0) {
    setSelectedDays((prev) =>
      prev.filter((id) => !dropped.some((d) => d.id === id)),
    );
    // Une journée à laquelle le candidat vient de postuler porte déjà son
    // état : seules les pertes subies sont expliquées.
    const explained = dropped.flatMap((d) =>
      d.reason && d.reason !== "already_applied"
        ? [{ id: d.id, date: d.date, reason: d.reason }]
        : [],
    );
    if (explained.length > 0) {
      setSelectionNotice((prev) => [
        ...prev.filter((p) => !explained.some((e) => e.id === p.id)),
        ...explained,
      ]);
    }
  }
  const toggleDay = (dayId: string) => {
    setSelectionNotice([]);
    setSelectedDays((prev) =>
      prev.includes(dayId) ? prev.filter((x) => x !== dayId) : [...prev, dayId],
    );
  };
  const recruitmentClosed =
    acceptingApplications &&
    (perDay
      ? !daysUnverified && !anyRecruiting
      : recruitmentClosedAtLoad || !isRecruitmentOpen(job, recruitmentNow));
  const appliedForAction = perDay
    ? !daysUnverified && anyDayApplied && !anyRecruiting
    : hasApplied;
  // Période complète (ou offre d'une seule journée) : une seule journée
  // incompatible empêche la candidature à l'ensemble.
  const periodConflicts =
    !perDay && !hasApplied
      ? days.filter((d) => dayState(d, recruitmentNow) === "conflict")
      : [];
  const periodBlocked = periodConflicts.length > 0;
  const applyBlocked =
    daysUnverified || periodBlocked || (perDay && chosenDays.length === 0);

  const te = t.profile.essential;
  const essentialsMissingLabels = missingEssentials.map((k) => te[k]);

  // Lot 9d : CNI expirée ou renouvellement non approuvé → refus de toute
  // nouvelle candidature. Affiché avant de proposer « Postuler ».
  // Décision admin : signal `profile` → relecture de la page (nouvelles
  // props) ; échéance franchie écran ouvert : minuterie locale.
  const localCni = useCniState(cni);
  const cniBlock: CniExpiredState | null =
    refusedCni ?? (localCni && isCniExpiredState(localCni) ? localCni : null);
  const cniBlocked = isLoggedIn && !appliedForAction && cniBlock !== null;
  const essentialsBlocked =
    isLoggedIn &&
    !cniBlocked &&
    missingEssentials.length > 0 &&
    !appliedForAction;

  const categoryName =
    locale === "fr" ? job.category?.name_fr : job.category?.name_en;

  // Durée prévue, affichée pour l'organisation du candidat. Elle n'entre
  // dans aucun calcul : la rémunération est un montant fixe par mission.
  const calculateDuration = (start: string, end: string) => {
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    let hours = endH - startH + (endM - startM) / 60;
    if (hours < 0) hours += 24; // Handle overnight shifts
    return Math.round(hours * 10) / 10;
  };

  const duration = calculateDuration(job.start_time, job.end_time);

  const docLabel = (type: string) => {
    const own = tj.documentLabels as Record<string, string>;
    const labels = t.application.documents.labels as Record<string, string>;
    return own[type] ?? labels[type] ?? labels.autre;
  };
  const skills = job.required_skills ?? [];
  const documents = job.required_documents ?? [];
  const hasRequirements =
    skills.length > 0 ||
    documents.length > 0 ||
    !!job.dress_code ||
    !!job.special_instructions;

  const handleApply = async () => {
    if (!isLoggedIn) {
      router.push(loginHref(`/jobs/${job.id}`));
      return;
    }

    setApplying(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Lot 12 : journées choisies, envoyées ensemble (tout ou rien).
        ...(perDay
          ? {
              body: JSON.stringify({
                day_ids: chosenDays.map((d) => d.day_id),
              }),
            }
          : {}),
      });

      if (res.ok) {
        if (perDay) {
          setSelectedDays([]);
          setSelectionNotice([]);
        } else {
          setApplicationStatus("pending");
        }
        refreshAll();
        setShowConfirmModal(false);
        toast({
          title: t.application.sentToast.title,
          description: t.application.sentToast.desc,
          variant: "success",
          action: {
            label: t.application.actions.myApplications,
            href: "/my-jobs",
          },
        });
      } else {
        const body = ((await res.json().catch(() => null)) ?? {}) as {
          error?: string;
          code?: string;
          missing?: EssentialKey[];
          requirement?: unknown;
          state?: unknown;
          days?: unknown;
        };
        // SRS §6.6/§11.5 (T8.3) — gate `users.is_verified` : le serveur
        // renvoie la liste informationnelle des champs à compléter.
        if (
          (body.code === "profile_not_verified" ||
            body.code === "essentials_incomplete") &&
          Array.isArray(body.missing)
        ) {
          setMissingEssentials(body.missing);
          setShowConfirmModal(false);
          setShowBlockedModal(true);
        } else if (body.code === "job_days_unavailable") {
          // Journées bloquantes nommées ; rien n'a été envoyé.
          setShowConfirmModal(false);
          const blocked = parseBlockedDays(JSON.stringify({ days: body.days }));
          toast({
            title: t.schedule.blocked.title,
            description: [
              ...blocked.map((b) =>
                t.schedule.blocked[b.reason].replace(
                  "{date}",
                  formatDayDate(b.date, locale),
                ),
              ),
              t.schedule.blocked.none,
            ].join(" "),
            variant: "destructive",
          });
          refreshAll();
        } else if (body.code === "schedule_conflict") {
          setShowConfirmModal(false);
          const conflictDays = Array.isArray(body.days)
            ? body.days.filter((d): d is string => typeof d === "string")
            : [];
          toast({
            title: t.application.errorTitle,
            description: t.schedule.conflict.replace(
              "{days}",
              conflictDays.map((d) => formatDayDate(d, locale)).join(", "),
            ),
            variant: "destructive",
          });
          // Écran périmé : le conflit est maintenant affiché.
          refreshAll();
        } else {
          setShowConfirmModal(false);
          const cniDetail =
            body.code === "cni_expired"
              ? cniExpiredDetailSchema.safeParse({ state: body.state })
              : null;
          const cniRefusal = cniDetail?.success ? cniDetail.data.state : null;
          if (body.code === "cni_expired") {
            setRefusedCni(cniRefusal ?? "expired");
          }
          // Message dans la langue de l'interface à partir du code métier ;
          // `error` reste en anglais pour les autres appelants.
          const feedback = applyRefusalFeedback(
            {
              status: res.status,
              code: body.code,
              requirement: parseDocumentRequirementDetail(
                body.requirement ? JSON.stringify(body.requirement) : null,
              ),
              cniState: cniRefusal,
            },
            t.application,
            `/jobs/${job.id}`,
          );
          toast({ ...feedback, variant: "destructive" });
          // Offre complète, retirée ou déjà postulée : l'écran est relu.
          if (body.code === "already_applied" || body.code === "no_positions") {
            refreshAll();
          }
        }
      }
    } catch {
      // Requête non aboutie (réseau) : rien n'a changé, l'utilisateur peut
      // réessayer depuis le même bouton.
      setShowConfirmModal(false);
      toast({
        ...applyRefusalFeedback(
          { status: null },
          t.application,
          `/jobs/${job.id}`,
        ),
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    const tw = t.application.withdraw;
    try {
      const res = await fetch(
        `/api/jobs/${job.id}/apply${
          withdrawTarget
            ? `?application=${encodeURIComponent(withdrawTarget)}`
            : ""
        }`,
        { method: "DELETE" },
      );
      const body = ((await res.json().catch(() => null)) ?? {}) as {
        code?: string;
        application?: { status?: string };
      };
      // Succès seulement si la base a bien enregistré le retrait.
      if (res.ok && body.application?.status === "withdrawn") {
        if (!withdrawTarget) setApplicationStatus("withdrawn");
        setWithdrawTarget(null);
        setShowWithdrawModal(false);
        toast({
          title: tw.doneTitle,
          description: tw.doneDesc,
          variant: "success",
          action: {
            label: t.application.actions.myApplications,
            href: "/my-jobs",
          },
        });
        refreshAll();
        return;
      }
      setShowWithdrawModal(false);
      toast({
        title: tw.errorTitle,
        description:
          body.code && body.code in tw.errors
            ? tw.errors[body.code as keyof typeof tw.errors]
            : tw.errors.generic,
        variant: "destructive",
      });
      refreshAll();
    } catch {
      setShowWithdrawModal(false);
      toast({
        title: tw.errorTitle,
        description: t.application.refusals.network,
        variant: "destructive",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  // Partage natif, sinon copie du lien (navigateurs de bureau, ou partage
  // natif indisponible). Une annulation par l'utilisateur ne copie rien.
  const handleShare = async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: job.title,
          text: `${job.title} - ${job.company?.company_name ?? ""}`,
          url,
        });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: tj.shareCopied, variant: "success" });
    } catch {
      toast({ title: tj.shareFailed, variant: "destructive" });
    }
  };

  // Journées retirées du choix : expliqué dans la section des journées, ou
  // dans la confirmation si elle est ouverte (un seul message à la fois).
  const selectionNoticeBlock =
    selectionNotice.length > 0 ? (
      <div
        role="status"
        data-testid="selection-changed"
        className="rounded-xl border border-warning/20 bg-warning/10 p-3 text-sm text-foreground"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.schedule.selectionChanged}</p>
            <ul className="mt-1 space-y-0.5">
              {selectionNotice.map((n) => (
                <li key={n.id} data-testid="selection-changed-day">
                  {t.schedule.blocked[n.reason].replace(
                    "{date}",
                    formatDayDate(n.date, locale),
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              {plural(
                selectionNotice.length,
                t.schedule.selectionChangedHint,
                locale,
              )}
              {selectionNotice.some((n) => n.reason === "schedule_conflict") &&
                ` ${t.schedule.conflictRule}`}
            </p>
          </div>
        </div>
      </div>
    ) : null;

  const applicationCard = hasApplied
    ? (() => {
        const st =
          t.application.status[
            (applicationStatus ??
              "pending") as keyof typeof t.application.status
          ] ?? t.application.status.pending;
        const closed =
          applicationStatus === "withdrawn" ||
          applicationStatus === "rejected" ||
          applicationStatus === "no_show";
        return (
          <Card
            className={
              closed
                ? "mb-4 border-border bg-muted/40"
                : "mb-4 border-success/20 bg-success/5"
            }
            data-testid="application-status"
            data-status={applicationStatus ?? undefined}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {closed ? (
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{st.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {st.desc}
                  </p>
                  {applicationStatus === "selected" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => router.push("/tasks")}
                    >
                      {t.application.actions.tasks}
                    </Button>
                  )}
                  {applicationStatus === "pending" && !suspended && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setShowWithdrawModal(true)}
                      data-testid="application-withdraw"
                    >
                      {t.application.withdraw.button}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-[calc(10rem+env(safe-area-inset-bottom))]">
      {/* En-tête : travail demandé (titre, entreprise, urgence) */}
      <div className="bg-linear-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <Header
          title=""
          showBack
          className="bg-transparent"
          rightAction={
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => void handleShare()}
              aria-label={tj.share}
              title={tj.share}
              data-testid="job-share"
              className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <Share2 className="h-5 w-5" aria-hidden />
            </motion.button>
          }
        />

        <div className="px-4 pb-6">
          {urgent && (
            <Badge
              className="mb-2 border-white/30 bg-white/20 text-white"
              data-testid="job-urgent-badge"
              title={t.jobs.urgentLabel}
            >
              <Zap className="mr-1 h-3 w-3" aria-hidden />
              {t.jobs.urgentBadge}
            </Badge>
          )}

          <h1 className="mb-2 break-words text-2xl font-bold">{job.title}</h1>

          <div className="flex items-center gap-2 text-white/80">
            <Briefcase className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{job.company?.company_name}</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 px-4 pt-4">
        {/* 1. Travail demandé */}
        <Section
          id="job-work"
          title={tj.work}
          icon={<ClipboardCheck className="h-4 w-4" />}
        >
          {categoryName && (
            <p className="mb-2 text-sm font-medium text-foreground">
              {categoryName}
            </p>
          )}
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
            {job.description}
          </p>
        </Section>

        {/* 2. Montant par candidat */}
        <Section
          id="job-pay"
          title={tj.pay}
          icon={<Banknote className="h-4 w-4" />}
        >
          {perDay ? (
            <p
              className="text-2xl font-bold text-primary"
              data-testid="job-detail-pay"
            >
              {(() => {
                const pays = days
                  .map((d) => d.mission_pay_per_candidate)
                  .filter((x): x is number => typeof x === "number");
                if (pays.length === 0) return null;
                const min = Math.min(...pays);
                const max = Math.max(...pays);
                return min === max
                  ? t.schedule.payPerDay.replace(
                      "{amount}",
                      formatXaf(min, locale),
                    )
                  : t.schedule.payFromTo
                      .replace("{min}", formatXaf(min, locale))
                      .replace("{max}", formatXaf(max, locale));
              })()}
            </p>
          ) : (
            <>
              <MissionPay
                amount={job.mission_pay_per_candidate}
                amountClassName="text-2xl text-primary"
                testId="job-detail-pay"
              />
              {multiDay && (
                <p
                  className="mt-1 text-sm text-muted-foreground"
                  data-testid="job-detail-pay-period"
                >
                  {t.schedule.payPeriod.replace(
                    "{days}",
                    plural(days.length, t.schedule.dayCount, locale),
                  )}
                </p>
              )}
            </>
          )}
        </Section>

        {/* 3. Lieu */}
        <Section
          id="job-location"
          title={tj.location}
          icon={<MapPin className="h-4 w-4" />}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium text-foreground">
                {job.address}
              </p>
              <p className="text-sm text-muted-foreground">
                {job.quartier && `${job.quartier}, `}
                {job.city}
              </p>
            </div>
            {job.latitude && job.longitude && (
              <a
                href={`https://www.google.com/maps?q=${job.latitude},${job.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={tj.openMap}
                className="flex items-center gap-1 text-sm font-medium text-primary"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            )}
          </div>
        </Section>

        {/* 4. Date et horaires */}
        <Section
          id="job-schedule"
          title={tj.schedule}
          icon={<Calendar className="h-4 w-4" />}
        >
          {perDay || multiDay ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {perDay
                  ? t.schedule.chooseDaysHint
                  : t.schedule.periodCommitment}
              </p>
              <JobDaysList
                days={days}
                perDay={perDay}
                now={recruitmentNow}
                selected={selectedDays}
                onToggle={toggleDay}
                canChoose={
                  acceptingApplications &&
                  !suspended &&
                  !cniBlocked &&
                  !essentialsBlocked
                }
                unverified={daysUnverified}
                onWithdraw={(applicationId) => {
                  setWithdrawTarget(applicationId);
                  setShowWithdrawModal(true);
                }}
                withdrawDisabled={suspended || withdrawing}
              />
              {anyConflict &&
                (periodBlocked ? (
                  <p
                    className="text-sm text-foreground"
                    data-testid="period-conflict-detail"
                  >
                    {plural(
                      periodConflicts.length,
                      t.schedule.periodConflict,
                      locale,
                    ).replace(
                      "{dates}",
                      periodConflicts
                        .map((d) => formatDayDate(d.day_date, locale))
                        .join(", "),
                    )}{" "}
                    {t.schedule.conflictRule}
                  </p>
                ) : (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="job-conflict-rule"
                  >
                    {t.schedule.conflictRule}
                    {perDay && anyChoosable
                      ? ` ${t.schedule.conflictOthersOpen}`
                      : ""}
                  </p>
                ))}
              {!showConfirmModal && selectionNoticeBlock}
              {!perDay &&
                acceptingApplications &&
                !recruitmentClosed &&
                job.applications_close_at && (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="job-closes-at"
                  >
                    {tj.closesAt.replace(
                      "{date}",
                      doualaDateTime(job.applications_close_at, locale),
                    )}
                  </p>
                )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Calendar
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div>
                  <p className="font-medium capitalize text-foreground">
                    {formatDate(job.start_date, locale)}
                  </p>
                  {job.end_date && job.end_date !== job.start_date && (
                    <p className="text-sm text-muted-foreground">
                      {tj.dateRangeTo} {formatDate(job.end_date, locale)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div>
                  <p className="font-medium text-foreground">
                    {formatTime(job.start_time, locale)} -{" "}
                    {formatTime(job.end_time, locale)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tj.duration.replace(
                      "{hours}",
                      duration.toLocaleString(
                        locale === "en" ? "en-US" : "fr-FR",
                      ),
                    )}
                  </p>
                </div>
              </div>
              {acceptingApplications &&
                !recruitmentClosed &&
                job.applications_close_at && (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="job-closes-at"
                  >
                    {tj.closesAt.replace(
                      "{date}",
                      doualaDateTime(job.applications_close_at, locale),
                    )}
                  </p>
                )}
              {periodBlocked && (
                <p
                  className="text-sm text-foreground"
                  data-testid="period-conflict-detail"
                >
                  {t.schedule.singleConflict} {t.schedule.conflictRule}
                </p>
              )}
            </div>
          )}
        </Section>

        {/* 5. Exigences */}
        <Section
          id="job-requirements"
          title={tj.requirements}
          icon={<IdCard className="h-4 w-4" />}
        >
          {hasRequirements ? (
            <div className="space-y-3">
              {skills.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    {tj.requiredSkills}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <Badge key={skill} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {documents.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    {tj.requiredDocuments}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {documents.map((doc) => (
                      <Badge key={doc} variant="outline">
                        {docLabel(doc)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.dress_code && (
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {tj.dressCode}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {job.dress_code}
                  </p>
                </div>
              )}
              {job.special_instructions && (
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {tj.specialInstructions}
                  </p>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {job.special_instructions}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tj.noRequirement}</p>
          )}
        </Section>

        {/* 6. Action : état de la candidature (l'action principale reste
            fixée au-dessus de la barre d'onglets) */}
        {applicationCard}

        {/* Entreprise */}
        {job.company && (
          <Section
            id="job-company"
            title={tj.company}
            icon={<Briefcase className="h-4 w-4" />}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                {job.company.logo_url ? (
                  <img
                    src={job.company.logo_url}
                    alt={job.company.company_name ?? ""}
                    className="h-full w-full rounded-xl object-cover"
                  />
                ) : (
                  <Briefcase className="h-6 w-6 text-primary" aria-hidden />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {job.company.company_name}
                </p>
                {job.company.sector && (
                  <p className="text-sm text-muted-foreground">
                    {job.company.sector}
                  </p>
                )}
                <ReputationStars
                  stars={job.company.reputation_stars}
                  size="sm"
                  className="mt-1"
                  testId="company-reputation"
                />
              </div>
            </div>
            {job.company.description && (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {job.company.description}
              </p>
            )}
          </Section>
        )}
      </div>

      {/* Action principale, au-dessus de la barre d'onglets candidat
          (h-16 + bordure de 1 px + zone sûre), toujours affichée sur /jobs/*. */}
      <div
        className="fixed bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 p-4 backdrop-blur-xl"
        data-testid="job-primary-action"
      >
        {!acceptingApplications && (
          <p
            role="status"
            className="mb-2 text-sm text-muted-foreground"
            data-testid="job-unavailable-notice"
          >
            {appliedForAction ? tj.unavailableApplied : tj.unavailableBody}
          </p>
        )}
        {recruitmentClosed && (
          <p
            role="status"
            className="mb-2 text-sm text-muted-foreground"
            data-testid="job-closed-notice"
          >
            {appliedForAction ? tj.closedApplied : tj.closedBody}
          </p>
        )}
        {daysUnverified && (
          <div
            role="alert"
            data-testid="days-unverified"
            className="mb-2 flex items-start gap-3"
          >
            <p
              id="days-unverified-reason"
              className="min-w-0 flex-1 text-sm text-destructive"
            >
              {t.schedule.unverified}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void reloadDays()}
              disabled={daysLoading}
              data-testid="days-retry"
            >
              {t.common.retry}
            </Button>
          </div>
        )}
        {(!acceptingApplications || recruitmentClosed) && !appliedForAction ? (
          <Button
            variant="outline"
            className="w-full"
            size="lg"
            data-testid="job-browse-others"
            onClick={() => router.push("/jobs")}
          >
            {tj.backToJobs}
          </Button>
        ) : appliedForAction ? (
          <Button
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => router.push("/my-jobs")}
          >
            {t.application.actions.myApplications}
          </Button>
        ) : cniBlocked && cniBlock ? (
          <>
            <p
              id="cni-blocked-reason"
              role="status"
              data-testid="cni-blocked-reason"
              data-state={cniBlock}
              className={`mb-2 text-sm ${
                cniBlock === "renewal_pending"
                  ? "text-muted-foreground"
                  : "text-destructive"
              }`}
            >
              {t.application.cni[cniBlock]}
            </p>
            {cniBlock === "renewal_rejected" && cni?.cni_rejection_reason && (
              <p
                className="mb-2 text-xs text-destructive"
                data-testid="cni-blocked-motive"
              >
                {t.tasks.cni.reason.replace(
                  "{reason}",
                  cni.cni_rejection_reason,
                )}
              </p>
            )}
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                variant={cniBlock === "renewal_pending" ? "outline" : "default"}
                className="w-full"
                size="lg"
                aria-describedby="cni-blocked-reason"
                data-testid="cni-blocked-action"
                onClick={() => router.push(taskHref("cni"))}
              >
                <ShieldAlert className="mr-2 h-4 w-4" aria-hidden />
                {cniBlock === "renewal_pending"
                  ? t.application.actions.trackRenewal
                  : t.application.actions.renewCni}
              </Button>
            </motion.div>
          </>
        ) : essentialsBlocked ? (
          <>
            <p
              id="essentials-blocked-reason"
              className="mb-2 text-sm text-amber-700 dark:text-amber-300"
            >
              {te.bannerBody.replace(
                "{missing}",
                essentialsMissingLabels.join(", "),
              )}
            </p>
            <Button
              variant="outline"
              className="w-full border-amber-400 text-amber-600 dark:text-amber-400"
              size="lg"
              aria-describedby="essentials-blocked-reason"
              onClick={() => router.push(essentialTaskHref(missingEssentials))}
            >
              <ShieldAlert className="mr-2 h-4 w-4" aria-hidden />
              {te.cta}
            </Button>
          </>
        ) : (
          <>
            {!daysUnverified &&
              (periodBlocked || (perDay && !anyChoosable)) && (
                <p
                  id="schedule-blocked-reason"
                  role="status"
                  data-testid="schedule-blocked-reason"
                  className="mb-2 flex items-start gap-2 text-sm text-foreground"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  <span>
                    {periodBlocked
                      ? t.schedule.applyBlockedConflict
                      : t.schedule.noCompatibleDay}
                  </span>
                </p>
              )}
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => setShowConfirmModal(true)}
                className="w-full"
                size="lg"
                disabled={suspended || applyBlocked}
                aria-describedby={
                  daysUnverified
                    ? "days-unverified-reason"
                    : periodBlocked || (perDay && !anyChoosable)
                      ? "schedule-blocked-reason"
                      : undefined
                }
                data-testid="job-apply"
              >
                {perDay
                  ? chosenDays.length === 0
                    ? t.schedule.selectDayFirst
                    : plural(chosenDays.length, t.schedule.applyDays, locale)
                  : tj.applyNow}
                <ChevronRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
            </motion.div>
            {suspended && (
              <p className="mt-2 text-center text-xs text-destructive">
                {t.realtime.actionUnavailable}
              </p>
            )}
          </>
        )}
      </div>

      {/* Essentiels manquants — le POST /apply renvoie 403 profile_not_verified
          (T8.3 — `users.is_verified` est la source de vérité, la liste est
          informationnelle) */}
      <Modal
        isOpen={showBlockedModal}
        onClose={() => setShowBlockedModal(false)}
        title={te.bannerTitle}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {te.bannerBody.replace(
                  "{missing}",
                  essentialsMissingLabels.join(", "),
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowBlockedModal(false)}
              className="flex-1"
            >
              {tj.close}
            </Button>
            <Button
              onClick={() => {
                setShowBlockedModal(false);
                router.push(essentialTaskHref(missingEssentials));
              }}
              className="flex-1"
              data-testid="essentials-open-task"
            >
              {t.application.actions.openTask}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Retrait de la candidature (lot 9) */}
      <Modal
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        title={t.application.withdraw.confirmTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t.application.withdraw.confirmBody}
          </p>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowWithdrawModal(false)}
              className="flex-1"
            >
              {t.application.withdraw.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="flex-1"
              data-testid="application-withdraw-confirm"
            >
              {withdrawing ? (
                <LoadingSpinner size="sm" />
              ) : (
                t.application.withdraw.confirm
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={tj.confirmTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t.application.confirmBefore}</p>

          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{job.title}</span>
                <Badge variant="outline">{job.company?.company_name}</Badge>
              </div>
              {perDay || multiDay ? (
                <div data-testid="job-apply-summary">
                  <p className="mb-1 text-sm font-medium text-foreground">
                    {perDay
                      ? t.schedule.summaryTitle
                      : t.schedule.periodCommitment}
                  </p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(perDay ? chosenDays : days).map((d) => (
                      <li
                        key={d.day_id ?? d.day_date}
                        className="flex flex-wrap justify-between gap-x-3"
                        data-testid="job-apply-summary-day"
                      >
                        <span className="text-foreground">
                          {formatDayDate(d.day_date, locale)}
                        </span>
                        <span>{formatDayHours(d, t.schedule.nextDay)}</span>
                        {perDay && (
                          <MissionPay
                            amount={d.mission_pay_per_candidate}
                            className="w-full text-right"
                            amountClassName="text-primary"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                  {!perDay && (
                    <MissionPay
                      amount={job.mission_pay_per_candidate}
                      className="mt-2 block text-sm"
                      amountClassName="text-primary"
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" aria-hidden />
                    {formatDate(job.start_date, locale)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" aria-hidden />
                    {formatTime(job.start_time, locale)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-xl border border-warning/20 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
              <p className="text-sm text-foreground">
                {t.application.availabilityNotice}
              </p>
            </div>
          </div>

          {/* Lot 12 : changement survenu pendant la confirmation (journée
              devenue incompatible, lecture impossible) : expliqué ici, et
              l'envoi est retiré tant que le choix n'est plus valable. */}
          {showConfirmModal && selectionNoticeBlock}
          {daysUnverified && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="confirm-unverified"
            >
              {t.schedule.unverified}
            </p>
          )}
          {!daysUnverified && periodBlocked && (
            <p
              role="alert"
              className="text-sm text-foreground"
              data-testid="confirm-period-conflict"
            >
              {t.schedule.applyBlockedConflict}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="flex-1"
            >
              {tj.cancel}
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying || applyBlocked}
              className="flex-1"
              data-testid="job-apply-confirm"
            >
              {applying ? <LoadingSpinner size="sm" /> : tj.confirm}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Lot 11 : lien direct vers une offre masquée (dossier de l'entreprise plus
 * vérifié). Aucune donnée de l'offre n'est lue ni affichée. La page se relit
 * si l'offre redevient visible (signal public).
 */
export function JobUnavailable() {
  const router = useRouter();
  const { t } = useI18n();
  const tj = t.jobDetail;
  useLiveRefresh(["public:jobs", "jobs", "applications"], () =>
    router.refresh(),
  );
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="job-unavailable"
    >
      <AlertTriangle className="h-10 w-10 text-warning" aria-hidden />
      <h1 className="text-xl font-semibold text-foreground">
        {tj.unavailableTitle}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {tj.unavailableBody}
      </p>
      <Button onClick={() => router.push("/jobs")}>{tj.backToJobs}</Button>
    </div>
  );
}
