import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { missionRefusal } from "@/lib/validations/mission";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Préambule commun des routes de mission (lot 7c) : session vérifiée et
 * identifiant valide. Renvoie la réponse d'erreur à retourner telle quelle,
 * ou le client et l'identifiant.
 */
export async function missionRouteContext(
  params: Promise<{ id: string }>,
): Promise<
  | { error: NextResponse }
  | { error: null; supabase: ServerClient; missionId: string }
> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      ),
    };
  }
  const missionId = z.string().uuid().safeParse(id);
  if (!missionId.success) {
    return {
      error: NextResponse.json(
        { error: "mission_not_found", code: "mission_not_found" },
        { status: 404 },
      ),
    };
  }
  return { error: null, supabase, missionId: missionId.data };
}

/**
 * Réponse à une erreur de RPC : refus métier connu, sinon 500. Seul le code
 * SQL est journalisé (jamais de paramètre ni de code de fin).
 */
export function missionRpcError(
  error: { message?: string; code?: string; details?: string },
  label: string,
  fallbackCode: string,
): NextResponse {
  const refusal = missionRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      {
        error: refusal.code,
        code: refusal.code,
        ...(refusal.code === "too_early" && error.details
          ? { available_at: error.details }
          : {}),
      },
      { status: refusal.status },
    );
  }
  console.error(`${label}:`, error.code);
  return NextResponse.json(
    { error: "Internal server error", code: fallbackCode },
    { status: 500 },
  );
}
