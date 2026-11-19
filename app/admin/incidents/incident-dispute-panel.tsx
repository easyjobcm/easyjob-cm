"use client";

import { useRef, useState } from "react";
import type { z } from "zod";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  Gavel,
  History,
  MessageCircleQuestion,
  NotebookPen,
  Scale,
  UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { doualaDateTime } from "@/lib/utils/douala-time";
import {
  DISPUTE_OUTCOMES,
  INCIDENT_SITUATIONS,
  appealDecisionSchema,
  appealTakeSchema,
  deadlineExtensionSchema,
  incidentNoteSchema,
  infoRequestSchema,
  proposalReviewSchema,
  proposalSchema,
  situationSchema,
  type DisputeOutcome,
  type IncidentSituation,
} from "@/lib/validations/incident";

type Conflict = "none" | "concerned";
type DecisionTexts = {
  facts_retained: string;
  elements_verified: string;
  contradictions: string;
  justification: string;
  amicable_attempt: string | null;
  orientation: string | null;
};
export type DisputeDetail = {
  incident_id: string;
  status: "open" | "answered" | "decided" | "closed";
  situation: IncidentSituation | null;
  revision: number;
  viewer_is_ops: boolean;
  viewer_concerned: boolean;
  can_propose: boolean;
  /** Interruption : instruction ouverte selon l'état courant du dossier. */
  instruction_open?: boolean;
  deadlines: {
    applies: boolean;
    opened_at: string;
    extension_hours: number;
    reminder_at: string;
    escalation_at: string;
    company_responded: boolean;
    reminder_sent_at: string | null;
    escalated_at: string | null;
    second_channel_done: boolean;
  };
  events: {
    type: string;
    visibility: "party" | "admin";
    at: string;
    actor_role: string | null;
    data: Record<string, unknown>;
  }[];
  notes: {
    id: string;
    body: string;
    author_role: string;
    created_at: string;
  }[];
  info_requests: {
    id: string;
    party: "candidate" | "company";
    question: string;
    created_at: string;
    answered_at: string | null;
  }[];
  proposals: (DecisionTexts & {
    id: string;
    outcome: DisputeOutcome;
    dossier_revision: number;
    stale: boolean;
    status: "pending" | "approved" | "rejected" | "superseded";
    proposed_by_role: string;
    mine: boolean;
    created_at: string;
    review_note: string | null;
    can_review: boolean;
  })[];
  decisions: (DecisionTexts & {
    id: string;
    kind: "initial" | "appeal";
    outcome: DisputeOutcome;
    appeal_result: "upheld" | "revised" | "arbitration_required" | null;
    decided_at: string;
    decided_by_role: string;
    review_deadline: string | null;
  })[];
  appeals: {
    id: string;
    status: "pending_assignment" | "assigned" | "decided";
    assigned_to_me: boolean;
    eligible_count: number;
    can_take: boolean;
    contested_outcome: DisputeOutcome;
    requests: {
      party: "candidate" | "company";
      body: string;
      created_at: string;
    }[];
  }[];
};
type ErrorCode = keyof ReturnType<typeof useI18n>["t"]["incidents"]["errors"];

const fieldClass =
  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
const emptyTexts = {
  facts_retained: "",
  elements_verified: "",
  contradictions: "",
  justification: "",
  amicable_attempt: "",
  orientation: "",
};

/**
 * Lot 16 — instruction d'un dossier contesté par le support. Tout admin
 * actif qualifie, prolonge, demande des compléments et consigne ses
 * vérifications ; deux agents ops ou fondateur distincts proposent puis
 * valident ; la base revérifie grades, conflit d'intérêts, version du
 * dossier, délais et réalisation unique.
 */
export function IncidentDisputePanel({
  detail,
  onChanged,
  interruption = false,
}: {
  detail: DisputeDetail;
  onChanged: () => Promise<unknown>;
  /**
   * Interruption : décision du fondateur seul (carte dédiée) ; le support
   * y garde la qualification, les demandes, les contacts et les notes. Les
   * relances 24 h / 48 h, la double validation et la révision du lot 16 ne
   * s'y appliquent pas (la base les refuse).
   */
  interruption?: boolean;
}) {
  const outcomes = DISPUTE_OUTCOMES;
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const td = ti.admin.dispute;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.98 };
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [situation, setSituation] = useState<IncidentSituation | "">(
    detail.situation ?? "",
  );
  const [extHours, setExtHours] = useState("24");
  const [extReason, setExtReason] = useState("");
  const [infoParty, setInfoParty] = useState<"candidate" | "company">(
    "company",
  );
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<DisputeOutcome>("established");
  const [texts, setTexts] = useState(emptyTexts);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [appealResult, setAppealResult] = useState<
    "upheld" | "revised" | "arbitration_required"
  >("upheld");
  const [newOutcome, setNewOutcome] = useState<DisputeOutcome>("partial");

  const codeOf = (code: unknown): ErrorCode =>
    typeof code === "string" && code in ti.errors
      ? (code as ErrorCode)
      : "generic";

  async function act<T>(
    url: string,
    schema: z.ZodType<T>,
    body: unknown,
    done: (result: Record<string, unknown>) => string,
  ): Promise<boolean> {
    if (busyRef.current) return false;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      setError(codeOf(parsed.error.issues[0]?.message));
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      result?: Record<string, unknown> | null;
    };
    if (res?.ok) toast({ title: done(json.result ?? {}), variant: "success" });
    else setError(codeOf(json.code));
    await onChanged();
    busyRef.current = false;
    setBusy(false);
    return !!res?.ok;
  }

  const base = `/api/admin/incidents/${detail.incident_id}`;
  // Interruption : état courant du dossier (rouvert compris), lu en base.
  const open =
    typeof detail.instruction_open === "boolean"
      ? detail.instruction_open
      : detail.status === "open" || detail.status === "answered";
  const d = detail.deadlines;
  const reviewToast = (r: Record<string, unknown>) =>
    r.result === "rejected"
      ? td.rejected
      : r.result === "already_confirmed"
        ? td.alreadyConfirmed
        : r.result === "obsolete"
          ? td.obsolete
          : r.result === "conflict_declared"
            ? td.conflictRecorded
            : td.decided;

  const conflictChoice = (name: string) => (
    <fieldset className="space-y-1 text-xs" data-testid={`${name}-conflict`}>
      {(["none", "concerned"] as const).map((c) => (
        <label key={c} className="flex items-start gap-2">
          <input
            type="radio"
            name={`${name}-${detail.incident_id}`}
            checked={conflict === c}
            onChange={() => setConflict(c)}
            className="mt-0.5 h-4 w-4 accent-primary"
            data-testid={`${name}-conflict-${c}`}
          />
          {c === "none" ? td.conflictNone : td.conflictConcerned}
        </label>
      ))}
    </fieldset>
  );

  const textField = (key: keyof typeof emptyTexts, label: string) => (
    <label className="block text-xs font-medium" key={key}>
      {label}
      <Textarea
        value={texts[key]}
        onChange={(e) => setTexts((v) => ({ ...v, [key]: e.target.value }))}
        maxLength={
          key === "amicable_attempt" || key === "orientation" ? 2000 : 4000
        }
        className="mt-1"
        data-testid={`decision-${key}`}
      />
    </label>
  );
  const decisionFields = (o: DisputeOutcome) => (
    <>
      {textField("facts_retained", td.facts)}
      {textField("elements_verified", td.elements)}
      {textField("contradictions", td.contradictions)}
      {textField("justification", td.justification)}
      {o === "disagreement" && (
        <>
          {textField("amicable_attempt", td.amicable)}
          {textField("orientation", td.orientation)}
        </>
      )}
    </>
  );

  const eventText = (e: DisputeDetail["events"][number]) =>
    e.type === "deadline_extended"
      ? td.events.deadline_extended
          .replace("{hours}", String(e.data.hours ?? ""))
          .replace("{reason}", String(e.data.reason ?? ""))
      : (td.events[e.type as keyof typeof td.events] ?? e.type);

  return (
    <div className="space-y-4" data-testid="admin-incident-dispute">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {td.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="block text-xs font-medium">
            {td.situation}
            <div className="mt-1 flex gap-2">
              <select
                className={fieldClass + " mt-0"}
                value={situation}
                onChange={(e) =>
                  setSituation(e.target.value as IncidentSituation)
                }
                disabled={!open}
                data-testid="dispute-situation"
              >
                <option value="">{td.situationNone}</option>
                {INCIDENT_SITUATIONS.map((s) => (
                  <option key={s} value={s}>
                    {ti.situation[s]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy || !open || !situation || situation === detail.situation
                }
                onClick={() =>
                  void act(
                    `${base}/situation`,
                    situationSchema,
                    { situation },
                    () => td.situationSaved,
                  )
                }
                data-testid="dispute-situation-save"
              >
                {td.situationSave}
              </Button>
            </div>
          </label>

          {!interruption && (
            <div
              className="space-y-1 rounded-md bg-muted/40 p-2"
              data-testid="dispute-deadlines"
            >
              <p className="font-medium">{td.deadlines}</p>
              <p>
                {td.openedAt.replace(
                  "{time}",
                  doualaDateTime(d.opened_at, locale),
                )}
              </p>
              {d.applies ? (
                <>
                  <p>
                    {td.reminderAt.replace(
                      "{time}",
                      doualaDateTime(d.reminder_at, locale),
                    )}
                  </p>
                  <p>
                    {td.escalationAt.replace(
                      "{time}",
                      doualaDateTime(d.escalation_at, locale),
                    )}
                  </p>
                  {d.extension_hours > 0 && (
                    <p>
                      {td.extended.replace(
                        "{hours}",
                        String(d.extension_hours),
                      )}
                    </p>
                  )}
                  <p
                    className={
                      d.company_responded ? "text-success" : "text-warning"
                    }
                    data-testid="dispute-company-state"
                  >
                    {d.company_responded
                      ? td.companyResponded
                      : td.companySilent}
                  </p>
                  {d.reminder_sent_at && (
                    <p>
                      {td.reminderSent.replace(
                        "{time}",
                        doualaDateTime(d.reminder_sent_at, locale),
                      )}
                    </p>
                  )}
                  {d.escalated_at && (
                    <p className="font-medium" data-testid="dispute-escalated">
                      {td.escalated.replace(
                        "{time}",
                        doualaDateTime(d.escalated_at, locale),
                      )}
                    </p>
                  )}
                  {d.escalated_at && !d.company_responded && (
                    <p data-testid="dispute-second-channel">
                      {d.second_channel_done
                        ? td.secondChannelDone
                        : td.secondChannelRequired}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {td.silenceNote}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {td.notApplicable}
                </p>
              )}
            </div>
          )}
          {!interruption && open && d.applies && (
            <div className="grid grid-cols-[5rem_1fr] gap-2">
              <label className="text-xs font-medium">
                {td.extendHours}
                <input
                  type="number"
                  min={1}
                  max={168}
                  inputMode="numeric"
                  value={extHours}
                  onChange={(e) => setExtHours(e.target.value)}
                  className={fieldClass}
                  data-testid="dispute-extend-hours"
                />
              </label>
              <label className="text-xs font-medium">
                {td.extendReason}
                <input
                  type="text"
                  maxLength={1000}
                  value={extReason}
                  onChange={(e) => setExtReason(e.target.value)}
                  className={fieldClass}
                  data-testid="dispute-extend-reason"
                />
              </label>
              <motion.div whileTap={tap} className="col-span-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      `${base}/extend`,
                      deadlineExtensionSchema,
                      { hours: Number(extHours), reason: extReason },
                      () => td.extendDone,
                    ).then((ok) => ok && setExtReason(""))
                  }
                  data-testid="dispute-extend"
                >
                  {td.extend}
                </Button>
              </motion.div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleQuestion className="h-4 w-4" aria-hidden />
            {td.infoTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {detail.info_requests.map((r) => (
            <div
              key={r.id}
              className="rounded-md bg-muted/50 p-2"
              data-testid="dispute-info-request"
            >
              <p className="text-xs text-muted-foreground">
                {ti.party[r.party]} · {doualaDateTime(r.created_at, locale)}
              </p>
              <p className="whitespace-pre-wrap break-words">{r.question}</p>
              <p className="text-xs">
                {r.answered_at
                  ? td.infoAnswered.replace(
                      "{time}",
                      doualaDateTime(r.answered_at, locale),
                    )
                  : td.infoPending}
              </p>
            </div>
          ))}
          {(typeof detail.instruction_open === "boolean"
            ? detail.instruction_open
            : detail.status !== "closed") && (
            <>
              <label className="block text-xs font-medium">
                {td.infoParty}
                <select
                  className={fieldClass}
                  value={infoParty}
                  onChange={(e) =>
                    setInfoParty(e.target.value as "candidate" | "company")
                  }
                  data-testid="dispute-info-party"
                >
                  <option value="company">{ti.party.company}</option>
                  <option value="candidate">{ti.party.candidate}</option>
                </select>
              </label>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={1000}
                placeholder={td.infoQuestion}
                aria-label={td.infoQuestion}
                data-testid="dispute-info-question"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || question.trim().length < 10}
                onClick={() =>
                  void act(
                    `${base}/info-requests`,
                    infoRequestSchema,
                    { party: infoParty, question },
                    () => td.infoDone,
                  ).then((ok) => ok && setQuestion(""))
                }
                data-testid="dispute-info-send"
              >
                {td.infoSend}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <NotebookPen className="h-4 w-4" aria-hidden />
            {td.notesTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {detail.notes.map((n) => (
            <div
              key={n.id}
              className="rounded-md bg-muted/50 p-2"
              data-testid="dispute-note"
            >
              <p className="text-xs text-muted-foreground">
                {n.author_role} · {doualaDateTime(n.created_at, locale)}
              </p>
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
            </div>
          ))}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder={td.notesPlaceholder}
            aria-label={td.notesPlaceholder}
            data-testid="dispute-note-text"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || note.trim().length < 3}
            onClick={() =>
              void act(
                `${base}/notes`,
                incidentNoteSchema,
                { body: note },
                () => td.notesAdd,
              ).then((ok) => ok && setNote(""))
            }
            data-testid="dispute-note-add"
          >
            {td.notesAdd}
          </Button>
          <details className="pt-2">
            <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium">
              <History className="h-3 w-3" aria-hidden />
              {td.eventsTitle}
            </summary>
            <ol className="mt-2 space-y-1 text-xs" data-testid="dispute-events">
              {detail.events.map((e, i) => (
                <li key={i} data-type={e.type}>
                  <span className="text-muted-foreground">
                    {doualaDateTime(e.at, locale)} ·{" "}
                  </span>
                  {eventText(e)}
                  {e.actor_role ? ` (${e.actor_role})` : ""}
                </li>
              ))}
            </ol>
          </details>
        </CardContent>
      </Card>

      {!interruption && (
        <>
          <Card data-testid="dispute-proposals">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4" aria-hidden />
                {td.proposalsTitle}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {detail.viewer_concerned ? td.viewerConcerned : td.reservedOps}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {detail.proposals.map((p) => (
                <div
                  key={p.id}
                  className="space-y-1 rounded-md border p-2"
                  data-testid="dispute-proposal"
                  data-status={p.status}
                  data-stale={p.stale ? "true" : "false"}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {ti.decision.outcomes[p.outcome]}
                    </span>
                    <Badge variant="outline">
                      {td.proposalStatus[p.status]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {td.revision.replace("{rev}", String(p.dossier_revision))}{" "}
                      · {p.proposed_by_role}
                    </span>
                  </div>
                  {(
                    [
                      [td.facts, p.facts_retained],
                      [td.elements, p.elements_verified],
                      [td.contradictions, p.contradictions],
                      [td.justification, p.justification],
                      [td.amicable, p.amicable_attempt],
                      [td.orientation, p.orientation],
                    ] as const
                  ).map(([label, value]) =>
                    value ? (
                      <p
                        key={label}
                        className="whitespace-pre-wrap break-words"
                      >
                        <span className="font-medium">{label} : </span>
                        {value}
                      </p>
                    ) : null,
                  )}
                  {p.status === "pending" && p.stale && (
                    <p
                      className="text-warning"
                      data-testid="dispute-proposal-stale"
                    >
                      {td.stale}
                    </p>
                  )}
                  {p.status === "pending" && p.mine && (
                    <p className="text-xs">{td.mine}</p>
                  )}
                  {p.can_review && (
                    <div className="space-y-2 border-t pt-2">
                      <Textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        maxLength={2000}
                        placeholder={td.reviewNote}
                        aria-label={td.reviewNote}
                        data-testid="dispute-review-note"
                      />
                      {conflictChoice("review")}
                      <div className="flex flex-wrap gap-2">
                        {([true, false] as const).map((approve) => (
                          <motion.div key={String(approve)} whileTap={tap}>
                            <Button
                              size="sm"
                              variant={approve ? "default" : "outline"}
                              disabled={
                                busy ||
                                !conflict ||
                                reviewNote.trim().length < 10
                              }
                              onClick={() =>
                                void act(
                                  `/api/admin/incident-proposals/${p.id}/review`,
                                  proposalReviewSchema,
                                  { approve, note: reviewNote, conflict },
                                  reviewToast,
                                ).then((ok) => ok && setReviewNote(""))
                              }
                              data-testid={
                                approve ? "dispute-approve" : "dispute-reject"
                              }
                            >
                              {approve ? td.approve : td.reject}
                            </Button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {detail.can_propose && (
                <div
                  className="space-y-2 border-t pt-3"
                  data-testid="dispute-propose"
                >
                  <p className="font-medium">{td.proposeTitle}</p>
                  <label className="block text-xs font-medium">
                    {td.outcome}
                    <select
                      className={fieldClass}
                      value={outcome}
                      onChange={(e) =>
                        setOutcome(e.target.value as DisputeOutcome)
                      }
                      data-testid="dispute-outcome"
                    >
                      {outcomes.map((o) => (
                        <option key={o} value={o}>
                          {ti.decision.outcomes[o]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {decisionFields(outcome)}
                  {conflictChoice("propose")}
                  <motion.div whileTap={tap}>
                    <Button
                      disabled={busy || !conflict}
                      onClick={() =>
                        void act(
                          `${base}/proposals`,
                          proposalSchema,
                          { outcome, ...texts, conflict },
                          (r) =>
                            r.result === "conflict_declared"
                              ? td.conflictRecorded
                              : td.proposed,
                        ).then((ok) => ok && setTexts(emptyTexts))
                      }
                      data-testid="dispute-propose-submit"
                    >
                      {td.propose}
                    </Button>
                  </motion.div>
                </div>
              )}
            </CardContent>
          </Card>

          {(detail.decisions.length > 0 || detail.appeals.length > 0) && (
            <Card data-testid="dispute-decisions">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gavel className="h-4 w-4" aria-hidden />
                  {td.decisionsTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {detail.decisions.map((x) => (
                  <div
                    key={x.id}
                    className="space-y-1 rounded-md border p-2"
                    data-testid="dispute-decision"
                    data-kind={x.kind}
                  >
                    <p className="font-medium">
                      {x.kind === "initial"
                        ? ti.decision.initial
                        : ti.decision.appeal}{" "}
                      ·{" "}
                      {x.appeal_result && x.appeal_result !== "revised"
                        ? ti.decision.appealResults[x.appeal_result]
                        : ti.decision.outcomes[x.outcome]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {doualaDateTime(x.decided_at, locale)} ·{" "}
                      {x.decided_by_role}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      <span className="font-medium">{td.elements} : </span>
                      {x.elements_verified}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      <span className="font-medium">{td.justification} : </span>
                      {x.justification}
                    </p>
                    {x.review_deadline && (
                      <p
                        className="text-xs"
                        data-testid="dispute-review-deadline"
                      >
                        {td.reviewUntil.replace(
                          "{time}",
                          doualaDateTime(x.review_deadline, locale),
                        )}
                      </p>
                    )}
                  </div>
                ))}

                {detail.appeals.map((a) => (
                  <div
                    key={a.id}
                    className="space-y-2 rounded-md border border-warning/40 p-2"
                    data-testid="dispute-appeal"
                    data-status={a.status}
                  >
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <UserCheck className="h-4 w-4" aria-hidden />
                      {td.appealsTitle}
                      <Badge variant="outline">
                        {td.appealStatus[a.status]}
                      </Badge>
                    </p>
                    {a.requests.map((q, i) => (
                      <p
                        key={i}
                        className="whitespace-pre-wrap break-words text-xs"
                      >
                        <span className="font-medium">
                          {ti.party[q.party]} :{" "}
                        </span>
                        {q.body}
                      </p>
                    ))}
                    {a.status === "pending_assignment" && (
                      <p
                        className="text-xs"
                        data-testid="dispute-appeal-eligible"
                      >
                        {a.eligible_count === 0
                          ? td.noAgent
                          : td.eligible.replace(
                              "{count}",
                              String(a.eligible_count),
                            )}
                      </p>
                    )}
                    {a.can_take && (
                      <>
                        {conflictChoice("appeal")}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !conflict}
                          onClick={() =>
                            void act(
                              `/api/admin/incident-appeals/${a.id}/take`,
                              appealTakeSchema,
                              { conflict },
                              (r) =>
                                r.result === "conflict_declared"
                                  ? td.conflictRecorded
                                  : td.taken,
                            )
                          }
                          data-testid="dispute-appeal-take"
                        >
                          {td.take}
                        </Button>
                      </>
                    )}
                    {a.assigned_to_me && a.status === "assigned" && (
                      <div
                        className="space-y-2 border-t pt-2"
                        data-testid="dispute-appeal-decide"
                      >
                        {a.contested_outcome === "established" && (
                          <p className="text-xs text-warning">
                            {td.arbitrationHint}
                          </p>
                        )}
                        <label className="block text-xs font-medium">
                          {td.appealResult}
                          <select
                            className={fieldClass}
                            value={appealResult}
                            onChange={(e) =>
                              setAppealResult(
                                e.target.value as typeof appealResult,
                              )
                            }
                            data-testid="dispute-appeal-result"
                          >
                            {(
                              [
                                "upheld",
                                "revised",
                                "arbitration_required",
                              ] as const
                            ).map((r) => (
                              <option key={r} value={r}>
                                {ti.decision.appealResults[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {appealResult === "revised" && (
                          <label className="block text-xs font-medium">
                            {td.newOutcome}
                            <select
                              className={fieldClass}
                              value={newOutcome}
                              onChange={(e) =>
                                setNewOutcome(e.target.value as DisputeOutcome)
                              }
                              data-testid="dispute-appeal-outcome"
                            >
                              {outcomes
                                .filter((o) => o !== a.contested_outcome)
                                .map((o) => (
                                  <option key={o} value={o}>
                                    {ti.decision.outcomes[o]}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {decisionFields(
                          appealResult === "revised"
                            ? newOutcome
                            : a.contested_outcome,
                        )}
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              `/api/admin/incident-appeals/${a.id}/decide`,
                              appealDecisionSchema,
                              {
                                result: appealResult,
                                new_outcome:
                                  appealResult === "revised"
                                    ? newOutcome
                                    : null,
                                ...texts,
                              },
                              () => td.appealDone,
                            ).then((ok) => ok && setTexts(emptyTexts))
                          }
                          data-testid="dispute-appeal-submit"
                        >
                          {td.decideAppeal}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {error && (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="dispute-error"
        >
          {ti.errors[error]}
        </p>
      )}
    </div>
  );
}
