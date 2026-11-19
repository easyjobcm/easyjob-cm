"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Clock, Gavel, Handshake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatXaf } from "@/lib/utils";
import {
  doualaDateTime,
  doualaLocalInput,
  doualaLocalToIso,
} from "@/lib/utils/douala-time";
import {
  FOUNDER_CLOSURES,
  REEXAM_DECISIONS,
  adminInterruptionSchema,
  founderInterruptionActionSchema,
  type FounderInterruptionAction,
} from "@/lib/validations/partial-day";

type InterruptionError = keyof ReturnType<
  typeof useI18n
>["t"]["partialDay"]["errors"];

const fieldClass =
  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";

/**
 * Interruption vue par le support : étape et échéance (heure de Douala),
 * demandes adressées aux parties et leurs délais de 72 h, versions,
 * propositions (historique complet), avis (mise à disposition et
 * consultation observée). Le fondateur actif seul propose ou modifie un
 * montant motivé, clôt, prolonge ou finalise un accord ; les autres agents
 * lisent et instruisent (demandes, contacts, notes du lot 16). Les saisies
 * en cours sont conservées lors d'une relecture (état local, clé stable).
 */
export function AdminInterruptionCard({
  raw,
  onChanged,
}: {
  raw: unknown;
  onChanged: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const tp = t.partialDay;
  const ta = tp.admin;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.98 };
  const [amount, setAmount] = useState("");
  const [motivation, setMotivation] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<
    (typeof FOUNDER_CLOSURES)[number] | null
  >(null);
  const [closeText, setCloseText] = useState("");
  const [extendAt, setExtendAt] = useState("");
  const [extendReason, setExtendReason] = useState("");
  const [finalText, setFinalText] = useState("");
  const [reexamDecision, setReexamDecision] = useState<
    Record<string, (typeof REEXAM_DECISIONS)[number]>
  >({});
  const [reexamText, setReexamText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<InterruptionError | null>(null);
  const busyRef = useRef(false);
  const viewedRef = useRef<string | null>(null);
  const parsed = adminInterruptionSchema.safeParse(raw);
  const d = parsed.success ? parsed.data : null;
  const when = (iso: string) => doualaDateTime(iso, locale);
  const money = (n: number) => formatXaf(n, locale);

  // Consultation observée par le fondateur destinataire des avis.
  const viewedKey = d ? `${d.incident_id}:${d.unviewed}` : null;
  useEffect(() => {
    if (!d || !d.viewer_is_founder || d.unviewed === 0) return;
    if (viewedRef.current === viewedKey) return;
    viewedRef.current = viewedKey;
    void fetch(`/api/admin/incidents/${d.incident_id}/interruption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "viewed" }),
    }).catch(() => null);
  }, [d, viewedKey]);

  if (!d) return null;
  const st = d.state;
  const current = d.proposals.find((p) => p.current) ?? null;
  const f = d.founder;

  async function act(body: FounderInterruptionAction, done: string) {
    if (!d || busyRef.current) return false;
    const check = founderInterruptionActionSchema.safeParse(body);
    if (!check.success) {
      const code = check.error.issues[0]?.message;
      setError(
        code && code in tp.errors ? (code as InterruptionError) : "generic",
      );
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/admin/incidents/${d.incident_id}/interruption`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(check.data),
      },
    ).catch(() => null);
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
    await onChanged();
    busyRef.current = false;
    setBusy(false);
    return !!res?.ok;
  }

  return (
    <Card
      data-testid="admin-interruption"
      data-stage={st.stage}
      data-overdue={String(st.overdue)}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Gavel className="h-4 w-4" aria-hidden />
          {ta.title}
          <Badge
            variant={st.overdue ? "destructive" : "outline"}
            data-testid="admin-interruption-stage"
          >
            {st.overdue ? ta.overdueBadge : tp.stage[st.stage]}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {d.viewer_is_founder ? ta.founderOnly : ta.readOnly}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {st.due_at && (
          <p
            className={st.overdue ? "font-medium text-destructive" : ""}
            data-testid="admin-interruption-due"
          >
            <CalendarClock className="mr-1 inline h-4 w-4" aria-hidden />
            {st.stage === "founder_review"
              ? (st.overdue ? tp.reviewOverdue : tp.reviewDue).replace(
                  "{time}",
                  when(st.due_at),
                )
              : tp.dueAt.replace("{time}", when(st.due_at))}
          </p>
        )}
        <p className="text-xs font-medium" data-testid="admin-amount-state">
          {d.amount_state === "settled"
            ? tp.amount.settled.replace(
                "{amount}",
                money(d.closure?.amount ?? 0),
              )
            : tp.amount[d.amount_state]}
        </p>

        <section
          className="space-y-1"
          data-testid="admin-interruption-requests"
        >
          <p className="font-medium">{ta.requestsTitle}</p>
          <p className="text-xs">
            {ta.versionRequestLine
              .replace("{party}", tp.party[d.version_request.party])
              .replace("{time}", when(d.version_request.due_at))}{" "}
            ·{" "}
            {d.version_request.given_at
              ? ta.requestAnswered.replace(
                  "{time}",
                  when(d.version_request.given_at),
                )
              : d.version_request.open
                ? ta.requestOpen
                : ta.requestExpired}
          </p>
          {d.requests.map((r) => (
            <p
              key={r.id}
              className="text-xs"
              data-testid="admin-interruption-request"
              data-expired={String(r.expired)}
            >
              {ta.requestLine
                .replace("{party}", tp.party[r.party])
                .replace("{time}", when(r.respond_by))}{" "}
              ·{" "}
              {r.answered_at
                ? ta.requestAnswered.replace("{time}", when(r.answered_at))
                : r.expired
                  ? ta.requestExpired
                  : ta.requestOpen}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">{tp.silenceNote}</p>
        </section>

        <section className="space-y-2">
          <p className="flex items-center gap-1 font-medium">
            <Clock className="h-4 w-4" aria-hidden />
            {tp.versionsTitle}
          </p>
          {d.versions.map((v) => (
            <div
              key={v.party}
              className="space-y-1 rounded-md bg-muted/50 p-2"
              data-testid="admin-interruption-version"
              data-party={v.party}
            >
              <p className="text-xs font-medium text-muted-foreground">
                {tp.versionLine
                  .replace("{party}", tp.party[v.party])
                  .replace("{cause}", tp.causes[v.cause])
                  .replace("{time}", when(v.declared_at))}
              </p>
              <p className="text-xs text-muted-foreground">
                {tp.workDoneLabel}
              </p>
              <p className="whitespace-pre-wrap break-words">{v.work_done}</p>
              <p className="text-xs text-muted-foreground">{tp.reasonLabel}</p>
              <p className="whitespace-pre-wrap break-words">{v.reason}</p>
            </div>
          ))}
        </section>

        {d.proposals.length > 0 && (
          <section
            className="space-y-2"
            data-testid="admin-interruption-proposals"
          >
            <p className="flex items-center gap-1 font-medium">
              <Handshake className="h-4 w-4" aria-hidden />
              {tp.proposalsTitle}
            </p>
            {[...d.proposals].reverse().map((p) => (
              <div
                key={p.id}
                className="space-y-1 rounded-md border p-2"
                data-testid="admin-interruption-proposal"
                data-status={p.status}
                data-version={p.version}
              >
                <p className="font-medium">
                  {tp.proposalLine
                    .replace("{version}", String(p.version))
                    .replace("{amount}", money(p.amount))}{" "}
                  · {tp.proposalStatus[p.status]}
                </p>
                <p className="whitespace-pre-wrap break-words text-xs">
                  {p.motivation}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tp.respondBy.replace("{time}", when(p.respond_by))}
                </p>
                {p.responses.map((r) => (
                  <p key={r.party} className="text-xs">
                    {tp.responseLine
                      .replace("{party}", tp.party[r.party])
                      .replace("{decision}", tp.decisions[r.decision])
                      .replace("{time}", when(r.responded_at))}
                  </p>
                ))}
              </div>
            ))}
          </section>
        )}

        {d.closure && (
          <div
            className="rounded-md bg-muted/50 p-2"
            data-testid="admin-interruption-closure"
            data-outcome={d.closure.outcome}
          >
            <p className="font-medium">
              {tp.closureTitle} · {tp.closureOutcome[d.closure.outcome]}
            </p>
            {d.closure.motivation && (
              <p className="whitespace-pre-wrap break-words text-xs">
                {d.closure.motivation}
              </p>
            )}
          </div>
        )}

        {d.extensions.length > 0 && (
          <section className="space-y-1">
            <p className="font-medium">{ta.extensionsTitle}</p>
            {d.extensions.map((e) => (
              <p key={e.created_at} className="text-xs">
                {ta.extensionLine
                  .replace("{time}", when(e.ends_at))
                  .replace("{reason}", e.reason)}
              </p>
            ))}
          </section>
        )}

        {d.viewer_is_founder &&
          f.propose_blocked === "settlement_rule_pending" && (
            <p
              className="rounded-md bg-warning/10 p-2 text-xs"
              data-testid="admin-interruption-policy-pending"
            >
              {ta.policyPending}
            </p>
          )}

        {d.finance.cap != null && (
          <p className="text-xs" data-testid="admin-interruption-cap">
            {ta.capLabel.replace("{amount}", money(d.finance.cap))}
          </p>
        )}

        {f.can_propose && (
          <section className="space-y-2" data-testid="founder-propose">
            <p className="text-xs text-muted-foreground">{ta.zeroNote}</p>
            <label className="block text-xs font-medium">
              {ta.amountLabel}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={d.finance.cap ?? undefined}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={fieldClass}
                data-testid="founder-amount"
              />
            </label>
            <label className="block text-xs font-medium">
              {ta.motivationLabel}
              <Textarea
                value={motivation}
                onChange={(e) => setMotivation(e.target.value)}
                maxLength={2000}
                className="mt-1"
                data-testid="founder-motivation"
              />
            </label>
            <p className="text-xs text-muted-foreground">{tp.sameAmount}</p>
            <motion.div whileTap={tap}>
              <Button
                size="sm"
                disabled={
                  busy || amount === "" || motivation.trim().length < 10
                }
                onClick={() =>
                  void act(
                    {
                      action: "propose",
                      amount: Number(amount),
                      motivation,
                      expected_version: current?.version ?? 0,
                    },
                    ta.proposed,
                  ).then((ok) => {
                    if (ok) {
                      setAmount("");
                      setMotivation("");
                    }
                  })
                }
                data-testid="founder-propose-submit"
              >
                {current ? ta.amend : ta.propose}
              </Button>
            </motion.div>
          </section>
        )}

        {f.can_close && (
          <section className="space-y-2" data-testid="founder-close">
            <p className="text-xs font-medium">{ta.closeLabel}</p>
            <fieldset className="space-y-1 text-xs">
              {FOUNDER_CLOSURES.map((o) => (
                <label key={o} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`close-${d.incident_id}`}
                    checked={closeOutcome === o}
                    onChange={() => setCloseOutcome(o)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                    data-testid={`founder-close-${o}`}
                  />
                  <span>
                    <span className="font-medium">{ta.closeOutcome[o]}</span> —{" "}
                    {ta.closeHint[o]}
                  </span>
                </label>
              ))}
            </fieldset>
            <Textarea
              value={closeText}
              onChange={(e) => setCloseText(e.target.value)}
              maxLength={2000}
              placeholder={ta.closeMotivation}
              aria-label={ta.closeMotivation}
              data-testid="founder-close-motivation"
            />
            <motion.div whileTap={tap}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !closeOutcome || closeText.trim().length < 10}
                onClick={() =>
                  closeOutcome &&
                  void act(
                    {
                      action: "close",
                      outcome: closeOutcome,
                      motivation: closeText,
                    },
                    ta.closed,
                  )
                }
                data-testid="founder-close-submit"
              >
                {ta.close}
              </Button>
            </motion.div>
          </section>
        )}

        {d.viewer_is_founder && f.extension_used && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="founder-extension-used"
          >
            {ta.extensionUsed}
          </p>
        )}
        {f.can_extend && (
          <section className="space-y-2" data-testid="founder-extend">
            <p className="text-xs text-muted-foreground">{ta.extensionOnce}</p>
            <label className="block text-xs font-medium">
              {ta.extendEnds}
              <input
                type="datetime-local"
                value={extendAt}
                min={
                  st.due_at
                    ? doualaLocalInput(Date.parse(st.due_at))
                    : undefined
                }
                onChange={(e) => setExtendAt(e.target.value)}
                className={fieldClass}
                data-testid="founder-extend-at"
              />
            </label>
            <label className="block text-xs font-medium">
              {ta.extendReason}
              <input
                type="text"
                maxLength={1000}
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                className={fieldClass}
                data-testid="founder-extend-reason"
              />
            </label>
            <motion.div whileTap={tap}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !extendAt || extendReason.trim().length < 10}
                onClick={() =>
                  void act(
                    {
                      action: "extend",
                      ends_at: doualaLocalToIso(extendAt) ?? "",
                      reason: extendReason,
                    },
                    ta.extended,
                  ).then((ok) => ok && setExtendReason(""))
                }
                data-testid="founder-extend-submit"
              >
                {ta.extend}
              </Button>
            </motion.div>
          </section>
        )}

        {f.can_finalize && current && (
          <section className="space-y-2" data-testid="founder-finalize">
            <p className="text-xs">{ta.finalizeHint}</p>
            <Textarea
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              maxLength={2000}
              placeholder={ta.finalizeMotivation}
              aria-label={ta.finalizeMotivation}
              data-testid="founder-finalize-motivation"
            />
            <motion.div whileTap={tap}>
              <Button
                size="sm"
                disabled={busy || finalText.trim().length < 10}
                onClick={() =>
                  void act(
                    {
                      action: "finalize",
                      version: current.version,
                      motivation: finalText,
                    },
                    ta.finalized,
                  )
                }
                data-testid="founder-finalize-submit"
              >
                {ta.finalize} · {money(current.amount)}
              </Button>
            </motion.div>
          </section>
        )}

        {d.reexaminations.length > 0 && (
          <section
            className="space-y-2"
            data-testid="admin-interruption-reexams"
          >
            <p className="font-medium">{ta.reexamTitle}</p>
            {d.reexaminations.map((r) => (
              <div
                key={r.id}
                className="space-y-1 rounded-md border p-2 text-xs"
                data-testid="admin-reexam"
                data-decision={r.decision ?? "pending"}
              >
                <p className="font-medium">
                  {tp.party[r.party]} · {when(r.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{r.reason}</p>
                {r.decision ? (
                  <p>
                    {tp.reexam.decisionLine
                      .replace("{decision}", tp.reexam.decisions[r.decision])
                      .replace("{time}", when(r.decided_at ?? r.created_at))}
                    {r.decision_motivation ? ` — ${r.decision_motivation}` : ""}
                  </p>
                ) : (
                  f.can_decide_reexamination &&
                  r.current && (
                    <div className="space-y-2">
                      <fieldset className="space-y-1">
                        <legend className="font-medium">
                          {ta.reexamDecision}
                        </legend>
                        {REEXAM_DECISIONS.map((o) => (
                          <label key={o} className="flex items-start gap-2">
                            <input
                              type="radio"
                              name={`reexam-${r.id}`}
                              checked={reexamDecision[r.id] === o}
                              onChange={() =>
                                setReexamDecision((v) => ({ ...v, [r.id]: o }))
                              }
                              className="mt-0.5 h-4 w-4 accent-primary"
                              data-testid={`founder-reexam-${o}`}
                            />
                            {tp.reexam.decisions[o]}
                          </label>
                        ))}
                      </fieldset>
                      <Textarea
                        value={reexamText[r.id] ?? ""}
                        onChange={(e) =>
                          setReexamText((v) => ({
                            ...v,
                            [r.id]: e.target.value,
                          }))
                        }
                        maxLength={2000}
                        placeholder={ta.reexamMotivation}
                        aria-label={ta.reexamMotivation}
                        data-testid="founder-reexam-motivation"
                      />
                      <motion.div whileTap={tap}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            busy ||
                            !reexamDecision[r.id] ||
                            (reexamText[r.id] ?? "").trim().length < 10
                          }
                          onClick={() =>
                            void act(
                              {
                                action: "reexamination",
                                reexamination_id: r.id,
                                decision: reexamDecision[r.id],
                                motivation: reexamText[r.id] ?? "",
                              },
                              ta.reexamDone,
                            )
                          }
                          data-testid="founder-reexam-submit"
                        >
                          {ta.reexamSubmit}
                        </Button>
                      </motion.div>
                    </div>
                  )
                )}
              </div>
            ))}
          </section>
        )}

        {d.notices.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">
              {ta.notices}
            </summary>
            <ul
              className="mt-1 space-y-1"
              data-testid="admin-interruption-notices"
            >
              {d.notices.map((n, i) => (
                <li
                  key={i}
                  data-kind={n.kind}
                  data-recipient={n.recipient}
                  data-viewed={n.viewed_at ? "true" : "false"}
                >
                  {ta.recipient[n.recipient]} ·{" "}
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

        {error && (
          <p
            className="text-destructive"
            role="alert"
            data-testid="founder-error"
          >
            {tp.errors[error]}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
