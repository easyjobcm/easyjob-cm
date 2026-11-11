"use client";

import * as React from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  FileText,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { cn } from "@/lib/utils";
import { doualaDateTime } from "@/lib/utils/douala-time";
import type {
  CompanyReviewState,
  DossierDocument,
  DossierPiece,
} from "@/lib/utils/company-verification";
import {
  COMPANY_CHECKS,
  COMPANY_CHECK_DECISIONS,
  COMPANY_CHECK_SOURCES,
  COMPANY_REVIEW_REASON_MAX,
  COMPANY_REVIEW_REASON_MIN,
  companyCheckSchema,
  companyReviewSchema,
  type CompanyCheck,
  type CompanyCheckDecision,
} from "@/lib/validations/company";

type CheckStatus = CompanyCheckDecision | "pending";

type HistoryEntry = {
  id: string;
  decision: CompanyCheckDecision;
  current: boolean;
  check_revision: number;
  source: string | null;
  reference_note: string | null;
  reason: string | null;
  decided_at: string;
  decided_by_role: string | null;
  decided_by_email: string | null;
};

type CheckData = {
  revision: number;
  status: CheckStatus;
  last_check_id: string | null;
  history: HistoryEntry[];
};

type Dossier = {
  company_id: string;
  company_name: string;
  legal_name: string | null;
  sector: string | null;
  company_size: string | null;
  website: string | null;
  description: string | null;
  rccm: string | null;
  niu: string | null;
  niu_verified: boolean;
  city: string | null;
  quartier: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  representative_name: string | null;
  representative_title: string | null;
  representative_authority: "listed_officer" | "mandate" | null;
  onboarding_status: string | null;
  review_state: CompanyReviewState;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  revision: number;
  missing: DossierPiece[];
  documents: Record<
    DossierDocument,
    { present: boolean; kind: "pdf" | "image" | null }
  >;
  checks: Record<CompanyCheck, CheckData>;
  account_active: boolean;
};

type Payload = { dossier: Dossier; can_decide: boolean };
type DocumentView = {
  doc: DossierDocument;
  url: string;
  kind: "pdf" | "image";
};
/** Ce que l'admin a lu : version du dossier et dernière décision par contrôle. */
type Seen = { revision: number; checks: Record<CompanyCheck, string | null> };
type CheckForm = {
  decision: CompanyCheckDecision | null;
  source: string;
  reference: string;
  reason: string;
};

const EMPTY_FORM: CheckForm = {
  decision: null,
  source: "",
  reference: "",
  reason: "",
};

const STATE_TONE: Record<CompanyReviewState, string> = {
  incomplete: "border-warning/40 bg-warning/10 text-warning",
  in_review: "border-primary/40 bg-primary/10 text-primary",
  correction: "border-destructive/40 bg-destructive/10 text-destructive",
  verified: "border-success/40 bg-success/10 text-success",
};

const CHECK_TONE: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; tone: string }
> = {
  approved: { icon: CheckCircle2, tone: "text-success" },
  rejected: { icon: XCircle, tone: "text-destructive" },
  unverifiable: { icon: HelpCircle, tone: "text-warning" },
  pending: { icon: Circle, tone: "text-muted-foreground" },
};

/** Pièces affichées dans chaque section (le RCCM sert aussi au représentant). */
const SECTION_DOCS: Record<CompanyCheck, DossierDocument[]> = {
  rccm: ["rccm"],
  niu: ["niu"],
  representative: ["representative_id", "mandate"],
};

function seenOf(d: Dossier): Seen {
  return {
    revision: d.revision,
    checks: {
      rccm: d.checks.rccm.last_check_id,
      niu: d.checks.niu.last_check_id,
      representative: d.checks.representative.last_check_id,
    },
  };
}

/**
 * Revue du dossier entreprise (lot 11) sur /admin/companies/[id].
 *
 * Trois contrôles séparés (RCCM, NIU, représentant), chacun enregistré par
 * l'admin après consultation de la source officielle, puis une décision
 * finale. Ce que l'admin a lu (`seen`) est fixé au premier chargement et
 * mis à jour seulement par « Relire le dossier » ou après sa propre action.
 * Si le dossier ou un contrôle change entre-temps (signal Realtime
 * admin:profile), les pièces ouvertes sont masquées et les décisions
 * retirées. La base refuse de toute façon une décision sur une version
 * ancienne (`company_changed`, `check_changed`).
 */
export function CompanyVerificationAdminPanel({
  companyId,
}: {
  companyId: string;
}) {
  const { t, locale } = useI18n();
  const tr = t.admin.companies.review;
  const states = t.admin.companies.reviewStates;
  const errors = t.companyVerification.errors;
  const pieces = t.companyVerification.pieces;
  const authorityLabels = t.companyOnboarding.authority;
  const sizeLabels = t.companyOnboarding.sizes;
  const reduceMotion = useReducedMotion();

  const url = `/api/admin/companies/${companyId}/verification`;
  const [seen, setSeen] = React.useState<Seen | null>(null);
  const { data, error, isLoading, mutate } = useSWR<Payload>(
    url,
    async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as Payload;
    },
    { onSuccess: (fresh) => setSeen((s) => s ?? seenOf(fresh.dossier)) },
  );
  useLiveRefresh(["admin:profile", "admin:account"], () => mutate());

  const [documentView, setDocumentView] = React.useState<DocumentView | null>(
    null,
  );
  const [documentLoading, setDocumentLoading] =
    React.useState<DossierDocument | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [forms, setForms] = React.useState<Record<CompanyCheck, CheckForm>>({
    rccm: EMPTY_FORM,
    niu: EMPTY_FORM,
    representative: EMPTY_FORM,
  });
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [finalReason, setFinalReason] = React.useState("");

  const dossier = data?.dossier;
  const changed =
    !!dossier &&
    !!seen &&
    (dossier.revision !== seen.revision ||
      COMPANY_CHECKS.some(
        (c) => dossier.checks[c].last_check_id !== seen.checks[c],
      ));

  const errorText = (code: string | undefined) =>
    code && code in errors
      ? errors[code as keyof typeof errors]
      : errors.company_review_failed;

  const refreshAfterOwnAction = async () => {
    const fresh = await mutate();
    if (fresh) setSeen(seenOf(fresh.dossier));
  };

  const rereadDossier = async () => {
    setDocumentView(null);
    await refreshAfterOwnAction();
  };

  const openDocument = async (doc: DossierDocument) => {
    if (!seen) return;
    setDocumentLoading(doc);
    try {
      const res = await fetch(
        `/api/admin/companies/${companyId}/document-url?doc=${doc}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        kind?: "pdf" | "image";
        revision?: number;
      };
      if (!res.ok || !body.url || !body.kind) throw new Error("document");
      // Pièce remplacée depuis l'ouverture : relecture exigée.
      if (body.revision !== seen.revision) {
        await mutate();
        return;
      }
      setDocumentView({ doc, url: body.url, kind: body.kind });
    } catch {
      toast({ description: tr.documentError, variant: "destructive" });
    } finally {
      setDocumentLoading(null);
    }
  };

  /** Une seule requête à la fois (double clic) ; relecture après refus. */
  const send = async (run: () => Promise<Response>, success: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await run();
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (res.ok) {
        toast({ description: success, variant: "success" });
        await refreshAfterOwnAction();
        return true;
      }
      toast({ description: errorText(body.code), variant: "destructive" });
      if (
        body.code === "company_changed" ||
        body.code === "check_changed" ||
        body.code === "company_not_pending"
      ) {
        await mutate();
      }
      return false;
    } catch {
      toast({
        description: errors.company_review_failed,
        variant: "destructive",
      });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const recordCheck = async (check: CompanyCheck) => {
    if (!seen) return;
    const f = forms[check];
    const parsed = companyCheckSchema.safeParse({
      check,
      decision: f.decision ?? undefined,
      source: f.source || undefined,
      reference: f.reference || undefined,
      reason: f.reason || undefined,
      seen_revision: seen.revision,
      seen_check: seen.checks[check],
    });
    if (!parsed.success) {
      toast({
        description: errorText(parsed.error.issues[0]?.message),
        variant: "destructive",
      });
      return;
    }
    const ok = await send(
      () =>
        fetch(`/api/admin/companies/${companyId}/checks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }),
      tr.checkSaved,
    );
    if (ok) setForms((prev) => ({ ...prev, [check]: EMPTY_FORM }));
  };

  const decide = async (action: "approve" | "request_correction") => {
    if (!seen) return;
    const parsed = companyReviewSchema.safeParse({
      action,
      reason: action === "request_correction" ? finalReason : undefined,
      seen_revision: seen.revision,
    });
    if (!parsed.success) {
      toast({
        description: errorText(parsed.error.issues[0]?.message),
        variant: "destructive",
      });
      return;
    }
    if (action === "approve" && !window.confirm(tr.confirmApprove)) return;
    const ok = await send(
      () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }),
      action === "approve" ? tr.approved : tr.correctionSent,
    );
    if (ok) {
      setCorrectionOpen(false);
      setFinalReason("");
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-6">
        <LoadingSpinner />
      </div>
    );
  }
  if (error || !dossier) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        {tr.loadError}
      </p>
    );
  }

  const canAct =
    !!data?.can_decide && dossier.review_state === "in_review" && !changed;
  const allApproved = COMPANY_CHECKS.every(
    (c) => dossier.checks[c].status === "approved",
  );

  const sectionFields: Record<CompanyCheck, [string, React.ReactNode][]> = {
    rccm: [
      [tr.fields.companyName, dossier.company_name],
      [tr.fields.legalName, dossier.legal_name],
      [tr.fields.rccm, dossier.rccm],
    ],
    niu: [
      [tr.fields.companyName, dossier.company_name],
      [
        tr.fields.niu,
        dossier.niu ? (
          <span>
            {dossier.niu}{" "}
            <span
              className={cn(
                "text-xs",
                dossier.niu_verified ? "text-success" : "text-muted-foreground",
              )}
            >
              · {dossier.niu_verified ? tr.niuVerified : tr.niuNotVerified}
            </span>
          </span>
        ) : null,
      ],
    ],
    representative: [
      [tr.representativeName, dossier.representative_name],
      [tr.representativeTitle, dossier.representative_title],
      [
        tr.representativeAuthority,
        dossier.representative_authority
          ? authorityLabels[dossier.representative_authority]
          : null,
      ],
    ],
  };

  const generalRows: [string, React.ReactNode][] = [
    [tr.fields.sector, dossier.sector],
    [
      tr.fields.size,
      dossier.company_size && dossier.company_size in sizeLabels
        ? sizeLabels[dossier.company_size as keyof typeof sizeLabels]
        : dossier.company_size,
    ],
    [tr.fields.website, dossier.website],
    [
      tr.fields.address,
      [dossier.address, dossier.quartier, dossier.city]
        .filter(Boolean)
        .join(", ") || null,
    ],
    [
      tr.fields.contact,
      [dossier.contact_name, dossier.contact_email, dossier.contact_phone]
        .filter(Boolean)
        .join(" · ") || null,
    ],
    [
      tr.fields.onboarding,
      dossier.onboarding_status === "completed"
        ? tr.onboardingDone
        : tr.onboardingOpen,
    ],
    [tr.fields.description, dossier.description],
  ];

  const renderRows = (rows: [string, React.ReactNode][]) => (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_1fr]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {value ?? "—"}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );

  const renderDocument = (doc: DossierDocument) => {
    if (doc === "mandate" && dossier.representative_authority !== "mandate") {
      return null;
    }
    const meta = dossier.documents[doc];
    const open = documentView?.doc === doc && !changed;
    return (
      <div key={doc} className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <FileText className="h-4 w-4 text-primary" />
            {tr.documentsLabels[doc]}
          </span>
          {!meta.present ? (
            <span className="text-sm text-muted-foreground">
              {tr.noDocument}
            </span>
          ) : open ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDocumentView(null)}
            >
              <EyeOff className="mr-1 h-4 w-4" />
              {tr.hideDocument}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDocument(doc)}
              disabled={documentLoading !== null || changed}
              data-testid={`admin-company-view-${doc}`}
            >
              {documentLoading === doc ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Eye className="mr-1 h-4 w-4" />
              )}
              {tr.viewDocument}
            </Button>
          )}
        </div>
        {open && documentView && (
          <div className="space-y-1">
            {documentView.kind === "pdf" ? (
              <iframe
                src={documentView.url}
                title={tr.documentsLabels[doc]}
                className="h-[60vh] w-full rounded-lg border border-border"
                data-testid="admin-company-document-frame"
              />
            ) : (
              // URL signée de courte durée : pas d'optimisation next/image.
              <img
                src={documentView.url}
                alt={tr.documentsLabels[doc]}
                className="max-h-[60vh] w-full rounded-lg border border-border object-contain"
                data-testid="admin-company-document-frame"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {tr.documentLinkHint}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderCheckForm = (check: CompanyCheck) => {
    const f = forms[check];
    const setF = (patch: Partial<CheckForm>) =>
      setForms((prev) => ({ ...prev, [check]: { ...prev[check], ...patch } }));
    return (
      <div className="space-y-3 rounded-xl bg-muted/30 p-3">
        <div className="flex flex-wrap gap-2">
          {COMPANY_CHECK_DECISIONS.map((decision) => (
            <button
              key={decision}
              type="button"
              aria-pressed={f.decision === decision}
              disabled={!canAct || busy}
              onClick={() => setF({ decision })}
              data-testid={`admin-check-${check}-${decision}`}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                f.decision === decision
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-foreground hover:bg-muted",
              )}
            >
              {tr.decisions[decision]}
            </button>
          ))}
        </div>
        {f.decision && (
          <div className="space-y-3">
            {f.decision !== "rejected" && (
              <label className="block text-sm">
                <span className="font-medium">{tr.sourceLabel}</span>
                <select
                  value={f.source}
                  onChange={(e) => setF({ source: e.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  data-testid={`admin-check-${check}-source`}
                >
                  <option value="">{tr.sourcePlaceholder}</option>
                  {COMPANY_CHECK_SOURCES[check].map((source) => (
                    <option key={source} value={source}>
                      {tr.sources[source]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {f.decision !== "rejected" && (
              <label className="block text-sm">
                <span className="font-medium">{tr.referenceLabel}</span>
                <input
                  value={f.reference}
                  maxLength={300}
                  onChange={(e) => setF({ reference: e.target.value })}
                  placeholder={tr.referencePlaceholder}
                  className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  data-testid={`admin-check-${check}-reference`}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {tr.referenceHint}
                </span>
              </label>
            )}
            {f.decision === "unverifiable" && (
              <p className="text-xs text-warning">{tr.unverifiableHint}</p>
            )}
            {f.decision === "rejected" && (
              <label className="block text-sm">
                <span className="font-medium">{tr.checkReasonLabel}</span>
                <textarea
                  value={f.reason}
                  maxLength={COMPANY_REVIEW_REASON_MAX}
                  onChange={(e) => setF({ reason: e.target.value })}
                  placeholder={tr.reasonPlaceholder}
                  className="mt-1 min-h-20 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  data-testid={`admin-check-${check}-reason`}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {tr.reasonHint}
                </span>
              </label>
            )}
            <Button
              size="sm"
              disabled={!canAct || busy}
              onClick={() => recordCheck(check)}
              data-testid={`admin-check-${check}-save`}
            >
              {tr.saveCheck}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderHistory = (check: CompanyCheck) => {
    const history = dossier.checks[check].history;
    return (
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {tr.history} ({history.length})
        </summary>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {tr.historyEmpty}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {history.map((h) => (
              <li
                key={h.id}
                className={cn(
                  "rounded-lg border border-border p-2 text-xs",
                  !h.current && "opacity-70",
                )}
              >
                <p className="font-medium text-foreground">
                  {tr.checkStatus[h.decision]}
                  {!h.current && ` · ${tr.historyOutdated}`}
                </p>
                <p className="text-muted-foreground">
                  {doualaDateTime(h.decided_at, locale)}
                  {h.decided_by_email &&
                    ` · ${tr.historyBy.replace("{who}", h.decided_by_email)}`}
                </p>
                {h.source && h.source in tr.sources && (
                  <p>
                    {tr.sourceLabel} :{" "}
                    {tr.sources[h.source as keyof typeof tr.sources]}
                  </p>
                )}
                {h.reference_note && (
                  <p className="break-words">
                    {tr.referenceLabel} : {h.reference_note}
                  </p>
                )}
                {h.reason && (
                  <p className="break-words text-destructive">
                    {tr.checkReasonLabel} : {h.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    );
  };

  return (
    <Card className="border-border" data-testid="admin-company-verification">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">{tr.title}</h2>
            <p className="text-sm text-muted-foreground">{tr.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                STATE_TONE[dossier.review_state],
              )}
              data-testid="admin-company-review-state"
              data-state={dossier.review_state}
            >
              {states[dossier.review_state]}
            </span>
            <span className="text-xs text-muted-foreground">
              {tr.version.replace(
                "{n}",
                String(seen?.revision ?? dossier.revision),
              )}
            </span>
            {!dossier.account_active && (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                <ShieldAlert className="h-3 w-3" />
                {tr.accountSuspended}
              </span>
            )}
          </div>
        </div>

        {changed && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground sm:flex-row sm:items-center"
            data-testid="admin-company-review-changed"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">{tr.changed}</span>
            <Button size="sm" variant="outline" onClick={rereadDossier}>
              <RefreshCw className="mr-1 h-4 w-4" />
              {tr.reload}
            </Button>
          </motion.div>
        )}

        {renderRows(generalRows)}

        {dossier.missing.length > 0 && (
          <div
            className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
            data-testid="admin-company-missing"
          >
            <p className="font-medium">{tr.missing}</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {dossier.missing.map((piece) => (
                <li key={piece}>{pieces[piece]}</li>
              ))}
            </ul>
          </div>
        )}

        {COMPANY_CHECKS.map((check) => {
          const c = dossier.checks[check];
          const { icon: Icon, tone } = CHECK_TONE[c.status];
          return (
            <section
              key={check}
              className="space-y-3 rounded-2xl border border-border p-3"
              data-testid={`admin-check-${check}`}
              data-status={c.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-foreground">
                  {tr.sections[check]}
                </h3>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-sm font-medium",
                    tone,
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tr.checkStatus[c.status]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tr.checkHints[check]}
              </p>
              {renderRows(sectionFields[check])}
              <div className="space-y-2">
                {SECTION_DOCS[check].map(renderDocument)}
              </div>
              {data?.can_decide &&
                dossier.review_state === "in_review" &&
                renderCheckForm(check)}
              {renderHistory(check)}
            </section>
          );
        })}

        <section className="space-y-3 rounded-2xl border border-border p-3">
          <h3 className="font-semibold text-foreground">{tr.finalTitle}</h3>
          <p className="text-xs text-muted-foreground">{tr.finalHint}</p>
          {dossier.rejection_reason && (
            <p className="break-words rounded-xl bg-muted/40 p-3 text-sm">
              <span className="font-medium">{tr.lastReason} : </span>
              {dossier.rejection_reason}
            </p>
          )}
          {dossier.reviewed_at && (
            <p className="text-xs text-muted-foreground">
              {tr.reviewedOn.replace(
                "{date}",
                doualaDateTime(dossier.reviewed_at, locale),
              )}
            </p>
          )}
          {!data?.can_decide ? (
            <p className="text-xs text-muted-foreground">{tr.readOnly}</p>
          ) : dossier.review_state !== "in_review" ? (
            <p className="text-xs text-muted-foreground">{tr.notPending}</p>
          ) : correctionOpen ? (
            <div className="space-y-2">
              <label
                htmlFor="company-review-reason"
                className="text-sm font-medium"
              >
                {tr.reasonLabel}
              </label>
              <textarea
                id="company-review-reason"
                value={finalReason}
                onChange={(e) => setFinalReason(e.target.value)}
                maxLength={COMPANY_REVIEW_REASON_MAX}
                placeholder={tr.reasonPlaceholder}
                className="min-h-24 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                data-testid="admin-company-review-reason"
              />
              <p className="flex justify-between text-xs text-muted-foreground">
                <span>{tr.reasonHint}</span>
                <span>
                  {finalReason.trim().length}/{COMPANY_REVIEW_REASON_MAX}
                </span>
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="destructive"
                  disabled={
                    !canAct ||
                    busy ||
                    finalReason.trim().length < COMPANY_REVIEW_REASON_MIN
                  }
                  onClick={() => decide("request_correction")}
                  data-testid="admin-company-send-correction"
                >
                  {tr.sendCorrection}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setCorrectionOpen(false)}
                >
                  {tr.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                disabled={
                  !canAct || busy || !allApproved || dossier.missing.length > 0
                }
                onClick={() => decide("approve")}
                data-testid="admin-company-approve"
              >
                {busy ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <BadgeCheck className="mr-1 h-4 w-4" />
                )}
                {tr.approve}
              </Button>
              <Button
                variant="outline"
                disabled={!canAct || busy}
                onClick={() => setCorrectionOpen(true)}
                data-testid="admin-company-request-correction"
              >
                {tr.requestCorrection}
              </Button>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
