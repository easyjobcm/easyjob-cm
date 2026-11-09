"use client";

import * as React from "react";
import { useServerNow } from "@/lib/realtime/provider";
import { isJobUrgent, nextUrgencyChange, type UrgencyJob } from "./urgency";

/** Délai maximal d'un minuteur navigateur (≈ 24,8 jours). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Badge « Urgente » d'une offre, recalculé sur un écran déjà ouvert : un
 * minuteur est posé sur la prochaine bascule (entrée dans les 24 h, puis
 * début de l'offre), avec l'heure du serveur.
 */
export function useJobUrgent(job: UrgencyJob): boolean {
  const serverNow = useServerNow();
  const [now, setNow] = React.useState(() => serverNow());
  const next = nextUrgencyChange(job, now);

  // Écart d'horloge connu après le montage : l'instant est recalé.
  React.useEffect(() => {
    const id = window.setTimeout(() => setNow(serverNow()), 0);
    return () => window.clearTimeout(id);
  }, [serverNow]);

  React.useEffect(() => {
    if (next === null) return;
    // +50 ms : la bascule est franchie quand le minuteur se déclenche.
    const delay = Math.min(
      Math.max(0, next - serverNow()) + 50,
      MAX_TIMEOUT_MS,
    );
    const id = window.setTimeout(() => setNow(serverNow()), delay);
    return () => window.clearTimeout(id);
  }, [next, serverNow]);

  return isJobUrgent(job, now);
}
