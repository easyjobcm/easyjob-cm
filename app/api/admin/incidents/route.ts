import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { incidentRpcError } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";

const statusSchema = z
  .enum(["open", "answered", "decided", "closed"])
  .nullable()
  .catch(null);

/**
 * Signalements de mission pour le support (lot 14, RPC
 * `admin_mission_incidents`). Le grade est vérifié en base
 * (`is_admin_user` : compte actif exigé) ; lecture en session.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      );
    }
    const status = statusSchema.parse(
      request.nextUrl.searchParams.get("status"),
    );
    const { data, error } = await supabase.rpc("admin_mission_incidents", {
      ...(status ? { p_status: status } : {}),
    });
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.list",
        "incidents_failed",
        request,
      );
    return NextResponse.json(
      { incidents: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("admin.incidents.list", error, {
      code: "incidents_failed",
      request,
    });
  }
}
