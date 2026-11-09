import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { myReputationSchema } from "@/lib/reputation/progress";

/**
 * Réputation EasyJob du compte connecté (lot 9c), espace personnel
 * uniquement : score, progression par catégorie et variations dont
 * l'animation n'a pas encore été jouée. Calculée en base à la lecture
 * (`my_reputation`) : correcte même entre une échéance et la tâche planifiée.
 */
export async function GET(request: NextRequest) {
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

  const { data, error } = await supabase.rpc("my_reputation");
  if (error) {
    return internalErrorResponse("reputation.read", error, {
      code: "reputation_failed",
      request,
    });
  }
  if (data === null) {
    return NextResponse.json({ reputation: null });
  }
  const parsed = myReputationSchema.safeParse(data);
  if (!parsed.success) {
    return internalErrorResponse("reputation.parse", parsed.error, {
      code: "reputation_failed",
      request,
    });
  }
  return NextResponse.json(
    { reputation: parsed.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
