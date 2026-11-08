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
    return NextResponse.json(
      { missions: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("jobs.missions", error, {
      code: "mission_failed",
      request,
    });
  }
}
