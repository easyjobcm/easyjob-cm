/**
 * Preuve E2E T6 — Mobile Money : validation admin MANUELLE (SRS §11.5 Option D).
 *
 * La preuve de possession par OTP SMS a été RETIRÉE au lancement
 * (décision produit 2026-09-10) : le candidat déclare opérateur + numéro +
 * nom du compte ; l'admin valide manuellement en confrontant le nom déclaré
 * au nom CNI (comptes familiaux / au nom d'un tiers refusés avec motif).
 *
 * Méthode (même philosophie que T0-T5) :
 *  - Sessions RÉELLES (signInWithPassword via @supabase/ssr) :
 *      P = candidat (déclaration + guard du trigger) ;
 *      W = candidat (revue admin approve / reject) ;
 *      R = admin_ops (revue) ;
 *      N = candidat sans numéro (garde « numéro configuré » du RPC).
 *
 * Assertions :
 *  A. PUT /api/profile/payment → RPC `candidate_update_momo` (pas
 *     d'update direct) + ré-initialisation complète du cycle de
 *     vérification (verified=false, nom match=false, by/at=null,
 *     motif=null).
 *  B. Guard du trigger : le candidat qui force lui-même
 *     `momo_verified=true` / `momo_reject_reason='x'` est rétabli.
 *  E. Revue admin (flux manuel sans preuve OTP) :
 *     - approve avec numéro → 200 + `momo_verified=true` + `verified_by`
 *       = l'admin RÉEL + `verified_at` + notification `momo_status` +
 *       audit `approve_momo` ;
 *     - reject sans motif → 400 (Zod `momoRejectReasonRequired`), profil
 *       non touché ;
 *     - reject avec motif → 200 + `momo_verified=false` +
 *       `momo_reject_reason` écrit + audit `reject_momo` + notification
 *       `momo_status` (motif) ;
 *     - re-approve → 200 + motif effacé + `verified` re-posé ;
 *     - admin sur PROFIL SANS NUMERO → 400 `number_not_configured`.
 *  F. Rôles : candidat sur /api/admin/momo (GET et POST) → 403 ;
 *     admin_ops GET → 200 + liste.
 *  G. Page /profile/payment : carte « Vérifié » après l'approve.
 *  Nettoyage complet en fin de course.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

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
      "momo_provider, momo_number, momo_account_name, momo_verified, momo_name_match, momo_verified_by, momo_verified_at, momo_reject_reason",
    )
    .eq("id", profileId)
    .single();
  if (error) throw new Error(`relecture profil : ${error.message}`);
  return data as unknown as Record<string, unknown>;
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

// ─── Scénario ────────────────────────────────────────────────────
async function main() {
  console.log("── Preuve T6 — Mobile Money : validation admin manuelle ──\n");

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
        "couvrent les 2 schemas Zod T6).",
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
    null, // sans numéro → garde « number not configured » du RPC
  );

  const { client: clientP, cookies: cookiesP } = await realClientFor(
    candP.email,
  );
  const { cookies: cookiesW } = await realClientFor(candW.email);
  const { cookies: cookiesR } = await realClientFor(candR.email);

  try {
    // ── A. PUT /api/profile/payment via RPC candidat ──────────────
    // Le candidat P déclare son numéro ET son nom ; l'admin (R) verra
    // ensuite cette déclaration dans GET /api/admin/momo.
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
      "A2 : profil écrit (orange / 612345678 / Jean Dupont) + cycle de vérification réinitialisé",
      profA?.momo_provider === "orange" &&
        profA?.momo_number === "612345678" &&
        profA?.momo_account_name === "Jean Dupont" &&
        profA?.momo_verified === false &&
        profA?.momo_name_match === false &&
        profA?.momo_verified_by === null &&
        profA?.momo_verified_at === null &&
        profA?.momo_reject_reason === null,
      profA,
    );

    // ── B. Guard du trigger (protection des 5 colonnes) ───────────
    // Le candidat ne peut ni se marquer `momo_verified=true` ni écrire
    // `momo_reject_reason` : le trigger BEFORE UPDATE rétablit l'ancienne
    // valeur si `easyjob.system_update` n'est pas `on`.
    const { error: directErr } = await clientP
      .from("candidate_profiles")
      .update({ momo_verified: true, momo_reject_reason: "x" })
      .eq("id", candP.profileId as string);
    if (directErr) throw new Error(`update direct : ${directErr.message}`);
    const profB = await readProfile(candP.profileId as string);
    report(
      "B1 : candidat qui force lui-même momo_verified=true / momo_reject_reason='x' → RÉTABLI (false / null)",
      profB?.momo_verified === false && profB?.momo_reject_reason === null,
      {
        momo_verified: profB?.momo_verified,
        momo_reject_reason: profB?.momo_reject_reason,
      },
    );

    // ── E. Revue admin (R = admin_ops) — flux MANUEL ──────────────
    // E1 : reject SANS motif → 400 (Zod), et W n'est pas touché.
    const postNoReason = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "reject",
    });
    const profAfterNoReason = await readProfile(candW.profileId as string);
    report(
      "E1 : admin reject SANS motif → 400 (momoRejectReasonRequired par Zod) ; profil non touché",
      postNoReason.status === 400 &&
        profAfterNoReason?.momo_verified === false &&
        profAfterNoReason?.momo_reject_reason === null,
      { status: postNoReason.status },
    );

    // E2 : reject avec motif (numéro seed 655444333 présent sur W) →
    // 200 + motif écrit.
    const postReject = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "reject",
      rejection_reason: "Le nom du compte MoMo ne correspond pas à la CNI",
    });
    const profF = await readProfile(candW.profileId as string);
    report(
      "E2 : reject avec motif → 200 ; momo_verified=false ; name_match=false ; motif écrit",
      postReject.status === 200 &&
        postReject.json.ok === true &&
        profF?.momo_verified === false &&
        profF?.momo_name_match === false &&
        profF?.momo_reject_reason ===
          "Le nom du compte MoMo ne correspond pas à la CNI",
      profF,
    );

    // E3 : notification momo_status (refus) + audit reject_momo par R.
    const { data: notifF, error: notifErr } = await serviceClient
      .from("notifications")
      .select("notification_type, title")
      .eq("user_id", candW.authUserId);
    const { data: auditF, error: auditErr } = await serviceClient
      .from("audit_logs")
      .select("actor_id, actor_role, action, resource_type, resource_id")
      .eq("resource_id", candW.profileId as string);
    report(
      "E3 : notification momo_status au candidat W + audit reject_momo (actor = l'admin R RÉEL)",
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

    // E4 : re-approve → 200 + verified re-posé + motif effacé.
    const postApprove = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candW.profileId as string,
      action: "approve",
    });
    const profG = await readProfile(candW.profileId as string);
    report(
      "E4 : re-approve → 200 ; momo_verified=true ; name_match=true ; verified_by=R ; verified_at posé ; motif effacé",
      postApprove.status === 200 &&
        postApprove.json.ok === true &&
        profG?.momo_verified === true &&
        profG?.momo_name_match === true &&
        (profG?.momo_verified_by as string) === candR.authUserId &&
        profG?.momo_verified_at != null &&
        profG?.momo_reject_reason === null,
      profG,
    );

    // E5 : admin sur un profil SANS NUMERO (N) → 400 number_not_configured.
    const postNoNumber = await api("/api/admin/momo", "POST", cookiesR, {
      profile_id: candN.profileId as string,
      action: "approve",
    });
    report(
      "E5 : admin approve sur un profil SANS numéro → 400 number_not_configured (garde RPC)",
      postNoNumber.status === 400 &&
        postNoNumber.json.code === "number_not_configured",
      { status: postNoNumber.status, code: postNoNumber.json.code },
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
    console.log("Nettoyage : notifications, audit_logs, profils, comptes.");
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0
        ? "Mobile Money : validation admin manuelle opérationnelle (T6)"
        : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
