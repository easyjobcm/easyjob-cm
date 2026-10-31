"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import {
  ClipboardList,
  Calendar,
  ChevronRight,
  MapPin,
  Clock,
  Building2,
  QrCode,
  CheckCircle,
  Loader2,
  FileEdit,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import useSWR from "swr";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDateShort } from "@/lib/utils/profile-status";
import { useRealtimeCandidateSync } from "@/lib/hooks/use-realtime-sync";
import type { ProfileLockGroup } from "@/lib/utils/profile-lock";

interface Mission {
  id: string;
  status: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  arrival_validated: boolean;
  departure_validated: boolean;
  job: {
    id: string;
    title: string;
    city: string;
    address: string;
    hourly_rate: number;
    company: {
      company_name: string;
    };
  };
}

/** Demande de mise à jour de profil initiée par l'admin (SRS §5.1). */
interface ProfileUpdateRequest {
  id: string;
  fields: ProfileLockGroup[];
  reason: string | null;
  created_at: string | null;
}

const fetcher = async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { missions: [], updateRequests: [] };

  // Get candidate profile
  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!profile) return { missions: [], updateRequests: [] };

  // Get upcoming missions + profile-update requests initiated by the admin
  const today = new Date().toISOString().split("T")[0];
  const [missionsRes, requestsRes] = await Promise.all([
    supabase
      .from("missions")
      .select(
        `
        id,
        status,
        scheduled_date,
        scheduled_start_time,
        scheduled_end_time,
        arrival_validated,
        departure_validated,
        job:jobs (
          id,
          title,
          city,
          address,
          hourly_rate,
          company:company_profiles (
            company_name
          )
        )
      `,
      )
      .eq("candidate_id", profile.id)
      .in("status", ["pending", "confirmed", "in_progress"])
      .gte("scheduled_date", today)
      .order("scheduled_date", { ascending: true }),
    supabase
      .from("profile_update_requests")
      .select("id, fields, reason, created_at")
      .eq("candidate_id", profile.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  return {
    missions: (missionsRes.data as unknown as Mission[] | null) ?? [],
    updateRequests:
      (requestsRes.data as unknown as ProfileUpdateRequest[] | null) ?? [],
  };
};

export default function TasksPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const tr = t.profile.profileUpdateRequests;
  const { data, isLoading } = useSWR<{
    missions: Mission[];
    updateRequests: ProfileUpdateRequest[];
  } | null>("/api/tasks", fetcher);
  const missions = data?.missions ?? [];
  const updateRequests = data?.updateRequests ?? [];
  const [openRequestId, setOpenRequestId] = React.useState<string | null>(null);

  useRealtimeCandidateSync("/api/tasks");

  const hasTasks = missions.length > 0 || updateRequests.length > 0;

  const openRequest = updateRequests.find((r) => r.id === openRequestId);

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split("T")[0];
    return dateStr === today;
  };

  const isTomorrow = (dateStr: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateStr === tomorrow.toISOString().split("T")[0];
  };

  const getDateLabel = (dateStr: string) => {
    if (isToday(dateStr)) return locale === "fr" ? "Aujourd'hui" : "Today";
    if (isTomorrow(dateStr)) return locale === "fr" ? "Demain" : "Tomorrow";
    return formatDate(dateStr, locale);
  };

  const renderMissionCard = (mission: Mission) => {
    const isActive =
      mission.status === "in_progress" || isToday(mission.scheduled_date);

    return (
      <Card
        key={mission.id}
        className={`transition-all ${isActive ? "border-primary shadow-md" : ""}`}
      >
        <CardContent className="p-4">
          {isActive && (
            <Badge variant="default" className="mb-3 bg-primary">
              {mission.status === "in_progress"
                ? locale === "fr"
                  ? "En cours"
                  : "In Progress"
                : locale === "fr"
                  ? "Aujourd'hui"
                  : "Today"}
            </Badge>
          )}

          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">
              {mission.job?.title}
            </h3>
            <span className="text-sm font-medium text-primary">
              {getDateLabel(mission.scheduled_date)}
            </span>
          </div>

          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
            <Building2 className="h-4 w-4" />
            <span>{mission.job?.company?.company_name}</span>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground mb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>
                {mission.scheduled_start_time?.slice(0, 5)} -{" "}
                {mission.scheduled_end_time?.slice(0, 5)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>
                {mission.job?.address}, {mission.job?.city}
              </span>
            </div>
          </div>

          {/* Check-in status */}
          <div className="flex gap-2 mb-4">
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                mission.arrival_validated
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle className="h-3 w-3" />
              <span>{locale === "fr" ? "Arrivée" : "Arrival"}</span>
            </div>
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                mission.departure_validated
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle className="h-3 w-3" />
              <span>{locale === "fr" ? "Départ" : "Departure"}</span>
            </div>
          </div>

          <div className="pt-3 border-t border-border flex justify-between items-center">
            <span className="font-semibold text-primary">
              {formatCurrency(mission.job?.hourly_rate || 0)}/h
            </span>

            {isActive && !mission.arrival_validated && (
              <Link href={`/missions/${mission.id}/check-in`}>
                <Button size="sm" className="gap-2">
                  <QrCode className="h-4 w-4" />
                  {locale === "fr" ? "Pointer" : "Check In"}
                </Button>
              </Link>
            )}

            {isActive &&
              mission.arrival_validated &&
              !mission.departure_validated && (
                <Link href={`/missions/${mission.id}/check-out`}>
                  <Button size="sm" variant="outline" className="gap-2">
                    <QrCode className="h-4 w-4" />
                    {locale === "fr" ? "Départ" : "Check Out"}
                  </Button>
                </Link>
              )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const fieldLabelsFor = (fields: ProfileLockGroup[]) =>
    fields
      .map((g) =>
        g === "identity"
          ? tr.identity
          : g === "cni_documents"
            ? tr.cni_documents
            : g,
      )
      .join(" · ");

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="mb-6 text-2xl font-bold text-foreground">
          {locale === "fr" ? "Tâches" : "Tasks"}
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !hasTasks ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-linear-to-br from-primary/20 to-accent/20">
                <ClipboardList className="h-12 w-12 text-primary" />
              </div>
              <div className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-background bg-card">
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>

            <h2 className="mb-2 text-xl font-semibold">
              {locale === "fr" ? "Vous êtes prêt !" : "You're all set!"}
            </h2>
            <p className="mb-6 max-w-xs text-muted-foreground">
              {locale === "fr"
                ? "Aucune tâche en attente. Explorez les offres pour trouver votre prochaine mission."
                : "No pending tasks. Explore jobs to find your next opportunity."}
            </p>

            <Link href="/jobs">
              <Button>
                {locale === "fr" ? "Découvrir les offres" : "Discover jobs"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mises à jour de profil demandées par l'admin (SRS §5.1) */}
            {updateRequests.map((r) => (
              <Card key={r.id} className="border-primary/40 bg-primary/5">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <FileEdit className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          {tr.title}
                        </h3>
                        <Badge variant="default" className="bg-primary">
                          {fieldLabelsFor(r.fields)}
                        </Badge>
                      </div>
                      {r.created_at && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDateShort(r.created_at, locale)}
                        </p>
                      )}
                    </div>
                  </div>
                  {r.reason && (
                    <p className="rounded-lg bg-card/70 px-3 py-2 text-sm text-muted-foreground">
                      {r.reason}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => setOpenRequestId(r.id)}
                    >
                      {tr.start}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Missions à accomplir */}
            {missions.map(renderMissionCard)}
          </div>
        )}
      </div>

      {/* Modal détail demande + CTA vers la page d'édition */}
      <Modal
        isOpen={!!openRequest}
        onClose={() => setOpenRequestId(null)}
        title={tr.title}
      >
        {openRequest && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {openRequest.fields.map((g) => (
                <Badge key={g} variant="outline">
                  {fieldLabelsFor([g])}
                </Badge>
              ))}
            </div>
            {openRequest.reason && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {tr.reasonLabel} :{" "}
                </span>
                {openRequest.reason}
              </p>
            )}
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {tr.hint}
            </p>
            <div className="flex flex-col gap-2">
              {openRequest.fields.includes("identity") && (
                <Button
                  onClick={() => {
                    setOpenRequestId(null);
                    router.push("/profile/candidate/edit");
                  }}
                >
                  {tr.goToEdit}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
              {openRequest.fields.includes("cni_documents") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenRequestId(null);
                    router.push("/profile/candidate/edit?focus=photo");
                  }}
                >
                  {tr.goToDocuments}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
