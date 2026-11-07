import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext, missionRpcError } from "@/lib/api/mission-route";

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

    const { data, error } = await ctx.supabase.rpc("start_mission", {
      p_mission_id: ctx.missionId,
    });
    if (error)
      return missionRpcError(error, "Mission start error", "start_failed");

    const start = data[0];
    if (!start?.started_at) {
      console.error("Mission start mismatch");
      return NextResponse.json(
        { error: "Internal server error", code: "start_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ start });
  } catch (error) {
    console.error("Mission start error:", (error as Error).message);
    return NextResponse.json(
      { error: "Internal server error", code: "start_failed" },
      { status: 500 },
    );
  }
}
