import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { proposalReviewSchema } from "@/lib/validations/incident";

/**
 * Seconde validation (lot 16, RPC `admin_review_incident_proposal`) : un
 * autre admin_ops ou admin_founder actif, non concerné, sur la version
 * proposée. Décision, réalisation, audit et notifications : une transaction.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    proposalReviewSchema,
    "admin.incidents.review",
    "review_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_review_incident_proposal", {
        p_proposal_id: id,
        p_approve: body.approve,
        p_note: body.note,
        p_conflict: body.conflict,
      }),
  );
}
