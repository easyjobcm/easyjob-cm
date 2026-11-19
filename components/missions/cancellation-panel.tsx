"use client";

import * as React from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarX, Paperclip } from "lucide-react";
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
import { useLiveRefresh, useServerNow } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import {
  CANCELLATION_REASONS,
  cancellationPreviewDaySchema,
  cancellationSchema,
  requiresJustification,
  type Cancellation,
  type CancellationPreviewDay,
  type CancellationReason,
  type EvidenceChoice,
} from "@/lib/validations/cancellation";

type Payload = {
  days: CancellationPreviewDay[];
  cancellations: Cancellation[];
};

async function load(url: string): Promise<Payload> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as {
    days?: unknown[];
    cancellations?: unknown[];
  };
  return {
    days: (body.days ?? []).flatMap((d) => {
      const p = cancellationPreviewDaySchema.safeParse(d);
      return p.success ? [p.data] : [];
    }),
    cancellations: (body.cancellations ?? []).flatMap((c) => {
      const p = cancellationSchema.safeParse(c);
      return p.success ? [p.data] : [];
    }),
  };
}

/** Envoi d'une pièce ; un échec laisse le dossier en attente (lot 17b). */
async function uploadEvidence(id: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/cancellations/${id}/evidence`, {
    method: "POST",
    body: form,
  }).catch(() => null);
  if (!res) return "generic";
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  return body.code ?? "generic";
}

/**
 * Lots 17b–17c — annulation par le candidat depuis une mission : choix des
 * journées classées par la base, récapitulatif, motif et justificatif hors
 * délai, suivi des demandes (pièce à réessayer, décision, recours).
 */
export function CancellationPanel({ missionId }: { missionId: string }) {
  const { t } = useI18n();
  const tc = t.cancellations;
  const url = `/api/missions/${missionId}/cancellation`;
  const { data, mutate } = useSWR<Payload>(url, load);
  useLiveRefresh(["missions"], () => void mutate());
  const [open, setOpen] = React.useState(false);

  const errorText = (code: string | null | undefined) =>
    (code && (tc.errors as Record<string, string>)[code]) ?? tc.errors.generic;
  const cancellations = data?.cancellations ?? [];
  const days = data?.days ?? [];

  if (!data || (days.length === 0 && cancellations.length === 0)) return null;

  return (
    <Card data-testid="mission-cancellations">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">{tc.mineTitle}</CardTitle>
        {days.length > 0 && (
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
              data-testid="mission-cancel-open"
            >
              <CalendarX className="mr-1 h-4 w-4" aria-hidden />
              {tc.open}
            </Button>
          </motion.div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {cancellations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tc.intro}</p>
        ) : (
          cancellations.map((c) => (
            <CancellationItem
              key={c.id}
              c={c}
              onChanged={() => void mutate()}
              errorText={errorText}
            />
          ))
        )}
      </CardContent>
      {open && (
        <CancelDialog
          open={open}
          onClose={() => setOpen(false)}
          missionId={missionId}
          days={days}
          errorText={errorText}
          onDone={() => {
            setOpen(false);
            void mutate();
          }}
        />
      )}
    </Card>
  );
}

function CancellationItem({
  c,
  onChanged,
  errorText,
}: {
  c: Cancellation;
  onChanged: () => void;
  errorText: (code: string | null | undefined) => string;
}) {
  const { t, locale } = useI18n();
  const tc = t.cancellations;
  // Échéance du recours sur l'heure du serveur ; la base revérifie.
  const serverNow = useServerNow();
  const [busy, setBusy] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const reviewDeadline = c.review_deadline_at;
  const canReview =
    !c.review_requested_at &&
    (c.status === "refused" || c.status === "sanctioned_no_evidence") &&
    !!reviewDeadline &&
    Date.parse(reviewDeadline) > serverNow();
  const canAddEvidence =
    c.status === "awaiting_evidence" ||
    c.status === "under_review" ||
    (!!c.review_requested_at && !c.review_decided_at);

  const send = async (file: File) => {
    setBusy(true);
    const err = await uploadEvidence(c.id, file);
    setBusy(false);
    if (err)
      toast({
        variant: "destructive",
        title: tc.uploadFailed,
        description: errorText(err),
      });
    onChanged();
  };

  const sendReview = async () => {
    setBusy(true);
    const res = await fetch(`/api/cancellations/${c.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as
        | { code?: string }
        | undefined;
      toast({ variant: "destructive", title: errorText(body?.code) });
      return;
    }
    setReviewOpen(false);
    onChanged();
  };

  return (
    <div
      className="rounded-lg border border-border p-3 text-sm"
      data-testid="cancellation-item"
      data-status={c.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          variant={
            c.status === "refused" || c.status === "sanctioned_no_evidence"
              ? "destructive"
              : "secondary"
          }
        >
          {tc.status[c.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {doualaDateTime(c.created_at, locale)}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {tc.daysLabel.replace(
          "{dates}",
          (c.days ?? [])
            .map((d) => doualaDateTime(d.starts_at, locale))
            .join(", "),
        )}
      </p>
      {c.decision_note && (
        <p className="mt-1 text-xs">
          {tc.decisionNote.replace("{note}", c.decision_note)}
        </p>
      )}
      {c.review_requested_at && (
        <p className="mt-1 text-xs text-muted-foreground">
          {c.review_outcome
            ? tc.reviewOutcome[c.review_outcome as "maintained" | "overturned"]
            : tc.reviewSent.replace(
                "{date}",
                doualaDateTime(c.review_requested_at, locale),
              )}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {canAddEvidence && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              aria-label={tc.file}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void send(f);
              }}
              data-testid="cancellation-evidence-input"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="mr-1 h-4 w-4" aria-hidden />
              {busy ? tc.sending : tc.retry}
            </Button>
          </>
        )}
        {canReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReviewOpen((v) => !v)}
            data-testid="cancellation-review-open"
          >
            {tc.review}
          </Button>
        )}
      </div>
      {canReview && reviewDeadline && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tc.reviewHint.replace(
            "{date}",
            doualaDateTime(reviewDeadline, locale),
          )}
        </p>
      )}
      {reviewOpen && (
        <div className="mt-2 space-y-2">
          <Label htmlFor={`review-${c.id}`}>{tc.reviewNote}</Label>
          <Textarea
            id={`review-${c.id}`}
            value={note}
            rows={3}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || note.trim().length < 10}
            onClick={() => void sendReview()}
          >
            {tc.reviewSend}
          </Button>
        </div>
      )}
    </div>
  );
}

function CancelDialog({
  open,
  onClose,
  missionId,
  days,
  errorText,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  missionId: string;
  days: CancellationPreviewDay[];
  errorText: (code: string | null | undefined) => string;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const tc = t.cancellations;
  const reduce = useReducedMotion();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [step, setStep] = React.useState<"choose" | "summary">("choose");
  const [reason, setReason] = React.useState<CancellationReason | "">("");
  const [reasonText, setReasonText] = React.useState("");
  const [choice, setChoice] = React.useState<EvidenceChoice | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Une clé par confirmation : une relance réseau rejoue la même demande.
  const requestId = React.useRef(crypto.randomUUID());

  const chosen = days.filter((d) => selected.has(d.mission_day_id));
  const late = requiresJustification(chosen.map((d) => d.classification));
  const valid =
    chosen.length > 0 &&
    (!late ||
      (reason !== "" &&
        (choice === "none" || (choice === "provided" && !!file))));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/cancellation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: requestId.current,
        day_ids: chosen.map((d) => d.mission_day_id),
        reason_code: reason || null,
        reason_text: reasonText.trim() || null,
        evidence_choice: late ? choice : null,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as
      | { code?: string; cancellation?: { cancellation_id: string } }
      | undefined;
    if (!res?.ok || !body?.cancellation) {
      setBusy(false);
      setError(errorText(body?.code));
      return;
    }
    // Le désistement est enregistré : la pièce suit, un échec se réessaie.
    if (file && (choice === "provided" || !late)) {
      const err = await uploadEvidence(body.cancellation.cancellation_id, file);
      if (err)
        toast({
          variant: "destructive",
          title: tc.uploadFailed,
          description: errorText(err),
        });
    }
    setBusy(false);
    toast({ variant: "success", title: tc.done });
    onDone();
  };

  const classBadge = (d: CancellationPreviewDay) => (
    <Badge
      variant={d.classification === "late" ? "destructive" : "secondary"}
      className="shrink-0"
    >
      {tc.classes[d.classification]}
    </Badge>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
        data-testid="cancel-dialog"
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
            <ul className="space-y-2">
              {days.map((d) => (
                <li key={d.mission_day_id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={selected.has(d.mission_day_id)}
                      onChange={() => toggle(d.mission_day_id)}
                      data-testid="cancel-day"
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {doualaDateTime(d.starts_at, locale)}
                        </span>
                        {classBadge(d)}
                      </span>
                      {d.classification === "in_time" && d.deadline_at && (
                        <span className="block text-xs text-muted-foreground">
                          {tc.deadline.replace(
                            "{date}",
                            doualaDateTime(d.deadline_at, locale),
                          )}
                        </span>
                      )}
                      {d.classification === "reaction_window" &&
                        d.reaction_until && (
                          <span className="block text-xs text-muted-foreground">
                            {tc.reaction.replace(
                              "{date}",
                              doualaDateTime(d.reaction_until, locale),
                            )}
                          </span>
                        )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-1 text-sm" data-testid="cancel-summary">
                {chosen.map((d) => (
                  <li
                    key={d.mission_day_id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>{doualaDateTime(d.starts_at, locale)}</span>
                    {classBadge(d)}
                  </li>
                ))}
              </ul>
              <p
                className={
                  late
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {late ? tc.summaryLate : tc.summaryFree}
              </p>
              {late && (
                <div className="space-y-1">
                  <Label htmlFor="cancel-reason">{tc.reason}</Label>
                  <select
                    id="cancel-reason"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={reason}
                    onChange={(e) =>
                      setReason(e.target.value as CancellationReason | "")
                    }
                    data-testid="cancel-reason"
                  >
                    <option value="">{tc.reasonPlaceholder}</option>
                    {CANCELLATION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {tc.reasons[r]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="cancel-text">{tc.reasonText}</Label>
                <Textarea
                  id="cancel-text"
                  rows={2}
                  maxLength={1000}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                />
              </div>
              {late && (
                <fieldset className="space-y-2">
                  <legend className="sr-only">{tc.file}</legend>
                  {(["provided", "none"] as const).map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="evidence-choice"
                        className="h-4 w-4 accent-primary"
                        checked={choice === c}
                        onChange={() => setChoice(c)}
                        data-testid={`cancel-choice-${c}`}
                      />
                      {c === "provided" ? tc.evidenceProvided : tc.evidenceNone}
                    </label>
                  ))}
                </fieldset>
              )}
              {(!late || choice === "provided") && (
                <div className="space-y-1">
                  <Label htmlFor="cancel-file">{tc.file}</Label>
                  <input
                    id="cancel-file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="block w-full text-sm"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    data-testid="cancel-file"
                  />
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </motion.div>
        <DialogFooter className="gap-2">
          {step === "choose" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {tc.back}
              </Button>
              <Button
                disabled={chosen.length === 0}
                onClick={() => setStep("summary")}
                data-testid="cancel-next"
              >
                {tc.summaryTitle}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("choose")}
                disabled={busy}
              >
                {tc.back}
              </Button>
              <Button
                disabled={!valid || busy}
                onClick={() => void submit()}
                data-testid="cancel-confirm"
              >
                {busy ? tc.sending : tc.confirm}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
