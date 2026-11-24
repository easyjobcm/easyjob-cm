"use client";

import * as React from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh, useServerNow } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import type { AbsenceFinding } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 (SAN-08) — constat d'absence vu par une partie. Échéances
 * calculées par le serveur à partir des notifications (72 h de réponse,
 * 7 jours de recours) ; une notification créée ne vaut pas notification
 * lue. Le candidat répond pendant 72 h ; chaque partie peut ensuite
 * transmettre un nouvel élément, sans réouverture ni nouveau délai.
 * L'entreprise ne voit que l'issue. Aucune sanction, aucun montant.
 */
export function AbsenceFindingPanel({
  missionId,
  viewer,
}: {
  missionId: string;
  viewer: "candidate" | "company";
}) {
  const { t, locale } = useI18n();
  const now = useServerNow();
  const url = `/api/absence-findings?mission_id=${missionId}`;
  const { data, mutate } = useSWR<AbsenceFinding[]>(url, async (u: string) => {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) return [];
    return (
      ((await res.json()) as { findings?: AbsenceFinding[] }).findings ?? []
    );
  });
  useLiveRefresh(["incidents", "missions"], () => void mutate());
  if (!data || data.length === 0) return null;
  return (
    <>
      {data.map((f) => (
        <FindingCard
          key={f.id}
          f={f}
          viewer={viewer}
          nowMs={now()}
          locale={locale}
          onChanged={() => void mutate()}
          t={t.interventions.finding}
          errors={t.interventions.errors as Record<string, string>}
        />
      ))}
    </>
  );
}

type Tf = ReturnType<typeof useI18n>["t"]["interventions"]["finding"];

function FindingCard({
  f,
  viewer,
  nowMs,
  locale,
  onChanged,
  t,
  errors,
}: {
  f: AbsenceFinding;
  viewer: "candidate" | "company";
  nowMs: number;
  locale: "fr" | "en";
  onChanged: () => void;
  t: Tf;
  errors: Record<string, string>;
}) {
  const [text, setText] = React.useState("");
  const [element, setElement] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canAnswer =
    viewer === "candidate" &&
    f.status !== "decided" &&
    nowMs <= Date.parse(f.candidate_due_at);
  const canReview =
    f.status === "decided" &&
    !f.review_requested_at &&
    !!f.review_deadline &&
    nowMs < Date.parse(f.review_deadline);

  const fail = (code?: string) =>
    setError((code && errors[code]) ?? errors.generic);
  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const b = (await res?.json().catch(() => ({}))) as
      | { code?: string }
      | undefined;
    setBusy(false);
    if (!res?.ok) {
      fail(b?.code);
      return false;
    }
    onChanged();
    return true;
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    const res = await fetch(`/api/absence-findings/${f.id}/evidence`, {
      method: "POST",
      body: form,
    }).catch(() => null);
    const b = (await res?.json().catch(() => ({}))) as
      | { code?: string }
      | undefined;
    setBusy(false);
    if (!res?.ok) return fail(b?.code);
    toast({
      variant: "success",
      title: canAnswer ? t.uploaded : t.elementSent,
    });
    onChanged();
  };

  return (
    <Card data-testid="absence-finding" data-status={f.status}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">{t.title}</CardTitle>
        <Badge
          variant={f.outcome === "established" ? "destructive" : "secondary"}
          data-testid="absence-finding-outcome"
        >
          {f.outcome
            ? t.outcomes[f.outcome]
            : f.status === "proposed"
              ? t.statusProposed
              : t.statusInstruction}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {doualaDateTime(f.day_starts_at, locale)} · {t.notFault}
        </p>
        {f.outcome === "not_established" && (
          <p data-testid="absence-finding-not-established-note">
            {t.notEstablishedNote}
          </p>
        )}
        {f.outcome && (
          <p
            className="text-muted-foreground"
            data-testid="absence-finding-no-effect"
          >
            {t.noEffect}
          </p>
        )}
        {f.decisions.length > 0 && (
          <div data-testid="absence-finding-history">
            <p className="font-medium">{t.history}</p>
            <ul className="text-xs text-muted-foreground">
              {f.decisions.map((d, i) => (
                <li key={i}>
                  {(d.kind === "decided" ? t.historyDecided : t.historyReview)
                    .replace("{date}", doualaDateTime(d.at, locale))
                    .replace(
                      "{outcome}",
                      d.kind === "decided"
                        ? ((t.outcomes as Record<string, string>)[
                            d.outcome ?? ""
                          ] ?? "")
                        : ((t.reviewOutcomes as Record<string, string>)[
                            d.outcome ?? ""
                          ] ?? ""),
                    )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {viewer === "candidate" && (
          <>
            {f.candidate_statement && (
              <p className="whitespace-pre-line break-words rounded-lg bg-muted p-2">
                {f.candidate_statement}
              </p>
            )}
            {(f.evidence?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {t.pieces.replace("{count}", String(f.evidence!.length))}
              </p>
            )}
            {f.decision_note && (
              <p className="whitespace-pre-line break-words text-muted-foreground">
                {f.decision_note}
              </p>
            )}
            {f.status !== "decided" && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="absence-finding-due"
              >
                {canAnswer
                  ? t.dueCandidate.replace(
                      "{date}",
                      doualaDateTime(f.candidate_due_at, locale),
                    )
                  : t.closed}
                {" · "}
                {t.notifiedAt.replace(
                  "{date}",
                  doualaDateTime(f.candidate_notified_at, locale),
                )}
              </p>
            )}
            {canAnswer && (
              <div className="space-y-2">
                <Textarea
                  aria-label={t.yourAnswer}
                  placeholder={t.yourAnswer}
                  value={text}
                  maxLength={2000}
                  onChange={(e) => setText(e.target.value)}
                  data-testid="absence-finding-answer"
                />
                <Button
                  size="sm"
                  disabled={busy || text.trim().length < 10}
                  onClick={async () => {
                    if (
                      await post(`/api/absence-findings/${f.id}/answer`, {
                        statement: text.trim(),
                      })
                    ) {
                      setText("");
                      toast({ variant: "success", title: t.answered });
                    }
                  }}
                  data-testid="absence-finding-answer-send"
                >
                  {t.answer}
                </Button>
              </div>
            )}
          </>
        )}
        {f.review_outcome && (
          <p className="text-muted-foreground">
            {t.reviewOutcomes[f.review_outcome]}
          </p>
        )}
        {f.review_requested_at && !f.review_outcome && (
          <p className="text-muted-foreground">{t.reviewSent}</p>
        )}
        {canReview && (
          <div className="space-y-2">
            <p
              className="text-xs text-muted-foreground"
              data-testid="absence-finding-review-until"
            >
              {t.reviewUntil.replace(
                "{date}",
                doualaDateTime(f.review_deadline!, locale),
              )}
              {f.decision_notified_at &&
                ` · ${t.notifiedAt.replace("{date}", doualaDateTime(f.decision_notified_at, locale))}`}
            </p>
            <Textarea
              aria-label={t.reviewRequest}
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              data-testid="absence-finding-review-text"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || text.trim().length < 10}
              onClick={async () => {
                if (
                  await post(`/api/absence-findings/${f.id}/review`, {
                    statement: text.trim(),
                  })
                ) {
                  setText("");
                  toast({ variant: "success", title: t.reviewSent });
                }
              }}
              data-testid="absence-finding-review-send"
            >
              {t.reviewRequest}
            </Button>
          </div>
        )}
        {/* Nouvel élément : à tout moment, sans réouverture ni délai. */}
        <div
          className="space-y-2 border-t pt-3"
          data-testid="absence-finding-element"
        >
          <p className="font-medium">{t.elementTitle}</p>
          <p className="text-xs text-muted-foreground">{t.elementHint}</p>
          {f.my_elements > 0 && (
            <p className="text-xs text-muted-foreground">
              {t.elementCount.replace("{count}", String(f.my_elements))}
            </p>
          )}
          <Textarea
            aria-label={t.elementTitle}
            value={element}
            maxLength={2000}
            onChange={(e) => setElement(e.target.value)}
            data-testid="absence-finding-element-text"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || element.trim().length < 10}
              onClick={async () => {
                if (
                  await post(`/api/absence-findings/${f.id}/elements`, {
                    text: element.trim(),
                  })
                ) {
                  setElement("");
                  toast({ variant: "success", title: t.elementSent });
                }
              }}
              data-testid="absence-finding-element-send"
            >
              {t.elementSend}
            </Button>
            <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm">
              {t.upload}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
                data-testid="absence-finding-upload"
              />
            </label>
          </div>
        </div>
        {error && (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
