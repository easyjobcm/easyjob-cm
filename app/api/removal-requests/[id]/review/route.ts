import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { removalReviewSchema } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 (décision du 2026-11-24) — réexamen motivé d'un refus de
 * retrait ciblé par l'entreprise : nouvelle demande liée, demande initiale
 * et refus conservés ; aucune annulation automatique ; décision d'un ops ou
 * fondateur actif avant le début.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    removalReviewSchema,
    "removal_requests.review",
    (s, id, b) =>
      s.rpc("request_targeted_removal_review", {
        p_request_id: b.request_id,
        p_original_id: id!,
        p_reason: b.reason,
      }),
    "request_not_found",
  );
}
