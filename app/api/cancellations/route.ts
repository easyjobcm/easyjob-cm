import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  cancellationRpcError,
  sessionContext,
} from "@/lib/api/cancellation-route";

/**
 * Lot 17b — demandes d'annulation du candidat connecté (Tâches : pièces
 * attendues, décisions, recours). Ouvert pendant une suspension.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await sessionContext(null);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc(
      "my_candidate_cancellations",
      {},
    );
    if (error)
      return cancellationRpcError(
        error,
        "cancellations.mine",
        "cancellation_failed",
        request,
      );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalErrorResponse("cancellations.mine", error, {
      code: "cancellation_failed",
      request,
    });
  }
}
