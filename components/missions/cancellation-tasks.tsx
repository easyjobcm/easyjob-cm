"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { z } from "zod";
import { motion } from "framer-motion";
import { Ban, ChevronRight, Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { doualaDateTime } from "@/lib/utils/douala-time";
import { cancellationSchema } from "@/lib/validations/cancellation";

const suspensionSchema = z.object({
  id: z.string().uuid(),
  cause: z.enum(["cancellation_cycle", "fraud"]),
  cycle: z.number().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  active: z.boolean(),
  events: z.array(z.string()),
  contested_at: z.string().nullable(),
  contest_outcome: z.string().nullable(),
});
type Suspension = z.infer<typeof suspensionSchema>;

const fetchJson = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/**
 * Lots 17b–17c — dans Tâches : suspension en cours (motif, durée, faits
 * retenus, contestation) et annulations dont le justificatif est attendu.
 * Ouvert pendant une suspension : dossiers et contestations restent
 * accessibles.
 */
export function CancellationTasks() {
  const { t } = useI18n();
  const tc = t.cancellations;
  const { data: susp, mutate: mutateSusp } = useSWR(
    "/api/account/suspensions",
    fetchJson,
  );
  const { data: mine, mutate: mutateMine } = useSWR(
    "/api/cancellations",
    fetchJson,
  );
  useLiveRefresh(["account", "missions"], () => {
    void mutateSusp();
    void mutateMine();
  });

  const suspensions: Suspension[] = (
    (susp?.suspensions ?? []) as unknown[]
  ).flatMap((s) => {
    const p = suspensionSchema.safeParse(s);
    return p.success && p.data.active ? [p.data] : [];
  });
  const awaiting = ((mine?.cancellations ?? []) as unknown[]).flatMap((c) => {
    const p = cancellationSchema.safeParse(c);
    return p.success && p.data.status === "awaiting_evidence" ? [p.data] : [];
  });
  if (suspensions.length === 0 && awaiting.length === 0) return null;

  return (
    <div className="mb-4 space-y-3" data-testid="cancellation-tasks">
      {suspensions.map((s) => (
        <SuspensionCard key={s.id} s={s} onChanged={() => void mutateSusp()} />
      ))}
      {awaiting.length > 0 && (
        <Card className="border-primary/30">
          <CardContent className="space-y-2 p-4">
            <h2 className="font-semibold text-foreground">{tc.tasksTitle}</h2>
            {awaiting.map((c) => {
              const missionId = c.days?.[0]?.mission_id;
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-2 text-sm">
                    <Paperclip
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span>
                      {tc.tasksEvidence.replace("{job}", c.job_title ?? "")}
                    </span>
                  </div>
                  {missionId && (
                    <motion.div whileTap={{ scale: 0.97 }}>
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        className="w-full sm:w-auto"
                      >
                        <Link href={`/missions/${missionId}`}>
                          {tc.retry}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Link>
                      </Button>
                    </motion.div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SuspensionCard({
  s,
  onChanged,
}: {
  s: Suspension;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const tc = t.cancellations;
  const ts = tc.suspensions;
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const send = async () => {
    setBusy(true);
    const res = await fetch(`/api/account/suspensions/${s.id}/contest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast({ variant: "destructive", title: tc.errors.generic });
      return;
    }
    setOpen(false);
    onChanged();
  };
  return (
    <Card
      className="border-destructive/40 bg-destructive/5"
      data-testid="suspension-card"
    >
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex items-start gap-2">
          <Ban
            className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <h2 className="font-semibold text-foreground">{ts.title}</h2>
            <p>
              {s.cause === "fraud"
                ? ts.fraud
                : s.cycle === 3
                  ? ts.cycleFinal
                  : ts.cycle}
            </p>
            <p className="text-muted-foreground">
              {s.ends_at
                ? ts.until.replace("{date}", doualaDateTime(s.ends_at, locale))
                : ts.noEnd}
            </p>
            {s.events.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {ts.events.replace(
                  "{dates}",
                  s.events.map((e) => doualaDateTime(e, locale)).join(", "),
                )}
              </p>
            )}
            {s.contested_at && (
              <p className="text-xs text-muted-foreground">
                {s.contest_outcome === "maintained"
                  ? ts.maintained
                  : ts.contested.replace(
                      "{date}",
                      doualaDateTime(s.contested_at, locale),
                    )}
              </p>
            )}
          </div>
        </div>
        {!s.contested_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            data-testid="suspension-contest"
          >
            {ts.contest}
          </Button>
        )}
        {open && (
          <div className="space-y-2">
            <Label htmlFor={`contest-${s.id}`}>{ts.contestNote}</Label>
            <Textarea
              id={`contest-${s.id}`}
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || note.trim().length < 10}
              onClick={() => void send()}
            >
              {ts.contestSend}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
