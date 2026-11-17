import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { infoAnswerSchema } from "@/lib/validations/incident";

/**
 * Réponse d'une partie à une demande de complément (lot 16, RPC
 * `answer_incident_info_request`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    infoAnswerSchema,
    "incidents.info_answer",
    "info_answer_failed",
    (supabase, id, body) =>
      supabase.rpc("answer_incident_info_request", {
        p_request_id: id,
        p_body: body.statement,
      }),
  );
}
