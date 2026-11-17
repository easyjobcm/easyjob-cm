/** Fuseau d'affichage de toutes les heures de mission (F-30). */
export const MISSION_TIME_ZONE = "Africa/Douala";

const tag = (locale: string) => (locale === "en" ? "en-US" : "fr-FR");

/** Heure (HH:MM) d'un instant, en heure de Douala. */
export function doualaTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MISSION_TIME_ZONE,
  }).format(new Date(iso));
}

/** Jour et heure d'un instant, en heure de Douala. */
export function doualaDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MISSION_TIME_ZONE,
  }).format(new Date(iso));
}

/** Décalage fixe de Douala (UTC+1, sans heure d'été). */
const DOUALA_OFFSET_MS = 3_600_000;

/**
 * Valeur d'un champ `datetime-local` (AAAA-MM-JJTHH:MM) en heure de Douala,
 * pour un instant en millisecondes.
 */
export function doualaLocalInput(ms: number): string {
  return new Date(ms + DOUALA_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Instant ISO (décalage +01:00) d'une saisie `datetime-local` faite en
 * heure de Douala ; null si la saisie n'a pas la forme attendue.
 */
export function doualaLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00+01:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
