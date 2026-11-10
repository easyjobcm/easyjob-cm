import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { missionRefusal } from "@/lib/validations/mission";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Mission vue par l'une de ses parties (RPC `get_mission`, lot 7c) :
 * horaire prévu, pointages confirmés, heures retenues, validation et action
 * disponible. Jamais les coordonnées du candidat.
 */
export async function GET(
  _request: NextRequest,
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
    const missionId = z.string().uuid().safeParse(id);
    if (!missionId.success) {
      return NextResponse.json(
        { error: "mission_not_found", code: "mission_not_found" },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.rpc("get_mission", {
      p_mission_id: missionId.data,
    });
    if (error) {
      const refusal = missionRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("missions.read", error, {
        code: "mission_failed",
        request: _request,
      });
    }
    const mission = data[0];
    if (!mission) {
      return NextResponse.json(
        { error: "mission_not_found", code: "mission_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { mission },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("missions.read", error, {
      code: "mission_failed",
      request: _request,
    });
  }
}
