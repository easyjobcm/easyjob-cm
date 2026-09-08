"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import {
  ChevronLeft,
  CheckCircle2,
  LocateFixed,
  ShieldAlert,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { identitySchema, maxBirthDate } from "@/lib/validations/profile";
import {
  evaluateProfileLock,
  lockedGroupsForCni,
  type ProfileLockGroup,
} from "@/lib/utils/profile-lock";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { CAMEROON_CITIES } from "@/lib/utils/candidate-constants";
import { DocumentUploadField } from "@/components/profile/document-upload-field";

/** Demande de mise à jour admin en attente (SRS §5.1) — déverrouille des champs. */
interface PendingUpdateRequest {
  id: string;
  fields: ProfileLockGroup[];
  reason: string;
  createdAt: string;
}

type VerificationStatus = "pending" | "verified" | "rejected";
type DocumentField =
  | "profile_photo_url"
  | "cni_front_url"
  | "cni_back_url"
  | "cni_selfie_url";

interface CandidateProfileEditClientProps {
  profile: {
    id: string | null;
    first_name: string | null;
    last_name: string | null;
    date_of_birth: string | null;
    city: string | null;
    quartier: string | null;
    bio: string | null;
    latitude: number | null;
    longitude: number | null;
    profile_photo_url: string | null;
    cni_front_url: string | null;
    cni_back_url: string | null;
    cni_selfie_url: string | null;
    cni_verified: VerificationStatus | null;
    cni_rejection_reason: string | null;
    cni_expires_at: string | null;
  };
  /** Demandes admin `pending` (SRS §5.1) qui déverrouillent les champs vérifiés. */
  pendingUpdateRequests: PendingUpdateRequest[];
}

export function CandidateProfileEditClient({
  profile,
  pendingUpdateRequests,
}: CandidateProfileEditClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const tEdit = t.profile.edit;

  const [formData, setFormData] = React.useState({
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    date_of_birth: profile.date_of_birth ?? "",
    city: profile.city ?? "",
    quartier: profile.quartier ?? "",
    bio: profile.bio ?? "",
    latitude: profile.latitude,
    longitude: profile.longitude,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [apiError, setApiError] = React.useState("");
  const [apiLocked, setApiLocked] = React.useState(false);
  const [isDirty, setIsDirty] = React.useState(false);
  const [showReverifyModal, setShowReverifyModal] = React.useState(false);
  const [documents, setDocuments] = React.useState(profile);
  const [previews, setPreviews] = React.useState<
    Partial<Record<DocumentField, string>>
  >({});

  // Verrou SRS §5.1 — miroir client de la source de vérité côté serveur :
  // un groupe est verrouillé si le CNI est vérifié ET qu'aucune demande
  // admin `pending` ne le couvre. Le serveur reste le vrai garde-fou.
  const requestedGroups = React.useMemo(() => {
    const s = new Set<ProfileLockGroup>();
    pendingUpdateRequests.forEach((r) => r.fields.forEach((g) => s.add(g)));
    return [...s];
  }, [pendingUpdateRequests]);

  const identityLocked = React.useMemo(
    () =>
      evaluateProfileLock(
        ["first_name"],
        lockedGroupsForCni(documents.cni_verified),
        requestedGroups,
      ).lockedGroups.includes("identity"),
    [documents.cni_verified, requestedGroups],
  );
  const cniDocsLocked = React.useMemo(
    () =>
      evaluateProfileLock(
        ["cni_front_url"],
        lockedGroupsForCni(documents.cni_verified),
        requestedGroups,
      ).lockedGroups.includes("cni_documents"),
    [documents.cni_verified, requestedGroups],
  );

  // Les messages Zod du serveur (`identitySchema`) sont des clés i18n,
  // pas du texte littéral — on les traduit ici avant affichage.
  const zodMessages: Record<string, string> = React.useMemo(
    () =>
      ({
        firstNameRequired: tEdit.firstNameRequired,
        lastNameRequired: tEdit.lastNameRequired,
        birthDateRequired: tEdit.birthDateRequired,
        ageInvalid: tEdit.ageInvalid,
        birthDateInvalid: tEdit.birthDateInvalid,
        cityRequired: tEdit.cityRequired,
        bioTooLong: tEdit.bioHint,
      }) satisfies Record<string, string>,
    [tEdit],
  );

  const loadPreview = React.useCallback(async (field: DocumentField) => {
    const res = await fetch(`/api/profile/documents?field=${field}`);
    if (!res.ok) return;
    const data = (await res.json()) as { url?: string };
    if (data.url) {
      setPreviews((prev) => ({ ...prev, [field]: data.url }));
    }
  }, []);

  React.useEffect(() => {
    (
      [
        "profile_photo_url",
        "cni_front_url",
        "cni_back_url",
        "cni_selfie_url",
      ] as DocumentField[]
    ).forEach((field) => {
      if (documents[field]) void loadPreview(field);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exécuté une seule fois au montage avec les valeurs initiales du profil
  }, []);

  const refreshDocument = async (field: DocumentField) => {
    const res = await fetch("/api/user");
    if (res.ok) {
      const data = (await res.json()) as {
        profile?: Partial<typeof documents>;
      };
      if (data.profile) {
        setDocuments((prev) => ({ ...prev, ...data.profile }));
      }
    }
    void loadPreview(field);
  };

  // Avertit avant de fermer/rafraîchir l'onglet avec des changements non enregistrés.
  React.useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const updateField = <K extends keyof typeof formData>(
    field: K,
    value: (typeof formData)[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    setSaved(false);
  };

  const { status: geoStatus, requestLocation } = useGeolocation((coords) => {
    updateField("latitude", coords.latitude);
    updateField("longitude", coords.longitude);
  });

  const handleBack = () => {
    if (isDirty && !window.confirm(tEdit.unsavedWarning)) return;
    router.push("/profile/candidate");
  };

  const handleSave = async () => {
    if (saving) return;
    setApiError("");
    setErrors({});

    const result = identitySchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string")
          fieldErrors[key] = zodMessages[issue.message] ?? issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    // Changement d'identité (nom OU date de naissance) sur un CNI vérifié
    // → modal de confirmation de révérification (SRS §6.2, §5.1).
    const identityChanged =
      result.data.first_name !== (profile.first_name ?? "") ||
      result.data.last_name !== (profile.last_name ?? "") ||
      result.data.date_of_birth !== (profile.date_of_birth ?? "");

    if (identityChanged && documents.cni_verified === "verified") {
      if (identityLocked) {
        // Le verrou serveur renverra 403 si aucune demande admin ne couvre
        // le groupe : on l'affiche directement plutôt que de lancer la save.
        setApiLocked(true);
        return;
      }
      setShowReverifyModal(true);
      return;
    }

    await performSave();
  };

  const performSave = async () => {
    setShowReverifyModal(false);
    const result = identitySchema.safeParse(formData);
    if (!result.success) return;

    setSaving(true);
    try {
      const res = await fetch("/api/profile/identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...result.data,
          latitude: formData.latitude,
          longitude: formData.longitude,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        if (res.status === 403 && data.code === "field_locked") {
          setApiLocked(true);
          throw new Error("field_locked");
        }
        throw new Error("save failed");
      }
      const data = (await res.json()) as { requiresReverification?: boolean };

      if (data.requiresReverification) {
        setDocuments((prev) => ({
          ...prev,
          cni_verified: "pending",
          cni_rejection_reason: null,
        }));
      }

      setIsDirty(false);
      setSaved(true);
    } catch (err) {
      if (!(err instanceof Error && err.message === "field_locked")) {
        setApiError(tEdit.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const bioLength = formData.bio.trim().length;

  // Route depuis ProfileCompletionWidget vers le premier critère manquant
  // (?focus=photo|cni|bio|identity|location) : on y scrolle une fois monté.
  // (?focus=skills) est ignoré : les compétences vivent dans /profile/skills (T3).
  React.useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus || focus === "skills") return;
    const sectionId =
      focus === "photo" || focus === "cni" ? "documents" : "identity";
    document
      .getElementById(sectionId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exécuté une seule fois au montage
  }, []);

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 pb-4 pt-safe-top dark:border-white/10 dark:bg-[#1A0F2E]">
          <button
            type="button"
            onClick={handleBack}
            aria-label={t.common.back}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">
            {tEdit.title}
          </h1>
        </div>

        <div className="space-y-5 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-6">
          {pendingUpdateRequests.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t.profile.profileUpdateRequests.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pendingUpdateRequests[0].reason}
                </p>
              </div>
            </div>
          )}
          {documents.cni_verified === "pending" &&
            !pendingUpdateRequests.some((r) =>
              r.fields.includes("cni_documents"),
            ) &&
            (documents.cni_front_url ||
              documents.cni_back_url ||
              documents.cni_selfie_url) && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                    {t.profile.reverification.bannerTitle}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-500/80">
                    {t.profile.reverification.bannerBody}
                  </p>
                </div>
              </div>
            )}
          <Card id="identity">
            <CardContent className="space-y-4 p-4">
              {identityLocked && (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {tEdit.lockedIdentityLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tEdit.lockedIdentityBody}
                    </p>
                  </div>
                </div>
              )}
              <Input
                label={tEdit.firstName}
                value={formData.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                error={errors.first_name}
                disabled={identityLocked}
              />
              <Input
                label={tEdit.lastName}
                value={formData.last_name}
                onChange={(e) => updateField("last_name", e.target.value)}
                error={errors.last_name}
                disabled={identityLocked}
              />
              <Input
                label={tEdit.birthDate}
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => updateField("date_of_birth", e.target.value)}
                error={errors.date_of_birth}
                max={maxBirthDate()}
                disabled={identityLocked}
              />
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {tEdit.city}
                </label>
                <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
                  {CAMEROON_CITIES.map((city) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => updateField("city", city)}
                      className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                        formData.city === city
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>
                {errors.city && (
                  <p className="mt-1 text-xs text-destructive">{errors.city}</p>
                )}
              </div>
              <Input
                label={tEdit.quartier}
                value={formData.quartier}
                onChange={(e) => updateField("quartier", e.target.value)}
              />
              <div className="rounded-xl border border-border p-3">
                <p className="text-sm text-muted-foreground">
                  {t.profile.geolocation.explain}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={requestLocation}
                  disabled={geoStatus === "loading"}
                >
                  <LocateFixed className="mr-2 h-4 w-4" />
                  {geoStatus === "loading"
                    ? t.profile.geolocation.locating
                    : t.profile.geolocation.useMyLocation}
                </Button>
                {(formData.latitude !== null || geoStatus === "success") && (
                  <p className="mt-2 text-sm text-primary">
                    {t.profile.geolocation.success}
                  </p>
                )}
                {geoStatus === "denied" && (
                  <p className="mt-2 text-sm text-amber-600">
                    {t.profile.geolocation.denied}
                  </p>
                )}
                {geoStatus === "unavailable" && (
                  <p className="mt-2 text-sm text-amber-600">
                    {t.profile.geolocation.unavailable}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {tEdit.bio}
                </label>
                <Textarea
                  value={formData.bio}
                  onChange={(e) => updateField("bio", e.target.value)}
                  maxLength={500}
                  rows={4}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {tEdit.bioHint} ({bioLength}/500)
                </p>
              </div>
            </CardContent>
          </Card>

          <Card id="documents">
            <CardContent className="space-y-3 p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                {t.profile.documents.title}
              </h3>
              <DocumentUploadField
                field="profile_photo_url"
                label={t.profile.documents.photo}
                hasFile={!!documents.profile_photo_url}
                previewUrl={previews.profile_photo_url}
                onUploaded={() => refreshDocument("profile_photo_url")}
              />
              {cniDocsLocked && (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {tEdit.lockedDocLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tEdit.lockedDocBody}
                    </p>
                  </div>
                </div>
              )}
              <DocumentUploadField
                field="cni_front_url"
                label={t.profile.documents.cniFront}
                hasFile={!!documents.cni_front_url}
                verificationStatus={documents.cni_verified}
                rejectionReason={documents.cni_rejection_reason}
                expiresAt={documents.cni_expires_at}
                previewUrl={previews.cni_front_url}
                onUploaded={() => refreshDocument("cni_front_url")}
                locked={cniDocsLocked}
              />
              <DocumentUploadField
                field="cni_back_url"
                label={t.profile.documents.cniBack}
                hasFile={!!documents.cni_back_url}
                verificationStatus={documents.cni_verified}
                rejectionReason={documents.cni_rejection_reason}
                expiresAt={documents.cni_expires_at}
                previewUrl={previews.cni_back_url}
                onUploaded={() => refreshDocument("cni_back_url")}
                locked={cniDocsLocked}
              />
              <DocumentUploadField
                field="cni_selfie_url"
                label={t.profile.documents.cniSelfie}
                hasFile={!!documents.cni_selfie_url}
                verificationStatus={documents.cni_verified}
                rejectionReason={documents.cni_rejection_reason}
                expiresAt={documents.cni_expires_at}
                previewUrl={previews.cni_selfie_url}
                onUploaded={() => refreshDocument("cni_selfie_url")}
                locked={cniDocsLocked}
              />
            </CardContent>
          </Card>

          {apiError && (
            <p role="alert" className="text-sm text-destructive">
              {apiError}
            </p>
          )}
          {apiLocked && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {tEdit.lockedIdentityLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tEdit.lockedIdentityBody}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 p-4 backdrop-blur-xl">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full"
            size="lg"
          >
            {saving ? (
              <LoadingSpinner size="sm" />
            ) : saved ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {tEdit.saved}
              </>
            ) : (
              tEdit.save
            )}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={showReverifyModal}
        onClose={() => setShowReverifyModal(false)}
        title={t.profile.reverification.modalTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t.profile.reverification.modalBody}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowReverifyModal(false)}
            >
              {t.profile.cancel}
            </Button>
            <Button className="flex-1" onClick={performSave} disabled={saving}>
              {saving ? (
                <LoadingSpinner size="sm" />
              ) : (
                t.profile.reverification.confirm
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
