"use client";

import * as React from "react";
import useSWR from "swr";
import { LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import type {
  SupportDay,
  SupportRequest,
} from "@/lib/validations/support-intervention";

type Payload = {
  suspended: boolean;
  days: SupportDay[];
  requests: SupportRequest[];
};

/**
 * Lot 17d-3 (ANN-18) — candidat suspendu : « Demander l'annulation au
 * support ». L'ancien désistement est fermé en base pour un compte
 * suspendu ; cette demande ne produit aucun manquement. La décision
 * revient à un ops ou au fondateur, qui revérifie la suspension.
 */
export function SupportCancellationPanel() {
  const { t, locale } = useI18n();
  const ts = t.interventions.suspended;
  const { data, mutate } = useSWR<Payload | null>(
    "/api/support-cancellation",
    async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      return res.ok ? ((await res.json()) as Payload) : null;
    },
  );
  useLiveRefresh(["missions", "account"], () => void mutate());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(crypto.randomUUID());

  if (!data?.suspended) return null;
  const choosable = data.days.filter((d) => !d.requested);

  const submit = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/support-cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: requestId.current,
        day_ids: [...selected].filter((id) =>
          choosable.some((d) => d.mission_day_id === id),
        ),
        message: message.trim() || null,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as
      | { code?: string }
      | undefined;
    setBusy(false);
    if (!res?.ok) {
      if (res) requestId.current = crypto.randomUUID();
      setError(
        (body?.code &&
          (t.interventions.errors as Record<string, string>)[body.code]) ??
          t.interventions.errors.generic,
      );
      void mutate();
      return;
    }
    toast({ variant: "success", title: ts.sent });
    setSelected(new Set());
    setMessage("");
    requestId.current = crypto.randomUUID();
    void mutate();
  };

  return (
    <Card data-testid="support-cancellation">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="h-4 w-4" aria-hidden />
          {ts.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{ts.intro}</p>
        {data.requests.map((r) => (
          <p
            key={r.id}
            className="text-xs text-muted-foreground"
            data-testid="support-cancellation-request"
            data-status={r.status}
          >
            {ts.requestLine
              .replace("{date}", doualaDateTime(r.created_at, locale))
              .replace("{state}", t.interventions.states[r.status])}
          </p>
        ))}
        {data.days.length === 0 ? (
          <p className="text-muted-foreground">{ts.none}</p>
        ) : (
          <ul className="space-y-2">
            {data.days.map((d) => (
              <li key={d.mission_day_id}>
                <label className="flex items-center gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    disabled={d.requested}
                    checked={selected.has(d.mission_day_id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(d.mission_day_id)) n.delete(d.mission_day_id);
                        else n.add(d.mission_day_id);
                        return n;
                      })
                    }
                    data-testid="support-cancellation-day"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {d.job_title} · {doualaDateTime(d.starts_at, locale)}
                  </span>
                  {d.requested && (
                    <Badge variant="secondary">{ts.requested}</Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {choosable.length > 0 && (
          <>
            <div className="space-y-1">
              <Label htmlFor="support-cancellation-message">{ts.message}</Label>
              <Textarea
                id="support-cancellation-message"
                value={message}
                maxLength={1000}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              disabled={busy || selected.size === 0}
              onClick={() => void submit()}
              data-testid="support-cancellation-send"
            >
              {ts.send}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
