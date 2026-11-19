import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  bodyRefusal,
  cancellationRpcError,
  firstRow,
  sessionContext,
} from "@/lib/api/cancellation-route";
import { reviewRequestSchema } from "@/lib/validations/cancellation";

/** Lot 17c — contestation d'une suspension (cycle ou fraude). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "suspension_not_found");
    if (ctx.error) return ctx.error;
    const parsed = reviewRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return bodyRefusal(parsed.error.issues[0]?.message);
    const { data, error } = await ctx.supabase.rpc(
      "contest_account_suspension",
      { p_suspension_id: ctx.id!, p_note: parsed.data.note },
    );
    if (error)
      return cancellationRpcError(
        error,
        "account.suspension_contest",
        "contest_failed",
        request,
      );
    return NextResponse.json({ contest: firstRow(data) });
  } catch (error) {
    return internalErrorResponse("account.suspension_contest", error, {
      code: "contest_failed",
      request,
    });
  }
}
