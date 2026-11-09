import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Tâches du candidat connecté :
 *   missions  RPC `candidate_tasks` (lot 7c) : signature, début, fin et
 *             évaluation. Horaires prévus, débuts et fins confirmés, et
 *             heure du serveur pour cadencer les rappels. Jamais le code
 *             de fin.
 *   actions   RPC `candidate_action_tasks` (lot 9d) : profil, identité,
 *             téléphone, Mobile Money, CNI et justificatifs qui bloquent
 *             une candidature, recalculés à chaque lecture.
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
    const [missions, actions] = await Promise.all([
      supabase.rpc("candidate_tasks"),
      supabase.rpc("candidate_action_tasks"),
    ]);
    const error = missions.error ?? actions.error;
    if (error) {
      console.error("Candidate tasks error:", error.code);
      return NextResponse.json(
        { error: "Internal server error", code: "tasks_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        missions: missions.data ?? [],
        actions: actions.data ?? [],
        server_now: new Date().toISOString(),
      },
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
