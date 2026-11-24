import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { engagementDecisionSchema } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 — décision motivée d'un ops ou fondateur actif (ANN-17,
 * ANN-18) : journées et suspension revérifiées en base à l'instant de la
 * décision ; une seule décision par demande.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    engagementDecisionSchema,
    "admin.engagement_requests.decide",
    (s, id, b) =>
      s.rpc("admin_decide_engagement_request", {
        p_id: id!,
        p_decision: b.decision,
        p_day_ids: b.day_ids,
        p_note: b.note,
      }),
    "request_not_found",
  );
}
