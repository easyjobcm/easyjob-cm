"use client";

import * as React from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { formatDayDate } from "@/lib/jobs/schedule";
import { replacementState } from "@/lib/validations/replacement";
import type { Database } from "@/lib/database.types";

type Cycle =
  Database["public"]["Functions"]["company_replacement_cycles"]["Returns"][number];

/**
 * Lot 17d-4a (ANN-14) — suivi des cycles de remplacement de l'offre par
 * l'entreprise propriétaire : places libérées et pourvues, fermeture à H−2,
 * nombre de confirmations, avis retenus à l'ouverture. Aucune donnée de
 * candidat ici : les confirmations apparaissent dans la liste des
 * candidatures (« En attente »), sélectionnées par le parcours habituel.
 */
export function ReplacementCycleCompany({ jobId }: { jobId: string }) {
  const { t, locale } = useI18n();
  const tr = t.replacement.company;
  const reduce = useReducedMotion();
  const { data: cycles = [], mutate } = useSWR(
    ["company_replacement_cycles", jobId],
    async (): Promise<Cycle[]> => {
      const { data, error } = await createClient().rpc(
        "company_replacement_cycles",
        { p_job_id: jobId },
      );
      if (error) throw error;
      return data ?? [];
    },
  );
  useLiveRefresh(["jobs", "applications", "contracts", "account"], () =>
    mutate(),
  );
  const now = useDeadlineNow(cycles.map((c) => Date.parse(c.closes_at)));

  if (cycles.length === 0) return null;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3"
      data-testid="replacement-company"
      aria-labelledby="replacement-company-title"
    >
      <div className="flex items-center gap-2">
        <RefreshCcw className="h-4 w-4 text-primary" aria-hidden />
        <h2 id="replacement-company-title" className="font-semibold">
          {tr.title}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{tr.intro}</p>
      <ul className="space-y-2">
        {cycles.map((c) => {
          const dbState = replacementState(c.state);
          const state =
            dbState === "cancelled" || now < Date.parse(c.closes_at)
              ? dbState
              : "closed";
          return (
            <li
              key={c.cycle_id}
              className="rounded-lg border border-border bg-background p-3 space-y-1"
              data-testid="replacement-company-cycle"
              data-state={state}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {c.day_date
                    ? tr.day.replace(
                        "{date}",
                        formatDayDate(c.day_date, locale),
                      )
                    : tr.period.replace(
                        "{date}",
                        doualaDateTime(c.starts_at, locale),
                      )}
                </p>
                <Badge variant={state === "open" ? "secondary" : "outline"}>
                  {tr.states[state]}
                </Badge>
              </div>
              {state === "open" && (
                <p className="text-sm">
                  {plural(c.places_open, tr.placesOpen, locale).replace(
                    "{count}",
                    String(c.places_open),
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {tr.filledOf
                  .replace("{filled}", String(c.places_filled))
                  .replace("{released}", String(c.places_released))}
                {" · "}
                {plural(c.confirmations, tr.confirmations, locale).replace(
                  "{count}",
                  String(c.confirmations),
                )}
              </p>
              <p
                className="text-xs text-muted-foreground"
                data-testid="replacement-company-closes"
              >
                {tr.closesAt.replace(
                  "{date}",
                  doualaDateTime(c.closes_at, locale),
                )}
              </p>
              {c.alerts_withheld && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="replacement-company-withheld"
                >
                  {tr.withheld}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{tr.hint}</p>
    </motion.section>
  );
}
