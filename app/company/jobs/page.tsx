"use client";

import { UrgentBadge } from "@/components/jobs/urgent-badge";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@/lib/database.types";
import { useI18n } from "@/lib/i18n";
import { MissionPay } from "@/components/jobs/mission-pay";
import { normalizeCompanyPlan } from "@/lib/utils/company-plan";
import { getPlanLimits } from "@/lib/utils/profile-status";
import { canEditJob, type JobStatus } from "@/lib/utils/job-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Briefcase,
  Users,
  Clock,
  MapPin,
  Calendar,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Archive,
  LifeBuoy,
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
import { Label } from "@/components/ui/label";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { jobClosureSchema } from "@/lib/validations/job";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useAccountState,
  useLatestRequest,
  useLiveRefresh,
} from "@/lib/realtime/provider";
import { isNetworkError, readSessionUser } from "@/lib/supabase/session-user";
import { plural } from "@/lib/i18n/plural";
import { hoursVary } from "@/lib/jobs/schedule";

type Job = Pick<
  Tables<"jobs">,
  | "id"
  | "title"
  | "description"
  | "city"
  | "start_date"
  | "start_time"
  | "end_time"
  | "mission_pay_per_candidate"
  | "positions_available"
  | "positions_filled"
  | "status"
  | "created_at"
  | "rejection_reason"
  | "closed_at"
> & {
  _count?: {
    applications: number;
  };
  days?: { start_time: string; end_time: string }[] | null;
};

/**
 * Lot 17d-1 : action de retrait proposée pour chaque offre, calculée par la
 * base (`my_job_removal_actions`) : suppression avant toute publication,
 * clôture après publication sans engagement, orientation vers le support
 * avec engagement. La RPC tranche de nouveau à l'envoi (écran périmé).
 */
type RemovalAction = "delete" | "close" | "support" | "closed" | "none";
type Removal = { action: RemovalAction; closureReason: string | null };

// Une offre refusée reste dans « Actives » : elle attend une correction.
const ACTIVE_STATUSES: JobStatus[] = ["active", "pending_review", "rejected"];
const CLOSED_STATUSES: JobStatus[] = ["filled", "expired", "cancelled"];
const isActiveJob = (status: Enums<"job_status"> | null) =>
  ACTIVE_STATUSES.includes(status as JobStatus);
const isClosedJob = (status: Enums<"job_status"> | null) =>
  CLOSED_STATUSES.includes(status as JobStatus);

export default function CompanyJobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const tj = t.companyJobs;
  const ts = t.schedule;
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  // Plan effectif (échéance comprise, heure du serveur) : la modification
  // directe n'est proposée que si elle est connue et en cours de validité.
  const account = useAccountState();
  const directEdit = getPlanLimits(
    normalizeCompanyPlan(account?.company?.effective_plan ?? "free"),
  ).directEdit;
  const suspended = account !== null && !account.is_active;
  const latest = useLatestRequest();
  const [activeTab, setActiveTab] = useState("active");
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removals, setRemovals] = useState<Map<string, Removal>>(new Map());
  const [closeJobId, setCloseJobId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("created") === "true") {
      toast({
        title: tj.toasts.createdTitle,
        description: tj.toasts.createdDesc,
        variant: "success",
      });
    } else if (searchParams.get("updated") === "true") {
      toast({
        title: tj.toasts.updatedTitle,
        description: tj.toasts.updatedDesc,
        variant: "success",
      });
    }
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Modération, places, candidatures, suppression ailleurs ; plan.
  useLiveRefresh(["jobs", "applications", "subscription"], loadJobs);

  async function loadJobs() {
    const token = latest.begin();
    const supabase = createClient();
    const user = await readSessionUser(supabase);
    if (user === undefined) return;
    if (!user) {
      router.push("/auth/login?next=/company/jobs");
      return;
    }

    // Get company profile
    const { data: company, error: companyError } = await supabase
      .from("company_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (isNetworkError(companyError)) return;
    if (!company) {
      router.push("/onboarding/company");
      return;
    }

    // Get jobs with application counts
    const { data: jobsData } = await supabase
      .from("jobs")
      .select(
        `
        *,
        job_applications(count),
        days:job_days(start_time, end_time)
      `,
      )
      .eq("company_id", company.id)
      .order("created_at", { ascending: false });
    const { data: actions, error: actionsError } = await supabase.rpc(
      "my_job_removal_actions",
    );
    if (!latest.isLatest(token)) return;
    // Lecture en échec : aucune action de retrait proposée (jamais deviner
    // « supprimer » ou « clôturer »).
    setRemovals(
      new Map(
        actionsError
          ? []
          : (actions ?? []).map((a) => [
              a.job_id,
              {
                action: a.action as RemovalAction,
                closureReason: a.closure_reason,
              },
            ]),
      ),
    );

    if (jobsData) {
      // Transform data to include application count
      const transformedJobs = jobsData.map((job) => ({
        ...job,
        _count: {
          applications: job.job_applications?.[0]?.count || 0,
        },
      }));
      setJobs(transformedJobs);
    }

    setLoading(false);
  }

  const handleDeleteJob = async () => {
    if (!deleteJobId) return;

    setDeleting(true);
    const res = await fetch(`/api/jobs/${deleteJobId}`, {
      method: "DELETE",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      deleted?: string;
    };

    if (!res?.ok || body.deleted !== deleteJobId) {
      const code = body.code;
      toast({
        title: tj.toasts.deleteErrorTitle,
        description:
          code && code in tj.errors
            ? tj.errors[code as keyof typeof tj.errors]
            : tj.toasts.deleteErrorDesc,
        variant: "destructive",
      });
    } else {
      toast({
        title: tj.toasts.deletedTitle,
        description: tj.toasts.deletedDesc,
      });
      loadJobs();
    }

    setDeleteJobId(null);
    setDeleting(false);
  };

  const errorText = (code: string | undefined, fallback: string) =>
    code && code in tj.errors
      ? (tj.errors[code as keyof typeof tj.errors] as string)
      : fallback;

  const openClose = (jobId: string) => {
    setCloseReason("");
    setCloseError(null);
    setCloseJobId(jobId);
  };

  const handleCloseJob = async () => {
    if (!closeJobId) return;
    const parsed = jobClosureSchema.safeParse({ reason: closeReason });
    if (!parsed.success) {
      setCloseError(
        errorText(parsed.error.issues[0]?.message, tj.toasts.closeErrorDesc),
      );
      return;
    }
    setClosing(true);
    const res = await fetch(`/api/jobs/${closeJobId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      closure?: { job_id: string; notified_users: number } | null;
    };
    setClosing(false);

    if (!res?.ok || body.closure?.job_id !== closeJobId) {
      // Écran périmé (sélection survenue entre-temps) : la base refuse et
      // la liste est relue.
      setCloseError(errorText(body.code, tj.toasts.closeErrorDesc));
      if (body.code === "job_has_commitments") loadJobs();
      return;
    }
    const notified = body.closure.notified_users;
    toast({
      title: tj.toasts.closedTitle,
      description:
        notified === 0
          ? tj.toasts.closedDescNone
          : plural(notified, tj.toasts.closedDesc, locale),
      variant: "success",
    });
    setCloseJobId(null);
    loadJobs();
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "en-GB",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  };

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || "";
  };

  const getStatusBadge = (
    status: Enums<"job_status"> | null,
    closedAt: string | null,
  ) => {
    if (closedAt) {
      return (
        <Badge className="bg-gray-100 text-gray-700">
          {tj.status.closedByCompany}
        </Badge>
      );
    }
    const label =
      status && status in tj.status
        ? tj.status[status as keyof typeof tj.status]
        : status;
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-700">{label}</Badge>;
      case "pending_review":
        return <Badge className="bg-yellow-100 text-yellow-700">{label}</Badge>;
      case "filled":
        return <Badge className="bg-blue-100 text-blue-700">{label}</Badge>;
      case "expired":
        return <Badge className="bg-gray-100 text-gray-700">{label}</Badge>;
      case "rejected":
      case "cancelled":
        return <Badge className="bg-red-100 text-red-700">{label}</Badge>;
      default:
        return <Badge variant="secondary">{label}</Badge>;
    }
  };

  const filteredJobs = jobs.filter((job) => {
    if (activeTab === "active") {
      return isActiveJob(job.status);
    } else if (activeTab === "draft") {
      return job.status === "draft";
    } else {
      return isClosedJob(job.status);
    }
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const count = (predicate: (job: Job) => boolean) =>
    String(jobs.filter(predicate).length);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{tj.title}</h1>
            <p className="text-sm text-muted-foreground">
              {plural(jobs.length, tj.total, locale)}
            </p>
          </div>
          {!suspended && (
            <Button asChild>
              <Link href="/company/jobs/new">
                <Plus className="h-4 w-4 mr-2" />
                {tj.newJob}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active">
              {tj.tabs.active.replace(
                "{count}",
                count((j) => isActiveJob(j.status)),
              )}
            </TabsTrigger>
            <TabsTrigger value="draft">
              {tj.tabs.draft.replace(
                "{count}",
                count((j) => j.status === "draft"),
              )}
            </TabsTrigger>
            <TabsTrigger value="closed">
              {tj.tabs.closed.replace(
                "{count}",
                count((j) => isClosedJob(j.status)),
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredJobs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">
                    {activeTab === "active" && tj.empty.activeTitle}
                    {activeTab === "draft" && tj.empty.draftTitle}
                    {activeTab === "closed" && tj.empty.closedTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {activeTab === "active" && tj.empty.activeDesc}
                    {activeTab === "draft" && tj.empty.draftDesc}
                    {activeTab === "closed" && tj.empty.closedDesc}
                  </p>
                  {activeTab === "active" && (
                    <Button asChild>
                      <Link href="/company/jobs/new">
                        <Plus className="h-4 w-4 mr-2" />
                        {tj.createJob}
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              filteredJobs.map((job) => (
                <Card key={job.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold truncate">
                            {job.title}
                          </h3>
                          {getStatusBadge(job.status, job.closed_at)}
                          {/* Lot 9d : règle H−24, plus l'ancien indicateur. */}
                          <UrgentBadge className="text-xs" job={job} />
                        </div>

                        {job.status === "rejected" && job.rejection_reason && (
                          <p className="mt-1 text-sm text-red-700 break-words">
                            {tj.rejectionReason.replace(
                              "{reason}",
                              job.rejection_reason,
                            )}
                          </p>
                        )}
                        {job.status === "rejected" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tj.rejectedNext}
                          </p>
                        )}
                        {job.closed_at && (
                          <p className="mt-1 text-sm text-muted-foreground break-words">
                            {tj.closedOn
                              .replace(
                                "{date}",
                                doualaDateTime(job.closed_at, locale),
                              )
                              .replace(
                                "{reason}",
                                removals.get(job.id)?.closureReason ?? "—",
                              )}
                          </p>
                        )}
                        {job.status === "active" && !directEdit && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tj.lockedPlan}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(job.start_date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {job.days && hoursVary(job.days) ? (
                              ts.variableHours
                            ) : (
                              <>
                                {formatTime(job.start_time)} -{" "}
                                {formatTime(job.end_time)}
                              </>
                            )}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
                          <div className="flex items-center gap-1.5 text-sm">
                            <Users className="h-4 w-4 text-violet-600" />
                            <span className="font-medium">
                              {job._count?.applications || 0}
                            </span>
                            <span className="text-muted-foreground">
                              {plural(
                                job._count?.applications || 0,
                                tj.applications,
                                locale,
                              )}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">
                              {job.positions_filled}
                            </span>
                            <span className="text-muted-foreground">
                              {plural(
                                job.positions_available ?? 0,
                                tj.positions,
                                locale,
                              )}
                            </span>
                          </div>
                          <MissionPay
                            amount={job.mission_pay_per_candidate}
                            amountClassName="text-sm text-violet-600"
                          />
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/company/jobs/${job.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              {tj.actions.viewApplications}
                            </Link>
                          </DropdownMenuItem>
                          {!suspended && canEditJob(job, directEdit) && (
                            <DropdownMenuItem asChild>
                              <Link href={`/company/jobs/${job.id}/edit`}>
                                <Edit className="h-4 w-4 mr-2" />
                                {tj.actions.edit}
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {!suspended &&
                            removals.get(job.id)?.action === "delete" && (
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => setDeleteJobId(job.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {tj.actions.delete}
                              </DropdownMenuItem>
                            )}
                          {!suspended &&
                            removals.get(job.id)?.action === "close" && (
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => openClose(job.id)}
                              >
                                <Archive className="h-4 w-4 mr-2" />
                                {tj.actions.close}
                              </DropdownMenuItem>
                            )}
                          {removals.get(job.id)?.action === "support" && (
                            <DropdownMenuItem
                              onClick={() => setSupportOpen(true)}
                            >
                              <LifeBuoy className="h-4 w-4 mr-2" />
                              {tj.actions.support}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteJobId}
        onOpenChange={() => setDeleteJobId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tj.deleteDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {tj.deleteDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setDeleteJobId(null)}
              disabled={deleting}
            >
              {tj.deleteDialog.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteJob}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
            >
              {deleting ? tj.deleteDialog.deleting : tj.deleteDialog.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lot 17d-1 : clôture d'une offre publiée sans engagement */}
      <Dialog
        open={!!closeJobId}
        onOpenChange={(open) => {
          if (!open && !closing) setCloseJobId(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tj.closeDialog.title}</DialogTitle>
            <DialogDescription>{tj.closeDialog.description}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {tj.closeDialog.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="closure-reason">{tj.closeDialog.reasonLabel}</Label>
            <Textarea
              id="closure-reason"
              value={closeReason}
              maxLength={500}
              rows={3}
              placeholder={tj.closeDialog.reasonPlaceholder}
              onChange={(e) => {
                setCloseReason(e.target.value);
                setCloseError(null);
              }}
              aria-describedby="closure-reason-hint"
            />
            <p
              id="closure-reason-hint"
              className="text-xs text-muted-foreground"
            >
              {tj.closeDialog.reasonHint}
            </p>
            {closeError && (
              <p role="alert" className="text-sm text-destructive">
                {closeError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCloseJobId(null)}
              disabled={closing}
            >
              {tj.closeDialog.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCloseJob}
              disabled={closing}
            >
              {closing ? tj.closeDialog.closing : tj.closeDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={supportOpen} onOpenChange={setSupportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tj.supportDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {tj.supportDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* AlertDialogAction ne ferme pas seul (composant du dépôt). */}
            <Button onClick={() => setSupportOpen(false)}>
              {tj.supportDialog.ok}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
