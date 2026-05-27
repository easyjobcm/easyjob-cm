import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    // Build query
    let query = supabase
      .from("jobs")
      .select(
        `
        *,
        company:company_profiles(id, company_name, logo_url, city),
        category:job_categories(id, name_fr, name_en, icon)
      `,
        { count: "exact" },
      )
      .eq("status", "published")
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

    // Validate required fields
    const requiredFields = [
      "title",
      "description",
      "address",
      "city",
      "start_date",
      "start_time",
      "end_time",
      "hourly_rate",
    ];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 },
        );
      }
    }

    // Create job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        company_id: company.id,
        title: body.title,
        description: body.description,
        category_id: body.category_id,
        job_type: body.job_type || "shift",
        address: body.address,
        city: body.city,
        quartier: body.quartier,
        latitude: body.latitude,
        longitude: body.longitude,
        start_date: body.start_date,
        end_date: body.end_date,
        start_time: body.start_time,
        end_time: body.end_time,
        is_recurring: body.is_recurring || false,
        recurring_days: body.recurring_days,
        hourly_rate: body.hourly_rate,
        estimated_hours: body.estimated_hours,
        required_skills: body.required_skills,
        min_experience_months: body.min_experience_months || 0,
        dress_code: body.dress_code,
        special_instructions: body.special_instructions,
        positions_available: body.positions_available || 1,
        urgency: body.urgency || "normal",
        status: "pending_moderation", // All jobs start as pending
      })
      .select()
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
