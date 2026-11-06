import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobRefusal } from "@/lib/validations/job";

/**
 * Candidatures d'une offre de l'entreprise connectée (F-16).
 *
 * La RPC `company_job_applicants` vérifie en base que l'offre appartient à
 * l'appelant et ne renvoie que le prénom, l'initiale du nom, des indicateurs
 * de fiabilité et les compétences. La photo est servie par
 * `…/applications/[applicationId]/photo`, sans chemin de stockage.
 */
export async function GET(
  _request: NextRequest,
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
      console.error("Applicants error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
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
    console.error("Applicants error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
