import { NextResponse } from "next/server";
import {
  logServerError,
  requestIdFrom,
  type ErrorCategory,
} from "@/lib/observability/server-log";

/**
 * Réponse 500 commune (audit F-23) : l'erreur est journalisée avec son
 * contexte sûr (opération, catégorie, code SQL ou Auth, identifiant de
 * requête), la réponse ne contient qu'un message générique, un code métier
 * que l'interface traduit et l'identifiant de requête à citer au support.
 * Jamais `error.message`, `details` ni `hint` de Postgres.
 */
export function internalErrorResponse(
  op: string,
  error: unknown,
  options: {
    code: string;
    request?: { headers: Pick<Headers, "get"> } | null;
    category?: ErrorCategory;
  },
): NextResponse {
  const requestId = requestIdFrom(options.request?.headers);
  logServerError(op, error, { requestId, category: options.category });
  return NextResponse.json(
    {
      error: "Internal server error",
      code: options.code,
      ...(requestId ? { requestId } : {}),
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
