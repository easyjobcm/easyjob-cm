import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { isCompanyRole } from "@/lib/utils/profile-status";

// Get current user profile
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user from our users table
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (userError) {
      return internalErrorResponse("user.read", userError, {
        code: "user_failed",
        request,
      });
    }

    // Get profile based on role
    let profile = null;
    if (userData.role === "candidate") {
      const { data: candidateProfile } = await supabase
        .from("candidate_profiles")
        .select("*, candidate_skills(*), candidate_availability(*)")
        .eq("user_id", user.id)
        .single();
      profile = candidateProfile;
    } else if (isCompanyRole(userData.role)) {
      const { data: companyProfile } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();
      profile = companyProfile;
    }

    return NextResponse.json({
      user: userData,
      profile,
      auth: {
        email: user.email,
        phone: user.phone,
        emailConfirmed: !!user.email_confirmed_at,
      },
    });
  } catch (error) {
    return internalErrorResponse("user.read", error, {
      code: "user_failed",
      request,
    });
  }
}
