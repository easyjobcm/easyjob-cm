import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobRefusal } from "@/lib/validations/job";

/**
 * Candidatures d'une offre de l'entreprise connectée (F-16).
 *
 * La RPC `company_job_applicants` vérifie en base que l'offre appartient à
 * l'appelant et ne renvoie que le prénom, l'initiale du nom, la note et le
 * nombre d'avis des missions (lot 9b), les missions et les compétences. La photo est servie par
 * `…/applications/[applicationId]/photo`, sans chemin de stockage.
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
        { error: "Job not found", code: "job_not_found" },
        { status: 404 },
      );
    }

    const { data: rows, error } = await supabase.rpc("company_job_applicants", {
      p_job_id: jobId.data,
    });
    if (error) {
      const refusal = jobRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("jobs.applicants", error, {
        code: "applicants_failed",
        request,
      });
    }

    return NextResponse.json({
      applications: rows.map(({ has_photo, ...row }) => ({
        ...row,
        photo_url: has_photo
          ? `/api/jobs/${jobId.data}/applications/${row.application_id}/photo`
          : null,
      })),
    });
  } catch (error) {
    return internalErrorResponse("jobs.applicants", error, {
      code: "applicants_failed",
      request,
    });
  }
}
