"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  Star,
  Mail,
  Phone,
  ShieldOff,
  Pencil,
  MapPin,
  IdCard,
  Wallet,
  Star as StarIcon,
  FileText,
  Briefcase,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

/**
 * T8.4b — Profil candidat complet (client).
 *
 * Consomme `/api/admin/candidates/[id]` (lecture service_role). Vue en
 * lecture seule pour les 3 grades ; l'EDITION de l'identité (prénom /
 * nom / date de naissance) n'apparaît que si `canEdit` (= admin_founder)
 * et passe par `POST /api/admin/candidates/[id]/identity` → RPC
 * `admin_edit_candidate_identity`. Sur un CNI vérifié, le RPC remet
 * `cni_verified='pending'` + recompute `is_verified` (SRS §6.12).
 *
 * Les statuts documents (CNI / MoMo / compétences / documents) s'affichent
 * ici — c'est la section utilisateur de la vue centralisée (les pages de
 * revue ne garderont que « En attente », T8.4c). Les labels de statut
 * réutilisent les clés existantes (t.admin.cni / t.admin.momo /
 * t.profile.documents / t.profile.skillDocuments.status) ; seuls les
 * statuts mission + paiement et la chrome de la page sont des clés
 * nouvelles (admin.candidateProfile.*).
 */

type DocStatus = "pending" | "verified" | "rejected" | "expired";

type MissionStatus =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "en_route"
  | "arrived"
  | "validated"
  | "disputed";

type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "cancelled"
  | "partial"
  | "full";

interface CandidateProfilePayload {
  candidate: {
    id: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    is_verified: boolean;
    has_photo: boolean;
    identity: {
      first_name: string | null;
      last_name: string | null;
      gender: "male" | "female" | "other" | null;
      date_of_birth: string | null;
      bio: string | null;
    };
    location: {
      address: string | null;
      city: string | null;
      quartier: string | null;
    };
    cni: {
      number: string | null;
      status: "pending" | "verified" | "rejected" | null;
      expires_at: string | null;
      rejection_reason: string | null;
    };
    momo: {
      provider: "mtn" | "orange" | null;
      number: string | null;
      account_name: string | null;
      verified: boolean;
      reject_reason: string | null;
      verified_at: string | null;
    };
    stats: {
      total_missions: number;
      completed_missions: number;
      no_show_count: number;
      reliability_score: number;
      average_rating: number;
      sandbox_level: number;
      premium_until: string | null;
      created_at: string | null;
    };
  };
  skills: Array<{
    id: string;
    skill_name: string;
    skill_level: number;
    verification_status: string;
  }>;
  documents: Array<{
    id: string;
    document_type: string;
    title: string | null;
    status: DocStatus;
    rejection_reason: string | null;
  }>;
  missions: Array<{
    id: string;
    status: MissionStatus;
    payment_status: PaymentStatus;
    scheduled_date: string | null;
    job_title: string | null;
    job_city: string | null;
    company_name: string | null;
  }>;
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const tone =
    status === "verified" || status === "completed"
      ? "border-success/40 bg-success/10 text-success"
      : status === "rejected" || status === "failed" || status === "no_show"
        ? "border-red-500/40 bg-red-500/10 text-red-600"
        : status === "expired"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
          : "border-border bg-muted text-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-foreground">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2">
      <p className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold" title={value}>
        {value}
      </p>
    </div>
  );
}

export function CandidateProfileAdminClient({
  id,
  canEdit,
}: {
  id: string;
  canEdit: boolean;
}) {
  const { t, locale } = useI18n();
  const cp = t.admin.candidateProfile;
  const docTypes = t.profile.skillDocuments.documentTypes as Record<
    string,
    string
  >;
  const docStatus = t.profile.documents;
  const skillStatus = t.profile.skillDocuments.status;

  const { data, error, mutate } = useSWR<CandidateProfilePayload | null>(
    ["/api/admin/candidates", id],
    () =>
      fetch(`/api/admin/candidates/${id}`).then((r) =>
        r.ok ? r.json() : null,
      ),
  );

  const c = data?.candidate;

  const genderLabel = c?.identity.gender
    ? c.identity.gender === "male"
      ? cp.genderMale
      : c.identity.gender === "female"
        ? cp.genderFemale
        : cp.genderOther
    : "—";

  const locationLabel = React.useMemo(() => {
    if (!c) return "—";
    const parts = [
      c.location.city,
      c.location.quartier,
      c.location.address,
    ].filter((x) => typeof x === "string" && x.length > 0);
    return parts.length > 0 ? parts.join(", ") : cp.noLocation;
  }, [c, cp.noLocation]);

  if (!data && !error) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  }

  if (!c || error) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/candidates"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {cp.back}
        </Link>
        <p className="text-sm text-muted-foreground">{cp.notFound}</p>
      </div>
    );
  }

  const name =
    `${c.identity.first_name ?? ""} ${c.identity.last_name ?? ""}`.trim();

  return (
    <div className="space-y-4">
      <Link
        href="/admin/candidates"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {cp.back}
      </Link>

      {/* En-tête */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold">
                  {name || "—"}
                </h1>
                {c.is_verified && (
                  <Badge
                    variant="default"
                    className="shrink-0 bg-primary text-[10px]"
                  >
                    <Star className="ml-1 mr-0.5 h-3 w-3 fill-current" />
                    {t.admin.candidates.verifiedBadge}
                  </Badge>
                )}
                {!c.is_active && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600">
                    <ShieldOff className="h-3 w-3" />
                    {cp.suspended}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  {c.email ?? "—"}
                </span>
                {c.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {c.phone}
                  </span>
                )}
              </div>
            </div>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  document
                    .getElementById("identity-section")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <Pencil className="mr-1 h-4 w-4" />
                {cp.editTitle}
              </Button>
            )}
          </div>
          {!canEdit && (
            <p className="mt-2 text-xs text-muted-foreground">{cp.readOnly}</p>
          )}
        </CardContent>
      </Card>

      {/* Identité + édition */}
      <Card id="identity-section" className="border-border scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            {cp.identitySection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field
              label={cp.firstNameLabel}
              value={c.identity.first_name ?? "—"}
            />
            <Field
              label={cp.lastNameLabel}
              value={c.identity.last_name ?? "—"}
            />
            <Field label={cp.genderLabel} value={genderLabel} />
            <Field
              label={cp.dobLabel}
              value={
                c.identity.date_of_birth
                  ? formatDate(c.identity.date_of_birth, locale)
                  : "—"
              }
            />
          </div>
          <Field label={cp.locationLabel} value={locationLabel} />
          <div className="text-sm">
            <p className="text-muted-foreground">{cp.bioLabel}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">
              {c.identity.bio ?? cp.noBio}
            </p>
          </div>

          {canEdit && (
            <IdentityEditForm
              id={id}
              cniVerified={c.cni.status === "verified"}
              initial={{
                first_name: c.identity.first_name ?? "",
                last_name: c.identity.last_name ?? "",
                date_of_birth: c.identity.date_of_birth ?? "",
              }}
              cp={cp}
              onSave={() => mutate()}
            />
          )}
        </CardContent>
      </Card>

      {/* CNI + MoMo */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard className="h-4 w-4 text-primary" />
              {cp.cniSection}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {cp.cniSection}
              </span>
              <StatusPill
                label={t.admin.cni[c.cni.status ?? "pending"]}
                status={c.cni.status ?? "pending"}
              />
            </div>
            <Field label={t.admin.cni.cniNumber} value={c.cni.number ?? "—"} />
            {c.cni.expires_at && (
              <Field
                label={t.admin.cni.expiresAt}
                value={formatDate(c.cni.expires_at, locale)}
              />
            )}
            {c.cni.rejection_reason && (
              <Field
                label={t.admin.cni.rejectionReason}
                value={c.cni.rejection_reason}
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              {cp.momoSection}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {cp.momoSection}
              </span>
              <StatusPill
                label={
                  c.momo.verified
                    ? t.admin.momo.verified
                    : c.momo.reject_reason
                      ? t.admin.momo.rejected
                      : t.admin.momo.pending
                }
                status={
                  c.momo.verified
                    ? "verified"
                    : c.momo.reject_reason
                      ? "rejected"
                      : "pending"
                }
              />
            </div>
            {c.momo.number && (
              <Field
                label={t.admin.momo.number}
                value={`${
                  c.momo.provider === "orange"
                    ? t.admin.momo.orange
                    : t.admin.momo.mtn
                } · ${c.momo.number}`}
              />
            )}
            <Field
              label={cp.momoAccountName}
              value={c.momo.account_name ?? cp.noMomoAccountName}
            />
            {c.momo.verified_at && (
              <Field
                label={t.admin.momo.verifiedLabel}
                value={formatDate(c.momo.verified_at, locale)}
              />
            )}
            {c.momo.reject_reason && (
              <Field
                label={t.admin.momo.rejectionReason}
                value={c.momo.reject_reason}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Statistiques */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {cp.statsSection}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={cp.statTotal} value={String(c.stats.total_missions)} />
            <Stat
              label={cp.statCompleted}
              value={String(c.stats.completed_missions)}
            />
            <Stat
              label={cp.statNoShows}
              value={String(c.stats.no_show_count)}
            />
            <Stat
              label={cp.statReliability}
              value={String(c.stats.reliability_score)}
            />
            <Stat
              label={cp.statRating}
              value={String(c.stats.average_rating)}
            />
            <Stat
              label={cp.statSandbox}
              value={String(c.stats.sandbox_level)}
            />
            <Stat
              label={cp.premiumLabel}
              value={
                c.stats.premium_until
                  ? `${cp.premiumUntil} ${formatDate(c.stats.premium_until, locale)}`
                  : cp.premiumNone
              }
            />
            <Stat
              label={cp.createdAt}
              value={
                c.stats.created_at
                  ? formatDate(c.stats.created_at, locale)
                  : "—"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Compétences */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StarIcon className="h-4 w-4 text-primary" />
            {cp.skillsSection}
            <span className="text-xs font-normal text-muted-foreground">
              ({data.skills.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{cp.noSkills}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.skills.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {s.skill_name}
                    {typeof s.skill_level === "number" && s.skill_level > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        N{s.skill_level}
                      </span>
                    )}
                  </span>
                  <StatusPill
                    label={
                      skillStatus[
                        s.verification_status as keyof typeof skillStatus
                      ] ?? s.verification_status
                    }
                    status={s.verification_status}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Documents */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {cp.documentsSection}
            <span className="text-xs font-normal text-muted-foreground">
              ({data.documents.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{cp.noDocuments}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {docTypes[d.document_type] ?? d.document_type}
                    {d.title ? ` · ${d.title}` : ""}
                  </span>
                  <StatusPill
                    label={
                      docStatus[d.status as keyof typeof docStatus] ?? d.status
                    }
                    status={d.status}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Missions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            {cp.missionsSection}
            <span className="text-xs font-normal text-muted-foreground">
              ({data.missions.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.missions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{cp.noMissions}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.missions.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {m.job_title ?? m.company_name ?? "—"}
                      {m.job_city ? ` · ${m.job_city}` : ""}
                    </p>
                    {m.scheduled_date && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(m.scheduled_date, locale)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <StatusPill
                      label={
                        cp.missionStatuses[
                          m.status as keyof typeof cp.missionStatuses
                        ] ?? m.status
                      }
                      status={m.status}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** T8.4b — Formulaire d'édition identité (admin_founder uniquement).
 *  L'état est initialisé au MOUNT via le prop `initial` (pas d'effet +
 *  setState : la donnée est déjà chargée avant le rendu du form, car la
 *  branche `!c` rend un spinner en amont). POST → RPC
 *  `admin_edit_candidate_identity` ; re-charge via `onSave` (mutate). */
function IdentityEditForm({
  id,
  cniVerified,
  initial,
  cp,
  onSave,
}: {
  id: string;
  cniVerified: boolean;
  initial: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
  };
  cp: {
    identitySection: string;
    firstNameLabel: string;
    lastNameLabel: string;
    dobLabel: string;
    editHint: string;
    editResetNotice: string;
    save: string;
    saved: string;
    saveFailed: string;
  };
  onSave: () => void;
}) {
  const [firstName, setFirstName] = React.useState(initial.first_name);
  const [lastName, setLastName] = React.useState(initial.last_name);
  const [dob, setDob] = React.useState(initial.date_of_birth);
  const [saving, setSaving] = React.useState(false);
  const [flash, setFlash] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFlash(null);
    const res = await fetch(`/api/admin/candidates/${id}/identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setFlash(cp.saveFailed);
      return;
    }
    onSave();
    setFlash(cp.saved);
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <p className="text-xs text-muted-foreground">{cp.editHint}</p>
      {cniVerified && (
        <p className="text-xs text-amber-600">{cp.editResetNotice}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label>{cp.firstNameLabel}</Label>
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{cp.lastNameLabel}</Label>
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{cp.dobLabel}</Label>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving}>
          {cp.save}
        </Button>
        {flash && <span className="text-xs text-foreground">{flash}</span>}
      </div>
    </form>
  );
}
