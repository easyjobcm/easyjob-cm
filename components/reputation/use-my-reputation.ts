"use client";

import useSWR from "swr";
import { useLiveRefresh } from "@/lib/realtime/provider";
import {
  myReputationSchema,
  type MyReputation,
} from "@/lib/reputation/progress";

export const MY_REPUTATION_KEY = "/api/reputation";

async function fetchMyReputation(url: string): Promise<MyReputation | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`reputation ${res.status}`);
  const body = (await res.json()) as { reputation?: unknown };
  if (body.reputation === null || body.reputation === undefined) return null;
  return myReputationSchema.parse(body.reputation);
}

/**
 * Réputation du compte connecté, partagée par la carte de progression et
 * l'animation (même clé SWR) ; relue sur les signaux `reputation` et
 * `notifications`, à la reconnexion et au retour au premier plan.
 *
 * Un signal force une NOUVELLE lecture : `mutate()` seul réutiliserait une
 * requête déjà en vol (déduplication SWR), lancée avant le changement.
 */
export function useMyReputation(enabled = true) {
  const swr = useSWR(enabled ? MY_REPUTATION_KEY : null, fetchMyReputation, {
    revalidateOnFocus: false,
  });
  const { mutate } = swr;
  useLiveRefresh(
    ["reputation", "notifications"],
    () =>
      mutate(fetchMyReputation(MY_REPUTATION_KEY), {
        revalidate: false,
      }).catch(() => undefined),
    enabled,
  );
  return swr;
}
