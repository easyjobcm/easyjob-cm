import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { hashMomoOtpToken } from "@/lib/momo-otp";
import { momoOtpSchema } from "@/lib/validations/profile";

/**
 * T6 — vérification du code de preuve de possession du numéro Mobile.
 *
 * `momo_otp` ne stocke pas le numéro (le RPC `momo_verify_otp` est
 * profil-scopé), donc un code envoyé pour un ANCIEN numéro ne doit pas
 * pouvoir « prouver » le numéro courant : cette route compare d'abord le
 * numéro transmis au numéro réellement enregistré (écarté = 400
 * `otp_number_mismatch`) et l'état courant (`awaiting` → sinon 400
 * `otp_not_requested`). La comparaison du hash se fait ensuite dans le
 * RPC (3 échecs = `rejected` + motif `otp_max_attempts`).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = momoOtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("momo_number, momo_otp_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.momo_otp_status !== "awaiting") {
    return NextResponse.json({ code: "otp_not_requested" }, { status: 400 });
  }

  if (profile.momo_number !== parsed.data.number) {
    return NextResponse.json({ code: "otp_number_mismatch" }, { status: 400 });
  }

  // Résultat du RPC : 'none' | 'expired' | 'verified' | 'wrong' | 'maxed'
  const { data: outcome, error: rpcError } = await supabase.rpc(
    "momo_verify_otp",
    { p_token_hash: hashMomoOtpToken(parsed.data.token) },
  );

  if (rpcError) {
    console.error("[momo-otp] verify rpc failed:", rpcError.message);
    return NextResponse.json({ error: "Verify failed" }, { status: 500 });
  }

  switch (outcome) {
    case "verified":
      return NextResponse.json({
        ok: true,
        status: "verified",
        message: "otp_verified",
      });
    case "wrong":
      return NextResponse.json({ code: "otp_wrong" }, { status: 400 });
    case "maxed":
      // 3 échecs : le RPC a posé momo_otp_status = 'rejected' +
      // momo_reject_reason = 'otp_max_attempts'.
      return NextResponse.json({ code: "otp_max_attempts" }, { status: 400 });
    case "expired":
    case "none":
    default:
      return NextResponse.json({ code: "otp_expired" }, { status: 400 });
  }
}
