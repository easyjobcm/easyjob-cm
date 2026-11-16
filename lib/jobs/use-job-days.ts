"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { useLatestRequest } from "@/lib/realtime/provider";
import type { CandidateJobDay } from "@/lib/jobs/day-state";

export type JobDaysStatus = "ok" | "error";

/**
 * Journées d'une offre pour le candidat, avec leur compatibilité (lot 12).
 *
 * Première valeur : lecture serveur de la page. Ensuite, chaque relecture
 * (signal privé, reconnexion, retour au premier plan, « Réessayer ») appelle
 * la RPC `job_days_for_candidate` avec la session : la base calcule la
 * compatibilité, l'écran n'en déduit rien lui-même. Aucune relecture
 * périodique.
 *
 * Une lecture en échec ne vaut jamais « disponible » : l'état passe à
 * `error`, les dernières journées connues restent affichées pour information
 * et l'écran bloque le choix et la candidature jusqu'à une lecture réussie.
 */
export function useJobDays(
  jobId: string,
  initialDays: readonly CandidateJobDay[],
  initialFailed: boolean,
): {
  days: readonly CandidateJobDay[];
  status: JobDaysStatus;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const latest = useLatestRequest();
  const [state, setState] = React.useState<{
    days: readonly CandidateJobDay[];
    status: JobDaysStatus;
    loading: boolean;
  }>({
    days: initialDays,
    status: initialFailed ? "error" : "ok",
    loading: false,
  });

  const reload = React.useCallback(async () => {
    const token = latest.begin();
    setState((prev) => ({ ...prev, loading: true }));
    let next: readonly CandidateJobDay[] | null = null;
    try {
      const { data, error } = await createClient().rpc(
        "job_days_for_candidate",
        { p_job_id: jobId },
      );
      if (!error && Array.isArray(data)) next = data;
    } catch {
      next = null;
    }
    // Une relecture plus récente est partie : cette réponse est ignorée.
    if (!latest.isLatest(token)) return;
    setState((prev) =>
      next
        ? { days: next, status: "ok", loading: false }
        : { days: prev.days, status: "error", loading: false },
    );
  }, [jobId, latest]);

  return { ...state, reload };
}
