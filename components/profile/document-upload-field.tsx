"use client";

import * as React from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

type DocumentField =
  | "profile_photo_url"
  | "cni_front_url"
  | "cni_back_url"
  | "cni_selfie_url";
type VerificationStatus = "pending" | "verified" | "rejected";

interface DocumentUploadFieldProps {
  field: DocumentField;
  label: string;
  hasFile: boolean;
  /** Undefined pour la photo de profil (pas de vérification admin). */
  verificationStatus?: VerificationStatus | null;
  rejectionReason?: string | null;
  expiresAt?: string | null;
  previewUrl?: string | null;
  onUploaded: () => void;
}

const ACCEPTED_MIME = "image/jpeg,image/png,image/webp";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function DocumentUploadField({
  field,
  label,
  hasFile,
  verificationStatus,
  rejectionReason,
  expiresAt,
  previewUrl,
  onUploaded,
}: DocumentUploadFieldProps) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState("");

  const isExpired = !!expiresAt && new Date(expiresAt) < new Date();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError("");
    if (file.size > MAX_SIZE_BYTES) {
      setError(t.profile.documents.tooLarge);
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("field", field);
      body.append("file", file);
      const res = await fetch("/api/profile/documents", {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error("upload failed");
      onUploaded();
    } catch {
      setError(t.profile.documents.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const statusBadge = () => {
    if (isExpired) {
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t.profile.documents.expired}
        </span>
      );
    }
    if (!hasFile) {
      return (
        <span className="text-xs font-medium text-muted-foreground">
          {t.profile.documents.missing}
        </span>
      );
    }
    if (verificationStatus === "verified") {
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t.profile.documents.verified}
        </span>
      );
    }
    if (verificationStatus === "rejected") {
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          {t.profile.documents.rejected}
        </span>
      );
    }
    if (verificationStatus === "pending") {
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
          <Clock className="h-3.5 w-3.5" />
          {t.profile.documents.pending}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t.profile.documents.uploaded}
      </span>
    );
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
      <label className="relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted transition-colors hover:border-primary/50">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-6 w-6 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME}
          className="sr-only"
          aria-label={label}
          onChange={handleFileSelected}
        />
      </label>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        {uploading ? (
          <span className="text-xs text-muted-foreground">
            {t.profile.documents.uploading}
          </span>
        ) : (
          statusBadge()
        )}
        {rejectionReason && verificationStatus === "rejected" && (
          <p className="mt-0.5 text-xs text-destructive">{rejectionReason}</p>
        )}
        {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
