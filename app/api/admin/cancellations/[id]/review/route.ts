import { NextRequest } from "next/server";
import { adminAction } from "@/lib/api/admin-cancellation-route";
import { cancellationReviewDecisionSchema } from "@/lib/validations/cancellation";

/**
 * Lot 17c — décision sur un recours (ops ou fondateur actif, distinct de
 * l'auteur de la décision) : « overturned » annule le manquement ; la
 * réputation et les exclusions sont recalculées.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminAction(
    request,
    params,
    cancellationReviewDecisionSchema,
    "admin.cancellations.review",
    "review_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_decide_cancellation_review", {
        p_id: id!,
        p_outcome: body.outcome,
        p_note: body.note,
      }),
    "cancellation_not_found",
  );
}
