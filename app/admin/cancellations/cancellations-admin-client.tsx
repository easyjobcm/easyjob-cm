"use client";

import * as React from "react";
import useSWR from "swr";
import { ChevronLeft, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/ui/loading";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { doualaDateTime, doualaLocalToIso } from "@/lib/utils/douala-time";
import type {
  CancellationStatus,
  DayClassification,
} from "@/lib/validations/cancellation";

type AdminDay = {
  mission_day_id: string;
  starts_at: string;
  classification: DayClassification;
  candidate_plan?: string | null;
  terms_source?: string | null;
};
type AdminCancellation = {
  id: string;
  created_at: string;
  job_title: string | null;
  status: CancellationStatus;
  reason_code: string | null;
  reason_text: string | null;
  candidate_user_id: string;
  candidate_name: string | null;
  decision_note: string | null;
  review_requested_at: string | null;
  review_note: string | null;
  review_decided_at: string | null;
  review_outcome: string | null;
  days: AdminDay[] | null;
  evidence?: { id: string; created_at: string }[];
};
type Suspension = {
  id: string;
  cause: "admin" | "cancellation_cycle" | "fraud";
  cycle: number | null;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  lifted_at: string | null;
  contested_at: string | null;
  contest_note: string | null;
  contest_outcome: string | null;
};
type Detail = AdminCancellation & {
  fraud_reports: {
    id: string;
    reason: string;
    status: string;
    created_at: string;
  }[];
  suspensions: Suspension[];
  late_cancellation_count: number;
  future_engagements: {
    mission_day_id: string;
    job_title: string;
    starts_at: string;
  }[];
};

const fetchJson = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/**
 * Lot 17c — dossiers d'annulation pour le support : liste (à examiner ou
 * toutes), dossier (journées classées, plan à la sélection, motif, pièces),
 * décision et recours (ops et fondateur), fraude présumée et suspensions.
 */
export function CancellationsAdminClient({
  canDecide,
}: {
  canDecide: boolean;
}) {
  const { t, locale } = useI18n();
  const ta = t.cancellations.admin;
  const [filter, setFilter] = React.useState<"to_review" | "all">("to_review");
  const [selected, setSelected] = React.useState<string | null>(null);
  const listKey = `/api/admin/cancellations${filter === "to_review" ? "?status=to_review" : ""}`;
  const {
    data: list,
    mutate: mutateList,
    isLoading,
  } = useSWR(listKey, fetchJson);
  const { data: detail, mutate: mutateDetail } = useSWR<Detail>(
    selected ? `/api/admin/cancellations/${selected}` : null,
    fetchJson,
  );
  useLiveRefresh(["admin:incidents", "admin:account"], () => {
    void mutateList();
    void mutateDetail();
  });
  const refresh = () => {
    void mutateList();
    void mutateDetail();
  };

  const items: AdminCancellation[] = list?.cancellations ?? [];

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 px-4 py-6"
      data-testid="admin-cancellations"
    >
      <h1 className="text-xl font-semibold">{ta.title}</h1>
      {selected ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            {ta.back}
          </Button>
          {!detail ? (
            <LoadingSpinner />
          ) : (
            <DetailView d={detail} canDecide={canDecide} onChanged={refresh} />
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {(["to_review", "all"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === "to_review" ? ta.filterToReview : ta.filterAll}
              </Button>
            ))}
          </div>
          {isLoading ? (
            <LoadingSpinner />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ta.empty}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => setSelected(c.id)}
                    data-testid="admin-cancellation-row"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {c.candidate_name ?? "—"}
                      </span>
                      <Badge variant="secondary">
                        {t.cancellations.status[c.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.job_title} · {doualaDateTime(c.created_at, locale)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function useAction(onChanged: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const run = async (url: string, body: unknown, form?: FormData) => {
    setBusy(true);
    const res = await fetch(url, {
      method: "POST",
      headers: form ? undefined : { "Content-Type": "application/json" },
      body: form ?? JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const json = (await res?.json().catch(() => ({}))) as
      | { code?: string; result?: unknown }
      | undefined;
    if (!res?.ok) {
      const errors = t.cancellations.errors as Record<string, string>;
      toast({
        variant: "destructive",
        title:
          (json?.code && errors[json.code]) ||
          json?.code ||
          t.cancellations.errors.generic,
      });
      return null;
    }
    toast({ variant: "success", title: t.cancellations.admin.saved });
    onChanged();
    return json?.result ?? true;
  };
  return { busy, run };
}

function DetailView({
  d,
  canDecide,
  onChanged,
}: {
  d: Detail;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const tc = t.cancellations;
  const ta = tc.admin;
  const { busy, run } = useAction(onChanged);
  const [note, setNote] = React.useState("");
  const [fraudReason, setFraudReason] = React.useState("");
  const [fraudEnd, setFraudEnd] = React.useState("");
  const [suspNote, setSuspNote] = React.useState("");
  const evidenceRef = React.useRef<HTMLInputElement>(null);
  const openReport = d.fraud_reports.find((f) => f.status === "open");
  const reviewPending = !!d.review_requested_at && !d.review_decided_at;

  const openEvidence = async (id: string) => {
    const res = await fetch(`/api/admin/case-evidence/${id}`, {
      cache: "no-store",
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as
      | { url?: string }
      | undefined;
    if (body?.url) window.open(body.url, "_blank", "noopener,noreferrer");
    else toast({ variant: "destructive", title: tc.errors.generic });
  };

  const planOf = (day: AdminDay) =>
    day.terms_source === "legacy" || !day.candidate_plan
      ? tc.classes.legacy
      : day.candidate_plan === "premium"
        ? "Premium"
        : "Free";

  return (
    <div className="space-y-4" data-testid="admin-cancellation-detail">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>{d.candidate_name}</span>
            <Badge variant="secondary">{tc.status[d.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {ta.job} : {d.job_title} · {doualaDateTime(d.created_at, locale)}
          </p>
          <ul className="space-y-1">
            {(d.days ?? []).map((day) => (
              <li
                key={day.mission_day_id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>{doualaDateTime(day.starts_at, locale)}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge
                    variant={
                      day.classification === "late"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {tc.classes[day.classification]}
                  </Badge>
                  <Badge variant="outline">
                    {ta.planAtSelection.replace("{plan}", planOf(day))}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
          {d.reason_code && (
            <p>
              {ta.reasonCode.replace(
                "{reason}",
                (tc.reasons as Record<string, string>)[d.reason_code] ??
                  d.reason_code,
              )}
            </p>
          )}
          {d.reason_text && (
            <p className="break-words text-muted-foreground">{d.reason_text}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {ta.lateCount.replace("{n}", String(d.late_cancellation_count))}
          </p>
          <div>
            <p className="font-medium">{ta.evidence}</p>
            {(d.evidence ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{ta.noEvidence}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {(d.evidence ?? []).map((e, i) => (
                  <Button
                    key={e.id}
                    size="sm"
                    variant="outline"
                    onClick={() => void openEvidence(e.id)}
                  >
                    <FileText className="mr-1 h-4 w-4" />
                    {ta.openEvidence.replace("{n}", String(i + 1))}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {d.decision_note && (
            <p className="text-xs">
              {tc.decisionNote.replace("{note}", d.decision_note)}
            </p>
          )}
        </CardContent>
      </Card>

      {canDecide && (d.status === "under_review" || reviewPending) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {reviewPending ? ta.reviewTitle : ta.decideTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {reviewPending && (
              <>
                <p className="break-words">{d.review_note}</p>
                <p className="text-xs text-muted-foreground">{ta.reviewBy}</p>
              </>
            )}
            <Label htmlFor="admin-cancel-note">{ta.note}</Label>
            <Textarea
              id="admin-cancel-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {reviewPending ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(`/api/admin/cancellations/${d.id}/review`, {
                        outcome: "maintained",
                        note: note.trim(),
                      })
                    }
                  >
                    {ta.maintain}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(`/api/admin/cancellations/${d.id}/review`, {
                        outcome: "overturned",
                        note: note.trim(),
                      })
                    }
                  >
                    {ta.overturn}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(`/api/admin/cancellations/${d.id}/decision`, {
                        decision: "accepted",
                        note: note.trim(),
                      })
                    }
                    data-testid="admin-cancel-accept"
                  >
                    {ta.accept}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(`/api/admin/cancellations/${d.id}/decision`, {
                        decision: "refused",
                        note: note.trim(),
                      })
                    }
                    data-testid="admin-cancel-refuse"
                  >
                    {ta.refuse}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{ta.fraudTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">{ta.fraudHint}</p>
          {d.fraud_reports.map((f) => (
            <p
              key={f.id}
              className="break-words rounded border border-border p-2 text-xs"
            >
              {doualaDateTime(f.created_at, locale)} · {f.reason}
            </p>
          ))}
          {!openReport ? (
            <>
              <Label htmlFor="fraud-reason">{ta.fraudReason}</Label>
              <Textarea
                id="fraud-reason"
                rows={2}
                value={fraudReason}
                onChange={(e) => setFraudReason(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || fraudReason.trim().length < 10}
                onClick={() =>
                  void run("/api/admin/fraud-reports", {
                    subject_user_id: d.candidate_user_id,
                    cancellation_id: d.id,
                    reason: fraudReason.trim(),
                  }).then(() => setFraudReason(""))
                }
              >
                {ta.fraudReport}
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <input
                ref={evidenceRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="sr-only"
                aria-label={ta.fraudEvidence}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const form = new FormData();
                  form.append("file", f);
                  void run(
                    `/api/admin/fraud-reports/${openReport.id}/evidence`,
                    null,
                    form,
                  );
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => evidenceRef.current?.click()}
              >
                {ta.fraudEvidence}
              </Button>
              {canDecide && (
                <>
                  <Label htmlFor="fraud-end">{ta.suspendEnd}</Label>
                  <Input
                    id="fraud-end"
                    type="datetime-local"
                    max="9999-12-31T23:59"
                    value={fraudEnd}
                    onChange={(e) => setFraudEnd(e.target.value)}
                  />
                  <Label htmlFor="fraud-note">{ta.note}</Label>
                  <Textarea
                    id="fraud-note"
                    rows={2}
                    value={suspNote}
                    onChange={(e) => setSuspNote(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      busy ||
                      suspNote.trim().length < 10 ||
                      (fraudEnd !== "" && !doualaLocalToIso(fraudEnd))
                    }
                    onClick={() =>
                      void run(
                        `/api/admin/fraud-reports/${openReport.id}/suspend`,
                        {
                          ends_at: fraudEnd ? doualaLocalToIso(fraudEnd) : null,
                          reason: suspNote.trim(),
                        },
                      )
                    }
                  >
                    {ta.suspend}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{ta.suspensionsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {d.suspensions.map((s) => (
            <div
              key={s.id}
              className="space-y-1 rounded border border-border p-2"
              data-testid="admin-suspension"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {ta.causes[s.cause].replace("{n}", String(s.cycle ?? ""))}
                </span>
                <Badge variant={s.active ? "destructive" : "secondary"}>
                  {s.active
                    ? ta.state.active
                    : s.lifted_at
                      ? ta.state.lifted
                      : ta.state.ended}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {doualaDateTime(s.starts_at, locale)} →{" "}
                {s.ends_at
                  ? doualaDateTime(s.ends_at, locale)
                  : tc.suspensions.noEnd}
              </p>
              {s.contest_note && (
                <p className="break-words text-xs">
                  {ta.contestNote.replace("{note}", s.contest_note)}
                </p>
              )}
              {canDecide && s.active && s.cause !== "admin" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || suspNote.trim().length < 10}
                    onClick={() =>
                      void run(`/api/admin/suspensions/${s.id}`, {
                        action: "lift",
                        note: suspNote.trim(),
                        from_contest: !!s.contested_at && !s.contest_outcome,
                      })
                    }
                  >
                    {ta.lift}
                  </Button>
                  {s.contested_at && !s.contest_outcome && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || suspNote.trim().length < 10}
                      onClick={() =>
                        void run(`/api/admin/suspensions/${s.id}`, {
                          action: "maintain",
                          note: suspNote.trim(),
                          from_contest: true,
                        })
                      }
                    >
                      {ta.maintainContest}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {d.future_engagements.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">{ta.futureTitle}</p>
              <p className="text-xs text-muted-foreground">{ta.futureHint}</p>
              <ul className="text-xs">
                {d.future_engagements.map((f) => (
                  <li key={f.mission_day_id}>
                    {f.job_title} · {doualaDateTime(f.starts_at, locale)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
