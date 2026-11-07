"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { doualaTime } from "@/lib/utils/douala-time";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missionId: string;
  jobTitle: string;
  /** Appelé quand la base a enregistré la réalisation (heure d'origine). */
  onCompleted: (completedAt: string) => void;
};

/**
 * Saisie du code de fin remis par l'entreprise (lot 7c). Fermer le dialogue
 * laisse la tâche disponible. Après une erreur réseau, la mission est relue :
 * une réalisation déjà enregistrée est retrouvée sans nouvel envoi.
 */
export function CompletionCodeDialog({
  open,
  onOpenChange,
  missionId,
  jobTitle,
  onCompleted,
}: Props) {
  const { t, locale } = useI18n();
  const tc = t.mission.code;
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function readCompletedAt(): Promise<string | null> {
    const res = await fetch(`/api/missions/${missionId}`, {
      cache: "no-store",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      mission?: { completed_at?: string | null };
    };
    return body.mission?.completed_at ?? null;
  }

  async function submit() {
    if (submittingRef.current) return;
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setError(tc.format);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/missions/${missionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      remaining_attempts?: number;
      locked_until?: string;
      completion?: { completed_at?: string };
    };

    // Toujours relire l'état enregistré avant d'annoncer le résultat.
    const completedAt =
      (res?.ok ? body.completion?.completed_at : null) ??
      (await readCompletedAt());
    if (completedAt) {
      setCode("");
      onCompleted(completedAt);
    } else if (body.code === "invalid_code") {
      setError(
        tc.invalid.replace("{count}", String(body.remaining_attempts ?? 0)),
      );
    } else if (body.code === "code_locked" && body.locked_until) {
      setError(
        tc.locked.replace("{time}", doualaTime(body.locked_until, locale)),
      );
    } else if (body.code === "code_format") {
      setError(tc.format);
    } else {
      const errors = t.mission.errors;
      setError(
        body.code && body.code in errors
          ? errors[body.code as keyof typeof errors]
          : errors.generic,
      );
    }
    submittingRef.current = false;
    setSubmitting(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
    >
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-code-title"
      >
        <DialogHeader>
          <DialogTitle id="completion-code-title">{tc.title}</DialogTitle>
          <DialogDescription>
            {tc.description.replace("{job}", jobTitle)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="completion-code" className="text-sm font-medium">
            {tc.label}
          </label>
          <Input
            id="completion-code"
            data-testid="completion-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-2xl tracking-[0.5em] font-mono"
          />
          {error && (
            <div
              className="flex items-start gap-2 text-sm text-destructive"
              role="alert"
              data-testid="completion-code-error"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tc.close}
            </Button>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                disabled={submitting || code.length !== 6}
                data-testid="completion-code-submit"
              >
                {submitting ? tc.submitting : tc.submit}
              </Button>
            </motion.div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
