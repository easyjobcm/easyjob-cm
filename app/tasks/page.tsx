"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Building2,
  Calendar,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  IdCard,
  FileEdit,
  FileSignature,
  KeyRound,
  Loader2,
  Phone,
  Play,
  Star,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CompletionCodeDialog } from "@/components/missions/completion-code-dialog";
import { ReviewDialog } from "@/components/missions/review-dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDateShort } from "@/lib/utils/profile-status";
import { doualaDateTime, doualaTime } from "@/lib/utils/douala-time";
import { useAccountSuspended } from "@/lib/realtime/provider";
import type { ProfileLockGroup } from "@/lib/utils/profile-lock";
import {
  useCandidateTasks,
  type MissionTask,
} from "@/lib/tasks/use-candidate-tasks";
import {
  canStartMission,
  missionEndReached,
  type ActionTask,
} from "@/lib/tasks/candidate-tasks";
import { actionTaskView } from "@/lib/tasks/action-task-view";

const ACTIVE = new Set(["pending", "confirmed"]);

const ACTION_ICONS: Record<ActionTask["kind"], React.ReactNode> = {
  profile: <UserRound className="h-5 w-5" />,
  identity: <UserRound className="h-5 w-5" />,
  phone: <Phone className="h-5 w-5" />,
  momo: <CreditCard className="h-5 w-5" />,
  cni: <IdCard className="h-5 w-5" />,
  document: <FileText className="h-5 w-5" />,
};

/** Identifiant DOM d'une tâche d'action (clé encodée, sans « % »). */
const actionDomId = (key: string) =>
  `task-action-${encodeURIComponent(key).replace(/%/g, "_")}`;

export default function TasksPage() {
  // useSearchParams exige une frontière Suspense au rendu statique.
  return (
    <React.Suspense fallback={null}>
      <TasksContent />
    </React.Suspense>
  );
}

function TasksContent() {
  const searchParams = useSearchParams();
  const focusKey = searchParams.get("task");
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const tr = t.profile.profileUpdateRequests;
  const tm = t.mission;
  const tt = tm.tasks;
  // Missions, contrats, candidatures, offres, profil et compte : relecture
  // sur signal, reconnexion ou retour au premier plan (useCandidateTasks).
  const { data, isLoading, error, mutate } = useCandidateTasks();
  const missions = React.useMemo(() => data?.missions ?? [], [data]);
  const actions = React.useMemo(() => data?.actions ?? [], [data]);
  const updateRequests = data?.updateRequests ?? [];
  const [openRequestId, setOpenRequestId] = React.useState<string | null>(null);

  // Compte suspendu : les actions sont retirées (refusées en base de toute
  // façon : start_mission, submit_completion_code, submit_mission_review).
  const suspended = useAccountSuspended();

  // Horloge locale recalée sur le serveur : les tâches apparaissent à H−15
  // et à l'heure de fin sans recharger la page.
  const offset = data?.clockOffset ?? 0;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const serverNow = now + offset;

  const canStart = (m: MissionTask) => canStartMission(m, serverNow);
  const endReached = (m: MissionTask) => missionEndReached(m, serverNow);

  // Tâche visée par le lien d'un refus (?task=) : mise en évidence, puis
  // focus sur son action, une fois la liste chargée.
  const focusedOnce = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusKey || !data || focusedOnce.current === focusKey) return;
    const el = document.getElementById(actionDomId(focusKey));
    if (!el) return;
    focusedOnce.current = focusKey;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.querySelector<HTMLElement>("[data-testid=task-action-button]")?.focus({
      preventScroll: true,
    });
  }, [focusKey, data]);

  // Rappels quand une tâche devient disponible pendant que la page est
  // ouverte. À la réouverture, la tâche est simplement visible.
  const seen = React.useRef<Map<string, { start: boolean; end: boolean }>>(
    new Map(),
  );
  React.useEffect(() => {
    if (!data) return;
    for (const m of missions) {
      const state = { start: canStart(m), end: endReached(m) };
      const before = seen.current.get(m.mission_id);
      if (before && !before.start && state.start) {
        toast({
          title: tt.startReminderTitle,
          description: tt.startReminder.replace("{job}", m.job_title),
        });
      }
      if (before && !before.end && state.end) {
        toast({
          title: tt.endReminderTitle,
          description: tt.endReminder.replace("{job}", m.job_title),
        });
      }
      seen.current.set(m.mission_id, state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, serverNow]);

  const [startTarget, setStartTarget] = React.useState<MissionTask | null>(
    null,
  );
  const [starting, setStarting] = React.useState(false);
  const startingRef = React.useRef(false);
  const [codeTarget, setCodeTarget] = React.useState<MissionTask | null>(null);
  const [reviewTarget, setReviewTarget] = React.useState<MissionTask | null>(
    null,
  );
  const [highlightSign, setHighlightSign] = React.useState<string | null>(null);

  const reload = async () => (await mutate())?.missions ?? [];

  async function confirmStart() {
    if (!startTarget || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const res = await fetch(`/api/missions/${startTarget.mission_id}/start`, {
      method: "POST",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      available_at?: string;
    };
    // Relire l'état enregistré avant d'annoncer le résultat.
    const fresh = (await reload()).find(
      (m) => m.mission_id === startTarget.mission_id,
    );
    if (fresh?.started_at) {
      toast({
        title: tt.startedToast,
        description: tt.startedAt.replace(
          "{time}",
          doualaTime(fresh.started_at, locale),
        ),
        variant: "success",
      });
      setStartTarget(null);
    } else {
      const errors = tm.errors;
      const message =
        body.code === "too_early" && body.available_at
          ? errors.too_early.replace(
              "{time}",
              doualaTime(body.available_at, locale),
            )
          : body.code && body.code in errors
            ? errors[body.code as keyof typeof errors]
            : errors.generic;
      toast({ title: tt.start, description: message, variant: "destructive" });
    }
    startingRef.current = false;
    setStarting(false);
  }

  async function onCompleted(mission: MissionTask, completedAt: string) {
    setCodeTarget(null);
    toast({
      title: tm.code.successTitle,
      description: tm.code.successAt.replace(
        "{time}",
        doualaTime(completedAt, locale),
      ),
      variant: "success",
    });
    const fresh = (await reload()).find(
      (m) => m.mission_id === mission.mission_id,
    );
    // Notation obligatoire de l'entreprise, aussitôt le code accepté.
    if (!fresh || !fresh.candidate_reviewed) setReviewTarget(fresh ?? mission);
  }

  async function onReviewed(mission: MissionTask) {
    setReviewTarget(null);
    toast({ title: tm.review.thanks, variant: "success" });
    const fresh = (await reload()).find(
      (m) => m.mission_id === mission.mission_id,
    );
    // Remettre la signature en évidence si elle manque encore.
    if (fresh && fresh.contract_id && !fresh.candidate_signed) {
      setHighlightSign(fresh.mission_id);
      toast({ title: tt.sign, description: tt.signAfterReview });
      window.setTimeout(() => {
        document
          .getElementById(`task-sign-${fresh.mission_id}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 100);
    }
  }

  const fieldLabelsFor = (fields: ProfileLockGroup[]) =>
    fields
      .map((g) =>
        g === "identity"
          ? tr.identity
          : g === "cni_documents"
            ? tr.cni_documents
            : g,
      )
      .join(" · ");

  const openRequest = updateRequests.find((r) => r.id === openRequestId);
  const hasTasks =
    missions.length > 0 || updateRequests.length > 0 || actions.length > 0;

  const renderAction = (task: ActionTask) => {
    const view = actionTaskView(task, t, locale);
    const focused = task.key === focusKey;
    return (
      <div
        key={task.key}
        id={actionDomId(task.key)}
        data-testid="task-action"
        data-task-key={task.key}
        data-action-required={task.action_required ? "true" : "false"}
        className={`flex flex-col gap-3 rounded-xl border bg-card p-3 transition-shadow ${
          focused ? "border-primary ring-2 ring-primary/40" : ""
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 shrink-0 text-primary" aria-hidden>
            {ACTION_ICONS[task.kind]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{view.title}</span>
              <Badge
                variant={task.action_required ? "default" : "outline"}
                className={task.action_required ? "bg-primary" : ""}
              >
                {task.action_required
                  ? t.tasks.actionBadge
                  : t.tasks.followUpBadge}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{view.hint}</p>
            {view.reason && (
              <p className="mt-1 text-xs text-destructive">
                {t.tasks.cni.reason.replace("{reason}", view.reason)}
              </p>
            )}
            {task.kind === "document" && task.jobs.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                <span>{t.tasks.concernedJobs} </span>
                {task.jobs.map((j, i) => (
                  <React.Fragment key={j.id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/jobs/${j.id}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {j.title}
                    </Link>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
        <motion.div whileTap={{ scale: 0.97 }} className="w-full sm:w-auto">
          <Button
            size="sm"
            variant={task.action_required ? "default" : "outline"}
            className="w-full sm:w-auto"
            asChild
          >
            <Link href={view.href} data-testid="task-action-button">
              {view.label}
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </motion.div>
      </div>
    );
  };

  const taskRow = (
    key: string,
    icon: React.ReactNode,
    title: string,
    hint: string,
    action: React.ReactNode,
    emphasis = false,
  ) => (
    <div
      key={key}
      id={key}
      data-testid={key.replace(/-[0-9a-f-]{36}$/, "")}
      className={`flex flex-col gap-3 rounded-xl border p-3 transition-shadow sm:flex-row sm:items-center sm:justify-between ${
        emphasis ? "border-primary ring-2 ring-primary/40" : ""
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 text-primary shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      </div>
      {action && (
        <div className="w-full sm:w-auto sm:shrink-0 [&_a]:w-full [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">
          {action}
        </div>
      )}
    </div>
  );

  const renderMission = (m: MissionTask) => {
    const rows: React.ReactNode[] = [];
    if (m.contract_id && !m.candidate_signed) {
      rows.push(
        taskRow(
          `task-sign-${m.mission_id}`,
          <FileSignature className="h-5 w-5" />,
          tt.sign,
          tt.signHint,
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/contracts/${m.contract_id}`}>
                {tt.sign}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </motion.div>,
          highlightSign === m.mission_id,
        ),
      );
    }
    if (!m.started_at && ACTIVE.has(m.status ?? "")) {
      rows.push(
        canStart(m)
          ? taskRow(
              `task-start-${m.mission_id}`,
              <Play className="h-5 w-5" />,
              tt.start,
              tt.startHint.replace(
                "{time}",
                doualaTime(m.scheduled_start_at, locale),
              ),
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  size="sm"
                  onClick={() => setStartTarget(m)}
                  disabled={suspended}
                >
                  {tt.start}
                </Button>
              </motion.div>,
              true,
            )
          : taskRow(
              `task-upcoming-${m.mission_id}`,
              <Calendar className="h-5 w-5" />,
              tt.start,
              tt.startAvailableAt.replace(
                "{time}",
                doualaDateTime(m.start_available_at, locale),
              ),
              null,
            ),
      );
    }
    if (m.started_at && !m.completed_at) {
      rows.push(
        taskRow(
          `task-finish-${m.mission_id}`,
          <KeyRound className="h-5 w-5" />,
          endReached(m)
            ? tt.finish
            : tt.inProgress.replace(
                "{time}",
                doualaTime(m.scheduled_end_at, locale),
              ),
          tt.finishHint,
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button
              size="sm"
              variant={endReached(m) ? "default" : "outline"}
              onClick={() => setCodeTarget(m)}
              disabled={suspended}
            >
              {tt.validate}
            </Button>
          </motion.div>,
          endReached(m),
        ),
      );
    }
    if (m.completed_at && !m.candidate_reviewed) {
      rows.push(
        taskRow(
          `task-review-${m.mission_id}`,
          <Star className="h-5 w-5" />,
          tt.review,
          tt.reviewHint,
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button
              size="sm"
              onClick={() => setReviewTarget(m)}
              disabled={suspended}
            >
              {tt.review}
            </Button>
          </motion.div>,
          true,
        ),
      );
    }
    if (rows.length === 0) return null;

    return (
      <Card key={m.mission_id} data-testid="task-mission">
        <CardContent className="space-y-3 p-4">
          <Link href={`/missions/${m.mission_id}`} className="block">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-foreground">{m.job_title}</h3>
              <Badge variant="outline">
                {tm.status[m.status ?? "pending"]}
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" aria-hidden />
              <span>{m.company_name ?? "—"}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {doualaDateTime(m.scheduled_start_at, locale)} –{" "}
              {doualaTime(m.scheduled_end_at, locale)}
            </div>
            {m.completed_at && (
              <div className="mt-1 flex items-center gap-1 text-xs text-success">
                <CheckCircle className="h-3 w-3" aria-hidden />
                {tm.completedAt.replace(
                  "{time}",
                  doualaTime(m.completed_at, locale),
                )}
              </div>
            )}
          </Link>
          <div className="space-y-2">{rows}</div>
        </CardContent>
      </Card>
    );
  };

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="mb-6 text-2xl font-bold text-foreground">
          {t.nav.tasks}
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error && !data ? (
          <div className="py-16 text-center space-y-4" role="alert">
            <p className="text-muted-foreground">{tm.loadError}</p>
            <Button variant="outline" onClick={() => void mutate()}>
              {tm.retry}
            </Button>
          </div>
        ) : !hasTasks ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-linear-to-br from-primary/20 to-accent/20">
              <ClipboardList className="h-12 w-12 text-primary" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">
              {locale === "fr" ? "Vous êtes prêt !" : "You're all set!"}
            </h2>
            <p className="mb-6 max-w-xs text-muted-foreground">{tt.empty}</p>
            <Link href="/jobs">
              <Button>
                {locale === "fr" ? "Découvrir les offres" : "Discover jobs"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {actions.length > 0 && (
              <section aria-labelledby="tasks-actions-title">
                <Card className="border-primary/30">
                  <CardContent className="space-y-3 p-4">
                    <h2
                      id="tasks-actions-title"
                      className="font-semibold text-foreground"
                    >
                      {t.tasks.actionsTitle}
                    </h2>
                    <div className="space-y-2">{actions.map(renderAction)}</div>
                  </CardContent>
                </Card>
              </section>
            )}

            {updateRequests.map((r) => (
              <Card key={r.id} className="border-primary/40 bg-primary/5">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <FileEdit className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          {tr.title}
                        </h3>
                        <Badge variant="default" className="bg-primary">
                          {fieldLabelsFor(r.fields)}
                        </Badge>
                      </div>
                      {r.created_at && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDateShort(r.created_at, locale)}
                        </p>
                      )}
                    </div>
                  </div>
                  {r.reason && (
                    <p className="rounded-lg bg-card/70 px-3 py-2 text-sm text-muted-foreground">
                      {r.reason}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => setOpenRequestId(r.id)}
                  >
                    {tr.start}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}

            {missions.map(renderMission)}
          </div>
        )}
      </div>

      <Dialog
        open={!!startTarget}
        onOpenChange={(open) => !starting && !open && setStartTarget(null)}
      >
        <DialogContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-mission-title"
        >
          <DialogHeader>
            <DialogTitle id="start-mission-title">
              {tt.startConfirmTitle}
            </DialogTitle>
            <DialogDescription>
              {tt.startConfirmDescription.replace(
                "{job}",
                startTarget?.job_title ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setStartTarget(null)}
              disabled={starting}
            >
              {tt.cancel}
            </Button>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => void confirmStart()}
                disabled={starting || suspended}
                data-testid="start-confirm"
              >
                {starting ? tt.starting : tt.startConfirm}
              </Button>
            </motion.div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {codeTarget && (
        <CompletionCodeDialog
          open={!!codeTarget}
          onOpenChange={(open) => !open && setCodeTarget(null)}
          missionId={codeTarget.mission_id}
          jobTitle={codeTarget.job_title}
          onCompleted={(at) => void onCompleted(codeTarget, at)}
        />
      )}

      {reviewTarget && (
        <ReviewDialog
          open={!!reviewTarget}
          onOpenChange={(open) => !open && setReviewTarget(null)}
          missionId={reviewTarget.mission_id}
          reviewer="candidate"
          name={reviewTarget.company_name ?? "—"}
          onReviewed={() => void onReviewed(reviewTarget)}
        />
      )}

      <Modal
        isOpen={!!openRequest}
        onClose={() => setOpenRequestId(null)}
        title={tr.title}
      >
        {openRequest && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {openRequest.fields.map((g) => (
                <Badge key={g} variant="outline">
                  {fieldLabelsFor([g])}
                </Badge>
              ))}
            </div>
            {openRequest.reason && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {tr.reasonLabel} :{" "}
                </span>
                {openRequest.reason}
              </p>
            )}
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {tr.hint}
            </p>
            <div className="flex flex-col gap-2">
              {openRequest.fields.includes("identity") && (
                <Button
                  onClick={() => {
                    setOpenRequestId(null);
                    router.push("/profile/candidate/edit");
                  }}
                >
                  {tr.goToEdit}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
              {openRequest.fields.includes("cni_documents") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenRequestId(null);
                    router.push("/profile/candidate/edit?focus=photo");
                  }}
                >
                  {tr.goToDocuments}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
