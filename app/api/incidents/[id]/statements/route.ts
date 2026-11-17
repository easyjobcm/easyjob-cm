import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentStatementSchema,
} from "@/lib/validations/incident";

/**
 * Version d'une partie sur un signalement (RPC
 * `add_mission_incident_statement`, lot 14). Partie déduite de la session ;
 * une même déclaration envoyée deux fois n'est enregistrée qu'une fois.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
    const incidentId = z.string().uuid().safeParse(id);
    if (!incidentId.success) {
      return NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      );
    }
    const parsed = incidentStatementSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await supabase.rpc(
      "add_mission_incident_statement",
      { p_incident_id: incidentId.data, p_statement: parsed.data.statement },
    );
    if (error)
      return incidentRpcError(
        error,
        "incidents.statement",
        "statement_failed",
        request,
      );
    return NextResponse.json({ statement: data[0] ?? null });
  } catch (error) {
    return internalErrorResponse("incidents.statement", error, {
      code: "statement_failed",
      request,
    });
  }
}
