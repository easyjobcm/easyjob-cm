import { NextResponse } from "next/server";
import type { z } from "zod";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  bodyRefusal,
  cancellationRpcError,
  firstRow,
  sessionContext,
} from "@/lib/api/cancellation-route";

type ServerClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;
type RpcResult = PromiseLike<{
  data: unknown;
  error: { message?: string; code?: string } | null;
}>;

/**
 * Action du support sur un dossier d'annulation, une fraude ou une
 * suspension (lot 17c) : session, identifiant, corps Zod, RPC en session
 * (jamais la clé service : l'audit nomme l'agent réel), codes traduits. Le
 * grade (`is_admin_user` / `is_ops_admin_user`, compte actif) est vérifié
 * en base par la RPC.
 */
export async function adminAction<T>(
  request: Request,
  params: Promise<Record<string, string>> | null,
  schema: z.ZodType<T>,
  op: string,
  fallbackCode: string,
  call: (supabase: ServerClient, id: string | null, body: T) => RpcResult,
  notFound = "not_found",
): Promise<NextResponse> {
  try {
    const ctx = await sessionContext(params, "id", notFound);
    if (ctx.error) return ctx.error;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return bodyRefusal(parsed.error.issues[0]?.message);
    const { data, error } = await call(ctx.supabase, ctx.id, parsed.data);
    if (error) return cancellationRpcError(error, op, fallbackCode, request);
    return NextResponse.json({ result: firstRow(data) });
  } catch (error) {
    return internalErrorResponse(op, error, { code: fallbackCode, request });
  }
}

/** Lecture du support : RPC en session, réponse JSON sans cache. */
export async function adminRead(
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
    if (error) return cancellationRpcError(error, op, `${op}_failed`, request);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: `${op}_failed`,
      request,
    });
  }
}
