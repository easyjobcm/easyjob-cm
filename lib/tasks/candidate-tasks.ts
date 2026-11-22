import { z } from "zod";
import { CNI_STATES } from "@/lib/utils/cni-validity";
import {
  parseDayInterruption,
  type DayInterruption,
} from "@/lib/validations/partial-day";

/**
 * Tâches du candidat (lot 9d) : actions qui débloquent une candidature
 * (RPC `candidate_action_tasks`), tâches de mission (RPC `candidate_tasks`,
 * lot 7c) et demandes de mise à jour du profil. Fonctions pures, testées
 * unitairement ; le point rouge de l'onglet Tâches et la page en dérivent.
 */

const DOC_STATES = ["missing", "pending", "rejected", "expired"] as const;

const base = { key: z.string().min(1), action_required: z.boolean() };

export const actionTaskSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("profile"),
    state: z.enum(["onboarding", "incomplete"]),
    pct: z.number().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("identity"),
    state: z.literal("missing"),
  }),
  z.object({ ...base, kind: z.literal("phone"), state: z.literal("missing") }),
  z.object({
    ...base,
    kind: z.literal("momo"),
    state: z.enum(["missing", "pending", "rejected"]),
    reason: z.string().nullable().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("cni"),
    state: z.enum(CNI_STATES).exclude(["valid"]),
    expires_at: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    complement_requested: z.boolean().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("document"),
    state: z.enum(DOC_STATES),
    document_type: z.string(),
    skill_name: z.string().nullable().optional(),
    jobs: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
  }),
]);

export type ActionTask = z.infer<typeof actionTaskSchema>;

/** Tâches valides seulement : une entrée inattendue est ignorée. */
export function parseActionTasks(raw: unknown): ActionTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = actionTaskSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Clé d'une tâche justificatif, identique à celle de la base. */
export function documentTaskKey(
  documentType: string,
  skillName?: string | null,
) {
  return `document:${documentType}:${skillName ?? ""}`;
}

/** Lien vers une tâche précise de l'onglet Tâches. */
export function taskHref(key: string): string {
  return `/tasks?task=${encodeURIComponent(key)}`;
}

/** Champs de `candidate_tasks` utiles au décompte. */
export interface MissionTaskState {
  status: string | null;
  contract_id: string | null;
  candidate_signed: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  candidate_reviewed: boolean | null;
  start_available_at: string;
  scheduled_end_at: string;
  /** Lot 12 : journées de la mission (`candidate_tasks.days`). */
  days?: unknown;
}

/** Journée d'une mission, sans code (lot 12). */
export interface MissionDayState {
  id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  start_available_at: string;
  /**
   * Lot 15 : saisie du code et « code non remis » à partir de la fin
   * prévue (`mission_days.ends_at`, calculée par la base).
   */
  completion_available_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Lot 15 : provenance de la confirmation (code saisi ou support). */
  /** Lot 16 : « exceptional » = décision du support après double validation. */
  /**
   * « partial » : accord des deux parties sur le montant du fondateur, puis
   * code ; « partial_support » : accord finalisé par le fondateur (code non
   * remis). Jamais une réalisation complète.
   */
  completed_via:
    | "code"
    | "support"
    | "exceptional"
    | "partial"
    | "partial_support"
    | null;
  /** Lot 17b : journée annulée (plus de début ni de code). */
  cancelled_at: string | null;
  /** Lot 17d-2 : auteur de l'annulation (candidat ou entreprise). */
  cancelled_by: "candidate" | "company" | null;
  /** Interruption signalée : étape, blocage, accord valide éventuel. */
  interruption: DayInterruption | null;
}

/** Journées lues dans le JSON de la base, triées par début. */
export function missionDays(raw: unknown): MissionDayState[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return raw
    .flatMap((d): MissionDayState[] => {
      if (!d || typeof d !== "object") return [];
      const r = d as Record<string, unknown>;
      const id = str(r.id);
      const date = str(r.date);
      const startsAt = str(r.starts_at);
      const endsAt = str(r.ends_at);
      const available = str(r.start_available_at);
      if (!id || !date || !startsAt || !endsAt || !available) return [];
      return [
        {
          id,
          date,
          starts_at: startsAt,
          ends_at: endsAt,
          start_available_at: available,
          completion_available_at: str(r.completion_available_at) ?? endsAt,
          started_at: str(r.started_at),
          completed_at: str(r.completed_at),
          completed_via:
            r.completed_via === "code" ||
            r.completed_via === "support" ||
            r.completed_via === "exceptional" ||
            r.completed_via === "partial" ||
            r.completed_via === "partial_support"
              ? r.completed_via
              : null,
          cancelled_at: str(r.cancelled_at),
          cancelled_by:
            r.cancelled_by === "candidate" || r.cancelled_by === "company"
              ? r.cancelled_by
              : null,
          interruption: parseDayInterruption(r.interruption),
        },
      ];
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

const ACTIVE = new Set(["pending", "confirmed"]);
// Une journée suivante se commence aussi quand la mission est en cours.
const DAY_ACTIVE = new Set(["pending", "confirmed", "in_progress"]);

/** Début d'une journée disponible (H−15, mission non annulée). */
export function canStartDay(
  m: Pick<MissionTaskState, "status">,
  d: MissionDayState,
  now: number,
): boolean {
  return (
    !d.started_at &&
    !d.cancelled_at &&
    DAY_ACTIVE.has(m.status ?? "") &&
    now >= Date.parse(d.start_available_at)
  );
}

/**
 * Fin prévue d'une journée commencée et non confirmée atteinte : saisie du
 * code et « code non remis » ouverts (lot 15 ; la base refuse avant).
 * Une interruption non close (ou un désaccord non résolu) ferme la saisie
 * normale (la base refuse aussi).
 */
export function dayEndReached(d: MissionDayState, now: number): boolean {
  const pending = d.interruption?.blocks_completion === true;
  return (
    !!d.started_at &&
    !d.completed_at &&
    !d.cancelled_at &&
    !pending &&
    now >= Date.parse(d.completion_available_at)
  );
}

/**
 * Accord des deux parties sur la version courante : code reçu tout de
 * suite, même avant la fin prévue ; l'échéance de réponse ne l'annule pas
 * (la base revérifie).
 */
export function partialCodeOpen(d: MissionDayState): boolean {
  return !!d.started_at && !d.completed_at && !!d.interruption?.agreement;
}

/**
 * Instants où l'état des tâches d'une mission change (début disponible,
 * fin prévue) : la minuterie calée sur le serveur s'y déclenche.
 */
export function missionTaskInstants(m: MissionTaskState): number[] {
  const days = missionDays(m.days);
  if (days.length === 0) {
    return [
      Date.parse(m.start_available_at),
      Date.parse(m.scheduled_end_at),
    ].filter((t) => !Number.isNaN(t));
  }
  return days.flatMap((d) =>
    d.completed_at || d.cancelled_at
      ? []
      : [
          Date.parse(d.start_available_at),
          Date.parse(d.completion_available_at),
        ],
  );
}

export function canStartMission(m: MissionTaskState, now: number): boolean {
  const days = missionDays(m.days);
  if (days.length > 0) return days.some((d) => canStartDay(m, d, now));
  return (
    !m.started_at &&
    ACTIVE.has(m.status ?? "") &&
    now >= new Date(m.start_available_at).getTime()
  );
}

export function missionEndReached(m: MissionTaskState, now: number): boolean {
  const days = missionDays(m.days);
  if (days.length > 0) return days.some((d) => dayEndReached(d, now));
  return (
    !!m.started_at &&
    !m.completed_at &&
    now >= new Date(m.scheduled_end_at).getTime()
  );
}

/**
 * Actions de mission qui attendent le candidat : signature, début
 * disponible, code de fin à l'heure de fin, notation. Un début à venir ou
 * une mission en cours avant l'heure de fin ne comptent pas.
 */
export function missionActionCount(m: MissionTaskState, now: number): number {
  let n = 0;
  if (m.contract_id && !m.candidate_signed) n += 1;
  const days = missionDays(m.days);
  if (days.length > 0) {
    // Lot 12 : une action par journée à commencer ou à confirmer.
    for (const d of days) {
      if (canStartDay(m, d, now)) n += 1;
      if (dayEndReached(d, now)) n += 1;
    }
  } else {
    if (canStartMission(m, now)) n += 1;
    if (missionEndReached(m, now)) n += 1;
  }
  if (m.completed_at && !m.candidate_reviewed) n += 1;
  return n;
}

export interface CandidateTaskData {
  missions: MissionTaskState[];
  actions: ActionTask[];
  updateRequests: unknown[];
}

/** Nombre d'actions qui attendent le candidat (point rouge des Tâches). */
export function pendingActionCount(
  data: CandidateTaskData | undefined,
  now: number,
): number {
  if (!data) return 0;
  return (
    data.updateRequests.length +
    data.actions.filter((a) => a.action_required).length +
    data.missions.reduce((n, m) => n + missionActionCount(m, now), 0)
  );
}

/** Tâche visée par une clé d'URL (`?task=`), ou null. */
export function findActionTask(
  actions: ActionTask[],
  key: string | null,
): ActionTask | null {
  if (!key) return null;
  return actions.find((a) => a.key === key) ?? null;
}
