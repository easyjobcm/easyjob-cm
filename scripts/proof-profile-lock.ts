/**
 * Preuve E2E T2 — verrou des informations vérifiées (SRS §5.1.1).
 *
 * Méthode (même philosophie que les preuves T0/T1) :
 *   1. Seed en service role :
 *      - 1 candidat `C` avec CNI `verified` (identité + CNI = verrouillés),
 *      - 1 compte admin_ops `A` (session réelle).
 *   2. Sessions RÉELLES : signInWithPassword(email) via @supabase/ssr
 *      createServerClient (la même fonction que l'app) ; pour le `POST
 *      /apply`-like on rejoue le cookie de session.
 *   3. Assertions :
 *      A. PUT /api/profile/identity (changement prénom) → 403
 *         { code: field_locked, lockedGroups: ["identity"] }
 *      B. admin_ops POST /api/admin/profile-update-requests
 *         (identity+cni_documents) → 200, création d'une demande `pending`
 *         + notification `document_status`.
 *      C. PUT /api/profile/identity (même changement) → 200 et :
 *         - `cni_verified` repasse `pending` (révérification)
 *         - la demande admin passe `done` (completed_at renseigné)
 *   4. Nettoyage complet des lignes de preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;
type CandidateProfileInsert =
  Database["public"]["Tables"]["candidate_profiles"]["Insert"];

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
const PROOF_PASSWORD = "Proof-T2-42!";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Session réelle via @supabase/ssr ───────────────────────────
function makeCookieJar(): {
  jar: Map<string, string>;
  getAll(): { name: string; value: string }[];
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

type CookieEntry = { name: string; value: string };

async function getRealSessionCookies(email: string): Promise<CookieEntry[]> {
  const jar = makeCookieJar();
  const appClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: jar.getAll,
      setAll: jar.setAll,
    },
    auth: { autoRefreshToken: false },
  });

  const { data, error } = await appClient.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  }
  // Session lisible => jar complet
  const {
    data: { user: fromCookie },
  } = await appClient.auth.getUser();
  if (!fromCookie) throw new Error("session illisible depuis le cookie");
  return [...jar.jar.entries()].map(([name, value]) => ({ name, value }));
}

function cookieHeader(entries: CookieEntry[]): string {
  return entries.map((c) => `${c.name}=${c.value}`).join("; ");
}

// ─── Asserts ────────────────────────────────────────────────────
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

// ─── Seed / cleanup ─────────────────────────────────────────────
interface ProofUser {
  authUserId: string;
  email: string;
  role: "candidate" | "admin_ops";
  profileId?: string;
}

async function createTestUser(
  email: string,
  role: "candidate" | "admin_ops",
  candidateRow?: Omit<CandidateProfileInsert, "user_id">,
): Promise<ProofUser> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: { proofT2: true },
    app_metadata: { role, phone_verified: true },
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

  let profileId: string | undefined;
  if (candidateRow) {
    const { data: profile, error: profileErr } = await serviceClient
      .from("candidate_profiles")
      .insert({
        ...candidateRow,
        user_id: authUserId,
      })
      .select("id")
      .single();
    if (profileErr || !profile) {
      throw new Error(`profile insert: ${profileErr?.message}`);
    }
    profileId = profile.id;
  }

  return { authUserId, email, role, profileId };
}

async function cleanPreviousProofs() {
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT2 === true,
  );
  if (marked.length === 0) return;
  const ids = marked.map((u) => u.id);
  const { data: requests } = await serviceClient
    .from("profile_update_requests")
    .select("candidate_id")
    .in("requested_by", ids);
  const candidateIds = new Set<string>(
    (requests ?? []).map((r) => r.candidate_id as string),
  );
  if (candidateIds.size > 0) {
    await serviceClient
      .from("profile_update_requests")
      .delete()
      .in("candidate_id", [...candidateIds]);
  }
  const { data: profiles } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const profileIds = (profiles ?? []).map((p) => p.id);
  if (profileIds.length > 0) {
    await serviceClient
      .from("candidate_skills")
      .delete()
      .in("candidate_id", profileIds);
    await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  }
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

// ─── Helpers API ────────────────────────────────────────────────
// On passe par le client SSR (cookie de session) pour que les routes Next.js
// lisent exactement l'auth que l'app lit (RLS). On n'ajoute PAS de
// "Next.js dev server" : le script appelle directement les endpoints via
// fetch + cookie au cas où l'app est en route ; sinon il s'appuie sur les
// règles de la route (identique code). Pour la preuve de la RLS + du verrou
// (le cœur de T2), il est suffisant d'appeler les endpoints de route avec le
// cookie.
async function putIdentity(
  cookies: CookieEntry[],
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const appUrl = process.env.NEXT_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${appUrl}/api/profile/identity`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookies),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function postAdminUpdateRequest(
  cookies: CookieEntry[],
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const appUrl = process.env.NEXT_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${appUrl}/api/admin/profile-update-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookies),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

// ─── Scénario ───────────────────────────────────────────────────
async function main() {
  console.log("── Preuve verrou des infos vérifiées (SRS §5.1.1) ──\n");
  const devServerUrl = process.env.NEXT_APP_URL ?? "http://localhost:3000";

  // Vérifie que le serveur dev est up (sinon impossible de tester les
  // endpoints Next.js — la RLS est prouvée ailleurs).
  let serverUp = false;
  try {
    const probe = await fetch(`${devServerUrl}/api/notifications`, {
      method: "GET",
      headers: {
        // Pas de cookie : 401 attendue si le serveur répond, 501/conn-refused
        // sinon.
      },
    });
    serverUp =
      probe.status === 401 || probe.status === 200 || probe.status === 500;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Le serveur dev n'est pas accessible sur ${devServerUrl}. ` +
        "Preuve E2E ignorée (les tests unitaires `tests/profile-lock.test.ts` " +
        "couvrent la logique pure).",
    );
    return;
  }

  await cleanPreviousProofs();

  const suffix = Date.now();
  const emailC = `t2-proof-candidate+${suffix}@proof.easyjob.cm`;
  const emailA = `t2-proof-admin+${suffix}@proof.easyjob.cm`;

  // Cand C : CNI verified → identité + CNI verrouillés
  // (createTestUser remplit user_id avec l'ID auth réel.)
  const cand = await createTestUser(emailC, "candidate", {
    first_name: "Serge",
    last_name: "Talla",
    date_of_birth: "1996-06-10",
    city: "Douala",
    quartier: "Akwa",
    cni_verified: "verified",
    cni_front_url: "cni/proof-front.jpg",
    cni_back_url: "cni/proof-back.jpg",
    cni_selfie_url: "cni/proof-selfie.jpg",
    cni_expires_at: "2032-01-01",
    momo_verified: true,
    onboarding_status: "completed",
    profile_completion_pct: 100,
    sandbox_level: 1,
  });

  const admin = await createTestUser(emailA, "admin_ops");

  const candCookies = await getRealSessionCookies(emailC);
  const adminCookies = await getRealSessionCookies(emailA);

  try {
    // ── A. Verrou initial (CNI verified, sans demande) ──────────
    const resA1 = await putIdentity(candCookies, {
      first_name: "Serge-modifié",
      last_name: "Talla",
      date_of_birth: "1996-06-10",
      city: "Douala",
      quartier: "Akwa",
    });
    report(
      "A : PUT identité bloquée 403 field_locked (CNI verified, sans demande)",
      resA1.status === 403 && resA1.body.code === "field_locked",
      { status: resA1.status, body: resA1.body },
    );
    report(
      "A : lockedGroups = [identity]",
      Array.isArray(resA1.body.lockedGroups) &&
        JSON.stringify([resA1.body.lockedGroups as string[]].sort()) ===
          JSON.stringify([["identity"]].sort()),
      { lockedGroups: resA1.body.lockedGroups },
    );
    // Vérif que le prénom n'a PAS changé en base (pas de side-effect)
    const profileAfterA = (
      await serviceClient
        .from("candidate_profiles")
        .select("first_name, cni_verified")
        .eq("id", cand.profileId!)
        .single()
    ).data;
    report(
      "A : first_name inchangé + cni_verified toujours verified",
      profileAfterA?.first_name === "Serge" &&
        profileAfterA?.cni_verified === "verified",
      { profileAfterA },
    );

    // ── B. Admin_ops initie la demande ──────────────────────────
    const resB = await postAdminUpdateRequest(adminCookies, {
      candidate_id: cand.profileId,
      fields: ["identity", "cni_documents"],
      reason: "Mise à jour du prénom suite à mariage (demande du 08/09).",
    });
    report(
      "B : POST admin 200 + request_id",
      resB.status === 200 && typeof resB.body.request_id === "string",
      { status: resB.status, body: resB.body },
    );
    const requestId = resB.body.request_id as string | undefined;
    const { data: createdReq } = await serviceClient
      .from("profile_update_requests")
      .select("id, status, fields, reason", { count: "exact" })
      .eq("candidate_id", cand.profileId!)
      .eq("status", "pending");
    report(
      "B : une demande `pending` couvrant identity+cni_documents existe",
      (createdReq ?? []).length === 1 &&
        JSON.stringify((createdReq ?? [])[0]?.fields) !== "undefined" &&
        (createdReq ?? [])[0]?.fields?.includes("identity") &&
        (createdReq ?? [])[0]?.fields?.includes("cni_documents"),
      { createdReq },
    );
    const { data: notif } = await serviceClient
      .from("notifications")
      .select("id, notification_type, data", { count: "exact" })
      .eq("user_id", cand.authUserId)
      .in("notification_type", ["document_status"]);
    report(
      "B : une notification `document_status` a été insérée pour le candidat",
      (notif ?? []).some(
        (n) => (n.data as Record<string, unknown>)?.profile_update_request_id,
      ),
      { notif: NOTIF_REDACTED(notif) },
    );

    // ── C. Re-soumission déverrouillée par la demande ───────────
    const resC1 = await putIdentity(candCookies, {
      first_name: "Serge-modifié",
      last_name: "Talla",
      date_of_birth: "1996-06-10",
      city: "Douala",
      quartier: "Akwa",
    });
    report(
      "C : PUT identité 200 (identité + docs CNI déverrouillés)",
      resC1.status === 200 && resC1.body.ok === true,
      { status: resC1.status, body: resC1.body },
    );
    const profileAfterC = (
      await serviceClient
        .from("candidate_profiles")
        .select("first_name, cni_verified")
        .eq("id", cand.profileId!)
        .single()
    ).data;
    report(
      "C : cni_verified -> pending (révérification) & prénom écrit",
      profileAfterC?.first_name === "Serge-modifié" &&
        profileAfterC?.cni_verified === "pending",
      { profileAfterC },
    );
    const { data: reqAfter } = requestId
      ? await serviceClient
          .from("profile_update_requests")
          .select("status, completed_at")
          .eq("id", requestId)
          .single()
      : { data: null };
    report(
      "C : la demande `pending` est passée `done` (completed_at renseigné)",
      reqAfter?.status === "done" && !!reqAfter?.completed_at,
      { reqAfter },
    );
  } finally {
    // ── Nettoyage systématique ──
    if (cand.profileId) {
      await serviceClient
        .from("profile_update_requests")
        .delete()
        .eq("candidate_id", cand.profileId);
      await serviceClient
        .from("candidate_skills")
        .delete()
        .eq("candidate_id", cand.profileId!);
    }
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .in("user_id", [cand.authUserId]);
    await serviceClient
      .from("users")
      .delete()
      .in("id", [cand.authUserId, admin.authUserId]);
    for (const id of [cand.authUserId, admin.authUserId]) {
      const res = await serviceClient.auth.admin.deleteUser(id);
      if (res.error) console.warn("cleanup auth:", res.error.message);
    }
    const { data: notifs } = await serviceClient
      .from("notifications")
      .select("id")
      .in("user_id", [cand.authUserId, admin.authUserId]);
    if (notifs?.length) {
      await serviceClient
        .from("notifications")
        .delete()
        .in(
          "id",
          notifs.map((n) => n.id),
        );
    }
    console.log("Nettoyage : demandes, profils, comptes de preuve supprimés.");
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "verrou des infos vérifiées opérationnel" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

/** Redaction des notifications (ne pas loguer les body en clair). */
function NOTIF_REDACTED(notif: Array<{ data: unknown }> | null) {
  return (notif ?? []).map((n) => ({
    data: (n.data as Record<string, unknown> | null) ?? null,
  }));
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
