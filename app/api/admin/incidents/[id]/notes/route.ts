import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { incidentNoteSchema } from "@/lib/validations/incident";

/**
 * Note interne de vérification (lot 16, RPC `admin_add_incident_note`) :
 * tout admin actif ; jamais lue par les parties.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    incidentNoteSchema,
    "admin.incidents.note",
    "note_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_add_incident_note", {
        p_incident_id: id,
        p_body: body.body,
      }),
  );
}
