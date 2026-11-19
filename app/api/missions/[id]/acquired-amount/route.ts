import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  cancellationRpcError,
  sessionContext,
} from "@/lib/api/cancellation-route";

/**
 * Lot 17c — montant acquis d'une mission (parties et support) :
 * forfait × heures prévues réalisées ÷ heures prévues, sur le contrat figé.
 * Information seulement : aucun versement n'est effectué (lot paiement).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "mission_not_found");
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc("mission_acquired_amount", {
      p_mission_id: ctx.id!,
    });
    if (error)
      return cancellationRpcError(
        error,
        "missions.acquired_amount",
        "acquired_amount_failed",
        request,
      );
    return NextResponse.json(
      { amount: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("missions.acquired_amount", error, {
      code: "acquired_amount_failed",
      request,
    });
  }
}
