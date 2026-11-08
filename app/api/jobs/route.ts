import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { jobInputSchema } from "@/lib/validations/job";
import { jobWriteErrorResponse } from "./job-write-response";
import { JOB_PUBLISHED_STATUS } from "@/lib/utils/job-status";

// Get all published jobs with filtering
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Extract query parameters
    const city = searchParams.get("city");
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    // Pagination bornée : une valeur absente ou invalide reprend le défaut.
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") || "10") || 10),
    );
    const offset = (page - 1) * limit;

    // Build query — colonnes explicites (jamais SELECT *)
    let query = supabase
      .from("jobs")
      .select(
        `
        id, title, description, address, city, start_date, start_time,
        end_time, mission_pay_per_candidate, positions_available, positions_filled,
        status, urgency, published_at, category_id, sandbox_level_required,
        company:company_public_profiles(id, company_name, logo_url, city),
        category:job_categories(id, name_fr, name_en, icon)
      `,
        { count: "exact" },
      )
      .eq("status", JOB_PUBLISHED_STATUS)
      .gte("start_date", new Date().toISOString().split("T")[0])
      .order("urgency", { ascending: false })
      .order("published_at", { ascending: false });

    // Apply filters
    if (city) {
      query = query.ilike("city", `%${city}%`);
    }
    if (category) {
      query = query.eq("category_id", category);
    }
    if (search) {
      // Les séparateurs de filtre PostgREST (`,` `(` `)`) et les jokers sont
      // retirés : la recherche reste un texte, jamais une syntaxe de filtre.
      const term = search
        .replace(/[,()*%\\]/g, " ")
        .trim()
        .slice(0, 100);
      if (term) {
        query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
      }
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: jobs, error, count } = await query;

    if (error) {
      return internalErrorResponse("jobs.list", error, {
        code: "jobs_failed",
        request,
      });
    }

    return NextResponse.json({
      jobs,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    return internalErrorResponse("jobs.list", error, {
      code: "jobs_failed",
      request,
    });
  }
}

// Create a new job (for companies)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      );
    }

    const parsed = jobInputSchema.safeParse(
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

    const { data: job, error } = await supabase.rpc("create_job", {
      p_job: parsed.data,
    });
    if (error) return jobWriteErrorResponse(error, "jobs.create", request);

    return NextResponse.json(
      { job: { id: job.id, title: job.title, status: job.status } },
      { status: 201 },
    );
  } catch (error) {
    return internalErrorResponse("jobs.create", error, {
      code: "job_write_failed",
      request,
    });
  }
}
