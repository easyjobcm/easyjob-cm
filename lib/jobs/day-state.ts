/**
 * État d'une journée d'offre pour le candidat (lot 12). Fonctions pures.
 *
 * Aucune règle métier n'est recalculée ici : l'ouverture, la capacité et la
 * compatibilité avec les engagements du candidat viennent de la base (RPC
 * `job_days_for_candidate`, qui appelle `candidate_schedule_conflicts`,
 * comme la candidature et la sélection). L'écran ne fait que lire ces
 * réponses ; la base revérifie tout à la candidature (refus atomique) puis à
 * la sélection, sous verrou.
 */
import type { Database } from "@/lib/database.types";
import type { DayBlockReason } from "@/lib/jobs/schedule";
import { displayApplicationStatus } from "@/lib/jobs/application-status";

type DayRow =
  Database["public"]["Functions"]["job_days_for_candidate"]["Returns"][number];
type ApplicationStatus = Database["public"]["Enums"]["application_status"];

/** Journée lue par `job_days_for_candidate` (colonnes pouvant être nulles). */
export type CandidateJobDay = Omit<
  DayRow,
  | "day_id"
  | "mission_pay_per_candidate"
  | "applications_close_at"
  | "my_application_id"
  | "my_application_status"
  | "schedule_compatible"
  | "schedule_reason"
  | "date_cancelled"
> & {
  /** Null : journée implicite d'une offre antérieure sans calendrier. */
  day_id: string | null;
  mission_pay_per_candidate: number | null;
  applications_close_at: string | null;
  my_application_id: string | null;
  my_application_status: ApplicationStatus | null;
  /**
   * Compatibilité avec les engagements déjà sélectionnés du candidat de la
   * session, calculée en base. Null : la question ne se pose pas (visiteur
   * sans profil candidat, ou journée à laquelle il a déjà postulé).
   */
  schedule_compatible: boolean | null;
  /** Code de motif (`schedule_conflict`), jamais le détail de l'engagement. */
  schedule_reason: string | null;
  /**
   * Lot 17d-4a : date entière annulée par l'entreprise (ANN-08), lue en
   * base. Absente : journée implicite ou lecture antérieure.
   */
  date_cancelled?: boolean | null;
};

export type DayState =
  | "open"
  | "closed"
  | "full"
  /** Date annulée par l'entreprise : ni candidature ni sélection. */
  | "cancelled"
  /** Incompatible avec un engagement déjà sélectionné du candidat. */
  | "conflict"
  /** Présélection retirée (lot 13) : affichée comme « pending ». */
  | Exclude<ApplicationStatus, "shortlisted">;

/** Ouverte : recrutement ouvert à la lecture et échéance non franchie. */
export function dayIsOpen(
  day: Pick<CandidateJobDay, "recruitment_open" | "applications_close_at">,
  now: number,
): boolean {
  if (!day.recruitment_open || !day.applications_close_at) return false;
  return now < Date.parse(day.applications_close_at);
}

/** Incompatibilité déclarée par la base pour une journée sans candidature. */
export function dayHasConflict(
  day: Pick<CandidateJobDay, "schedule_compatible" | "my_application_status">,
): boolean {
  return day.schedule_compatible === false && !day.my_application_status;
}

/**
 * État affiché. Même ordre que les refus de la base
 * (`apply_to_job_core`) : candidature existante, clôture, capacité, conflit.
 */
export function dayState(day: CandidateJobDay, now: number): DayState {
  // Lot 17d-4a : date annulée par l'entreprise. Prime sur une candidature
  // en attente, qui ne peut plus être retenue (une sélection garde son état).
  if (day.date_cancelled) {
    const shown = day.my_application_status
      ? displayApplicationStatus(day.my_application_status)
      : null;
    if (!shown || shown === "pending") return "cancelled";
    return shown;
  }
  if (day.my_application_status) {
    return displayApplicationStatus(day.my_application_status);
  }
  if (!dayIsOpen(day, now)) return "closed";
  if (day.is_full) return "full";
  if (dayHasConflict(day)) return "conflict";
  return "open";
}

/** Journée cochable (journées au choix). */
export function dayChoosable(day: CandidateJobDay, now: number): boolean {
  return !!day.day_id && dayState(day, now) === "open";
}

/**
 * Journées d'une période complète incompatibles avec un engagement : une
 * seule suffit à empêcher la candidature à l'ensemble.
 */
export function conflictingDays<
  T extends Pick<
    CandidateJobDay,
    "schedule_compatible" | "my_application_status"
  >,
>(days: readonly T[]): T[] {
  return days.filter(dayHasConflict);
}

export type DroppedDay = {
  id: string;
  /** Vide si la journée a disparu de l'offre. */
  date: string;
  reason: DayBlockReason | null;
};

const DROP_REASON: Partial<Record<DayState, DayBlockReason>> = {
  cancelled: "date_cancelled",
  conflict: "schedule_conflict",
  closed: "recruitment_closed",
  full: "no_positions",
};

/**
 * Journées cochées qui ne peuvent plus être envoyées (devenues
 * incompatibles, closes, complètes ou déjà demandées) : à décocher et à
 * expliquer avant toute confirmation.
 */
export function droppedSelection(
  selected: readonly string[],
  days: readonly CandidateJobDay[],
  now: number,
): DroppedDay[] {
  return selected.flatMap((id): DroppedDay[] => {
    const day = days.find((d) => d.day_id === id);
    if (!day) return [{ id, date: "", reason: null }];
    const state = dayState(day, now);
    if (state === "open") return [];
    return [
      {
        id,
        date: day.day_date,
        reason: DROP_REASON[state] ?? "already_applied",
      },
    ];
  });
}
