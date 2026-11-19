import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  bodyRefusal,
  cancellationRpcError,
  firstRow,
  sessionContext,
} from "@/lib/api/cancellation-route";
import { reviewRequestSchema } from "@/lib/validations/cancellation";

/**
 * Lot 17c — recours du candidat sur un manquement (7 jours après la
 * décision ou le manquement automatique), examiné par un autre agent.
 * Ouvert même pendant une suspension.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "cancellation_not_found");
    if (ctx.error) return ctx.error;
    const parsed = reviewRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return bodyRefusal(parsed.error.issues[0]?.message);
    const { data, error } = await ctx.supabase.rpc(
      "request_cancellation_review",
      { p_cancellation_id: ctx.id!, p_note: parsed.data.note },
    );
    if (error)
      return cancellationRpcError(
        error,
        "cancellations.review",
        "review_failed",
        request,
      );
    return NextResponse.json({ review: firstRow(data) });
  } catch (error) {
    return internalErrorResponse("cancellations.review", error, {
      code: "review_failed",
      request,
    });
  }
}
