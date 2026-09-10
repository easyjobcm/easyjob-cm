"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  Search,
  Star,
  Eye,
  IdCard,
  Wallet,
  FileText,
  UserX,
  UserCheck,
  Mail,
  Phone,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";

/**
 * T8.4a — Vue centralisée des candidats (client).
 *
 * Consomme `/api/admin/candidates` (lecture service_role, recherche libre
 * `?q=`). Sections En attente / Validés / Suspendus :
 *   - Suspendus  : is_active = false (users) — gate de postulation (§6.19)
 *   - Validés    : is_verified = true (recompute T8.3) et compte actif
 *   - En attente : tout le reste (y compris les refus — SRS §6.14.4 :
 *     le compte n'est pas supprimé, le candidat ré-émet ; les fichiers
 *     rejetés sont purgés par T8.4c)
 *
 * La photo de profil n'est jamais servie en clair : la carte échange le
 * `profile_id` contre une URL signée 60 s via
 * `/api/admin/profiles/[profileId]/photo-url` (chargement paresseux).
 */

type DocStatus = "pending" | "verified" | "rejected" | "none";
type SectionKey = "pending" | "verified" | "suspended";

interface Candidate {
  id: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string | null;
  profile_id: string | null;
  first_name: string | null;
  last_name: string | null;
  has_photo: boolean;
  momo_provider: "mtn" | "orange" | null;
  momo_number: string | null;
  momo_verified: boolean | null;
  momo_reject_reason: string | null;
  cni_verified: "pending" | "verified" | "rejected" | null;
  cni_expires_at: string | null;
  cni_number: string | null;
  cni_rejection_reason: string | null;
}

interface CandidatesClientProps {
  canModerate: boolean;
  /** Affiche le lien « retour » (utilisé depuis le dashboard). */
  fromDashboard?: boolean;
}

function sectionOf(c: Candidate): SectionKey {
  if (!c.is_active) return "suspended";
  if (c.is_verified) return "verified";
  return "pending";
}

function momoStatus(c: Candidate): DocStatus {
  if (c.momo_verified) return "verified";
  if (c.momo_reject_reason) return "rejected";
  if (c.momo_number) return "pending";
  return "none";
}

function cniStatus(c: Candidate): DocStatus {
  if (!c.cni_verified && !c.cni_number) return "none";
  return c.cni_verified ?? "none";
}

/** Avatar avec photo signée 1:1 (60 s) + fallback initiales. */
function CandidateAvatar({
  candidate,
  size = 44,
}: {
  candidate: Candidate;
  size?: number;
}) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!candidate.has_photo || !candidate.profile_id) return;
    let alive = true;
    fetch(`/api/admin/profiles/${candidate.profile_id}/photo-url`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.url) setUrl(d.url as string);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [candidate.has_photo, candidate.profile_id]);

  const initials =
    `${candidate.first_name?.[0] ?? ""}${candidate.last_name?.[0] ?? ""}`.toUpperCase();

  if (url) {
    // Image chargée dynamiquement (pas d'<img> statique Next).
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-2 ring-primary/20"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-2 ring-primary/10"
    >
      {initials || "—"}
    </div>
  );
}

/** Pastille de statut d'un justificatif (CNI / MoMo). */
function DocBadge({
  label,
  status,
  labels,
}: {
  label: string;
  status: DocStatus;
  labels: Record<DocStatus, string>;
}) {
  const Icon =
    status === "verified"
      ? CheckCircle2
      : status === "rejected"
        ? XCircle
        : Clock;
  const tone =
    status === "verified"
      ? "border-success/40 bg-success/10 text-success"
      : status === "rejected"
        ? "border-red-500/40 bg-red-500/10 text-red-600"
        : "border-amber-500/40 bg-amber-500/10 text-amber-600";
  const iconTone =
    status === "verified"
      ? "text-current"
      : status === "rejected"
        ? "text-current"
        : "text-current";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={label}
    >
      <Icon className={`h-3 w-3 ${iconTone}`} />
      {label} · {labels[status]}
    </span>
  );
}

export function CandidatesAdminClient({
  canModerate,
  fromDashboard,
}: CandidatesClientProps) {
  const { t } = useI18n();
  const tr = t.admin.candidates;
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [active, setActive] = React.useState<SectionKey>("pending");

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isLoading, mutate } = useSWR<{
    candidates: Candidate[];
  } | null>(["/api/admin/candidates", debouncedQ], () =>
    fetch(
      `/api/admin/candidates${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ""}`,
    ).then((r) => (r.ok ? r.json() : null)),
  );
  const candidates = React.useMemo(() => data?.candidates ?? [], [data]);

  const grouped = React.useMemo(() => {
    const g: Record<SectionKey, Candidate[]> = {
      pending: [],
      verified: [],
      suspended: [],
    };
    for (const c of candidates) g[sectionOf(c)].push(c);
    // Les plus anciens en tête (jamais revus en priorité).
    g.pending.sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
    return g;
  }, [candidates]);

  const counts: Record<SectionKey, number> = {
    pending: grouped.pending.length,
    verified: grouped.verified.length,
    suspended: grouped.suspended.length,
  };

  const emptyLabels: Record<SectionKey, string> = {
    pending: tr.emptyPending,
    verified: tr.emptyVerified,
    suspended: tr.emptySuspended,
  };
  const sectionLabels: Record<SectionKey, string> = {
    pending: tr.sectionPending,
    verified: tr.sectionVerified,
    suspended: tr.sectionSuspended,
  };

  const moderate = async (c: Candidate, action: "suspend" | "activate") => {
    const message =
      action === "suspend" ? tr.suspendConfirm : tr.activateConfirm;
    if (!window.confirm(message)) return;
    const res = await fetch("/api/admin/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: c.id, action }),
    });
    if (res.ok) mutate();
  };

  const renderCard = (c: Candidate) => {
    const momo = momoStatus(c);
    const cni = cniStatus(c);
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    const cniLabels: Record<DocStatus, string> = {
      pending: t.admin.cni.pending,
      verified: t.admin.cni.verified,
      rejected: t.admin.cni.rejected,
      none: t.admin.cni.notProvided,
    };
    const momoLabels: Record<DocStatus, string> = {
      pending: t.admin.momo.pending,
      verified: t.admin.momo.verified,
      rejected: t.admin.momo.rejected,
      none: tr.noMomo,
    };

    return (
      <Card key={c.id} className="border-border">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <CandidateAvatar candidate={c} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-foreground">
                  {name || "—"}
                </p>
                {c.is_verified && (
                  <Badge
                    variant="default"
                    className="shrink-0 whitespace-nowrap bg-primary text-[10px]"
                  >
                    <Star className="ml-1 mr-0.5 h-3 w-3 fill-current" />
                    {tr.verifiedBadge}
                  </Badge>
                )}
              </div>

              <div className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.email ?? "—"}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {momo === "none"
                      ? tr.noMomo
                      : `${
                          c.momo_provider === "orange"
                            ? t.admin.momo.orange
                            : t.admin.momo.mtn
                        } · ${c.momo_number}`}
                  </span>
                </span>
                {c.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span>{c.phone}</span>
                  </span>
                )}
              </div>
            </div>
            {/* Suspendre / Réactiver (ops + founder) */}
            {canModerate && (
              <Button
                variant="outline"
                size="sm"
                className={!c.is_active ? "border-success/50 text-success" : ""}
                onClick={() =>
                  moderate(c, c.is_active ? "suspend" : "activate")
                }
              >
                {c.is_active ? (
                  <UserX className="mr-1 h-4 w-4" />
                ) : (
                  <UserCheck className="mr-1 h-4 w-4" />
                )}
                {c.is_active ? tr.suspend : tr.activate}
              </Button>
            )}
          </div>

          {/* Statuts documents affichés sur la section utilisateur */}
          <div className="flex flex-wrap gap-1.5">
            <DocBadge label="CNI" status={cni} labels={cniLabels} />
            <DocBadge label="MoMo" status={momo} labels={momoLabels} />
            {!c.is_active && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600">
                <ShieldOff className="h-3 w-3" />
                {tr.sectionSuspended}
              </span>
            )}
          </div>

          {/* Navigation vers les revues + profil */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {c.profile_id && (
              <Link href={`/admin/candidates/${c.id}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  {tr.viewProfile}
                </Button>
              </Link>
            )}
            <Link href={`/admin/cni?userId=${c.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <IdCard className="h-3.5 w-3.5" />
                {tr.btnCni}
              </Button>
            </Link>
            <Link href={`/admin/momo?userId=${c.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                {tr.btnMomo}
              </Button>
            </Link>
            <Link href={`/admin/skill-documents?userId=${c.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                {tr.btnDocuments}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSection = (key: SectionKey) => {
    const list = grouped[key];
    return (
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {sectionLabels[key]}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {counts[key]}
          </span>
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
            {debouncedQ ? tr.noResults : emptyLabels[key]}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {list.map(renderCard)}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 pb-10 pt-6">
      {fromDashboard && (
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
      )}

      <div>
        <h1 className="text-xl font-bold text-foreground">{tr.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr.subtitle}</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr.searchPlaceholder}
          className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
        />
      </div>

      {/* Sélecteur de section */}
      <div className="flex flex-wrap gap-2">
        {(["pending", "verified", "suspended"] as SectionKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
              active === key
                ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                : "border-input text-muted-foreground hover:bg-muted"
            }`}
          >
            {sectionLabels[key]}
            <span
              className={`rounded-full px-1.5 text-xs ${
                active === key ? "bg-[#7C3AED]/15" : "bg-muted"
              }`}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {isLoading && candidates.length === 0 ? (
        <div className="flex justify-center py-10">
          <LoadingSpinner />
        </div>
      ) : (
        renderSection(active)
      )}

      {!canModerate && (
        <p className="text-xs text-muted-foreground">{tr.readOnly}</p>
      )}
    </div>
  );
}
