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
