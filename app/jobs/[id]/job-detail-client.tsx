"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { LoadingSpinner } from "@/components/ui/loading";
import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import {
  MapPin,
  Clock,
  Calendar,
  Briefcase,
  Heart,
  Info,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  Share2,
  Zap,
} from "lucide-react";

interface JobDetailClientProps {
  job: {
    id: string;
    title: string;
    address: string;
    quartier?: string | null;
    city: string;
    latitude?: number | null;
    longitude?: number | null;
    description: string;
    currency?: string;
    hourly_rate: number;
    start_date: string;
    end_date?: string | null;
    start_time: string;
    end_time: string;
    urgency?: string;
    positions_available: number;
    positions_filled: number;
    company?: {
      company_name?: string;
      logo_url?: string | null;
      sector?: string;
      description?: string;
      [key: string]: string | null | undefined;
    };
    category?: {
      name_fr?: string;
      name_en?: string;
    };
    required_skills?: string[];
    min_experience_months?: number;
    dress_code?: string;
    special_instructions?: string;
  };
  userApplication: {
    id: string;
  } | null;
  isFavorite: boolean;
  isLoggedIn: boolean;
}

export function JobDetailClient({
  job,
  userApplication,
  isFavorite: initialFavorite,
  isLoggedIn,
}: JobDetailClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [isFavorite, setIsFavorite] = React.useState(initialFavorite);
  const [hasApplied, setHasApplied] = React.useState(!!userApplication);

  const categoryName =
    locale === "fr" ? job.category?.name_fr : job.category?.name_en;

  // Calculate duration and total pay
  const calculateDuration = (start: string, end: string) => {
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    let hours = endH - startH + (endM - startM) / 60;
    if (hours < 0) hours += 24; // Handle overnight shifts
    return hours;
  };

  const duration = calculateDuration(job.start_time, job.end_time);
  const totalPay = duration * job.hourly_rate;

  const handleApply = async () => {
    if (!isLoggedIn) {
      router.push("/login?redirect=/jobs/" + job.id);
      return;
    }

    setApplying(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        setHasApplied(true);
        setShowConfirmModal(false);
        // Show success state
      } else {
        const error = await res.json();
        alert(error.error || "Une erreur est survenue");
      }
    } catch (error) {
      console.error("Error applying:", error);
      alert("Une erreur est survenue");
    } finally {
      setApplying(false);
    }
  };

  const toggleFavorite = async () => {
    if (!isLoggedIn) {
      router.push("/login?redirect=/jobs/" + job.id);
      return;
    }
    // Optimistic update
    setIsFavorite(!isFavorite);
    // TODO: Implement API call
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: job.title,
          text: `${job.title} - ${job.company?.company_name}`,
          url: window.location.href,
        });
      } catch {
        // User cancelled or error
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background pb-28">
      {/* Header with gradient */}
      <div className="bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <Header
          title=""
          showBack
          className="bg-transparent"
          rightAction={
            <div className="flex gap-2">
              <button
                onClick={toggleFavorite}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Heart
                  className={`w-5 h-5 ${isFavorite ? "fill-current text-red-400" : ""}`}
                />
              </button>
              <button
                onClick={handleShare}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          }
        />

        <div className="px-4 pb-6">
          {/* Urgency badge */}
          {job.urgency !== "normal" && (
            <Badge className="mb-2 bg-white/20 text-white border-white/30">
              <Zap className="w-3 h-3 mr-1" />
              {job.urgency === "critical" ? "Tres urgent" : "Urgent"}
            </Badge>
          )}

          <h1 className="text-2xl font-bold mb-2">{job.title}</h1>

          <div className="flex items-center gap-2 text-white/80 mb-3">
            <Briefcase className="w-4 h-4" />
            <span>{job.company?.company_name}</span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {formatCurrency(job.hourly_rate, job.currency)}
            </span>
            <span className="text-white/80">/h</span>
          </div>
          {categoryName && (
            <p className="text-white/80 text-sm mt-1">{categoryName}</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 -mt-4 relative z-10">
        {/* Application status card */}
        {hasApplied ? (
          <Card className="mb-4 border-success/20 bg-success/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    {locale === "fr"
                      ? "Candidature envoyee !"
                      : "Application sent!"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {locale === "fr"
                      ? "Vous serez notifie si vous etes selectionne."
                      : "You will be notified if selected."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-4 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    {locale === "fr" ? "Postulez maintenant !" : "Apply now!"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {job.positions_available - job.positions_filled}{" "}
                    {locale === "fr"
                      ? "place(s) disponible(s)"
                      : "position(s) available"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Location */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Lieu" : "Location"}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{job.address}</p>
                  <p className="text-sm text-muted-foreground">
                    {job.quartier && `${job.quartier}, `}
                    {job.city}
                  </p>
                </div>
                {job.latitude && job.longitude && (
                  <a
                    href={`https://www.google.com/maps?q=${job.latitude},${job.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-primary font-medium"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Schedule */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Details de la mission" : "Job Details"}
          </h2>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground capitalize">
                      {formatDate(job.start_date, locale)}
                    </p>
                    {job.end_date && job.end_date !== job.start_date && (
                      <p className="text-sm text-muted-foreground">
                        {locale === "fr" ? "au" : "to"}{" "}
                        {formatDate(job.end_date, locale)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">
                      {formatTime(job.start_time)} - {formatTime(job.end_time)}
                    </p>
                    <p className="text-sm text-muted-foreground">{duration}h</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Description */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === "fr" ? "Description" : "Description"}
          </h2>
          <Card>
            <CardContent className="p-4">
              <p className="text-foreground whitespace-pre-line text-sm leading-relaxed">
                {job.description}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Required Skills */}
        {job.required_skills && job.required_skills.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr" ? "Competences requises" : "Required Skills"}
            </h2>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-2">
                  {job.required_skills.map((skill: string, index: number) => (
                    <Badge key={index} variant="secondary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Dress code & Instructions */}
        {(job.dress_code || job.special_instructions) && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr" ? "Instructions" : "Instructions"}
            </h2>
            <Card>
              <CardContent className="p-4 space-y-3">
                {job.dress_code && (
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {locale === "fr" ? "Tenue vestimentaire" : "Dress code"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.dress_code}
                    </p>
                  </div>
                )}
                {job.special_instructions && (
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {locale === "fr"
                        ? "Instructions speciales"
                        : "Special instructions"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.special_instructions}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Company Info */}
        {job.company && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              {locale === "fr"
                ? "A propos de l'entreprise"
                : "About the company"}
            </h2>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    {job.company.logo_url ? (
                      <img
                        src={job.company.logo_url}
                        alt={job.company.company_name}
                        className="w-full h-full object-cover rounded-xl"
                      />
                    ) : (
                      <Briefcase className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {job.company.company_name}
                    </p>
                    {job.company.sector && (
                      <p className="text-sm text-muted-foreground">
                        {job.company.sector}
                      </p>
                    )}
                  </div>
                </div>
                {job.company.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {job.company.description}
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {locale === "fr" ? "Remuneration totale" : "Total pay"}
            </p>
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(totalPay, job.currency)}
            </p>
          </div>
          <Badge variant="secondary" className="text-base px-3 py-1">
            {duration}h
          </Badge>
        </div>

        {hasApplied ? (
          <Button
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => router.push("/dashboard/applications")}
          >
            {locale === "fr" ? "Voir mes candidatures" : "View my applications"}
          </Button>
        ) : (
          <Button
            onClick={() => setShowConfirmModal(true)}
            className="w-full"
            size="lg"
          >
            {locale === "fr" ? "Postuler maintenant" : "Apply now"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={
          locale === "fr"
            ? "Confirmer votre candidature"
            : "Confirm your application"
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {locale === "fr"
              ? "Avant de postuler, assurez-vous de pouvoir vous presenter a cette mission."
              : "Before applying, make sure you can attend this job."}
          </p>

          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{job.title}</span>
                <Badge variant="outline">{job.company?.company_name}</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(job.start_date, locale)}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {formatTime(job.start_time)}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="p-3 rounded-xl bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <p className="text-sm text-foreground">
                {locale === "fr"
                  ? "Une absence non justifiee peut affecter votre score de fiabilite."
                  : "Unexcused absence may affect your reliability score."}
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="flex-1"
            >
              {locale === "fr" ? "Annuler" : "Cancel"}
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying}
              className="flex-1"
            >
              {applying ? (
                <LoadingSpinner size="sm" />
              ) : locale === "fr" ? (
                "Confirmer"
              ) : (
                "Confirm"
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
