"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { doualaDateTime } from "@/lib/utils/douala-time";
import type { TargetedRemoval } from "@/lib/validations/support-intervention";

export type RemovalDay = {
  mission_day_id: string;
  starts_at: string;
  removable: boolean;
};

/**
 * Lot 17d-3 (ANN-16, ANN-17) — retrait ciblé d'un candidat : l'entreprise
 * le demande au support (motif obligatoire, jamais montré au candidat) ;
 * la décision revient à un ops ou au fondateur, avant le début. Un refus
 * peut faire l'objet d'un réexamen motivé (décision du 2026-11-24) : la
 * demande initiale et son refus restent affichés ; rien n'est annulé avant
 * la nouvelle décision.
 */
export function TargetedRemoval({
  jobId,
  candidateName,
  days,
  requests,
  disabled,
  onChanged,
}: {
  jobId: string;
  candidateName: string;
  days: RemovalDay[];
  requests: TargetedRemoval[];
  disabled: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const tr = t.interventions.removal;
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const [reexam, setReexam] = React.useState<string | null>(null);
  const [reexamReason, setReexamReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(crypto.randomUUID());

  const ids = new Set(days.map((d) => d.mission_day_id));
  const removable = new Set(
    days.filter((d) => d.removable).map((d) => d.mission_day_id),
  );
  const mine = requests.filter((r) =>
    r.days.some((d) => ids.has(d.mission_day_id)),
  );
  const pendingDays = new Set(
    mine
      .filter((r) => r.status === "pending")
      .flatMap((r) => r.days.map((d) => d.mission_day_id)),
  );
  const choosable = days.filter(
    (d) => d.removable && !pendingDays.has(d.mission_day_id),
  );
  // Réexamen possible d'un refus non déjà réexaminé, sur une journée encore
  // annulable et sans autre demande en attente.
  const reexaminable = (r: TargetedRemoval) =>
    r.status === "refused" &&
    !mine.some((x) => x.reexamination_of === r.id) &&
    r.days.some(
      (d) =>
        removable.has(d.mission_day_id) && !pendingDays.has(d.mission_day_id),
    );
  const errorText = (code: string | undefined) =>
    (code && (t.interventions.errors as Record<string, string>)[code]) ??
    t.interventions.errors.generic;

  const send = async (url: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const b = (await res?.json().catch(() => ({}))) as
      | { code?: string }
      | undefined;
    setBusy(false);
    if (!res?.ok) {
      if (res) requestId.current = crypto.randomUUID();
      setError(errorText(b?.code));
      return false;
    }
    toast({ variant: "success", title: done });
    requestId.current = crypto.randomUUID();
    onChanged();
    return true;
  };

  const submit = async () => {
    if (busy || selected.size === 0 || reason.trim().length < 10) return;
    if (
      await send(
        `/api/jobs/${jobId}/removal-requests`,
        {
          request_id: requestId.current,
          day_ids: [...selected],
          reason: reason.trim(),
        },
        tr.sent,
      )
    ) {
      setOpen(false);
      setSelected(new Set());
      setReason("");
    }
  };

  if (mine.length === 0 && choosable.length === 0) return null;

  return (
    <div className="space-y-1" data-testid="targeted-removal">
      {mine.map((r) => (
        <div key={r.id} className="space-y-1">
          <p
            className="break-words text-xs text-muted-foreground"
            data-testid="targeted-removal-request"
            data-status={r.status}
            data-reexam={r.reexamination_of ? "true" : undefined}
          >
            {(r.reexamination_of ? tr.reexamLine : tr.requestLine)
              .replace("{date}", doualaDateTime(r.created_at, locale))
              .replace("{state}", t.interventions.states[r.status])}
            {r.decision_note && r.status === "refused"
              ? ` · ${tr.supportNote.replace("{note}", r.decision_note)}`
              : ""}
          </p>
          {reexaminable(r) &&
            (reexam === r.id ? (
              <div className="space-y-1">
                <Label htmlFor={`reexam-${r.id}`}>{tr.reexamReason}</Label>
                <Textarea
                  id={`reexam-${r.id}`}
                  value={reexamReason}
                  maxLength={500}
                  onChange={(e) => setReexamReason(e.target.value)}
                  data-testid="targeted-removal-reexam-reason"
                />
                <Button
                  size="sm"
                  disabled={busy || disabled || reexamReason.trim().length < 10}
                  onClick={async () => {
                    if (
                      await send(
                        `/api/removal-requests/${r.id}/review`,
                        {
                          request_id: requestId.current,
                          reason: reexamReason.trim(),
                        },
                        tr.reexamSent,
                      )
                    ) {
                      setReexam(null);
                      setReexamReason("");
                    }
                  }}
                  data-testid="targeted-removal-reexam-send"
                >
                  {tr.reexamSend}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setReexam(r.id);
                  setError(null);
                }}
                data-testid="targeted-removal-reexam-open"
              >
                {tr.reexamOpen}
              </Button>
            ))}
        </div>
      ))}
      {error && !open && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {choosable.length > 0 && (
        <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setOpen(true)}
            data-testid="targeted-removal-open"
          >
            <UserMinus className="mr-1 h-4 w-4" aria-hidden />
            {tr.open}
          </Button>
        </motion.div>
      )}
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
          data-testid="targeted-removal-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {tr.title} · {candidateName}
            </DialogTitle>
            <DialogDescription>{tr.intro}</DialogDescription>
          </DialogHeader>
          {choosable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr.none}</p>
          ) : (
            <ul className="space-y-2">
              {choosable.map((d) => (
                <li key={d.mission_day_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={selected.has(d.mission_day_id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(d.mission_day_id))
                            n.delete(d.mission_day_id);
                          else n.add(d.mission_day_id);
                          return n;
                        })
                      }
                      data-testid="targeted-removal-day"
                    />
                    {doualaDateTime(d.starts_at, locale)}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            <Label htmlFor="targeted-removal-reason">{tr.reason}</Label>
            <Textarea
              id="targeted-removal-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              data-testid="targeted-removal-reason"
            />
            <p className="text-xs text-muted-foreground">{tr.reasonHelp}</p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={
                busy || selected.size === 0 || reason.trim().length < 10
              }
              onClick={() => void submit()}
              data-testid="targeted-removal-send"
            >
              {tr.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
