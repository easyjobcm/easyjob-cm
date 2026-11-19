import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  cancellationRpcError,
  sessionContext,
} from "@/lib/api/cancellation-route";

/** Lot 17c — suspensions du compte connecté (hors cause administrative). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await sessionContext(null);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc("my_account_suspensions");
    if (error)
      return cancellationRpcError(
        error,
        "account.suspensions",
        "suspensions_failed",
        request,
      );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalErrorResponse("account.suspensions", error, {
      code: "suspensions_failed",
      request,
    });
  }
}
