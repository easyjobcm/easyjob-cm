import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { proposalSchema } from "@/lib/validations/incident";

/**
 * Proposition de décision (lot 16, RPC `admin_propose_incident_decision`) :
 * admin_ops ou admin_founder actif, déclaration de conflit d'intérêts,
 * version précise du dossier. La décision exige un second agent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    proposalSchema,
    "admin.incidents.propose",
    "proposal_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_propose_incident_decision", {
        p_incident_id: id,
        p_outcome: body.outcome,
        p_facts_retained: body.facts_retained,
        p_elements_verified: body.elements_verified,
        p_contradictions: body.contradictions,
        p_justification: body.justification,
        ...(body.amicable_attempt
          ? { p_amicable_attempt: body.amicable_attempt }
          : {}),
        ...(body.orientation ? { p_orientation: body.orientation } : {}),
        p_conflict: body.conflict,
      }),
  );
}
