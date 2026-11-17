import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { appealDecisionSchema } from "@/lib/validations/incident";

/**
 * Décision de révision (lot 16, RPC `admin_decide_incident_appeal`) : par
 * l'agent affecté ; une décision « établie » n'est pas annulée (arbitrage).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    appealDecisionSchema,
    "admin.incidents.appeal_decide",
    "appeal_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_decide_incident_appeal", {
        p_appeal_id: id,
        p_result: body.result,
        p_new_outcome: body.new_outcome ?? "",
        p_facts_retained: body.facts_retained,
        p_elements_verified: body.elements_verified,
        p_contradictions: body.contradictions,
        p_justification: body.justification,
        ...(body.amicable_attempt
          ? { p_amicable_attempt: body.amicable_attempt }
          : {}),
        ...(body.orientation ? { p_orientation: body.orientation } : {}),
      }),
  );
}
