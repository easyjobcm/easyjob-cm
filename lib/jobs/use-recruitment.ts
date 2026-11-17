"use client";

import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import { recruitmentCloseInstant, type RecruitmentJob } from "./recruitment";

/**
 * Heure du serveur (ms) recalculée à la prochaine échéance de recrutement
 * des offres affichées (minuterie partagée `useDeadlineNow`).
 */
export function useRecruitmentNow(jobs: readonly RecruitmentJob[]): number {
  return useDeadlineNow(jobs.map(recruitmentCloseInstant));
}
