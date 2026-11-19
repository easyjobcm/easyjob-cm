import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Tâches persistantes de la session sur les interruptions
 * (`my_interruption_tasks`) : version attendue, demande du support,
 * proposition à accepter ou refuser, code après un accord. Échéances
 * calculées par la base.
 */
export async function GET(request: NextRequest) {
  const op = "missions.interruption_tasks";
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401 },
      );
    }
    const { data, error } = await supabase.rpc("my_interruption_tasks");
    if (error) {
      return internalErrorResponse(op, error, {
        code: "interruption_tasks_failed",
        request,
      });
    }
    return NextResponse.json(
      { tasks: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: "interruption_tasks_failed",
      request,
    });
  }
}
