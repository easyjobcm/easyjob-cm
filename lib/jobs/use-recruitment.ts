"use client";

import * as React from "react";
import { useServerNow } from "@/lib/realtime/provider";
import { nextRecruitmentChange, type RecruitmentJob } from "./recruitment";

/** Délai maximal d'un minuteur navigateur (≈ 24,8 jours). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Heure du serveur (ms) recalculée à la prochaine échéance de recrutement
 * des offres affichées : une minuterie locale, sans relecture HTTP
 * périodique. Le retour au premier plan et la reconnexion relisent les
 * données par `useLiveRefresh` (provider Realtime).
 */
export function useRecruitmentNow(jobs: readonly RecruitmentJob[]): number {
  const serverNow = useServerNow();
  const [now, setNow] = React.useState(() => serverNow());
  const next = nextRecruitmentChange(jobs, now);

  // Écart d'horloge connu après le montage : l'instant est recalé.
  React.useEffect(() => {
    const id = window.setTimeout(() => setNow(serverNow()), 0);
    return () => window.clearTimeout(id);
  }, [serverNow]);

  React.useEffect(() => {
    if (next === null) return;
    // +50 ms : l'échéance est franchie quand le minuteur se déclenche.
    const delay = Math.min(
      Math.max(0, next - serverNow()) + 50,
      MAX_TIMEOUT_MS,
    );
    const id = window.setTimeout(() => setNow(serverNow()), delay);
    return () => window.clearTimeout(id);
  }, [next, serverNow]);

  // Retour au premier plan : un minuteur gelé en arrière-plan est rattrapé.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(serverNow());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [serverNow]);

  return now;
}
