"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Briefcase,
  Users,
  Clock,
  TrendingUp,
  Plus,
  ChevronRight,
  Calendar,
  MapPin,
  Bell,
  Settings,
  Building2,
} from "lucide-react";

interface CompanyDashboardClientProps {
  user: {
    id?: string;
  };
  profile: {
    logo_url?: string | null;
    company_name: string;
  };
  jobs: Array<{
    id: string;
    status: string;
    urgency?: string;
    title: string;
    start_date: string;
    city: string;
    start_time?: string | null;
    hourly_rate: number;
    currency?: string;
    applications?: Array<{
      count?: number;
    }>;
  }>;
  stats: {
    totalJobs: number;
    activeJobs: number;
    totalApplications: number;
    pendingApplications: number;
  };
}

export function CompanyDashboardClient({
  user: _user,
  profile,
  jobs,
  stats,
}: CompanyDashboardClientProps) {
  const { locale } = useI18n();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return locale === "fr" ? "Bonjour" : "Good morning";
    if (hour < 18) return locale === "fr" ? "Bon apres-midi" : "Good afternoon";
    return locale === "fr" ? "Bonsoir" : "Good evening";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="secondary">
            {locale === "fr" ? "Brouillon" : "Draft"}
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="warning">
            {locale === "fr" ? "En attente" : "Pending"}
          </Badge>
        );
      case "published":
        return (
          <Badge variant="success">
            {locale === "fr" ? "Publie" : "Published"}
          </Badge>
        );
      case "filled":
        return (
          <Badge variant="outline">
            {locale === "fr" ? "Pourvu" : "Filled"}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="destructive">
            {locale === "fr" ? "Annule" : "Cancelled"}
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              {profile.logo_url ? (
                <img
                  src={profile.logo_url}
                  alt={profile.company_name}
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <Building2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-sm text-white/70">{getGreeting()}</p>
              <h1 className="font-bold">{profile.company_name}</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/company/notifications">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
              >
                <Bell className="w-5 h-5" />
              </Button>
            </Link>
            <Link href="/company/settings">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
              >
                <Settings className="w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 pb-6">
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-white/10 border-white/20">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Briefcase className="w-4 h-4 text-white/70" />
                  <span className="text-xs text-white/70">
                    {locale === "fr" ? "Offres actives" : "Active jobs"}
                  </span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {stats.activeJobs}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-white/10 border-white/20">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-white/70" />
                  <span className="text-xs text-white/70">
                    {locale === "fr" ? "Candidatures" : "Applications"}
                  </span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {stats.pendingApplications}
                  <span className="text-sm font-normal text-white/70">
                    {" "}
                    / {stats.totalApplications}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4 relative z-10 space-y-6">
        {/* Quick Actions */}
        <Card className="shadow-lg">
          <CardContent className="p-4">
            <Link href="/company/jobs/new">
              <Button className="w-full" size="lg">
                <Plus className="w-5 h-5 mr-2" />
                {locale === "fr" ? "Publier une offre" : "Post a job"}
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Jobs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">
              {locale === "fr" ? "Mes offres" : "My jobs"}
            </h2>
            <Link
              href="/company/jobs"
              className="text-sm text-primary font-medium flex items-center gap-1"
            >
              {locale === "fr" ? "Tout voir" : "See all"}
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {jobs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">
                  {locale === "fr"
                    ? "Vous n'avez pas encore publie d'offre"
                    : "You haven't posted any jobs yet"}
                </p>
                <Link href="/company/jobs/new">
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    {locale === "fr" ? "Creer une offre" : "Create a job"}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <Card key={job.id} className="hover:shadow-md transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusBadge(job.status)}
                          {job.urgency !== "normal" && (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                            >
                              {job.urgency === "critical" ? "URGENT" : "ASAP"}
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground truncate">
                          {job.title}
                        </h3>
                      </div>
                      <Link href={`/company/jobs/${job.id}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                      </Link>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(job.start_date, locale)}
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {job.city}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {job.start_time?.slice(0, 5)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          <span className="font-medium text-foreground">
                            {job.applications?.[0]?.count || 0}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            {locale === "fr" ? "candidat(s)" : "applicant(s)"}
                          </span>
                        </span>
                      </div>
                      <p className="text-sm font-medium text-primary">
                        {formatCurrency(job.hourly_rate, job.currency)}/h
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/company/applications">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <p className="font-medium text-foreground text-sm">
                  {locale === "fr" ? "Candidatures" : "Applications"}
                </p>
                {stats.pendingApplications > 0 && (
                  <Badge variant="destructive" className="mt-1">
                    {stats.pendingApplications}{" "}
                    {locale === "fr" ? "en attente" : "pending"}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </Link>

          <Link href="/company/analytics">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-2">
                  <TrendingUp className="w-6 h-6 text-success" />
                </div>
                <p className="font-medium text-foreground text-sm">
                  {locale === "fr" ? "Statistiques" : "Analytics"}
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
