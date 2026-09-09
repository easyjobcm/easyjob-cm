"use client";

import * as React from "react";
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
}

const STATUS_FILTERS: { key: MomoStatus; icon: React.ElementType }[] = [
  { key: "pending", icon: Clock },
  { key: "verified", icon: CheckCircle2 },
  { key: "rejected", icon: XCircle },
];

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
}: MomoAdminClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [filter, setFilter] = React.useState<MomoStatus>("pending");
  const [selected, setSelected] = React.useState<MomoProfile | null>(null);

  const counts = React.useMemo(
    () =>
      STATUS_FILTERS.reduce<Record<MomoStatus, number>>(
        (acc, s) => {
          acc[s.key] = profiles.filter((p) => statusOf(p) === s.key).length;
          return acc;
        },
        { pending: 0, verified: 0, rejected: 0 },
      ),
    [profiles],
  );

  const filtered = React.useMemo(
    () => profiles.filter((p) => statusOf(p) === filter),
    [profiles, filter],
  );

  return (
    <div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-full p-2 hover:bg-muted"
            aria-label={t.admin.momo.title}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{t.admin.momo.title}</h1>
            <p className="text-sm text-muted-foreground">
              {t.admin.momo.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                filter === key
                  ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                  : "border-input text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.admin.momo[key]}
              <span
                className={`ml-0.5 rounded-full px-1.5 text-xs ${
                  filter === key ? "bg-[#7C3AED]/15 text-[#7C3AED]" : "bg-muted"
                }`}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="divide-y divide-border p-0">
            {filtered.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {filter === "verified"
                  ? t.admin.momo.emptyVerified
                  : filter === "rejected"
                    ? t.admin.momo.emptyRejected
                    : t.admin.momo.empty}
              </p>
            )}
            {filtered.map((p) => {
              const Icon =
                STATUS_FILTERS.find((s) => s.key === statusOf(p))?.icon ??
                Clock;
              const color =
                statusOf(p) === "verified"
                  ? "text-emerald-600"
                  : statusOf(p) === "rejected"
                    ? "text-red-600"
                    : "text-amber-600";
              return (
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
                    <span
                      className={`inline-flex items-center gap-1 text-sm ${color}`}
                    >
                      <Icon className="h-4 w-4" />
                      {t.admin.momo[statusOf(p)]}
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
              );
            })}
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
  const { t } = useI18n();
  const { locale } = useI18n();
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
      const data = await res.json();
      if (res.ok) setCniUrl(data.url);
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
