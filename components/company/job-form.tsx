"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Plus, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/lib/database.types";
import {
  doualaToday,
  jobInputSchema,
  jobUpdateSchema,
  missionPaySchema,
  type JobDayInput,
  type JobInput,
} from "@/lib/validations/job";
import {
  crossesMidnight,
  formatDayDate,
  formatDayHours,
  scheduleIssue,
  sortDays,
  type ScheduleFormat,
} from "@/lib/jobs/schedule";
import { MissionPay } from "@/components/jobs/mission-pay";
import { JOB_PENDING_STATUS } from "@/lib/utils/job-status";
import { useAccountState, useLiveRefresh } from "@/lib/realtime/provider";
import { CompanyVerificationCard } from "@/components/company/company-verification-card";
import {
  parseMyCompanyVerification,
  type MyCompanyVerification,
} from "@/lib/utils/company-verification";
import {
  Briefcase,
  Calendar,
  Banknote,
  ChevronRight,
  AlertTriangle,
  Info,
  Users,
} from "lucide-react";
import { loginHref } from "@/lib/auth/safe-redirect";
import { plural } from "@/lib/i18n/plural";

type Step = "basics" | "schedule" | "requirements" | "payment" | "review";

const steps: { id: Step; labelFr: string; labelEn: string }[] = [
  { id: "basics", labelFr: "Infos", labelEn: "Basics" },
  { id: "schedule", labelFr: "Horaires", labelEn: "Schedule" },
  { id: "requirements", labelFr: "Exigences", labelEn: "Requirements" },
  { id: "payment", labelFr: "Paiement", labelEn: "Payment" },
  { id: "review", labelFr: "Apercu", labelEn: "Review" },
];

type Category = Pick<Tables<"job_categories">, "id" | "name_fr" | "name_en">;

/** Journée de l'offre telle que relue (`job_days`). */
type InitialDay = Pick<
  Tables<"job_days">,
  | "day_date"
  | "start_time"
  | "end_time"
  | "mission_pay_per_candidate"
  | "positions_available"
>;

/** Colonnes relues pour préremplir la correction d'une offre. */
export type JobFormInitial = Pick<
  Tables<"jobs">,
  | "id"
  | "title"
  | "description"
  | "job_type"
  | "start_date"
  | "end_date"
  | "start_time"
  | "end_time"
  | "positions_available"
  | "mission_pay_per_candidate"
  | "required_skills"
  | "first_published_at"
> &
  Partial<
    Pick<
      Tables<"jobs">,
      "category_id" | "schedule_format" | "legacy_publication"
    >
  > & { days?: InitialDay[] | null };

/** Journée en cours de saisie. */
type DayDraft = {
  date: string;
  start: string;
  end: string;
  pay: string;
  positions: number;
};

const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);

/** Journées initiales : calendrier relu, sinon une seule journée si l'offre
 * n'a pas d'intervalle (aucune journée déduite de deux dates). */
function initialDays(job: JobFormInitial | undefined): DayDraft[] {
  if (!job) return [];
  if (job.days && job.days.length > 0) {
    return sortDays(
      job.days.map((d) => ({
        date: d.day_date,
        start_time: hhmm(d.start_time),
        end_time: hhmm(d.end_time),
        pay:
          d.mission_pay_per_candidate != null
            ? String(d.mission_pay_per_candidate)
            : "",
        positions: d.positions_available ?? 1,
      })),
    ).map((d) => ({
      date: d.date,
      start: d.start_time,
      end: d.end_time,
      pay: d.pay,
      positions: d.positions,
    }));
  }
  if (!job.end_date || job.end_date === job.start_date) {
    return [
      {
        date: job.start_date,
        start: hhmm(job.start_time),
        end: hhmm(job.end_time),
        pay: "",
        positions: 1,
      },
    ];
  }
  return [];
}

const payValue = (raw: string) =>
  raw.trim() === "" ? Number.NaN : Number(raw);

/**
 * Formulaire d'offre, en création et en correction. L'envoi passe par
 * `POST /api/jobs` ou `PATCH /api/jobs/[id]`, qui appellent les RPC
 * `create_job` et `update_job` : statut, propriétaire et modération sont
 * imposés par la base. Lot 12 : dates choisies une à une (jamais déduites
 * d'un intervalle), deux formats (période complète, journées au choix),
 * aperçu des journées avant l'envoi.
 */
export function JobForm({ initialJob }: { initialJob?: JobFormInitial }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const tj = t.companyJobs;
  const ts = t.schedule;
  // Lot 11b, règle de lancement : après la première publication, dates et
  // horaires sont en lecture seule et renvoyés tels quels ; `update_job`
  // refuse tout changement (job_schedule_locked), y compris l'ajout ou le
  // retrait d'une journée (lot 12).
  const scheduleLocked =
    !!initialJob?.first_published_at || !!initialJob?.legacy_publication;
  const account = useAccountState();
  const publishBlocked = !account
    ? null
    : !account.is_active
      ? t.realtime.actionUnavailable
      : account.company && account.company.verification_status !== "verified"
        ? tj.errors.company_not_verified
        : null;
  const { toast } = useToast();

  const [dossier, setDossier] = React.useState<MyCompanyVerification | null>(
    null,
  );
  const loadDossier = React.useCallback(async () => {
    const { data } = await createClient().rpc("my_company_verification");
    setDossier(parseMyCompanyVerification(data));
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("my_company_verification")
      .then(({ data }) => {
        if (!cancelled) setDossier(parseMyCompanyVerification(data));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useLiveRefresh(["profile", "account"], loadDossier);

  // Catégories réelles (`job_categories`) : l'identifiant est enregistré et
  // relu lors d'une correction.
  const [categories, setCategories] = React.useState<Category[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .from("job_categories")
      .select("id, name_fr, name_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setCategories(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [currentStep, setCurrentStep] = React.useState<Step>("basics");
  const [loading, setLoading] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const startDays = initialDays(initialJob);
  const sameHoursAtStart =
    startDays.length === 0 ||
    startDays.every(
      (d) => d.start === startDays[0].start && d.end === startDays[0].end,
    );
  const [formData, setFormData] = React.useState({
    title: initialJob?.title ?? "",
    category: initialJob?.category_id ?? "",
    description: initialJob?.description ?? "",
    // Calendrier
    days: startDays,
    newDate: "",
    sameHours: sameHoursAtStart,
    startTime: startDays[0]?.start ?? "",
    endTime: startDays[0]?.end ?? "",
    format: (initialJob?.schedule_format ?? "full_period") as ScheduleFormat,
    workersNeeded: initialJob?.positions_available ?? 1,
    // Requirements
    requirements: initialJob?.required_skills ?? [],
    benefits: [] as string[],
    // Paiement (période complète) : montant fixe par candidat (XAF entiers)
    missionPay: initialJob ? String(initialJob.mission_pay_per_candidate) : "",
  });

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) setCurrentStep(steps[nextIndex].id);
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) setCurrentStep(steps[prevIndex].id);
    else router.back();
  };

  const errorMessage = (code: unknown) =>
    typeof code === "string" && code in tj.errors
      ? tj.errors[code as keyof typeof tj.errors]
      : tj.errors.generic;

  const failSubmit = (message: string) => {
    setSubmitError(message);
    toast({
      title: tj.form.errorTitle,
      description: message,
      variant: "destructive",
    });
  };

  // Format : choisi seulement pour plusieurs journées.
  const format: ScheduleFormat =
    formData.days.length > 1 ? formData.format : "full_period";

  // Journées effectives (horaires communs ou propres), triées par début.
  const effectiveDays = sortDays(
    formData.days.map((d) => ({
      ...d,
      date: d.date,
      start_time: formData.sameHours ? formData.startTime : d.start,
      end_time: formData.sameHours ? formData.endTime : d.end,
    })),
  );
  const hoursComplete = effectiveDays.every((d) => d.start_time && d.end_time);
  const issue =
    formData.days.length === 0
      ? "daysRequired"
      : hoursComplete
        ? scheduleIssue(effectiveDays)
        : null;

  const missionPayValue = payValue(formData.missionPay);
  const missionPayCheck = missionPaySchema.safeParse(missionPayValue);
  const missionPayError =
    formData.missionPay.trim() !== "" && !missionPayCheck.success
      ? errorMessage(missionPayCheck.error.issues[0]?.message)
      : null;
  const dayPayValid = (raw: string) =>
    missionPaySchema.safeParse(payValue(raw)).success;
  const perDayPayValid = effectiveDays.every((d) => dayPayValid(d.pay));

  const updateDay = (date: string, patch: Partial<DayDraft>) =>
    setFormData((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.date === date ? { ...d, ...patch } : d)),
    }));

  const addDate = () => {
    const date = formData.newDate;
    if (!date || formData.days.some((d) => d.date === date)) return;
    setFormData((prev) => {
      // Nouvelle journée : mêmes horaires, montant et places que la première.
      const ref = prev.days[0];
      const added: DayDraft = {
        date,
        start: ref?.start ?? prev.startTime,
        end: ref?.end ?? prev.endTime,
        pay: ref?.pay ?? "",
        positions: ref?.positions ?? 1,
      };
      return {
        ...prev,
        newDate: "",
        days: [...prev.days, added].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      };
    });
  };

  const removeDate = (date: string) =>
    setFormData((prev) => ({
      ...prev,
      days: prev.days.filter((d) => d.date !== date),
    }));

  const copyFirstDay = () =>
    setFormData((prev) => {
      const first = sortDays(
        prev.days.map((d) => ({ ...d, start_time: d.start, end_time: d.end })),
      )[0];
      if (!first) return prev;
      return {
        ...prev,
        days: prev.days.map((d) => ({
          ...d,
          pay: first.pay,
          positions: first.positions,
        })),
      };
    });

  const handlePublish = async () => {
    setSubmitError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push(loginHref(window.location.pathname));
        return;
      }

      const { data: companyProfile } = await supabase
        .from("company_profiles")
        .select("city, address")
        .eq("user_id", user.id)
        .single();

      if (!companyProfile?.city) {
        router.push("/onboarding/company");
        return;
      }

      const daysPayload: JobDayInput[] = effectiveDays.map((d) => ({
        date: d.date,
        start_time: d.start_time,
        end_time: d.end_time,
        ...(format === "per_day"
          ? {
              mission_pay_per_candidate: payValue(d.pay),
              positions_available: d.positions,
            }
          : {}),
      }));
      const first = effectiveDays[0];
      // Offre antérieure à intervalle sans calendrier, déjà publiée : dates
      // renvoyées telles quelles (aucune journée déduite).
      const legacyLocked =
        scheduleLocked && initialJob && formData.days.length === 0;

      const payload: JobInput = {
        title: formData.title,
        job_type: effectiveDays.length > 1 ? "contract" : "shift",
        description: formData.description,
        ...(formData.category ? { category_id: formData.category } : {}),
        ...(legacyLocked && initialJob
          ? {
              start_date: initialJob.start_date,
              end_date: initialJob.end_date ?? initialJob.start_date,
              start_time: initialJob.start_time.slice(0, 8),
              end_time: initialJob.end_time.slice(0, 8),
            }
          : {
              start_date: first?.date ?? "",
              start_time: first?.start_time ?? "",
              end_time: first?.end_time ?? "",
              schedule_format: format,
              days: daysPayload,
            }),
        positions_available:
          format === "per_day"
            ? effectiveDays.reduce((n, d) => n + d.positions, 0)
            : formData.workersNeeded,
        mission_pay_per_candidate:
          format === "per_day"
            ? Math.min(...effectiveDays.map((d) => payValue(d.pay)))
            : missionPayValue,
        city: companyProfile.city,
        address: companyProfile.address || "",
        required_skills: formData.requirements,
        urgency: "normal",
      };

      const parsed = (initialJob ? jobUpdateSchema : jobInputSchema).safeParse(
        payload,
      );
      if (!parsed.success) {
        failSubmit(errorMessage(parsed.error.issues[0]?.message));
        return;
      }

      const res = await fetch(
        initialJob ? `/api/jobs/${initialJob.id}` : "/api/jobs",
        {
          method: initialJob ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        field?: string;
        days?: string[];
        job?: { status?: string };
      };

      if (!res.ok || body.job?.status !== JOB_PENDING_STATUS) {
        if (body.code === "job_start_too_close" && body.days?.length) {
          failSubmit(
            `${tj.errors.job_start_too_close} ${ts.tooClose.replace(
              "{days}",
              body.days.map((d) => formatDayDate(d, locale)).join(", "),
            )}`,
          );
        } else if (body.code === "invalid_job_data" && body.field) {
          const fieldKey: Record<string, string> = {
            days: "daysInvalid",
            days_count: "daysTooMany",
            days_duplicate: "daysDuplicate",
            days_time: "daysTime",
            days_overlap: "daysOverlap",
            days_pay: "dayPayRequired",
            days_positions: "positionsInvalid",
            end_date: "daysRequired",
          };
          failSubmit(errorMessage(fieldKey[body.field] ?? body.code));
        } else {
          failSubmit(errorMessage(body.code));
        }
        return;
      }

      router.push(`/company/jobs?${initialJob ? "updated" : "created"}=true`);
    } catch (error) {
      console.error("Job submission error:", error);
      failSubmit(tj.errors.generic);
    } finally {
      setLoading(false);
    }
  };

  const commonRequirements = [
    {
      id: "exp",
      labelFr: "Experience recommandee",
      labelEn: "Experience recommended",
    },
    { id: "french", labelFr: "Francais courant", labelEn: "Fluent French" },
    { id: "english", labelFr: "Anglais", labelEn: "English" },
    { id: "punctual", labelFr: "Ponctualite", labelEn: "Punctuality" },
    { id: "dress", labelFr: "Tenue correcte", labelEn: "Proper attire" },
  ];

  const commonBenefits = [
    { id: "meal", labelFr: "Repas offert", labelEn: "Free meal" },
    { id: "tips", labelFr: "Pourboires partages", labelEn: "Shared tips" },
    { id: "transport", labelFr: "Transport", labelEn: "Transport" },
    {
      id: "regular",
      labelFr: "Missions regulieres possibles",
      labelEn: "Regular missions possible",
    },
  ];

  const toggleItem = (
    array: string[],
    item: string,
    field: "requirements" | "benefits",
  ) => {
    const newArray = array.includes(item)
      ? array.filter((i) => i !== item)
      : [...array, item];
    setFormData((prev) => ({ ...prev, [field]: newArray }));
  };

  const legacyLockedView = scheduleLocked && formData.days.length === 0;

  const isStepValid = () => {
    switch (currentStep) {
      case "basics":
        return (
          !!formData.title &&
          !!formData.description &&
          (categories.length === 0 || !!formData.category)
        );
      case "schedule":
        if (legacyLockedView) return true;
        return hoursComplete && issue === null;
      case "requirements":
        return true;
      case "payment":
        return format === "per_day" ? perDayPayValid : missionPayCheck.success;
      case "review":
        return true;
      default:
        return false;
    }
  };

  const categoryName = (c: Category) =>
    locale === "fr" ? c.name_fr : c.name_en;
  const lockedHint = scheduleLocked ? "job-schedule-locked" : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        title={
          initialJob
            ? tj.form.editTitle
            : locale === "fr"
              ? "Nouvelle offre"
              : "New job"
        }
        showBack
        onBack={handleBack}
      />

      {/* Progress */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex gap-1">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index <= currentStepIndex ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {locale === "fr"
            ? steps[currentStepIndex].labelFr
            : steps[currentStepIndex].labelEn}
          {" • "}
          {currentStepIndex + 1}/{steps.length}
        </p>
      </div>

      <div className="flex-1 px-4 py-6 overflow-y-auto sm:px-6">
        {dossier && dossier.status !== "verified" && (
          <div
            className="mb-6 space-y-2"
            data-testid="job-form-dossier-blocked"
          >
            <p className="text-sm font-medium text-foreground">
              {t.companyVerification.jobEntryHint}
            </p>
            <CompanyVerificationCard dossier={dossier} />
          </div>
        )}
        {/* Basics Step */}
        {currentStep === "basics" && (
          <div className="space-y-6">
            <div>
              <label
                htmlFor="job-title"
                className="text-sm font-medium text-foreground"
              >
                {locale === "fr" ? "Titre du poste" : "Job title"}
              </label>
              <Input
                id="job-title"
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder={
                  locale === "fr"
                    ? "Ex: Serveur/Serveuse"
                    : "Ex: Waiter/Waitress"
                }
                className="mt-1.5"
              />
            </div>

            {categories.length > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground mb-3">
                  {locale === "fr" ? "Categorie" : "Category"}
                </p>
                <div
                  className="grid grid-cols-2 gap-2"
                  data-testid="job-categories"
                >
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={formData.category === cat.id}
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, category: cat.id }))
                      }
                      className={cn(
                        "rounded-xl px-4 py-3 text-sm font-medium transition-all text-left break-words",
                        formData.category === cat.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      {categoryName(cat)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="job-description"
                className="text-sm font-medium text-foreground"
              >
                {locale === "fr" ? "Description du poste" : "Job description"}
              </label>
              <textarea
                id="job-description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={
                  locale === "fr"
                    ? "Decrivez les missions, le contexte..."
                    : "Describe the tasks, context..."
                }
                className="mt-1.5 w-full min-h-30 rounded-xl border border-input bg-background px-4 py-3 text-foreground resize-none"
              />
            </div>
          </div>
        )}

        {/* Schedule Step */}
        {currentStep === "schedule" && (
          <div className="space-y-6">
            {scheduleLocked && (
              <div
                role="note"
                id="job-schedule-locked"
                data-testid="job-schedule-locked"
                className="flex gap-3 rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground"
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="space-y-2">
                  <p>{tj.form.scheduleLocked}</p>
                  <Link
                    href="/company/jobs/new"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    data-testid="job-schedule-locked-new"
                  >
                    {tj.form.scheduleLockedAction}
                  </Link>
                </div>
              </div>
            )}

            {legacyLockedView && initialJob ? (
              <p className="text-sm text-foreground">
                {formatDayDate(initialJob.start_date, locale)}
                {initialJob.end_date &&
                  initialJob.end_date !== initialJob.start_date &&
                  ` → ${formatDayDate(initialJob.end_date, locale)}`}
                {" · "}
                {hhmm(initialJob.start_time)} → {hhmm(initialJob.end_time)}
              </p>
            ) : (
              <>
                {/* Dates choisies une à une */}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {ts.datesLabel}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ts.datesHint}
                  </p>
                  {!scheduleLocked && (
                    <div className="mt-2 flex gap-2">
                      <Input
                        type="date"
                        aria-label={ts.addDateLabel}
                        data-testid="job-day-new"
                        value={formData.newDate}
                        min={doualaToday()}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            newDate: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addDate}
                        disabled={
                          !formData.newDate ||
                          formData.days.some((d) => d.date === formData.newDate)
                        }
                        data-testid="job-day-add"
                      >
                        <Plus className="mr-1 h-4 w-4" aria-hidden />
                        {ts.addDate}
                      </Button>
                    </div>
                  )}
                  {formData.days.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {ts.noDates}
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2" data-testid="job-days">
                      {effectiveDays.map((d) => (
                        <li
                          key={d.date}
                          className="rounded-xl border border-border p-3"
                          data-testid="job-day"
                          data-date={d.date}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">
                              {formatDayDate(d.date, locale)}
                            </span>
                            {!scheduleLocked && (
                              <button
                                type="button"
                                onClick={() => removeDate(d.date)}
                                aria-label={ts.removeDate.replace(
                                  "{date}",
                                  formatDayDate(d.date, locale),
                                )}
                                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                              >
                                <X className="h-4 w-4" aria-hidden />
                              </button>
                            )}
                          </div>
                          {!formData.sameHours && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="text-xs text-muted-foreground">
                                {ts.startTime}
                                <Input
                                  type="time"
                                  value={d.start}
                                  disabled={scheduleLocked}
                                  aria-describedby={lockedHint}
                                  onChange={(e) =>
                                    updateDay(d.date, { start: e.target.value })
                                  }
                                  className="mt-1"
                                />
                              </label>
                              <label className="text-xs text-muted-foreground">
                                {ts.endTime}
                                <Input
                                  type="time"
                                  value={d.end}
                                  disabled={scheduleLocked}
                                  aria-describedby={lockedHint}
                                  onChange={(e) =>
                                    updateDay(d.date, { end: e.target.value })
                                  }
                                  className="mt-1"
                                />
                              </label>
                            </div>
                          )}
                          {d.start_time && d.end_time && crossesMidnight(d) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {ts.crossesMidnight}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Horaires communs ou par journée */}
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={formData.sameHours}
                    disabled={scheduleLocked}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        sameHours: e.target.checked,
                        // Passage aux horaires par journée : chaque journée
                        // reprend les horaires communs.
                        days: e.target.checked
                          ? prev.days
                          : prev.days.map((d) => ({
                              ...d,
                              start: prev.startTime || d.start,
                              end: prev.endTime || d.end,
                            })),
                      }))
                    }
                    data-testid="job-same-hours"
                    className="h-4 w-4 accent-primary"
                  />
                  {ts.sameHours}
                </label>
                {formData.sameHours && (
                  <div className="grid grid-cols-2 gap-4">
                    <label className="text-sm font-medium text-foreground">
                      {ts.startTime}
                      <Input
                        type="time"
                        value={formData.startTime}
                        disabled={scheduleLocked}
                        aria-describedby={lockedHint}
                        data-testid="job-start-time"
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            startTime: e.target.value,
                          }))
                        }
                        className="mt-1.5"
                      />
                    </label>
                    <label className="text-sm font-medium text-foreground">
                      {ts.endTime}
                      <Input
                        type="time"
                        value={formData.endTime}
                        disabled={scheduleLocked}
                        aria-describedby={lockedHint}
                        data-testid="job-end-time"
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            endTime: e.target.value,
                          }))
                        }
                        className="mt-1.5"
                      />
                    </label>
                  </div>
                )}

                {issue && formData.days.length > 0 && (
                  <p
                    role="alert"
                    className="text-sm text-destructive"
                    data-testid="job-days-issue"
                  >
                    {errorMessage(issue)}
                  </p>
                )}

                {/* Format, pour plusieurs journées */}
                {formData.days.length > 1 && (
                  <fieldset className="space-y-2" data-testid="job-format">
                    <legend className="mb-2 text-sm font-medium text-foreground">
                      {ts.formatLabel}
                    </legend>
                    {(["full_period", "per_day"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={formData.format === f}
                        disabled={scheduleLocked}
                        data-testid={`job-format-${f}`}
                        onClick={() =>
                          setFormData((prev) => ({ ...prev, format: f }))
                        }
                        className={cn(
                          "w-full rounded-xl border-2 p-4 text-left transition-all disabled:opacity-70",
                          formData.format === f
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50",
                        )}
                      >
                        <p className="font-medium text-foreground">
                          {ts.formats[f].title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {ts.formats[f].desc}
                        </p>
                      </button>
                    ))}
                  </fieldset>
                )}
              </>
            )}

            {format === "full_period" && (
              <div>
                <p className="text-sm font-medium text-foreground">
                  {locale === "fr"
                    ? "Nombre de personnes recherchees"
                    : "Number of workers needed"}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="-"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        workersNeeded: Math.max(1, prev.workersNeeded - 1),
                      }))
                    }
                  >
                    -
                  </Button>
                  <span className="text-xl font-bold w-12 text-center">
                    {formData.workersNeeded}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="+"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        workersNeeded: prev.workersNeeded + 1,
                      }))
                    }
                  >
                    +
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Requirements Step */}
        {currentStep === "requirements" && (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium text-foreground mb-3">
                {locale === "fr" ? "Exigences" : "Requirements"}
              </p>
              <div className="flex flex-wrap gap-2">
                {commonRequirements.map((req) => (
                  <button
                    key={req.id}
                    type="button"
                    onClick={() =>
                      toggleItem(formData.requirements, req.id, "requirements")
                    }
                    className={cn(
                      "px-3 py-2 rounded-full text-sm font-medium transition-all",
                      formData.requirements.includes(req.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {locale === "fr" ? req.labelFr : req.labelEn}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-3">
                {locale === "fr" ? "Avantages proposes" : "Benefits offered"}
              </p>
              <div className="flex flex-wrap gap-2">
                {commonBenefits.map((benefit) => (
                  <button
                    key={benefit.id}
                    type="button"
                    onClick={() =>
                      toggleItem(formData.benefits, benefit.id, "benefits")
                    }
                    className={cn(
                      "px-3 py-2 rounded-full text-sm font-medium transition-all",
                      formData.benefits.includes(benefit.id)
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {locale === "fr" ? benefit.labelFr : benefit.labelEn}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Payment Step */}
        {currentStep === "payment" && (
          <div className="space-y-6">
            {format === "per_day" ? (
              <div className="space-y-3" data-testid="job-day-pay">
                {effectiveDays.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyFirstDay}
                    data-testid="job-day-copy-first"
                  >
                    {ts.copyFirstDay}
                  </Button>
                )}
                {effectiveDays.map((d) => {
                  const invalid = d.pay.trim() !== "" && !dayPayValid(d.pay);
                  return (
                    <div
                      key={d.date}
                      className="rounded-xl border border-border p-3"
                      data-testid="job-day-pay-row"
                      data-date={d.date}
                    >
                      <p className="font-medium text-foreground">
                        {formatDayDate(d.date, locale)}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {formatDayHours(d, ts.nextDay)}
                        </span>
                      </p>
                      <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
                        <label className="text-xs text-muted-foreground">
                          {ts.dayPayLabel}
                          <Input
                            type="number"
                            inputMode="numeric"
                            step={1}
                            min={1}
                            value={d.pay}
                            onChange={(e) =>
                              updateDay(d.date, { pay: e.target.value })
                            }
                            placeholder="10000"
                            aria-invalid={invalid ? true : undefined}
                            className="mt-1"
                          />
                        </label>
                        <div className="text-xs text-muted-foreground">
                          {ts.dayPositions}
                          <div className="mt-1 flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`${ts.dayPositions} -`}
                              onClick={() =>
                                updateDay(d.date, {
                                  positions: Math.max(1, d.positions - 1),
                                })
                              }
                            >
                              -
                            </Button>
                            <span className="w-6 text-center text-base font-bold text-foreground">
                              {d.positions}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`${ts.dayPositions} +`}
                              onClick={() =>
                                updateDay(d.date, {
                                  positions: d.positions + 1,
                                })
                              }
                            >
                              +
                            </Button>
                          </div>
                        </div>
                      </div>
                      {invalid && (
                        <p
                          role="alert"
                          className="mt-1 text-xs text-destructive"
                        >
                          {tj.errors.dayPayRequired}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                <label
                  htmlFor="mission-pay"
                  className="text-sm font-medium text-foreground"
                >
                  {effectiveDays.length > 1
                    ? ts.periodPayLabel
                    : t.pay.formLabel}
                </label>
                <div className="relative mt-1.5">
                  <Banknote className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="mission-pay"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={1}
                    value={formData.missionPay}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        missionPay: e.target.value,
                      }))
                    }
                    placeholder="10000"
                    className="pl-10 text-lg"
                    aria-invalid={missionPayError ? true : undefined}
                    aria-describedby="mission-pay-hint"
                  />
                </div>
                {missionPayError && (
                  <p role="alert" className="text-xs text-destructive mt-1">
                    {missionPayError}
                  </p>
                )}
                <div
                  id="mission-pay-hint"
                  className="text-xs text-muted-foreground mt-1 space-y-1"
                >
                  {effectiveDays.length > 1 ? (
                    <p>{ts.periodPayHint}</p>
                  ) : (
                    <>
                      <p>{t.pay.formHint}</p>
                      <p>{t.pay.formExample}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Review Step */}
        {currentStep === "review" && (
          <div className="space-y-4">
            {initialJob && (
              <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <p>{tj.form.editNotice}</p>
              </div>
            )}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 break-words font-semibold text-foreground">
                  {formData.title}
                </h3>

                <div className="space-y-2 text-sm">
                  {formData.category && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Briefcase className="h-4 w-4" />
                      <span>
                        {(() => {
                          const c = categories.find(
                            (x) => x.id === formData.category,
                          );
                          return c ? categoryName(c) : null;
                        })()}
                      </span>
                    </div>
                  )}

                  {effectiveDays.length > 1 && (
                    <p className="font-medium text-foreground">
                      {ts.formats[format].title}
                    </p>
                  )}

                  {format === "full_period" && (
                    <>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>
                          {plural(
                            Number(formData.workersNeeded) || 0,
                            t.pay.positions,
                            locale,
                          )}
                        </span>
                      </div>
                      <div className="flex items-start gap-2 text-muted-foreground pt-2 border-t">
                        <Banknote className="h-4 w-4 mt-1" />
                        <div className="space-y-0.5">
                          <p className="text-xs">
                            {effectiveDays.length > 1
                              ? ts.payPeriod.replace(
                                  "{days}",
                                  plural(
                                    effectiveDays.length,
                                    ts.dayCount,
                                    locale,
                                  ),
                                )
                              : t.pay.perCandidate}
                          </p>
                          <MissionPay
                            amount={
                              missionPayCheck.success
                                ? missionPayCheck.data
                                : null
                            }
                            amountClassName="text-primary"
                            testId="review-mission-pay"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {effectiveDays.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Calendar className="h-4 w-4" aria-hidden />
                    {ts.preview} ·{" "}
                    {plural(effectiveDays.length, ts.dayCount, locale)}
                  </h4>
                  <ul
                    className="divide-y divide-border"
                    data-testid="job-review-days"
                  >
                    {effectiveDays.map((d) => (
                      <li
                        key={d.date}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
                        data-testid="job-review-day"
                        data-date={d.date}
                      >
                        <span className="text-foreground">
                          {formatDayDate(d.date, locale)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDayHours(d, ts.nextDay)}
                        </span>
                        {format === "per_day" && (
                          <span className="w-full text-muted-foreground">
                            <MissionPay
                              amount={
                                dayPayValid(d.pay) ? payValue(d.pay) : null
                              }
                              amountClassName="text-primary"
                            />
                            {" · "}
                            {plural(d.positions, ts.perDayPositions, locale)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <h4 className="text-sm font-medium text-foreground mb-2">
                  Description
                </h4>
                <p className="text-sm text-muted-foreground whitespace-pre-line break-words">
                  {formData.description}
                </p>
              </CardContent>
            </Card>

            {(formData.requirements.length > 0 ||
              formData.benefits.length > 0) && (
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-3">
                  {formData.requirements.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-1">
                        {locale === "fr" ? "Exigences" : "Requirements"}
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {formData.requirements.map((req) => (
                          <span
                            key={req}
                            className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full"
                          >
                            {commonRequirements.find((r) => r.id === req)?.[
                              locale === "fr" ? "labelFr" : "labelEn"
                            ] ?? req}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {formData.benefits.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-1">
                        {locale === "fr" ? "Avantages" : "Benefits"}
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {formData.benefits.map((benefit) => (
                          <span
                            key={benefit}
                            className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-full"
                          >
                            {
                              commonBenefits.find((b) => b.id === benefit)?.[
                                locale === "fr" ? "labelFr" : "labelEn"
                              ]
                            }
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        {submitError && currentStep === "review" && (
          <p role="alert" className="mb-3 flex gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </p>
        )}
        {publishBlocked && currentStep === "review" && (
          <p
            role="alert"
            data-testid="publish-blocked"
            className="mb-3 flex gap-2 text-sm text-destructive"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{publishBlocked}</span>
          </p>
        )}
        {currentStep === "review" ? (
          <Button
            onClick={handlePublish}
            disabled={loading || publishBlocked !== null}
            className="w-full"
            size="lg"
            data-testid="job-submit"
          >
            {loading ? (
              <LoadingSpinner size="sm" />
            ) : initialJob ? (
              tj.form.submitEdit
            ) : locale === "fr" ? (
              "Publier l'offre"
            ) : (
              "Publish job"
            )}
          </Button>
        ) : (
          <Button
            onClick={handleNext}
            disabled={!isStepValid()}
            className="w-full"
            size="lg"
            data-testid="job-next"
          >
            {locale === "fr" ? "Continuer" : "Continue"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
