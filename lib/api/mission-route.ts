import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { missionRefusal } from "@/lib/validations/mission";
import { internalErrorResponse } from "@/lib/api/errors";

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
 * Réponse à une erreur de RPC : refus métier connu, sinon 500 journalisé
 * (`internalErrorResponse` : code SQL et identifiant de requête, jamais de
 * paramètre ni de code de fin).
 */
export function missionRpcError(
  error: { message?: string; code?: string; details?: string },
  op: string,
  fallbackCode: string,
  request?: { headers: Pick<Headers, "get"> } | null,
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
  return internalErrorResponse(op, error, { code: fallbackCode, request });
}
