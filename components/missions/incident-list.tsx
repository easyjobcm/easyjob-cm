"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Flag,
  History,
  MessageCircleQuestion,
  Paperclip,
  Scale,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { formatDayDate } from "@/lib/jobs/schedule";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { useLatestRequest, useLiveRefresh } from "@/lib/realtime/provider";
import {
  incidentStatementSchema,
  type DisputeOutcome,
} from "@/lib/validations/incident";
import type { Database } from "@/lib/database.types";
import {
  InterruptionSection,
  parseInterruptionDetail,
} from "@/components/missions/interruption-section";

type Row =
  Database["public"]["Functions"]["mission_incidents_for_party"]["Returns"][number];
export type PartyIncident = Omit<
  Row,
  | "late_minutes"
  | "outcome"
  | "decision_note"
  | "decided_at"
  | "closed_reason"
  | "resolution"
  | "timeline"
  | "info_requests"
  | "decisions"
  | "review"
> & {
  late_minutes: number | null;
  outcome: "established" | "not_established" | null;
  decision_note: string | null;
  decided_at: string | null;
  closed_reason: string | null;
  /** Lot 15 : journée confirmée par le support (motif interne non lu). */
  resolution: "support_confirmed_day" | null;
  /** Lot 16 : chronologie publique, compléments, décisions, révision. */
  timeline: TimelineEvent[] | null;
  info_requests: InfoRequest[] | null;
  decisions: PartyDecision[] | null;
  review: ReviewState | null;
  /** Interruption : versions, travail déclaré, règlement (route). */
  interruption?: unknown;
};
type TimelineEvent = {
  type: string;
  at: string;
  party: "candidate" | "company" | null;
  outcome: DisputeOutcome | null;
};
type InfoRequest = {
  id: string;
  question: string;
  created_at: string;
  answered_at: string | null;
};
type PartyDecision = {
  id: string;
  kind: "initial" | "appeal";
  outcome: DisputeOutcome;
  appeal_result: "upheld" | "revised" | "arbitration_required" | null;
  facts_retained: string;
  contradictions: string;
  justification: string;
  amicable_attempt: string | null;
  orientation: string | null;
  decided_at: string;
  review_deadline: string | null;
};
type ReviewState = {
  deadline: string;
  open: boolean;
  status: "pending_assignment" | "assigned" | "decided" | null;
  requested_by_viewer: boolean;
};
type Statement = {
  party: "candidate" | "company";
  body: string;
  created_at: string;
};
type ErrorCode = keyof ReturnType<typeof useI18n>["t"]["incidents"]["errors"];

/**
 * Signalements d'une mission, lus par l'une de ses parties (lot 14) :
 * relecture sur signal privé « incidents », à la reconnexion et après
 * chaque action. Aucune pièce n'est lisible ici : seulement leur nombre.
 */
export function useMissionIncidents(missionId: string | null) {
  const [incidents, setIncidents] = useState<PartyIncident[] | null>(null);
  const latest = useLatestRequest();
  const load = async () => {
    if (!missionId) return;
    const token = latest.begin();
    const res = await fetch(`/api/missions/${missionId}/incidents`, {
      cache: "no-store",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      incidents?: PartyIncident[];
    };
    if (!latest.isLatest(token)) return;
    // Erreur réseau : l'affichage précédent reste.
    if (res?.ok) setIncidents(body.incidents ?? []);
    else if (res) setIncidents([]);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);
  useLiveRefresh(["incidents", "missions"], load);
  return { incidents, reload: load };
}

export function IncidentList({
  incidents,
  onChanged,
  dayId,
}: {
  incidents: PartyIncident[];
  onChanged: () => void;
  /** Limite l'affichage à une journée (écran entreprise). */
  dayId?: string;
}) {
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const rows = dayId
    ? incidents.filter((i) => i.mission_day_id === dayId)
    : incidents;
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="incident-list">
      {rows.map((i) => (
        <IncidentCard
          key={i.incident_id}
          incident={i}
          onChanged={onChanged}
          locale={locale}
          ti={ti}
        />
      ))}
    </div>
  );
}

function IncidentCard({
  incident,
  onChanged,
  locale,
  ti,
}: {
  incident: PartyIncident;
  onChanged: () => void;
  locale: ReturnType<typeof useI18n>["locale"];
  ti: ReturnType<typeof useI18n>["t"]["incidents"];
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const busyRef = useRef(false);
  const statements = (incident.statements ?? []) as Statement[];
  const counts = (incident.evidence_counts ?? {}) as Record<string, number>;
  const viewer = incident.viewer_party as "candidate" | "company";
  const ownStatements = statements.filter((s) => s.party === viewer).length;
  const interruption =
    incident.kind === "interruption"
      ? parseInterruptionDetail(incident.interruption)
      : null;

  const codeOf = (code: unknown): ErrorCode =>
    typeof code === "string" && code in ti.errors
      ? (code as ErrorCode)
      : "generic";

  async function send() {
    if (busyRef.current) return;
    const parsed = incidentStatementSchema.safeParse({ statement: draft });
    if (!parsed.success) {
      setError(codeOf(parsed.error.issues[0]?.message));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/incidents/${incident.incident_id}/statements`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      },
    ).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok) {
      setDraft("");
      toast({ title: ti.toasts.statementSent, variant: "success" });
    } else setError(codeOf(body.code));
    busyRef.current = false;
    setBusy(false);
    onChanged();
  }

  async function upload(file: File) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/incidents/${incident.incident_id}/evidence`, {
      method: "POST",
      body: form,
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok) toast({ title: ti.toasts.evidenceSent, variant: "success" });
    else setError(codeOf(body.code));
    busyRef.current = false;
    setBusy(false);
    onChanged();
  }

  const statusVariant =
    incident.status === "decided"
      ? "success"
      : incident.status === "closed"
        ? "outline"
        : "warning";

  return (
    <div
      className="space-y-2 rounded-lg border p-3 text-sm"
      data-testid="incident-card"
      data-kind={incident.kind}
      data-status={incident.status}
      data-resolution={incident.resolution ?? ""}
      data-date={incident.day_date}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Flag className="h-4 w-4 text-primary" aria-hidden />
        <span className="font-medium">
          {ti.kinds[incident.kind as keyof typeof ti.kinds]} ·{" "}
          {formatDayDate(incident.day_date, locale)}
        </span>
        <Badge variant={statusVariant} data-testid="incident-status">
          {ti.status[incident.status as keyof typeof ti.status]}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {
          ti.reportedBy[
            incident.reported_by_party as keyof typeof ti.reportedBy
          ]
        }
        {incident.late_minutes
          ? ` · ${ti.lateDeclared.replace("{min}", String(incident.late_minutes))}`
          : ""}
      </p>
      <ul className="space-y-2" data-testid="incident-statements">
        {statements.map((s, idx) => (
          <li key={idx} className="rounded-md bg-muted/50 p-2">
            <p className="text-xs font-medium text-muted-foreground">
              {ti.party[s.party]}
              {s.party === viewer ? ` (${ti.you})` : ""} ·{" "}
              {doualaDateTime(s.created_at, locale)}
            </p>
            <p className="whitespace-pre-wrap break-words">{s.body}</p>
          </li>
        ))}
      </ul>
      {interruption && (
        <InterruptionSection
          detail={interruption}
          viewer={viewer}
          onChanged={onChanged}
        />
      )}
      {(["candidate", "company"] as const).map((p) =>
        counts[p] ? (
          <p
            key={p}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Paperclip className="h-3 w-3" aria-hidden />
            {ti.party[p]} : {plural(counts[p], ti.evidenceCount, locale)}
          </p>
        ) : null,
      )}
      <IncidentDisputeSections
        incident={incident}
        onChanged={onChanged}
        busy={busy}
        setBusy={setBusy}
        busyRef={busyRef}
        setError={setError}
        codeOf={codeOf}
        requestDue={
          interruption
            ? new Map(interruption.requests.map((r) => [r.id, r]))
            : null
        }
      />
      {!interruption &&
        incident.outcome &&
        (incident.decisions ?? []).length === 0 && (
          <div
            className="rounded-md border border-primary/30 bg-primary/5 p-2"
            data-testid="incident-decision"
          >
            <p className="flex items-center gap-1 font-medium">
              <Scale className="h-4 w-4" aria-hidden />
              {incident.resolution === "support_confirmed_day"
                ? ti.resolution.support_confirmed_day
                : incident.outcome === "established" ||
                    incident.outcome === "not_established"
                  ? ti.outcome[incident.outcome]
                  : null}
            </p>
            {incident.decision_note && (
              <p className="whitespace-pre-wrap break-words">
                {ti.decisionNote.replace("{note}", incident.decision_note)}
              </p>
            )}
            {incident.resolution !== "support_confirmed_day" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {ti.decisionScope}
              </p>
            )}
          </div>
        )}
      {incident.can_add_statement && (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            placeholder={ownStatements === 0 ? ti.giveVersion : ti.addToVersion}
            aria-label={ownStatements === 0 ? ti.giveVersion : ti.addToVersion}
            data-testid="incident-version"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void send()}
              disabled={busy || draft.trim().length < 10}
              data-testid="incident-version-send"
            >
              {ownStatements === 0 ? ti.giveVersion : ti.sendVersion}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary">
              <Paperclip className="h-3 w-3" aria-hidden />
              {ti.addEvidence}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
                data-testid="incident-evidence-add"
              />
            </label>
          </div>
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {ti.errors[error]}
        </p>
      )}
    </div>
  );
}

/**
 * Lot 16 : ce qu'une partie voit de l'instruction — chronologie (sans
 * étape interne), questions qui lui sont adressées, décisions (faits
 * retenus, contradictions, justification ; jamais les éléments vérifiés,
 * références ni notes) et révision interne avec son échéance (heure du
 * serveur).
 */
function IncidentDisputeSections({
  incident,
  onChanged,
  busy,
  setBusy,
  busyRef,
  setError,
  codeOf,
  requestDue,
}: {
  incident: PartyIncident;
  onChanged: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  busyRef: React.MutableRefObject<boolean>;
  setError: (e: ErrorCode | null) => void;
  codeOf: (code: unknown) => ErrorCode;
  /** Interruption : échéance de 72 h de chaque demande (heure de la base). */
  requestDue: Map<
    string,
    { respond_by: string; open: boolean; expired: boolean }
  > | null;
}) {
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reviewText, setReviewText] = useState("");
  const timeline = incident.timeline ?? [];
  const requests = incident.info_requests ?? [];
  const decisions = incident.decisions ?? [];
  const review = incident.review;

  async function post(url: string, statement: string, okTitle: string) {
    if (busyRef.current) return false;
    const parsed = incidentStatementSchema.safeParse({ statement });
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
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok) toast({ title: okTitle, variant: "success" });
    else setError(codeOf(body.code));
    busyRef.current = false;
    setBusy(false);
    onChanged();
    return !!res?.ok;
  }

  const eventLabel = (e: TimelineEvent): string | null => {
    const party = e.party ? ti.party[e.party] : "";
    switch (e.type) {
      case "opened":
        return ti.timeline.opened;
      case "party_notified":
        return ti.timeline.party_notified.replace("{party}", party);
      case "reminder_24h":
        return ti.timeline.reminder_24h;
      case "info_requested":
        return ti.timeline.info_requested;
      case "info_answered":
        return ti.timeline.info_answered;
      case "decision_recorded":
        return ti.timeline.decision_recorded.replace(
          "{outcome}",
          e.outcome ? ti.decision.outcomes[e.outcome] : "",
        );
      case "appeal_requested":
        return ti.timeline.appeal_requested.replace("{party}", party);
      case "appeal_assigned":
        return ti.timeline.appeal_assigned;
      case "appeal_decided":
        return ti.timeline.appeal_decided;
      default:
        return null;
    }
  };

  return (
    <>
      {timeline.length > 0 && (
        <details
          className="rounded-md border p-2"
          data-testid="incident-timeline"
        >
          <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium">
            <History className="h-3 w-3" aria-hidden />
            {ti.timeline.title}
          </summary>
          <ol className="mt-2 space-y-1 text-xs">
            {timeline.map((e, idx) => {
              const label = eventLabel(e);
              return label ? (
                <li
                  key={idx}
                  data-testid="incident-timeline-event"
                  data-type={e.type}
                >
                  <span className="text-muted-foreground">
                    {doualaDateTime(e.at, locale)} ·{" "}
                  </span>
                  {label}
                </li>
              ) : null;
            })}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            {ti.timeline.inApp}
          </p>
        </details>
      )}
      {requests.map((r) => {
        const due = requestDue?.get(r.id) ?? null;
        return (
          <div
            key={r.id}
            className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2"
            data-testid="incident-info-request"
            data-answered={r.answered_at ? "true" : "false"}
            data-expired={due?.expired ? "true" : "false"}
          >
            <p className="flex items-center gap-1 text-xs font-medium">
              <MessageCircleQuestion className="h-3 w-3" aria-hidden />
              {ti.info.title} · {doualaDateTime(r.created_at, locale)}
            </p>
            <p className="whitespace-pre-wrap break-words">{r.question}</p>
            {due && !r.answered_at && (
              <p
                className={
                  due.expired ? "text-xs text-muted-foreground" : "text-xs"
                }
                data-testid="incident-info-due"
              >
                {(due.expired
                  ? t.partialDay.requestExpired
                  : t.partialDay.requestDue
                ).replace("{time}", doualaDateTime(due.respond_by, locale))}
              </p>
            )}
            {r.answered_at ? (
              <p className="text-xs text-muted-foreground">
                {ti.info.answered.replace(
                  "{time}",
                  doualaDateTime(r.answered_at, locale),
                )}
              </p>
            ) : !due?.expired ? (
              <>
                <Textarea
                  value={answers[r.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [r.id]: e.target.value }))
                  }
                  maxLength={2000}
                  placeholder={ti.info.placeholder}
                  aria-label={ti.info.placeholder}
                  data-testid="incident-info-answer"
                />
                <Button
                  size="sm"
                  disabled={busy || (answers[r.id] ?? "").trim().length < 10}
                  onClick={() =>
                    void post(
                      `/api/incident-info/${r.id}`,
                      answers[r.id] ?? "",
                      ti.info.sent,
                    ).then(
                      (ok) => ok && setAnswers((a) => ({ ...a, [r.id]: "" })),
                    )
                  }
                  data-testid="incident-info-send"
                >
                  {ti.info.send}
                </Button>
              </>
            ) : null}
          </div>
        );
      })}
      {decisions.map((d) => (
        <div
          key={d.id}
          className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2"
          data-testid="incident-dispute-decision"
          data-kind={d.kind}
          data-outcome={d.outcome}
        >
          <p className="flex flex-wrap items-center gap-1 font-medium">
            <Scale className="h-4 w-4" aria-hidden />
            {d.kind === "initial"
              ? ti.decision.initial
              : ti.decision.appeal} ·{" "}
            {d.appeal_result && d.appeal_result !== "revised"
              ? ti.decision.appealResults[d.appeal_result]
              : ti.decision.outcomes[d.outcome]}
          </p>
          <p className="text-xs text-muted-foreground">
            {doualaDateTime(d.decided_at, locale)}
          </p>
          {(
            [
              [ti.decision.facts, d.facts_retained],
              [ti.decision.contradictions, d.contradictions],
              [ti.decision.justification, d.justification],
              [ti.decision.amicable, d.amicable_attempt],
              [ti.decision.orientation, d.orientation],
            ] as const
          ).map(([label, value]) =>
            value ? (
              <p key={label} className="whitespace-pre-wrap break-words">
                <span className="font-medium">{label} : </span>
                {value}
              </p>
            ) : null,
          )}
          {d.outcome === "partial" && (
            <p className="text-xs text-muted-foreground">
              {ti.decision.partialNote}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {ti.decision.noSanction}
          </p>
        </div>
      ))}
      {review && (
        <div
          className="space-y-2 rounded-md border p-2"
          data-testid="incident-review"
        >
          <p className="flex items-center gap-1 text-xs font-medium">
            <CalendarClock className="h-3 w-3" aria-hidden />
            {ti.review.title}
          </p>
          {review.status && (
            <p className="text-xs" data-testid="incident-review-status">
              {ti.review[review.status]}
            </p>
          )}
          {review.open ? (
            <>
              <p className="text-xs" data-testid="incident-review-deadline">
                {ti.review.deadline.replace(
                  "{time}",
                  doualaDateTime(review.deadline, locale),
                )}
              </p>
              <Textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                maxLength={2000}
                placeholder={ti.review.placeholder}
                aria-label={ti.review.placeholder}
                data-testid="incident-review-text"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || reviewText.trim().length < 10}
                onClick={() =>
                  void post(
                    `/api/incidents/${incident.incident_id}/review`,
                    reviewText,
                    ti.review.sent,
                  ).then((ok) => ok && setReviewText(""))
                }
                data-testid="incident-review-request"
              >
                {ti.review.request}
              </Button>
            </>
          ) : (
            !review.status && (
              <p className="text-xs text-muted-foreground">
                {ti.review.closed}
              </p>
            )
          )}
          <p className="text-xs text-muted-foreground">
            {ti.review.otherRemedies}
          </p>
        </div>
      )}
    </>
  );
}
