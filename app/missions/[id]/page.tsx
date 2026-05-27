"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  CheckCircle,
  Play,
  Square,
  Star,
  Navigation,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BottomNav } from "@/components/layout/bottom-nav";

interface Mission {
  id: string;
  status: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  actual_start_time: string | null;
  actual_end_time: string | null;
  arrival_validated: boolean;
  departure_validated: boolean;
  company_validation_code: string;
  job: {
    id: string;
    title: string;
    hourly_rate: number;
    city: string;
    address: string;
    latitude: number;
    longitude: number;
    company: {
      company_name: string;
      contact_phone: string;
    };
  };
}

export default function MissionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const missionId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [mission, setMission] = useState<Mission | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    loadMission();
    getCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function loadMission() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: missionData } = await supabase
      .from("missions")
      .select(
        `
        *,
        job:jobs(
          *,
          company:company_profiles(company_name, contact_phone)
        )
      `,
      )
      .eq("id", missionId)
      .single();

    if (missionData) {
      setMission(missionData as Mission);
    }

    setLoading(false);
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError("La geolocalisation n'est pas supportee");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationError(null);
      },
      (error) => {
        setLocationError("Impossible d'obtenir votre position");
        console.error("[v0] Geolocation error:", error);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleCheckIn = async () => {
    if (!mission || !userLocation) {
      toast({
        title: "Erreur",
        description: "Veuillez activer la geolocalisation",
        variant: "destructive",
      });
      return;
    }

    // Check distance from job location
    const distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      mission.job.latitude,
      mission.job.longitude,
    );

    if (distance > 500) {
      // More than 500 meters
      toast({
        title: "Trop loin",
        description: `Vous etes a ${Math.round(distance)}m du lieu de travail. Rapprochez-vous pour pointer.`,
        variant: "destructive",
      });
      return;
    }

    setCheckingIn(true);
    const supabase = createClient();

    // Create check-in record
    await supabase.from("mission_check_ins").insert({
      mission_id: missionId,
      check_in_type: "arrival",
      latitude: userLocation.lat,
      longitude: userLocation.lng,
      distance_from_job_meters: distance,
    });

    // Update mission status
    const { error } = await supabase
      .from("missions")
      .update({
        status: "in_progress",
        actual_start_time: new Date().toISOString(),
        arrival_latitude: userLocation.lat,
        arrival_longitude: userLocation.lng,
        arrival_distance_meters: distance,
      })
      .eq("id", missionId);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de pointer",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Pointage enregistre",
        description: "Bon travail !",
      });
      loadMission();
    }

    setCheckingIn(false);
  };

  const handleCheckOut = async () => {
    if (!mission || !userLocation) return;

    setCheckingIn(true);
    const supabase = createClient();

    const distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      mission.job.latitude,
      mission.job.longitude,
    );

    // Create check-out record
    await supabase.from("mission_check_ins").insert({
      mission_id: missionId,
      check_in_type: "departure",
      latitude: userLocation.lat,
      longitude: userLocation.lng,
      distance_from_job_meters: distance,
    });

    // Update mission status
    const { error } = await supabase
      .from("missions")
      .update({
        status: "completed",
        actual_end_time: new Date().toISOString(),
      })
      .eq("id", missionId);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de terminer la mission",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Mission terminee",
        description: "Merci pour votre travail !",
      });
      setShowRatingDialog(true);
      loadMission();
    }

    setCheckingIn(false);
  };

  const handleSubmitReview = async () => {
    if (!mission || rating === 0) return;

    setSubmittingReview(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data: profile } = await supabase
      .from("candidate_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) return;

    // Get company profile id from job
    const { data: job } = await supabase
      .from("jobs")
      .select("company_id")
      .eq("id", mission.job.id)
      .single();

    if (!job) return;

    const { error } = await supabase.from("reviews").insert({
      mission_id: missionId,
      reviewer_type: "candidate",
      reviewer_id: profile.id,
      reviewed_type: "company",
      reviewed_id: job.company_id,
      overall_rating: rating,
      comment: reviewComment || null,
    });

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible d'envoyer l'evaluation",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Merci !",
        description: "Votre evaluation a ete enregistree",
      });
      setShowRatingDialog(false);
    }

    setSubmittingReview(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || "";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-700">En attente</Badge>
        );
      case "confirmed":
        return <Badge className="bg-blue-100 text-blue-700">Confirme</Badge>;
      case "in_progress":
        return <Badge className="bg-green-100 text-green-700">En cours</Badge>;
      case "completed":
        return <Badge className="bg-green-100 text-green-700">Termine</Badge>;
      case "cancelled":
        return <Badge className="bg-red-100 text-red-700">Annule</Badge>;
      case "no_show":
        return <Badge className="bg-red-100 text-red-700">Absent</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const calculateProgress = () => {
    if (!mission) return 0;
    if (mission.status === "completed") return 100;
    if (mission.status !== "in_progress" || !mission.actual_start_time)
      return 0;

    const start = new Date(mission.actual_start_time).getTime();
    const scheduledEnd = new Date(
      `${mission.scheduled_date}T${mission.scheduled_end_time}`,
    ).getTime();
    const now = Date.now();

    const totalDuration = scheduledEnd - start;
    const elapsed = now - start;

    return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 pb-20 space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
        <BottomNav />
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="min-h-screen bg-background p-4 pb-20">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="text-center mt-8">
          <p className="text-muted-foreground">Mission non trouvee</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  const isToday =
    new Date(mission.scheduled_date).toDateString() ===
    new Date().toDateString();
  const canCheckIn =
    isToday && ["pending", "confirmed"].includes(mission.status);
  const canCheckOut = mission.status === "in_progress";

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 text-white p-4 rounded-b-3xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="text-white hover:bg-white/10 mb-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{mission.job?.title}</h1>
            <p className="text-white/80">
              {mission.job?.company?.company_name}
            </p>
          </div>
          {getStatusBadge(mission.status)}
        </div>

        {mission.status === "in_progress" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Progression</span>
              <span>{Math.round(calculateProgress())}%</span>
            </div>
            <Progress value={calculateProgress()} className="h-2 bg-white/20" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Mission Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details de la mission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{formatDate(mission.scheduled_date)}</span>
              {isToday && (
                <Badge className="bg-green-100 text-green-700 text-xs">
                  Aujourd&apos;hui
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {formatTime(mission.scheduled_start_time)} -{" "}
                {formatTime(mission.scheduled_end_time)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>
                {mission.job?.address}, {mission.job?.city}
              </span>
            </div>
            <div className="pt-2 border-t">
              <span className="text-lg font-bold text-violet-600">
                {mission.job?.hourly_rate?.toLocaleString()} XAF/heure
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Location Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Navigation className="h-4 w-4" />
              Geolocalisation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {locationError ? (
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{locationError}</span>
              </div>
            ) : userLocation ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm">Position detectee</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 animate-spin" />
                <span className="text-sm">Detection en cours...</span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={getCurrentLocation}
            >
              Actualiser la position
            </Button>
          </CardContent>
        </Card>

        {/* Check-in/Check-out Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pointage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Arrivee</span>
              {mission.actual_start_time ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">
                    {new Date(mission.actual_start_time).toLocaleTimeString(
                      "fr-FR",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                </div>
              ) : (
                <Badge variant="outline">Non pointe</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span>Depart</span>
              {mission.actual_end_time ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">
                    {new Date(mission.actual_end_time).toLocaleTimeString(
                      "fr-FR",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                </div>
              ) : (
                <Badge variant="outline">Non pointe</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        {canCheckIn && (
          <Button
            className="w-full h-14 text-lg"
            onClick={handleCheckIn}
            disabled={checkingIn || !userLocation}
          >
            <Play className="h-5 w-5 mr-2" />
            {checkingIn ? "Pointage en cours..." : "Pointer mon arrivee"}
          </Button>
        )}

        {canCheckOut && (
          <Button
            className="w-full h-14 text-lg"
            variant="destructive"
            onClick={handleCheckOut}
            disabled={checkingIn}
          >
            <Square className="h-5 w-5 mr-2" />
            {checkingIn ? "Traitement..." : "Terminer la mission"}
          </Button>
        )}

        {mission.status === "completed" && (
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4 text-center">
              <CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-2" />
              <p className="font-semibold text-green-700">Mission terminee</p>
              <p className="text-sm text-green-600">
                Votre paiement sera traite sous 48h
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Rating Dialog */}
      <Dialog open={showRatingDialog} onOpenChange={setShowRatingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Evaluez cette mission</DialogTitle>
            <DialogDescription>
              Comment s&apos;est passee votre experience avec{" "}
              {mission.job?.company?.company_name} ?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="focus:outline-none"
                >
                  <Star
                    className={`h-10 w-10 ${
                      star <= rating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Laissez un commentaire (optionnel)"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRatingDialog(false)}
            >
              Plus tard
            </Button>
            <Button
              onClick={handleSubmitReview}
              disabled={submittingReview || rating === 0}
            >
              {submittingReview ? "Envoi..." : "Envoyer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
