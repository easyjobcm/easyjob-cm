"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name_fr: string;
  name_en: string;
  icon?: string;
}

interface JobFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  categoryId: string;
  onCategoryChange: (value: string) => void;
  categories: Category[];
}

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
];

export function JobFilters({
  search,
  onSearchChange,
  city,
  onCityChange,
  categoryId,
  onCategoryChange,
  categories,
}: JobFiltersProps) {
  const { t, locale } = useI18n();
  const [showFilters, setShowFilters] = React.useState(false);

  const activeFiltersCount = [city, categoryId].filter(Boolean).length;

  const clearFilters = () => {
    onCityChange("");
    onCategoryChange("");
  };

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t.jobs?.search || "Rechercher un job..."}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 h-12 rounded-xl bg-card/50 backdrop-blur-sm border-border/50"
          />
        </div>
        <Button
          variant="outline"
          size="lg"
          onClick={() => setShowFilters(true)}
          className={cn(
            "h-12 px-4 rounded-xl relative",
            activeFiltersCount > 0 && "border-primary",
          )}
        >
          <SlidersHorizontal className="w-5 h-5" />
          {activeFiltersCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
              {activeFiltersCount}
            </span>
          )}
        </Button>
      </div>

      {/* Active filters display */}
      {(city || categoryId) && (
        <div className="flex flex-wrap gap-2">
          {city && (
            <Badge variant="secondary" className="gap-1 pr-1">
              <MapPin className="w-3 h-3" />
              {city}
              <button
                onClick={() => onCityChange("")}
                className="ml-1 p-0.5 hover:bg-foreground/10 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {categoryId && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {locale === "fr"
                ? categories.find((c) => c.id === categoryId)?.name_fr
                : categories.find((c) => c.id === categoryId)?.name_en}
              <button
                onClick={() => onCategoryChange("")}
                className="ml-1 p-0.5 hover:bg-foreground/10 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {locale === "fr" ? "Tout effacer" : "Clear all"}
          </button>
        </div>
      )}

      {/* Filters Modal */}
      <Modal
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        title={t.jobs?.filters || "Filtres"}
      >
        <div className="space-y-6 pb-4">
          {/* City filter */}
          <div>
            <label className="text-sm font-medium text-foreground mb-3 block">
              {t.jobs?.location || "Ville"}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CAMEROON_CITIES.map((c) => (
                <button
                  key={c}
                  onClick={() => onCityChange(city === c ? "" : c)}
                  className={cn(
                    "px-3 py-2 text-sm rounded-lg border transition-colors",
                    city === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:border-primary/50",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div>
            <label className="text-sm font-medium text-foreground mb-3 block">
              {locale === "fr" ? "Categorie" : "Category"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() =>
                    onCategoryChange(categoryId === cat.id ? "" : cat.id)
                  }
                  className={cn(
                    "px-3 py-2 text-sm rounded-lg border transition-colors text-left",
                    categoryId === cat.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:border-primary/50",
                  )}
                >
                  {locale === "fr" ? cat.name_fr : cat.name_en}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button variant="outline" className="flex-1" onClick={clearFilters}>
              {locale === "fr" ? "Reinitialiser" : "Reset"}
            </Button>
            <Button className="flex-1" onClick={() => setShowFilters(false)}>
              {locale === "fr" ? "Appliquer" : "Apply"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
