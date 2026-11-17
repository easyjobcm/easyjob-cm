import { NextRequest } from "next/server";
import { incidentAction } from "@/lib/api/admin-incident-route";
import { deadlineExtensionSchema } from "@/lib/validations/incident";

/**
 * Prolongation motivée des échéances (lot 16, RPC
 * `admin_extend_incident_deadlines`) : datée et historisée.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return incidentAction(
    request,
    params,
    deadlineExtensionSchema,
    "admin.incidents.extend",
    "extension_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_extend_incident_deadlines", {
        p_incident_id: id,
        p_hours: body.hours,
        p_reason: body.reason,
      }),
  );
}
