import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";

// Get all job categories
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: categories, error } = await supabase
      .from("job_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      return internalErrorResponse("categories.list", error, {
        code: "categories_failed",
        request,
      });
    }

    return NextResponse.json({ categories });
  } catch (error) {
    return internalErrorResponse("categories.list", error, {
      code: "categories_failed",
      request,
    });
  }
}
