"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Eye,
  ChevronLeft,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";

interface DocumentRow {
  id: string;
  document_type: string;
  title: string;
  issuing_organization: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
  candidate: { first_name: string | null; last_name: string | null } | null;
  candidate_skill_documents: { skill_name: string }[];
}

interface SkillDocumentsAdminClientProps {
  initialDocuments: DocumentRow[];
  canModerate: boolean;
}

const STATUS_LABEL: Record<
  string,
  { label: string; icon: React.ElementType; className: string }
> = {
  pending: { label: "En attente", icon: Clock, className: "text-amber-600" },
  verified: {
    label: "Validé",
    icon: CheckCircle2,
    className: "text-emerald-600",
  },
  rejected: { label: "Refusé", icon: XCircle, className: "text-red-600" },
  expired: {
    label: "Expiré",
    icon: AlertTriangle,
    className: "text-orange-600",
  },
};

const STATUS_TABS = [
  "pending",
  "verified",
  "rejected",
  "expired",
  "all",
] as const;

export function SkillDocumentsAdminClient({
  initialDocuments,
  canModerate,
}: SkillDocumentsAdminClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] =
    React.useState<(typeof STATUS_TABS)[number]>("pending");
  const [search, setSearch] = React.useState("");
  const [viewing, setViewing] = React.useState<DocumentRow | null>(null);

  const filtered = initialDocuments.filter((doc) => {
    if (statusFilter !== "all" && doc.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const name =
      `${doc.candidate?.first_name ?? ""} ${doc.candidate?.last_name ?? ""}`.toLowerCase();
    return name.includes(search.trim().toLowerCase());
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-24 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-full p-2 hover:bg-muted"
            aria-label={"Justificatifs professionnels"}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">
              Justificatifs professionnels
            </h1>
            <p className="text-sm text-muted-foreground">
              Validation des documents soumis par les candidats pour justifier
              leurs compétences.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`rounded-full border px-3 py-1 text-sm capitalize ${
                statusFilter === tab
                  ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                  : "border-input text-muted-foreground"
              }`}
            >
              {tab === "all" ? "Tous" : (STATUS_LABEL[tab]?.label ?? tab)}
            </button>
          ))}
        </div>

        <input
          className="w-full rounded-lg border border-input bg-background p-2 text-sm"
          placeholder="Rechercher un candidat…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Card>
          <CardContent className="divide-y divide-border p-0">
            {filtered.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                Aucun document pour ce filtre.
              </p>
            )}
            {filtered.map((doc) => {
              const status = STATUS_LABEL[doc.status] ?? STATUS_LABEL.pending;
              const Icon = status.icon;
              return (
                <div key={doc.id} className="space-y-1 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {doc.candidate?.first_name} {doc.candidate?.last_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {doc.title} — {doc.document_type}
                        {doc.candidate_skill_documents.length > 0 && (
                          <>
                            {" "}
                            (
                            {doc.candidate_skill_documents
                              .map((l) => l.skill_name)
                              .join(", ")}
                            )
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-sm ${status.className}`}
                    >
                      <Icon className="h-4 w-4" />
                      {status.label}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewing(doc)}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    Examiner
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {viewing && (
        <ReviewModal
          document={viewing}
          canModerate={canModerate}
          onClose={() => setViewing(null)}
          onDone={() => {
            setViewing(null);
            router.refresh();
          }}
        />
      )}
    </AppShell>
  );
}

function ReviewModal({
  document,
  canModerate,
  onClose,
  onDone,
}: {
  document: DocumentRow;
  canModerate: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = React.useState(false);
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadSignedUrl = async () => {
    setLoadingUrl(true);
    try {
      const res = await fetch(`/api/admin/skill-documents/${document.id}/url`);
      const data = await res.json();
      if (res.ok) setSignedUrl(data.url);
    } finally {
      setLoadingUrl(false);
    }
  };

  const moderate = async (action: "approve" | "reject") => {
    setError("");
    if (action === "reject" && !rejectionReason.trim()) {
      setShowRejectForm(true);
      setError("Un motif de refus est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/skill-documents/${document.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          rejection_reason: rejectionReason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("moderate failed");
      onDone();
    } catch {
      setError("L'action a échoué. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Examiner le justificatif">
      <div className="space-y-3">
        <div className="text-sm">
          <p className="font-medium">
            {document.candidate?.first_name} {document.candidate?.last_name}
          </p>
          <p className="text-muted-foreground">
            {document.title} — {document.document_type}
          </p>
          {document.issuing_organization && (
            <p className="text-muted-foreground">
              Organisme : {document.issuing_organization}
            </p>
          )}
          {document.expires_at && (
            <p className="text-muted-foreground">
              Expire le : {document.expires_at}
            </p>
          )}
          {document.candidate_skill_documents.length > 0 && (
            <p className="text-muted-foreground">
              Compétences :{" "}
              {document.candidate_skill_documents
                .map((l) => l.skill_name)
                .join(", ")}
            </p>
          )}
        </div>

        {signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-[#7C3AED] underline"
          >
            Ouvrir le document
          </a>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={loadSignedUrl}
            disabled={loadingUrl}
          >
            {loadingUrl ? <LoadingSpinner size="sm" /> : "Voir le document"}
          </Button>
        )}

        {canModerate && document.status === "pending" && (
          <div className="space-y-2 pt-2">
            {showRejectForm && (
              <textarea
                className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                placeholder="Motif du refus (obligatoire)"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() =>
                  showRejectForm ? moderate("reject") : setShowRejectForm(true)
                }
              >
                Refuser
              </Button>
              <Button disabled={submitting} onClick={() => moderate("approve")}>
                {submitting ? <LoadingSpinner size="sm" /> : "Valider"}
              </Button>
            </div>
          </div>
        )}

        {!canModerate && (
          <p className="text-sm text-muted-foreground">
            Accès en lecture seule — seuls admin_ops et admin_founder peuvent
            valider ou refuser.
          </p>
        )}
      </div>
    </Modal>
  );
}
