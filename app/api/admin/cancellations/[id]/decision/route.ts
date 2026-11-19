import { NextRequest } from "next/server";
import { adminAction } from "@/lib/api/admin-cancellation-route";
import { cancellationDecisionSchema } from "@/lib/validations/cancellation";

/**
 * Lot 17c — décision motivée sur un justificatif (ops ou fondateur actif) :
 * acceptée → aucune sanction ; refusée → manquement unique (−5 unités).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminAction(
    request,
    params,
    cancellationDecisionSchema,
    "admin.cancellations.decide",
    "decision_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_decide_candidate_cancellation", {
        p_id: id!,
        p_decision: body.decision,
        p_note: body.note,
      }),
    "cancellation_not_found",
  );
}
