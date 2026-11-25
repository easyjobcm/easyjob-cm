/**
 * Calendrier d'une offre (lot 12) : journées choisies explicitement, jamais
 * déduites d'un intervalle. Mêmes règles que `public.job_days_parse` (la
 * base revérifie tout) : 1 à 31 journées, dates sans doublon, début ≠ fin,
 * fin ≤ début → lendemain (journée qui traverse minuit), aucun
 * chevauchement interne. Heures lues en Africa/Douala (UTC+1, sans heure
 * d'été).
 */
import { MISSION_TIME_ZONE } from "@/lib/utils/douala-time";

export const JOB_DAYS_MAX = 31;
export const SCHEDULE_FORMATS = ["full_period", "per_day"] as const;
export type ScheduleFormat = (typeof SCHEDULE_FORMATS)[number];

/** Décalage fixe de Douala (aucune heure d'été). */
const DOUALA_OFFSET = "+01:00";
const DAY_MS = 86_400_000;

export interface ScheduleDay {
  date: string;
  start_time: string;
  end_time: string;
}

/** Début et fin (ms) d'une journée ; fin ≤ début : fin le lendemain. */
export function dayBounds(day: ScheduleDay): { start: number; end: number } {
  const start = Date.parse(
    `${day.date}T${day.start_time.slice(0, 5)}:00${DOUALA_OFFSET}`,
  );
  let end = Date.parse(
    `${day.date}T${day.end_time.slice(0, 5)}:00${DOUALA_OFFSET}`,
  );
  if (end <= start) end += DAY_MS;
  return { start, end };
}

/** Journée qui se termine le lendemain de sa date. */
export function crossesMidnight(
  day: Pick<ScheduleDay, "start_time" | "end_time">,
) {
  return day.end_time.slice(0, 5) <= day.start_time.slice(0, 5);
}

/**
 * Vrai si les journées n'ont pas toutes les mêmes horaires (heures et
 * minutes). Les horaires de l'offre (`jobs.start_time`/`end_time`) sont
 * ceux de la première journée : un résumé ne doit alors pas les présenter
 * comme ceux de toute l'offre.
 */
export function hoursVary(
  days: readonly Pick<ScheduleDay, "start_time" | "end_time">[],
): boolean {
  const first = days[0];
  if (!first) return false;
  return days.some(
    (d) =>
      d.start_time.slice(0, 5) !== first.start_time.slice(0, 5) ||
      d.end_time.slice(0, 5) !== first.end_time.slice(0, 5),
  );
}

/** Journées triées par début. */
export function sortDays<T extends ScheduleDay>(days: readonly T[]): T[] {
  return [...days].sort((a, b) => dayBounds(a).start - dayBounds(b).start);
}

export type ScheduleIssue =
  | "daysRequired"
  | "daysTooMany"
  | "daysDuplicate"
  | "daysTime"
  | "daysOverlap"
  | "daysInvalid";

/** Premier défaut du calendrier, ou null (clés de `companyJobs.errors`). */
export function scheduleIssue(
  days: readonly ScheduleDay[],
): ScheduleIssue | null {
  if (days.length === 0) return "daysRequired";
  if (days.length > JOB_DAYS_MAX) return "daysTooMany";
  const dates = new Set<string>();
  for (const d of days) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      !/^\d{2}:\d{2}/.test(d.start_time) ||
      !/^\d{2}:\d{2}/.test(d.end_time)
    ) {
      return "daysInvalid";
    }
    if (d.start_time.slice(0, 5) === d.end_time.slice(0, 5)) return "daysTime";
    if (dates.has(d.date)) return "daysDuplicate";
    dates.add(d.date);
  }
  const sorted = sortDays(days);
  for (let i = 1; i < sorted.length; i++) {
    if (dayBounds(sorted[i - 1]).end > dayBounds(sorted[i]).start) {
      return "daysOverlap";
    }
  }
  return null;
}

const tag = (locale: string) => (locale === "en" ? "en-US" : "fr-FR");

/** « Lun. 16 nov. » (date civile, sans conversion de fuseau). */
export function formatDayDate(date: string, locale: string): string {
  const text = new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  // Majuscule initiale seulement (jamais une majuscule par mot).
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « 22:00 → 06:00 (+1 j) » : horaires en heure de Douala. */
export function formatDayHours(
  day: Pick<ScheduleDay, "start_time" | "end_time">,
  nextDayLabel: string,
): string {
  const range = `${day.start_time.slice(0, 5)} → ${day.end_time.slice(0, 5)}`;
  return crossesMidnight(day) ? `${range} (${nextDayLabel})` : range;
}

/** Heure de Douala d'un instant, pour un libellé « jusqu'au … ». */
export function formatInstant(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MISSION_TIME_ZONE,
  }).format(new Date(iso));
}

/** Liste de dates (YYYY-MM-DD) d'un détail d'erreur `{ days: [...] }`. */
export function parseDaysDetail(details: string | null | undefined): string[] {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (
      parsed &&
      typeof parsed === "object" &&
      "days" in parsed &&
      Array.isArray((parsed as { days: unknown }).days)
    ) {
      return (parsed as { days: unknown[] }).days.filter(
        (d): d is string =>
          typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
      );
    }
  } catch {
    // Détail illisible : aucune journée nommée.
  }
  return [];
}

export const DAY_BLOCK_REASONS = [
  "date_cancelled",
  "recruitment_closed",
  "already_applied",
  "no_positions",
  "schedule_conflict",
] as const;
export type DayBlockReason = (typeof DAY_BLOCK_REASONS)[number];
export type BlockedDay = { id: string; date: string; reason: DayBlockReason };

/** Journées bloquantes d'un refus `job_days_unavailable`. */
export function parseBlockedDays(
  details: string | null | undefined,
): BlockedDay[] {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    const days =
      parsed && typeof parsed === "object" && "days" in parsed
        ? (parsed as { days: unknown }).days
        : null;
    if (!Array.isArray(days)) return [];
    return days.flatMap((d) => {
      if (!d || typeof d !== "object") return [];
      const { id, date, reason } = d as Record<string, unknown>;
      return typeof id === "string" &&
        typeof date === "string" &&
        typeof reason === "string" &&
        (DAY_BLOCK_REASONS as readonly string[]).includes(reason)
        ? [{ id, date, reason: reason as DayBlockReason }]
        : [];
    });
  } catch {
    return [];
  }
}
