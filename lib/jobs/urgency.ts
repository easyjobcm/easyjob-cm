/**
 * Badge « Urgente » calculé (lot 9d) : une offre ouverte dont le début est
 * strictement futur et à 24 h ou moins. L'option manuelle du formulaire
 * entreprise est retirée ; la colonne `jobs.urgency` n'est plus lue côté
 * candidat. Les frais de publication urgente relèvent du lot commercial.
 *
 * Les dates et heures d'une offre sont saisies en heure de Douala
 * (Africa/Douala, UTC+1 toute l'année, sans heure d'été).
 */

export const URGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const DOUALA_OFFSET = "+01:00";

export interface UrgencyJob {
  start_date: string;
  start_time: string;
  /** Absent : offre lue dans une liste déjà filtrée sur les offres publiées. */
  status?: string | null;
  positions_available?: number | null;
  positions_filled?: number | null;
}

/** Début de l'offre (ms), ou null si la date ou l'heure est illisible. */
export function jobStartInstant(
  job: Pick<UrgencyJob, "start_date" | "start_time">,
): number | null {
  const date = job.start_date?.slice(0, 10);
  const time = job.start_time?.slice(0, 5);
  if (!date || !/^\d{2}:\d{2}$/.test(time ?? "")) return null;
  const t = Date.parse(`${date}T${time}:00${DOUALA_OFFSET}`);
  return Number.isNaN(t) ? null : t;
}

/** Offre ouverte : publiée et avec au moins une place libre. */
export function isJobOpen(job: UrgencyJob): boolean {
  if (job.status != null && job.status !== "active") return false;
  if (job.positions_available != null) {
    return (job.positions_filled ?? 0) < job.positions_available;
  }
  return true;
}

export function isJobUrgent(job: UrgencyJob, now: number): boolean {
  const start = jobStartInstant(job);
  if (start === null || !isJobOpen(job)) return false;
  return start > now && start - now <= URGENT_WINDOW_MS;
}

/**
 * Prochain instant (ms) où le badge change (entrée dans la fenêtre des
 * 24 h, puis début de l'offre), ou null s'il ne changera plus.
 */
export function nextUrgencyChange(job: UrgencyJob, now: number): number | null {
  const start = jobStartInstant(job);
  if (start === null || !isJobOpen(job) || start <= now) return null;
  const enter = start - URGENT_WINDOW_MS;
  // La fenêtre inclut sa borne (≤ 24 h) : le badge apparaît à `enter`.
  return now < enter ? enter : start;
}
