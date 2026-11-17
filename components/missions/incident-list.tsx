"use client";

import { useEffect, useRef, useState } from "react";
import { Flag, Paperclip, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { formatDayDate } from "@/lib/jobs/schedule";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { useLatestRequest, useLiveRefresh } from "@/lib/realtime/provider";
import { incidentStatementSchema } from "@/lib/validations/incident";
import type { Database } from "@/lib/database.types";

type Row =
  Database["public"]["Functions"]["mission_incidents_for_party"]["Returns"][number];
export type PartyIncident = Omit<
  Row,
  "late_minutes" | "outcome" | "decision_note" | "decided_at" | "closed_reason"
> & {
  late_minutes: number | null;
  outcome: "established" | "not_established" | null;
  decision_note: string | null;
  decided_at: string | null;
  closed_reason: string | null;
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
      {incident.outcome && (
        <div
          className="rounded-md border border-primary/30 bg-primary/5 p-2"
          data-testid="incident-decision"
        >
          <p className="flex items-center gap-1 font-medium">
            <Scale className="h-4 w-4" aria-hidden />
            {ti.outcome[incident.outcome]}
          </p>
          {incident.decision_note && (
            <p className="whitespace-pre-wrap break-words">
              {ti.decisionNote.replace("{note}", incident.decision_note)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {ti.decisionScope}
          </p>
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
