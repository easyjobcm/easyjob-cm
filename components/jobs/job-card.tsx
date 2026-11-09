"use client";

import * as React from "react";
import Link from "next/link";
import {
  MapPin,
  Clock,
  Calendar,
  Briefcase,
  ChevronRight,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useJobUrgent } from "@/lib/jobs/use-job-urgency";

interface JobCardProps {
  job: {
    id: string;
    title: string;
    description: string;
    city: string;
    quartier?: string;
    start_date: string;
    start_time: string;
    end_time: string;
    mission_pay_per_candidate: number;
    status?: string | null;
    positions_available: number;
    positions_filled: number;
    company?: {
      company_name: string;
      logo_url?: string;
    };
    category?: {
      name_fr: string;
      name_en: string;
      icon?: string;
    };
  };
  showCompany?: boolean;
  variant?: "default" | "compact";
}

export function JobCard({
  job,
  showCompany = true,
  variant = "default",
}: JobCardProps) {
  const { t, locale } = useI18n();
  // Lot 9d : badge calculé (début strictement futur et à 24 h ou moins).
  const urgent = useJobUrgent(job);

  const categoryName =
    locale === "fr" ? job.category?.name_fr : job.category?.name_en;
  const spotsLeft = job.positions_available - job.positions_filled;

  return (
    <Link href={`/jobs/${job.id}`}>
      <Card
        variant="glass"
        className={cn(
          "group relative overflow-hidden transition-all duration-300",
          "hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-1",
          "active:scale-[0.98]",
          variant === "compact" && "p-3",
        )}
      >
        {urgent && (
          <div
            className="absolute top-0 right-0 rounded-bl-xl bg-warning px-3 py-1 text-xs font-semibold text-warning-foreground"
            data-testid="job-urgent-badge"
            title={t.jobs.urgentLabel}
          >
            <Zap className="mr-1 inline-block h-3 w-3" aria-hidden />
            {t.jobs.urgentBadge}
          </div>
        )}

        <div className={cn("p-4", variant === "compact" && "p-0")}>
          {/* Header: Company & Category */}
          {showCompany && job.company && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 ring-2 ring-primary/20">
                {job.company.logo_url ? (
                  <img
                    src={job.company.logo_url}
                    alt={job.company.company_name}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : (
                  <Briefcase className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {job.company.company_name}
                </p>
                {categoryName && (
                  <p className="text-xs text-muted-foreground truncate">
                    {categoryName}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Title */}
          <h3
            className={cn(
              "font-semibold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors",
              variant === "compact" ? "text-sm" : "text-base",
            )}
          >
            {job.title}
          </h3>

          {/* Location & Time */}
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0 text-primary/60" />
              <span className="truncate">
                {job.quartier ? `${job.quartier}, ` : ""}
                {job.city}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4 shrink-0 text-primary/60" />
              <span>{formatDate(job.start_date, locale)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4 shrink-0 text-primary/60" />
              <span>
                {formatTime(job.start_time, locale)} -{" "}
                {formatTime(job.end_time, locale)}
              </span>
            </div>
          </div>

          {/* Footer: rémunération par candidat pour la mission & places */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/50">
            <MissionPay
              amount={job.mission_pay_per_candidate}
              amountClassName="text-lg text-primary"
              testId="job-card-pay"
            />

            <div className="flex items-center gap-2">
              {spotsLeft <= 3 && spotsLeft > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {spotsLeft} {spotsLeft === 1 ? "place" : "places"}
                </Badge>
              )}
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </div>
        </div>

        {/* Hover gradient effect */}
        <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      </Card>
    </Link>
  );
}
