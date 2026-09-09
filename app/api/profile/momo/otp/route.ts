import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  generateMomoOtpToken,
  hashMomoOtpToken,
  OTP_TTL_SECONDS,
  sendMomoOtpSms,
} from "@/lib/momo-otp";
import { getClientIp } from "@/lib/utils/request";

/**
 * T6 — émission de l'OTP de preuve de possession du numéro Mobile Money.
 *
 * Ordre d'opérations (le code n'est stocké QUE si le SMS est livré) :
 *   1. session candidat (role candidate / candidate_premium) ;
 *   2. le profil DOIT avoir un numéro enregistré (sinon 400
 *      `otp_not_configured`) ;
 *   3. quota anti-abus `check_sms_send_quota` (5/n°/24h, 10/IP/h) —
 *      service role (sinon 429 `sms_quota_exceeded`) ;
 *   4. génération d'un code 6 chiffres (CSPRNG) + hash SHA-256 ;
 *   5. envoi SMS (Twilio si configuré, sinon sandbox log) — si Twilio
 *      refuse, 502 `sms_failed` SANS stockage du code ;
 *   6. `momo_issue_otp` (RPC SECURITY DEFINER) : remplace le code actif,
 *      passe `momo_otp_status = 'awaiting'`, TTL = now + 10 min ;
 *   7. log `sms_send_log` (service role) pour les quotas suivants.
 *
 * N'ENVOIE JAMAIS de coordonnées du candidat hors numéros métier.
 */
export async function POST(_request: NextRequest) {
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

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("momo_number")
    .eq("user_id", user.id)
    .maybeSingle();

  const number = profile?.momo_number;
  if (!number) {
    return NextResponse.json({ code: "otp_not_configured" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Anti-abus : quota par numéro (5/24h) et par IP (10/h).
  const ip = await getClientIp();
  const { data: allowed } = await admin.rpc("check_sms_send_quota", {
    p_phone: `+237${number}`,
    p_ip: ip,
  });
  if (allowed === false) {
    console.warn("[momo-otp] SMS quota exceeded", {
      phone: `+237${number}`,
      ip,
    });
    return NextResponse.json({ code: "sms_quota_exceeded" }, { status: 429 });
  }

  const token = generateMomoOtpToken();
  const result = await sendMomoOtpSms(token, number);

  if (result.channel === "twilio" && !result.delivered) {
    // Le SMS n'est pas parti : ne pas stocker un code jamais livré (le
    // candidat verrait un code à saisir qui n'existe nulle part).
    return NextResponse.json({ code: "sms_failed" }, { status: 502 });
  }

  const { error: rpcError } = await supabase.rpc("momo_issue_otp", {
    p_token_hash: hashMomoOtpToken(token),
    p_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });

  if (rpcError) {
    console.error("[momo-otp] issue rpc failed:", rpcError.message);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  // Log l'envoi pour les quotas suivants.
  await admin.from("sms_send_log").insert({
    phone: `+237${number}`,
    ip,
    user_id: user.id,
  });

  return NextResponse.json({ ok: true, channel: result.channel });
}
