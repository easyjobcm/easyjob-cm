"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

type CniStatus = "pending" | "verified" | "rejected";

interface CniProfile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  cni_number: string | null;
  cni_verified: "pending" | "verified" | "rejected" | null;
  cni_expires_at: string | null;
  cni_rejection_reason: string | null;
  has_cni_front: boolean;
  has_cni_back: boolean;
  has_cni_selfie: boolean;
}

interface CniAdminClientProps {
  profiles: CniProfile[];
  canModerate: boolean;
  /** T8.4c — filtre `?userId=` : l'admin arrive depuis la carte du
   *  candidat, on ne lui affiche que les CNI de cet utilisateur. */
  filterUserId?: string | null;
}

function statusOf(p: CniProfile): CniStatus {
  if (p.cni_verified === "verified") return "verified";
  if (p.cni_verified === "rejected") return "rejected";
  return "pending";
}

function fullDoc(p: CniProfile): boolean {
  return p.has_cni_front && p.has_cni_back && p.has_cni_selfie;
}

/** Pré-requis d'approbation du RPC `moderate_cni` : nom complet + 3 photos.
 *  (La date de naissance n'est PAS un pré-requis d'approbation — le défaut
 *  d'expiration retombe sur NULL si absente ; la DOB est exigée par
 *  l'onboarding et la recompute is_verified l'exige pour le flag final.) */
function hasIdentityName(p: CniProfile): boolean {
  return !!p.first_name?.trim() && !!p.last_name?.trim();
}

function nameOf(p: CniProfile): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
}

const CNI_DOC_FIELDS = ["front", "back", "selfie"] as const;
type CniDocField = (typeof CNI_DOC_FIELDS)[number];

const FIELD_TO_URL: Record<CniDocField, string> = {
  front: "cni_front_url",
  back: "cni_back_url",
  selfie: "cni_selfie_url",
};

export function CniAdminClient({
  profiles,
  canModerate,
  filterUserId,
}: CniAdminClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [selected, setSelected] = React.useState<CniProfile | null>(null);

  // T8.4c : liste « En attente » uniquement — le filtre SSR garantit
  // que `profiles` contient déjà uniquement cni_verified='pending' (et
  // uniquement ce candidat si `?userId=` est donné).
  return (
    <div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/candidates"
            className="rounded-full p-2 hover:bg-muted"
            aria-label={t.admin.candidateProfile.back}
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{t.admin.cni.title}</h1>
            <p className="text-sm text-muted-foreground">
              {t.admin.cni.subtitle}
            </p>
          </div>
        </div>

        {filterUserId && (
          <p className="text-xs text-muted-foreground">
            {t.admin.candidateProfile.filteredByUser}
          </p>
        )}

        <Card>
          <CardContent className="divide-y divide-border p-0">
            {profiles.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {t.admin.cni.empty}
              </p>
            )}
            {profiles.map((p) => {
              const color = "text-amber-600";
              return (
                <div key={p.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{nameOf(p)}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {t.admin.cni.cniNumber} :{" "}
                        <span className="font-medium text-foreground">
                          {p.cni_number ?? "—"}
                        </span>
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-sm ${color}`}
                    >
                      <Clock className="h-4 w-4" />
                      {t.admin.cni.pending}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(p)}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    {t.admin.cni.review}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <CniReviewModal
          profile={selected}
          canModerate={canModerate}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CniReviewModal({
  profile,
  canModerate,
  onClose,
  onDone,
}: {
  profile: CniProfile;
  canModerate: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [expiresAt, setExpiresAt] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  // URLs signées chargées à la volée (une par champ).
  const [urls, setUrls] = React.useState<
    Partial<Record<CniDocField, string | null>>
  >({});
  const [loadingField, setLoadingField] = React.useState<CniDocField | null>(
    null,
  );

  const loadDoc = React.useCallback(
    async (field: CniDocField) => {
      if (urls[field]) return;
      setLoadingField(field);
      try {
        const res = await fetch(
          `/api/admin/momo/${profile.id}/cni-url?field=${FIELD_TO_URL[field]}`,
        );
        const data: { url?: string } = await res.json();
        setUrls((prev) => ({
          ...prev,
          [field]: res.ok ? (data.url ?? null) : null,
        }));
      } catch {
        setUrls((prev) => ({ ...prev, [field]: null }));
      } finally {
        setLoadingField(null);
      }
    },
    [profile.id, urls],
  );

  const canApprove =
    canModerate && fullDoc(profile) && hasIdentityName(profile);

  const moderate = async (action: "approve" | "reject") => {
    setError("");
    if (action === "reject" && !rejectionReason.trim()) {
      setShowRejectForm(true);
      setError(t.admin.cni.rejectReasonRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/cni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          action,
          rejection_reason:
            action === "reject" ? rejectionReason.trim() : undefined,
          expires_at: action === "approve" && expiresAt ? expiresAt : undefined,
        }),
      });
      if (!res.ok) throw new Error(t.admin.cni.actionFailed);
      onDone();
    } catch {
      setError(t.admin.cni.actionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const documents = CNI_DOC_FIELDS.map((field) => {
    const has =
      field === "front"
        ? profile.has_cni_front
        : field === "back"
          ? profile.has_cni_back
          : profile.has_cni_selfie;
    const url = urls[field];
    return (
      <div key={field} className="space-y-1">
        <p className="text-xs text-muted-foreground">{t.admin.cni[field]}</p>
        {has ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadDoc(field)}
              disabled={loadingField === field}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#7C3AED] underline disabled:opacity-50"
            >
              {loadingField === field ? (
                <LoadingSpinner size="sm" />
              ) : url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {t.admin.cni.review}
                </a>
              ) : (
                t.admin.cni.review
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm text-amber-600">—</p>
        )}
      </div>
    );
  });

  return (
    <Modal open onClose={onClose} title={t.admin.cni.title}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {t.admin.cni.name}
          </p>
          <p className="font-medium">{nameOf(profile)}</p>
          {profile.date_of_birth && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t.admin.cni.dob} : {formatDate(profile.date_of_birth, locale)}
            </p>
          )}
          {profile.cni_number && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t.admin.cni.cniNumber} : {profile.cni_number}
            </p>
          )}
        </div>

        <div
          className={`rounded-lg border p-3 ${
            profile.cni_verified === "verified"
              ? "border-success/40 bg-success/5"
              : profile.cni_verified === "rejected"
                ? "border-red-300 bg-red-50/40"
                : "border-border bg-muted/30"
          }`}
        >
          <p className="text-sm text-muted-foreground mb-2">
            {t.admin.cni.cniNumber} / {t.admin.cni.review}
          </p>
          <div className="space-y-2">{documents}</div>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="warning">{t.admin.cni[statusOf(profile)]}</Badge>
            {profile.cni_expires_at && (
              <span className="text-sm text-muted-foreground">
                {t.admin.cni.expiresAt} :{" "}
                {formatDate(profile.cni_expires_at, locale)}
              </span>
            )}
          </div>
          {profile.cni_verified !== "verified" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t.admin.cni.deletionNote}
            </p>
          )}
        </div>

        {profile.cni_rejection_reason && (
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              {t.admin.cni.rejectionReason}
            </p>
            <p className="text-sm text-red-600">
              {profile.cni_rejection_reason}
            </p>
          </div>
        )}

        {canModerate && statusOf(profile) !== "verified" ? (
          <div className="space-y-2 pt-2">
            {canApprove && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t.admin.cni.expiresAt}{" "}
                  <span className="text-muted-foreground/70">
                    (optionnel — défaut : date de naissance + 10 ans)
                  </span>
                </p>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                />
              </div>
            )}
            {!canApprove && (
              <p className="flex items-start gap-1 text-sm text-amber-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {!fullDoc(profile)
                  ? `${t.admin.cni.noCni} — ${t.admin.cni.front}, ${t.admin.cni.back}, ${t.admin.cni.selfie} requis.`
                  : `${t.admin.cni.approve} indisponible : ${t.admin.cni.name} requis.`}
              </p>
            )}
            {showRejectForm && (
              <textarea
                className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                placeholder={t.admin.cni.rejectReasonPlaceholder}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() =>
                  showRejectForm ? moderate("reject") : setShowRejectForm(true)
                }
              >
                <XCircle className="mr-1 h-4 w-4" />
                {t.admin.cni.reject}
              </Button>
              <Button
                disabled={submitting || !canApprove}
                onClick={() => moderate("approve")}
              >
                {submitting ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    {t.admin.cni.approve}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.admin.cni.readOnly}
          </p>
        )}
      </div>
    </Modal>
  );
}
