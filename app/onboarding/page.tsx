"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { useTranslation } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  CreditCard,
  MapPin,
  Briefcase,
  ChevronRight,
  Check,
  Camera,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

type Step = "identity" | "momo" | "location" | "skills";

const steps: {
  id: Step;
  icon: LucideIcon;
  labelFr: string;
  labelEn: string;
}[] = [
  {
    id: "identity",
    icon: CreditCard,
    labelFr: "Identite",
    labelEn: "Identity",
  },
  {
    id: "momo",
    icon: Smartphone,
    labelFr: "Mobile Money",
    labelEn: "Mobile Money",
  },
  {
    id: "location",
    icon: MapPin,
    labelFr: "Localisation",
    labelEn: "Location",
  },
  { id: "skills", icon: Briefcase, labelFr: "Competences", labelEn: "Skills" },
];

const skillCategories = [
  {
    id: "restauration",
    labelFr: "Restauration",
    labelEn: "Restaurant",
    skills: [
      { id: "serveur", labelFr: "Service", labelEn: "Waiter/Waitress" },
      { id: "cuisine", labelFr: "Cuisine", labelEn: "Kitchen" },
      { id: "barman", labelFr: "Barman", labelEn: "Bartender" },
    ],
  },
  {
    id: "logistique",
    labelFr: "Logistique",
    labelEn: "Logistics",
    skills: [
      { id: "livreur", labelFr: "Livraison", labelEn: "Delivery" },
      { id: "manutention", labelFr: "Manutention", labelEn: "Handling" },
      { id: "chauffeur", labelFr: "Chauffeur", labelEn: "Driver" },
    ],
  },
  {
    id: "commerce",
    labelFr: "Commerce",
    labelEn: "Retail",
    skills: [
      { id: "vente", labelFr: "Vente", labelEn: "Sales" },
      { id: "caisse", labelFr: "Caisse", labelEn: "Cashier" },
      { id: "inventaire", labelFr: "Inventaire", labelEn: "Inventory" },
    ],
  },
  {
    id: "evenementiel",
    labelFr: "Evenementiel",
    labelEn: "Events",
    skills: [
      { id: "hotesse", labelFr: "Accueil", labelEn: "Host/Hostess" },
      { id: "securite", labelFr: "Securite", labelEn: "Security" },
      { id: "technique", labelFr: "Technique", labelEn: "Technical" },
    ],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { locale } = useTranslation();
  const [currentStep, setCurrentStep] = React.useState<Step>("identity");
  const [loading, setLoading] = React.useState(false);

  // Form data
  const [formData, setFormData] = React.useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    cniNumber: "",
    cniPhoto: null as File | null,
    momoProvider: "" as "mtn" | "orange" | "",
    momoNumber: "",
    city: "",
    area: "",
    gpsEnabled: false,
    skills: [] as string[],
  });

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const handleNext = () => {
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
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Update user profile
        await supabase
          .from("users")
          .update({
            is_verified: true,
          })
          .eq("id", user.id);
      }

      router.push("/jobs");
    } catch (error) {
      console.error("[v0] Onboarding error:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSkill = (skillId: string) => {
    setFormData((prev) => ({
      ...prev,
      skills: prev.skills.includes(skillId)
        ? prev.skills.filter((s) => s !== skillId)
        : [...prev.skills, skillId],
    }));
  };

  const isStepValid = () => {
    switch (currentStep) {
      case "identity":
        return (
          formData.firstName &&
          formData.lastName &&
          formData.birthDate &&
          formData.cniNumber
        );
      case "momo":
        return formData.momoProvider && formData.momoNumber.length === 9;
      case "location":
        return formData.city && formData.area;
      case "skills":
        return formData.skills.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        title={
          locale === "fr" ? "Completez votre profil" : "Complete your profile"
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
        {/* Identity Step */}
        {currentStep === "identity" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr"
                  ? "Informations personnelles"
                  : "Personal information"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Ces informations sont necessaires pour verifier votre identite."
                  : "This information is required to verify your identity."}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Prenom" : "First name"}
                </label>
                <Input
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      firstName: e.target.value,
                    }))
                  }
                  placeholder="John"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Nom" : "Last name"}
                </label>
                <Input
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      lastName: e.target.value,
                    }))
                  }
                  placeholder="Doe"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Date de naissance" : "Date of birth"}
                </label>
                <Input
                  type="date"
                  value={formData.birthDate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      birthDate: e.target.value,
                    }))
                  }
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Numero CNI" : "National ID number"}
                </label>
                <Input
                  value={formData.cniNumber}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      cniNumber: e.target.value,
                    }))
                  }
                  placeholder="XXXXXXXXXX"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr"
                    ? "Photo de la CNI (recto)"
                    : "ID card photo (front)"}
                </label>
                <div className="mt-1.5">
                  <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">
                      {formData.cniPhoto
                        ? formData.cniPhoto.name
                        : locale === "fr"
                          ? "Cliquez pour ajouter"
                          : "Click to upload"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setFormData((prev) => ({ ...prev, cniPhoto: file }));
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Money Step */}
        {currentStep === "momo" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                Mobile Money
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Ajoutez votre compte Mobile Money pour recevoir vos paiements."
                  : "Add your Mobile Money account to receive payments."}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {locale === "fr" ? "Operateur" : "Provider"}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, momoProvider: "mtn" }))
                    }
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl p-4 border-2 transition-all",
                      formData.momoProvider === "mtn"
                        ? "border-[#ffcc00] bg-[#ffcc00]/10"
                        : "border-border hover:border-[#ffcc00]/50",
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-[#ffcc00] flex items-center justify-center">
                      <span className="text-black font-bold text-sm">MTN</span>
                    </div>
                    <span className="text-sm font-medium">MTN MoMo</span>
                  </button>

                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        momoProvider: "orange",
                      }))
                    }
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl p-4 border-2 transition-all",
                      formData.momoProvider === "orange"
                        ? "border-[#ff6600] bg-[#ff6600]/10"
                        : "border-border hover:border-[#ff6600]/50",
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-[#ff6600] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">
                        Orange
                      </span>
                    </div>
                    <span className="text-sm font-medium">Orange Money</span>
                  </button>
                </div>
              </div>

              {formData.momoProvider && (
                <div>
                  <label className="text-sm font-medium text-foreground">
                    {locale === "fr"
                      ? "Numero Mobile Money"
                      : "Mobile Money number"}
                  </label>
                  <div className="flex gap-3 mt-1.5">
                    <div className="flex h-12 items-center justify-center rounded-xl bg-muted px-3 text-sm font-medium">
                      +237
                    </div>
                    <Input
                      type="tel"
                      placeholder="6XX XXX XXX"
                      value={formData.momoNumber}
                      onChange={(e) => {
                        const value = e.target.value
                          .replace(/\D/g, "")
                          .slice(0, 9);
                        setFormData((prev) => ({ ...prev, momoNumber: value }));
                      }}
                      className="flex-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Location Step */}
        {currentStep === "location" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr" ? "Votre localisation" : "Your location"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Nous utiliserons votre position pour vous proposer des offres proches."
                  : "We'll use your location to suggest nearby jobs."}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Ville" : "City"}
                </label>
                <select
                  value={formData.city}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, city: e.target.value }))
                  }
                  className="mt-1.5 w-full h-12 rounded-xl border border-input bg-background px-3 text-foreground"
                >
                  <option value="">
                    {locale === "fr"
                      ? "Selectionnez une ville"
                      : "Select a city"}
                  </option>
                  <option value="douala">Douala</option>
                  <option value="yaounde">Yaounde</option>
                  <option value="bafoussam">Bafoussam</option>
                  <option value="garoua">Garoua</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === "fr" ? "Quartier" : "Area"}
                </label>
                <Input
                  value={formData.area}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, area: e.target.value }))
                  }
                  placeholder={
                    locale === "fr"
                      ? "Ex: Bonanjo, Akwa..."
                      : "Ex: Bonanjo, Akwa..."
                  }
                  className="mt-1.5"
                />
              </div>

              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MapPin className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium text-foreground">
                          {locale === "fr" ? "Activer le GPS" : "Enable GPS"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {locale === "fr"
                            ? "Pour des suggestions plus precises"
                            : "For more accurate suggestions"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          gpsEnabled: !prev.gpsEnabled,
                        }))
                      }
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        formData.gpsEnabled ? "bg-primary" : "bg-muted",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          formData.gpsEnabled
                            ? "translate-x-5"
                            : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Skills Step */}
        {currentStep === "skills" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === "fr" ? "Vos competences" : "Your skills"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === "fr"
                  ? "Selectionnez les domaines dans lesquels vous avez de l'experience."
                  : "Select the areas where you have experience."}
              </p>
            </div>

            <div className="space-y-6">
              {skillCategories.map((category) => (
                <div key={category.id}>
                  <h3 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
                    {locale === "fr" ? category.labelFr : category.labelEn}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {category.skills.map((skill) => (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        className={cn(
                          "px-4 py-2 rounded-full text-sm font-medium transition-all",
                          formData.skills.includes(skill.id)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80",
                        )}
                      >
                        {locale === "fr" ? skill.labelFr : skill.labelEn}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
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
              "Terminer"
            ) : (
              "Complete"
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
