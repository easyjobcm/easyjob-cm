import { z } from "zod";

/**
 * Code de fin saisi par le candidat (RPC `submit_completion_code`, lot 7c).
 * Six chiffres, zéros initiaux compris. La vérification et le comptage des
 * tentatives se font en base ; le code n'est jamais journalisé.
 */
export const completionCodeSchema = z.object({
  code: z
    .string({ message: "code_format" })
    .trim()
    .regex(/^[0-9]{6}$/, "code_format"),
});

/** Évaluation après réalisation (RPC `submit_mission_review`). */
export const missionReviewSchema = z.object({
  rating: z
    .number({ message: "rating_invalid" })
    .int("rating_invalid")
    .min(1, "rating_invalid")
    .max(5, "rating_invalid"),
  comment: z
    .string()
    .trim()
    .max(1000, "comment_too_long")
    .optional()
    .nullable(),
});

/** Statut HTTP de chaque refus levé par les RPC de mission. */
export const MISSION_RPC_REFUSALS = {
  not_authenticated: 401,
  account_suspended: 403,
  mission_not_found: 404,
  job_not_found: 404,
  mission_not_active: 409,
  too_early: 409,
  not_started: 409,
  code_unavailable: 409,
  mission_not_completed: 409,
  rating_invalid: 400,
  comment_too_long: 400,
} as const;

export type MissionRpcRefusal = keyof typeof MISSION_RPC_REFUSALS;

export function missionRefusal(
  message: string | undefined,
): { code: MissionRpcRefusal; status: number } | null {
  if (message && message in MISSION_RPC_REFUSALS) {
    const code = message as MissionRpcRefusal;
    return { code, status: MISSION_RPC_REFUSALS[code] };
  }
  return null;
}
