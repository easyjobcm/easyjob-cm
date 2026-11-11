import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobUpdateSchema } from "@/lib/validations/job";
import { jobWriteErrorResponse } from "../job-write-response";

// Get a single job by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { error: "Job not found", code: "job_not_found" },
        { status: 404 },
      );
    }
    const supabase = await createClient();

    const { data: job, error } = await supabase
      .from("jobs")
      .select(
        `
        *,
        company:company_public_profiles(
          id, 
          company_name, 
          logo_url, 
          city, 
          sector,
          description,
          reputation_stars
        ),
        category:job_categories(id, name_fr, name_en, icon)
      `,
      )
      .eq("id", id)
      .single();

    if (error) {
      // PGRST116 : aucune ligne visible (inexistante ou non publiée).
      if (error.code !== "PGRST116") {
        return internalErrorResponse("jobs.detail", error, {
          code: "job_failed",
          request,
        });
      }
      return NextResponse.json(
        { error: "Job not found", code: "job_not_found" },
        { status: 404 },
      );
    }

    // Check if user has already applied
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let hasApplied = false;
    let isFavorite = false;

    if (user) {
      const { data: candidateProfile } = await supabase
        .from("candidate_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (candidateProfile) {
        const { data: application } = await supabase
          .from("job_applications")
          .select("id, status")
          .eq("job_id", id)
          .eq("candidate_id", candidateProfile.id)
          .single();

        hasApplied = !!application;

        const { data: favorite } = await supabase
          .from("job_favorites")
          .select("id")
          .eq("job_id", id)
          .eq("candidate_id", candidateProfile.id)
          .single();

        isFavorite = !!favorite;
      }
    }

    return NextResponse.json({
      job,
      userStatus: {
        hasApplied,
        isFavorite,
      },
    });
  } catch (error) {
    return internalErrorResponse("jobs.detail", error, {
      code: "job_failed",
      request,
    });
  }
}

/**
 * Suppression par l'entreprise propriétaire (RPC `delete_job`) : refusée en
 * base (409 `job_has_commitments`) si un candidat est sélectionné ou si une
 * mission ou un contrat existe.
 */
export async function DELETE(
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

    const { data: deletedId, error } = await supabase.rpc("delete_job", {
      p_job_id: jobId.data,
    });
    if (error) return jobWriteErrorResponse(error, "jobs.delete", request);

    return NextResponse.json({ deleted: deletedId });
  } catch (error) {
    return internalErrorResponse("jobs.delete", error, {
      code: "job_write_failed",
      request,
    });
  }
}

/**
 * Modification par l'entreprise propriétaire (RPC `update_job`) : l'offre
 * repasse toujours en modération. Une offre active n'est modifiable qu'avec
 * la modification directe du plan (Pro, Business) et sans candidat
 * sélectionné ; les autres cas sont refusés par la base.
 */
export async function PATCH(
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

    const parsed = jobUpdateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Données invalides",
          code: "invalid_job_data",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { data: job, error } = await supabase.rpc("update_job", {
      p_job_id: jobId.data,
      p_job: parsed.data,
    });
    if (error) return jobWriteErrorResponse(error, "jobs.update", request);

    return NextResponse.json({
      job: { id: job.id, title: job.title, status: job.status },
    });
  } catch (error) {
    return internalErrorResponse("jobs.update", error, {
      code: "job_write_failed",
      request,
    });
  }
}
