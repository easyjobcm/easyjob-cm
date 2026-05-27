"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import {
  User,
  MapPin,
  Briefcase,
  CreditCard,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

const MAX_BIRTH_DATE = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().split("T")[0];
})();

interface OnboardingClientProps {
  user: {
    id: string;
  };
  profile: {
    id: string;
    onboarding_step?: number;
    first_name?: string;
    last_name?: string;
    gender?: string;
    date_of_birth?: string;
    city?: string;
    quartier?: string;
    momo_provider?: string;
    momo_number?: string;
  } | null;
  categories: Array<{
    id: string;
    name_fr?: string;
    name_en?: string;
  }>;
}

const STEPS = [
  {
    id: 1,
    title: "Informations personnelles",
    titleEn: "Personal Info",
    icon: User,
  },
  { id: 2, title: "Localisation", titleEn: "Location", icon: MapPin },
  { id: 3, title: "Competences", titleEn: "Skills", icon: Briefcase },
  {
    id: 4,
    title: "Paiement Mobile",
    titleEn: "Mobile Payment",
    icon: CreditCard,
  },
];

const CAMEROON_CITIES = [
  "Douala",
  "Yaounde",
  "Bafoussam",
  "Bamenda",
  "Garoua",
  "Maroua",
  "Ngaoundere",
  "Bertoua",
  "Limbe",
  "Kribi",
  "Buea",
  "Ebolowa",
  "Nkongsamba",
  "Edea",
];

const COMMON_SKILLS = [
  "Service client",
  "Vente",
  "Restauration",
  "Caisse",
  "Manutention",
  "Conduite moto",
  "Conduite voiture",
  "Securite",
  "Nettoyage",
  "Cuisine",
  "Hotesse accueil",
  "Evenementiel",
  "Informatique",
  "Anglais",
  "Francais",
];

export function OnboardingClient({
  user,
  profile,
  categories: _categories,
}: OnboardingClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const supabase = createClient();

  const [currentStep, setCurrentStep] = React.useState(
    profile?.onboarding_step || 1,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  // Form data
  const [formData, setFormData] = React.useState({
    first_name: profile?.first_name || "",
    last_name: profile?.last_name || "",
    gender: profile?.gender || "",
    date_of_birth: profile?.date_of_birth || "",
    city: profile?.city || "",
    quartier: profile?.quartier || "",
    skills: [] as string[],
    momo_provider: profile?.momo_provider || "",
    momo_number: profile?.momo_number || "",
  });

  const updateFormData = <K extends keyof typeof formData>(
    field: K,
    value: (typeof formData)[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSkill = (skill: string) => {
    setFormData((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((s) => s !== skill)
        : [...prev.skills, skill],
    }));
  };

  const saveProgress = async (nextStep: number) => {
    setLoading(true);
    setError("");

    try {
      const { error: updateError } = await supabase
        .from("candidate_profiles")
        .update({
          ...formData,
          onboarding_step: nextStep,
          onboarding_status: nextStep > 4 ? "completed" : "in_progress",
        })
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      // Save skills separately
      if (currentStep === 3 && formData.skills.length > 0) {
        if (!profile) {
          throw new Error(
            locale === "fr" ? "Profil introuvable" : "Profile not found",
          );
        }

        // Delete existing skills first
        await supabase
          .from("candidate_skills")
          .delete()
          .eq("candidate_id", profile.id);

        // Insert new skills
        const skillsToInsert = formData.skills.map((skill) => ({
          candidate_id: profile.id,
          skill_name: skill,
          skill_level: 3,
        }));

        await supabase.from("candidate_skills").insert(skillsToInsert);
      }

      if (nextStep > 4) {
        router.push("/dashboard");
      } else {
        setCurrentStep(nextStep);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      setError(message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    // Validation
    if (currentStep === 1) {
      if (!formData.first_name || !formData.last_name) {
        setError(
          locale === "fr"
            ? "Veuillez remplir tous les champs"
            : "Please fill all fields",
        );
        return;
      }
    }
    if (currentStep === 2) {
      if (!formData.city) {
        setError(
          locale === "fr"
            ? "Veuillez selectionner une ville"
            : "Please select a city",
        );
        return;
      }
    }
    if (currentStep === 3) {
      if (formData.skills.length < 2) {
        setError(
          locale === "fr"
            ? "Selectionnez au moins 2 competences"
            : "Select at least 2 skills",
        );
        return;
      }
    }
    if (currentStep === 4) {
      if (!formData.momo_provider || !formData.momo_number) {
        setError(
          locale === "fr"
            ? "Veuillez remplir vos informations Mobile Money"
            : "Please fill your Mobile Money info",
        );
        return;
      }
    }

    saveProgress(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError("");
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Prenom" : "First name"} *
              </label>
              <Input
                value={formData.first_name}
                onChange={(e) => updateFormData("first_name", e.target.value)}
                placeholder={
                  locale === "fr" ? "Votre prenom" : "Your first name"
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Nom" : "Last name"} *
              </label>
              <Input
                value={formData.last_name}
                onChange={(e) => updateFormData("last_name", e.target.value)}
                placeholder={
                  locale === "fr" ? "Votre nom de famille" : "Your last name"
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Genre" : "Gender"}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "male", label: locale === "fr" ? "Homme" : "Male" },
                  {
                    value: "female",
                    label: locale === "fr" ? "Femme" : "Female",
                  },
                  {
                    value: "other",
                    label: locale === "fr" ? "Autre" : "Other",
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateFormData("gender", option.value)}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      formData.gender === option.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:border-primary/50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Date de naissance" : "Date of birth"}
              </label>
              <Input
                type="date"
                value={formData.date_of_birth}
                onChange={(e) =>
                  updateFormData("date_of_birth", e.target.value)
                }
                max={MAX_BIRTH_DATE}
              />
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Ville" : "City"} *
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {CAMEROON_CITIES.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => updateFormData("city", city)}
                    className={`px-4 py-3 rounded-lg border text-sm transition-colors text-left ${
                      formData.city === city
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:border-primary/50"
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Quartier" : "Neighborhood"}
              </label>
              <Input
                value={formData.quartier}
                onChange={(e) => updateFormData("quartier", e.target.value)}
                placeholder={
                  locale === "fr"
                    ? "Ex: Bonanjo, Akwa..."
                    : "Ex: Bonanjo, Akwa..."
                }
              />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {locale === "fr"
                ? "Selectionnez vos competences (minimum 2)"
                : "Select your skills (minimum 2)"}
            </p>
            <div className="flex flex-wrap gap-2">
              {COMMON_SKILLS.map((skill) => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkill(skill)}
                  className={`px-3 py-2 rounded-full border text-sm transition-colors ${
                    formData.skills.includes(skill)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:border-primary/50"
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>
            {formData.skills.length > 0 && (
              <p className="text-sm text-primary">
                {formData.skills.length}{" "}
                {locale === "fr"
                  ? "competence(s) selectionnee(s)"
                  : "skill(s) selected"}
              </p>
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {locale === "fr"
                ? "Configurez votre compte Mobile Money pour recevoir vos paiements."
                : "Set up your Mobile Money account to receive payments."}
            </p>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr" ? "Operateur" : "Provider"} *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateFormData("momo_provider", "mtn")}
                  className={`p-4 rounded-xl border transition-colors flex flex-col items-center gap-2 ${
                    formData.momo_provider === "mtn"
                      ? "bg-yellow-500/10 border-yellow-500"
                      : "bg-card border-border hover:border-yellow-500/50"
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center text-white font-bold text-lg">
                    MTN
                  </div>
                  <span className="text-sm font-medium">MTN MoMo</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateFormData("momo_provider", "orange")}
                  className={`p-4 rounded-xl border transition-colors flex flex-col items-center gap-2 ${
                    formData.momo_provider === "orange"
                      ? "bg-orange-500/10 border-orange-500"
                      : "bg-card border-border hover:border-orange-500/50"
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-lg">
                    OM
                  </div>
                  <span className="text-sm font-medium">Orange Money</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                {locale === "fr"
                  ? "Numero Mobile Money"
                  : "Mobile Money Number"}{" "}
                *
              </label>
              <Input
                type="tel"
                value={formData.momo_number}
                onChange={(e) => updateFormData("momo_number", e.target.value)}
                placeholder="6XX XXX XXX"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "fr"
                  ? "Ce numero sera utilise pour recevoir vos paiements"
                  : "This number will be used to receive your payments"}
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress header */}
      <div className="bg-card border-b border-border px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-foreground">
            {locale === "fr"
              ? "Completez votre profil"
              : "Complete your profile"}
          </h1>
          <Badge variant="secondary">{currentStep}/4</Badge>
        </div>

        {/* Progress bar */}
        <div className="flex gap-2">
          {STEPS.map((step) => (
            <div
              key={step.id}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                step.id <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Current step info */}
        <div className="flex items-center gap-3 mt-4">
          {React.createElement(STEPS[currentStep - 1].icon, {
            className: "w-5 h-5 text-primary",
          })}
          <span className="font-medium text-foreground">
            {locale === "fr"
              ? STEPS[currentStep - 1].title
              : STEPS[currentStep - 1].titleEn}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-6">
        {error && (
          <Card className="mb-4 border-destructive/30 bg-destructive/5">
            <CardContent className="p-3">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {renderStepContent()}
      </div>

      {/* Footer actions */}
      <div className="sticky bottom-0 bg-background border-t border-border p-4 safe-area-bottom">
        <div className="flex gap-3">
          {currentStep > 1 && (
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={loading}
              className="flex-1"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              {locale === "fr" ? "Retour" : "Back"}
            </Button>
          )}
          <Button onClick={handleNext} disabled={loading} className="flex-1">
            {loading ? (
              <LoadingSpinner size="sm" />
            ) : currentStep === 4 ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                {locale === "fr" ? "Terminer" : "Finish"}
              </>
            ) : (
              <>
                {locale === "fr" ? "Continuer" : "Continue"}
                <ChevronRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
