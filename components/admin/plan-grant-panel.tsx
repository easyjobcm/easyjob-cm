"use client";

import * as React from "react";
import useSWR from "swr";
import { Crown, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/ui/loading";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh, useServerNow } from "@/lib/realtime/provider";
import {
  doualaFullDateTime,
  doualaLocalInput,
  doualaLocalToIso,
} from "@/lib/utils/douala-time";
import {
  allowedPremiumOperations,
  PREMIUM_REASON_MAX,
  PREMIUM_REASON_MIN,
  type PremiumOperation,
} from "@/lib/validations/candidate-premium";

/** Textes du panneau (`t.admin.candidatePremium` ou `t.admin.companyPremium`). */
export interface PlanGrantTexts {
  title: string;
  plan: string;
  free: string;
  premium: string;
  until: string;
  since: string;
  unknown: string;
  endedOn: string;
  noPayment: string;
  readOnly: string;
  activate: string;
  extend: string;
  stop: string;
  operation: string;
  endLabel: string;
  reasonLabel: string;
  reasonHint: string;
  submit: string;
  history: string;
  noHistory: string;
  opActivate: string;
  opExtend: string;
  opStop: string;
  opRequalify?: string;
  by: string;
  periodLine: string;
  previousEnd: string;
  legacyLine?: string;
  requalifiedTo?: string;
  success: string;
  already: string;
  errors: { generic: string } & Record<string, string>;
}

export interface PlanGrantEntry {
  id: string;
  operation: PremiumOperation | "requalify";
  resulting_plan?: "free" | "premium";
  period_started_at: string | null;
  previous_ends_at: string | null;
  ends_at: string | null;
  legacy_plan?: string | null;
  legacy_expires_at?: string | null;
  reason: string;
  actor_role: string;
  actor_email: string | null;
  created_at: string;
}

export interface PlanGrantState {
  plan: "free" | "premium";
  premium_until: string | null;
  premium_started_at: string | null;
  history: PlanGrantEntry[];
}

interface PlanGrantPanelProps {
  /** Route GET (état) et POST (opération), revérifiée en base. */
  url: string;
  /** admin_ops / admin_founder : la RPC le revérifie en base. */
  canManage: boolean;
  texts: PlanGrantTexts;
  testId: string;
  parse: (raw: unknown) => PlanGrantState;
  refusal: (code: string | undefined) => { code: string } | null;
}

const DAY_MS = 86_400_000;

/**
 * Plan Premium attribué par l'équipe (lot 17a pour le candidat, ABO-07 pour
 * l'entreprise) : plan effectif, fin, historique ; activer, prolonger ou
 * arrêter avec un motif (ops et fondateur). Jamais un paiement.
 */
export function PlanGrantPanel({
  url,
  canManage,
  texts: tp,
  testId,
  parse,
  refusal,
}: PlanGrantPanelProps) {
  const { locale } = useI18n();
  const serverNow = useServerNow();

  const { data, error, isLoading, mutate } = useSWR<PlanGrantState>(
    url,
    async (k: string) => {
      const res = await fetch(k);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { premium?: unknown };
      return parse(body.premium);
    },
  );
  // Plan changé dans une autre session (signal admin « subscription »).
  useLiveRefresh(["admin:subscription"], () => void mutate());

  // Bascule à l'échéance exacte sur un écran ouvert (heure du serveur).
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (data?.plan !== "premium" || !data.premium_until) return;
    const ms = Date.parse(data.premium_until) - serverNow();
    if (!Number.isFinite(ms)) return;
    const handle = window.setTimeout(
      () => {
        setTick((n) => n + 1);
        void mutate();
      },
      Math.min(Math.max(0, ms) + 250, 2_147_483_647),
    );
    return () => window.clearTimeout(handle);
  }, [data, serverNow, mutate]);

  const effectivePlan: "free" | "premium" =
    data?.plan === "premium" &&
    data.premium_until &&
    Date.parse(data.premium_until) > serverNow()
      ? "premium"
      : "free";

  const fmt = (iso: string | null | undefined) =>
    iso ? doualaFullDateTime(iso, locale) : tp.unknown;

  const opLabel = (op: PlanGrantEntry["operation"]) =>
    op === "activate"
      ? tp.opActivate
      : op === "extend"
        ? tp.opExtend
        : op === "stop"
          ? tp.opStop
          : (tp.opRequalify ?? op);

  return (
    <Card className="border-border" data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-primary" />
          {tp.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !data ? (
          <LoadingSpinner />
        ) : error || !data ? (
          <p className="text-sm text-destructive">{tp.errors.generic}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">{tp.plan}</p>
                <p
                  className="mt-0.5 text-sm font-semibold"
                  data-testid="admin-premium-plan"
                >
                  {effectivePlan === "premium" ? tp.premium : tp.free}
                </p>
              </div>
              {effectivePlan === "premium" ? (
                <>
                  <div className="rounded-lg border border-border bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">{tp.since}</p>
                    <p className="mt-0.5 text-sm">
                      {fmt(data.premium_started_at)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">{tp.until}</p>
                    <p
                      className="mt-0.5 text-sm"
                      data-testid="admin-premium-until"
                    >
                      {fmt(data.premium_until)}
                    </p>
                  </div>
                </>
              ) : (
                data.premium_until && (
                  <p className="text-xs text-muted-foreground sm:col-span-2 sm:self-center">
                    {tp.endedOn.replace("{date}", fmt(data.premium_until))}
                  </p>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">{tp.noPayment}</p>

            {canManage ? (
              <PlanGrantForm
                key={`${effectivePlan}-${data.premium_until ?? "none"}`}
                url={url}
                plan={effectivePlan}
                premiumUntil={data.premium_until}
                texts={tp}
                refusal={refusal}
                onDone={() => void mutate()}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{tp.readOnly}</p>
            )}

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" />
                {tp.history}
              </p>
              {data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tp.noHistory}</p>
              ) : (
                <ul className="space-y-2" data-testid="admin-premium-history">
                  {data.history.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-lg border border-border p-2 text-sm"
                    >
                      <p className="font-medium">
                        {opLabel(h.operation)}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {fmt(h.created_at)} ·{" "}
                          {tp.by.replace(
                            "{who}",
                            h.actor_email ?? h.actor_role,
                          )}
                        </span>
                      </p>
                      {h.operation === "requalify" &&
                        tp.legacyLine &&
                        tp.requalifiedTo && (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {tp.legacyLine
                                .replace("{plan}", h.legacy_plan ?? "—")
                                .replace("{date}", fmt(h.legacy_expires_at))}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tp.requalifiedTo.replace(
                                "{plan}",
                                h.resulting_plan === "premium"
                                  ? tp.premium
                                  : tp.free,
                              )}
                            </p>
                          </>
                        )}
                      {(h.operation !== "requalify" || h.ends_at) && (
                        <p className="text-xs text-muted-foreground">
                          {tp.periodLine
                            .replace("{start}", fmt(h.period_started_at))
                            .replace("{end}", fmt(h.ends_at))}
                        </p>
                      )}
                      {h.previous_ends_at && h.operation !== "requalify" && (
                        <p className="text-xs text-muted-foreground">
                          {tp.previousEnd.replace(
                            "{date}",
                            fmt(h.previous_ends_at),
                          )}
                        </p>
                      )}
                      <p className="mt-1 break-words text-xs">{h.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanGrantForm({
  url,
  plan,
  premiumUntil,
  texts: tp,
  refusal,
  onDone,
}: {
  url: string;
  plan: "free" | "premium";
  premiumUntil: string | null;
  texts: PlanGrantTexts;
  refusal: (code: string | undefined) => { code: string } | null;
  onDone: () => void;
}) {
  const serverNow = useServerNow();
  const operations = allowedPremiumOperations(plan);

  const [operation, setOperation] = React.useState<PremiumOperation>(
    operations[0],
  );
  // Proposition par défaut : 30 jours après la fin actuelle ou maintenant
  // (simple pré-remplissage ; aucune durée commerciale n'est imposée).
  const [endLocal, setEndLocal] = React.useState(() => {
    const base =
      plan === "premium" && premiumUntil
        ? Date.parse(premiumUntil)
        : serverNow();
    return doualaLocalInput(base + 30 * DAY_MS);
  });
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Une clé par formulaire : une relance réseau rejoue la même opération.
  const requestId = React.useRef<string>(crypto.randomUUID());

  const trimmed = reason.trim();
  const endIso = operation === "stop" ? null : doualaLocalToIso(endLocal);
  const valid =
    trimmed.length >= PREMIUM_REASON_MIN &&
    trimmed.length <= PREMIUM_REASON_MAX &&
    (operation === "stop" || endIso !== null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId.current,
          operation,
          ends_at: endIso,
          expected_until: premiumUntil,
          reason: trimmed,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        result?: { already_applied?: boolean } | null;
      };
      if (!res.ok) {
        const refused = refusal(body.code);
        toast({
          variant: "destructive",
          title: (refused && tp.errors[refused.code]) ?? tp.errors.generic,
        });
        if (refused?.code === "premium_state_changed") onDone();
        return;
      }
      toast({
        variant: "success",
        title: body.result?.already_applied ? tp.already : tp.success,
      });
      requestId.current = crypto.randomUUID();
      setReason("");
      onDone();
    } catch {
      toast({ variant: "destructive", title: tp.errors.generic });
    } finally {
      setBusy(false);
    }
  };

  const label = (op: PremiumOperation) =>
    op === "activate" ? tp.activate : op === "extend" ? tp.extend : tp.stop;

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-border p-3"
      data-testid="admin-premium-form"
    >
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{tp.operation}</legend>
        <div className="flex flex-wrap gap-2">
          {operations.map((op) => (
            <Button
              key={op}
              type="button"
              size="sm"
              variant={operation === op ? "default" : "outline"}
              aria-pressed={operation === op}
              onClick={() => setOperation(op)}
              data-testid={`admin-premium-op-${op}`}
            >
              {label(op)}
            </Button>
          ))}
        </div>
      </fieldset>
      {operation !== "stop" && (
        <div className="space-y-1">
          <Label htmlFor="premium-end">{tp.endLabel}</Label>
          <Input
            id="premium-end"
            type="datetime-local"
            max="9999-12-31T23:59"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            data-testid="admin-premium-end"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="premium-reason">{tp.reasonLabel}</Label>
        <Textarea
          id="premium-reason"
          value={reason}
          maxLength={PREMIUM_REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          data-testid="admin-premium-reason"
        />
        <p className="text-xs text-muted-foreground">{tp.reasonHint}</p>
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={!valid || busy}
        data-testid="admin-premium-submit"
      >
        {busy ? <LoadingSpinner /> : tp.submit}
      </Button>
    </form>
  );
}
