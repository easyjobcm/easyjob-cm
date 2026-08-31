"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Abonne le candidat connecté aux changements Realtime de ses missions et de
 * ses candidatures, puis revalide la clé SWR fournie à chaque événement.
 *
 * Remplace le polling SWR : mise à jour instantanée du statut de candidature
 * et des validations arrivée/départ (onglets Tâches et Mes Jobs).
 *
 * La RLS Supabase garantit que seuls les enregistrements du candidat sont
 * diffusés ; le filtre `candidate_id` limite en plus le trafic côté canal.
 *
 * @param revalidateKey Clé SWR à revalider (ex. "/api/tasks").
 * @param enabled       Désactive l'abonnement tant que false (ex. chargement).
 */
export function useRealtimeCandidateSync(
  revalidateKey: string,
  enabled = true,
): void {
  const { mutate } = useSWRConfig();

  React.useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const revalidate = () => {
      void mutate(revalidateKey);
    };

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("candidate_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!profile || cancelled) return;

      channel = supabase
        .channel(`candidate-sync-${profile.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "missions",
            filter: `candidate_id=eq.${profile.id}`,
          },
          revalidate,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "job_applications",
            filter: `candidate_id=eq.${profile.id}`,
          },
          revalidate,
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [enabled, mutate, revalidateKey]);
}
