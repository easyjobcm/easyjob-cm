"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Eye, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

type MomoStatus = "pending" | "verified" | "rejected";

interface MomoProfile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  momo_provider: "mtn" | "orange" | null;
  momo_number: string | null;
  momo_account_name: string | null;
  momo_verified: boolean | null;
  momo_reject_reason: string | null;
  momo_verified_at: string | null;
  momo_verified_by: string | null;
  verifier_phone: string | null;
  has_cni: boolean;
  cni_verified: "pending" | "verified" | "rejected" | null;
  cni_number: string | null;
}

interface MomoAdminClientProps {
  profiles: MomoProfile[];
  canModerate: boolean;
  /** T8.4c — filtre `?userId=` : l'admin arrive depuis la carte du
   *  candidat, on ne lui affiche que le MoMo de cet utilisateur. */
  filterUserId?: string | null;
}

function statusOf(p: MomoProfile): MomoStatus {
  if (p.momo_verified) return "verified";
  if (p.momo_reject_reason) return "rejected";
  return "pending";
}

function providerLabel(
  provider: "mtn" | "orange" | null,
  t: {
    admin: { momo: { mtn: string; orange: string } };
  },
): string {
  if (provider === "mtn") return t.admin.momo.mtn;
  if (provider === "orange") return t.admin.momo.orange;
  return "—";
}

function declaredName(p: MomoProfile): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
}

export function MomoAdminClient({
  profiles,
  canModerate,
  filterUserId,
}: MomoAdminClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [selected, setSelected] = React.useState<MomoProfile | null>(null);

  // T8.4c : liste « En attente » uniquement — le filtre SSR garantit
  // que `profiles` contient déjà uniquement momo_verified=false sans
  // motif de refus (et uniquement ce candidat si `?userId=` est donné).
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
            <h1 className="text-lg font-semibold">{t.admin.momo.title}</h1>
            <p className="text-sm text-muted-foreground">
              {t.admin.momo.subtitle}
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
                {t.admin.momo.empty}
              </p>
            )}
            {profiles.map((p) => (
              <div key={p.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{declaredName(p)}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {providerLabel(p.momo_provider, t)} · {p.momo_number} ·{" "}
                      {t.admin.momo.accountName} :{" "}
                      <span className="font-medium text-foreground">
                        {p.momo_account_name ?? "—"}
                      </span>
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm text-amber-600">
                    <Clock className="h-4 w-4" />
                    {t.admin.momo.pending}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(p)}
                >
                  <Eye className="mr-1 h-4 w-4" />
                  {t.admin.momo.review}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <ReviewModal
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

function ReviewModal({
  profile,
  canModerate,
  onClose,
  onDone,
}: {
  profile: MomoProfile;
  canModerate: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [cniUrl, setCniUrl] = React.useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = React.useState(false);

  const loadCniUrl = React.useCallback(async () => {
    setLoadingUrl(true);
    try {
      const res = await fetch(
        `/api/admin/momo/${profile.id}/cni-url?field=cni_front_url`,
      );
      const data: { url?: string } = await res.json();
      if (res.ok) setCniUrl(data.url ?? null);
      else setCniUrl(null);
    } catch {
      setCniUrl(null);
    } finally {
      setLoadingUrl(false);
    }
  }, [profile.id]);

  const moderate = async (action: "approve" | "reject") => {
    setError("");
    if (action === "reject" && !rejectionReason.trim()) {
      setShowRejectForm(true);
      setError(t.admin.momo.rejectReasonRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/momo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          action,
          rejection_reason: rejectionReason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(t.admin.momo.actionFailed);
      onDone();
    } catch {
      setError(t.admin.momo.actionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t.admin.momo.title}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {t.admin.momo.accountName}
          </p>
          <p className="font-medium">{profile.momo_account_name ?? "—"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {providerLabel(profile.momo_provider, t)} · {profile.momo_number}
          </p>
        </div>

        <div
          className={`rounded-lg border p-3 ${
            profile.cni_verified === "verified"
              ? "border-success/40 bg-success/5"
              : "border-border bg-muted/30"
          }`}
        >
          <p className="text-sm text-muted-foreground">
            {t.admin.momo.cniName}
          </p>
          <p className="font-medium">{declaredName(profile)}</p>
          {profile.cni_number && (
            <p className="mt-1 text-sm text-muted-foreground">
              N° CNI : {profile.cni_number}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="warning">
              {t.admin.momo.cniStatus} :{" "}
              {profile.cni_verified
                ? t.admin.momo[
                    profile.cni_verified === "verified"
                      ? "verified"
                      : profile.cni_verified === "rejected"
                        ? "rejected"
                        : "pending"
                  ]
                : "—"}
            </Badge>
            {profile.has_cni && (
              <button
                type="button"
                onClick={loadCniUrl}
                disabled={loadingUrl}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#7C3AED] underline disabled:opacity-50"
              >
                {loadingUrl ? (
                  <LoadingSpinner size="sm" />
                ) : cniUrl ? (
                  <a href={cniUrl} target="_blank" rel="noreferrer">
                    {t.admin.momo.review}
                  </a>
                ) : (
                  t.admin.momo.review
                )}
              </button>
            )}
          </div>
        </div>

        {profile.momo_reject_reason && (
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              {t.admin.momo.rejectionReason}
            </p>
            <p className="text-sm text-red-600">{profile.momo_reject_reason}</p>
          </div>
        )}

        {profile.momo_verified_at && (
          <p className="text-sm text-muted-foreground">
            {t.admin.momo.verifiedLabel}{" "}
            {formatDate(profile.momo_verified_at, locale)}
            {profile.verifier_phone && ` · ${profile.verifier_phone}`}
          </p>
        )}

        {canModerate && statusOf(profile) !== "verified" ? (
          <div className="space-y-2 pt-2">
            {showRejectForm && (
              <textarea
                className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                placeholder={t.admin.momo.rejectReasonPlaceholder}
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
                {t.admin.momo.reject}
              </Button>
              <Button disabled={submitting} onClick={() => moderate("approve")}>
                {submitting ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    {t.admin.momo.approve}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {!canModerate && (
          <p className="text-sm text-muted-foreground">
            {t.admin.momo.readOnly}
          </p>
        )}
      </div>
    </Modal>
  );
}
