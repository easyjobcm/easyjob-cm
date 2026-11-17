import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { situationSchema } from "@/lib/validations/incident";

/**
 * Qualification du dossier par le support (lot 16, RPC
 * `admin_set_incident_situation`) : tout admin actif ; modification
 * substantielle (nouvelle version du dossier).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    situationSchema,
    "admin.incidents.situation",
    "situation_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_set_incident_situation", {
        p_incident_id: id,
        p_situation: body.situation,
      }),
  );
}
