"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
import {
  Users,
  Briefcase,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Shield,
  AlertTriangle,
  Settings,
  FileCheck,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import packageJson from "@/package.json";
import { motion } from "framer-motion";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/hooks/use-toast";

interface AdminDashboardClientProps {
  pendingJobs: Array<{
    id: string;
    title: string;
    description: string;
    city: string;
    start_date: string;
    end_date?: string | null;
    start_time: string;
    end_time: string;
    mission_pay_per_candidate: number;
    positions_available: number | null;
    urgency?: string | null;
    updated_at: string | null;
    company?: {
      company_name?: string;
    };
  }>;
  stats: {
    totalUsers: number;
    totalCandidates: number;
    totalCompanies: number;
    totalJobs: number;
    pendingJobs: number;
    activeJobs: number;
    totalApplications: number;
  };
}

type PendingJob = AdminDashboardClientProps["pendingJobs"][number];

export function AdminDashboardClient({
  pendingJobs,
  stats,
}: AdminDashboardClientProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [selectedJob, setSelectedJob] = React.useState<PendingJob | null>(null);
  const [moderating, setModerating] = React.useState(false);
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const moderatingRef = React.useRef(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const { toast } = useToast();
  // Référence stable : Modal reprend le focus quand onClose change, ce qui
  // ferait perdre la saisie du motif à chaque frappe.
  const closeJob = React.useCallback(() => setSelectedJob(null), []);

  const supabase = createClient();
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const tm = t.admin.moderation;
  const openJob = (job: PendingJob, reject: boolean) => {
    setSelectedJob(job);
    setRejecting(reject);
    setRejectReason("");
  };

  const handleModerate = async (
    job: PendingJob,
    action: "approve" | "reject",
  ) => {
    if (moderatingRef.current) return;
    moderatingRef.current = true;
    setModerating(true);
    let code = "moderation_failed";
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: action === "reject" ? rejectReason : undefined,
          // Refus en base si l'offre a changé depuis son affichage.
          seen_updated_at: job.updated_at ?? undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        status?: string;
      };
      const expected = action === "approve" ? "active" : "rejected";
      if (res.ok && body.status === expected) {
        toast({
          title: action === "approve" ? tm.approve : tm.reject,
          description:
            action === "approve" ? tm.approvedToast : tm.rejectedToast,
          variant: "success",
        });
        setSelectedJob(null);
        router.refresh();
        return;
      }
      code = body.code ?? code;
    } catch (error) {
      console.error("Moderation error:", error);
    } finally {
      moderatingRef.current = false;
      setModerating(false);
    }

    toast({
      title: tm.errorTitle,
      description:
        code in tm.errors
          ? tm.errors[code as keyof typeof tm.errors]
          : tm.errors.moderation_failed,
      variant: "destructive",
    });
    // Décision déjà prise ou offre modifiée : l'écran est obsolète.
    if (code === "job_not_pending" || code === "job_changed") {
      setSelectedJob(null);
      router.refresh();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="min-h-screen space-y-6 bg-background"
    >
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-foreground">
                {t.admin.dashboard.title}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t.admin.dashboard.subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LangSwitch />
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon">
              <Link href="/admin/settings">
                <Settings className="w-5 h-5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-linear-to-br from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalUsers}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.admin.stats.users}
              </p>
              <div className="flex gap-2 mt-2 text-xs">
                <span className="text-muted-foreground">
                  {stats.totalCandidates} {t.admin.stats.candidates}
                </span>
                <span className="text-muted-foreground">
                  {stats.totalCompanies} {t.admin.stats.companies}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-linear-to-br from-success/10 to-success/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-5 h-5 text-success" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalJobs}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.admin.stats.totalJobs}
              </p>
              <div className="flex gap-2 mt-2 text-xs">
                <span className="text-success">
                  {stats.activeJobs} {t.admin.stats.activeJobs}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalApplications}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.admin.stats.applications}
              </p>
            </CardContent>
          </Card>

          <Card
            className={
              stats.pendingJobs > 0 ? "border-warning/50 bg-warning/5" : ""
            }
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.pendingJobs}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.admin.stats.pending}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-4 gap-3">
          <Link href="/admin/candidates">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Users className="w-6 h-6 text-primary mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {t.admin.quickActions.users}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/jobs">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Briefcase className="w-6 h-6 text-success mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {t.admin.quickActions.jobs}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/momo">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <FileCheck className="w-6 h-6 text-warning mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {t.admin.quickActions.momo}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/skill-documents">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <FileCheck className="w-6 h-6 text-primary mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {t.admin.quickActions.skillProofs}
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Pending Jobs for Moderation */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">
              {t.admin.moderation.pendingJobsTitle}
              {stats.pendingJobs > 0 && (
                <Badge variant="warning" className="ml-2">
                  {stats.pendingJobs}
                </Badge>
              )}
            </h2>
            <Link
              href="/admin/jobs?status=pending"
              className="text-sm text-primary font-medium"
            >
              {t.admin.moderation.viewAll}
            </Link>
          </div>

          {pendingJobs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {t.admin.moderation.empty}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingJobs.slice(0, 5).map((job) => (
                <Card key={job.id} className="hover:shadow-md transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="warning">
                            {t.admin.moderation.pendingStatus}
                          </Badge>
                          {job.urgency !== "normal" && (
                            <Badge variant="destructive">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              {t.admin.moderation.urgent}
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground truncate">
                          {job.title}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate">
                          {job.company?.company_name}
                        </p>
                      </div>
                      <MissionPay
                        amount={job.mission_pay_per_candidate}
                        amountClassName="text-sm text-primary"
                        className="justify-end text-right"
                      />
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => openJob(job, false)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        {t.admin.moderation.view}
                      </Button>
                      <Button
                        variant="success"
                        size="sm"
                        className="flex-1"
                        disabled={moderating}
                        onClick={() => handleModerate(job, "approve")}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {t.admin.moderation.approve}
                      </Button>
                      {/* Le refus exige un motif : saisi dans l'aperçu. */}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={moderating}
                        aria-label={t.admin.moderation.reject}
                        onClick={() => openJob(job, true)}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Logout */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setShowLogoutModal(true)}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t.profile.logout}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          EasyJob v{packageJson.version}
        </p>
      </div>

      {/* Logout Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title={t.profile.logoutTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t.profile.logoutDesc}</p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowLogoutModal(false)}
            >
              {t.profile.cancel}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? <LoadingSpinner size="sm" /> : t.profile.logout}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Job Preview Modal */}
      <Modal
        isOpen={!!selectedJob}
        onClose={closeJob}
        title={selectedJob?.title || ""}
      >
        {selectedJob && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t.admin.jobPreview.company}
              </p>
              <p className="font-medium">{selectedJob.company?.company_name}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t.admin.jobPreview.description}
              </p>
              <p className="text-sm">{selectedJob.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t.admin.jobPreview.date}
                </p>
                <p className="font-medium">
                  {formatDate(selectedJob.start_date, locale)}
                  {selectedJob.end_date &&
                  selectedJob.end_date !== selectedJob.start_date
                    ? ` – ${formatDate(selectedJob.end_date, locale)}`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t.admin.jobPreview.time}
                </p>
                <p className="font-medium" data-testid="moderation-schedule">
                  {formatTime(selectedJob.start_time, locale)} –{" "}
                  {formatTime(selectedJob.end_time, locale)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t.admin.jobPreview.location}
                </p>
                <p className="font-medium">{selectedJob.city}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t.admin.jobPreview.positions}
                </p>
                <p className="font-medium" data-testid="moderation-positions">
                  {t.admin.jobPreview.positionsValue.replace(
                    "{count}",
                    String(selectedJob.positions_available ?? 1),
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm text-muted-foreground mb-1">
                {t.admin.jobPreview.pay}
              </p>
              <MissionPay
                amount={selectedJob.mission_pay_per_candidate}
                amountClassName="text-lg text-primary"
                testId="moderation-pay"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t.pay.flatNote}
              </p>
            </div>

            {rejecting && (
              <div className="space-y-1.5">
                <label
                  htmlFor="job-reject-reason"
                  className="text-sm font-medium text-foreground"
                >
                  {tm.reasonLabel}
                </label>
                <textarea
                  id="job-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={tm.reasonPlaceholder}
                  maxLength={500}
                  className="w-full min-h-24 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground resize-none"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-4 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSelectedJob(null)}
              >
                {t.common.close}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  rejecting
                    ? handleModerate(selectedJob, "reject")
                    : setRejecting(true)
                }
                disabled={
                  moderating || (rejecting && rejectReason.trim().length < 3)
                }
              >
                <XCircle className="w-4 h-4 mr-2" />
                {rejecting ? tm.confirmReject : tm.reject}
              </Button>
              <Button
                onClick={() => handleModerate(selectedJob, "approve")}
                disabled={moderating || rejecting}
              >
                {moderating ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t.admin.moderation.approve}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
