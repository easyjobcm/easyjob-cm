import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { missionRefusal } from "@/lib/validations/mission";

/**
 * Missions d'une offre de l'entreprise connectée, avec les pointages et les
 * heures retenues (RPC `company_job_missions`, lot 7c). Distances seulement,
 * jamais la position du candidat.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
    const jobId = z.string().uuid().safeParse(id);
    if (!jobId.success) {
      return NextResponse.json(
        { error: "job_not_found", code: "job_not_found" },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.rpc("company_job_missions", {
      p_job_id: jobId.data,
    });
    if (error) {
      const refusal = missionRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("jobs.missions", error, {
        code: "mission_failed",
        request,
      });
    }
    // Lot 17b : journées annulées par le candidat ; lot 17d-2 : ou par
    // l'entreprise (date et auteur seulement, sans motif, qualification ni
    // plan) ; leur code n'est plus montré.
    const { data: cancelled, error: cancelledError } = await supabase.rpc(
      "company_job_cancellations",
      { p_job_id: jobId.data },
    );
    if (cancelledError) {
      return internalErrorResponse("jobs.missions", cancelledError, {
        code: "mission_failed",
        request,
      });
    }
    const cancelledAt = new Map(
      (cancelled ?? []).map((c) => [c.mission_day_id, c]),
    );
    const missions = (data ?? []).map((m) => {
      const c = cancelledAt.get(m.mission_day_id);
      return c
        ? {
            ...m,
            cancelled_at: c.cancelled_at,
            cancelled_by: c.cancelled_by,
            completion_code: null,
          }
        : { ...m, cancelled_at: null, cancelled_by: null };
    });
    return NextResponse.json(
      { missions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("jobs.missions", error, {
      code: "mission_failed",
      request,
    });
  }
}
