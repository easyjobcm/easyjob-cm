"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Flag, Paperclip, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDayDate } from "@/lib/jobs/schedule";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { useLatestRequest, useLiveRefresh } from "@/lib/realtime/provider";
import { useDeadlineNow } from "@/lib/realtime/use-deadline-now";
import {
  IncidentCompletionPanel,
  type DayConfirmation,
  type IncidentContact,
} from "./incident-completion-panel";
import { incidentDecisionSchema } from "@/lib/validations/incident";
import type { Database } from "@/lib/database.types";

type Row =
  Database["public"]["Functions"]["admin_mission_incidents"]["Returns"][number];
type Status = "open" | "answered" | "decided" | "closed";
type Detail = {
  incident_id: string;
  kind: "late" | "absence" | "code_not_received";
  status: Status;
  reported_by_party: "candidate" | "company";
  late_minutes: number | null;
  outcome: "established" | "not_established" | null;
  decision_note: string | null;
  decided_at: string | null;
  job_title: string;
  company_name: string;
  candidate_name: string | null;
  can_decide: boolean;
  // Lot 15 : contacts avec l'entreprise et confirmation de la journée.
  can_record_contact: boolean;
  can_confirm_day: boolean;
  contacts: IncidentContact[];
  confirmation: DayConfirmation | null;
  day: {
    date: string;
    starts_at: string;
    ends_at: string;
    started_at: string | null;
    confirmed_at: string | null;
    completed_via: "code" | "support" | null;
  };
  other_days: {
    date: string;
    confirmed_at: string | null;
    completed_via: "code" | "support" | null;
  }[];
  statements: {
    party: "candidate" | "company";
    body: string;
    created_at: string;
  }[];
  evidence: {
    id: string;
    party: "candidate" | "company";
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }[];
};
type ErrorCode = keyof ReturnType<typeof useI18n>["t"]["incidents"]["errors"];

/**
 * Support (lot 14) : signalements par journée, versions des parties,
 * justificatifs privés (URL signée de 60 s, ouverte à la demande) et
 * décision motivée. La décision ne s'applique à rien d'autre.
 */
export function IncidentsAdminClient({ canDecide }: { canDecide: boolean }) {
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const ta = ti.admin;
  const { toast } = useToast();
  const [filter, setFilter] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [outcome, setOutcome] = useState<
    "established" | "not_established" | null
  >(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const listReq = useLatestRequest();
  const detailReq = useLatestRequest();

  const codeOf = (code: unknown): ErrorCode =>
    typeof code === "string" && code in ti.errors
      ? (code as ErrorCode)
      : "generic";

  const loadList = async () => {
    const token = listReq.begin();
    const res = await fetch(
      `/api/admin/incidents${filter ? `?status=${filter}` : ""}`,
      { cache: "no-store" },
    ).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      incidents?: Row[];
    };
    if (listReq.isLatest(token) && res?.ok) setRows(body.incidents ?? []);
  };
  const loadDetail = async () => {
    if (!selected) return;
    const token = detailReq.begin();
    const res = await fetch(`/api/admin/incidents/${selected}`, {
      cache: "no-store",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      incident?: Detail;
    };
    if (detailReq.isLatest(token) && res?.ok && body.incident)
      setDetail(body.incident);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setOutcome(null);
    setNote("");
    setError(null);
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useLiveRefresh(["admin:incidents"], async () => {
    await Promise.all([loadList(), loadDetail()]);
  });
  // Lot 15 : la confirmation s'ouvre à la fin prévue de la journée.
  const serverNow = useDeadlineNow(
    detail ? [Date.parse(detail.day.ends_at)] : [],
  );
  const confirmedLabel = (at: string, via: "code" | "support" | null): string =>
    (via === "support" ? ta.confirmedBySupportAt : ta.confirmedAt).replace(
      "{time}",
      doualaDateTime(at, locale),
    );

  async function openEvidence(id: string) {
    if (!detail) return;
    const res = await fetch(
      `/api/admin/incidents/${detail.incident_id}/evidence/${id}`,
      { cache: "no-store" },
    ).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      url?: string;
      code?: string;
    };
    if (res?.ok && body.url) window.open(body.url, "_blank", "noopener");
    else
      toast({
        title: ti.toasts.errorTitle,
        description: ti.errors[codeOf(body.code)],
        variant: "destructive",
      });
  }

  async function decide() {
    if (!detail || busyRef.current) return;
    const parsed = incidentDecisionSchema.safeParse({ outcome, note });
    if (!parsed.success) {
      setError(codeOf(parsed.error.issues[0]?.message));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/incidents/${detail.incident_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok) toast({ title: ta.decided, variant: "success" });
    else setError(codeOf(body.code));
    await Promise.all([loadList(), loadDetail()]);
    busyRef.current = false;
    setBusy(false);
  }

  const filters: (Status | null)[] = [
    null,
    "open",
    "answered",
    "decided",
    "closed",
  ];

  return (
    <div className="min-h-screen bg-background p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center text-sm text-muted-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
          {ta.back}
        </Link>
        <div>
          <h1 className="text-xl font-bold">{ta.title}</h1>
          <p className="text-sm text-muted-foreground">{ta.subtitle}</p>
        </div>

        {!detail && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {filters.map((f) => (
                <Button
                  key={f ?? "all"}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  aria-pressed={filter === f}
                  className="shrink-0"
                  onClick={() => setFilter(f)}
                >
                  {f ? ta.filters[f] : ta.filters.all}
                </Button>
              ))}
            </div>
            {rows && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">{ta.empty}</p>
            )}
            <div className="space-y-2" data-testid="admin-incident-list">
              {(rows ?? []).map((r) => (
                <button
                  key={r.incident_id}
                  type="button"
                  onClick={() => setSelected(r.incident_id)}
                  className="w-full rounded-lg border bg-card p-3 text-left text-sm hover:shadow-md"
                  data-testid="admin-incident-row"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Flag className="h-4 w-4 text-primary" aria-hidden />
                    <span className="font-medium">
                      {ti.kinds[r.kind as keyof typeof ti.kinds]} ·{" "}
                      {formatDayDate(r.day_date, locale)}
                    </span>
                    <Badge variant="outline">
                      {ti.status[r.status as Status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {r.job_title} · {r.company_name} · {r.candidate_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {
                      ti.reportedBy[
                        r.reported_by_party as keyof typeof ti.reportedBy
                      ]
                    }{" "}
                    · {r.statement_count} ·{" "}
                    <Paperclip className="inline h-3 w-3" /> {r.evidence_count}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}

        {detail && (
          <div className="space-y-4" data-testid="admin-incident-detail">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
              {ta.back}
            </Button>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {ti.kinds[detail.kind]} ·{" "}
                  {formatDayDate(detail.day.date, locale)}
                  <Badge variant="outline">{ti.status[detail.status]}</Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {detail.job_title}
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  {ta.company} : {detail.company_name}
                </p>
                <p>
                  {ta.candidate} : {detail.candidate_name ?? "—"}
                </p>
                <p className="text-muted-foreground">
                  {ti.reportedBy[detail.reported_by_party]}
                  {detail.late_minutes
                    ? ` · ${ti.lateDeclared.replace("{min}", String(detail.late_minutes))}`
                    : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{ta.dayFacts}</CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-1 text-sm"
                data-testid="admin-incident-day"
              >
                <p>
                  {detail.day.started_at
                    ? ta.startedAt.replace(
                        "{time}",
                        doualaDateTime(detail.day.started_at, locale),
                      )
                    : ta.notStarted}
                </p>
                <p>
                  {ta.endsAt.replace(
                    "{time}",
                    doualaDateTime(detail.day.ends_at, locale),
                  )}
                </p>
                <p data-testid="admin-incident-day-status">
                  {detail.day.confirmed_at
                    ? confirmedLabel(
                        detail.day.confirmed_at,
                        detail.day.completed_via,
                      )
                    : ta.notConfirmed}
                </p>
                {detail.other_days.length > 0 && (
                  <div className="pt-2">
                    <p className="font-medium">{ta.otherDays}</p>
                    <ul className="text-muted-foreground">
                      {detail.other_days.map((d) => (
                        <li key={d.date}>
                          {formatDayDate(d.date, locale)} ·{" "}
                          {d.confirmed_at
                            ? confirmedLabel(d.confirmed_at, d.completed_via)
                            : ta.notConfirmed}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{ta.statements}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {detail.statements.map((s, i) => (
                  <div key={i} className="rounded-md bg-muted/50 p-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {ti.party[s.party]} ·{" "}
                      {doualaDateTime(s.created_at, locale)}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{s.body}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{ta.evidence}</CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-2 text-sm"
                data-testid="admin-incident-evidence"
              >
                {detail.evidence.length === 0 && (
                  <p className="text-muted-foreground">{ta.noEvidence}</p>
                )}
                {detail.evidence.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>
                      {ti.party[e.party]} · {e.mime_type} ·{" "}
                      {Math.ceil(e.size_bytes / 1024)} Ko
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void openEvidence(e.id)}
                    >
                      <ExternalLink className="mr-1 h-4 w-4" aria-hidden />
                      {ta.openEvidence}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <IncidentCompletionPanel
              key={detail.incident_id}
              incidentId={detail.incident_id}
              kind={detail.kind}
              contacts={detail.contacts}
              confirmation={detail.confirmation}
              canRecordContact={detail.can_record_contact}
              canConfirmDay={detail.can_confirm_day}
              canConfirmRole={canDecide}
              dayStarted={!!detail.day.started_at}
              dayEndsAt={detail.day.ends_at}
              dayConfirmedAt={detail.day.confirmed_at}
              dayCompletedVia={detail.day.completed_via}
              serverNow={serverNow}
              onChanged={() => Promise.all([loadList(), loadDetail()])}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Scale className="h-4 w-4" aria-hidden />
                  {ta.decide}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {detail.kind === "code_not_received" && !detail.outcome ? (
                  <p className="text-muted-foreground">
                    {ta.codeNotReceivedDecision}
                  </p>
                ) : detail.outcome ? (
                  <div data-testid="admin-incident-outcome">
                    <p className="font-medium">{ti.outcome[detail.outcome]}</p>
                    {detail.decision_note && (
                      <p className="whitespace-pre-wrap break-words">
                        {detail.decision_note}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ti.decisionScope}
                    </p>
                  </div>
                ) : canDecide && detail.can_decide ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(["established", "not_established"] as const).map(
                        (o) => (
                          <Button
                            key={o}
                            size="sm"
                            variant={outcome === o ? "default" : "outline"}
                            aria-pressed={outcome === o}
                            onClick={() => setOutcome(o)}
                          >
                            {ti.outcome[o]}
                          </Button>
                        ),
                      )}
                    </div>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={2000}
                      placeholder={ta.decisionPlaceholder}
                      aria-label={ta.decisionPlaceholder}
                    />
                    <p className="text-xs text-muted-foreground">
                      {ti.decisionScope}
                    </p>
                    {error && (
                      <p className="text-destructive" role="alert">
                        {ti.errors[error]}
                      </p>
                    )}
                    <Button
                      onClick={() => void decide()}
                      disabled={busy || !outcome || note.trim().length < 10}
                    >
                      {ta.submitDecision}
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {detail.status === "closed"
                      ? ti.status.closed
                      : ta.readOnly}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
