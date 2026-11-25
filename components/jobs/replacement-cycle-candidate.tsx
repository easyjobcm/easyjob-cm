"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import { doualaDateTime, doualaTime } from "@/lib/utils/douala-time";
import { formatDayDate } from "@/lib/jobs/schedule";
import { loginHref } from "@/lib/auth/safe-redirect";
import { replacementState } from "@/lib/validations/replacement";
import type { Database } from "@/lib/database.types";

type Cycle =
  Database["public"]["Functions"]["job_replacement_cycles"]["Returns"][number];

/**
 * Lot 17d-4a (ANN-14, ANN-20) — recrutement de remplacement vu par le
 * candidat : journées et places réellement libérées, fermeture à H−2,
 * confirmation d'intérêt explicite liée au cycle (l'ancienne candidature
 * n'est jamais réactivée), retrait. La base tranche tout ; l'écran relit
 * la RPC à chaque signal, reconnexion ou retour au premier plan, et se
 * ferme à l'heure du serveur.
 */
export function ReplacementCycleCandidate({
  jobId,
  isLoggedIn,
  suspended,
}: {
  jobId: string;
  isLoggedIn: boolean;
  suspended: boolean;
}) {
  const { t, locale } = useI18n();
  const tr = t.replacement.candidate;
  const reduce = useReducedMotion();
  const [target, setTarget] = React.useState<Cycle | null>(null);
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Lecture en échec (réseau) : SWR conserve l'affichage précédent.
  const { data: cycles = [], mutate } = useSWR(
    ["job_replacement_cycles", jobId],
    async (): Promise<Cycle[]> => {
      const { data, error: readError } = await createClient().rpc(
        "job_replacement_cycles",
        { p_job_id: jobId },
      );
      if (readError) throw readError;
      return data ?? [];
    },
  );
  const load = React.useCallback(async () => {
    await mutate();
  }, [mutate]);
  useLiveRefresh(
    ["public:jobs", "jobs", "applications", "profile", "account"],
    load,
  );
  const now = useDeadlineNow(cycles.map((c) => Date.parse(c.closes_at)));

  const errorText = (code: string | undefined) =>
    (code &&
      ((tr.errors as Record<string, string>)[code] ??
        (tr.blockers as Record<string, string>)[code])) ||
    tr.errors.generic;

  const confirm = async () => {
    if (!target || !consent || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/replacement-cycles/${target.cycle_id}/interest`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      },
    ).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as
      | { code?: string }
      | undefined;
    setBusy(false);
    if (!res) {
      setError(tr.errors.network);
      return;
    }
    if (!res.ok) {
      setError(errorText(body?.code));
      await load();
      return;
    }
    toast({ variant: "success", title: tr.done });
    setTarget(null);
    setConsent(false);
    await load();
  };

  const withdraw = async (cycle: Cycle) => {
    if (!cycle.my_application_id || busy) return;
    if (!window.confirm(tr.withdrawConfirm)) return;
    setBusy(true);
    const res = await fetch(
      `/api/jobs/${jobId}/apply?application=${cycle.my_application_id}`,
      { method: "DELETE" },
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast({
        variant: "destructive",
        title: res ? tr.errors.generic : tr.errors.network,
      });
    } else {
      toast({ variant: "success", title: tr.withdrawnDone });
    }
    await load();
  };

  // Cycles affichés : ouverts (heure du serveur), ou ceux où le candidat a
  // déjà confirmé (son état reste lisible après la fermeture).
  const visible = cycles.filter((c) => {
    const open =
      replacementState(c.state) === "open" && now < Date.parse(c.closes_at);
    return open || !!c.my_application_id;
  });
  if (visible.length === 0) return null;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3"
      data-testid="replacement-candidate"
      aria-labelledby="replacement-candidate-title"
    >
      <div className="flex items-center gap-2">
        <RefreshCcw className="h-4 w-4 text-primary" aria-hidden />
        <h2 id="replacement-candidate-title" className="font-semibold">
          {tr.title}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{tr.intro}</p>
      <ul className="space-y-3">
        {visible.map((c) => {
          const closesAt = Date.parse(c.closes_at);
          const dbState = replacementState(c.state);
          const state =
            dbState === "cancelled" || now < closesAt ? dbState : "closed";
          const status = c.my_status;
          return (
            <li
              key={c.cycle_id}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
              data-testid="replacement-cycle"
              data-cycle={c.cycle_id}
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
                {state === "open" ? (
                  <Badge variant="secondary">
                    {plural(c.places_open, tr.places, locale).replace(
                      "{count}",
                      String(c.places_open),
                    )}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    {state === "filled"
                      ? tr.filled
                      : state === "unavailable"
                        ? tr.unavailable
                        : state === "cancelled"
                          ? tr.cancelled
                          : tr.closed}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {tr.hours
                  .replace("{start}", doualaTime(c.starts_at, locale))
                  .replace("{end}", doualaTime(c.ends_at, locale))}
                {" · "}
                <span data-testid="replacement-closes">
                  {tr.closesAt.replace(
                    "{date}",
                    doualaDateTime(c.closes_at, locale),
                  )}
                </span>
              </p>

              {status === "selected" ? (
                <p
                  className="text-sm font-medium text-primary"
                  data-testid="replacement-mine"
                >
                  {tr.selected}
                </p>
              ) : status === "rejected" ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="replacement-mine"
                >
                  {tr.rejected}
                </p>
              ) : status === "withdrawn" ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="replacement-mine"
                >
                  {tr.withdrawn}
                </p>
              ) : c.my_application_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className="text-sm font-medium text-primary"
                    data-testid="replacement-mine"
                  >
                    {tr.confirmed}
                  </p>
                  {state === "open" && !suspended && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void withdraw(c)}
                      data-testid="replacement-withdraw"
                    >
                      {tr.withdraw}
                    </Button>
                  )}
                </div>
              ) : state !== "open" ? null : !isLoggedIn ? (
                <Link
                  href={loginHref(`/jobs/${jobId}`)}
                  className="text-sm font-medium text-primary underline"
                >
                  {tr.login}
                </Link>
              ) : c.my_blocker ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="replacement-blocker"
                  data-code={c.my_blocker}
                >
                  {errorText(c.my_blocker)}
                </p>
              ) : (
                <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={busy || suspended}
                    onClick={() => {
                      setTarget(c);
                      setConsent(false);
                      setError(null);
                    }}
                    data-testid="replacement-confirm"
                  >
                    {tr.confirm}
                  </Button>
                </motion.div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{tr.noSelectionPromise}</p>

      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr.dialogTitle}</DialogTitle>
            <DialogDescription>{tr.dialogBody}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={consent}
              onCheckedChange={setConsent}
              aria-label={tr.consent}
              data-testid="replacement-consent"
            />
            <span>{tr.consent}</span>
          </label>
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="replacement-error"
            >
              {error}
            </p>
          )}
          <DialogFooter className="pb-[env(safe-area-inset-bottom)]">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              {tr.cancel}
            </Button>
            <Button
              disabled={!consent || busy}
              onClick={() => void confirm()}
              data-testid="replacement-submit"
            >
              {tr.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}
