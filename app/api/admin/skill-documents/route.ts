import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, allowed: false as const };

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    // Compte suspendu : aucun grade (AUDIT.md §28, comme is_admin_user).
    .not("is_active", "is", false)
    .single();

  const adminRoles = ["admin_support", "admin_ops", "admin_founder"];
  if (!userData?.role || !adminRoles.includes(userData.role)) {
    return { supabase, allowed: false as const };
  }

  return { supabase, allowed: true as const, role: userData.role };
}

export async function GET(request: NextRequest) {
  const { supabase, allowed } = await requireAdmin();
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const documentType = searchParams.get("type");
  const search = searchParams.get("search");

  let query = supabase
    .from("candidate_documents")
    .select(
      `id, document_type, title, issuing_organization, issued_at, expires_at,
       status, rejection_reason, verified_at, created_at,
       candidate:candidate_profiles!inner ( id, first_name, last_name ),
       candidate_skill_documents ( candidate_skill_id, candidate_skills ( skill_name ) )`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);
  if (documentType) query = query.eq("document_type", documentType);
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
      { referencedTable: "candidate_profiles" },
    );
  }

  const { data, error } = await query;
  if (error) {
    return internalErrorResponse("admin.skill_documents.list", error, {
      code: "admin_documents_failed",
      request,
    });
  }

  return NextResponse.json({ documents: data ?? [] });
}
