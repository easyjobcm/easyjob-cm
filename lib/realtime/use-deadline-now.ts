"use client";

import * as React from "react";
import { useServerNow } from "./provider";

/** Délai maximal d'un minuteur navigateur (≈ 24,8 jours). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Prochain instant (ms) strictement après `now`, ou null. */
export function nextDeadline(
  instants: readonly (number | null | undefined)[],
  now: number,
): number | null {
  let next: number | null = null;
  for (const t of instants) {
    if (t == null || Number.isNaN(t) || t <= now) continue;
    if (next === null || t < next) next = t;
  }
  return next;
}

/**
 * Heure du serveur (ms), recalculée à la prochaine échéance de la liste :
 * une minuterie locale calée sur l'heure de la base (écart mesuré par le
 * provider Realtime), sans relecture HTTP périodique. Le retour au premier
 * plan rattrape un minuteur gelé ; la reconnexion relit les données par
 * `useLiveRefresh`. Lots 11b (échéances de recrutement) et 15 (fin prévue
 * d'une journée).
 */
export function useDeadlineNow(
  instants: readonly (number | null | undefined)[],
): number {
  const serverNow = useServerNow();
  const [now, setNow] = React.useState(() => serverNow());
  const next = nextDeadline(instants, now);

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
