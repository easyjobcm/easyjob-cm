"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle, PhoneCall, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import {
  doualaDateTime,
  doualaLocalInput,
  doualaLocalToIso,
} from "@/lib/utils/douala-time";
import {
  CONTACT_CHANNELS,
  CONTACT_RESULTS,
  dayConfirmationSchema,
  incidentContactSchema,
  type ContactChannel,
  type ContactEntryType,
  type ContactResult,
} from "@/lib/validations/incident";

export type IncidentContact = {
  id: string;
  entry_type: ContactEntryType;
  channel: ContactChannel;
  occurred_at: string;
  result: ContactResult;
  reference: string | null;
  note: string | null;
  recorded_by_role: string;
  created_at: string;
};

export type DayConfirmation = {
  id: string;
  contact_id: string;
  reason: string;
  confirmed_at: string;
  confirmed_by_role: string;
};

type ErrorCode = keyof ReturnType<typeof useI18n>["t"]["incidents"]["errors"];

const selectClass =
  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";

/**
 * Lot 15 — instruction d'un « code non remis » par le support :
 * contacts avec l'entreprise (demande distincte de la réponse obtenue,
 * référence privée, note interne) et confirmation de la journée sur la
 * réponse « travail confirmé ». La base revérifie le grade (compte actif),
 * l'échéance et la confirmation ; elle seule enregistre la réalisation.
 */
export function IncidentCompletionPanel({
  incidentId,
  kind,
  contacts,
  confirmation,
  canRecordContact,
  canConfirmDay,
  canConfirmRole,
  dayStarted,
  dayEndsAt,
  dayConfirmedAt,
  dayCompletedVia,
  serverNow,
  onChanged,
}: {
  incidentId: string;
  kind: "late" | "absence" | "code_not_received";
  contacts: IncidentContact[];
  confirmation: DayConfirmation | null;
  canRecordContact: boolean;
  canConfirmDay: boolean;
  canConfirmRole: boolean;
  dayStarted: boolean;
  dayEndsAt: string;
  dayConfirmedAt: string | null;
  dayCompletedVia: "code" | "support" | null;
  serverNow: number;
  onChanged: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const ti = t.incidents;
  const tc = ti.admin.contacts;
  const td = ti.admin.confirmDay;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  const [entryType, setEntryType] = useState<ContactEntryType>("request");
  const [channel, setChannel] = useState<ContactChannel>("phone");
  const [result, setResult] = useState<ContactResult>("no_answer");
  const [occurredAt, setOccurredAt] = useState(() =>
    doualaLocalInput(serverNow),
  );
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [contactError, setContactError] = useState<ErrorCode | null>(null);

  const confirmations = contacts.filter(
    (c) => c.entry_type === "response" && c.result === "work_confirmed",
  );
  const [contactId, setContactId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmError, setConfirmError] = useState<ErrorCode | null>(null);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const codeOf = (code: unknown): ErrorCode =>
    typeof code === "string" && code in ti.errors
      ? (code as ErrorCode)
      : "generic";

  async function post(path: string, body: unknown) {
    const res = await fetch(`/api/admin/incidents/${incidentId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      confirmation?: { already_confirmed?: boolean };
    };
    return { ok: !!res?.ok, json };
  }

  async function recordContact() {
    if (busyRef.current) return;
    const parsed = incidentContactSchema.safeParse({
      entry_type: entryType,
      channel,
      occurred_at: doualaLocalToIso(occurredAt) ?? "",
      result,
      reference,
      note,
    });
    if (!parsed.success) {
      setContactError(codeOf(parsed.error.issues[0]?.message));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setContactError(null);
    const { ok, json } = await post("contacts", parsed.data);
    if (ok) {
      toast({ title: tc.recorded, variant: "success" });
      setReference("");
      setNote("");
    } else setContactError(codeOf(json.code));
    await onChanged();
    busyRef.current = false;
    setBusy(false);
  }

  async function confirmDay() {
    if (busyRef.current) return;
    const parsed = dayConfirmationSchema.safeParse({
      contact_id: contactId ?? confirmations[0]?.id,
      reason,
    });
    if (!parsed.success) {
      setConfirmError(codeOf(parsed.error.issues[0]?.message));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setConfirmError(null);
    const { ok, json } = await post("confirm-day", parsed.data);
    if (ok) {
      toast({
        title: json.confirmation?.already_confirmed ? td.already : td.done,
        variant: "success",
      });
    } else setConfirmError(codeOf(json.code));
    await onChanged();
    busyRef.current = false;
    setBusy(false);
  }

  const results = CONTACT_RESULTS[entryType];

  return (
    <>
      <Card data-testid="admin-incident-contacts">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4" aria-hidden />
            {tc.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{tc.privateNotice}</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {contacts.length === 0 ? (
            <p className="text-muted-foreground">{tc.none}</p>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md bg-muted/50 p-2"
                  data-testid="admin-incident-contact"
                  data-entry-type={c.entry_type}
                  data-result={c.result}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {tc.entryType[c.entry_type]} · {tc.channel[c.channel]} ·{" "}
                    {doualaDateTime(c.occurred_at, locale)}
                  </p>
                  <p className="font-medium">{tc.result[c.result]}</p>
                  {c.reference && (
                    <p className="break-words">
                      {tc.referenceValue.replace("{ref}", c.reference)}
                    </p>
                  )}
                  {c.note && (
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {c.note}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {tc.by.replace("{role}", c.recorded_by_role)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canRecordContact && (
            <div className="space-y-3 border-t pt-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium">{tc.type}</span>
                  <select
                    className={selectClass}
                    value={entryType}
                    onChange={(e) => {
                      const next = e.target.value as ContactEntryType;
                      setEntryType(next);
                      setResult(CONTACT_RESULTS[next][0]);
                    }}
                    data-testid="contact-entry-type"
                  >
                    {(["request", "response"] as const).map((v) => (
                      <option key={v} value={v}>
                        {tc.entryType[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">{tc.channelLabel}</span>
                  <select
                    className={selectClass}
                    value={channel}
                    onChange={(e) =>
                      setChannel(e.target.value as ContactChannel)
                    }
                    data-testid="contact-channel"
                  >
                    {CONTACT_CHANNELS.map((v) => (
                      <option key={v} value={v}>
                        {tc.channel[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">{tc.resultLabel}</span>
                  <select
                    className={selectClass}
                    value={result}
                    onChange={(e) => setResult(e.target.value as ContactResult)}
                    data-testid="contact-result"
                  >
                    {results.map((v) => (
                      <option key={v} value={v}>
                        {tc.result[v]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium">{tc.occurredAt}</span>
                <input
                  type="datetime-local"
                  className={selectClass}
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  data-testid="contact-occurred-at"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">{tc.reference}</span>
                <input
                  type="text"
                  maxLength={500}
                  className={selectClass}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  data-testid="contact-reference"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">{tc.note}</span>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  className="mt-1"
                  data-testid="contact-note"
                />
              </label>
              {contactError && (
                <p className="text-destructive" role="alert">
                  {ti.errors[contactError]}
                </p>
              )}
              <motion.div whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void recordContact()}
                  disabled={busy}
                  data-testid="contact-submit"
                >
                  {tc.submit}
                </Button>
              </motion.div>
            </div>
          )}
        </CardContent>
      </Card>

      {kind === "code_not_received" && (
        <Card data-testid="admin-incident-confirm-day">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {td.title}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{td.hint}</p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {confirmation ? (
              <div data-testid="admin-day-confirmation">
                <p className="flex items-center gap-1 font-medium text-success">
                  <CheckCircle className="h-4 w-4" aria-hidden />
                  {td.confirmedAt.replace(
                    "{time}",
                    doualaDateTime(confirmation.confirmed_at, locale),
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {td.reasonLabel.replace("{reason}", confirmation.reason)}
                </p>
              </div>
            ) : dayConfirmedAt ? (
              <p className="font-medium">
                {td.already} ·{" "}
                {(dayCompletedVia === "support"
                  ? ti.admin.confirmedBySupportAt
                  : ti.admin.confirmedAt
                ).replace("{time}", doualaDateTime(dayConfirmedAt, locale))}
              </p>
            ) : !canConfirmRole ? (
              <p className="text-muted-foreground">{td.readOnly}</p>
            ) : !dayStarted ? (
              <p className="text-muted-foreground">{td.needsStart}</p>
            ) : serverNow < Date.parse(dayEndsAt) ? (
              <p className="text-muted-foreground">
                {td.notYet.replace("{time}", doualaDateTime(dayEndsAt, locale))}
              </p>
            ) : canConfirmDay ? (
              <>
                {confirmations.length === 0 ? (
                  <p className="text-muted-foreground">{td.noConfirmation}</p>
                ) : (
                  <label className="block">
                    <span className="text-xs font-medium">
                      {td.chooseContact}
                    </span>
                    <select
                      className={selectClass}
                      value={contactId ?? confirmations[0].id}
                      onChange={(e) => setContactId(e.target.value)}
                      data-testid="confirm-contact"
                    >
                      {confirmations.map((c) => (
                        <option key={c.id} value={c.id}>
                          {tc.channel[c.channel]} ·{" "}
                          {doualaDateTime(c.occurred_at, locale)} ·{" "}
                          {c.reference}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  placeholder={td.reason}
                  aria-label={td.reason}
                  data-testid="confirm-reason"
                />
                <p className="text-xs text-muted-foreground">{td.inquiry}</p>
                {confirmError && (
                  <p className="text-destructive" role="alert">
                    {ti.errors[confirmError]}
                  </p>
                )}
                <motion.div
                  whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                >
                  <Button
                    className="w-full sm:w-auto"
                    onClick={() => void confirmDay()}
                    disabled={
                      busy ||
                      confirmations.length === 0 ||
                      reason.trim().length < 10
                    }
                    data-testid="confirm-day-submit"
                  >
                    {td.submit}
                  </Button>
                </motion.div>
              </>
            ) : (
              <p className="text-muted-foreground">{td.inquiry}</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
