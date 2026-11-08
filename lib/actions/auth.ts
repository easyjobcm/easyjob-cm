"use server";

import {
  createAdminClient,
  createClient,
  createStatelessAnonClient,
  readProjectAuthPhoneSettings,
} from "@/lib/supabase/server";
import {
  candidateAccountSchema,
  companyAccountSchema,
  companyInfoSchema,
  emailOtpSchema,
  otpStepSchema,
  phoneStepSchema,
  resendEmailSchema,
} from "@/lib/validations/auth";
import { getClientIp } from "@/lib/utils/request";
import { finalizeSignup } from "@/lib/auth/finalize-signup";
import {
  requestPhoneCode,
  verifyPhoneCode,
} from "@/lib/auth/phone-verification";
import {
  logServerError,
  logServerWarning,
} from "@/lib/observability/server-log";
import type { Database } from "@/lib/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];

// Les arguments de fonction générés sont toujours non nullables, alors que
// check_*_send_quota traitent explicitement p_ip NULL (IP inconnue).
const quotaIp = (ip: string | null) => ip as string;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; errorCode: string };

/* ─────────────────────────── helpers ─────────────────────────── */

/** Mappe un message Supabase Auth vers un code d'erreur i18n connu. */
function mapAuthError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("already registered") || m.includes("already exists"))
    return "emailAlreadyUsed";
  if (m.includes("invalid email")) return "emailInvalid";
  if (m.includes("password")) return "passwordTooShort";
  // Erreurs de configuration SMS/phone provider — à distinguer des erreurs de format.
  if (
    (m.includes("sms") || m.includes("phone")) &&
    (m.includes("provider") ||
      m.includes("disabled") ||
      m.includes("not enabled") ||
      m.includes("not configured") ||
      m.includes("not set up"))
  )
    return "smsProviderMissing";
  // Erreur de format du numéro de téléphone (rejet par Supabase/GoTrue).
  if (m.includes("phone") || m.includes("mobile")) return "phoneInvalid";
  if (m.includes("otp") || m.includes("token")) return "otpWrong";
  return "generic";
}

/* ─────────────────────────── candidate ─────────────────────────── */

export async function signUpCandidateAction(input: {
  email: string;
  password: string;
  acceptTerms: boolean;
  locale: "fr" | "en";
}): Promise<ActionResult<{ userId: string }>> {
  const parsed = candidateAccountSchema.safeParse({
    email: input.email,
    password: input.password,
    acceptTerms: input.acceptTerms,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? "generic",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { role: "candidate", locale: input.locale },
    },
  });
  if (error) {
    logServerError("auth.signup_candidate", error, { category: "auth" });
    return { ok: false, errorCode: mapAuthError(error.message) };
  }

  // Note : le profil candidat n'est créé qu'après vérification du téléphone
  // (verifyPhoneOtpAction) pour éviter les profils orphelins en cas d'abandon.
  // data.user peut être null si l'email existe déjà (anti-énumération Supabase) :
  // dans ce cas un mail de confirmation est quand même renvoyé, on continue.
  return { ok: true, data: { userId: data.user?.id ?? "" } };
}

/* ─────────────────────────── company ─────────────────────────── */

export async function signUpCompanyAction(input: {
  email: string;
  password: string;
  acceptTerms: boolean;
  companyName: string;
  niu: string;
  locale: "fr" | "en";
}): Promise<ActionResult<{ userId: string }>> {
  const accountParsed = companyAccountSchema.safeParse({
    email: input.email,
    password: input.password,
    acceptTerms: input.acceptTerms,
  });
  if (!accountParsed.success) {
    return {
      ok: false,
      errorCode: accountParsed.error.issues[0]?.message ?? "generic",
    };
  }
  const infoParsed = companyInfoSchema.safeParse({
    companyName: input.companyName,
    niu: input.niu,
  });
  if (!infoParsed.success) {
    return {
      ok: false,
      errorCode: infoParsed.error.issues[0]?.message ?? "generic",
    };
  }

  // Pré-check unicité NIU avant de créer l'auth user.
  const admin = createAdminClient();
  const { data: dup } = await admin
    .from("company_profiles")
    .select("user_id")
    .eq("niu", infoParsed.data.niu)
    .maybeSingle();
  if (dup) return { ok: false, errorCode: "niuAlreadyUsed" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: accountParsed.data.email,
    password: accountParsed.data.password,
    options: {
      data: {
        role: "company",
        locale: input.locale,
        // Stashé pour créer company_profiles après vérif OTP uniquement.
        company_name: infoParsed.data.companyName,
        niu: infoParsed.data.niu,
      },
    },
  });
  if (error) {
    logServerError("auth.signup_company", error, { category: "auth" });
    return { ok: false, errorCode: mapAuthError(error.message) };
  }

  // Note : company_profiles est créé après vérification du téléphone.
  // data.user peut être null si l'email existe déjà (anti-énumération Supabase).
  return { ok: true, data: { userId: data.user?.id ?? "" } };
}

/* ─────────────────────────── email OTP ─────────────────────────── */

/**
 * Vérifie le code OTP à 6 chiffres reçu par email après signUp.
 * Confirme l'email côté auth.users et établit la session.
 */
export async function verifyEmailOtpAction(input: {
  email: string;
  token: string;
}): Promise<ActionResult> {
  const parsed = emailOtpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? "otpInvalid",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "signup",
  });
  if (error) {
    logServerError("auth.verify_email_otp", error, { category: "auth" });
    return { ok: false, errorCode: mapAuthError(error.message) };
  }
  return { ok: true };
}

/**
 * Renvoie un nouvel email de confirmation (OTP) pour l'utilisateur courant
 * ou pour l'email passé en paramètre.
 */
export async function resendEmailOtpAction(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = resendEmailSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? "emailInvalid",
    };
  }
  const email = parsed.data.email;

  // Anti-abus : quota par adresse (5/24h) et par IP (20/h).
  const admin = createAdminClient();
  const ip = await getClientIp();
  const { data: allowed } = await admin.rpc("check_email_send_quota", {
    p_email: email,
    p_ip: quotaIp(ip),
  });
  if (allowed === false) {
    logServerWarning("auth.resend_email_otp", "email_quota_exceeded", {
      category: "quota",
    });
    return { ok: false, errorCode: "emailQuotaExceeded" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) {
    logServerError("auth.resend_email_otp", error, { category: "auth" });
    return { ok: false, errorCode: mapAuthError(error.message) };
  }

  await admin.from("email_send_log").insert({ email, ip });
  return { ok: true };
}

/* ─────────────────────── password reset OTP ─────────────────────── */

/**
 * Envoie un code OTP à 6 chiffres par email pour réinitialiser le mot de passe.
 * shouldCreateUser: false → aucun compte créé si l'email est inconnu.
 * Retourne toujours ok:true pour éviter l'énumération des emails.
 */
export async function sendPasswordResetOtpAction(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = resendEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorCode: "emailInvalid" };
  }

  const admin = createAdminClient();
  const ip = await getClientIp();
  const { data: allowed } = await admin.rpc("check_email_send_quota", {
    p_email: parsed.data.email,
    p_ip: quotaIp(ip),
  });
  if (allowed === false) {
    logServerWarning("auth.password_reset_otp", "email_quota_exceeded", {
      category: "quota",
    });
    return { ok: true }; // Anti-énumération : ne pas révéler le quota
  }

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${appUrl}/auth/reset-password` },
  );

  // Anti-énumération : on retourne toujours ok:true
  if (error) {
    logServerError("auth.password_reset_otp", error, { category: "auth" });
  } else {
    await admin.from("email_send_log").insert({ email: parsed.data.email, ip });
  }
  return { ok: true };
}

/**
 * Vérifie le code OTP à 6 chiffres pour réinitialiser le mot de passe.
 * Établit une session active — l'utilisateur peut ensuite appeler updateUser.
 */
export async function verifyPasswordResetOtpAction(input: {
  email: string;
  token: string;
}): Promise<ActionResult> {
  const parsed = emailOtpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? "otpInvalid",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "recovery",
  });
  if (error) {
    logServerError("auth.verify_password_reset_otp", error, {
      category: "auth",
    });
    return { ok: false, errorCode: mapAuthError(error.message) };
  }
  return { ok: true };
}

/* ─────────────────────────── phone OTP ─────────────────────────── */

/**
 * Numéros de test utilisés UNIQUEMENT en dev local.
 * Doivent rester synchronisés avec [auth.sms.test_otp] dans supabase/config.toml.
 * En dev, ces numéros bypassent totalement l'envoi/vérif OTP côté Supabase
 * (le flow `phone_change` ne respecte pas `test_otp` dans la plupart des
 * versions de GoTrue).
 */
const DEV_TEST_PHONES = new Set(["+237600000000", "+237699999999"]);
const DEV_TEST_OTP = "123456";
function isDevTestPhone(e164: string): boolean {
  return process.env.NODE_ENV !== "production" && DEV_TEST_PHONES.has(e164);
}

/**
 * Envoie un OTP SMS pour ajouter/changer le numéro de téléphone
 * de l'utilisateur authentifié. Nécessite une session active.
 * Logique serveur : lib/auth/phone-verification.ts (requestPhoneCode).
 */
export async function sendPhoneOtpAction(input: {
  phone: string;
}): Promise<ActionResult> {
  const parsed = phoneStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errorCode: "phoneInvalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, errorCode: "generic" };

  const e164 = `+237${parsed.data.phone}`;
  const admin = createAdminClient();

  // Dev bypass (hors production) : pas d'appel Supabase, OTP fixe accepté
  // à l'étape suivante. Le contrôle de doublon reste appliqué.
  if (isDevTestPhone(e164)) {
    const { data: dup } = await admin
      .from("users")
      .select("id")
      .eq("phone", e164)
      .neq("id", user.id)
      .maybeSingle();
    if (dup) return { ok: false, errorCode: "phoneAlreadyUsed" };
    return { ok: true };
  }

  return requestPhoneCode(
    {
      admin,
      session: supabase,
      readSettings: readProjectAuthPhoneSettings,
    },
    user,
    e164,
    await getClientIp(),
  );
}

/**
 * Vérifie le code saisi puis finalise l'inscription (finalizeSignup, lot 1).
 * Un échec de vérification ne finalise que sur preuve serveur fiable
 * (H-04) : voir lib/auth/phone-verification.ts.
 */
export async function verifyPhoneOtpAction(input: {
  phone: string;
  token: string;
}): Promise<ActionResult<{ role: UserRole }>> {
  const parsed = otpStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errorCode: "otpInvalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, errorCode: "generic" };

  const e164 = `+237${parsed.data.phone}`;
  const admin = createAdminClient();

  // Dev bypass : on confirme directement via admin sans passer par GoTrue.
  if (isDevTestPhone(e164)) {
    if (parsed.data.token !== DEV_TEST_OTP) {
      return { ok: false, errorCode: "otpWrong" };
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      phone: e164,
      phone_confirm: true,
    });
    if (updErr) {
      logServerError("auth.verify_phone.dev_bypass", updErr);
      return { ok: false, errorCode: "generic" };
    }
    return finalizeSignup(admin, user, e164);
  }

  const result = await verifyPhoneCode(
    {
      admin,
      verifier: createStatelessAnonClient(),
      readSettings: readProjectAuthPhoneSettings,
    },
    user,
    e164,
    parsed.data.token,
  );
  if (result.ok) {
    // Nouveau JWT (app_metadata.phone_verified) pour le middleware. Non
    // bloquant : le middleware relit la base à défaut.
    await supabase.auth.refreshSession().catch(() => undefined);
  }
  return result;
}
