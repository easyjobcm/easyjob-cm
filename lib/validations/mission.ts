import { z } from "zod";
import {
  isReviewReason,
  reasonsAllowed,
  reasonsRequired,
} from "@/lib/reputation/review-reasons";

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
  // Lot 12 : journée confirmée (obligatoire pour une mission de plusieurs
  // journées ; la base refuse mission_day_required sinon).
  mission_day_id: z.string().uuid().optional(),
});

/** Début d'une journée de mission (lot 12) ; corps facultatif. */
export const missionStartSchema = z.object({
  mission_day_id: z.string().uuid().optional(),
});

/**
 * Évaluation après réalisation (RPC `submit_mission_review`). Motifs :
 * codes de `lib/reputation/review-reasons.ts`, au moins un pour une note
 * < 3, aucun pour 4 ou 5. La base revérifie qu'ils correspondent à la
 * partie évaluée (`reasons_invalid`).
 */
export const missionReviewSchema = z
  .object({
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
    reasons: z
      .array(z.string().refine(isReviewReason, "reasons_invalid"), {
        message: "reasons_invalid",
      })
      .max(6, "reasons_invalid")
      .optional()
      .default([]),
  })
  .superRefine((value, ctx) => {
    const unique = new Set(value.reasons);
    if (unique.size !== value.reasons.length) {
      ctx.addIssue({
        code: "custom",
        message: "reasons_invalid",
        path: ["reasons"],
      });
    }
    if (value.reasons.length > 0 && !reasonsAllowed(value.rating)) {
      ctx.addIssue({
        code: "custom",
        message: "reasons_invalid",
        path: ["reasons"],
      });
    }
    if (reasonsRequired(value.rating) && value.reasons.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "reasons_required",
        path: ["reasons"],
      });
    }
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
  // Lot 15 : code reçu à partir de la fin prévue de la journée.
  completion_not_open: 409,
  code_unavailable: 409,
  mission_day_required: 400,
  mission_not_completed: 409,
  rating_invalid: 400,
  comment_too_long: 400,
  reasons_required: 400,
  reasons_invalid: 400,
  // Lot 17b : journée annulée par le candidat (début, code, confirmation).
  day_cancelled: 409,
  // Lot 17d-3 : constat d'absence injustifiée en vigueur sur la journée.
  absence_finding_established: 409,
  // Interruption : code refusé pendant l'instruction ou tant qu'un
  // règlement n'est pas accepté par les deux parties.
  interruption_pending: 409,
  settlement_not_accepted: 409,
  interruption_unresolved: 409,
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
