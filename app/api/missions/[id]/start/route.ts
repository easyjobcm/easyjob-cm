import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext, missionRpcError } from "@/lib/api/mission-route";
import { internalErrorResponse } from "@/lib/api/errors";
import { missionStartSchema } from "@/lib/validations/mission";

/**
 * Début de mission par le candidat de la session (RPC `start_mission`).
 * Disponible dès 15 minutes avant l'heure prévue (Africa/Douala) ; l'heure
 * est enregistrée par la base, une seule fois (`already_started` en relance).
 * Aucune position n'est demandée.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;

    // Lot 12 : journée commencée (corps facultatif pour une seule journée).
    const raw = await _request.text().catch(() => "");
    let json: unknown = {};
    try {
      json = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      json = null;
    }
    const parsed = missionStartSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "mission_not_found", code: "mission_not_found" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("start_mission", {
      p_mission_id: ctx.missionId,
      ...(parsed.data.mission_day_id
        ? { p_mission_day_id: parsed.data.mission_day_id }
        : {}),
    });
    if (error)
      return missionRpcError(error, "missions.start", "start_failed", _request);

    const start = data[0];
    if (!start?.started_at) {
      return internalErrorResponse("missions.start", null, {
        code: "start_failed",
        request: _request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json({ start });
  } catch (error) {
    return internalErrorResponse("missions.start", error, {
      code: "start_failed",
      request: _request,
    });
  }
}
