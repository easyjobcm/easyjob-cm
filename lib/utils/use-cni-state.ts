"use client";

import * as React from "react";
import { useServerNow } from "@/lib/realtime/provider";
import {
  cniExpiryInstant,
  cniState,
  type CniProfileFields,
  type CniState,
} from "./cni-validity";

/** Délai maximal d'un minuteur navigateur (≈ 24,8 jours). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * État de la CNI pour l'affichage, recalculé à l'échéance sur un écran
 * déjà ouvert : une minuterie locale est posée sur l'instant d'expiration
 * (heure du serveur, lot 7d), sans interroger le serveur. Les décisions
 * (soumission, approbation, refus) arrivent par le signal Realtime
 * `profile`, qui relit la page.
 */
export function useCniState(cni: CniProfileFields | null): CniState | null {
  const serverNow = useServerNow();
  const [now, setNow] = React.useState(() => serverNow());
  const expiry = cni ? cniExpiryInstant(cni.cni_expires_at) : null;
  // Expirée strictement après l'instant : la bascule a lieu juste après.
  const next = expiry !== null && expiry >= now ? expiry + 1 : null;

  // Écart d'horloge connu après le montage : l'instant est recalé.
  React.useEffect(() => {
    const id = window.setTimeout(() => setNow(serverNow()), 0);
    return () => window.clearTimeout(id);
  }, [serverNow]);

  React.useEffect(() => {
    if (next === null) return;
    const delay = Math.min(
      Math.max(0, next - serverNow()) + 50,
      MAX_TIMEOUT_MS,
    );
    const id = window.setTimeout(() => setNow(serverNow()), delay);
    return () => window.clearTimeout(id);
  }, [next, serverNow]);

  return cni ? cniState(cni, now) : null;
}
