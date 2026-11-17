import { NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { incidentRefusal } from "@/lib/validations/incident";

/**
 * Réponse à une erreur des RPC d'incident (lot 14) : refus métier connu,
 * sinon 500 journalisé sans paramètre ni déclaration.
 */
export function incidentRpcError(
  error: { message?: string; code?: string },
  op: string,
  fallbackCode: string,
  request?: { headers: Pick<Headers, "get"> } | null,
): NextResponse {
  const refusal = incidentRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status },
    );
  }
  return internalErrorResponse(op, error, { code: fallbackCode, request });
}

/** Lecture JSON tolérante : corps absent ou invalide → null. */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
