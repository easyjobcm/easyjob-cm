"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { toast } from "@/hooks/use-toast";
import type { EssentialKey } from "@/lib/utils/profile-completion";
import { formatDate, formatTime } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useAccountSuspended, useLiveRefresh } from "@/lib/realtime/provider";
import {
  MapPin,
  Clock,
  Calendar,
  Briefcase,
  Heart,
  Info,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  ChevronRight,
  Share2,
  Zap,
} from "lucide-react";
import { loginHref } from "@/lib/auth/safe-redirect";
import { applyRefusalFeedback } from "@/lib/jobs/application-feedback";
import { parseDocumentRequirementDetail } from "@/lib/matching/skill-document-requirements";

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
    urgency?: string | null;
    positions_available: number | null;
    positions_filled: number | null;
    company?: {
      company_name?: string | null;
      logo_url?: string | null;
      sector?: string | null;
      description?: string | null;
      [key: string]: string | null | undefined;
    };
    category?: {
      name_fr?: string;
      name_en?: string;
    } | null;
    required_skills?: string[] | null;
    min_experience_months?: number | null;
    dress_code?: string | null;
    special_instructions?: string | null;
  };
  userApplication: {
    id: string;
    status?: string | null;
  } | null;
  isFavorite: boolean;
  isLoggedIn: boolean;
  /** Essentiels manquants (identité/CNI/Momo) — postulation bloquée côté serveur. */
  missingEssentials?: EssentialKey[];
}

export function JobDetailClient({
  job,
  userApplication,
  isFavorite: initialFavorite,
  isLoggedIn,
  missingEssentials: initialMissingEssentials = [],
}: JobDetailClientProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);
  const [showBlockedModal, setShowBlockedModal] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [isFavorite, setIsFavorite] = React.useState(initialFavorite);
  // Statut réel de la candidature (lot 9) : une candidature retirée ou
  // refusée n'est plus présentée comme « envoyée ».
  const statusOf = (a: typeof userApplication) =>
    a ? (a.status ?? "pending") : null;
  const [applicationStatus, setApplicationStatus] = React.useState<
    string | null
  >(statusOf(userApplication));
  const hasApplied = applicationStatus !== null;
  const [showWithdrawModal, setShowWithdrawModal] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);
  // Pré-rempli côté serveur (page) ; le POST renvoie la liste à jour.
  const [missingEssentials, setMissingEssentials] = React.useState(
    initialMissingEssentials,
  );
  // Relecture serveur (router.refresh) : l'état local suit les nouvelles
  // props (candidature retirée ou refusée ailleurs, profil vérifié…).
  const [seenProps, setSeenProps] = React.useState({
    userApplication,
    initialMissingEssentials,
  });
  if (
    seenProps.userApplication !== userApplication ||
    seenProps.initialMissingEssentials !== initialMissingEssentials
  ) {
    setSeenProps({ userApplication, initialMissingEssentials });
    setApplicationStatus(statusOf(userApplication));
    setMissingEssentials(initialMissingEssentials);
  }

  const suspended = useAccountSuspended();
  // Offre retirée, modifiée ou complète ; candidature ; vérification du
  // profil : la page serveur est relue (une offre devenue invisible mène à
  // la page introuvable).
  useLiveRefresh(
    ["public:jobs", "jobs", "applications", "profile", "account"],
    () => router.refresh(),
  );

  const te = t.profile.essential;
  const essentialsMissingLabels = missingEssentials.map((k) => te[k]);
  const essentialsBlocked =
    isLoggedIn && missingEssentials.length > 0 && !hasApplied;

  const categoryName =
    locale === "fr" ? job.category?.name_fr : job.category?.name_en;

  // Durée prévue, affichée pour l'organisation du candidat. Elle n'entre
  // dans aucun calcul : la rémunération est un montant fixe par mission.
  const calculateDuration = (start: string, end: string) => {
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    let hours = endH - startH + (endM - startM) / 60;
    if (hours < 0) hours += 24; // Handle overnight shifts
    return hours;
  };

  const duration = calculateDuration(job.start_time, job.end_time);

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
      });

      if (res.ok) {
        setApplicationStatus("pending");
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
        } else {
          setShowConfirmModal(false);
          // Message dans la langue de l'interface à partir du code métier ;
          // `error` reste en anglais pour les autres appelants.
          const feedback = applyRefusalFeedback(
            {
              status: res.status,
              code: body.code,
              requirement: parseDocumentRequirementDetail(
                body.requirement ? JSON.stringify(body.requirement) : null,
              ),
            },
            t.application,
            `/jobs/${job.id}`,
          );
          toast({ ...feedback, variant: "destructive" });
          // Offre complète, retirée ou déjà postulée : l'écran est relu.
          if (body.code === "already_applied" || body.code === "no_positions") {
            router.refresh();
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
      const res = await fetch(`/api/jobs/${job.id}/apply`, {
        method: "DELETE",
      });
      const body = ((await res.json().catch(() => null)) ?? {}) as {
        code?: string;
        application?: { status?: string };
      };
      // Succès seulement si la base a bien enregistré le retrait.
      if (res.ok && body.application?.status === "withdrawn") {
        setApplicationStatus("withdrawn");
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
        router.refresh();
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
      router.refresh();
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

  const toggleFavorite = async () => {
    if (!isLoggedIn) {
      router.push(loginHref(`/jobs/${job.id}`));
      return;
    }
    // Optimistic update
    setIsFavorite(!isFavorite);
    // TODO: Implement API call
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: job.title,
          text: `${job.title} - ${job.company?.company_name}`,
          url: window.location.href,
        });
      } catch {
        // User cancelled or error
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background pb-[calc(13rem+env(safe-area-inset-bottom))]">
      {/* Header with gradient */}
      <div className="bg-linear-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <Header
          title=""
          showBack
          className="bg-transparent"
          rightAction={
            <div className="flex gap-2">
              <button
                onClick={toggleFavorite}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Heart
                  className={`w-5 h-5 ${isFavorite ? "fill-current text-red-400" : ""}`}
                />
              </button>
              <button
                onClick={handleShare}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          }
        />

        <div className="px-4 pb-6">
          {/* Urgency badge */}
          {job.urgency !== "normal" && (
            <Badge className="mb-2 bg-white/20 text-white border-white/30">
              <Zap className="w-3 h-3 mr-1" />
              {job.urgency === "critical"
                ? locale === "fr"
                  ? "Très urgent"
                  : "Very urgent"
                : "Urgent"}
            </Badge>
          )}

          <h1 className="text-2xl font-bold mb-2">{job.title}</h1>

          <div className="flex items-center gap-2 text-white/80 mb-3">
            <Briefcase className="w-4 h-4" />
            <span>{job.company?.company_name}</span>
          </div>

          <MissionPay
            amount={job.mission_pay_per_candidate}
            amountClassName="text-3xl"
            suffixClassName="text-sm text-white/80"
            testId="job-detail-pay"
          />
          <p className="text-white/80 text-xs mt-1">{t.pay.flatNote}</p>
          {categoryName && (
            <p className="text-white/80 text-sm mt-1">{categoryName}</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 -mt-4 relative z-10">
        {/* Application status card */}
        {hasApplied ? (
          (() => {
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
                      <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{st.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
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
        ) : (
          <Card className="mb-4 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    {t.application.applyNowTitle}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {(() => {
                      const left = Math.max(
                        0,
                        (job.positions_available ?? 1) -
                          (job.positions_filled ?? 0),
                      );
                      const p = t.application.positionsLeft;
                      return left === 0
                        ? p.none
                        : left === 1
                          ? p.one
                          : p.other.replace("{count}", String(left));
                    })()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Location */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Lieu" : "Location"}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{job.address}</p>
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
                    className="flex items-center gap-1 text-sm text-primary font-medium"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Schedule */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Détails de la mission" : "Job Details"}
          </h2>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground capitalize">
                      {formatDate(job.start_date, locale)}
                    </p>
                    {job.end_date && job.end_date !== job.start_date && (
                      <p className="text-sm text-muted-foreground">
                        {locale === "fr" ? "au" : "to"}{" "}
                        {formatDate(job.end_date, locale)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">
                      {formatTime(job.start_time, locale)} -{" "}
                      {formatTime(job.end_time, locale)}
                    </p>
                    <p className="text-sm text-muted-foreground">{duration}h</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Description */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Description" : "Description"}
          </h2>
          <Card>
            <CardContent className="p-4">
              <p className="text-foreground whitespace-pre-line text-sm leading-relaxed">
                {job.description}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Required Skills */}
        {job.required_skills && job.required_skills.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr" ? "Compétences requises" : "Required Skills"}
            </h2>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-2">
                  {job.required_skills.map((skill: string, index: number) => (
                    <Badge key={index} variant="secondary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Dress code & Instructions */}
        {(job.dress_code || job.special_instructions) && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr" ? "Instructions" : "Instructions"}
            </h2>
            <Card>
              <CardContent className="p-4 space-y-3">
                {job.dress_code && (
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Tenue vestimentaire" : "Dress code"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.dress_code}
                    </p>
                  </div>
                )}
                {job.special_instructions && (
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {locale === "fr"
                        ? "Instructions spéciales"
                        : "Special instructions"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.special_instructions}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Company Info */}
        {job.company && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr"
                ? "À propos de l'entreprise"
                : "About the company"}
            </h2>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    {job.company.logo_url ? (
                      <img
                        src={job.company.logo_url}
                        alt={job.company.company_name ?? ""}
                        className="w-full h-full object-cover rounded-xl"
                      />
                    ) : (
                      <Briefcase className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {job.company.company_name}
                    </p>
                    {job.company.sector && (
                      <p className="text-sm text-muted-foreground">
                        {job.company.sector}
                      </p>
                    )}
                  </div>
                </div>
                {job.company.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {job.company.description}
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      {/* Fixed bottom CTA */}
      {/* Au-dessus de la barre d'onglets candidat (h-16 + zone sûre), toujours
          affichée sur /jobs/* et qui recouvrait ce bouton. */}
      <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-30 bg-background/95 backdrop-blur-xl border-t border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {t.pay.perCandidate}
            </p>
            <MissionPay
              amount={job.mission_pay_per_candidate}
              amountClassName="text-xl text-foreground"
              testId="job-detail-cta-pay"
            />
          </div>
        </div>

        {hasApplied ? (
          <Button
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => router.push("/my-jobs")}
          >
            {t.application.actions.myApplications}
          </Button>
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
              onClick={() => router.push("/profile/candidate/edit")}
            >
              <ShieldAlert className="mr-2 h-4 w-4" />
              {te.cta}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => setShowConfirmModal(true)}
              className="w-full"
              size="lg"
              disabled={suspended}
              data-testid="job-apply"
            >
              {locale === "fr" ? "Postuler maintenant" : "Apply now"}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
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
              {locale === "fr" ? "Fermer" : "Close"}
            </Button>
            <Button
              onClick={() => {
                setShowBlockedModal(false);
                router.push("/profile/candidate/edit");
              }}
              className="flex-1"
            >
              {te.cta}
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

      {/* Confirmation Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={
          locale === "fr"
            ? "Confirmer votre candidature"
            : "Confirm your application"
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t.application.confirmBefore}</p>

          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{job.title}</span>
                <Badge variant="outline">{job.company?.company_name}</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(job.start_date, locale)}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {formatTime(job.start_time, locale)}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="p-3 rounded-xl bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <p className="text-sm text-foreground">
                {locale === "fr"
                  ? "Une absence non justifiée peut affecter votre score de fiabilité."
                  : "Unexcused absence may affect your reliability score."}
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="flex-1"
            >
              {locale === "fr" ? "Annuler" : "Cancel"}
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying}
              className="flex-1"
            >
              {applying ? (
                <LoadingSpinner size="sm" />
              ) : locale === "fr" ? (
                "Confirmer"
              ) : (
                "Confirm"
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
