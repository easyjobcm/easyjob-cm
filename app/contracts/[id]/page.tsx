"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle,
  Clock,
  FileSignature,
  MapPin,
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
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/utils";
import { MissionPay } from "@/components/jobs/mission-pay";
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
  | "candidate_signed_at"
  | "company_signed_at"
  | "mission_id"
  | "candidate_name"
  | "company_name"
> & {
  candidate_signed_at: string | null;
  company_signed_at: string | null;
  mission_id: string | null;
  candidate_name: string | null;
  company_name: string | null;
};
type ContractError = keyof ReturnType<
  typeof useI18n
>["t"]["contract"]["errors"];

/** Conditions figées par `select_candidate` (contract_data). */
const termsSchema = z
  .object({
    job_title: z.string().nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    start_time: z.string().nullish(),
    end_time: z.string().nullish(),
    break_minutes: z.number().nullish(),
    address: z.string().nullish(),
    city: z.string().nullish(),
    mission_pay_per_candidate: z.number().nullish(),
    currency: z.string().nullish(),
    pay_basis: z.string().nullish(),
  })
  .partial();

/**
 * Clauses générales et phrase de consentement figées dans le contrat
 * (`contract_data.clauses`, version immuable copiée à la création et couverte
 * par l'empreinte). L'écran affiche toujours ce texte, jamais celui du
 * dictionnaire courant.
 */
const clauseTextSchema = z.object({
  intro: z.string(),
  candidate_title: z.string(),
  candidate: z.array(z.string()),
  company_title: z.string(),
  company: z.array(z.string()),
  consent: z.string(),
});
const clausesSchema = z.object({
  version: z.string(),
  fr: clauseTextSchema,
  en: clauseTextSchema,
});

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

  // Signature de l'autre partie, mission démarrée, compte suspendu.
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
      signature?: { status?: string };
    };

    // Toujours relire l'état enregistré : une réponse perdue peut cacher une
    // signature réussie, qu'une relance retrouvera à l'identique.
    const fresh = await loadContract();
    const ownSigned =
      fresh &&
      (fresh.viewer_party === "candidate"
        ? fresh.candidate_signed_at
        : fresh.company_signed_at);

    if (res?.ok && ownSigned) {
      setConfirmOpen(false);
      setAccepted(false);
      toast({
        title: tc.toasts.signedTitle,
        description:
          fresh?.status === "completed"
            ? tc.toasts.completedDesc
            : tc.toasts.signedDesc,
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

  const formatInstant = (value: string) =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Douala",
    }).format(new Date(value));

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

  const parsedTerms = termsSchema.safeParse(contract.terms);
  const terms = parsedTerms.success ? parsedTerms.data : {};
  const parsedClauses = clausesSchema.safeParse(
    (contract.terms as Record<string, unknown> | null)?.clauses,
  );
  const clausesVersion = parsedClauses.success
    ? parsedClauses.data.version
    : null;
  const clauses = parsedClauses.success
    ? parsedClauses.data[locale === "en" ? "en" : "fr"]
    : null;
  const status = contract.status ?? "pending";
  const isCompleted = status === "completed";
  const ownSignedAt =
    contract.viewer_party === "candidate"
      ? contract.candidate_signed_at
      : contract.company_signed_at;
  const companyName = contract.company_name ?? "—";
  const jobTitle = terms.job_title ?? "—";
  const sameDay = !terms.end_date || terms.end_date === terms.start_date;

  const signatureRow = (label: string, signedAt: string | null) => (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {signedAt ? (
        <div className="flex items-center gap-2 text-success text-right">
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-sm">
            {tc.signedOn.replace("{date}", formatInstant(signedAt))}
          </span>
        </div>
      ) : (
        <Badge variant="outline">{tc.awaiting}</Badge>
      )}
    </div>
  );

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
            variant={isCompleted ? "success" : "warning"}
            data-testid="contract-status"
          >
            {tc.status[status]}
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
                <div className="font-medium">
                  {contract.candidate_name ?? "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...item(2)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tc.terms}</CardTitle>
              <p className="text-xs text-muted-foreground">{tc.termsNotice}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Briefcase
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-label={tc.job}
                />
                <span className="font-medium" data-testid="contract-job">
                  {jobTitle}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-label={tc.dates}
                />
                <span>
                  {terms.start_date
                    ? formatDate(terms.start_date, locale)
                    : "—"}
                  {!sameDay && terms.end_date
                    ? ` – ${formatDate(terms.end_date, locale)}`
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Clock
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-label={tc.hours}
                />
                <span>
                  {formatTime(terms.start_time, locale)} –{" "}
                  {formatTime(terms.end_time, locale)}
                </span>
                {terms.break_minutes ? (
                  <span className="text-sm text-muted-foreground">
                    ·{" "}
                    {tc.breakMinutes.replace(
                      "{min}",
                      String(terms.break_minutes),
                    )}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <MapPin
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-label={tc.place}
                />
                <span>
                  {[terms.address, terms.city].filter(Boolean).join(", ") ||
                    "—"}
                </span>
              </div>
              <div className="pt-2 border-t space-y-0.5">
                <p className="text-sm text-muted-foreground">{tc.pay}</p>
                {/* Seules les conditions forfaitaires en XAF sont affichées :
                    un contrat sans ces trois valeurs figées affiche « — ». */}
                <MissionPay
                  amount={
                    terms.pay_basis === "per_mission" &&
                    terms.currency === "XAF" &&
                    Number.isInteger(terms.mission_pay_per_candidate) &&
                    (terms.mission_pay_per_candidate ?? 0) > 0
                      ? terms.mission_pay_per_candidate
                      : null
                  }
                  amountClassName="text-lg text-primary"
                  testId="contract-pay"
                />
                <p className="text-xs text-muted-foreground">
                  {t.pay.contractBasis}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...item(3)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tc.clausesTitle}</CardTitle>
            </CardHeader>
            <CardContent
              className="text-sm text-muted-foreground space-y-3"
              data-testid="contract-clauses"
            >
              {clauses ? (
                <>
                  <p>{clauses.intro}</p>
                  <div>
                    <p className="text-foreground font-medium">
                      {clauses.candidate_title}
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      {clauses.candidate.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-foreground font-medium">
                      {clauses.company_title}
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      {clauses.company.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-xs" data-testid="contract-clauses-version">
                    {tc.clausesVersion.replace(
                      "{version}",
                      clausesVersion ?? "",
                    )}
                  </p>
                </>
              ) : (
                <p role="note">{tc.clausesMissing}</p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...item(4)}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tc.signatures}</CardTitle>
            </CardHeader>
            <CardContent
              className="space-y-4"
              data-testid="contract-signatures"
            >
              {signatureRow(tc.candidate, contract.candidate_signed_at)}
              {signatureRow(tc.company, contract.company_signed_at)}
              <p className="text-xs text-muted-foreground break-all">
                {tc.fingerprint.replace(
                  "{hash}",
                  contract.terms_hash.slice(0, 16),
                )}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {ownSignedAt && !isCompleted && (
          <p
            className="text-sm text-muted-foreground text-center"
            role="status"
          >
            {tc.alreadySignedByYou} {tc.awaitingOther}
          </p>
        )}

        {contract.can_sign && clauses && (
          <motion.div {...item(5)}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSignature className="h-4 w-4" aria-hidden />
                  {tc.yourSignature}
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
                    {clauses?.consent}
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
                  {tc.separateSteps}
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
