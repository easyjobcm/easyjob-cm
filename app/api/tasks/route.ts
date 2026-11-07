import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Tâches de mission du candidat connecté (RPC `candidate_tasks`, lot 7c) :
 * signature, début, fin et évaluation. Horaires prévus, débuts et fins
 * confirmés, et heure du serveur pour cadencer les rappels. Jamais le code
 * de fin.
 */
export async function GET() {
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
    const { data, error } = await supabase.rpc("candidate_tasks");
    if (error) {
      console.error("Candidate tasks error:", error.code);
      return NextResponse.json(
        { error: "Internal server error", code: "tasks_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { missions: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Candidate tasks error:", (error as Error).message);
    return NextResponse.json(
      { error: "Internal server error", code: "tasks_failed" },
      { status: 500 },
    );
  }
}
