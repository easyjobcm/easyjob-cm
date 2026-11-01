"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { useI18n } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { cn } from "@/lib/utils";
import {
  Building2,
  MapPin,
  FileText,
  ChevronRight,
  Check,
  Upload,
  Globe,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Constants, type Tables } from "@/lib/database.types";
import {
  companyOnboardingSchema,
  type CompanyOnboardingInput,
} from "@/lib/validations/company";
import { CAMEROON_CITIES } from "@/lib/utils/candidate-constants";

type Step = "company" | "documents" | "location";

const steps: {
  id: Step;
  icon: LucideIcon;
  labelFr: string;
  labelEn: string;
}[] = [
  { id: "company", icon: Building2, labelFr: "Entreprise", labelEn: "Company" },
  {
    id: "documents",
    icon: FileText,
    labelFr: "Documents",
    labelEn: "Documents",
  },
  { id: "location", icon: MapPin, labelFr: "Adresse", labelEn: "Address" },
];

const businessTypes = [
  { id: "restaurant", labelFr: "Restaurant/Bar", labelEn: "Restaurant/Bar" },
  { id: "hotel", labelFr: "Hotellerie", labelEn: "Hospitality" },
  { id: "commerce", labelFr: "Commerce", labelEn: "Retail" },
  { id: "event", labelFr: "Evenementiel", labelEn: "Events" },
  { id: "logistics", labelFr: "Logistique", labelEn: "Logistics" },
  { id: "other", labelFr: "Autre", labelEn: "Other" },
];

const STEP_FIELDS: Record<Step, (keyof CompanyOnboardingInput)[]> = {
  company: ["company_name", "sector", "company_size", "website", "description"],
  documents: ["rccm"],
  location: ["city", "quartier", "address"],
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Saisie brute : chaque champ est une chaîne, validée par le schéma partagé. */
type FormState = Record<keyof CompanyOnboardingInput, string>;

type SavedProfile = Pick<
  Tables<"company_profiles">,
  | "company_name"
  | "sector"
  | "company_size"
  | "website"
  | "description"
  | "rccm"
  | "niu"
  | "documents_url"
  | "city"
  | "quartier"
  | "address"
  | "verification_status"
>;

export function CompanyOnboardingClient({
  profile,
}: {
  profile: SavedProfile | null;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const tc = t.companyOnboarding;
  const [currentStep, setCurrentStep] = React.useState<Step>("company");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  // Reprise : les valeurs déjà enregistrées pré-remplissent le formulaire.
  const [formData, setFormData] = React.useState<FormState>({
    company_name: profile?.company_name ?? "",
    sector: profile?.sector ?? "",
    company_size: profile?.company_size ?? "",
    website: profile?.website ?? "",
    description: profile?.description ?? "",
    rccm: profile?.rccm ?? "",
    city: profile?.city ?? "",
    quartier: profile?.quartier ?? "",
    address: profile?.address ?? "",
  });
  const [rccmFile, setRccmFile] = React.useState<File | null>(null);
  const hasSavedDocument = (profile?.documents_url ?? []).length > 0;

  const setField = (field: keyof CompanyOnboardingInput, value: string) => {
    setError("");
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const errorMessage = (code: string) =>
    code in tc.errors
      ? tc.errors[code as keyof typeof tc.errors]
      : tc.saveError;

  /** Premier message d'erreur des champs donnés, selon le schéma partagé. */
  const firstIssue = (fields: (keyof CompanyOnboardingInput)[]) => {
    const parsed = companyOnboardingSchema.safeParse(formData);
    if (parsed.success) return null;
    const issue = parsed.error.issues.find((i) =>
      fields.some((field) => field === i.path[0]),
    );
    return issue ? errorMessage(issue.message) : null;
  };

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const handleNext = () => {
    const issue = firstIssue(STEP_FIELDS[currentStep]);
    if (issue) {
      setError(issue);
      return;
    }
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setError("");
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const handleComplete = async () => {
    const parsed = companyOnboardingSchema.safeParse(formData);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      const step = steps.find((s) =>
        STEP_FIELDS[s.id].some((f) => f === field),
      );
      if (step) setCurrentStep(step.id);
      setError(errorMessage(parsed.error.issues[0]?.message ?? ""));
      return;
    }

    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(formData)) {
        body.append(key, value);
      }
      if (rccmFile) body.append("rccm_document", rccmFile);

      const res = await fetch("/api/company/onboarding", {
        method: "PUT",
        body,
      });
      const result: {
        ok?: boolean;
        error?: string;
        issues?: { code: string }[];
      } = await res.json().catch(() => ({}));
      if (!res.ok || !result.ok) {
        setError(errorMessage(result.issues?.[0]?.code ?? result.error ?? ""));
        return;
      }
      router.push("/company/dashboard");
      router.refresh();
    } catch {
      setError(tc.saveError);
    } finally {
      setLoading(false);
    }
  };

  const isStepValid = () =>
    STEP_FIELDS[currentStep]
      .filter((field) => !["website", "description"].includes(field))
      .every((field) => formData[field].trim() !== "");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        title={
          locale === "fr" ? "Inscription entreprise" : "Company registration"
        }
        showBack={currentStepIndex > 0}
        onBack={handleBack}
      />

      {/* Progress */}
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between mb-2">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full transition-all",
                    index < currentStepIndex
                      ? "bg-success text-success-foreground"
                      : index === currentStepIndex
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {index < currentStepIndex ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </div>
                <span className="text-[10px] mt-1 text-muted-foreground">
                  {locale === "fr" ? step.labelFr : step.labelEn}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    index < currentStepIndex ? "bg-success" : "bg-muted",
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 px-6 py-6">
        {profile?.verification_status === "verified" &&
          currentStep !== "location" && (
            <Card className="mb-6 border-warning/30 bg-warning/5">
              <CardContent className="p-4">
                <p className="text-sm text-foreground">{tc.verifiedNotice}</p>
              </CardContent>
            </Card>
          )}

        {/* Company Info Step */}
        {currentStep === "company" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr" ? "Votre entreprise" : "Your company"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Parlez-nous de votre entreprise"
                  : "Tell us about your company"}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Nom de l'entreprise" : "Company name"}
                </label>
                <Input
                  value={formData.company_name}
                  onChange={(e) => setField("company_name", e.target.value)}
                  placeholder="EasyJob Cameroun SARL"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {locale === "fr" ? "Type d'activite" : "Business type"}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {businessTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setField("sector", type.id)}
                      className={cn(
                        "rounded-xl px-4 py-3 text-sm font-medium transition-all",
                        formData.sector === type.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      {locale === "fr" ? type.labelFr : type.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {tc.sizeLabel}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Constants.public.Enums.company_size.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setField("company_size", size)}
                      className={cn(
                        "flex items-center justify-center gap-1 rounded-xl px-3 py-3 text-sm font-medium transition-all",
                        formData.company_size === size
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      <Users className="h-4 w-4" />
                      {tc.sizes[size]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr"
                    ? "Site web (optionnel)"
                    : "Website (optional)"}
                </label>
                <div className="relative mt-1.5">
                  <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formData.website}
                    onChange={(e) => setField("website", e.target.value)}
                    placeholder="https://www.example.com"
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr"
                    ? "Description (optionnel)"
                    : "Description (optional)"}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setField("description", e.target.value)}
                  placeholder={
                    locale === "fr"
                      ? "Decrivez votre entreprise..."
                      : "Describe your company..."
                  }
                  className="mt-1.5 w-full min-h-25 rounded-xl border border-input bg-background px-4 py-3 text-foreground resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Documents Step */}
        {currentStep === "documents" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr" ? "Documents legaux" : "Legal documents"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Ces documents sont necessaires pour verifier votre entreprise"
                  : "These documents are required to verify your company"}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr"
                    ? "Numero de Registre du Commerce (RCCM)"
                    : "Business registration number (RCCM)"}
                </label>
                <Input
                  value={formData.rccm}
                  onChange={(e) => setField("rccm", e.target.value)}
                  placeholder="RC/DLA/XXXX/XXXXX"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Document RCCM" : "RCCM document"}
                </label>
                <div className="mt-1.5">
                  <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">
                      {rccmFile
                        ? rccmFile.name
                        : locale === "fr"
                          ? "Cliquez pour telecharger"
                          : "Click to upload"}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      {tc.rccmFileHint}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (file && file.size > MAX_FILE_BYTES) {
                          setError(tc.errors.file_too_large);
                          e.target.value = "";
                          return;
                        }
                        setError("");
                        setRccmFile(file);
                      }}
                    />
                  </label>
                  {hasSavedDocument && !rccmFile && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {tc.rccmFileSaved}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {tc.niuLabel}
                </label>
                <Input
                  value={profile?.niu ?? ""}
                  readOnly
                  aria-readonly="true"
                  className="mt-1.5 bg-muted"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {tc.niuHint}
                </p>
              </div>

              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <p className="text-sm text-foreground">
                    {locale === "fr"
                      ? "Vos documents seront examines par notre equipe. Vous recevrez une notification une fois votre compte verifie."
                      : "Your documents will be reviewed by our team. You will receive a notification once your account is verified."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Location Step */}
        {currentStep === "location" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr"
                  ? "Adresse de l'entreprise"
                  : "Company address"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Ou se trouve votre siege social ?"
                  : "Where is your headquarters located?"}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Ville" : "City"}
                </label>
                <select
                  value={formData.city}
                  onChange={(e) => setField("city", e.target.value)}
                  className="mt-1.5 w-full h-12 rounded-xl border border-input bg-background px-3 text-foreground"
                >
                  <option value="">
                    {locale === "fr"
                      ? "Selectionnez une ville"
                      : "Select a city"}
                  </option>
                  {CAMEROON_CITIES.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Quartier" : "Area"}
                </label>
                <Input
                  value={formData.quartier}
                  onChange={(e) => setField("quartier", e.target.value)}
                  placeholder={
                    locale === "fr"
                      ? "Ex: Bonanjo, Akwa..."
                      : "Ex: Bonanjo, Akwa..."
                  }
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Adresse complete" : "Full address"}
                </label>
                <Input
                  value={formData.address}
                  onChange={(e) => setField("address", e.target.value)}
                  placeholder={
                    locale === "fr" ? "Rue, batiment..." : "Street, building..."
                  }
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA : l'erreur reste visible au-dessus du bouton. */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        {error && (
          <Card className="mb-3 border-destructive/30 bg-destructive/5">
            <CardContent className="p-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            </CardContent>
          </Card>
        )}
        <Button
          onClick={handleNext}
          disabled={!isStepValid() || loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <LoadingSpinner size="sm" />
          ) : currentStepIndex === steps.length - 1 ? (
            locale === "fr" ? (
              "Creer mon compte"
            ) : (
              "Create my account"
            )
          ) : (
            <>
              {locale === "fr" ? "Continuer" : "Continue"}
              <ChevronRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
