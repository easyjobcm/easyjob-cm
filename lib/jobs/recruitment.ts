/**
 * Échéance de recrutement (lot 11b). La base tranche : `apply_to_job` et
 * `select_candidate` refusent `recruitment_closed` dès que l'heure de la
 * base atteint `jobs.applications_close_at` (H−24, ou H−2 pour une offre
 * publiée en urgence ; régime figé à la première publication). L'écran ne
 * fait que refléter cette échéance, avec l'heure du serveur.
 *
 * Indépendant du badge « Urgente » (`lib/jobs/urgency.ts`), qui ne prolonge
 * jamais l'échéance.
 */

export interface RecruitmentJob {
  applications_close_at?: string | null;
  /** Absent : offre lue dans une liste déjà filtrée sur les offres publiées. */
  status?: string | null;
}

/** Échéance (ms), ou null si l'offre n'en a pas (offre close). */
export function recruitmentCloseInstant(job: RecruitmentJob): number | null {
  if (!job.applications_close_at) return null;
  const t = Date.parse(job.applications_close_at);
  return Number.isNaN(t) ? null : t;
}

/** Ouvert strictement avant l'échéance ; à l'instant exact, clos. */
export function isRecruitmentOpen(job: RecruitmentJob, now: number): boolean {
  if (job.status != null && job.status !== "active") return false;
  const close = recruitmentCloseInstant(job);
  return close !== null && now < close;
}

/** Prochain instant où l'état change (l'échéance), ou null. */
export function nextRecruitmentChange(
  jobs: readonly RecruitmentJob[],
  now: number,
): number | null {
  let next: number | null = null;
  for (const job of jobs) {
    const close = recruitmentCloseInstant(job);
    if (close !== null && close > now && (next === null || close < next)) {
      next = close;
    }
  }
  return next;
}
