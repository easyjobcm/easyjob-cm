"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading";
import { ChevronLeft, CheckCircle2, LocateFixed } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { identitySchema } from "@/lib/validations/profile";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import {
  CAMEROON_CITIES,
  COMMON_SKILLS,
} from "@/lib/utils/candidate-constants";
import { DocumentUploadField } from "@/components/profile/document-upload-field";

type VerificationStatus = "pending" | "verified" | "rejected";
type DocumentField =
  | "profile_photo_url"
  | "cni_front_url"
  | "cni_back_url"
  | "cni_selfie_url";

interface CandidateProfileEditClientProps {
  userId: string;
  profile: {
    id: string | null;
    first_name: string | null;
    last_name: string | null;
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
  initialSkills: string[];
}

export function CandidateProfileEditClient({
  userId,
  profile,
  initialSkills,
}: CandidateProfileEditClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = React.useMemo(() => createClient(), []);
  const tEdit = t.profile.edit;

  const [formData, setFormData] = React.useState({
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    city: profile.city ?? "",
    quartier: profile.quartier ?? "",
    bio: profile.bio ?? "",
    latitude: profile.latitude,
    longitude: profile.longitude,
  });
  const [skills, setSkills] = React.useState<string[]>(initialSkills);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [apiError, setApiError] = React.useState("");
  const [isDirty, setIsDirty] = React.useState(false);
  const [documents, setDocuments] = React.useState(profile);
  const [previews, setPreviews] = React.useState<
    Partial<Record<DocumentField, string>>
  >({});

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

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
    setIsDirty(true);
    setSaved(false);
  };

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
        if (typeof key === "string") fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("candidate_profiles")
        .update({
          first_name: result.data.first_name,
          last_name: result.data.last_name,
          city: result.data.city,
          quartier: result.data.quartier || null,
          bio: result.data.bio || null,
          latitude: formData.latitude,
          longitude: formData.longitude,
        })
        .eq("user_id", userId);

      if (updateError) throw updateError;

      if (profile.id) {
        await supabase
          .from("candidate_skills")
          .delete()
          .eq("candidate_id", profile.id);

        if (skills.length > 0) {
          await supabase.from("candidate_skills").insert(
            skills.map((skill_name) => ({
              candidate_id: profile.id as string,
              skill_name,
              skill_level: 3,
            })),
          );
        }
      }

      setIsDirty(false);
      setSaved(true);
    } catch {
      setApiError(tEdit.error);
    } finally {
      setSaving(false);
    }
  };

  const bioLength = formData.bio.trim().length;

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
          <Card>
            <CardContent className="space-y-4 p-4">
              <Input
                label={tEdit.firstName}
                value={formData.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                error={errors.first_name}
              />
              <Input
                label={tEdit.lastName}
                value={formData.last_name}
                onChange={(e) => updateField("last_name", e.target.value)}
                error={errors.last_name}
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

          <Card>
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
              <DocumentUploadField
                field="cni_front_url"
                label={t.profile.documents.cniFront}
                hasFile={!!documents.cni_front_url}
                verificationStatus={documents.cni_verified}
                rejectionReason={documents.cni_rejection_reason}
                expiresAt={documents.cni_expires_at}
                previewUrl={previews.cni_front_url}
                onUploaded={() => refreshDocument("cni_front_url")}
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
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                {tEdit.skills}
              </h3>
              <div className="flex flex-wrap gap-2">
                {COMMON_SKILLS.map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                      skills.includes(skill)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    {skill}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {apiError && (
            <p role="alert" className="text-sm text-destructive">
              {apiError}
            </p>
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
    </AppShell>
  );
}
