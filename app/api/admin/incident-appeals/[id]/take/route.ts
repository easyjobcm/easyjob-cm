import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { appealTakeSchema } from "@/lib/validations/incident";

/**
 * Affectation d'une révision (lot 16, RPC `admin_take_incident_appeal`) :
 * agent habilité distinct de ceux qui ont proposé et validé.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    appealTakeSchema,
    "admin.incidents.appeal_take",
    "appeal_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_take_incident_appeal", {
        p_appeal_id: id,
        p_conflict: body.conflict,
      }),
  );
}
