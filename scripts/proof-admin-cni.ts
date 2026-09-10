/**
 * Preuve E2E T8.3 — Flux CNI : revue admin + `users.is_verified` gate.
 *
 * Le flux T8.2 (MoMo revue + URL signée CNI) est déjà prouvé par
 * `proof-admin-momo-review.ts`. Cette preuve porte sur ce que T8.3
 * AJOUTE :
 *  A. Page SSR `/admin/cni` :
 *     - admin_ops → 200 + titre i18n FR « Révue CNI » ;
 *     - candidat → pas de titre CNI admin + API /api/admin/cni 403.
 *  B. API GET `/api/admin/cni` :
 *     - admin_ops → 200 + profil candidat dans la liste ;
 *     - admin_support (RO) → 200 ;
 *     - candidat → 403.
 *  C. API POST `/api/admin/cni` — rejets :
 *     - admin_support (RO) → 403 (mutation refusée) ;
 *     - admin_ops sans motif → 400 (Zod refine) ;
 *     - admin_ops avec motif « Photos floues » → 200 ; profile
 *       cni_verified='rejected', cni_rejection_reason posé.
 *  D. API POST `/api/admin/cni` — approbation :
 *     - admin_ops → 200 ;
 *     - profile cni_verified='verified' + cni_expires_at = dob+10y ;
 *     - ligne document_expirations (type 'cni') ;
 *     - notification 'document_status' (CNI vérifiée) ;
 *     - audit_logs (approve_cni, role admin_ops) ;
 *     - photos CNI supprimées du bucket privé + URLs NULLifiées (T8.4) ;
 *  E. Gate de postulation `users.is_verified` :
 *     - candidat NON vérifié (is_verified=false ou null, momo non
 *       vérifié) → POST /api/jobs/[random-id]/apply → 403 code
 *       'profile_not_verified' ;
 *     - admin_ops appelle `apply_momo_verification` approve → MoMo
 *       vérifié → recompute → is_verified=true ;
 *     - candidats NON vérifiés : POST apply → 404 'Job not found'
 *       (le gate is_verified est PASSE, la 404 est l'erreur de
 *       recherche du job — preuve que le gate a été traversé) ;
 *     - photos NULLifiées + momo_verified=true + cni_verified='verified'
 *       → is_verified reste TRUE (recompute sur état, pas photos).
 *  F. Trigger `trg_protect_cni_verification` (protection ciblée) :
 *     - F1 : candidat self-mark cni_verified='verified' via RLS →
 *       RESTORÉ à l'état d'avant (seul le saut vers 'verified' est
 *       interdit).
 *     - F2 : candidat self-mark cni_verified='pending' (flux légitime
 *       de ré-soumission — route /api/profile/documents) → AUTORISÉ.
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword), 3
 * photos CNI uploadées via le service role dans le bucket privé
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
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROOF_PASSWORD = "Proof-T83-11!";
const PROOF_METADATA = { proofT83: true };
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

// PNG 1x1 minimal.
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
  storagePaths: string[];
  email: string;
}

async function createProofUser(
  email: string,
  role: "candidate" | "admin_ops" | "admin_support",
  withProfile: boolean,
  withFullCni: boolean,
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

  // `users.phone` est UNIQUE — on dérive le numéro du début d'ID pour que
  // les 3 comptes preuve (admin_ops, admin_support, candidat) n'entrent
  // jamais en collision.
  const t83Phone = `2376909${authUserId
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
    phone: t83Phone,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  const storagePaths: string[] = [];
  let profileId: string | null = null;
  if (withProfile) {
    if (withFullCni) {
      const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
      for (const kind of ["front", "back", "selfie"] as const) {
        const path = `${authUserId}/cni_${kind}-8888.t83.${authUserId.slice(0, 8)}.png`;
        const { error: uploadErr } = await serviceClient.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: "image/png", upsert: true });
        if (uploadErr) {
          throw new Error(`storage upload ${kind}: ${uploadErr.message}`);
        }
        storagePaths.push(path);
      }
    }
    const { data: profile, error: profileErr } = await serviceClient
      .from("candidate_profiles")
      .insert({
        user_id: authUserId,
        first_name: "Cni",
        last_name: "T83",
        date_of_birth: "1998-06-15",
        city: "Douala",
        quartier: "Bonanjo",
        momo_provider: "mtn",
        momo_number: "+237690111222",
        momo_account_name: "Cni T83",
        cni_front_url:
          withFullCni && storagePaths.length > 0 ? storagePaths[0] : null,
        cni_back_url: withFullCni ? storagePaths[1] : null,
        cni_selfie_url: withFullCni ? storagePaths[2] : null,
        cni_number: "T83-CNI-0001",
        cni_verified: withFullCni ? "pending" : null,
        momo_verified: false,
        onboarding_step: 4,
        onboarding_status: "completed",
        profile_completion_pct: 70,
        sandbox_level: 0,
      })
      .select("id")
      .single();
    if (profileErr || !profile) {
      throw new Error(`profile insert: ${profileErr?.message}`);
    }
    profileId = profile.id;
  }
  return { authUserId, profileId, storagePaths, email };
}

async function cleanUser(c: ProofUser): Promise<void> {
  if (c.storagePaths.length > 0) {
    await ignore(serviceClient.storage.from(BUCKET).remove(c.storagePaths));
  }
  if (c.profileId) {
    await ignore(
      serviceClient
        .from("document_expirations")
        .delete()
        .eq("candidate_id", c.profileId),
    );
    await ignore(
      serviceClient.from("notifications").delete().eq("user_id", c.authUserId),
    );
    await ignore(
      serviceClient.from("audit_logs").delete().eq("resource_id", c.profileId),
    );
    await ignore(
      serviceClient.from("candidate_profiles").delete().eq("id", c.profileId),
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
): Promise<{ status: number; html: string }> {
  const res = await fetch(`${APP_URL}${url}`, {
    headers: { Cookie: cookieHeader(cookies), Accept: "text/html" },
    cache: "no-store",
  });
  const html = await res.text();
  return { status: res.status, html };
}

async function main() {
  console.log("── Preuve T8.3 — Revue CNI + gate is_verified ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/admin/cni`, {
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
        "Preuve E2E T8.3 ignorée.",
    );
    return;
  }

  // Nettoyage des preuves T8.3 précédentes.
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT83 === true,
  );
  const markedIds = marked.map((u) => u.id);
  if (markedIds.length > 0) {
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
        serviceClient
          .from("document_expirations")
          .delete()
          .in("candidate_id", oldPids),
      );
      await ignore(
        serviceClient.from("notifications").delete().in("user_id", markedIds),
      );
      await ignore(
        serviceClient.from("audit_logs").delete().in("resource_id", oldPids),
      );
      await ignore(
        serviceClient.from("candidate_profiles").delete().in("id", oldPids),
      );
    }
    await ignore(serviceClient.from("users").delete().in("id", markedIds));
  }
  for (const id of markedIds) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }

  const R = await createProofUser(
    "admin.t83a@easyjob.cm",
    "admin_ops",
    false,
    false,
  );
  const S = await createProofUser(
    "support.t83@easyjob.cm",
    "admin_support",
    false,
    false,
  );
  const W = await createProofUser(
    "cand.t83@easyjob.cm",
    "candidate",
    true,
    true,
  );

  const WprofileId = W.profileId as string;
  const randomJobId = "00000000-0000-4000-8000-00000000dead";

  try {
    const cookiesR = await realClientFor(R.email);
    const cookiesS = await realClientFor(S.email);
    const cookiesW = await realClientFor(W.email);

    // ── A. Page SSR /admin/cni ───────────────────────────────────
    const adminPage = await fetchHtml("/admin/cni", cookiesR.cookies);
    report(
      "A1 : page /admin/cni (admin_ops) → 200 + titre i18n FR « Révue CNI »",
      adminPage.status === 200 && adminPage.html.includes("Révue CNI"),
      { status: adminPage.status },
    );

    const candPage = await fetchHtml("/admin/cni", cookiesW.cookies);
    const candApi = await fetchJson("/api/admin/cni", "GET", cookiesW.cookies);
    report(
      "A2 : rôle candidat — page /admin/cni sans contenu admin + API /api/admin/cni → 403",
      !candPage.html.includes("Révue CNI") && candApi.status === 403,
      { status: candPage.status, apiStatus: candApi.status },
    );

    // ── B. API GET rôles ─────────────────────────────────────────
    const adminList = await fetchJson(
      "/api/admin/cni",
      "GET",
      cookiesR.cookies,
    );
    const adminListProfiles = (adminList.json.profiles ?? []) as unknown[];
    const containsW = adminListProfiles.some(
      (p) => (p as { id?: string }).id === WprofileId,
    );
    report(
      "B1 : admin_ops GET /api/admin/cni → 200 + profil candidat présent",
      adminList.status === 200 && containsW,
      {
        status: adminList.status,
        count: adminListProfiles.length,
        containsW,
      },
    );

    const supportList = await fetchJson(
      "/api/admin/cni",
      "GET",
      cookiesS.cookies,
    );
    report(
      "B2 : admin_support (RO) GET /api/admin/cni → 200",
      supportList.status === 200,
      { status: supportList.status },
    );

    // ── C. POST /api/admin/cni — rejets ──────────────────────────
    const supportReject = await fetchJson(
      "/api/admin/cni",
      "POST",
      cookiesS.cookies,
      {
        profile_id: WprofileId,
        action: "reject",
        rejection_reason: "Photos floues",
      },
    );
    report(
      "C1 : admin_support POST reject → 403 (RO, mutation refusée)",
      supportReject.status === 403,
      { status: supportReject.status },
    );

    const opsRejectNoReason = await fetchJson(
      "/api/admin/cni",
      "POST",
      cookiesR.cookies,
      { profile_id: WprofileId, action: "reject" },
    );
    report(
      "C2 : admin_ops POST reject SANS motif → 400 (Zod refine)",
      opsRejectNoReason.status === 400,
      { status: opsRejectNoReason.status },
    );

    const opsReject = await fetchJson(
      "/api/admin/cni",
      "POST",
      cookiesR.cookies,
      {
        profile_id: WprofileId,
        action: "reject",
        rejection_reason: "Photos floues — impossible de lire le nom.",
      },
    );
    report(
      "C3 : admin_ops POST reject avec motif → 200 + statut 'rejected' retourné",
      opsReject.status === 200 && opsReject.json.status === "rejected",
      { status: opsReject.status, body: opsReject.json },
    );

    const rejectedProfile = await serviceClient
      .from("candidate_profiles")
      .select("cni_verified, cni_rejection_reason")
      .eq("id", WprofileId)
      .single();
    report(
      "C4 : profile après reject → cni_verified='rejected' + motif posé",
      rejectedProfile.data?.cni_verified === "rejected" &&
        typeof rejectedProfile.data?.cni_rejection_reason === "string" &&
        (rejectedProfile.data?.cni_rejection_reason as string).length >= 3,
      rejectedProfile.data,
    );

    // ── F. Trigger de protection — AVANT l'approve ───────────────
    // Le candidat tente de s'auto-marquer `cni_verified='verified'` via
    // sa propre RLS (update own profile). Le trigger `trg_protect_cni_
    // verification` doit restaurer l'ancienne valeur ('rejected' ici)
    // car le GUC `easyjob.system_update` n'est pas posé.
    const selfMark = await cookiesW.client
      .from("candidate_profiles")
      .update({ cni_verified: "verified" })
      .eq("id", WprofileId)
      .select("cni_verified, cni_rejection_reason")
      .single();
    report(
      "F1 : candidat self-mark cni_verified='verified' → restauré à 'rejected' (trigger)",
      selfMark.data?.cni_verified === "rejected",
      {
        afterSelfMark: selfMark.data,
        error: selfMark.error?.message,
      },
    );
    // Le profil est toujours 'rejected' après F1 (le trigger a restauré).
    // Régression T8.3 (fix) : le flux de RÉ-SOUMISSION doit rester autorisé —
    // le candidat ré-uploade ses photos via /api/profile/documents (PostgREST,
    // GUC off) qui écrit 'pending'. Le trigger doit L'AUTORISER, uniquement
    // le saut vers 'verified' est bloqué.
    const selfReopen = await cookiesW.client
      .from("candidate_profiles")
      .update({ cni_verified: "pending" })
      .eq("id", WprofileId)
      .select("cni_verified")
      .single();
    report(
      "F2 : candidat self-mark cni_verified='pending' (flux ré-soumission) → AUTORISÉ (passé en pending)",
      selfReopen.data?.cni_verified === "pending",
      {
        afterSelfReopen: selfReopen.data,
        error: selfReopen.error?.message,
      },
    );
    // On restaure l'état 'rejected' pour la suite (D-approve est le même
    // quel que soit l'état, mais on garde la cohérence du scénario).
    await ignore(
      cookiesW.client
        .from("candidate_profiles")
        .update({ cni_verified: "rejected" })
        .eq("id", WprofileId),
    );

    // ── D. POST /api/admin/cni — approbation ────────────────────
    const opsApprove = await fetchJson(
      "/api/admin/cni",
      "POST",
      cookiesR.cookies,
      { profile_id: WprofileId, action: "approve" },
    );
    report(
      "D1 : admin_ops POST approve → 200 + statut 'verified' retourné",
      opsApprove.status === 200 && opsApprove.json.status === "verified",
      { status: opsApprove.status, body: opsApprove.json },
    );

    // dob 1998-06-15 → cni_expires_at attendu = 2008-06-15.
    const approvedProfile = await serviceClient
      .from("candidate_profiles")
      .select(
        "cni_verified, cni_expires_at, cni_front_url, cni_back_url, cni_selfie_url",
      )
      .eq("id", WprofileId)
      .single();
    report(
      "D2 : profile après approve → cni_verified='verified' + cni_expires_at = dob+10y (2008-06-15)",
      approvedProfile.data?.cni_verified === "verified" &&
        approvedProfile.data?.cni_expires_at === "2008-06-15",
      approvedProfile.data,
    );

    // T8.4 : après l'approve, la route a supprimé les photos du bucket
    // privé + NULLifié les URLs du profil.
    report(
      "D3 : photos CNI NULLifiées dans candidate_profiles (route T8.4)",
      approvedProfile.data?.cni_front_url === null &&
        approvedProfile.data?.cni_back_url === null &&
        approvedProfile.data?.cni_selfie_url === null,
      {
        front: approvedProfile.data?.cni_front_url,
        back: approvedProfile.data?.cni_back_url,
        selfie: approvedProfile.data?.cni_selfie_url,
      },
    );

    const docExpirations = await serviceClient
      .from("document_expirations")
      .select("document_type, expires_at")
      .eq("candidate_id", WprofileId)
      .eq("document_type", "cni")
      .limit(5);
    report(
      "D4 : document_expirations — ligne type 'cni' présente (expiry = dob+10y)",
      (docExpirations.data ?? []).some(
        (d) => d.document_type === "cni" && d.expires_at === "2008-06-15",
      ),
      docExpirations.data,
    );

    const cniNotifications = await serviceClient
      .from("notifications")
      .select("notification_type, title")
      .eq("user_id", W.authUserId)
      .eq("notification_type", "document_status")
      .limit(10);
    const hasVerifyNotif = (cniNotifications.data ?? []).some((n) =>
      (n.title ?? "").includes("CNI vérifiée"),
    );
    const hasRejectNotif = (cniNotifications.data ?? []).some((n) =>
      (n.title ?? "").includes("CNI refusée"),
    );
    report(
      "D5 : notifications document_status — « CNI refusée » + « CNI vérifiée » toutes deux présentes",
      hasVerifyNotif && hasRejectNotif,
      cniNotifications.data,
    );

    const auditCni = await serviceClient
      .from("audit_logs")
      .select("action, actor_role, resource_id")
      .eq("resource_id", WprofileId)
      .in("action", ["approve_cni", "reject_cni"])
      .limit(5);
    const actions = (auditCni.data ?? []).map((a) => a.action);
    report(
      "D6 : audit_logs — approve_cni + reject_cni, rôles admin_ops",
      actions.includes("approve_cni") &&
        actions.includes("reject_cni") &&
        (auditCni.data ?? []).every((a) => a.actor_role === "admin_ops"),
      auditCni.data,
    );

    // ── E1. Gate de postulation AVANT le recompute ───────────────
    // is_verified est toujours NULL/false : le gate doit bloquer.
    const applyBefore = await fetchJson(
      `/api/jobs/${randomJobId}/apply`,
      "POST",
      cookiesW.cookies,
    );
    report(
      "E1 : candidat NON vérifié → POST /apply → 403 code='profile_not_verified'",
      applyBefore.status === 403 &&
        applyBefore.json.code === "profile_not_verified",
      { status: applyBefore.status, body: applyBefore.json },
    );

    // ── E2. Momo approve via RPC (T6) → recompute is_verified ────
    const momoApproveRes = await cookiesR.client.rpc(
      "apply_momo_verification",
      {
        p_profile_id: WprofileId,
        p_action: "approve",
        // Type généré `string` non-nullable ; Postgres accepte SQL NULL.
        p_reject_reason: null as unknown as string,
      },
    );
    report(
      "E2 : admin_ops RPC apply_momo_verification approve → sans erreur",
      !momoApproveRes.error,
      momoApproveRes.error?.message,
    );

    const momoProfile = await serviceClient
      .from("candidate_profiles")
      .select("momo_verified, momo_verified_by")
      .eq("id", WprofileId)
      .single();
    report(
      "E3 : profile momo_verified=true + momo_verified_by=<admin_ops.id>",
      momoProfile.data?.momo_verified === true &&
        momoProfile.data?.momo_verified_by === R.authUserId,
      momoProfile.data,
    );

    const afterRecompute = await serviceClient
      .from("users")
      .select("is_verified")
      .eq("id", W.authUserId)
      .single();
    report(
      "E4 : users.is_verified=true après recomputation (CNI vérifiée + MoMo vérifié)",
      afterRecompute.data?.is_verified === true,
      { is_verified: afterRecompute.data?.is_verified },
    );

    // ── E3. Gate de postulation APRÈS recompute ──────────────────
    const applyAfter = await fetchJson(
      `/api/jobs/${randomJobId}/apply`,
      "POST",
      cookiesW.cookies,
    );
    report(
      "E5 : candidat VÉRIFIÉ → POST /apply → gate is_verified PASSE (404 Job not found)",
      applyAfter.status === 404 &&
        applyAfter.json.error === "Job not found" &&
        applyAfter.json.code !== "profile_not_verified",
      { status: applyAfter.status, body: applyAfter.json },
    );

    // ── E5. Trigger protection is_verified (direct write) ────────
    // Le candidat tente de s'auto-marquer is_verified=true via sa
    // propre RLS users update. Le trigger `trg_protect_user_is_verified`
    // doit restaurer la valeur d'avant (déjà true ici → reste true).
    // On flippe en true d'abord (déjà le cas) — on teste la protection
    // en essayant de passer false, ce qui doit être restauré à true.
    const directFlip = await cookiesW.client
      .from("users")
      .update({ is_verified: false })
      .eq("id", W.authUserId)
      .select("is_verified")
      .single();
    report(
      "E6 : candidat self-write is_verified=false → restauré à true (trigger)",
      directFlip.data?.is_verified === true,
      {
        afterDirectWrite: directFlip.data,
        error: directFlip.error?.message,
      },
    );

    // ── E6. Re-compute après photo-null : is_verified reste true ─
    // (Ceci valide le fix du bug : la recompute porte sur cni_
    // verified='verified', pas la présence des photos, que T8.4
    // nullifie après l'approbation. On re-invoque le recompute pour
    // prouver que le flag reste vrai même si les photos sont NULL.)
    const recomputedAgain = await serviceClient.rpc(
      "recompute_user_verification",
      { p_user_id: W.authUserId },
    );
    report(
      "E7 : recompute après photos NULL → sans erreur",
      !recomputedAgain.error,
      recomputedAgain.error?.message,
    );
    const stillVerified = await serviceClient
      .from("users")
      .select("is_verified")
      .eq("id", W.authUserId)
      .single();
    report(
      "E8 : is_verified RESTE true (recompute sur état cni_verified, pas photos)",
      stillVerified.data?.is_verified === true,
      { is_verified: stillVerified.data?.is_verified },
    );
  } finally {
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
  console.error("Preuve T8.3 interrompue :", err);
  process.exitCode = 1;
});
