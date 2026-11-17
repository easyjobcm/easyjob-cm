"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDayDate } from "@/lib/jobs/schedule";
import {
  INCIDENT_KINDS_BY_PARTY,
  incidentReportSchema,
  type IncidentKind,
} from "@/lib/validations/incident";

export type IncidentDay = {
  id: string;
  date: string;
  starts_at: string;
  /** Journée confirmée par code (actual_end_time). */
  confirmed: boolean;
};

type Errors = ReturnType<typeof useI18n>["t"]["incidents"]["errors"];
type ErrorCode = keyof Errors;

/**
 * Signaler un retard, une absence ou un code non remis (lot 14).
 *
 * La mission et la date de la journée sont affichées avant l'envoi. Les
 * natures impossibles sont désactivées avec leur motif (journée confirmée,
 * journée non commencée) ; la base revérifie tout. Un justificatif
 * facultatif est transmis au seul support.
 */
export function IncidentReportDialog({
  open,
  onClose,
  onDone,
  missionId,
  jobTitle,
  party,
  days,
  initialDayId,
  serverNow,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  missionId: string;
  jobTitle: string;
  party: "candidate" | "company";
  days: IncidentDay[];
  initialDayId?: string | null;
  /** Heure du serveur (ms) pour la disponibilité des natures. */
  serverNow: number;
}) {
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const [dayId, setDayId] = useState<string | null>(null);
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [statement, setStatement] = useState("");
  const [lateMinutes, setLateMinutes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDayId(initialDayId ?? days[0]?.id ?? null);
    setKind(null);
    setStatement("");
    setLateMinutes("");
    setFile(null);
    setError(null);
  }, [open, initialDayId, days]);

  const day = days.find((d) => d.id === dayId) ?? null;
  const started = !!day && serverNow >= Date.parse(day.starts_at);
  const unavailable = (k: IncidentKind): ErrorCode | null => {
    if (!day) return null;
    if ((k === "absence" || k === "code_not_received") && day.confirmed)
      return "day_already_confirmed";
    if ((party === "company" || k === "code_not_received") && !started)
      return "day_not_started";
    return null;
  };

  const codeOf = (code: unknown): ErrorCode =>
    typeof code === "string" && code in ti.errors
      ? (code as ErrorCode)
      : "generic";

  async function submit() {
    if (!day || !kind || sendingRef.current) return;
    const minutes = lateMinutes.trim() ? Number(lateMinutes) : null;
    const parsed = incidentReportSchema.safeParse({
      mission_day_id: day.id,
      kind,
      statement,
      late_minutes: kind === "late" ? minutes : null,
    });
    if (!parsed.success) {
      setError(codeOf(parsed.error.issues[0]?.message));
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      incident?: { incident_id: string; already_reported: boolean };
    };
    if (res?.ok && body.incident) {
      if (file && !body.incident.already_reported) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(
          `/api/incidents/${body.incident.incident_id}/evidence`,
          { method: "POST", body: form },
        ).catch(() => null);
        if (!up?.ok) {
          const upBody = ((await up?.json().catch(() => null)) ?? {}) as {
            code?: string;
          };
          toast({
            title: ti.toasts.errorTitle,
            description: ti.errors[codeOf(upBody.code)],
            variant: "destructive",
          });
        }
      }
      toast({
        title: ti.toasts.reported,
        description: body.incident.already_reported
          ? ti.toasts.alreadyReported
          : undefined,
        variant: "success",
      });
      onDone();
    } else {
      setError(codeOf(body.code));
    }
    sendingRef.current = false;
    setSending(false);
  }

  const kinds = INCIDENT_KINDS_BY_PARTY[party];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="incident-report-title"
        className="max-h-[90dvh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]"
        data-testid="incident-report-dialog"
      >
        <DialogHeader>
          <DialogTitle
            id="incident-report-title"
            className="flex items-center gap-2"
          >
            <Flag className="h-5 w-5 text-primary" aria-hidden />
            {ti.reportTitle}
          </DialogTitle>
          <DialogDescription>{ti.noConsequence}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="rounded-lg border p-3 text-sm"
            data-testid="incident-context"
          >
            <p className="text-muted-foreground">{ti.mission}</p>
            <p className="font-medium">{jobTitle}</p>
            <p className="mt-2 text-muted-foreground">{ti.reportFor}</p>
            {days.length > 1 ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {days.map((d) => (
                  <Button
                    key={d.id}
                    size="sm"
                    variant={d.id === dayId ? "default" : "outline"}
                    aria-pressed={d.id === dayId}
                    onClick={() => {
                      setDayId(d.id);
                      setKind(null);
                    }}
                    data-testid="incident-day"
                  >
                    {formatDayDate(d.date, locale)}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="font-medium" data-testid="incident-day-label">
                {day ? formatDayDate(day.date, locale) : "—"}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{ti.chooseKind}</legend>
            {kinds.map((k) => {
              const blocked = unavailable(k);
              return (
                <label
                  key={k}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    blocked ? "opacity-60" : "cursor-pointer"
                  } ${kind === k ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="radio"
                    name="incident-kind"
                    value={k}
                    checked={kind === k}
                    disabled={!!blocked}
                    onChange={() => setKind(k)}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                    data-testid={`incident-kind-${k}`}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{ti.kinds[k]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {blocked ? ti.errors[blocked] : ti.hints[party][k]}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {kind === "late" && (
            <label className="block text-sm">
              <span className="font-medium">{ti.lateMinutes}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={720}
                value={lateMinutes}
                onChange={(e) => setLateMinutes(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                data-testid="incident-late-minutes"
              />
            </label>
          )}

          <label className="block text-sm">
            <span className="font-medium">{ti.statement}</span>
            <Textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={2000}
              className="mt-1"
              data-testid="incident-statement"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {ti.statementHint}
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium">{ti.evidence}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs"
              data-testid="incident-evidence"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {ti.evidenceHint}
            </span>
          </label>

          {error && (
            <p
              className="flex items-start gap-2 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {ti.errors[error]}
            </p>
          )}

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              {ti.cancel}
            </Button>
            <motion.div whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
              <Button
                className="w-full"
                onClick={() => void submit()}
                disabled={!day || !kind || sending}
                isLoading={sending}
                data-testid="incident-submit"
              >
                {sending ? ti.sending : ti.confirm}
              </Button>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
