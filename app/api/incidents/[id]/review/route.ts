import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { reviewRequestSchema } from "@/lib/validations/incident";

/**
 * Demande de révision interne par une partie (lot 16, RPC
 * `request_incident_review`) : sept jours après la décision notifiée, à
 * l'heure de la base. Les autres recours restent ouverts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    reviewRequestSchema,
    "incidents.review",
    "review_request_failed",
    (supabase, id, body) =>
      supabase.rpc("request_incident_review", {
        p_incident_id: id,
        p_statement: body.statement,
      }),
  );
}
