import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  cancellationBodyRefusal,
  cancellationRefusal,
} from "@/lib/validations/cancellation";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Préambule des routes d'annulation, de recours et de suspension (lots
 * 17b–17c) : session vérifiée, identifiant valide. Grade, propriété et état
 * sont revérifiés par chaque RPC en base.
 */
export async function sessionContext(
  params: Promise<Record<string, string>> | null,
  key = "id",
  notFound = "not_found",
): Promise<
  | { error: NextResponse }
  | { error: null; supabase: ServerClient; userId: string; id: string | null }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401 },
      ),
    };
  }
  if (!params) return { error: null, supabase, userId: user.id, id: null };
  const raw = (await params)[key];
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: notFound, code: notFound },
        { status: 404 },
      ),
    };
  }
  return { error: null, supabase, userId: user.id, id: parsed.data };
}

/** Refus métier connu, sinon 500 journalisé sans paramètre. */
export function cancellationRpcError(
  error: { message?: string; code?: string },
  op: string,
  fallbackCode: string,
  request?: { headers: Pick<Headers, "get"> } | null,
): NextResponse {
  const refusal = cancellationRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status },
    );
  }
  return internalErrorResponse(op, error, { code: fallbackCode, request });
}

export function bodyRefusal(issue: string | undefined): NextResponse {
  const code = cancellationBodyRefusal(issue);
  return NextResponse.json({ error: code, code }, { status: 400 });
}

export const firstRow = (data: unknown) =>
  Array.isArray(data) ? (data[0] ?? null) : data;
