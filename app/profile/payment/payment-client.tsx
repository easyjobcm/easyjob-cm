"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { OtpInput } from "@/components/auth/otp-input";
import { LoadingSpinner } from "@/components/ui/loading";
import {
  ChevronLeft,
  CheckCircle2,
  Clock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { paymentSchema } from "@/lib/validations/profile";

type MomoProvider = "mtn" | "orange";

interface PaymentClientProps {
  momoProvider: string | null;
  momoNumber: string | null;
  momoAccountName: string | null;
  momoVerified: boolean;
  /** T6 — 'none' | 'awaiting' | 'verified' | 'rejected' (preuve OTP). */
  momoOtpStatus: string | null;
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
  momoOtpStatus,
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
  const [verified, setVerified] = React.useState(momoVerified);
  const [otpStatus, setOtpStatus] = React.useState<string>(
    momoOtpStatus ?? "none",
  );
  // T6 — rejet : 'otp_max_attempts' (3 codes erronés) ou motif libre admin.
  const [rejectReason, setRejectReason] = React.useState<string | null>(
    momoRejectReason,
  );
  const [currentNumber, setCurrentNumber] = React.useState(momoNumber);
  const [currentProvider, setCurrentProvider] = React.useState(momoProvider);
  const [error, setError] = React.useState("");
  const [otpError, setOtpError] = React.useState("");
  const [token, setToken] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [resendLocked, setResendLocked] = React.useState(false);

  /** Codes machine (routes API) → texte i18n affiché au candidat. */
  const otpErrorMessages = React.useMemo<Record<string, string>>(
    () => ({
      otp_wrong: tp.otpWrong,
      otp_max_attempts: tp.otpMaxAttempts,
      otp_not_requested: tp.otpNotRequested,
      otp_number_mismatch: tp.otpNumberMismatch,
      otp_expired: tp.otpExpired,
      sms_failed: tp.otpSmsFailed,
      sms_quota_exceeded: tp.otpQuotaExceeded,
      otp_not_configured: tp.otpNotConfigured,
    }),
    [tp],
  );

  const saveErrorMessages = React.useMemo<Record<string, string>>(
    () => ({
      momoProviderInvalid: tp.momoProviderInvalid,
      momoAccountNameTooLong: tp.momoAccountNameTooLong,
      phoneInvalid: t.signup.errors.phoneInvalid,
    }),
    [tp, t],
  );

  const lockResend = () => {
    setResendLocked(true);
    setTimeout(() => setResendLocked(false), 30_000);
  };

  const resetProofState = () => {
    setToken("");
    setOtpError("");
    setError("");
  };

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
      setVerified(false);
      // RPC `candidate_update_momo` : tout est remis à `none` (nouvelle
      // vérification complète).
      setOtpStatus("none");
      setRejectReason(null);
      setToken("");
      setOtpError("");
      setEditing(false);
      setSaved(true);
    } catch {
      setError(tp.error);
    } finally {
      setSaving(false);
    }
  };

  const handleSendOtp = async () => {
    if (sending || !currentNumber) return;
    resetProofState();
    setSending(true);
    try {
      const res = await fetch("/api/profile/momo/otp", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
        };
        const code = body.code ?? "sms_failed";
        setOtpError(otpErrorMessages[code] ?? tp.error);
        return;
      }
      setOtpStatus("awaiting");
      lockResend();
    } catch {
      setOtpError(tp.otpSmsFailed);
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (verifying || !currentNumber) return;
    setOtpError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/profile/momo/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, number: currentNumber }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
        };
        const code = body.code ?? "otp_wrong";
        if (code === "otp_max_attempts") {
          // 3 échecs : le RPC a posé `rejected` + motif `otp_max_attempts`.
          setOtpStatus("rejected");
          setRejectReason("otp_max_attempts");
          setOtpError(tp.otpMaxAttempts);
          return;
        }
        if (code === "otp_expired" || code === "otp_not_requested") {
          setOtpStatus("none");
        }
        setOtpError(otpErrorMessages[code] ?? tp.error);
        return;
      }
      const ok = (await res.json()) as { status?: string };
      if (ok.status === "verified") {
        setOtpStatus("verified");
        setRejectReason(null);
      }
    } catch {
      setOtpError(tp.error);
    } finally {
      setVerifying(false);
    }
  };

  // ── Vues ────────────────────────────────────────────────────────────
  // verified → carte « Vérifié » (+ Modifier) ; sinon preuve OTP ou
  // formulaire selon `editing`.

  const showOtpCard = currentNumber && !verified && !editing;

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
          {verified ? (
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
                    {currentNumber && (
                      <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                        {tp.otpVerified}
                      </p>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {tp.verified}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setNumber(currentNumber ?? "");
                    setAccountName(momoAccountName ?? "");
                    setProvider(
                      currentProvider === "orange" ? "orange" : "mtn",
                    );
                    setEditing(true);
                    setError("");
                  }}
                >
                  {tp.edit}
                </Button>
              </CardContent>
            </Card>
          ) : showOtpCard ? (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {currentProvider === "mtn" ? "MTN MoMo" : "Orange Money"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentNumber}
                  </p>
                  {saved && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tp.revalidateNotice}
                    </p>
                  )}
                </div>

                {otpStatus === "verified" ? (
                  // Preuve obtenue — en attente de la revue admin (UI T8).
                  <div className="flex items-start gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    <p className="text-sm text-green-700 dark:text-green-400">
                      {tp.otpVerified}
                    </p>
                  </div>
                ) : otpStatus === "rejected" ? (
                  <div className="space-y-3">
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
                    >
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {rejectReason === "otp_max_attempts" ? (
                          tp.rejectedOtp
                        ) : (
                          <>
                            {tp.rejected}
                            {rejectReason && (
                              <span className="mt-1 block text-xs">
                                {tp.rejectedReason.replace(
                                  "{reason}",
                                  rejectReason,
                                )}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tp.otpResendNote}
                    </p>
                    <Button
                      onClick={handleSendOtp}
                      disabled={sending}
                      className="w-full"
                    >
                      {sending ? <LoadingSpinner size="sm" /> : tp.otpSend}
                    </Button>
                  </div>
                ) : otpStatus === "awaiting" ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {tp.otpBody.replace("{number}", currentNumber ?? "")}
                    </p>
                    <OtpInput
                      value={token}
                      onChange={setToken}
                      disabled={verifying}
                    />
                    {otpError && (
                      <p role="alert" className="text-sm text-destructive">
                        {otpError}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={handleSendOtp}
                        disabled={sending || resendLocked}
                      >
                        {tp.otpResend}
                      </Button>
                      <Button
                        onClick={handleVerify}
                        disabled={verifying || token.length !== 6}
                        className="flex-1"
                      >
                        {verifying ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          tp.otpVerify
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tp.otpResendNote}
                    </p>
                  </div>
                ) : (
                  // 'none' : aucun code actif après enregistrement.
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {tp.otpNoCode}
                    </p>
                    {otpError && (
                      <p role="alert" className="text-sm text-destructive">
                        {otpError}
                      </p>
                    )}
                    <Button
                      onClick={handleSendOtp}
                      disabled={sending}
                      className="w-full"
                    >
                      {sending ? <LoadingSpinner size="sm" /> : tp.otpSend}
                    </Button>
                  </div>
                )}

                {!error && !otpError && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setNumber(currentNumber ?? "");
                      setAccountName(momoAccountName ?? "");
                      setProvider(
                        currentProvider === "orange" ? "orange" : "mtn",
                      );
                      setEditing(true);
                    }}
                  >
                    {tp.edit}
                  </Button>
                )}
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
