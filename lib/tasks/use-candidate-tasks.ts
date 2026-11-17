"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/realtime/provider";
import {
  isProfileLockGroup,
  type ProfileLockGroup,
} from "@/lib/utils/profile-lock";
import type { Database } from "@/lib/database.types";
import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import {
  missionTaskInstants,
  parseActionTasks,
  pendingActionCount,
  type ActionTask,
} from "./candidate-tasks";

type TaskRow =
  Database["public"]["Functions"]["candidate_tasks"]["Returns"][number];
/** Colonnes que `candidate_tasks` peut renvoyer à null. */
export type MissionTask = Omit<
  TaskRow,
  "started_at" | "completed_at" | "contract_id" | "company_name"
> & {
  started_at: string | null;
  completed_at: string | null;
  contract_id: string | null;
  company_name: string | null;
};

export type UpdateRequest = {
  id: string;
  fields: ProfileLockGroup[];
  reason: string | null;
  created_at: string | null;
};

export type TasksData = {
  missions: MissionTask[];
  actions: ActionTask[];
  /** Écart horloge serveur − navigateur, pour cadencer les rappels. */
  clockOffset: number;
  updateRequests: UpdateRequest[];
};

const EMPTY: TasksData = {
  missions: [],
  actions: [],
  clockOffset: 0,
  updateRequests: [],
};

/** Clé SWR partagée : page Tâches et point de l'onglet lisent le même cache. */
export const TASKS_KEY = "/api/tasks";

export const fetchCandidateTasks = async (): Promise<TasksData> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return EMPTY;

  const [tasksRes, requestsRes] = await Promise.all([
    fetch(TASKS_KEY, { cache: "no-store" }).catch(() => null),
    supabase
      .from("profile_update_requests")
      .select("id, fields, reason, created_at")
      .eq("candidate_id", profile.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  if (!tasksRes?.ok) throw new Error("tasks");
  const body = (await tasksRes.json()) as {
    missions: MissionTask[];
    actions?: unknown;
    server_now?: string;
  };
  // Heure de la base si une mission est listée, sinon celle de la route.
  const serverNow = body.missions[0]?.server_now ?? body.server_now;

  return {
    missions: body.missions,
    actions: parseActionTasks(body.actions),
    clockOffset: serverNow ? new Date(serverNow).getTime() - Date.now() : 0,
    updateRequests: (requestsRes.data ?? []).map((r) => ({
      ...r,
      fields: r.fields.filter(isProfileLockGroup),
    })),
  };
};

/** Domaines Realtime qui modifient une tâche du candidat. */
export const TASK_LIVE_KEYS = [
  "missions",
  "contracts",
  "applications",
  "jobs",
  "profile",
  "account",
] as const;

/**
 * Tâches du candidat connecté, relues sur signal Realtime, reconnexion ou
 * retour au premier plan (mécanisme du lot 7d).
 */
export function useCandidateTasks(enabled = true) {
  const swr = useSWR(enabled ? TASKS_KEY : null, fetchCandidateTasks, {
    revalidateOnFocus: false,
  });
  const { mutate } = swr;
  useLiveRefresh(TASK_LIVE_KEYS, () => mutate(), enabled);
  return swr;
}

/**
 * Nombre d'actions en attente, recalculé à l'heure du serveur à chaque
 * échéance (début disponible, fin prévue d'une journée) : le point
 * s'allume sans signal ni rechargement (minuterie `useDeadlineNow`).
 */
export function usePendingTaskCount(enabled = true): number {
  const { data } = useCandidateTasks(enabled);
  const now = useDeadlineNow(
    enabled ? (data?.missions ?? []).flatMap(missionTaskInstants) : [],
  );
  return pendingActionCount(data, now);
}
