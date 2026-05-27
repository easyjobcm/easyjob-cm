"use client";

import * as React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { JobCard } from "@/components/jobs/job-card";
import { JobFilters } from "@/components/jobs/job-filters";
import { LoadingSkeleton } from "@/components/ui/loading";
import { useJobs, useCategories } from "@/lib/hooks/use-data";
import { useI18n } from "@/lib/i18n";
import { Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type JobListItem = {
  id: string;
  title: string;
  description: string;
  city: string;
  quartier?: string;
  start_date: string;
  start_time: string;
  end_time: string;
  hourly_rate: number;
  currency: string;
  urgency: "normal" | "urgent" | "critical";
  positions_available: number;
  positions_filled: number;
  is_sandbox?: boolean;
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

type CategoryListItem = {
  id: string;
  name_fr?: string;
  name_en?: string;
};

export default function JobsPage() {
  const { t, locale } = useI18n();
  const [search, setSearch] = React.useState("");
  const [city, setCity] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { categories } = useCategories();
  const { jobs, pagination, isLoading, isError, mutate } = useJobs({
    search: debouncedSearch,
    city,
    category: categoryId,
    limit: 20,
  });

  return (
    <AppShell>
      {/* Header with search */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            {t.jobs?.title || "Offres d'emploi"}
          </h1>

          <JobFilters
            search={search}
            onSearchChange={setSearch}
            city={city}
            onCityChange={setCity}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            categories={categories}
          />
        </div>

        {/* Quick category pills */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          <button
            onClick={() => setCategoryId("")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              !categoryId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {locale === "fr" ? "Tous" : "All"}
          </button>
          {(categories as CategoryListItem[]).slice(0, 5).map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryId(categoryId === cat.id ? "" : cat.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                categoryId === cat.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {locale === "fr" ? cat.name_fr : cat.name_en}
            </button>
          ))}
        </div>
      </div>

      {/* Job listings */}
      <div className="px-4 py-4 space-y-3">
        {/* Loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <LoadingSkeleton key={i} className="h-[180px] rounded-2xl" />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <RefreshCw className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {locale === "fr" ? "Erreur de chargement" : "Loading error"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mb-4">
              {locale === "fr"
                ? "Impossible de charger les offres"
                : "Unable to load job listings"}
            </p>
            <Button onClick={() => mutate()} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              {locale === "fr" ? "Reessayer" : "Retry"}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {locale === "fr" ? "Aucune offre trouvee" : "No jobs found"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {locale === "fr"
                ? "Essayez de modifier vos criteres de recherche"
                : "Try adjusting your search criteria"}
            </p>
          </div>
        )}

        {/* Job list */}
        {!isLoading && !isError && jobs.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground mb-2">
              {pagination?.total || 0}{" "}
              {locale === "fr" ? "offres trouvees" : "jobs found"}
            </p>
            {jobs.map((job: JobListItem) => (
              <JobCard key={job.id} job={job} />
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
