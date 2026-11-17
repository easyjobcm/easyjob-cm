import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext } from "@/lib/api/mission-route";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentReportSchema,
} from "@/lib/validations/incident";

/**
 * Signalements d'une mission (lot 14), vus par l'une de ses parties
 * (RPC `mission_incidents_for_party`) : faits déclarés, versions des deux
 * parties, nombre de pièces (jamais les pièces), décision du support.
 * Tiers : 404, comme une mission inexistante.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc(
      "mission_incidents_for_party",
      { p_mission_id: ctx.missionId },
    );
    if (error)
      return incidentRpcError(
        error,
        "incidents.list",
        "incidents_failed",
        request,
      );
    return NextResponse.json(
      { incidents: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("incidents.list", error, {
      code: "incidents_failed",
      request,
    });
  }
}

/**
 * Signaler un retard, une absence ou un code non remis sur une journée
 * (RPC `report_mission_incident`). La partie est déduite de la session ;
 * un second envoi renvoie le même signalement (`already_reported`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;
    const parsed = incidentReportSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc("report_mission_incident", {
      p_mission_id: ctx.missionId,
      p_mission_day_id: parsed.data.mission_day_id,
      p_kind: parsed.data.kind,
      p_statement: parsed.data.statement,
      ...(parsed.data.late_minutes != null
        ? { p_late_minutes: parsed.data.late_minutes }
        : {}),
    });
    if (error)
      return incidentRpcError(
        error,
        "incidents.report",
        "report_failed",
        request,
      );
    const incident = data[0];
    if (!incident?.incident_id) {
      return internalErrorResponse("incidents.report", null, {
        code: "report_failed",
        request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json({ incident });
  } catch (error) {
    return internalErrorResponse("incidents.report", error, {
      code: "report_failed",
      request,
    });
  }
}
