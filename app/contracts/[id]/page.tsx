"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Download,
  FileSignature,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContractClausesCard,
  ContractTermsCard,
} from "@/components/contracts/contract-terms";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { parseContractTerms } from "@/lib/contracts/terms";
import type { Database } from "@/lib/database.types";
import {
  useAccountSuspended,
  useLatestRequest,
  useLiveRefresh,
} from "@/lib/realtime/provider";

type ContractRow =
  Database["public"]["Functions"]["get_contract"]["Returns"][number];
/** `get_contract` peut renvoyer null pour ces colonnes (types générés stricts). */
type Contract = Omit<
  ContractRow,
  "mission_id" | "candidate_name" | "company_name"
> & {
  mission_id: string | null;
  candidate_name: string | null;
  company_name: string | null;
};
type ContractError = keyof ReturnType<
  typeof useI18n
>["t"]["contract"]["errors"];

const ERROR_CODES = new Set<string>([
  "not_authenticated",
  "account_suspended",
  "contract_not_found",
  "contract_not_signable",
  "contract_needs_review",
  "terms_mismatch",
  "consent_required",
]);
const errorCode = (code: unknown): ContractError =>
  typeof code === "string" && ERROR_CODES.has(code)
    ? (code as ContractError)
    : "generic";

type LoadResult =
  | { kind: "ok"; contract: Contract }
  | { kind: "unauthorized" }
  | { kind: "contract_not_found" }
  | { kind: "load" };

async function fetchContract(contractId: string): Promise<LoadResult> {
  const res = await fetch(`/api/contracts/${contractId}`, {
    cache: "no-store",
  }).catch(() => null);
  if (res?.status === 401) return { kind: "unauthorized" };
  const body = ((await res?.json().catch(() => null)) ?? {}) as {
    contract?: Contract;
  };
  if (res?.ok && body.contract) return { kind: "ok", contract: body.contract };
  return { kind: res?.status === 404 ? "contract_not_found" : "load" };
}

/**
 * Contrat vu par l'une de ses parties (lots 7b et 13). Chaque partie ne voit
 * que l'action qu'elle doit accomplir (sa propre signature) : ni l'état ni
 * l'heure de la signature de l'autre partie. Le PDF se télécharge dès que le
 * contrat existe, y compris après la mission.
 */
export default function ContractSignPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const tc = t.contract;
  const contractId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loadError, setLoadError] = useState<ContractError | "load" | null>(
    null,
  );
  const [accepted, setAccepted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<ContractError | null>(null);
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const signingRef = useRef(false);

  function applyLoad(result: LoadResult): Contract | null {
    if (result.kind === "unauthorized") {
      router.push("/auth/login");
      return null;
    }
    // Erreur réseau ou serveur sur une relecture : le contrat affiché reste
    // (seul un refus ou une absence le retire).
    if (result.kind === "load" && contract) {
      setLoading(false);
      return contract;
    }
    setContract(result.kind === "ok" ? result.contract : null);
    setLoadError(result.kind === "ok" ? null : result.kind);
    setLoading(false);
    return result.kind === "ok" ? result.contract : null;
  }

  const latest = useLatestRequest();
  const suspended = useAccountSuspended();

  /**
   * Relit l'état enregistré (après une signature, sur « Réessayer » ou sur
   * signal). Seule la dernière lecture lancée modifie l'écran ; l'appelant
   * reçoit toujours le contrat relu.
   */
  const loadContract = async () => {
    const token = latest.begin();
    const result = await fetchContract(contractId);
    if (!latest.isLatest(token)) {
      return result.kind === "ok" ? result.contract : null;
    }
    return applyLoad(result);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadContract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  // Signature depuis un autre écran, compte suspendu.
  useLiveRefresh(["contracts", "missions", "account"], loadContract);

  const handleSign = async () => {
    if (!contract || !accepted || signingRef.current) return;
    signingRef.current = true;
    setSigning(true);
    setSignError(null);

    const res = await fetch(`/api/contracts/${contract.contract_id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms_hash: contract.terms_hash, consent: true }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };

    // Toujours relire l'état enregistré : une réponse perdue peut cacher une
    // signature réussie, qu'une relance retrouvera à l'identique.
    const fresh = await loadContract();

    if (fresh?.viewer_signed) {
      setConfirmOpen(false);
      setAccepted(false);
      toast({
        title: tc.toasts.signedTitle,
        description: tc.toasts.signedDesc,
        variant: "success",
      });
    } else {
      const code = errorCode(body.code);
      setConfirmOpen(false);
      setSignError(code);
      toast({
        title: tc.toasts.errorTitle,
        description: tc.errors[code],
        variant: "destructive",
      });
    }

    signingRef.current = false;
    setSigning(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tc.back}
        </Button>
        <div className="text-center mt-8 space-y-4" role="alert">
          <p className="text-muted-foreground">
            {loadError === "contract_not_found" ? tc.notFound : tc.loadError}
          </p>
          {loadError !== "contract_not_found" && (
            <Button variant="outline" onClick={() => void loadContract()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {tc.retry}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const parsed = parseContractTerms(contract.terms, locale);
  const clauses = parsed.clauses;
  const companyName = contract.company_name ?? "—";
  const jobTitle = parsed.terms.job_title ?? "—";
  // Mention propre au lecteur : sa signature, jamais celle de l'autre partie.
  const viewerState = contract.viewer_signed
    ? "signed"
    : contract.needs_review
      ? "review"
      : contract.can_sign
        ? "toSign"
        : "closed";

  const item = (index: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, delay: index * 0.05 },
  });

  return (
    <div className="min-h-screen bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="bg-card border-b p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tc.back}
        </Button>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{tc.title}</h1>
            <p className="text-sm text-muted-foreground">
              {tc.reference.replace(
                "{ref}",
                contract.contract_id.slice(0, 8).toUpperCase(),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {contract.contract_template === "formal"
                ? tc.template.formal
                : tc.template.simple}
            </p>
          </div>
          <Badge
            variant={viewerState === "signed" ? "success" : "warning"}
            data-testid="contract-status"
            data-viewer-state={viewerState}
            className="shrink-0 text-center"
          >
            {tc.viewerState[viewerState]}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {contract.needs_review && (
          <motion.div {...item(0)}>
            <Card className="border-warning">
              <CardContent className="p-4 flex items-start gap-2 text-sm">
                <AlertTriangle
                  className="h-4 w-4 mt-0.5 text-warning shrink-0"
                  aria-hidden
                />
                <span role="alert">{tc.needsReview}</span>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <motion.div {...item(1)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tc.parties}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm font-medium text-muted-foreground">
                  {tc.company}
                </div>
                <div className="font-medium" data-testid="contract-company">
                  {companyName}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">
                  {tc.candidate}
                </div>
                <div className="font-medium" data-testid="contract-candidate">
                  {contract.candidate_name ?? "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...item(2)}>
          <ContractTermsCard contract={parsed} notice={tc.termsNotice} />
        </motion.div>

        <motion.div {...item(3)}>
          <ContractClausesCard contract={parsed} />
        </motion.div>

        <motion.div {...item(4)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tc.yourSignature}</CardTitle>
            </CardHeader>
            <CardContent
              className="space-y-3"
              data-testid="contract-signatures"
            >
              {contract.viewer_signed ? (
                <p
                  className="flex items-center gap-2 text-sm text-success"
                  role="status"
                  data-testid="contract-viewer-signed"
                >
                  <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
                  {tc.alreadySignedByYou}
                </p>
              ) : !contract.can_sign ? (
                <p className="text-sm text-muted-foreground">
                  {tc.viewerState[viewerState]}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground break-all">
                {tc.fingerprint.replace(
                  "{hash}",
                  contract.terms_hash.slice(0, 16),
                )}
              </p>
              <motion.div whileTap={{ scale: 0.98 }}>
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={`/api/contracts/${contract.contract_id}/pdf?locale=${locale}`}
                    download
                    data-testid="contract-pdf"
                  >
                    <Download className="h-4 w-4 mr-2" aria-hidden />
                    {tc.downloadPdf}
                  </a>
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {contract.can_sign && clauses && (
          <motion.div {...item(5)}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSignature className="h-4 w-4" aria-hidden />
                  {tc.signNow}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="contract-consent"
                    checked={accepted}
                    onCheckedChange={setAccepted}
                    aria-labelledby="contract-consent-label"
                    className="mt-0.5 shrink-0"
                  />
                  <label
                    id="contract-consent-label"
                    htmlFor="contract-consent"
                    className="text-sm text-muted-foreground"
                  >
                    {clauses.consent}
                  </label>
                </div>

                {signError && (
                  <div
                    className="flex items-start gap-2 text-sm text-destructive"
                    role="alert"
                  >
                    <AlertTriangle
                      className="h-4 w-4 mt-0.5 shrink-0"
                      aria-hidden
                    />
                    <span>{tc.errors[signError]}</span>
                  </div>
                )}

                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    className="w-full"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!accepted || signing || suspended}
                    data-testid="contract-sign"
                  >
                    {signError ? tc.retry : tc.sign}
                  </Button>
                  {suspended && (
                    <p className="mt-2 text-xs text-destructive">
                      {t.realtime.actionUnavailable}
                    </p>
                  )}
                </motion.div>
                <p className="text-xs text-muted-foreground">
                  {contract.viewer_party === "candidate"
                    ? tc.separateSteps
                    : tc.separateStepsCompany}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !signing && setConfirmOpen(open)}
      >
        <DialogContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="contract-confirm-title"
        >
          <DialogHeader>
            <DialogTitle id="contract-confirm-title">
              {tc.confirmTitle}
            </DialogTitle>
            <DialogDescription>
              {tc.confirmDescription
                .replace("{job}", jobTitle)
                .replace("{company}", companyName)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={signing}
            >
              {tc.cancel}
            </Button>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => void handleSign()}
                disabled={signing}
                isLoading={signing}
                data-testid="contract-sign-confirm"
              >
                {signing ? tc.signing : tc.confirm}
              </Button>
            </motion.div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
