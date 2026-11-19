import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobClosureSchema } from "@/lib/validations/job";
import { jobWriteErrorResponse } from "../../job-write-response";

/**
 * Lot 17d-1 : clôture d'une offre déjà publiée et sans engagement par son
 * entreprise (RPC `close_job`, session de l'utilisateur). La base déduit
 * l'entreprise de la session, refuse une offre avec engagement
 * (`job_has_commitments`) ou jamais publiée (`job_not_published`), et
 * enregistre ensemble la clôture, le motif, la trace d'audit et les
 * notifications. Relance après succès : même résultat (`already_closed`).
 */
export async function POST(
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
        { error: "Job not found", code: "job_not_found" },
        { status: 404 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = jobClosureSchema.safeParse(body);
    if (!parsed.success) {
      const code =
        parsed.error.issues[0]?.message === "closure_reason_too_long"
          ? "closure_reason_too_long"
          : "closure_reason_required";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("close_job", {
      p_job_id: jobId.data,
      p_reason: parsed.data.reason,
    });
    if (error) return jobWriteErrorResponse(error, "jobs.close", request);

    const closure = data?.[0];
    return NextResponse.json({
      closure: closure
        ? {
            job_id: closure.job_id,
            status: closure.status,
            closed_at: closure.closed_at,
            notified_users: closure.notified_users,
            already_closed: closure.already_closed,
          }
        : null,
    });
  } catch (error) {
    return internalErrorResponse("jobs.close", error, {
      code: "job_write_failed",
      request,
    });
  }
}
