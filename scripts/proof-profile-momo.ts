/**
 * Preuve E2E T6 — Mobile Money : preuve de possession (OTP SMS) +
 * validation admin (SRS §11.5 Option D).
 *
 * Méthode (même philosophie que T0-T5) :
 *  - Sessions RÉELLES (signInWithPassword via @supabase/ssr) :
 *      P = candidat (flux complet A→D de la preuve OTP) ;
 *      W = candidat (revue admin approve / reject) ;
 *      R = admin_ops (revue) ;
 *      N = candidat sans numéro (garde d'émission).
 *  - Sans TWILIO_*, l'émission est en « sandbox » : la route logge le
 *    code en console ET ne le renvoie jamais — la preuve pilote la
 *    ligne `momo_otp` (hash 64 hex via le RPC SECURITY DEFINER
 *    `momo_issue_otp`, appelé avec la SESSION RÉELLE du candidat, donc
 *    `auth.uid()` = le candidat) et vérifie le reste par la route
 *    publique `POST /api/profile/momo/otp/verify`. Le code en clair
 *    n'est jamais écrit ici, ni loggé : seul son hash SHA-256.
 *
 * Assertions :
 *  A. PUT /api/profile/payment → RPC `candidate_update_momo` (pas
 *     d'update direct) + réinitialisation de l'état (none).
 *  B. Guard du trigger : le candidat qui force lui-même
 *     `momo_verified=true` / `momo_otp_status='verified'` est rétabli.
 *  C. Émission OTP : sans numéro → 400 `otp_not_configured` ; avec
 *     numéro → 200 (sandbox) + statut `awaiting` + 1 ligne `momo_otp`
 *     (hash 64 hex, jamais le code).
 *  D. Vérification OTP : mauvaise numéro → `otp_number_mismatch` ;
 *     2 codes faux → `otp_wrong` (attempts comptés) ; 3e faux →
 *     `otp_max_attempts` + statut `rejected` + motif `otp_max_attempts`
 *     + ligne purgée ; sans code actif → `otp_not_requested` ;
 *     code correct → `verified` (mais `momo_verified` reste `false`).
 *  E. Revue admin : sans preuve → 400 `otp_proof_required` ; approve
 *     (preuve verified) → `momo_verified=true` + `verified_by` = l'admin
 *     RÉEL + `verified_at` + notification `momo_status` + audit
 *     `approve_momo` ; reject (motif requis) → motif écrit + audit
 *     `reject_momo` ; reject sans motif → 400 (Zod).
 *  F. Rôles : candidat sur /api/admin/momo (GET et POST) → 403 ;
 *     admin_ops GET → 200 + liste.
 *  G. Page /profile/payment : carte « Vérifié » après l'approve.
 *  Nettoyage complet en fin de course.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { createHash } from "node:crypto";

type DB = SupabaseClient<Database>;

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROOF_PASSWORD = "Proof-T6-88!";
const PROOF_METADATA = { proofT6: true };
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };

function makeCookieJar(): {
  jar: Map<string, string>;
  getAll(): CookieEntry[];
  setAll(entries: { name: string; value: string; options?: unknown }[]): void;
} {
  const jar = new Map<string, string>();
  return {
    jar,
    getAll() {
      return [...jar.entries()].map(([name, value]) => ({ name, value }));
    },
    setAll(entries: { name: string; value: string; options?: unknown }[]) {
      for (const { name, value } of entries) {
        if (value === "" || value === "0") jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

async function realClientFor(
  email: string,
): Promise<{ client: DB; cookies: CookieEntry[] }> {
  const jar = makeCookieJar();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
    auth: { autoRefreshToken: false },
  }) as DB;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  }
  const {
    data: { user: fromCookie },
  } = await client.auth.getUser();
  if (!fromCookie) throw new Error("session illisible depuis le cookie");
  return { client, cookies: jar.getAll() };
}

function cookieHeader(entries: CookieEntry[]): string {
  return entries.map((c) => `${c.name}=${c.value}`).join("; ");
}

// ─── Asserts ─────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${name}${
      detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""
    }`,
  );
}

// ─── Seed / cleanup ──────────────────────────────────────────────
interface ProofUser {
  authUserId: string;
  profileId: string | null;
  email: string;
}

async function createProofUser(
  email: string,
  role: "candidate" | "admin_ops",
  withProfile: boolean,
  momoNumber: string | null,
): Promise<ProofUser> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_METADATA,
    app_metadata: { role },
  });
  if (error || !created.user) {
    throw new Error(`user creation failed: ${error?.message}`);
  }
  const authUserId = created.user.id;

  const { error: rowsErr } = await serviceClient.from("users").insert({
    id: authUserId,
    email,
    role,
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  let profileId: string | null = null;
  if (withProfile) {
    const { data: profile, error: profileErr } = await serviceClient
      .from("candidate_profiles")
      .insert({
        user_id: authUserId,
        first_name: "Mom",
        last_name: "T6",
        date_of_birth: "1996-05-05",
        city: "Douala",
        quartier: "Bonanjo",
        momo_provider: "mtn",
        momo_number: momoNumber,
        momo_account_name: null,
        momo_verified: false,
        momo_otp_status: "none",
        onboarding_step: 4,
        onboarding_status: "completed",
        profile_completion_pct: 60,
        sandbox_level: 0,
      })
      .select("id")
      .single();
    if (profileErr || !profile) {
      throw new Error(`profile insert: ${profileErr?.message}`);
    }
    profileId = profile.id;
  }
  return { authUserId, profileId, email };
}

async function cleanUser(c: ProofUser): Promise<void> {
  if (c.profileId) {
    await serviceClient.from("momo_otp").delete().eq("profile_id", c.profileId);
    await serviceClient
      .from("audit_logs")
      .delete()
      .eq("resource_id", c.profileId);
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .eq("id", c.profileId);
  }
  await serviceClient
    .from("notifications")
    .delete()
    .eq("user_id", c.authUserId);
  await serviceClient.from("users").delete().eq("id", c.authUserId);
  await serviceClient.auth.admin.deleteUser(c.authUserId).catch(() => {});
}

async function readProfile(
  profileId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .select(
      "momo_provider, momo_number, momo_account_name, momo_verified, momo_name_match, momo_verified_by, momo_verified_at, momo_otp_status, momo_reject_reason",
    )
    .eq("id", profileId)
    .single();
  if (error) throw new Error(`relecture profil : ${error.message}`);
  return data as unknown as Record<string, unknown>;
}

async function readOtpRow(profileId: string): Promise<{
  token_hash: string;
  attempts: number;
  expires_at: string;
} | null> {
  const { data, error } = await serviceClient
    .from("momo_otp")
    .select("token_hash, attempts, expires_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`lecture momo_otp : ${error.message}`);
  return (
    (data as {
      token_hash: string;
      attempts: number;
      expires_at: string;
    } | null) ?? null
  );
}

// ─── Helpers API ─────────────────────────────────────────────────
async function api(
  url: string,
  method: string,
  cookies: CookieEntry[],
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${APP_URL}${url}`, {
    method,
    headers: {
      Cookie: cookieHeader(cookies),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Ré-émission pilotée : RPC `momo_issue_otp` avec la SESSION RÉELLE
 *  du candidat (auth.uid() = lui) — le hash connaisse à la preuve (le
 *  code en clair n'est JAMAIS stocké / loggé / renvoyé). */
async function pilotIssueOtp(client: DB, token: string): Promise<void> {
  const { error } = await client.rpc("momo_issue_otp", {
    p_token_hash: hashToken(token),
    p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`momo_issue_otp : ${error.message}`);
}

// ─── Scénario ────────────────────────────────────────────────────
async function main() {
  console.log("── Preuve T6 — Mobile Money OTP + validation admin ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/profile/payment`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    serverUp = [200, 302, 307, 308, 401, 500].includes(probe.status);
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Le serveur dev n'est pas accessible sur ${APP_URL}. ` +
        "Preuve E2E ignorée (les tests unitaires tests/momo.test.ts " +
        "couvrent lib/momo-otp.ts + les 3 schemas Zod).",
    );
    return;
  }

  // Nettoyage des preuves T6 précédentes.
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT6 === true,
  );
  if (marked.length > 0) {
    const ids = marked.map((u) => u.id);
    const { data: profiles } = await serviceClient
      .from("candidate_profiles")
      .select("id")
      .in("user_id", ids);
    const pids = (profiles ?? []).map((p) => p.id as string);
    if (pids.length > 0) {
      await serviceClient.from("momo_otp").delete().in("profile_id", pids);
      await serviceClient.from("audit_logs").delete().in("resource_id", pids);
    }
    await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
    await serviceClient.from("users").delete().in("id", ids);
    for (const id of ids) {
      await serviceClient.auth.admin.deleteUser(id).catch(() => {});
    }
    const { data: notifs } = await serviceClient
      .from("notifications")
      .select("id")
      .in("user_id", ids);
    if (notifs?.length) {
      await serviceClient
        .from("notifications")
        .delete()
        .in(
          "id",
          notifs.map((n) => n.id),
        );
    }
    console.log(
      `Nettoyage préalable : ${marked.length} compte(s) de preuve supprimés.`,
    );
  }

  const suffix = Date.now();
  const candP = await createProofUser(
    `t6-proof-p+${suffix}@proof.easyjob.cm`,
    "candidate",
    true,
    "699111222",
  );
  const candW = await createProofUser(
    `t6-proof-w+${suffix}@proof.easyjob.cm`,
    "candidate",
    true,
    "655444333",
  );
  const candR = await createProofUser(
    `t6-proof-r+${suffix}@proof.easyjob.cm`,
    "admin_ops",
    false,
    null,
  );
  const candN = await createProofUser(
    `t6-proof-n+${suffix}@proof.easyjob.cm`,
    "candidate",
    true,
    null, // sans numéro → garde `not configured`
  );

  const { client: clientP, cookies: cookiesP } = await realClientFor(
    candP.email,
  );
  const { client: clientW, cookies: cookiesW } = await realClientFor(
    candW.email,
  );
  const { cookies: cookiesR } = await realClientFor(candR.email);
  const { cookies: cookiesN } = await realClientFor(candN.email);

  try {
    // ── A. PUT /api/profile/payment via RPC candidat ──────────────
    const putPayment = await api("/api/profile/payment", "PUT", cookiesP, {
      momo_provider: "orange",
      momo_number: "612345678",
      momo_account_name: "Jean Dupont",
    });
    const profA = await readProfile(candP.profileId as string);
    report(
      "A1 : PUT /api/profile/payment → 200 {ok} (RPC SECURITY DEFINER, pas d'update direct)",
      putPayment.status === 200 && putPayment.json.ok === true,
      { status: putPayment.status },
    );
    report(
      "A2 : profil écrit (orange / 612345678 / Jean Dupont) + état réinitialisé (none)",
      profA?.momo_provider === "orange" &&
        profA?.momo_number === "612345678" &&
        profA?.momo_account_name === "Jean Dupont" &&
        profA?.momo_otp_status === "none" &&
        profA?.momo_verified === false &&
        profA?.momo_reject_reason === null,
      profA,
    );

    // ── B. Guard du trigger (protection des 6 colonnes) ───────────
    const { error: directErr } = await clientP
      .from("candidate_profiles")
      .update({ momo_verified: true, momo_otp_status: "verified" })
      .eq("id", candP.profileId as string);
    if (directErr) throw new Error(`update direct : ${directErr.message}`);
    const profB = await readProfile(candP.profileId as string);
    report(
      "B1 : candidat qui force lui-même momo_verified=true / otp_status=verified → RÉTABLI (false / none)",
      profB?.momo_verified === false && profB?.momo_otp_status === "none",
      {
        momo_verified: profB?.momo_verified,
        momo_otp_status: profB?.momo_otp_status,
      },
    );

    // ── C. Émission OTP ───────────────────────────────────────────
    const postOtpNN = await api("/api/profile/momo/otp", "POST", cookiesN);
    report(
      "C1 : POST /momo/otp SANS numéro enregistré → 400 code otp_not_configured",
      postOtpNN.status === 400 && postOtpNN.json.code === "otp_not_configured",
      { status: postOtpNN.status },
    );

    const postOtpP = await api("/api/profile/momo/otp", "POST", cookiesP);
    const profC1 = await readProfile(candP.profileId as string);
    report(
      "C2 : POST /momo/otp (P, avec numéro) → 200 sandbox + statut awaiting (le code est loggé côté serveur, jamais renvoyé)",
      postOtpP.status === 200 &&
        postOtpP.json.channel === "sandbox" &&
        profC1?.momo_otp_status === "awaiting",
      { status: postOtpP.status, channel: postOtpP.json.channel },
    );

    // Ligne pilotée (hash connu) pour tester la machine d'état complète :
    // le RPC `momo_issue_otp` via la SESSION RÉELLE de P remplace la
    // ligne du sandbox par un hash que la preuve maîtise.
    const tokenGoodP = "111222";
    await pilotIssueOtp(clientP, tokenGoodP);
    const otpRowC = await readOtpRow(candP.profileId as string);
    report(
      "C3 : ligne momo_otp = 1 par profil, hash SHA-256 64 hex (jamais le code), attempts=0",
      otpRowC !== null &&
        otpRowC.token_hash === hashToken(tokenGoodP) &&
        otpRowC.attempts === 0,
      {
        hashLen: otpRowC?.token_hash.length,
        attempts: otpRowC?.attempts,
      },
    );

    // ── D. Vérification OTP (machine d'état complète, profil P) ──
    const v1 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: "999000",
      number: "655444333", // ≠ 612345678 (enregistré)
    });
    report(
      "D1 : verify avec le MAUVAIS numéro → 400 otp_number_mismatch (un code ne prouve que son propre numéro)",
      v1.status === 400 && v1.json.code === "otp_number_mismatch",
      { status: v1.status },
    );

    const v2 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: "999001",
      number: "612345678",
    });
    const otpRowD2 = await readOtpRow(candP.profileId as string);
    const v3 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: "999002",
      number: "612345678",
    });
    const otpRowD3 = await readOtpRow(candP.profileId as string);
    const profD2 = await readProfile(candP.profileId as string);
    report(
      "D2 : 2 codes faux → 400 otp_wrong ; attempts 1→2 ; la ligne vit encore (statut awaiting)",
      v2.status === 400 &&
        v2.json.code === "otp_wrong" &&
        v3.status === 400 &&
        v3.json.code === "otp_wrong" &&
        otpRowD2?.attempts === 1 &&
        otpRowD3?.attempts === 2 &&
        profD2?.momo_otp_status === "awaiting",
      {
        status2: v2.status,
        attempts: [otpRowD2?.attempts, otpRowD3?.attempts],
        status: profD2?.momo_otp_status,
      },
    );

    const v4 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: "999003",
      number: "612345678",
    });
    const profD3 = await readProfile(candP.profileId as string);
    const otpRowD4 = await readOtpRow(candP.profileId as string);
    report(
      "D3 : 3e code faux → 400 otp_max_attempts ; statut « rejected » ; motif otp_max_attempts ; ligne purgée",
      v4.status === 400 &&
        v4.json.code === "otp_max_attempts" &&
        profD3?.momo_otp_status === "rejected" &&
        profD3?.momo_reject_reason === "otp_max_attempts" &&
        otpRowD4 === null,
      { status: v4.status },
    );

    const v5 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: "999004",
      number: "612345678",
    });
    report(
      "D4 : verify après rejet (aucun code actif) → 400 otp_not_requested",
      v5.status === 400 && v5.json.code === "otp_not_requested",
      { status: v5.status },
    );

    // Ré-émission pilotée + code correct → verified.
    const tokenReP = "333444";
    await pilotIssueOtp(clientP, tokenReP);
    const v6 = await api("/api/profile/momo/otp/verify", "POST", cookiesP, {
      token: tokenReP,
      number: "612345678",
    });
    const profE = await readProfile(candP.profileId as string);
    const otpRowE = await readOtpRow(candP.profileId as string);
    report(
      "D5 : ré-émission + code correct → 200 {status: verified} ; statut « verified » ; ligne purgée ; momo_verified TOUJOURS false (l'admin n'a pas revu)",
      v6.status === 200 &&
        v6.json.status === "verified" &&
        profE?.momo_otp_status === "verified" &&
        otpRowE === null &&
        profE?.momo_verified === false,
      { status: v6.status, momo_verified: profE?.momo_verified },
    );

    // ── E. Revue admin (R = admin_ops) ────────────────────────────
    // E1 : sans preuve → refusé.
    const postEarly = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId,
      action: "approve",
    });
    report(
      "E1 : admin approve SANS preuve OTP (W au statut none) → 400 otp_proof_required",
      postEarly.status === 400 && postEarly.json.code === "otp_proof_required",
      { status: postEarly.status },
    );

    // E2 : reject sans motif → 400 (Zod), et W n'est pas touché.
    const postNoReason = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "reject",
    });
    report(
      "E2 : admin reject SANS motif → 400 (momoRejectReasonRequired par Zod)",
      postNoReason.status === 400,
      { status: postNoReason.status },
    );

    // W passe la preuve (numéro seed 655444333 toujours présent).
    const tokenGoodW = "555666";
    await pilotIssueOtp(clientW, tokenGoodW);
    const vW = await api("/api/profile/momo/otp/verify", "POST", cookiesW, {
      token: tokenGoodW,
      number: "655444333",
    });

    // E3 : reject avec motif (W est à « verified »).
    const postReject = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "reject",
      rejection_reason: "Le nom du compte MoMo ne correspond pas à la CNI",
    });
    const profF = await readProfile(candW.profileId as string);
    report(
      "E3 : reject avec motif (preuve verified) → 200 ; momo_verified=false ; name_match=false ; motif écrit",
      vW.status === 200 &&
        postReject.status === 200 &&
        postReject.json.ok === true &&
        profF?.momo_verified === false &&
        profF?.momo_name_match === false &&
        profF?.momo_reject_reason ===
          "Le nom du compte MoMo ne correspond pas à la CNI",
      profF,
    );

    const { data: notifF, error: notifErr } = await serviceClient
      .from("notifications")
      .select("notification_type, title")
      .eq("user_id", candW.authUserId);
    const { data: auditF, error: auditErr } = await serviceClient
      .from("audit_logs")
      .select("actor_id, actor_role, action, resource_type, resource_id")
      .eq("resource_id", candW.profileId as string);
    report(
      "E4 : notification momo_status au candidat W + audit reject_momo (actor = l'admin R RÉEL)",
      !notifErr &&
        !auditErr &&
        (notifF ?? []).some(
          (n: { notification_type: string }) =>
            n.notification_type === "momo_status",
        ) &&
        (auditF ?? []).some(
          (a) =>
            a.actor_id === candR.authUserId &&
            a.actor_role === "admin_ops" &&
            a.action === "reject_momo",
        ),
      { notif: notifF, audit: auditF },
    );

    // E5 : re-approve (W toujours « verified » — le motif de rejet ne
    // remette pas le statut preuve à zéro : l'admin re-voit).
    const postApprove = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "approve",
    });
    const profG = await readProfile(candW.profileId as string);
    report(
      "E5 : approve → 200 ; momo_verified=true ; name_match=true ; verified_by=R ; verified_at posé ; motif effacé",
      postApprove.status === 200 &&
        postApprove.json.ok === true &&
        profG?.momo_verified === true &&
        profG?.momo_name_match === true &&
        profG?.momo_verified_by === candR.authUserId &&
        profG?.momo_verified_at != null &&
        profG?.momo_reject_reason === null,
      profG,
    );

    // ── F. Rôles sur l'API admin ──────────────────────────────────
    const postNonAdmin = await api("/api/admin/momo", "POST", cookiesP, {
      profile_id: candP.profileId as string,
      action: "approve",
    });
    const getNonAdmin = await fetch(`${APP_URL}/api/admin/momo`, {
      headers: { Cookie: cookieHeader(cookiesP) },
      cache: "no-store",
    });
    const getAdmin = await fetch(`${APP_URL}/api/admin/momo`, {
      headers: { Cookie: cookieHeader(cookiesR) },
      cache: "no-store",
    });
    const getJson = (await getAdmin.json().catch(() => ({}))) as {
      profiles?: Array<Record<string, unknown>>;
    };
    report(
      "F1 : candidat (rôle candidat) sur POST /api/admin/momo → 403 ; GET → 403",
      postNonAdmin.status === 403 && getNonAdmin.status === 403,
      { status: getNonAdmin.status },
    );
    report(
      "F2 : admin_ops GET /api/admin/momo → 200 + la liste porte le profil W (numéro en clair pour l'admin)",
      getAdmin.status === 200 &&
        (getJson.profiles ?? []).some(
          (p) =>
            (p.id as string) === (candW.profileId as string) &&
            (p.momo_number as string) === "655444333",
        ),
      { status: getAdmin.status },
    );

    // ── G. Page /profile/payment : carte « Vérifié » ──────────────
    const resPageW = await fetch(`${APP_URL}/profile/payment`, {
      headers: { Cookie: cookieHeader(cookiesW), Accept: "text/html" },
      cache: "no-store",
    });
    const htmlW = await resPageW.text();
    report(
      "G1 : GET /profile/payment (W approuvé) → 200 + carte « Vérifié »",
      resPageW.status === 200 && htmlW.includes("Vérifié"),
      { status: resPageW.status },
    );
  } finally {
    await cleanUser(candP);
    await cleanUser(candW);
    await cleanUser(candR);
    await cleanUser(candN);
    console.log(
      "Nettoyage : momo_otp, notifications, audit, profils, comptes.",
    );
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0
        ? "Mobile Money OTP + validation admin opérationnel (T6)"
        : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
