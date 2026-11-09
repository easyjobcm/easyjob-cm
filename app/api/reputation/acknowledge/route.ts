import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";

const acknowledgeSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(20),
});

/**
 * Accusé des variations de réputation affichées (lot 9c). La base ne
 * renvoie que les variations acquittées par CET appel : un seul onglet,
 * une seule reconnexion joue l'animation d'une variation donnée.
 */
export async function POST(request: NextRequest) {
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

  const parsed = acknowledgeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", code: "invalid_input" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("acknowledge_reputation_changes", {
    p_ids: parsed.data.ids,
  });
  if (error) {
    return internalErrorResponse("reputation.acknowledge", error, {
      code: "acknowledge_failed",
      request,
    });
  }
  return NextResponse.json({ acknowledged: data ?? [] });
}
