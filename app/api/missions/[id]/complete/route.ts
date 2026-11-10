import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext, missionRpcError } from "@/lib/api/mission-route";
import { completionCodeSchema } from "@/lib/validations/mission";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Confirmation de réalisation par le code de fin (RPC
 * `submit_completion_code`). Seul le candidat de la session, après avoir
 * confirmé son début. La base vérifie et consomme le code, compte les
 * erreurs (5, puis 15 min de blocage) et enregistre la réalisation dans la
 * même transaction. Le code soumis n'est ni renvoyé ni journalisé.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;

    const parsed = completionCodeSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "code_format", code: "code_format" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("submit_completion_code", {
      p_mission_id: ctx.missionId,
      p_code: parsed.data.code,
    });
    if (error) {
      return missionRpcError(
        error,
        "missions.complete",
        "completion_failed",
        request,
      );
    }

    const row = data[0];
    if (row?.result === "invalid") {
      return NextResponse.json(
        {
          error: "invalid_code",
          code: "invalid_code",
          remaining_attempts: row.remaining_attempts,
        },
        { status: 422 },
      );
    }
    if (row?.result === "locked") {
      return NextResponse.json(
        {
          error: "code_locked",
          code: "code_locked",
          locked_until: row.locked_until,
        },
        { status: 429 },
      );
    }
    if (row?.result !== "completed" || !row.completed_at) {
      return internalErrorResponse("missions.complete", null, {
        code: "completion_failed",
        request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json({
      completion: {
        mission_id: row.mission_id,
        completed_at: row.completed_at,
        already_completed: row.already_completed,
      },
    });
  } catch (error) {
    return internalErrorResponse("missions.complete", error, {
      code: "completion_failed",
      request,
    });
  }
}
