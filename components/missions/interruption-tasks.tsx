"use client";

import Link from "next/link";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, ChevronRight, Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatXaf } from "@/lib/utils";
import { formatDayDate } from "@/lib/jobs/schedule";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { useLiveRefresh } from "@/lib/realtime/provider";
import {
  parseInterruptionTasks,
  type InterruptionTask,
} from "@/lib/validations/partial-day";

const fetchJson = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/**
 * Tâches persistantes d'une partie sur les interruptions (candidat dans
 * Tâches, entreprise sur son tableau de bord) : version attendue, demande
 * du support (réponse ou pièce), proposition du fondateur à accepter ou
 * refuser dans le dossier, code après un accord. Échéance exacte en heure
 * de Douala, calculée par la base ; relecture sur signal temps réel.
 */
export function InterruptionTasks() {
  const { t, locale } = useI18n();
  const tp = t.partialDay;
  const reduceMotion = useReducedMotion();
  const { data, mutate } = useSWR("/api/interruptions/tasks", fetchJson);
  useLiveRefresh(["incidents", "missions"], () => {
    void mutate();
  });
  const tasks = parseInterruptionTasks(
    (data as { tasks?: unknown } | undefined)?.tasks,
  );
  if (tasks.length === 0) return null;

  const label = (task: InterruptionTask) => {
    const amount = formatXaf(task.amount ?? 0, locale);
    switch (task.action) {
      case "give_version":
        return tp.taskActions.give_version;
      case "answer_request":
        return tp.taskActions.answer_request;
      case "respond_proposal":
        return tp.taskActions.respond_proposal.replace("{amount}", amount);
      case "agreement_code":
        return (
          task.viewer === "candidate"
            ? tp.taskActions.agreement_code_candidate
            : tp.taskActions.agreement_code_company
        ).replace("{amount}", amount);
    }
  };

  return (
    <Card className="mb-4 border-primary/30" data-testid="interruption-tasks">
      <CardContent className="space-y-2 p-4">
        <h2 className="font-semibold text-foreground">{tp.tasksTitle}</h2>
        {tasks.map((task) => {
          const href =
            task.viewer === "candidate"
              ? `/missions/${task.mission_id}`
              : `/company/jobs/${task.job_id}`;
          return (
            <div
              key={`${task.incident_id}-${task.action}-${task.request_id ?? ""}`}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="interruption-task"
              data-action={task.action}
            >
              <div className="min-w-0 space-y-1 text-sm">
                <p className="flex items-start gap-2 font-medium">
                  <Hourglass
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="break-words">{label(task)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.job_title} ·{" "}
                  {tp.taskTitle.replace(
                    "{date}",
                    formatDayDate(task.day_date, locale),
                  )}
                </p>
                {task.due_at && (
                  <p
                    className="flex items-center gap-1 text-xs"
                    data-testid="interruption-task-due"
                  >
                    <CalendarClock className="h-3 w-3" aria-hidden />
                    {tp.dueAt.replace(
                      "{time}",
                      doualaDateTime(task.due_at, locale),
                    )}
                  </p>
                )}
              </div>
              <motion.div whileTap={reduceMotion ? undefined : { scale: 0.97 }}>
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="w-full sm:w-auto"
                >
                  <Link href={href} data-testid="interruption-task-open">
                    {tp.taskOpen}
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </motion.div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
