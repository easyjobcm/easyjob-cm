import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  bodyRefusal,
  cancellationRpcError,
  firstRow,
  sessionContext,
} from "@/lib/api/cancellation-route";
import { cancellationRequestSchema } from "@/lib/validations/cancellation";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lot 17b — annulation par le candidat, depuis une de ses missions.
 *
 * GET  : journées encore annulables de la même offre, classées par la base
 *        (`candidate_cancellation_preview` : délai Free 48 h / Premium 24 h,
 *        délai de réaction, historique), et demandes déjà faites.
 * POST : demande (`request_candidate_cancellation`) ; désistement enregistré
 *        tout de suite, entreprise prévenue ; motif et choix de justificatif
 *        exigés en base si une journée est hors délai.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await sessionContext(params, "id", "mission_not_found");
    if (ctx.error) return ctx.error;
    const [preview, mine] = await Promise.all([
      ctx.supabase.rpc("candidate_cancellation_preview", {
        p_mission_id: ctx.id!,
      }),
      ctx.supabase.rpc("my_candidate_cancellations", {
        p_mission_id: ctx.id!,
      }),
    ]);
    if (preview.error)
      return cancellationRpcError(
        preview.error,
        "cancellations.preview",
        "cancellation_failed",
        request,
      );
    if (mine.error)
      return cancellationRpcError(
        mine.error,
        "cancellations.mine",
        "cancellation_failed",
        request,
      );
    const mineData = mine.data as {
      cancellations?: unknown[];
      server_now?: string;
    } | null;
    return NextResponse.json(
      {
        days: preview.data ?? [],
        cancellations: mineData?.cancellations ?? [],
        server_now: mineData?.server_now ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("cancellations.preview", error, {
      code: "cancellation_failed",
      request,
    });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await sessionContext(params, "id", "mission_not_found");
    if (ctx.error) return ctx.error;
    const parsed = cancellationRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return bodyRefusal(parsed.error.issues[0]?.message);
    const b = parsed.data;
    const { data, error } = await ctx.supabase.rpc(
      "request_candidate_cancellation",
      {
        p_request_id: b.request_id,
        p_day_ids: b.day_ids,
        // null accepté par la RPC (journées dans le délai) : types générés
        // sans nullabilité des paramètres.
        p_reason_code: b.reason_code as string,
        p_reason_text: b.reason_text as string,
        p_evidence_choice: b.evidence_choice as string,
      },
    );
    if (error)
      return cancellationRpcError(
        error,
        "cancellations.request",
        "cancellation_failed",
        request,
      );
    return NextResponse.json({ cancellation: firstRow(data) });
  } catch (error) {
    return internalErrorResponse("cancellations.request", error, {
      code: "cancellation_failed",
      request,
    });
  }
}
