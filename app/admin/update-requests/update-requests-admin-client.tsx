"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  FileEdit,
  Ban,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { UpdateRequestModal } from "@/components/admin/update-request-modal";

/**
 * T8.5 — Revue des mises à jour de profil (client).
 *
 * Liste `GET /api/admin/profile-update-requests` (SWR), sections
 * En attente / Exécutées / Annulées (le statut `done` est posé
 * automatiquement par le candidat, jamais par l'admin). Actions admin :
 * annuler (`PATCH`) une demande `pending`, purger (`DELETE`) une
 * demande clôturée (`done`/`cancelled`) — jamais une `pending` (elle
 * déverrouille les champs du candidat, annulation d'abord).
 */

type ReqStatus = "pending" | "done" | "cancelled";
type SectionKey = ReqStatus | "all";

interface UpdateRequest {
  id: string;
  candidate_id: string;
  fields: string[];
  status: ReqStatus;
  reason: string | null;
  requested_by: string | null;
  created_at: string;
  completed_at: string | null;
  requester_email: string | null;
  candidate: { first_name: string | null; last_name: string | null } | null;
}

const SECTIONS: { key: SectionKey; icon: React.ElementType }[] = [
  { key: "pending", icon: Clock },
  { key: "done", icon: CheckCircle2 },
  { key: "cancelled", icon: XCircle },
  { key: "all", icon: FileEdit },
];

function candidateName(r: UpdateRequest): string {
  return (
    `${r.candidate?.first_name ?? ""} ${r.candidate?.last_name ?? ""}`.trim() ||
    "—"
  );
}

async function fetchRequests(): Promise<{ requests: UpdateRequest[] }> {
  const r = await fetch("/api/admin/profile-update-requests", {
    cache: "no-store",
  });
  const json: { requests?: UpdateRequest[] } = await r.json();
  return { requests: json.requests ?? [] };
}

export function UpdateRequestsAdminClient({
  canModerate,
}: {
  canModerate: boolean;
}) {
  const { t, locale } = useI18n();
  const [section, setSection] = React.useState<SectionKey>("pending");
  const [modalOpen, setModalOpen] = React.useState(false);
  const { data, isLoading, error, mutate } = useSWR(
    "/api/admin/profile-update-requests",
    fetchRequests,
  );

  const requests = data?.requests ?? [];
  const counts = SECTIONS.reduce<Record<SectionKey, number>>(
    (acc, s) => {
      acc[s.key] =
        s.key === "all"
          ? requests.length
          : requests.filter((r) => r.status === s.key).length;
      return acc;
    },
    { pending: 0, done: 0, cancelled: 0, all: 0 },
  );
  const visible = requests.filter(
    (r) => section === "all" || r.status === section,
  );

  const act = async (id: string, verb: "cancel" | "delete") => {
    const confirmMsg =
      verb === "cancel"
        ? t.admin.updateRequests.cancelConfirm
        : t.admin.updateRequests.deleteConfirm;
    if (!window.confirm(confirmMsg)) return;
    const r = await fetch(`/api/admin/profile-update-requests/${id}`, {
      method: verb === "cancel" ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body:
        verb === "cancel" ? JSON.stringify({ status: "cancelled" }) : undefined,
    });
    if (!r.ok) {
      // L'action a échoué — on rafraîchit quand même pour resynchro.
      mutate();
      return;
    }
    mutate();
  };

  const statusLabel = (s: ReqStatus) => t.admin.updateRequests[s];
  const statusColor = (s: ReqStatus) =>
    s === "pending"
      ? "text-amber-600"
      : s === "done"
        ? "text-emerald-600"
        : "text-muted-foreground";
  const StatusIcon = (s: ReqStatus) =>
    s === "pending" ? Clock : s === "done" ? CheckCircle2 : XCircle;

  return (
    <div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded-full p-2 hover:bg-muted"
            aria-label={t.admin.updateRequests.back}
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">
              {t.admin.updateRequests.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t.admin.updateRequests.subtitle}
            </p>
          </div>
          <Button
            className="ml-auto shrink-0"
            size="sm"
            disabled={!canModerate}
            onClick={() => setModalOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t.admin.updateRequests.createTitle}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SECTIONS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                section === key
                  ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                  : "border-input text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {key === "all" ? t.admin.updateRequests.all : statusLabel(key)}
              <span
                className={`ml-0.5 rounded-full px-1.5 text-xs ${
                  section === key
                    ? "bg-[#7C3AED]/15 text-[#7C3AED]"
                    : "bg-muted"
                }`}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="divide-y divide-border p-0">
            {error && (
              <p className="p-4 text-sm text-red-600">
                {t.admin.updateRequests.actionFailed}
              </p>
            )}
            {!error && isLoading && (
              <div className="p-4">
                <LoadingSpinner size="sm" />
              </div>
            )}
            {!error && !isLoading && visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {t.admin.updateRequests.empty}
              </p>
            )}
            {!error &&
              !isLoading &&
              visible.map((r) => {
                const Icon = StatusIcon(r.status);
                return (
                  <div key={r.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{candidateName(r)}</p>
                        <p className="text-sm text-muted-foreground">
                          {t.admin.updateRequests.fieldsLabel} :{" "}
                          <span className="font-medium text-foreground">
                            {r.fields
                              .map((f) =>
                                f === "identity"
                                  ? t.admin.updateRequests.fieldIdentity
                                  : t.admin.updateRequests.fieldCniDocuments,
                              )
                              .join(", ")}
                          </span>
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {t.admin.updateRequests.reasonLabel} :{" "}
                          {r.reason ?? t.admin.updateRequests.noReason}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.admin.updateRequests.requestedAt}{" "}
                          {formatDate(r.created_at, locale)}
                          {r.requester_email &&
                            ` · ${t.admin.updateRequests.requestedBy} ${r.requester_email}`}
                        </p>
                        {r.completed_at && (
                          <p className="text-xs text-muted-foreground">
                            {t.admin.updateRequests.completedAt}{" "}
                            {formatDate(r.completed_at, locale)}
                          </p>
                        )}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 text-sm ${statusColor(
                          r.status,
                        )}`}
                      >
                        <Icon className="h-4 w-4" />
                        {statusLabel(r.status)}
                      </span>
                    </div>

                    {canModerate &&
                      (r.status === "pending" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => act(r.id, "cancel")}
                        >
                          <Ban className="mr-1 h-4 w-4" />
                          {t.admin.updateRequests.cancel}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => act(r.id, "delete")}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          {t.admin.updateRequests.delete}
                        </Button>
                      ))}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>

      {modalOpen && (
        <UpdateRequestModal
          onClose={() => setModalOpen(false)}
          canModerate={canModerate}
          onCreated={() => mutate()}
        />
      )}
    </div>
  );
}
