import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const JobCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  start_date: z.string().min(1),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  hourly_rate: z.number().positive(),
  category_id: z.string().uuid().optional(),
  job_type: z.string().optional().default("shift"),
  quartier: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  end_date: z.string().optional(),
  is_recurring: z.boolean().optional().default(false),
  recurring_days: z.unknown().optional(),
  estimated_hours: z.number().optional(),
  required_skills: z.unknown().optional(),
  min_experience_months: z.number().int().min(0).optional().default(0),
  dress_code: z.string().optional(),
  special_instructions: z.string().optional(),
  positions_available: z.number().int().positive().optional().default(1),
  urgency: z.enum(["normal", "urgent"]).optional().default("normal"),
});

// Get all published jobs with filtering
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Extract query parameters
    const city = searchParams.get("city");
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    // Build query — colonnes explicites (jamais SELECT *)
    let query = supabase
      .from("jobs")
      .select(
        `
        id, title, description, address, city, start_date, start_time,
        end_time, hourly_rate, positions_available, positions_filled,
        status, urgency, published_at, category_id, sandbox_level_required,
        company:company_profiles(id, company_name, logo_url, city),
        category:job_categories(id, name_fr, name_en, icon)
      `,
        { count: "exact" },
      )
      .eq("status", "active")
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
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: jobs, error, count } = await query;

    if (error) {
      console.error("Error fetching jobs:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    console.error("Error in jobs API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get company profile
    const { data: company, error: companyError } = await supabase
      .from("company_profiles")
      .select("id, verification_status")
      .eq("user_id", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { error: "Company profile not found" },
        { status: 403 },
      );
    }

    // Check if company is verified
    if (company.verification_status !== "verified") {
      return NextResponse.json(
        {
          error: "Company must be verified to post jobs",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = JobCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Create job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        company_id: company.id,
        title: d.title,
        description: d.description,
        category_id: d.category_id,
        job_type: d.job_type,
        address: d.address,
        city: d.city,
        quartier: d.quartier,
        latitude: d.latitude,
        longitude: d.longitude,
        start_date: d.start_date,
        end_date: d.end_date,
        start_time: d.start_time,
        end_time: d.end_time,
        is_recurring: d.is_recurring,
        recurring_days: d.recurring_days,
        hourly_rate: d.hourly_rate,
        estimated_hours: d.estimated_hours,
        required_skills: d.required_skills,
        min_experience_months: d.min_experience_months,
        dress_code: d.dress_code,
        special_instructions: d.special_instructions,
        positions_available: d.positions_available,
        urgency: d.urgency,
        status: "pending_moderation", // All jobs start as pending
      })
      .select("id, title, status")
      .single();

    if (jobError) {
      console.error("Error creating job:", jobError);
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error("Error in create job API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
