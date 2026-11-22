import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { firstRow, sessionContext } from "@/lib/api/cancellation-route";
import {
  companyCancellationBodyRefusal,
  companyCancellationRefusal,
  companyCancellationRequestSchema,
} from "@/lib/validations/company-cancellation";

type Ctx = { params: Promise<{ id: string }> };

function rpcError(
  error: { message?: string; code?: string },
  op: string,
  request: NextRequest,
) {
  const refusal = companyCancellationRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status },
    );
  }
  return internalErrorResponse(op, error, {
    code: "company_cancellation_failed",
    request,
  });
}

/**
 * Lot 17d-2 — annulation par l'entreprise après sélection (ANN-06).
 *
 * GET  : journées encore engagées de l'offre, par date et par candidat
 *        (prénom et initiale), avec la qualification calculée par la base
 *        sur le plan figé à la sélection (`company_cancellation_preview`),
 *        et historique des demandes (`my_company_cancellations`).
 * POST : demande (`request_company_cancellation`) : un événement, journées
 *        bloquées, missions sans journée restante annulées, candidats
 *        prévenus, audit, dans une transaction. Aucune sanction, aucun
 *        frais, aucune indemnité. Relance : même résultat.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await sessionContext(params, "id", "job_not_found");
    if (ctx.error) return ctx.error;
    const [preview, mine] = await Promise.all([
      ctx.supabase.rpc("company_cancellation_preview", { p_job_id: ctx.id! }),
      ctx.supabase.rpc("my_company_cancellations", { p_job_id: ctx.id! }),
    ]);
    if (preview.error)
      return rpcError(preview.error, "company_cancellations.preview", request);
    if (mine.error)
      return rpcError(mine.error, "company_cancellations.mine", request);
    const mineData = mine.data as {
      cancellations?: unknown[];
      server_now?: string;
    } | null;
    // Le plan figé et l'échéance ne concernent que l'entreprise elle-même ;
    // aucune coordonnée du candidat n'est lue (prénom et initiale).
    const days = (preview.data ?? []).map((d) => ({
      mission_day_id: d.mission_day_id,
      mission_id: d.mission_id,
      application_id: d.application_id,
      job_id: d.job_id,
      day_date: d.day_date,
      start_time: d.start_time,
      end_time: d.end_time,
      starts_at: d.starts_at,
      first_name: d.first_name,
      last_initial: d.last_initial,
      state: d.state,
      classification: d.classification,
      company_plan: d.company_plan,
      cancellation_notice_hours: d.cancellation_notice_hours,
      deadline_at: d.deadline_at,
    }));
    return NextResponse.json(
      {
        days,
        cancellations: mineData?.cancellations ?? [],
        server_now:
          mineData?.server_now ?? preview.data?.[0]?.server_now ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("company_cancellations.preview", error, {
      code: "company_cancellation_failed",
      request,
    });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await sessionContext(params, "id", "job_not_found");
    if (ctx.error) return ctx.error;
    const parsed = companyCancellationRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const code = companyCancellationBodyRefusal(
        parsed.error.issues[0]?.message,
      );
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const b = parsed.data;
    const { data, error } = await ctx.supabase.rpc(
      "request_company_cancellation",
      {
        p_request_id: b.request_id,
        p_job_id: ctx.id!,
        p_day_ids: b.day_ids,
        p_reason: b.reason,
        p_acknowledge_late: b.acknowledge_late,
      },
    );
    if (error) return rpcError(error, "company_cancellations.request", request);
    return NextResponse.json({ cancellation: firstRow(data) });
  } catch (error) {
    return internalErrorResponse("company_cancellations.request", error, {
      code: "company_cancellation_failed",
      request,
    });
  }
}
