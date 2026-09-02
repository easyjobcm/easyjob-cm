"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { availabilitySchema } from "@/lib/validations/profile";

interface DayEntry {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface AvailabilityClientProps {
  maxTravelDistanceKm: number;
  initialDays: DayEntry[];
}

// Ordre d'affichage lundi→dimanche ; value = day_of_week Postgres (0=dimanche).
type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

const DAY_ORDER: { value: number; key: DayKey }[] = [
  { value: 1, key: "monday" },
  { value: 2, key: "tuesday" },
  { value: 3, key: "wednesday" },
  { value: 4, key: "thursday" },
  { value: 5, key: "friday" },
  { value: 6, key: "saturday" },
  { value: 0, key: "sunday" },
];

const DEFAULT_START = "08:00";
const DEFAULT_END = "18:00";

export function AvailabilityClient({
  maxTravelDistanceKm,
  initialDays,
}: AvailabilityClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const tp = t.profile.availabilityPage;

  const [selectedDays, setSelectedDays] = React.useState<
    Record<number, { start_time: string; end_time: string }>
  >(() => {
    const map: Record<number, { start_time: string; end_time: string }> = {};
    for (const d of initialDays) {
      map[d.day_of_week] = { start_time: d.start_time, end_time: d.end_time };
    }
    return map;
  });
  const [maxDistance, setMaxDistance] = React.useState(maxTravelDistanceKm);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");

  const toggleDay = (day: number) => {
    setSaved(false);
    setSelectedDays((prev) => {
      const next = { ...prev };
      if (next[day]) {
        delete next[day];
      } else {
        next[day] = { start_time: DEFAULT_START, end_time: DEFAULT_END };
      }
      return next;
    });
  };

  const updateDayTime = (
    day: number,
    field: "start_time" | "end_time",
    value: string,
  ) => {
    setSaved(false);
    setSelectedDays((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (saving) return;
    setError("");

    const days = Object.entries(selectedDays).map(([day, times]) => ({
      day_of_week: Number(day),
      start_time: times.start_time,
      end_time: times.end_time,
    }));

    const result = availabilitySchema.safeParse({
      days,
      max_travel_distance_km: maxDistance,
    });
    if (!result.success) {
      setError(tp.invalidRange);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
    } catch {
      setError(tp.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 pb-4 pt-safe-top dark:border-white/10 dark:bg-[#1A0F2E]">
          <button
            type="button"
            onClick={() => router.push("/profile/candidate")}
            aria-label={t.common.back}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {tp.title}
            </h1>
            <p className="text-xs text-muted-foreground">{tp.subtitle}</p>
          </div>
        </div>

        <div className="space-y-3 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-6">
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {DAY_ORDER.map(({ value, key }) => {
                const entry = selectedDays[value];
                const isOn = !!entry;
                return (
                  <div key={value} className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">
                        {tp.days[key]}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={tp.days[key]}
                        onClick={() => toggleDay(value)}
                        className="flex h-11 w-16 items-center justify-center"
                      >
                        <span
                          aria-hidden
                          className={`block h-7 w-12 rounded-full transition-colors ${
                            isOn ? "bg-primary" : "bg-muted"
                          }`}
                        >
                          <span
                            className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              isOn ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </span>
                      </button>
                    </div>
                    {isOn && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{tp.from}</span>
                        <input
                          type="time"
                          value={entry.start_time}
                          onChange={(e) =>
                            updateDayTime(value, "start_time", e.target.value)
                          }
                          className="h-10 rounded-lg border border-input bg-card px-2 text-base text-foreground"
                        />
                        <span className="text-muted-foreground">{tp.to}</span>
                        <input
                          type="time"
                          value={entry.end_time}
                          onChange={(e) =>
                            updateDayTime(value, "end_time", e.target.value)
                          }
                          className="h-10 rounded-lg border border-input bg-card px-2 text-base text-foreground"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {Object.keys(selectedDays).length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              {tp.noDaySelected}
            </p>
          )}

          <Card>
            <CardContent className="p-4">
              <label className="mb-2 block text-sm font-medium text-foreground">
                {tp.maxDistance}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={maxDistance}
                  onChange={(e) => {
                    setSaved(false);
                    setMaxDistance(Number(e.target.value));
                  }}
                  className="flex-1"
                />
                <span className="w-16 shrink-0 text-right text-sm font-semibold text-foreground">
                  {maxDistance} {tp.maxDistanceUnit}
                </span>
              </div>
            </CardContent>
          </Card>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 p-4 backdrop-blur-xl">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full"
            size="lg"
          >
            {saving ? (
              <LoadingSpinner size="sm" />
            ) : saved ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {tp.saved}
              </>
            ) : (
              tp.save
            )}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
