"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import {
  openDayIds,
  type AbsenceFinding,
  type AdminEngagementRequest,
  type OpenableAbsence,
} from "@/lib/validations/support-intervention";

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  return res.ok ? ((await res.json()) as T) : null;
}

function usePost(onDone: () => void) {
  const { t } = useI18n();
  const errors = t.interventions.errors as Record<string, string>;
  const [busy, setBusy] = React.useState(false);
  const post = async (url: string, body: unknown) => {
    setBusy(true);
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
      toast({
        variant: "destructive",
        title: (b?.code && errors[b.code]) ?? errors.generic,
      });
      onDone();
      return false;
    }
    onDone();
    return true;
  };
  return { busy, post };
}

/**
 * Lot 17d-3 — file du support : retraits ciblés (ANN-17), tâches et
 * demandes liées à une suspension (ANN-18), constats d'absence (SAN-08).
 * Lecture et instruction : tout admin actif ; décisions : ops et fondateur.
 */
export function InterventionsAdminClient({
  canDecide,
}: {
  canDecide: boolean;
}) {
  const { t } = useI18n();
  const ta = t.interventions.admin;
  const req = useSWR("/api/admin/engagement-requests", (u: string) =>
    getJson<{ requests: AdminEngagementRequest[] }>(u),
  );
  const fin = useSWR("/api/admin/absence-findings", (u: string) =>
    getJson<{ findings: AbsenceFinding[]; openable: OpenableAbsence[] }>(u),
  );
  const reload = () => {
    void req.mutate();
    void fin.mutate();
  };
  useLiveRefresh(["admin:incidents", "admin:account"], reload);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Link
        href="/admin/dashboard"
        className="inline-flex items-center gap-1 text-sm text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.common.back}
      </Link>
      <h1 className="text-xl font-bold">{ta.title}</h1>
      {!canDecide && (
        <p className="text-sm text-muted-foreground">{ta.readOnly}</p>
      )}
      <section className="space-y-3" data-testid="admin-engagement-requests">
        <h2 className="text-lg font-semibold">{ta.requestsTitle}</h2>
        {(req.data?.requests ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{ta.empty}</p>
        )}
        {(req.data?.requests ?? []).map((r) => (
          <RequestCard key={r.id} r={r} canDecide={canDecide} onDone={reload} />
        ))}
      </section>
      <section className="space-y-3" data-testid="admin-absence-findings">
        <h2 className="text-lg font-semibold">{ta.findingsTitle}</h2>
        <OpenableList items={fin.data?.openable ?? []} onDone={reload} />
        {(fin.data?.findings ?? []).map((f) => (
          <FindingAdminCard
            key={f.id}
            f={f}
            canDecide={canDecide}
            onDone={reload}
          />
        ))}
      </section>
    </div>
  );
}

function RequestCard({
  r,
  canDecide,
  onDone,
}: {
  r: AdminEngagementRequest;
  canDecide: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.interventions.admin;
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [note, setNote] = React.useState("");
  const { busy, post } = usePost(onDone);
  const open = new Set(openDayIds(r.days));
  const chosen = [...selected].filter((id) => open.has(id));
  const decide = async (decision: "accept" | "refuse") => {
    if (
      await post(`/api/admin/engagement-requests/${r.id}/decision`, {
        decision,
        day_ids: decision === "accept" ? chosen : [],
        note: note.trim(),
      })
    ) {
      setNote("");
      setSelected(new Set());
    }
  };
  return (
    <Card
      data-testid="admin-engagement-request"
      data-kind={r.kind}
      data-status={r.status}
    >
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {ta.kinds[r.kind]}
            {r.reexamination_of ? ` · ${ta.reexamOf}` : ""}
          </CardTitle>
          <Badge variant={r.status === "pending" ? "warning" : "secondary"}>
            {t.interventions.states[r.status]}
          </Badge>
        </div>
        <p className="break-words text-xs text-muted-foreground">
          {r.candidate_name}
          {r.job_title ? ` · ${r.job_title}` : ""}
          {r.company_name ? ` · ${r.company_name}` : ""} ·{" "}
          {doualaDateTime(r.created_at, locale)}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {r.reason && (
          <p className="break-words">
            <span className="font-medium">
              {r.kind === "targeted_removal" ? ta.reason : ta.message} :
            </span>{" "}
            {r.reason}
          </p>
        )}
        {r.suspension && (
          <p className="text-xs text-muted-foreground">
            {ta.suspension
              .replace("{cause}", r.suspension.cause)
              .replace("{active}", r.suspension.active ? ta.active : ta.lifted)}
          </p>
        )}
        <ul className="space-y-1">
          {r.days.map((d) => (
            <li key={d.mission_day_id}>
              <label className="flex flex-wrap items-center gap-2">
                {r.status === "pending" && canDecide && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    disabled={d.state !== "open"}
                    checked={selected.has(d.mission_day_id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(d.mission_day_id)) n.delete(d.mission_day_id);
                        else n.add(d.mission_day_id);
                        return n;
                      })
                    }
                    data-testid="admin-request-day"
                  />
                )}
                <span className="break-words">
                  {d.job_title} · {doualaDateTime(d.starts_at, locale)}
                </span>
                {d.state && (
                  <Badge variant="outline">{ta.dayStates[d.state]}</Badge>
                )}
              </label>
            </li>
          ))}
        </ul>
        {r.status !== "pending" && r.decision_note && (
          <p className="break-words text-xs text-muted-foreground">
            {ta.decided.replace("{state}", t.interventions.states[r.status])} ·{" "}
            {r.decision_note}
          </p>
        )}
        {r.status === "pending" && canDecide && (
          <div className="space-y-2">
            <Textarea
              aria-label={ta.note}
              placeholder={ta.note}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              data-testid="admin-request-note"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  busy || chosen.length === 0 || note.trim().length < 10
                }
                onClick={() => void decide("accept")}
                data-testid="admin-request-accept"
              >
                {ta.accept}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || note.trim().length < 10}
                onClick={() => void decide("refuse")}
                data-testid="admin-request-refuse"
              >
                {ta.refuse}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenableList({
  items,
  onDone,
}: {
  items: OpenableAbsence[];
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.interventions.admin;
  const { busy, post } = usePost(onDone);
  if (items.length === 0) return null;
  return (
    <Card data-testid="admin-openable-absences">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{ta.openable}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {items.map((i) => (
          <div
            key={i.incident_id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="min-w-0 break-words">
              {i.job_title} · {doualaDateTime(i.starts_at, locale)} ·{" "}
              {ta.realization.replace(
                "{state}",
                (ta.realizationStates as Record<string, string>)[
                  i.realization.state
                ] ?? i.realization.state,
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void post("/api/admin/absence-findings", {
                  incident_id: i.incident_id,
                })
              }
              data-testid="admin-open-finding"
            >
              {ta.openFinding}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FindingAdminCard({
  f,
  canDecide,
  onDone,
}: {
  f: AbsenceFinding;
  canDecide: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.interventions.admin;
  const tf = t.interventions.finding;
  const [note, setNote] = React.useState("");
  const [instruction, setInstruction] = React.useState("");
  const [outcome, setOutcome] = React.useState<
    "established" | "not_established"
  >("not_established");
  const { busy, post } = usePost(onDone);
  const base = `/api/admin/absence-findings/${f.id}`;
  const evidenceLink = async (id: string) => {
    const r = await getJson<{ url: string }>(`/api/admin/case-evidence/${id}`);
    if (r?.url) window.open(r.url, "_blank", "noopener");
  };
  const ok = note.trim().length >= 10;
  const states = ta.realizationStates as Record<string, string>;
  const elements = (f.events ?? []).filter(
    (e) => e.kind === "new_element" || e.kind === "instruction_note",
  );
  return (
    <Card data-testid="admin-absence-finding" data-status={f.status}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {f.candidate_name} · {f.job_title}
          </CardTitle>
          <Badge
            variant={f.outcome === "established" ? "destructive" : "secondary"}
          >
            {f.outcome
              ? tf.outcomes[f.outcome]
              : f.status === "proposed"
                ? tf.statusProposed
                : tf.statusInstruction}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {doualaDateTime(f.day_starts_at, locale)} ·{" "}
          {ta.realization.replace(
            "{state}",
            states[f.realization?.state ?? "clear"] ??
              f.realization?.state ??
              "",
          )}{" "}
          ·{" "}
          {ta.candidateDue.replace(
            "{date}",
            doualaDateTime(f.candidate_due_at, locale),
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">{ta.candidateStatement}</p>
        <p className="whitespace-pre-line break-words text-muted-foreground">
          {f.candidate_statement ?? ta.noStatement}
        </p>
        <div className="flex flex-wrap gap-2">
          {(f.evidence ?? []).map((e, n) => (
            <Button
              key={e.id}
              size="sm"
              variant="outline"
              onClick={() => void evidenceLink(e.id)}
            >
              {ta.evidence.replace("{n}", String(n + 1))}
            </Button>
          ))}
        </div>
        {f.proposed_outcome && f.status === "proposed" && (
          <p className="break-words text-xs">
            {ta.proposal.replace("{outcome}", tf.outcomes[f.proposed_outcome])}{" "}
            · {f.proposed_note}
          </p>
        )}
        {f.decision_note && (
          <p className="break-words text-xs text-muted-foreground">
            {f.decision_note}
          </p>
        )}
        {f.outcome === "not_established" && (
          <p className="text-xs">{tf.notEstablishedNote}</p>
        )}
        {f.review_requested_at && f.review_party && (
          <p className="break-words text-xs">
            {ta.reviewNote
              .replace("{party}", ta.parties[f.review_party])
              .replace("{note}", f.review_note ?? "")}
          </p>
        )}
        {f.decisions.length > 0 && (
          <div data-testid="admin-finding-history">
            <p className="font-medium">{ta.history}</p>
            <ul className="text-xs text-muted-foreground">
              {f.decisions.map((d, i) => (
                <li key={i}>
                  {(d.kind === "decided" ? tf.historyDecided : tf.historyReview)
                    .replace("{date}", doualaDateTime(d.at, locale))
                    .replace(
                      "{outcome}",
                      d.kind === "decided"
                        ? ((tf.outcomes as Record<string, string>)[
                            d.outcome ?? ""
                          ] ?? "")
                        : ((tf.reviewOutcomes as Record<string, string>)[
                            d.outcome ?? ""
                          ] ?? ""),
                    )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {elements.length > 0 && (
          <div data-testid="admin-finding-elements">
            <p className="font-medium">{ta.elements}</p>
            <ul className="space-y-1 text-xs">
              {elements.map((e, i) => (
                <li key={i} className="break-words">
                  {doualaDateTime(e.created_at, locale)} · {e.actor_role} ·{" "}
                  {e.note ?? ""}
                  {e.evidence_id && (
                    <Button
                      size="sm"
                      variant="link"
                      className="h-auto p-0 pl-1"
                      onClick={() => void evidenceLink(e.evidence_id!)}
                    >
                      {ta.evidence.replace("{n}", String(i + 1))}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Instruction : tout admin actif, support compris. */}
        <div className="space-y-2">
          <Textarea
            aria-label={ta.noteLabel}
            placeholder={ta.noteLabel}
            value={instruction}
            maxLength={2000}
            onChange={(e) => setInstruction(e.target.value)}
            data-testid="admin-finding-instruction"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || instruction.trim().length < 10}
            onClick={async () =>
              (await post(`${base}/notes`, { note: instruction.trim() })) &&
              setInstruction("")
            }
            data-testid="admin-finding-instruction-send"
          >
            {ta.noteSend}
          </Button>
        </div>
        {canDecide &&
          (f.status !== "decided" ||
            (f.review_requested_at && !f.review_outcome)) && (
            <div className="space-y-2">
              {f.status === "instruction" && (
                <select
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  aria-label={ta.outcome}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                  data-testid="admin-finding-outcome"
                >
                  <option value="not_established">
                    {tf.outcomes.not_established}
                  </option>
                  <option value="established">{tf.outcomes.established}</option>
                </select>
              )}
              <Textarea
                aria-label={ta.note}
                placeholder={ta.note}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                data-testid="admin-finding-note"
              />
              <div className="flex flex-wrap gap-2">
                {f.status === "instruction" && (
                  <Button
                    size="sm"
                    disabled={busy || !ok}
                    onClick={async () =>
                      (await post(`${base}/proposal`, {
                        outcome,
                        note: note.trim(),
                        expected_revision: f.revision ?? 0,
                      })) && setNote("")
                    }
                    data-testid="admin-finding-propose"
                  >
                    {ta.propose}
                  </Button>
                )}
                {f.status === "proposed" && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy || !ok}
                      onClick={async () =>
                        (await post(`${base}/validation`, {
                          approve: true,
                          note: note.trim(),
                          expected_revision: f.revision ?? 0,
                        })) && setNote("")
                      }
                      data-testid="admin-finding-approve"
                    >
                      {ta.approve}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !ok}
                      onClick={async () =>
                        (await post(`${base}/validation`, {
                          approve: false,
                          note: note.trim(),
                          expected_revision: f.revision ?? 0,
                        })) && setNote("")
                      }
                    >
                      {ta.reject}
                    </Button>
                  </>
                )}
                {f.status === "decided" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !ok}
                      onClick={async () =>
                        (await post(`${base}/review`, {
                          outcome: "maintained",
                          note: note.trim(),
                        })) && setNote("")
                      }
                    >
                      {ta.maintain}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !ok}
                      onClick={async () =>
                        (await post(`${base}/review`, {
                          outcome: "overturned",
                          note: note.trim(),
                        })) && setNote("")
                      }
                    >
                      {ta.overturn}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        <p className="text-xs text-muted-foreground">{tf.noEffect}</p>
      </CardContent>
    </Card>
  );
}
