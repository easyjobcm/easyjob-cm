import type { Enums } from "@/lib/database.types";

/**
 * Statuts d'offre en usage. `pending_moderation` et `published` restent dans
 * l'enum mais sont interdits par la contrainte `jobs_status_canonical_chk`
 * (migration 20261101140000).
 */
export type JobStatus = Exclude<
  Enums<"job_status">,
  "pending_moderation" | "published"
>;

/** En attente de modération. */
export const JOB_PENDING_STATUS = "pending_review" satisfies JobStatus;
/** Publiée : seul statut lisible et postulable par les candidats. */
export const JOB_PUBLISHED_STATUS = "active" satisfies JobStatus;

/** Statuts modifiables par l'entreprise (`update_job`), hors plan. */
export const JOB_EDITABLE_STATUSES: readonly JobStatus[] = [
  "draft",
  "pending_review",
  "rejected",
];

/**
 * L'entreprise peut-elle ouvrir la modification ? Une offre active ne se
 * modifie qu'avec la modification directe du plan (Pro, Business) et sans
 * candidat sélectionné ; elle repasse alors en modération.
 */
export function canEditJob(
  job: { status: string | null; positions_filled: number | null },
  directEdit: boolean,
): boolean {
  if (job.status === JOB_PUBLISHED_STATUS) {
    return directEdit && (job.positions_filled ?? 0) === 0;
  }
  return JOB_EDITABLE_STATUSES.includes(job.status as JobStatus);
}
