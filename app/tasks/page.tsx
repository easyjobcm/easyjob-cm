"use client";

import * as React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
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
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import useSWR from "swr";
import { formatCurrency, formatDate } from "@/lib/utils";

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

const fetcher = async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Get candidate profile
  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!profile) return [];

  // Get upcoming missions
  const today = new Date().toISOString().split("T")[0];
  const { data: missions } = await supabase
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
    .order("scheduled_date", { ascending: true });

  return missions || [];
};

export default function TasksPage() {
  const { locale } = useTranslation();
  const { data: missions, isLoading } = useSWR("/api/tasks", fetcher);
  const missionList = (missions || []) as unknown as Mission[];

  const hasTasks = missionList.length > 0;

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
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                mission.arrival_validated
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle className="h-3 w-3" />
              <span>{locale === "fr" ? "Arrivee" : "Arrival"}</span>
            </div>
            <div
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                mission.departure_validated
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle className="h-3 w-3" />
              <span>{locale === "fr" ? "Depart" : "Departure"}</span>
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
                    {locale === "fr" ? "Depart" : "Check Out"}
                  </Button>
                </Link>
              )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">
          {locale === "fr" ? "Taches" : "Tasks"}
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !hasTasks ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="h-24 w-24 rounded-3xl bg-linear-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <ClipboardList className="h-12 w-12 text-primary" />
              </div>
              <div className="absolute -bottom-2 -right-2 h-10 w-10 rounded-xl bg-card border-2 border-background flex items-center justify-center">
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>

            <h2 className="text-xl font-semibold text-foreground mb-2">
              {locale === "fr" ? "Vous etes pret !" : "You're all set!"}
            </h2>
            <p className="text-muted-foreground max-w-xs mb-6">
              {locale === "fr"
                ? "Aucune tache en attente. Explorez les offres pour trouver votre prochaine mission."
                : "No pending tasks. Explore jobs to find your next opportunity."}
            </p>

            <Link href="/jobs">
              <Button>
                {locale === "fr" ? "Decouvrir les offres" : "Discover jobs"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">{missionList.map(renderMissionCard)}</div>
        )}
      </div>
    </AppShell>
  );
}
