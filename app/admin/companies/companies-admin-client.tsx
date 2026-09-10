"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  Search,
  Star,
  UserX,
  UserCheck,
  Mail,
  Phone,
  MapPin,
  Building2,
  ShieldOff,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";

/**
 * T8.4a — Vue centralisée des entreprises (client).
 *
 * Consomme `/api/admin/companies` (lecture service_role, recherche libre
 * `?q=`). Sections En attente / Validées / Suspendues :
 *   - Suspendues : users.is_active = false (gate de publication §6.19)
 *   - Validées   : company_profiles.verification_status = 'verified' ET actif
 *   - En attente : pending ET rejected (le refus n'est pas supprimé —
 *     ré-émition possible, SRS §6.14.4)
 */

type SectionKey = "pending" | "verified" | "suspended";

interface Company {
  id: string;
  is_active: boolean;
  user_id: string | null;
  is_verified: boolean;
  company_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  verification_status: "pending" | "verified" | "rejected" | null;
  verification_rejection_reason: string | null;
  has_logo: boolean;
  created_at: string | null;
}

interface CompaniesClientProps {
  canModerate: boolean;
  fromDashboard?: boolean;
}

function sectionOf(c: Company): SectionKey {
  if (!c.is_active) return "suspended";
  if (c.verification_status === "verified") return "verified";
  return "pending";
}

function verificationLabel(
  c: Company,
  labels: {
    pending: string;
    verified: string;
    rejected: string | null;
    none: string;
  },
): { status: "pending" | "verified" | "rejected" | "none"; label: string } {
  if (c.verification_status === "verified")
    return { status: "verified", label: labels.verified };
  if (c.verification_status === "rejected")
    return {
      status: "rejected",
      label: labels.rejected ?? labels.pending,
    };
  if (c.verification_status === "pending")
    return { status: "pending", label: labels.pending };
  return { status: "none", label: labels.none };
}

/** Logo avec fallback initiales. */
function CompanyAvatar({
  company,
  size = 44,
}: {
  company: Company;
  size?: number;
}) {
  const initials = (company.company_name ?? "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  // L'URL signée du logo passera par un endpoint dédié (T8.4b) ; en
  // l'absence, les initiales (aucun chemin brut jamais renvoyé).
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 select-none items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary ring-2 ring-primary/10"
    >
      {initials ? initials : <Building2 className="h-5 w-5" />}
    </div>
  );
}

export function CompaniesAdminClient({
  canModerate,
  fromDashboard,
}: CompaniesClientProps) {
  const { t } = useI18n();
  const tr = t.admin.companies;
  const momoLabels = t.admin.momo;
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [active, setActive] = React.useState<SectionKey>("pending");

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isLoading, mutate } = useSWR<{ companies: Company[] } | null>(
    ["/api/admin/companies", debouncedQ],
    () =>
      fetch(
        `/api/admin/companies${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ""}`,
      ).then((r) => (r.ok ? r.json() : null)),
  );
  const companies = React.useMemo(() => data?.companies ?? [], [data]);

  const grouped = React.useMemo(() => {
    const g: Record<SectionKey, Company[]> = {
      pending: [],
      verified: [],
      suspended: [],
    };
    for (const c of companies) g[sectionOf(c)].push(c);
    g.pending.sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
    return g;
  }, [companies]);

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

  const moderate = async (c: Company, action: "suspend" | "activate") => {
    const message =
      action === "suspend" ? tr.suspendConfirm : tr.activateConfirm;
    if (!window.confirm(message)) return;
    const res = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: c.id, action }),
    });
    if (res.ok) mutate();
  };

  const renderCard = (c: Company) => {
    const v = verificationLabel(c, {
      pending: momoLabels.pending,
      verified: momoLabels.verified,
      rejected: momoLabels.rejected,
      none: tr.noContact,
    });
    const vColor =
      v.status === "verified"
        ? "text-emerald-600"
        : v.status === "rejected"
          ? "text-red-600"
          : "text-amber-600";
    const Icon =
      v.status === "verified"
        ? CheckCircle2
        : v.status === "rejected"
          ? XCircle
          : Clock;

    return (
      <Card key={c.user_id ?? c.id} className="border-border">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <CompanyAvatar company={c} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-foreground">
                  {c.company_name ?? c.contact_name ?? "—"}
                </p>
                {v.status === "verified" && (
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
                  <span className="truncate">
                    {c.contact_email ?? (c.contact_phone ? tr.noContact : "—")}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span>{c.contact_phone ?? "—"}</span>
                </span>
                {c.city && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{c.city}</span>
                  </span>
                )}
              </div>
            </div>
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

          {/* Statut de vérification affiché sur la section utilisateur */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                v.status === "verified"
                  ? "border-success/40 bg-success/10 text-success"
                  : v.status === "rejected"
                    ? "border-red-500/40 bg-red-500/10 text-red-600"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-600"
              }`}
            >
              <Icon className={`h-3 w-3 ${vColor}`} />
              {v.label}
            </span>
            {c.verification_rejection_reason && (
              <span
                className="text-[11px] text-red-600/80"
                title={c.verification_rejection_reason}
              >
                {c.verification_rejection_reason}
              </span>
            )}
            {!c.is_active && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600">
                <ShieldOff className="h-3 w-3" />
                {tr.sectionSuspended}
              </span>
            )}
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

      {isLoading && companies.length === 0 ? (
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
