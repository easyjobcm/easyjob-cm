import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { infoRequestSchema } from "@/lib/validations/incident";

/**
 * Demande de complément à une partie (lot 16, RPC
 * `admin_request_incident_info`) : notification dans l'application.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    infoRequestSchema,
    "admin.incidents.info_request",
    "info_request_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_request_incident_info", {
        p_incident_id: id,
        p_party: body.party,
        p_question: body.question,
      }),
  );
}
