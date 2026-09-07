"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import {
  SKILL_DOCUMENT_TYPES,
  type SkillDocumentType,
} from "@/lib/validations/skill-documents";

type SkillVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | "expired";

interface SkillRow {
  id: string;
  skill_name: string;
  verification_status: string;
}

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
  candidate_skill_documents: { candidate_skill_id: string }[];
}

interface SkillDocumentsClientProps {
  initialSkills: SkillRow[];
  initialDocuments: DocumentRow[];
}

const STATUS_STYLE: Record<
  SkillVerificationStatus,
  { icon: React.ElementType; className: string }
> = {
  unverified: { icon: FileText, className: "text-muted-foreground" },
  pending: { icon: Clock, className: "text-amber-600" },
  verified: { icon: CheckCircle2, className: "text-emerald-600" },
  rejected: { icon: XCircle, className: "text-red-600" },
  expired: { icon: AlertTriangle, className: "text-orange-600" },
};

const ACCEPTED_MIME = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function SkillDocumentsClient({
  initialSkills,
  initialDocuments,
}: SkillDocumentsClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const ts = t.profile.skillDocuments;

  const [modalSkillId, setModalSkillId] = React.useState<string | null | "cv">(
    null,
  );
  const [deletingDoc, setDeletingDoc] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  const handleDelete = async () => {
    if (!deletingDoc) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch(`/api/profile/skill-documents/${deletingDoc}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setDeletingDoc(null);
      router.refresh();
    } catch {
      setDeleteError(ts.deleteError);
    } finally {
      setDeleting(false);
    }
  };

  const documentsBySkill = React.useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const doc of initialDocuments) {
      for (const link of doc.candidate_skill_documents) {
        const list = map.get(link.candidate_skill_id) ?? [];
        list.push(doc);
        map.set(link.candidate_skill_id, list);
      }
    }
    return map;
  }, [initialDocuments]);

  const cvDocument = initialDocuments.find((d) => d.document_type === "cv");

  const LABEL_KEY = {
    unverified: "declared",
    pending: "pending",
    verified: "verified",
    rejected: "rejected",
    expired: "expired",
  } as const;

  const statusBadge = (status: string) => {
    const key = (
      status in STATUS_STYLE ? status : "unverified"
    ) as SkillVerificationStatus;
    const { icon: Icon, className } = STATUS_STYLE[key];
    return (
      <span
        className={`inline-flex items-center gap-1 text-sm font-medium ${className}`}
      >
        <Icon className="h-4 w-4" />
        {ts.status[LABEL_KEY[key]]}
      </span>
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-24 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-full p-2 hover:bg-muted"
            aria-label={ts.title}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{ts.title}</h1>
            <p className="text-sm text-muted-foreground">{ts.subtitle}</p>
          </div>
        </div>

        {/* CV — document général, non rattaché à une compétence précise */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-4">
              <div>
                <p className="font-medium">{ts.cvCardTitle}</p>
                <p className="text-sm text-muted-foreground">{ts.cvCardHint}</p>
                {cvDocument && (
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {statusBadge(cvDocument.status)}
                    {(cvDocument.status === "pending" ||
                      cvDocument.status === "rejected") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-red-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        onClick={() => setDeletingDoc(cvDocument.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {ts.actions.delete}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalSkillId("cv")}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {ts.addCv}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <div className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
            {ts.skillsSectionTitle}
          </h2>
          {initialSkills.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                {ts.noSkills}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {initialSkills.map((skill) => {
                  const docs = documentsBySkill.get(skill.id) ?? [];
                  const latest = docs[0];
                  const status = (skill.verification_status ||
                    "unverified") as SkillVerificationStatus;
                  const actionLabel =
                    status === "rejected"
                      ? ts.actions.resubmit
                      : status === "expired"
                        ? ts.actions.updateExpired
                        : status === "pending" || status === "verified"
                          ? null
                          : ts.actions.addProof;

                  return (
                    <div key={skill.id} className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{skill.skill_name}</p>
                          {statusBadge(status)}
                        </div>
                        {actionLabel && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setModalSkillId(skill.id)}
                          >
                            {actionLabel}
                          </Button>
                        )}
                      </div>
                      {status === "rejected" && latest?.rejection_reason && (
                        <p className="text-sm text-red-600">
                          {ts.rejectionReasonLabel} : {latest.rejection_reason}
                        </p>
                      )}
                      {status === "expired" && (
                        <p className="text-sm text-orange-600">
                          {ts.expiredNotice}
                        </p>
                      )}
                      {latest &&
                        (latest.status === "pending" ||
                          latest.status === "rejected") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-red-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            onClick={() => setDeletingDoc(latest.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {ts.actions.delete}
                          </Button>
                        )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {modalSkillId !== null && (
        <UploadModal
          skills={initialSkills}
          initialSkillId={modalSkillId === "cv" ? null : modalSkillId}
          lockToCv={modalSkillId === "cv"}
          onClose={() => setModalSkillId(null)}
          onUploaded={() => {
            setModalSkillId(null);
            router.refresh();
          }}
        />
      )}

      {deletingDoc !== null && (
        <Modal
          open
          onClose={() => {
            setDeletingDoc(null);
            setDeleteError("");
          }}
          title={ts.delete}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{ts.deleteConfirm}</p>
            {deleteError && (
              <p className="text-sm text-red-600">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => {
                  setDeletingDoc(null);
                  setDeleteError("");
                }}
              >
                {ts.form.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {ts.actions.delete}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function UploadModal({
  skills,
  initialSkillId,
  lockToCv,
  onClose,
  onUploaded,
}: {
  skills: SkillRow[];
  initialSkillId: string | null;
  lockToCv: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const ts = t.profile.skillDocuments;
  const tf = ts.form;

  const [documentType, setDocumentType] = React.useState<SkillDocumentType>(
    lockToCv ? "cv" : "diplome",
  );
  const [title, setTitle] = React.useState("");
  const [issuingOrganization, setIssuingOrganization] = React.useState("");
  const [issuedAt, setIssuedAt] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<string[]>(
    initialSkillId ? [initialSkillId] : [],
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [confirmAccurate, setConfirmAccurate] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  const isCv = documentType === "cv";

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setError("");
    if (selected && selected.size > MAX_SIZE_BYTES) {
      setError(ts.tooLarge);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleSubmit = async () => {
    setError("");
    if (!title.trim()) {
      setError(tf.titleRequired);
      return;
    }
    if (!file) {
      setError(ts.unsupportedType);
      return;
    }
    if (!isCv && selectedSkillIds.length === 0) {
      setError(ts.selectSkillRequired);
      return;
    }
    if (!confirmAccurate) {
      setError(ts.uploadError);
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("document_type", documentType);
      body.append("title", title.trim());
      body.append("issuing_organization", issuingOrganization.trim());
      body.append("issued_at", issuedAt);
      body.append("expires_at", expiresAt);
      body.append("skill_ids", JSON.stringify(isCv ? [] : selectedSkillIds));
      body.append("confirm_accurate", "true");
      body.append("file", file);

      const res = await fetch("/api/profile/skill-documents", {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error("upload failed");
      onUploaded();
    } catch {
      setError(ts.uploadError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={tf.title}>
      <div className="space-y-4">
        {!lockToCv && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.documentType}
            </label>
            <select
              className="w-full rounded-lg border border-input bg-background p-2"
              value={documentType}
              onChange={(e) =>
                setDocumentType(e.target.value as SkillDocumentType)
              }
            >
              {SKILL_DOCUMENT_TYPES.filter((type) => type !== "cv").map(
                (type) => (
                  <option key={type} value={type}>
                    {ts.documentTypes[type]}
                  </option>
                ),
              )}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            {tf.documentTitle}
          </label>
          <input
            className="w-full rounded-lg border border-input bg-background p-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tf.documentTitlePlaceholder}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            {isCv ? tf.issuingOrganizationOptional : tf.issuingOrganization}
          </label>
          <input
            className="w-full rounded-lg border border-input bg-background p-2"
            value={issuingOrganization}
            onChange={(e) => setIssuingOrganization(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.issuedAt}
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-input bg-background p-2"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </div>
          {!isCv && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                {tf.expiresAt}
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-input bg-background p-2"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          )}
        </div>

        {!isCv && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.linkedSkills}
            </label>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <button
                  type="button"
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    selectedSkillIds.includes(skill.id)
                      ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                      : "border-input text-muted-foreground"
                  }`}
                >
                  {skill.skill_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">{tf.file}</label>
          <input
            type="file"
            accept={ACCEPTED_MIME}
            onChange={handleFile}
            className="w-full text-sm"
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmAccurate}
            onChange={(e) => setConfirmAccurate(e.target.checked)}
            className="mt-1"
          />
          {tf.confirmAccurate}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {tf.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <LoadingSpinner size="sm" /> : tf.submit}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
