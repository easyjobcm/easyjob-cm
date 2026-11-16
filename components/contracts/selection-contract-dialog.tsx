"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, FileSignature, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContractClausesCard,
  ContractTermsCard,
} from "@/components/contracts/contract-terms";
import { useI18n } from "@/lib/i18n";
import { parseContractTerms } from "@/lib/contracts/terms";
import type { Database } from "@/lib/database.types";

type Preview =
  Database["public"]["Functions"]["contract_selection_preview"]["Returns"][number];

type Errors = ReturnType<typeof useI18n>["t"]["companyApplicants"]["errors"];
type ErrorCode = keyof Errors;

export type SelectionResult = {
  application_id: string;
  mission_id: string;
  contract_id: string;
  already_selected: boolean;
};

/**
 * Aperçu du contrat proposé, puis « Signer et sélectionner » (lot 13).
 *
 * L'aperçu est une lecture seule : le fermer ne laisse rien en base (la
 * candidature reste en attente, la place disponible). La signature envoie
 * l'empreinte du contrat lu ; si les conditions ont changé entre-temps, la
 * base refuse sans rien écrire (`terms_mismatch`) et l'aperçu est relu.
 */
export function SelectionContractDialog({
  applicationId,
  candidateName,
  blockedReason,
  onClose,
  onDone,
}: {
  applicationId: string | null;
  candidateName: string;
  /** Action impossible côté écran (suspension, dossier, échéance). */
  blockedReason: string | null;
  onClose: () => void;
  /** Appelé après chaque tentative (succès ou refus) : l'écran relit tout. */
  onDone: (result: SelectionResult | null, code: ErrorCode | null) => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.companyApplicants;
  const td = ta.selectDialog;
  const reduceMotion = useReducedMotion();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [changed, setChanged] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<ErrorCode | null>(null);
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const signingRef = useRef(false);
  const requestRef = useRef(0);

  const codeOf = (code: unknown, fallback: ErrorCode): ErrorCode =>
    typeof code === "string" && code in ta.errors
      ? (code as ErrorCode)
      : fallback;

  async function loadPreview(id: string): Promise<Preview | null> {
    const request = ++requestRef.current;
    const res = await fetch(`/api/applications/${id}/contract-preview`, {
      cache: "no-store",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      preview?: Preview;
      code?: string;
    };
    if (request !== requestRef.current) return null;
    if (res?.ok && body.preview) {
      setPreview(body.preview);
      setLoadError(null);
      return body.preview;
    }
    setPreview(null);
    setLoadError(!res ? "network" : codeOf(body.code, "preview"));
    return null;
  }

  useEffect(() => {
    if (!applicationId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(null);
    setLoadError(null);
    setChanged(false);
    setAccepted(false);
    setSignError(null);
    void loadPreview(applicationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  async function sign() {
    if (!applicationId || !preview || !accepted || signingRef.current) return;
    signingRef.current = true;
    setSigning(true);
    setSignError(null);

    const res = await fetch(`/api/applications/${applicationId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms_hash: preview.terms_hash, consent: true }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      selection?: SelectionResult & { status?: string };
    };

    if (res?.ok && body.selection?.status === "selected") {
      onDone(body.selection, null);
    } else {
      const code: ErrorCode = !res ? "network" : codeOf(body.code, "generic");
      setSignError(code);
      if (code === "terms_mismatch") {
        // Nouvelles conditions : relues et à approuver de nouveau.
        setAccepted(false);
        setChanged(true);
        await loadPreview(applicationId);
      }
      onDone(null, code);
    }
    signingRef.current = false;
    setSigning(false);
  }

  const parsed = preview ? parseContractTerms(preview.terms, locale) : null;
  const consent = parsed?.clauses?.consent ?? null;
  const name = preview?.candidate_name ?? candidateName;

  return (
    <Dialog
      open={applicationId !== null}
      onOpenChange={(open) => !open && !signing && onClose()}
    >
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="selection-contract-title"
        className="max-h-[90dvh] overflow-y-auto overscroll-contain p-0"
        data-testid="selection-contract-dialog"
      >
        <div className="p-4 pb-0">
          <DialogHeader>
            <DialogTitle
              id="selection-contract-title"
              className="flex items-center gap-2"
            >
              <FileSignature className="h-5 w-5 text-primary" aria-hidden />
              {td.title}
            </DialogTitle>
            <DialogDescription>
              {td.description.replace("{name}", name)}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-3 px-4 pb-4">
          {!preview && !loadError && (
            <div className="space-y-3" aria-busy="true">
              <p className="text-sm text-muted-foreground">{td.loading}</p>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {loadError && (
            <div className="space-y-3" role="alert">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span data-testid="selection-preview-error">
                  {ta.errors[loadError]}
                </span>
              </p>
              {(loadError === "network" || loadError === "preview") &&
                applicationId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadPreview(applicationId)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                    {t.contract.retry}
                  </Button>
                )}
            </div>
          )}

          {preview && parsed && (
            <motion.div
              className="space-y-3"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {changed && (
                <p
                  className="flex items-start gap-2 rounded-lg border border-warning p-3 text-sm"
                  role="alert"
                  data-testid="selection-terms-changed"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  {td.changed}
                </p>
              )}
              <div className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">{td.candidate}</p>
                <p className="font-medium" data-testid="selection-candidate">
                  {name}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.contract.company}
                </p>
                <p className="font-medium">{preview.company_name ?? "—"}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {preview.contract_template === "formal"
                    ? t.contract.template.formal
                    : t.contract.template.simple}
                </p>
              </div>
              <ContractTermsCard contract={parsed} notice={td.notice} />
              <ContractClausesCard contract={parsed} />
              {/* Consentement après la lecture du contrat (texte figé). */}
              {consent && (
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    id="selection-consent"
                    checked={accepted}
                    onCheckedChange={setAccepted}
                    aria-labelledby="selection-consent-label"
                    className="mt-0.5 shrink-0"
                    disabled={signing || !!blockedReason}
                  />
                  <label
                    id="selection-consent-label"
                    htmlFor="selection-consent"
                    className="text-sm text-muted-foreground"
                  >
                    {consent}
                  </label>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{td.closeNotice}</p>
            </motion.div>
          )}
        </div>

        {/* Pied fixe réduit aux actions : le contrat reste lisible à 375 px. */}
        <div className="sticky bottom-0 space-y-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(blockedReason || (signError && signError !== "terms_mismatch")) && (
            <p className="text-sm text-destructive" role="alert">
              {blockedReason ?? (signError ? ta.errors[signError] : null)}
            </p>
          )}
          {preview && !accepted && !blockedReason && (
            <p className="text-xs text-muted-foreground">{td.consentHint}</p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" onClick={onClose} disabled={signing}>
              {td.close}
            </Button>
            <motion.div whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
              <Button
                className="w-full"
                onClick={() => void sign()}
                disabled={
                  !preview ||
                  !consent ||
                  !accepted ||
                  signing ||
                  !!blockedReason
                }
                isLoading={signing}
                data-testid="select-confirm"
              >
                {signing ? ta.processing : td.confirm}
              </Button>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
