"use client";

import * as React from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { REPLACEMENT_EMAIL_CONSENT_VERSION } from "@/lib/validations/email-preference";

type Preference = {
  enabled: boolean;
  enabledAt: string | null;
  emailConfirmed: boolean;
  deliveryActive: boolean;
};

/** Préférence absente (compte entreprise, 403) : la carte n'est pas affichée. */
const fetcher = async (url: string): Promise<Preference | null> => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 403 || res.status === 401) return null;
  if (!res.ok) throw new Error("failed");
  return res.json();
};

/**
 * Lot 17d-4b (ANN-21, `[UV]` 2026-11-26) — activation explicite des alertes
 * de remplacement par e-mail (case à cocher, texte versionné), désactivation
 * en un geste. Tant que l'envoi réel n'est pas en service, la carte le dit.
 */
export function ReplacementEmailPreference() {
  const { t, locale } = useI18n();
  const tr = t.profile.notificationCenter.replacementEmail;
  const reduce = useReducedMotion();
  const { data, error, mutate } = useSWR(
    "/api/me/replacement-email-alerts",
    fetcher,
  );
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  if (data === null) return null;

  const save = async (enabled: boolean) => {
    if (busy) return;
    if (enabled && !consent) {
      setMessage(tr.consentRequired);
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/me/replacement-email-alerts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        enabled
          ? { enabled: true, consentVersion: REPLACEMENT_EMAIL_CONSENT_VERSION }
          : { enabled: false },
      ),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setMessage(
        body?.code === "email_missing"
          ? tr.noEmail
          : body?.code === "consent_required"
            ? tr.consentRequired
            : tr.error,
      );
      return;
    }
    setConsent(false);
    toast({
      variant: "success",
      title: enabled ? tr.enabledToast : tr.disabledToast,
    });
    await mutate();
  };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="replacement-email-preference"
    >
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm font-semibold text-foreground">
                {tr.title}
              </p>
            </div>
            {data && (
              <Badge
                variant={data.enabled ? "success" : "secondary"}
                data-testid="replacement-email-status"
              >
                {data.enabled ? tr.statusOn : tr.statusOff}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{tr.description}</p>
          {error && <p className="text-sm text-destructive">{tr.error}</p>}
          {data && !data.deliveryActive && (
            <p
              className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground"
              data-testid="replacement-email-not-active"
            >
              {tr.notActive}
            </p>
          )}
          {data?.enabled && data.enabledAt && (
            <p className="text-xs text-muted-foreground">
              {tr.since.replace("{date}", formatDate(data.enabledAt, locale))}
            </p>
          )}
          {data && !data.enabled && !data.emailConfirmed && (
            <p className="text-sm text-muted-foreground">{tr.noEmail}</p>
          )}
          {data && !data.enabled && data.emailConfirmed && (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => {
                  setConsent(v);
                  setMessage(null);
                }}
                aria-label={tr.consent}
                data-testid="replacement-email-consent"
              />
              <span>{tr.consent}</span>
            </label>
          )}
          {message && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="replacement-email-message"
            >
              {message}
            </p>
          )}
          {data && (data.enabled || data.emailConfirmed) && (
            <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button
                className="w-full"
                variant={data.enabled ? "outline" : "default"}
                disabled={busy || (!data.enabled && !consent)}
                onClick={() => void save(!data.enabled)}
                data-testid="replacement-email-toggle"
              >
                {data.enabled ? tr.disable : tr.enable}
              </Button>
            </motion.div>
          )}
          <p className="text-xs text-muted-foreground">{tr.inAppNote}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
