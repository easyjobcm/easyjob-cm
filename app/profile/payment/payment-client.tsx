"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading";
import { ChevronLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { paymentSchema } from "@/lib/validations/profile";

type MomoProvider = "mtn" | "orange";

interface PaymentClientProps {
  momoProvider: string | null;
  momoNumber: string | null;
  momoAccountName: string | null;
  momoVerified: boolean;
  momoRejectReason: string | null;
}

function maskNumber(number: string | null): string {
  if (!number) return "";
  const visible = number.slice(-3);
  return `${"•".repeat(Math.max(0, number.length - 3))}${visible}`;
}

export function PaymentClient({
  momoProvider,
  momoNumber,
  momoAccountName,
  momoVerified,
  momoRejectReason,
}: PaymentClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const tp = t.profile.paymentPage;

  const [editing, setEditing] = React.useState(!momoNumber);
  const [provider, setProvider] = React.useState<MomoProvider>(
    momoProvider === "mtn" || momoProvider === "orange" ? momoProvider : "mtn",
  );
  const [number, setNumber] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [error, setError] = React.useState("");
  const [currentNumber, setCurrentNumber] = React.useState(momoNumber);
  const [currentProvider, setCurrentProvider] = React.useState(momoProvider);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const saveErrorMessages = React.useMemo<Record<string, string>>(
    () => ({
      momoProviderInvalid: tp.momoProviderInvalid,
      momoAccountNameTooLong: tp.momoAccountNameTooLong,
      phoneInvalid: t.signup.errors.phoneInvalid,
    }),
    [tp, t],
  );

  const handleSave = async () => {
    if (saving) return;
    setError("");

    const result = paymentSchema.safeParse({
      momo_provider: provider,
      momo_number: number,
      momo_account_name: accountName.trim() || undefined,
    });
    if (!result.success) {
      const key = result.error.issues[0]?.message ?? "";
      setError(saveErrorMessages[key] ?? key ?? tp.error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile/payment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      if (!res.ok) throw new Error("save failed");

      setCurrentNumber(result.data.momo_number);
      setCurrentProvider(result.data.momo_provider);
      // RPC `candidate_update_momo` : la vérification est remise à zéro
      // (l'admin re-vérifie le numéro/opérateur modifié).
      setEditing(false);
      setSaved(true);
    } catch {
      setError(tp.error);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setNumber(currentNumber ?? "");
    setAccountName(momoAccountName ?? "");
    setProvider(currentProvider === "orange" ? "orange" : "mtn");
    setEditing(true);
    setError("");
  };

  // ── Vues ────────────────────────────────────────────────────────────
  // verified → carte « Vérifié » (+ Modifier) ; sinon numéro déclaré →
  // carte en attente admin (status pending / refusé + motif) ; sinon
  // formulaire de déclaration.

  const showPendingCard = !editing && !!currentNumber;

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 pb-4 pt-safe-top dark:border-white/10 dark:bg-[#1A0F2E]">
          <button
            type="button"
            onClick={() => router.push("/profile/candidate")}
            aria-label={t.common.back}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {tp.title}
            </h1>
            <p className="text-xs text-muted-foreground">{tp.subtitle}</p>
          </div>
        </div>

        <div className="space-y-4 px-4 pb-10 pt-6">
          {momoVerified && !editing ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {currentProvider === "mtn" ? "MTN MoMo" : "Orange Money"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {maskNumber(currentNumber)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {tp.verified}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleEdit}
                >
                  {tp.edit}
                </Button>
              </CardContent>
            </Card>
          ) : showPendingCard ? (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {currentProvider === "mtn" ? "MTN MoMo" : "Orange Money"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentNumber}
                  </p>
                  {momoAccountName && (
                    <p className="text-sm text-muted-foreground">
                      {momoAccountName}
                    </p>
                  )}
                  {saved && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tp.revalidateNotice}
                    </p>
                  )}
                </div>

                {momoRejectReason ? (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
                  >
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {tp.rejected}
                      <span className="mt-1 block text-xs">
                        {tp.rejectedReason.replace(
                          "{reason}",
                          momoRejectReason,
                        )}
                      </span>
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{tp.pending}</p>
                )}

                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleEdit}
                >
                  {tp.edit}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 p-4">
                {!currentNumber && (
                  <p className="text-sm text-muted-foreground">
                    {tp.notConfigured}
                  </p>
                )}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {tp.provider}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setProvider("mtn")}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
                        provider === "mtn"
                          ? "border-yellow-500 bg-yellow-500/10"
                          : "border-border bg-card hover:border-yellow-500/50"
                      }`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500 text-sm font-bold text-white">
                        MTN
                      </div>
                      <span className="text-sm font-medium">MTN MoMo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("orange")}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
                        provider === "orange"
                          ? "border-orange-500 bg-orange-500/10"
                          : "border-border bg-card hover:border-orange-500/50"
                      }`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">
                        OM
                      </div>
                      <span className="text-sm font-medium">Orange Money</span>
                    </button>
                  </div>
                </div>
                <Input
                  label={tp.number}
                  type="tel"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder={tp.numberPlaceholder}
                />
                <Input
                  label={`${tp.accountName} ${tp.accountNameOptional}`}
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder={tp.accountNamePlaceholder}
                  hint={tp.accountNameHint}
                />
                {currentNumber && (
                  <p className="text-xs text-muted-foreground">
                    {tp.revalidateNotice}
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <div className="flex gap-3">
                  {currentNumber && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setEditing(false)}
                    >
                      {t.profile.cancel}
                    </Button>
                  )}
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1"
                  >
                    {saving ? (
                      <LoadingSpinner size="sm" />
                    ) : saved ? (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {tp.saved}
                      </>
                    ) : (
                      tp.save
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex items-start gap-2 p-4">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {tp.reviewPending}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
