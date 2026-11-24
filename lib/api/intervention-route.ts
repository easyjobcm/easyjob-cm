import { NextResponse } from "next/server";
import type { z } from "zod";
import { internalErrorResponse } from "@/lib/api/errors";
import { firstRow, sessionContext } from "@/lib/api/cancellation-route";
import {
  interventionBodyRefusal,
  interventionRefusal,
} from "@/lib/validations/support-intervention";

type ServerClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;
type RpcResult = PromiseLike<{
  data: unknown;
  error: { message?: string; code?: string } | null;
}>;

/** Refus métier connu, sinon 500 journalisé sans paramètre. */
export function interventionRpcError(
  error: { message?: string; code?: string },
  op: string,
  request?: { headers: Pick<Headers, "get"> } | null,
): NextResponse {
  const refusal = interventionRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status },
    );
  }
  return internalErrorResponse(op, error, {
    code: "intervention_failed",
    request,
  });
}

/**
 * Écriture du lot 17d-3 : session, identifiant éventuel, corps Zod, RPC en
 * session (jamais la clé service : l'audit nomme l'auteur réel), codes
 * traduits. Grades, propriété, états et échéances sont vérifiés en base.
 */
export async function interventionAction<T>(
  request: Request,
  params: Promise<Record<string, string>> | null,
  schema: z.ZodType<T>,
  op: string,
  call: (supabase: ServerClient, id: string | null, body: T) => RpcResult,
  notFound = "not_found",
): Promise<NextResponse> {
  try {
    const ctx = await sessionContext(params, "id", notFound);
    if (ctx.error) return ctx.error;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const code = interventionBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await call(ctx.supabase, ctx.id, parsed.data);
    if (error) return interventionRpcError(error, op, request);
    return NextResponse.json({ result: firstRow(data) });
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: "intervention_failed",
      request,
    });
  }
}

/** Lecture : RPC en session, réponse JSON sans cache. */
export async function interventionRead(
  request: Request,
  params: Promise<Record<string, string>> | null,
  op: string,
  call: (supabase: ServerClient, id: string | null) => RpcResult,
  notFound = "not_found",
): Promise<NextResponse> {
  try {
    const ctx = await sessionContext(params, "id", notFound);
    if (ctx.error) return ctx.error;
    const { data, error } = await call(ctx.supabase, ctx.id);
    if (error) return interventionRpcError(error, op, request);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: "intervention_failed",
      request,
    });
  }
}
