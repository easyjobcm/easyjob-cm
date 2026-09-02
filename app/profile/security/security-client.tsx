"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

interface SecurityClientProps {
  email: string;
}

export function SecurityClient({ email }: SecurityClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const ts = t.profile.securityPage;

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    setSaved(false);

    if (newPassword.length < 8) {
      setError(ts.errorTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(ts.errorMismatch);
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();

      // Revérifie le mot de passe actuel (Supabase ne l'exige pas par défaut
      // pour updateUser, mais on protège l'action contre une session volée).
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        setError(ts.errorCurrent);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setError(ts.errorGeneric);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch {
      setError(ts.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

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
              {ts.title}
            </h1>
            <p className="text-xs text-muted-foreground">{ts.subtitle}</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 px-4 pb-10 pt-6"
          noValidate
        >
          <Card>
            <CardContent className="space-y-4 p-4">
              <Input
                label={ts.currentPassword}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <Input
                label={ts.newPassword}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <Input
                label={ts.confirmPassword}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? (
                  <LoadingSpinner size="sm" />
                ) : saved ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {ts.saved}
                  </>
                ) : (
                  ts.save
                )}
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </AppShell>
  );
}
