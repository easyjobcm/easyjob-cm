import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import { incidentBodyRefusal } from "@/lib/validations/incident";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Préambule des routes admin d'un signalement (lots 14 et 15) : session
 * vérifiée et identifiant valide. Le grade est revérifié par chaque RPC en
 * base (`is_admin_user`, `is_ops_admin_user` : compte actif exigé).
 */
export async function adminIncidentContext(
  params: Promise<{ id: string }>,
): Promise<
  | { error: NextResponse }
  | { error: null; supabase: ServerClient; incidentId: string }
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
  const incidentId = z.string().uuid().safeParse(id);
  if (!incidentId.success) {
    return {
      error: NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      ),
    };
  }
  return { error: null, supabase, incidentId: incidentId.data };
}

/**
 * Corps commun des routes d'action d'un dossier (lot 16) : session,
 * identifiant, corps validé par Zod, RPC, refus traduits en codes. Le grade,
 * la partie et l'état sont revérifiés par la RPC en base.
 */
export async function incidentAction<T>(
  request: Request,
  params: Promise<{ id: string }>,
  schema: z.ZodType<T>,
  op: string,
  fallbackCode: string,
  call: (
    supabase: ServerClient,
    id: string,
    body: T,
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string; details?: string } | null;
  }>,
): Promise<NextResponse> {
  try {
    const ctx = await adminIncidentContext(params);
    if (ctx.error) return ctx.error;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await call(
      ctx.supabase,
      ctx.incidentId,
      parsed.data,
    );
    if (error) return incidentRpcError(error, op, fallbackCode, request);
    return NextResponse.json({
      result: Array.isArray(data) ? (data[0] ?? null) : data,
    });
  } catch (error) {
    return internalErrorResponse(op, error, { code: fallbackCode, request });
  }
}
