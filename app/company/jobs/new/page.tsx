"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Calendar,
  Clock,
  Banknote,
  ChevronRight,
  Check,
  AlertTriangle,
} from "lucide-react";

type Step = "basics" | "schedule" | "requirements" | "payment" | "review";

const steps: { id: Step; labelFr: string; labelEn: string }[] = [
  { id: "basics", labelFr: "Infos", labelEn: "Basics" },
  { id: "schedule", labelFr: "Horaires", labelEn: "Schedule" },
  { id: "requirements", labelFr: "Exigences", labelEn: "Requirements" },
  { id: "payment", labelFr: "Paiement", labelEn: "Payment" },
  { id: "review", labelFr: "Apercu", labelEn: "Review" },
];

const jobCategories = [
  { id: "restauration", labelFr: "Restauration", labelEn: "Restaurant" },
  { id: "securite", labelFr: "Securite", labelEn: "Security" },
  { id: "logistique", labelFr: "Logistique", labelEn: "Logistics" },
  { id: "evenementiel", labelFr: "Evenementiel", labelEn: "Events" },
  { id: "commerce", labelFr: "Commerce", labelEn: "Retail" },
  { id: "autre", labelFr: "Autre", labelEn: "Other" },
];

const jobTypes = [
  {
    id: "shift",
    labelFr: "Mission ponctuelle",
    labelEn: "One-time shift",
    descFr: "Pour un jour specifique",
    descEn: "For a specific day",
  },
  {
    id: "contract",
    labelFr: "Contrat temporaire",
    labelEn: "Temporary contract",
    descFr: "Plusieurs jours/semaines",
    descEn: "Multiple days/weeks",
  },
];

export default function NewJobPage() {
  const router = useRouter();
  const { locale } = useTranslation();
  const [currentStep, setCurrentStep] = React.useState<Step>("basics");
  const [loading, setLoading] = React.useState(false);

  const [formData, setFormData] = React.useState({
    title: "",
    category: "",
    type: "shift" as "shift" | "contract",
    description: "",
    // Schedule
    date: "",
    startTime: "",
    endTime: "",
    startDate: "",
    endDate: "",
    hoursPerWeek: "",
    workersNeeded: 1,
    // Location
    useCompanyAddress: true,
    customAddress: "",
    // Requirements
    requirements: [] as string[],
    benefits: [] as string[],
    customRequirement: "",
    customBenefit: "",
    // Payment
    hourlyRate: "",
    urgent: false,
  });

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    } else {
      router.back();
    }
  };

  const handlePublish = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login?redirect=/company/jobs/new");
        return;
      }

      // Get company profile
      const { data: companyProfile } = await supabase
        .from("company_profiles")
        .select("id, city, address")
        .eq("user_id", user.id)
        .single();

      if (!companyProfile) {
        router.push("/onboarding/company");
        return;
      }

      const { error } = await supabase.from("jobs").insert({
        company_id: companyProfile.id,
        title: formData.title,
        category_id: null, // Will be set based on category selection
        job_type: formData.type === "shift" ? "one_time" : "temporary",
        description: formData.description,
        start_date:
          formData.type === "shift" ? formData.date : formData.startDate,
        end_date:
          formData.type === "contract" ? formData.endDate : formData.date,
        start_time: formData.startTime,
        end_time: formData.endTime,
        positions_available: formData.workersNeeded,
        positions_filled: 0,
        hourly_rate: parseInt(formData.hourlyRate),
        currency: "XAF",
        city: companyProfile.city,
        address: companyProfile.address || "",
        required_skills: formData.requirements,
        urgency: formData.urgent ? "high" : "normal",
        status: "pending_review", // Needs moderation before publishing
      });

      if (error) {
        console.error("[v0] Job creation error:", error);
        return;
      }

      router.push("/company/jobs?created=true");
    } catch (error) {
      console.error("[v0] Job creation error:", error);
    } finally {
      setLoading(false);
    }
  };

  const commonRequirements = [
    {
      id: "exp",
      labelFr: "Experience recommandee",
      labelEn: "Experience recommended",
    },
    { id: "french", labelFr: "Francais courant", labelEn: "Fluent French" },
    { id: "english", labelFr: "Anglais", labelEn: "English" },
    { id: "punctual", labelFr: "Ponctualite", labelEn: "Punctuality" },
    { id: "dress", labelFr: "Tenue correcte", labelEn: "Proper attire" },
  ];

  const commonBenefits = [
    { id: "meal", labelFr: "Repas offert", labelEn: "Free meal" },
    { id: "tips", labelFr: "Pourboires partages", labelEn: "Shared tips" },
    { id: "transport", labelFr: "Transport", labelEn: "Transport" },
    {
      id: "regular",
      labelFr: "Missions regulieres possibles",
      labelEn: "Regular missions possible",
    },
  ];

  const toggleItem = (
    array: string[],
    item: string,
    field: "requirements" | "benefits",
  ) => {
    const newArray = array.includes(item)
      ? array.filter((i) => i !== item)
      : [...array, item];
    setFormData((prev) => ({ ...prev, [field]: newArray }));
  };

  const isStepValid = () => {
    switch (currentStep) {
      case "basics":
        return formData.title && formData.category && formData.description;
      case "schedule":
        if (formData.type === "shift") {
          return formData.date && formData.startTime && formData.endTime;
        }
        return formData.startDate && formData.endDate && formData.hoursPerWeek;
      case "requirements":
        return true;
      case "payment":
        return formData.hourlyRate && parseInt(formData.hourlyRate) >= 500;
      case "review":
        return true;
      default:
        return false;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("fr-CM").format(amount);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        title={locale === "fr" ? "Nouvelle offre" : "New job"}
        showBack
        onBack={handleBack}
      />

      {/* Progress */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex gap-1">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index <= currentStepIndex ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {locale === "fr"
            ? steps[currentStepIndex].labelFr
            : steps[currentStepIndex].labelEn}
          {" • "}
          {currentStepIndex + 1}/{steps.length}
        </p>
      </div>

      <div className="flex-1 px-6 py-6 overflow-y-auto">
        {/* Basics Step */}
        {currentStep === "basics" && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-foreground">
                {locale === "fr" ? "Titre du poste" : "Job title"}
              </label>
              <Input
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder={
                  locale === "fr"
                    ? "Ex: Serveur/Serveuse"
                    : "Ex: Waiter/Waitress"
                }
                className="mt-1.5"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">
                {locale === "fr" ? "Categorie" : "Category"}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {jobCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, category: cat.id }))
                    }
                    className={cn(
                      "rounded-xl px-4 py-3 text-sm font-medium transition-all text-left",
                      formData.category === cat.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {locale === "fr" ? cat.labelFr : cat.labelEn}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">
                {locale === "fr" ? "Type de mission" : "Job type"}
              </label>
              <div className="space-y-2">
                {jobTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        type: type.id as "shift" | "contract",
                      }))
                    }
                    className={cn(
                      "w-full rounded-xl p-4 text-left border-2 transition-all",
                      formData.type === type.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <p className="font-medium text-foreground">
                      {locale === "fr" ? type.labelFr : type.labelEn}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {locale === "fr" ? type.descFr : type.descEn}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">
                {locale === "fr" ? "Description du poste" : "Job description"}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={
                  locale === "fr"
                    ? "Decrivez les missions, le contexte..."
                    : "Describe the tasks, context..."
                }
                className="mt-1.5 w-full min-h-[120px] rounded-xl border border-input bg-background px-4 py-3 text-foreground resize-none"
              />
            </div>
          </div>
        )}

        {/* Schedule Step */}
        {currentStep === "schedule" && (
          <div className="space-y-6">
            {formData.type === "shift" ? (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    {locale === "fr" ? "Date de la mission" : "Job date"}
                  </label>
                  <Input
                    type="date"
                    value={formData.date}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, date: e.target.value }))
                    }
                    className="mt-1.5"
                    min={new Date().toISOString().split("T")[0]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Heure de debut" : "Start time"}
                    </label>
                    <Input
                      type="time"
                      value={formData.startTime}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          startTime: e.target.value,
                        }))
                      }
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Heure de fin" : "End time"}
                    </label>
                    <Input
                      type="time"
                      value={formData.endTime}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          endTime: e.target.value,
                        }))
                      }
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Date de debut" : "Start date"}
                    </label>
                    <Input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                        }))
                      }
                      className="mt-1.5"
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Date de fin" : "End date"}
                    </label>
                    <Input
                      type="date"
                      value={formData.endDate}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          endDate: e.target.value,
                        }))
                      }
                      className="mt-1.5"
                      min={
                        formData.startDate ||
                        new Date().toISOString().split("T")[0]
                      }
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    {locale === "fr" ? "Heures par semaine" : "Hours per week"}
                  </label>
                  <Input
                    type="number"
                    value={formData.hoursPerWeek}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        hoursPerWeek: e.target.value,
                      }))
                    }
                    placeholder="40"
                    className="mt-1.5"
                    min={1}
                    max={60}
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-medium text-foreground">
                {locale === "fr"
                  ? "Nombre de personnes recherchees"
                  : "Number of workers needed"}
              </label>
              <div className="flex items-center gap-3 mt-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      workersNeeded: Math.max(1, prev.workersNeeded - 1),
                    }))
                  }
                >
                  -
                </Button>
                <span className="text-xl font-bold w-12 text-center">
                  {formData.workersNeeded}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      workersNeeded: prev.workersNeeded + 1,
                    }))
                  }
                >
                  +
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Requirements Step */}
        {currentStep === "requirements" && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">
                {locale === "fr" ? "Exigences" : "Requirements"}
              </label>
              <div className="flex flex-wrap gap-2">
                {commonRequirements.map((req) => (
                  <button
                    key={req.id}
                    onClick={() =>
                      toggleItem(formData.requirements, req.id, "requirements")
                    }
                    className={cn(
                      "px-3 py-2 rounded-full text-sm font-medium transition-all",
                      formData.requirements.includes(req.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {locale === "fr" ? req.labelFr : req.labelEn}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-3 block">
                {locale === "fr" ? "Avantages proposes" : "Benefits offered"}
              </label>
              <div className="flex flex-wrap gap-2">
                {commonBenefits.map((benefit) => (
                  <button
                    key={benefit.id}
                    onClick={() =>
                      toggleItem(formData.benefits, benefit.id, "benefits")
                    }
                    className={cn(
                      "px-3 py-2 rounded-full text-sm font-medium transition-all",
                      formData.benefits.includes(benefit.id)
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {locale === "fr" ? benefit.labelFr : benefit.labelEn}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Payment Step */}
        {currentStep === "payment" && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-foreground">
                {locale === "fr" ? "Taux horaire (XAF)" : "Hourly rate (XAF)"}
              </label>
              <div className="relative mt-1.5">
                <Banknote className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.hourlyRate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      hourlyRate: e.target.value,
                    }))
                  }
                  placeholder="1500"
                  className="pl-10 text-lg"
                  min={500}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {locale === "fr"
                  ? "Minimum recommande: 1000 XAF/h"
                  : "Recommended minimum: 1000 XAF/h"}
              </p>
            </div>

            <Card
              className={cn(
                "cursor-pointer transition-all",
                formData.urgent
                  ? "border-warning bg-warning/5"
                  : "border-border hover:border-warning/50",
              )}
              onClick={() =>
                setFormData((prev) => ({ ...prev, urgent: !prev.urgent }))
              }
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle
                    className={cn(
                      "h-5 w-5",
                      formData.urgent
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {locale === "fr"
                        ? "Marquer comme urgent"
                        : "Mark as urgent"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {locale === "fr"
                        ? "Votre offre sera mise en avant"
                        : "Your job will be highlighted"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors",
                      formData.urgent
                        ? "border-warning bg-warning"
                        : "border-muted-foreground",
                    )}
                  >
                    {formData.urgent && (
                      <Check className="h-4 w-4 text-warning-foreground" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Review Step */}
        {currentStep === "review" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-foreground">
                    {formData.title}
                  </h3>
                  {formData.urgent && (
                    <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full font-medium">
                      URGENT
                    </span>
                  )}
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Briefcase className="h-4 w-4" />
                    <span>
                      {
                        jobCategories.find((c) => c.id === formData.category)?.[
                          locale === "fr" ? "labelFr" : "labelEn"
                        ]
                      }
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {formData.type === "shift"
                        ? formData.date
                        : `${formData.startDate} - ${formData.endDate}`}
                    </span>
                  </div>

                  {formData.type === "shift" && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>
                        {formData.startTime} - {formData.endTime}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Banknote className="h-4 w-4" />
                    <span className="font-semibold text-primary">
                      {formatCurrency(parseInt(formData.hourlyRate))} XAF/h
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <h4 className="text-sm font-medium text-foreground mb-2">
                  Description
                </h4>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {formData.description}
                </p>
              </CardContent>
            </Card>

            {(formData.requirements.length > 0 ||
              formData.benefits.length > 0) && (
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-3">
                  {formData.requirements.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-1">
                        {locale === "fr" ? "Exigences" : "Requirements"}
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {formData.requirements.map((req) => (
                          <span
                            key={req}
                            className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full"
                          >
                            {
                              commonRequirements.find((r) => r.id === req)?.[
                                locale === "fr" ? "labelFr" : "labelEn"
                              ]
                            }
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {formData.benefits.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-1">
                        {locale === "fr" ? "Avantages" : "Benefits"}
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {formData.benefits.map((benefit) => (
                          <span
                            key={benefit}
                            className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-full"
                          >
                            {
                              commonBenefits.find((b) => b.id === benefit)?.[
                                locale === "fr" ? "labelFr" : "labelEn"
                              ]
                            }
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        {currentStep === "review" ? (
          <Button
            onClick={handlePublish}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <LoadingSpinner size="sm" />
            ) : locale === "fr" ? (
              "Publier l'offre"
            ) : (
              "Publish job"
            )}
          </Button>
        ) : (
          <Button
            onClick={handleNext}
            disabled={!isStepValid()}
            className="w-full"
            size="lg"
          >
            {locale === "fr" ? "Continuer" : "Continue"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
