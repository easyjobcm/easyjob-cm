/**
 * Preuve E2E T8.4a — Vue centralisée admin candidats/entreprises.
 *
 * Le flux de vérification CNI/MoMo est déjà prouvé par
 * `proof-admin-cni.ts` / `proof-admin-momo-review.ts`. Cette preuve porte
 * sur ce que T8.4a AJOUTE :
 *  A. Pages SSR :
 *     - admin_ops → /admin/candidates 200 + titre « Candidats » ;
 *     - admin_ops → /admin/companies 200 + titre « Entreprises » ;
 *     - candidat → redirect hors /admin (layout).
 *  B. API GET /api/admin/candidates :
 *     - admin_ops → 200 + liste incluant les 2 candidats preuve, pas
 *       l'entreprise ; champs email/phone/is_active/is_verified/has_photo
 *       présents ;
 *     - admin_support (RO) → 200 ;
 *     - candidat → 403.
 *  C. Recherche ?q= : filtre par e-mail → seul le candidat cible.
 *  D. Suspends/réactivation /api/admin/candidates POST :
 *     - admin_support (RO) → 403 ;
 *     - admin_ops suspend → 200 + users.is_active=false + notification
 *       'system' (Compte suspendu) + audit_logs suspend_user ;
 *     - candidat suspendu → apply 403 code account_suspended ;
 *     - réactivation → 200 + is_active=true + notif « réactivé » ;
 *     - apply après réactivation → 403 profile_not_verified (chaîne de
 *       gates intacte).
 *  E. RPC `admin_set_user_active` direct :
 *     - sur soi-même → 'cannot modify own account' ;
 *     - sur un compte admin → 'cannot modify admin account' ;
 *     - utilisateur inconnu → 'user not found'.
 *  F. API GET /api/admin/companies : liste l'entreprise preuve (nom,
 *     contact, verification_status, is_active).
 *  G. Endpoint photo-url :
 *     - candidat → 403 ;
 *     - admin_ops → 200 + URL signée pointant vers le bucket.
 *  H. Suspension entreprise /api/admin/companies POST :
 *     - admin_ops suspend l'entreprise → 200 + is_active=false ;
 *     - entreprise suspendue → POST /api/jobs 403 account_suspended ;
 *     - réactivation → POST /api/jobs 403 « verified » (le gate
 *       suspension est passé, l'entreprise n'est pas vérifiée).
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword), photo de
 * profil uploadée via le service role dans le bucket privé
 * `candidate-documents`, nettoyage complet en fin de course.
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
const PROOF_PASSWORD = "Proof-T84-11!";
const PROOF_METADATA = { proofT84a: true };
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";
const BUCKET = "candidate-documents";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

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

async function ignore<T>(p: PromiseLike<T>): Promise<void> {
  try {
    await p;
  } catch {
    /* best effort */
  }
}

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

interface ProofUser {
  authUserId: string;
  profileId: string | null;
  companyId: string | null;
  storagePaths: string[];
  email: string;
}

type ProofRole = "candidate" | "company" | "admin_ops" | "admin_support";

async function createProofUser(
  email: string,
  role: ProofRole,
  opts: { profile?: boolean; photo?: boolean; companyProfile?: boolean },
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

  // `users.phone` est UNIQUE — dérivé du début d'ID (pattern T8.3).
  const phone = `2376919${authUserId
    .replace(/[^0-9]/g, "")
    .slice(0, 6)
    .padEnd(6, "7")}`;

  const { error: rowsErr } = await serviceClient.from("users").insert({
    id: authUserId,
    email,
    role,
    is_verified: null,
    phone_verified: true,
    is_active: true,
    phone,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  const storagePaths: string[] = [];
  let profileId: string | null = null;
  let companyId: string | null = null;

  if (opts.profile) {
    let photoUrl: string | null = null;
    if (opts.photo) {
      const path = `${authUserId}/profile_photo_url-proof.t84.png`;
      const { error: uploadErr } = await serviceClient.storage
        .from(BUCKET)
        .upload(path, Buffer.from(TINY_PNG_BASE64, "base64"), {
          contentType: "image/png",
          upsert: true,
        });
      if (uploadErr) throw new Error(`photo upload: ${uploadErr.message}`);
      storagePaths.push(path);
      photoUrl = path;
    }
    const { data: profile, error: pErr } = await serviceClient
      .from("candidate_profiles")
      .insert({
        user_id: authUserId,
        first_name: "T84",
        last_name: "Cand",
        date_of_birth: "1999-02-10",
        city: "Douala",
        quartier: "Bonapriso",
        momo_provider: "mtn",
        momo_number: "+237691000111",
        momo_account_name: "T84 Cand",
        profile_photo_url: photoUrl,
        cni_verified: null,
        momo_verified: false,
        onboarding_step: 4,
        onboarding_status: "completed",
        profile_completion_pct: 70,
        sandbox_level: 0,
      })
      .select("id")
      .single();
    if (pErr || !profile) throw new Error(`profile insert: ${pErr?.message}`);
    profileId = profile.id;
  }

  if (opts.companyProfile) {
    const { data: cp, error: cpErr } = await serviceClient
      .from("company_profiles")
      .insert({
        user_id: authUserId,
        company_name: "Entreprise Preuve T84",
        contact_name: "T84 Contact",
        contact_email: email,
        contact_phone: phone,
        city: "Douala",
        verification_status: "pending",
        onboarding_status: "completed",
        onboarding_step: 4,
      })
      .select("id")
      .single();
    if (cpErr || !cp) throw new Error(`company insert: ${cpErr?.message}`);
    companyId = cp.id;
  }

  return { authUserId, profileId, companyId, storagePaths, email };
}

async function cleanUser(c: ProofUser): Promise<void> {
  if (c.storagePaths.length > 0) {
    await ignore(serviceClient.storage.from(BUCKET).remove(c.storagePaths));
  }
  if (c.profileId) {
    await ignore(
      serviceClient.from("notifications").delete().eq("user_id", c.authUserId),
    );
    await ignore(
      serviceClient.from("audit_logs").delete().eq("resource_id", c.profileId),
    );
    await ignore(
      serviceClient.from("audit_logs").delete().eq("resource_id", c.authUserId),
    );
    await ignore(
      serviceClient.from("candidate_profiles").delete().eq("id", c.profileId),
    );
  }
  if (c.companyId) {
    await ignore(
      serviceClient.from("audit_logs").delete().eq("resource_id", c.companyId),
    );
    await ignore(
      serviceClient.from("company_profiles").delete().eq("id", c.companyId),
    );
  }
  await ignore(serviceClient.from("users").delete().eq("id", c.authUserId));
  await serviceClient.auth.admin.deleteUser(c.authUserId).catch(() => {});
}

async function fetchJson(
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

async function fetchHtml(
  url: string,
  cookies: CookieEntry[],
): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${APP_URL}${url}`, {
    headers: { Cookie: cookieHeader(cookies), Accept: "text/html" },
    cache: "no-store",
    redirect: "manual",
  });
  const html = await res.text();
  return { status: res.status, html, location: res.headers.get("location") };
}

interface CandidateDto {
  id: string;
  email: string | null;
  is_active: boolean;
  is_verified: boolean;
  profile_id: string | null;
  has_photo: boolean;
  cni_verified: "pending" | "verified" | "rejected" | null;
  momo_number: string | null;
}

async function main() {
  console.log("── Preuve T8.4a — Vue centralisée candidats/entreprises ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/admin/candidates`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    serverUp = [200, 302, 307, 308, 401, 403, 500].includes(probe.status);
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Le serveur dev n'est pas accessible sur ${APP_URL}. ` +
        "Preuve E2E T8.4a ignorée.",
    );
    return;
  }

  // Nettoyage des preuves T8.4a précédentes (idempotence).
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT84a === true,
  );
  if (marked.length > 0) {
    const markedIds = marked.map((u) => u.id);
    const { data: objs } = await serviceClient.storage
      .from(BUCKET)
      .list("", { limit: 2000 });
    if (objs) {
      const toRemove = objs
        .map((o) => o.name)
        .filter((n) => markedIds.some((uid) => n.startsWith(`${uid}/`)));
      if (toRemove.length > 0) {
        await ignore(serviceClient.storage.from(BUCKET).remove(toRemove));
      }
    }
    const { data: oldProfiles } = await serviceClient
      .from("candidate_profiles")
      .select("id")
      .in("user_id", markedIds);
    const oldPids = (oldProfiles ?? []).map((p) => p.id as string);
    if (oldPids.length > 0) {
      await ignore(
        serviceClient.from("notifications").delete().in("user_id", markedIds),
      );
      await ignore(
        serviceClient
          .from("audit_logs")
          .delete()
          .in("resource_id", [...oldPids, ...markedIds]),
      );
      await ignore(
        serviceClient.from("candidate_profiles").delete().in("id", oldPids),
      );
    }
    const { data: oldCompanies } = await serviceClient
      .from("company_profiles")
      .select("id")
      .in("user_id", markedIds);
    for (const cp of oldCompanies ?? []) {
      await ignore(
        serviceClient.from("company_profiles").delete().eq("id", cp.id),
      );
    }
    await ignore(serviceClient.from("users").delete().in("id", markedIds));
    for (const u of marked) {
      await ignore(
        (async () => {
          await serviceClient.auth.admin.deleteUser(u.id);
        })(),
      );
    }
    console.log(
      `(nettoyage de ${marked.length} preuve(s) T8.4a antérieure(s))`,
    );
  }

  const R = await createProofUser("t84a.adminops@example.com", "admin_ops", {
    profile: false,
  }); // admin_ops
  const S = await createProofUser(
    "t84a.adminsupport@example.com",
    "admin_support",
    { profile: false },
  ); // admin_support (RO)
  const W = await createProofUser("t84a.candphoto@example.com", "candidate", {
    profile: true,
    photo: true,
  }); // complet avec photo
  const C1 = await createProofUser(
    "t84a.candsuspend@example.com",
    "candidate",
    { profile: true },
  ); // à suspendre
  const CO = await createProofUser("t84a.co@example.com", "company", {
    companyProfile: true,
  }); // entreprise en attente

  const [Rsess, Ssess, Wsess, C1sess, COsess] = await Promise.all([
    realClientFor(R.email),
    realClientFor(S.email),
    realClientFor(W.email),
    realClientFor(C1.email),
    realClientFor(CO.email),
  ]);

  try {
    // ── A. Pages SSR ────────────────────────────────────────────────
    const a1 = await fetchHtml("/admin/candidates", Rsess.cookies);
    report(
      "A1 : /admin/candidates 200 + titre « Candidats » (admin_ops)",
      a1.status === 200 &&
        a1.html.includes("Candidats") &&
        a1.html.includes("Vue centralisée"),
      { status: a1.status },
    );

    const a2 = await fetchHtml("/admin/companies", Rsess.cookies);
    report(
      "A2 : /admin/companies 200 + titre « Entreprises » (admin_ops)",
      a2.status === 200 && a2.html.includes("Entreprises"),
      { status: a2.status },
    );

    const a3 = await fetchHtml("/admin/candidates", Wsess.cookies);
    // Le candidate est tenu à l'écart de /admin : soit le middleware
    // /auth/verify-phone l'intercepte (307 → verify-phone), soit le layout
    // admin le redirige hors /admin (307 → /). Aucun des deux ne rend la
    // page admin.
    const a3BlockedHorsAdmin =
      (a3.status === 307 || a3.status === 302 || a3.status === 200) &&
      !a3.html.includes("Vue centralisée") &&
      !a3.html.includes("Rechercher (nom");
    report(
      "A3 : candidat → pas de page admin rendue (middleware/layout)",
      a3BlockedHorsAdmin,
      { status: a3.status, location: a3.location },
    );

    // ── B. Liste candidats ──────────────────────────────────────────
    const b1 = await fetchJson("/api/admin/candidates", "GET", Rsess.cookies);
    const b1List = (b1.json.candidates ?? []) as unknown as CandidateDto[];
    const wItem = b1List.find((c) => c.id === W.authUserId);
    const c1Item = b1List.find((c) => c.id === C1.authUserId);
    report(
      "B1a : admin_ops GET → 200 + W présent (email, photo, momo)",
      b1.status === 200 &&
        !!wItem &&
        wItem.email === W.email &&
        wItem.has_photo === true &&
        !!wItem.momo_number,
      { status: b1.status, wItem },
    );
    report(
      "B1b : C1 présent, CO (entreprise) ABSENT de la liste candidats",
      !!c1Item && !b1List.some((c) => c.id === CO.authUserId),
      { c1Found: !!c1Item },
    );

    const b2 = await fetchJson("/api/admin/candidates", "GET", Ssess.cookies);
    report(
      "B2 : admin_support (RO) GET → 200",
      b2.status === 200 && Array.isArray(b2.json.candidates),
      { status: b2.status },
    );

    const b3 = await fetchJson("/api/admin/candidates", "GET", Wsess.cookies);
    report("B3 : candidat GET → 403", b3.status === 403, {
      status: b3.status,
    });

    // ── C. Recherche ────────────────────────────────────────────────
    const c1res = await fetchJson(
      `/api/admin/candidates?q=${encodeURIComponent(W.email)}`,
      "GET",
      Rsess.cookies,
    );
    const c1List = (c1res.json.candidates ?? []) as unknown as CandidateDto[];
    report(
      "C1 : ?q=<email-W> → uniquement W",
      c1res.status === 200 &&
        c1List.length === 1 &&
        c1List[0]?.id === W.authUserId,
      { count: c1List.length },
    );

    // ── D. Suspension / réactivation candidat ──────────────────────
    const d1 = await fetchJson("/api/admin/candidates", "POST", Ssess.cookies, {
      user_id: C1.authUserId,
      action: "suspend",
    });
    report("D1 : admin_support (RO) POST suspend → 403", d1.status === 403, {
      status: d1.status,
    });

    const d2 = await fetchJson("/api/admin/candidates", "POST", Rsess.cookies, {
      user_id: C1.authUserId,
      action: "suspend",
    });
    report(
      "D2 : admin_ops POST suspend → 200 { is_active:false }",
      d2.status === 200 && d2.json.is_active === false,
      { status: d2.status, json: d2.json },
    );

    const d3u = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", C1.authUserId)
      .single();
    const d3n = await serviceClient
      .from("notifications")
      .select("notification_type, title")
      .eq("user_id", C1.authUserId)
      .eq("notification_type", "system");
    const d3a = await serviceClient
      .from("audit_logs")
      .select("action, actor_id, actor_role")
      .eq("resource_id", C1.authUserId)
      .eq("action", "suspend_user");
    report("D3a : users.is_active=false", d3u.data?.is_active === false, {
      is_active: d3u.data?.is_active,
    });
    report(
      "D3b : notification system « suspendu » + audit suspend_user (admin_ops)",
      (d3n.data?.length ?? 0) >= 1 &&
        (d3a.data?.length ?? 0) === 1 &&
        d3a.data?.[0]?.actor_id === R.authUserId &&
        d3a.data?.[0]?.actor_role === "admin_ops",
      { notifs: d3n.data?.length, audit: d3a.data?.length },
    );

    const d4 = await fetchJson(
      "/api/jobs/00000000-0000-0000-0000-000000000000/apply",
      "POST",
      C1sess.cookies,
      {},
    );
    report(
      "D4 : candidat suspendu → apply 403 account_suspended",
      d4.status === 403 && d4.json.code === "account_suspended",
      { status: d4.status, code: d4.json.code },
    );

    const d5 = await fetchJson("/api/admin/candidates", "POST", Rsess.cookies, {
      user_id: C1.authUserId,
      action: "activate",
    });
    const d6u = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", C1.authUserId)
      .single();
    const d6n = await serviceClient
      .from("notifications")
      .select("notification_type")
      .eq("user_id", C1.authUserId)
      .eq("notification_type", "system");
    report(
      "D5/D6 : réactivation → 200 + is_active=true + notif réactivée",
      d5.status === 200 &&
        d5.json.is_active === true &&
        d6u.data?.is_active === true &&
        (d6n.data?.length ?? 0) >= 2,
      { status: d5.status, is_active: d6u.data?.is_active },
    );

    const d7 = await fetchJson(
      "/api/jobs/00000000-0000-0000-0000-000000000000/apply",
      "POST",
      C1sess.cookies,
      {},
    );
    report(
      "D7 : après réactivation → 403 profile_not_verified (chaîne de gates OK)",
      d7.status === 403 && d7.json.code === "profile_not_verified",
      { status: d7.status, code: d7.json.code },
    );

    // ── E. Garde-fous RPC directs ───────────────────────────────────
    const e1 = await Rsess.client.rpc("admin_set_user_active", {
      p_user_id: R.authUserId,
      p_active: false,
    });
    report(
      "E1 : RPC sur soi-même → 'cannot modify own account'",
      !!e1.error && /cannot modify own account/i.test(e1.error.message),
      e1.error?.message,
    );

    const e2 = await Rsess.client.rpc("admin_set_user_active", {
      p_user_id: S.authUserId,
      p_active: false,
    });
    report(
      "E2 : RPC sur un compte admin → 'cannot modify admin account'",
      !!e2.error && /cannot modify admin account/i.test(e2.error.message),
      e2.error?.message,
    );

    const e3 = await Rsess.client.rpc("admin_set_user_active", {
      p_user_id: "00000000-0000-0000-0000-00000000aaaa",
      p_active: false,
    });
    report(
      "E3 : RPC utilisateur inconnu → 'user not found'",
      !!e3.error && /user not found/i.test(e3.error.message),
      e3.error?.message,
    );

    // ── F. Liste entreprises ────────────────────────────────────────
    const f1 = await fetchJson("/api/admin/companies", "GET", Rsess.cookies);
    const f1List = (f1.json.companies ?? []) as Array<{
      id: string;
      company_id: string | null;
      company_name: string | null;
      verification_status: "pending" | "verified" | "rejected" | null;
      is_active: boolean;
      contact_email: string | null;
    }>;
    const coItem = f1List.find((c) => c.id === CO.authUserId);
    report(
      "F1 : admin_ops GET companies → 200 + entreprise preuve (nom, contact, pending, active)",
      f1.status === 200 &&
        !!coItem &&
        coItem.company_name === "Entreprise Preuve T84" &&
        coItem.contact_email === CO.email &&
        coItem.verification_status === "pending" &&
        coItem.is_active === true,
      { status: f1.status, coItem },
    );

    // ── G. Endpoint photo de profil ────────────────────────────────
    const g1 = await fetchJson(
      `/api/admin/profiles/${W.profileId}/photo-url`,
      "GET",
      Wsess.cookies,
    );
    report("G1 : candidat GET photo-url → 403", g1.status === 403, {
      status: g1.status,
    });

    const g2 = await fetchJson(
      `/api/admin/profiles/${W.profileId}/photo-url`,
      "GET",
      Rsess.cookies,
    );
    const g2Url = String(g2.json.url ?? "");
    report(
      "G2 : admin_ops GET photo-url → 200 + URL signée (token présent, jamais de public.url)",
      g2.status === 200 &&
        g2Url.includes("token=") &&
        !g2Url.includes(`/object/public/`),
      { status: g2.status, hasToken: g2Url.includes("token=") },
    );

    // ── H. Suspension entreprise + gate publication ────────────────
    const jobBody = {
      title: "Offre preuve T84",
      description: "Description de preuve.",
      address: "Avenue de la Liberté",
      city: "Douala",
      start_date: "2099-01-15",
      start_time: "09:00",
      end_time: "17:00",
      hourly_rate: 5000,
    };

    const h1 = await fetchJson("/api/admin/companies", "POST", Rsess.cookies, {
      user_id: CO.authUserId,
      action: "suspend",
    });
    const h1u = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", CO.authUserId)
      .single();
    report(
      "H1 : admin_ops suspend entreprise → 200 + is_active=false",
      h1.status === 200 &&
        h1.json.is_active === false &&
        h1u.data?.is_active === false,
      { status: h1.status, is_active: h1u.data?.is_active },
    );

    const h2 = await fetchJson("/api/jobs", "POST", COsess.cookies, jobBody);
    report(
      "H2 : entreprise suspendue → POST /api/jobs 403 account_suspended",
      h2.status === 403 && h2.json.code === "account_suspended",
      { status: h2.status, code: h2.json.code },
    );

    const h3 = await fetchJson("/api/admin/companies", "POST", Rsess.cookies, {
      user_id: CO.authUserId,
      action: "activate",
    });
    const h4 = await fetchJson("/api/jobs", "POST", COsess.cookies, jobBody);
    report(
      "H3/H4 : réactivation → POST /api/jobs 403 « verified » (gate suspension traversé)",
      h3.status === 200 &&
        h4.status === 403 &&
        /verified/i.test(String(h4.json.error ?? "")),
      { status: h4.status, error: h4.json.error },
    );
  } finally {
    await cleanUser(CO);
    await cleanUser(C1);
    await cleanUser(W);
    await cleanUser(S);
    await cleanUser(R);
  }

  console.log(
    `\n── ${failCount === 0 ? "Toutes les assertions passent" : "ÉCHEC"} : ${passCount}/${passCount + failCount} ──`,
  );
  if (failCount > 0) process.exitCode = 1;
}

void main().catch((err) => {
  console.error("Preuve T8.4a interrompue :", err);
  process.exitCode = 1;
});
