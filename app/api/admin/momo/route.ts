import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { momoModerateSchema } from "@/lib/validations/profile";

/**
 * T6 — API admin Mobile Money (pour la future UI admin, planifiée en T8 —
 * cette route est l'infrastructure API de T6).
 *
 * GET  : liste des numéros MoMo à valider. Rôles admin_support (lecture
 *        seule) / admin_ops / admin_founder. Filtre optionnel `?status=`.
 * POST : valider / refuser un numéro (RÔLES admin_ops/admin_founder, comme
 *        la modération des documents ; admin_support ne mute jamais).
 *
 * Le numéro est renvoyé EN CLAIR à l'admin (besoin de confronter le nom du
 * compte au CNI) — API admin uniquement, jamais exposé au candidat.
 *
 * Toute la logique métier (pré-requis preuve OTP, écriture protégée des
 * colonnes vérification, notification + audit_log) vit dans le RPC SECURITY
 * DEFINER `apply_momo_verification` ; la mutation ne passe PAS par
 * createAdminClient (service_role) précisément pour que l'audit logue
 * l'admin RÉEL (auth.uid = l'admin connecté) et que les rôles soient
 * vérifiés au niveau `users.role` + SQL.
 */

const RPC_ERROR_MAP: [RegExp, { code: string; status: number }][] = [
  [/otp proof required/i, { code: "otp_proof_required", status: 400 }],
  [/not authorized.*admin only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*role/i, { code: "forbidden", status: 403 }],
  [/invalid action/i, { code: "invalid_action", status: 400 }],
  [/profile not found/i, { code: "not_found", status: 404 }],
];

function roleForbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userData?.role ||
    !["admin_support", "admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return roleForbiddenResponse();
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? 100) || 100, 1),
    500,
  );

  let query = supabase
    .from("candidate_profiles")
    .select(
      `id, first_name, last_name, momo_provider, momo_number,
       momo_account_name, momo_verified, momo_otp_status, momo_reject_reason,
       momo_verified_at`,
    )
    .not("momo_number", "is", null)
    .order("momo_verified_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (status && status !== "all") {
    query = query.eq("momo_otp_status", status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  // Mutation réservée à admin_ops / admin_founder (admin_support = RO).
  if (
    !userData?.role ||
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return roleForbiddenResponse();
  }

  const body = await request.json().catch(() => null);
  const parsed = momoModerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { profile_id, action, rejection_reason } = parsed.data;

  const { error: rpcError } = await supabase.rpc("apply_momo_verification", {
    p_profile_id: profile_id,
    p_action: action,
    // `p_reject_reason` est `string` dans le type généré (convention
    // Supabase) ; le RPC accepte NULL (cas `approve`, paramètre ignoré).
    p_reject_reason: (action === "reject"
      ? (rejection_reason ?? null)
      : null) as string,
  });

  if (rpcError) {
    const matched = RPC_ERROR_MAP.find(([re]) => re.test(rpcError.message));
    if (matched) {
      return NextResponse.json(
        { code: matched[1].code, error: rpcError.message },
        { status: matched[1].status },
      );
    }
    console.error("[momo-admin] moderate rpc failed:", rpcError.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    status: action === "approve" ? "verified" : "rejected",
  });
}
