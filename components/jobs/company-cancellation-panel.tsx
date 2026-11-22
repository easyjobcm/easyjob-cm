"use client";

import * as React from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useLiveRefresh } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { formatDayDate, formatDayHours } from "@/lib/jobs/schedule";
import {
  COMPANY_CANCELLATION_REASON_MAX,
  COMPANY_CANCELLATION_REASON_MIN,
  dayIdsForDates,
  groupPreviewByDate,
  type CompanyCancellationDate,
  type CompanyCancellationEvent,
  type CompanyCancellationPreviewDay,
} from "@/lib/validations/company-cancellation";

type Payload = {
  days: CompanyCancellationPreviewDay[];
  cancellations: CompanyCancellationEvent[];
};

async function load(url: string): Promise<Payload> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Partial<Payload>;
  return { days: body.days ?? [], cancellations: body.cancellations ?? [] };
}

// Codes qui signalent un aperçu dépassé : la liste est relue et la
// confirmation repart d'une nouvelle clé.
const STALE = new Set([
  "cancellation_preview_stale",
  "late_not_acknowledged",
  "day_already_cancelled",
  "day_started",
  "day_already_begun",
  "mission_not_active",
  "request_conflict",
]);

/**
 * Lot 17d-2 — annulation par l'entreprise après sélection (ANN-06).
 * L'entreprise choisit des dates entières (tous les candidats encore
 * engagés ce jour-là) ; la qualification affichée est celle calculée par la
 * base sur le plan figé à la sélection. Aucune sanction, aucun frais.
 */
export function CompanyCancellationPanel({
  jobId,
  disabled,
  onDone,
}: {
  jobId: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const tc = t.companyCancellation;
  const url = `/api/jobs/${jobId}/cancellation`;
  const { data, error, mutate } = useSWR<Payload>(url, load);
  // Journée commencée, désistement, nouvelle sélection, reconnexion.
  useLiveRefresh(
    ["missions", "applications", "contracts"],
    () => void mutate(),
  );
  const [open, setOpen] = React.useState(false);

  const dates = React.useMemo(
    () => groupPreviewByDate(data?.days ?? []),
    [data?.days],
  );
  const events = data?.cancellations ?? [];
  if (error || !data || (dates.length === 0 && events.length === 0)) {
    return null;
  }

  return (
    <Card data-testid="company-cancellations">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">{tc.title}</CardTitle>
        {dates.some((d) => d.state === "cancellable") && (
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(true)}
              data-testid="company-cancel-open"
            >
              <CalendarX className="mr-1 h-4 w-4" aria-hidden />
              {tc.open}
            </Button>
          </motion.div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tc.intro}</p>
        ) : (
          <>
            <p className="text-sm font-medium">{tc.historyTitle}</p>
            <ul
              className="space-y-1 text-sm"
              data-testid="company-cancel-history"
            >
              {events.map((e) => (
                <li key={e.id} className="break-words text-muted-foreground">
                  {tc.historyItem
                    .replace("{date}", doualaDateTime(e.created_at, locale))
                    .replace(
                      "{dates}",
                      [...(e.dates ?? [])]
                        .sort()
                        .map((d) => formatDayDate(d, locale))
                        .join(", "),
                    )}
                  {" · "}
                  {plural(e.candidate_count, tc.candidateUnits, locale)}
                  {e.late_count > 0 &&
                    ` · ${plural(e.late_count, tc.historyLate, locale)}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {open && (
        <CancelDatesDialog
          open={open}
          jobId={jobId}
          dates={dates}
          onClose={() => setOpen(false)}
          onStale={() => void mutate()}
          onDone={() => {
            setOpen(false);
            void mutate();
            onDone();
          }}
        />
      )}
    </Card>
  );
}

function CancelDatesDialog({
  open,
  jobId,
  dates,
  onClose,
  onStale,
  onDone,
}: {
  open: boolean;
  jobId: string;
  dates: CompanyCancellationDate[];
  onClose: () => void;
  onStale: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const tc = t.companyCancellation;
  const reduce = useReducedMotion();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [step, setStep] = React.useState<"choose" | "summary">("choose");
  const [reason, setReason] = React.useState("");
  const [ackLate, setAckLate] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Une clé par confirmation : une relance réseau rejoue la même demande.
  const requestId = React.useRef(crypto.randomUUID());

  // Une date disparue ou devenue non annulable (relecture en temps réel)
  // est ignorée ici et à l'envoi (dayIdsForDates).
  const chosen = dates.filter(
    (d) => selected.has(d.key) && d.state === "cancellable",
  );
  const chosenDays = chosen.flatMap((d) => d.days);
  const late = chosenDays.some((d) => d.classification === "late");
  const candidates = new Set(chosenDays.map((d) => d.application_id)).size;
  const reasonOk =
    reason.trim().length >= COMPANY_CANCELLATION_REASON_MIN &&
    reason.trim().length <= COMPANY_CANCELLATION_REASON_MAX;
  const valid = chosen.length > 0 && reasonOk && (!late || ackLate);

  const errorText = (code: string | null | undefined) =>
    (code && (tc.errors as Record<string, string>)[code]) ?? tc.errors.generic;

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${jobId}/cancellation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: requestId.current,
        day_ids: dayIdsForDates(dates, selected),
        reason: reason.trim(),
        acknowledge_late: late && ackLate,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as
      | { code?: string; cancellation?: { cancellation_id: string } }
      | undefined;
    setBusy(false);
    if (!res?.ok || !body?.cancellation) {
      // Réseau coupé : même clé pour la relance. Aperçu dépassé : relu,
      // retour au choix, nouvelle clé.
      if (body?.code && STALE.has(body.code)) {
        requestId.current = crypto.randomUUID();
        setAckLate(false);
        setStep("choose");
        onStale();
      }
      setError(errorText(body?.code));
      return;
    }
    toast({ variant: "success", title: tc.done, description: tc.doneDesc });
    onDone();
  };

  const classBadge = (c: CompanyCancellationPreviewDay["classification"]) => (
    <Badge
      variant={c === "late" ? "destructive" : "secondary"}
      className="shrink-0"
    >
      {tc.classes[c]}
    </Badge>
  );

  const dayDetail = (d: CompanyCancellationPreviewDay) => (
    <li
      key={d.mission_day_id}
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
      data-testid="company-cancel-candidate"
    >
      <span className="min-w-0 break-words">
        {[d.first_name, d.last_initial ? `${d.last_initial}.` : null]
          .filter(Boolean)
          .join(" ")}
      </span>
      {classBadge(d.classification)}
      {d.company_plan && d.cancellation_notice_hours !== null && (
        <span className="w-full text-xs text-muted-foreground">
          {tc.terms
            .replace("{plan}", tc.plans[d.company_plan])
            .replace("{hours}", String(d.cancellation_notice_hours))}
          {d.classification === "in_time" && d.deadline_at
            ? ` · ${tc.deadline.replace("{date}", doualaDateTime(d.deadline_at, locale))}`
            : ""}
        </span>
      )}
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
        data-testid="company-cancel-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {step === "choose" ? tc.title : tc.summaryTitle}
          </DialogTitle>
          <DialogDescription>{tc.intro}</DialogDescription>
        </DialogHeader>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-3"
        >
          {step === "choose" ? (
            dates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tc.noneAvailable}
              </p>
            ) : (
              <ul className="space-y-2">
                {dates.map((d) => (
                  <li key={d.key}>
                    <label
                      className={`flex items-start gap-3 rounded-lg border border-border p-3 ${
                        d.state === "cancellable"
                          ? "cursor-pointer"
                          : "opacity-70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        checked={selected.has(d.key)}
                        disabled={d.state !== "cancellable"}
                        onChange={() => toggle(d.key)}
                        data-testid="company-cancel-date"
                        data-date={d.day_date}
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="block text-sm font-medium">
                          {formatDayDate(d.day_date, locale)} ·{" "}
                          {formatDayHours(d, t.schedule.nextDay)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {plural(d.days.length, tc.dateCandidates, locale)}
                        </span>
                        {d.state === "begun" ? (
                          <span
                            className="block text-xs text-muted-foreground"
                            data-testid="company-cancel-begun"
                          >
                            {tc.begun}
                          </span>
                        ) : (
                          <ul className="space-y-1 text-sm">
                            {d.days.map(dayDetail)}
                          </ul>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-3" data-testid="company-cancel-summary">
              <p className="text-sm font-medium">
                {tc.summaryCount
                  .replace(
                    "{days}",
                    plural(chosenDays.length, tc.dayUnits, locale),
                  )
                  .replace(
                    "{candidates}",
                    plural(candidates, tc.candidateUnits, locale),
                  )}
              </p>
              <ul className="space-y-2 text-sm">
                {chosen.map((d) => (
                  <li key={d.key} className="rounded-lg border p-2">
                    <span className="block font-medium">
                      {formatDayDate(d.day_date, locale)} ·{" "}
                      {formatDayHours(d, t.schedule.nextDay)}
                    </span>
                    <ul className="mt-1 space-y-1">{d.days.map(dayDetail)}</ul>
                  </li>
                ))}
              </ul>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{tc.consequenceNotified}</li>
                <li>{tc.consequenceKept}</li>
                <li>{tc.consequenceNoReopen}</li>
                {late && (
                  <li className="text-foreground">{tc.consequenceLate}</li>
                )}
              </ul>
              {late && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={ackLate}
                    onChange={(e) => setAckLate(e.target.checked)}
                    data-testid="company-cancel-ack-late"
                  />
                  <span>{tc.ackLate}</span>
                </label>
              )}
              <div className="space-y-1">
                <Label htmlFor="company-cancel-reason">{tc.reason}</Label>
                <Textarea
                  id="company-cancel-reason"
                  value={reason}
                  maxLength={COMPANY_CANCELLATION_REASON_MAX}
                  placeholder={tc.reasonPlaceholder}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="company-cancel-reason"
                />
                <p className="text-xs text-muted-foreground">{tc.reasonHelp}</p>
              </div>
            </div>
          )}
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="company-cancel-error"
            >
              {error}
            </p>
          )}
        </motion.div>
        <DialogFooter className="gap-2">
          {step === "choose" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button
                disabled={chosen.length === 0}
                onClick={() => {
                  setError(null);
                  setStep("summary");
                }}
                data-testid="company-cancel-next"
              >
                {t.common.next}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setStep("choose")}
              >
                {t.common.back}
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
                <Button
                  variant="destructive"
                  disabled={!valid || busy}
                  onClick={() => void submit()}
                  data-testid="company-cancel-confirm"
                >
                  {busy ? tc.sending : tc.confirm}
                </Button>
              </motion.div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
