"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Clock, Gavel, Handshake, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatXaf, formatXafExact } from "@/lib/utils";
import { doualaDateTime } from "@/lib/utils/douala-time";
import {
  partyInterruptionActionSchema,
  type InterruptionDetail,
  type PartyInterruptionAction,
} from "@/lib/validations/partial-day";

export { parseInterruptionDetail } from "@/lib/validations/partial-day";

type InterruptionError = keyof ReturnType<
  typeof useI18n
>["t"]["partialDay"]["errors"];

/**
 * Interruption d'une journée commencée, vue par une partie : étape et
 * échéance exacte (heure de Douala), versions, montant en examen (jamais
 * présenté comme nul), propositions du fondateur avec leur historique,
 * réponse sur la version courante, accord puis recours si le code n'est
 * pas remis, décision, et avis de l'application (mise à disposition et
 * consultation observée, distinctes). Le silence ne vaut jamais accord ;
 * l'entreprise ne fixe jamais le montant.
 */
export function InterruptionSection({
  detail,
  viewer,
  onChanged,
}: {
  detail: InterruptionDetail;
  viewer: "candidate" | "company";
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const tp = t.partialDay;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.97 };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<InterruptionError | null>(null);
  const busyRef = useRef(false);
  const viewedRef = useRef<string | null>(null);
  const when = (iso: string) => doualaDateTime(iso, locale);
  const money = (n: number) => formatXaf(n, locale);
  const st = detail.state;
  const current = detail.proposals.find((p) => p.current) ?? null;
  const older = detail.proposals.filter((p) => !p.current).reverse();
  const myResponse = current?.responses.find((r) => r.party === viewer);
  const recourseSent = detail.recourses.some((r) => r.party === viewer);
  const vr = detail.version_request;
  const fin = detail.finance;
  const [reexamText, setReexamText] = useState("");
  const pendingReexam = detail.reexaminations.find(
    (r) => r.current && !r.decided_at,
  );

  // Consultation observée : le dossier est affiché à son destinataire.
  // Une fois par lot d'avis non consultés (jamais déduite d'une notification).
  const viewedKey = `${detail.incident_id}:${detail.unviewed}`;
  useEffect(() => {
    if (detail.unviewed === 0 || viewedRef.current === viewedKey) return;
    viewedRef.current = viewedKey;
    void fetch(`/api/interruptions/${detail.incident_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "viewed" }),
    })
      .then((res) => {
        if (res.ok) onChanged();
      })
      .catch(() => null);
  }, [detail.incident_id, detail.unviewed, viewedKey, onChanged]);

  async function send(
    body: PartyInterruptionAction,
    done: string,
  ): Promise<boolean> {
    if (busyRef.current) return false;
    const parsed = partyInterruptionActionSchema.safeParse(body);
    if (!parsed.success) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/interruptions/${detail.incident_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok) toast({ title: done, variant: "success" });
    else
      setError(
        typeof json.code === "string" && json.code in tp.errors
          ? (json.code as InterruptionError)
          : "generic",
      );
    busyRef.current = false;
    setBusy(false);
    onChanged();
    return !!res?.ok;
  }

  const amountText =
    detail.amount_state === "settled"
      ? tp.amount.settled.replace(
          "{amount}",
          money(detail.closure?.amount ?? 0),
        )
      : tp.amount[detail.amount_state];

  return (
    <div
      className="space-y-2 rounded-md border border-primary/20 p-2"
      data-testid="interruption-section"
      data-stage={st.stage}
      data-blocks={String(detail.blocks_completion)}
      data-amount-state={detail.amount_state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={st.overdue ? "destructive" : "outline"}
          data-testid="interruption-stage"
        >
          {tp.stage[st.stage]}
        </Badge>
        {st.due_at && st.stage !== "founder_review" && (
          <span
            className="flex items-center gap-1 text-xs"
            data-testid="interruption-due"
          >
            <CalendarClock className="h-3.5 w-3.5 text-primary" aria-hidden />
            {tp.dueAt.replace("{time}", when(st.due_at))}
          </span>
        )}
      </div>
      {st.stage === "founder_review" && st.due_at && (
        <p
          className={st.overdue ? "text-xs text-destructive" : "text-xs"}
          data-testid="interruption-review-due"
        >
          {(st.overdue ? tp.reviewOverdue : tp.reviewDue).replace(
            "{time}",
            when(st.due_at),
          )}
        </p>
      )}
      <p
        className="text-xs font-medium text-foreground"
        data-testid="interruption-amount-state"
      >
        {amountText}
      </p>

      {/* Situations distinctes : journée, dossier, mission. */}
      <div className="space-y-0.5 text-xs" data-testid="interruption-situation">
        <p data-testid="interruption-day-state" data-state={detail.day_state}>
          {tp.situation.day.replace("{state}", tp.dayState[detail.day_state])}
        </p>
        <p>{tp.situation.dossier.replace("{stage}", tp.stage[st.stage])}</p>
        {detail.mission_days.total > 1 && (
          <p className="text-muted-foreground">
            {tp.situation.mission
              .replace("{confirmed}", String(detail.mission_days.confirmed))
              .replace("{total}", String(detail.mission_days.total))}
          </p>
        )}
      </div>

      {/* Suivi des montants : reconnu, proposé, accepté, finalisé. */}
      <div
        className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs"
        data-testid="interruption-finance"
      >
        <p className="font-medium">{tp.finance.title}</p>
        {fin.recognized_total != null && (
          <p data-testid="finance-recognized">
            {tp.finance.recognized.replace(
              "{amount}",
              formatXafExact(fin.recognized_total, locale),
            )}
          </p>
        )}
        {fin.cap != null && (
          <p data-testid="finance-cap">
            {tp.finance.cap.replace("{amount}", money(fin.cap))}
          </p>
        )}
        {fin.pending_amount != null && (
          <p data-testid="finance-pending">
            {tp.finance.pending.replace("{amount}", money(fin.pending_amount))}
          </p>
        )}
        {fin.settled_amount != null ? (
          <p data-testid="finance-settled">
            {tp.finance.settled.replace("{amount}", money(fin.settled_amount))}
          </p>
        ) : fin.accepted_amount != null ? (
          <p data-testid="finance-accepted">
            {tp.finance.accepted.replace(
              "{amount}",
              money(fin.accepted_amount),
            )}
          </p>
        ) : (
          fin.pending_amount == null &&
          detail.amount_state === "under_review" && (
            <p data-testid="finance-none">{tp.finance.none}</p>
          )
        )}
        {(fin.accepted_amount != null || fin.settled_amount != null) && (
          <p data-testid="finance-finalization">
            {fin.completion_source === "partial"
              ? tp.finance.finalization.code
              : fin.completion_source === "partial_support"
                ? tp.finance.finalization.support
                : tp.finance.finalization.pending}
          </p>
        )}
        <p className="text-muted-foreground">{tp.finance.exactNote}</p>
        <p className="text-muted-foreground">{tp.finance.notPaid}</p>
      </div>

      <p className="flex items-center gap-1 text-xs font-medium">
        <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
        {tp.versionsTitle}
      </p>
      <ul className="space-y-2">
        {detail.versions.map((v) => (
          <li
            key={v.party}
            className="rounded-md bg-muted/50 p-2"
            data-testid="interruption-version"
            data-party={v.party}
          >
            <p className="text-xs font-medium text-muted-foreground">
              {tp.versionLine
                .replace("{party}", tp.party[v.party])
                .replace("{cause}", tp.causes[v.cause])
                .replace("{time}", when(v.declared_at))}
            </p>
            <p className="text-xs text-muted-foreground">{tp.workDoneLabel}</p>
            <p className="whitespace-pre-wrap break-words">{v.work_done}</p>
          </li>
        ))}
      </ul>
      {vr.party === viewer && !vr.given_at && (
        <p
          className={vr.open ? "text-xs" : "text-xs text-muted-foreground"}
          data-testid="interruption-version-request"
          data-open={String(vr.open)}
        >
          {(vr.open ? tp.versionRequested : tp.versionExpired).replace(
            "{time}",
            when(vr.due_at),
          )}
        </p>
      )}

      {current && (
        <div
          className="space-y-2 rounded-md bg-primary/5 p-2"
          data-testid="interruption-proposal"
          data-status={current.status}
          data-version={current.version}
        >
          <p className="flex items-center gap-1 font-medium">
            <Handshake className="h-4 w-4 text-primary" aria-hidden />
            {tp.proposalLine
              .replace("{version}", String(current.version))
              .replace("{amount}", money(current.amount))}
          </p>
          <p className="text-xs text-muted-foreground">
            {tp.proposalStatus[current.status]}
          </p>
          <p className="text-xs text-muted-foreground">{tp.motivationLabel}</p>
          <p className="whitespace-pre-wrap break-words text-xs">
            {current.motivation}
          </p>
          {current.status === "open" && (
            <p className="text-xs" data-testid="interruption-respond-by">
              {tp.respondBy.replace("{time}", when(current.respond_by))}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{tp.sameAmount}</p>
          {current.responses.map((r) => (
            <p key={r.party} className="text-xs">
              {tp.responseLine
                .replace("{party}", tp.party[r.party])
                .replace("{decision}", tp.decisions[r.decision])
                .replace("{time}", when(r.responded_at))}
            </p>
          ))}
          {detail.can.respond && (
            <div className="grid grid-cols-2 gap-2">
              <motion.div whileTap={tap}>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      {
                        action: "respond",
                        proposal_id: current.id,
                        version: current.version,
                        decision: "accept",
                      },
                      tp.youAccepted,
                    )
                  }
                  data-testid="proposal-accept"
                >
                  {tp.accept}
                </Button>
              </motion.div>
              <motion.div whileTap={tap}>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      {
                        action: "respond",
                        proposal_id: current.id,
                        version: current.version,
                        decision: "refuse",
                      },
                      tp.youRefused,
                    )
                  }
                  data-testid="proposal-refuse"
                >
                  {tp.refuse}
                </Button>
              </motion.div>
            </div>
          )}
          {current.status === "open" && myResponse?.decision === "accept" && (
            <p className="text-xs text-muted-foreground">
              {tp.youAccepted} {tp.waitingOther}
            </p>
          )}
          {current.status === "refused" && (
            <p className="text-xs text-muted-foreground">{tp.refused}</p>
          )}
          {st.stage === "agreement" && (
            <div className="space-y-2" data-testid="interruption-agreement">
              <p className="text-xs font-medium">
                {(viewer === "candidate"
                  ? tp.agreementCandidate
                  : tp.agreementCompany
                ).replace("{amount}", money(current.amount))}
              </p>
              {detail.can.request_recourse ? (
                <motion.div whileTap={tap}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={busy}
                    onClick={() =>
                      void send({ action: "recourse" }, tp.recourseSent)
                    }
                    data-testid="interruption-recourse"
                  >
                    <LifeBuoy className="mr-1 h-4 w-4" aria-hidden />
                    {tp.recourse}
                  </Button>
                </motion.div>
              ) : (
                recourseSent && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="interruption-recourse-sent"
                  >
                    {tp.recourseSent}
                  </p>
                )
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{tp.noPayment}</p>
        </div>
      )}
      {older.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {tp.proposalsTitle}
          </summary>
          <ul className="mt-1 space-y-1" data-testid="interruption-history">
            {older.map((p) => (
              <li key={p.id} className="rounded-md bg-muted/40 p-2">
                <p className="font-medium">
                  {tp.proposalLine
                    .replace("{version}", String(p.version))
                    .replace("{amount}", money(p.amount))}{" "}
                  · {tp.proposalStatus[p.status]}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {p.motivation}
                </p>
                {p.responses.map((r) => (
                  <p key={r.party} className="text-muted-foreground">
                    {tp.responseLine
                      .replace("{party}", tp.party[r.party])
                      .replace("{decision}", tp.decisions[r.decision])
                      .replace("{time}", when(r.responded_at))}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {detail.closure && detail.closure.outcome !== "settled" && (
        <div
          className="space-y-1 rounded-md bg-muted/50 p-2"
          data-testid="interruption-closure"
          data-outcome={detail.closure.outcome}
        >
          <p className="flex items-center gap-1 text-xs font-medium">
            <Gavel className="h-3.5 w-3.5 text-primary" aria-hidden />
            {tp.closureTitle} · {tp.closureOutcome[detail.closure.outcome]}
          </p>
          {detail.closure.motivation && (
            <p className="whitespace-pre-wrap break-words text-xs">
              {detail.closure.motivation}
            </p>
          )}
        </div>
      )}

      {detail.closure_history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {tp.reexam.history}
          </summary>
          <ul
            className="mt-1 space-y-1"
            data-testid="interruption-closure-history"
          >
            {detail.closure_history.map((h, i) => (
              <li key={i}>
                {tp.reexam.historyLine
                  .replace(
                    "{outcome}",
                    h.outcome in tp.closureOutcome
                      ? tp.closureOutcome[
                          h.outcome as keyof typeof tp.closureOutcome
                        ]
                      : h.outcome,
                  )
                  .replace("{decided}", when(h.decided_at))
                  .replace("{revoked}", when(h.revoked_at))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {detail.reexaminations.map((r) => (
        <div
          key={r.id}
          className="space-y-1 rounded-md bg-muted/40 p-2 text-xs"
          data-testid="interruption-reexam"
          data-decision={r.decision ?? "pending"}
        >
          <p className="whitespace-pre-wrap break-words">{r.reason}</p>
          <p className="text-muted-foreground">
            {r.decision
              ? tp.reexam.decisionLine
                  .replace("{decision}", tp.reexam.decisions[r.decision])
                  .replace("{time}", when(r.decided_at ?? r.created_at))
              : tp.reexam.pending.replace("{time}", when(r.created_at))}
          </p>
          {r.decision_motivation && (
            <p className="whitespace-pre-wrap break-words">
              {r.decision_motivation}
            </p>
          )}
        </div>
      ))}
      {detail.can.request_reexamination && !pendingReexam && (
        <div className="space-y-2" data-testid="interruption-reexam-form">
          <p className="text-xs font-medium">{tp.reexam.title}</p>
          <p className="text-xs text-muted-foreground">{tp.reexam.hint}</p>
          <Textarea
            value={reexamText}
            onChange={(e) => setReexamText(e.target.value)}
            maxLength={2000}
            placeholder={tp.reexam.placeholder}
            aria-label={tp.reexam.placeholder}
            data-testid="interruption-reexam-reason"
          />
          <motion.div whileTap={tap}>
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy || reexamText.trim().length < 10}
              onClick={() =>
                void send(
                  { action: "reexamination", reason: reexamText },
                  tp.reexam.sent,
                ).then((ok) => ok && setReexamText(""))
              }
              data-testid="interruption-reexam-send"
            >
              {tp.reexam.send}
            </Button>
          </motion.div>
        </div>
      )}

      {detail.notices.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {tp.noticesTitle}
          </summary>
          <ul className="mt-1 space-y-1" data-testid="interruption-notices">
            {detail.notices.map((n, i) => (
              <li
                key={i}
                data-kind={n.kind}
                data-viewed={n.viewed_at ? "true" : "false"}
              >
                {tp.noticeLine
                  .replace("{kind}", tp.noticeKinds[n.kind])
                  .replace("{time}", when(n.made_available_at))}{" "}
                ·{" "}
                {n.viewed_at
                  ? tp.noticeViewed.replace("{time}", when(n.viewed_at))
                  : tp.noticeNotViewed}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">{tp.noticeScope}</p>
        </details>
      )}
      <p className="text-xs text-muted-foreground">{tp.silenceNote}</p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {tp.errors[error]}
        </p>
      )}
    </div>
  );
}
