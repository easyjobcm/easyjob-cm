// SERVER ONLY — appelé par lib/actions/auth.ts. Hors du fichier
// "use server" : ces fonctions reçoivent des clients privilégiés et ne
// doivent pas être appelables depuis le navigateur.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { finalizeSignup, type FinalizeSignupResult } from "./finalize-signup";
import {
  logServerError,
  logServerWarning,
} from "@/lib/observability/server-log";

/**
 * Vérification du téléphone (audit H-04 et F-12, lot 8).
 *
 * Seul un code accepté par Supabase Auth POUR LE COMPTE DE LA SESSION
 * vérifie le téléphone. Un échec de `verifyOtp` (code erroné, expiré, déjà
 * consommé ou émis pour un autre compte) ne finalise l'inscription que si
 * une preuve serveur fiable montre que ce compte a déjà prouvé la possession
 * du numéro (`findPhoneProof`). L'ancien repli « le numéro relu sur le
 * compte est le numéro demandé » n'en était pas une : en mode autoconfirm,
 * `updateUser({ phone })` confirme le numéro sans aucun code.
 */

type AdminClient = SupabaseClient<Database>;

export type PhoneUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export type PhoneActionResult = { ok: true } | { ok: false; errorCode: string };

/** Réglages publics de Supabase Auth utiles ici (`GET /auth/v1/settings`). */
export type AuthPhoneSettings = { phoneAutoconfirm: boolean };

export type PhoneProof = "account_verified" | "auth_confirmed_after_send";

/** `237…` (format GoTrue) ou `+237…` → `+237…` ; autre valeur → null. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  return /^[0-9]{8,15}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Lit `phone_autoconfirm` sur Supabase Auth. Toute erreur renvoie `null` :
 * l'appelant considère alors la confirmation comme non fiable (refus).
 */
export async function readAuthPhoneSettings(
  supabaseUrl: string,
  anonKey: string,
): Promise<AuthPhoneSettings | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { phone_autoconfirm?: unknown };
    return typeof body.phone_autoconfirm === "boolean"
      ? { phoneAutoconfirm: body.phone_autoconfirm }
      : null;
  } catch {
    return null;
  }
}

/**
 * Preuve serveur que le compte possède déjà `e164`, indépendante du code
 * saisi. Deux sources seulement :
 *
 * 1. `account_verified` : `public.users.phone = e164` et `phone_verified`.
 *    Ces colonnes ne sont écrites que par finalizeSignup après un code
 *    accepté (privilèges de colonnes et trigger du lot 1). Cas : la réponse
 *    de l'action a été perdue après la finalisation.
 * 2. `auth_confirmed_after_send` : Supabase Auth exige un code pour changer
 *    de numéro (`phone_autoconfirm = false`), le numéro confirmé du compte
 *    est `e164`, et sa confirmation est postérieure au dernier envoi de code
 *    enregistré pour ce compte et ce numéro (`sms_send_log`). Cas : le code a
 *    été accepté par Supabase Auth mais la réponse n'est pas parvenue au
 *    serveur. En autoconfirm, ou si les réglages sont illisibles, cette
 *    source est ignorée : une confirmation n'y prouve rien.
 */
export async function findPhoneProof(
  admin: AdminClient,
  userId: string,
  e164: string,
  readSettings: () => Promise<AuthPhoneSettings | null>,
): Promise<PhoneProof | null> {
  const { data: account } = await admin
    .from("users")
    .select("phone, phone_verified")
    .eq("id", userId)
    .maybeSingle();
  if (account?.phone === e164 && account.phone_verified === true) {
    return "account_verified";
  }

  const settings = await readSettings();
  if (!settings || settings.phoneAutoconfirm) return null;

  const { data: authData, error: authError } =
    await admin.auth.admin.getUserById(userId);
  const authUser = authData?.user;
  if (authError || !authUser) return null;
  if (toE164(authUser.phone) !== e164 || !authUser.phone_confirmed_at) {
    return null;
  }

  const { data: lastSend } = await admin
    .from("sms_send_log")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("phone", e164)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastSend) return null;

  return Date.parse(authUser.phone_confirmed_at) >= Date.parse(lastSend.sent_at)
    ? "auth_confirmed_after_send"
    : null;
}

/** Code d'erreur i18n (`signup.errors.*`) pour un refus de Supabase Auth. */
export function otpErrorCode(error: {
  code?: string;
  status?: number;
}): string {
  if (error.status === 429 || error.code === "over_sms_send_rate_limit") {
    return "smsQuotaExceeded";
  }
  // GoTrue répond `otp_expired` (« expired or is invalid ») aux codes
  // erronés, expirés, consommés ou émis pour un autre compte.
  if (error.code === "otp_expired" || error.status === 403) return "otpWrong";
  return "generic";
}

export type VerifyPhoneDeps = {
  admin: AdminClient;
  /**
   * Client anon SANS persistance de session : la session créée par
   * `verifyOtp` n'est jamais écrite dans les cookies du navigateur, même si
   * elle appartient à un autre compte.
   */
  verifier: SupabaseClient<Database>;
  readSettings: () => Promise<AuthPhoneSettings | null>;
};

export async function verifyPhoneCode(
  deps: VerifyPhoneDeps,
  user: PhoneUser,
  e164: string,
  token: string,
): Promise<FinalizeSignupResult> {
  const { data, error } = await deps.verifier.auth.verifyOtp({
    phone: e164,
    token,
    type: "phone_change",
  });

  if (!error) {
    // La session émise par Supabase Auth n'est pas utilisée : la session du
    // navigateur reste celle de l'utilisateur.
    const accessToken = data.session?.access_token;
    if (accessToken) {
      await deps.admin.auth.admin.signOut(accessToken, "local").catch(() => {});
    }
    if (data.user?.id !== user.id) {
      // Code valide, mais émis pour un autre compte qui attendait ce numéro.
      logServerWarning("auth.verify_phone", "otp_other_account", {
        category: "auth",
      });
      return { ok: false, errorCode: "otpWrong" };
    }
    return finalizeSignup(deps.admin, user, e164);
  }

  const proof = await findPhoneProof(
    deps.admin,
    user.id,
    e164,
    deps.readSettings,
  );
  if (proof) {
    logServerWarning("auth.verify_phone", `recovered_${proof}`, {
      category: "auth",
    });
    return finalizeSignup(deps.admin, user, e164);
  }

  const errorCode = otpErrorCode(error);
  if (errorCode === "generic") {
    logServerError("auth.verify_phone", error, { category: "auth" });
  }
  return { ok: false, errorCode };
}

export type RequestPhoneDeps = {
  admin: AdminClient;
  /** Client de la session de l'utilisateur (cookies) : `updateUser`. */
  session: SupabaseClient<Database>;
  readSettings: () => Promise<AuthPhoneSettings | null>;
};

/**
 * Demande l'envoi d'un code pour `e164`. Si le compte a déjà prouvé la
 * possession du numéro (réponse perdue), aucun SMS n'est envoyé ni compté :
 * Supabase Auth n'en enverrait pas pour un numéro déjà confirmé, et un
 * nouvel enregistrement d'envoi effacerait la preuve.
 */
export async function requestPhoneCode(
  deps: RequestPhoneDeps,
  user: PhoneUser,
  e164: string,
  ip: string | null,
): Promise<PhoneActionResult> {
  const { admin } = deps;

  const { data: dup } = await admin
    .from("users")
    .select("id")
    .eq("phone", e164)
    .neq("id", user.id)
    .maybeSingle();
  if (dup) return { ok: false, errorCode: "phoneAlreadyUsed" };

  // Anti-abus : quota par numéro (5/24h) et par IP (10/h).
  const { data: allowed } = await admin.rpc("check_sms_send_quota", {
    p_phone: e164,
    // Argument généré non nullable, alors que la fonction traite NULL.
    p_ip: ip as string,
  });
  if (allowed === false) {
    logServerWarning("auth.send_phone_otp", "sms_quota_exceeded", {
      category: "quota",
    });
    return { ok: false, errorCode: "smsQuotaExceeded" };
  }

  if (await findPhoneProof(admin, user.id, e164, deps.readSettings)) {
    return { ok: true };
  }

  const { error } = await deps.session.auth.updateUser({ phone: e164 });
  if (error) {
    logServerError("auth.send_phone_otp", error, { category: "auth" });
    return { ok: false, errorCode: mapPhoneUpdateError(error) };
  }

  const { error: logError } = await admin
    .from("sms_send_log")
    .insert({ phone: e164, ip, user_id: user.id });
  if (logError) {
    logServerError("auth.send_phone_otp.log", logError);
  }
  return { ok: true };
}

function mapPhoneUpdateError(error: {
  code?: string;
  status?: number;
  message?: string;
}): string {
  if (error.status === 429 || error.code === "over_sms_send_rate_limit") {
    return "smsQuotaExceeded";
  }
  if (error.code === "phone_exists") return "phoneAlreadyUsed";
  if (error.code === "validation_failed") return "phoneInvalid";
  const m = (error.message ?? "").toLowerCase();
  if (
    error.code === "sms_send_failed" ||
    ((m.includes("sms") || m.includes("phone")) &&
      (m.includes("provider") ||
        m.includes("disabled") ||
        m.includes("not enabled") ||
        m.includes("not configured")))
  ) {
    return "smsProviderMissing";
  }
  if (m.includes("phone") || m.includes("mobile")) return "phoneInvalid";
  return "generic";
}
