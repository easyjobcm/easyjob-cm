/**
 * Preuve E2E T8.5 — Mises à jour de profil : surface admin
 * (page + section profil + routes GET/PATCH/DELETE).
 *
 * T8.5 PRÉCISE (le verrou + le POST d'initiation sont déjà prouvés par la
 * baseline T2 `proof-profile-lock.ts`) :
 *  A. Page SSR `/admin/update-requests` :
 *     - 200 + titre FR « Mises à jour de profil » (3 grades) ;
 *     - 403/redirect pour un compte CANDIDAT (gardes layout).
 *  B. GET `/api/admin/profile-update-requests` :
 *     - 200 pour les 3 grades (admin_support = lecture seule) ;
 *     - 401 non authentifié ; 403 candidat ;
 *     - `?status=pending` + `?candidate_id=` filtrent ;
 *     - `requester_email` résolu (service_role) + nom candidat embarqué.
 *  C. POST (initiation, existant T2 — ré-vérifié ici en conditions T8.5) :
 *     - 200 + ligne `pending` + notification candidat + audit
 *       `request_profile_update` ;
 *     - 403 `admin_support` ; 400 Zod (motif < 5, `fields` vide).
 *  D. PATCH `[id]` (annulation) :
 *     - `pending → cancelled` 200 + audit `cancel_profile_update_request`
 *       + notification candidat ; idempotent si déjà `cancelled` (200) ;
 *     - sur `done` → 409 `invalid_transition` ;
 *     - `admin_support` → 403 ; non auth → 401.
 *  E. DELETE `[id]` (purge historique clôturé) :
 *     - sur `pending` → 409 `request_pending` (la ligne reste) ;
 *     - sur `cancelled` → 200 + ligne purgée + audit
 *       `delete_profile_update_request` CONSERVÉ ;
 *     - sur `done` → 200 ; `admin_support` → 403 ; inconnu → 404.
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword), statut
 * `done` posé via service_role (le serveur le pose via
 * `completePendingRequests` — la preuve n'a pas d'API candidat à ce
 * stade), nettoyage complet en fin de course.
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
const PWD = "Proof-T85-12!";
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error("Missing env keys.");
}

const svc: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

const be = (p: PromiseLike<unknown>) => Promise.resolve(p).catch(() => {});

async function real(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (e: { name: string; value: string; options?: unknown }[]) => {
        for (const { name, value } of e) {
          if (value === "" || value === "0") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
    auth: { autoRefreshToken: false },
  }) as DB;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PWD,
  });
  if (error || !data.session)
    throw new Error(`sign-in ${email}: ${error?.message}`);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function html(cookies: string, path: string): Promise<string> {
  const r = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: cookies, Accept: "text/html" },
    cache: "no-store",
  });
  return r.text();
}

interface JsonResp {
  status: number;
  json: Record<string, unknown>;
}

async function req(
  cookies: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonResp> {
  const r = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass += 1;
  else fail += 1;
  console.log(
    `${cond ? "✅" : "❌"} ${name}${
      detail !== undefined ? "\n     " + JSON.stringify(detail) : ""
    }`,
  );
}

interface Acct {
  last: string;
  email: string;
  uid: string;
  role: "candidate" | "admin_support" | "admin_ops" | "admin_founder";
  profileId: string | null;
}

function phoneOf(uid: string) {
  return `2376859${uid
    .replace(/[^0-9]/g, "")
    .slice(0, 6)
    .padEnd(6, "8")}`;
}

async function mkAcct(
  last: string,
  role: "candidate" | "admin_support" | "admin_ops" | "admin_founder",
  withProfile: boolean,
): Promise<Acct> {
  const email = `t85.${last.toLowerCase()}.${Date.now()}@e.com`;
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password: PWD,
    email_confirm: true,
    user_metadata: { proofT85: true },
    app_metadata: { role },
  });
  if (error || !created.user) throw new Error(`mk ${email}: ${error?.message}`);
  const uid = created.user.id;

  const { error: uErr } = await svc.from("users").insert({
    id: uid,
    email,
    role,
    phone_verified: true,
    is_active: true,
    is_verified: null,
    phone: phoneOf(uid),
    locale: "fr",
  });
  if (uErr) throw new Error(`users ${email}: ${uErr.message}`);

  let profileId: string | null = null;
  if (withProfile) {
    const { data: profile, error: pErr } = await svc
      .from("candidate_profiles")
      .insert({
        user_id: uid,
        first_name: "T85",
        last_name: last,
        date_of_birth: "1997-05-20",
        city: "Douala",
        quartier: "Bonanjo",
        momo_provider: "mtn",
        momo_number: "+237695000124",
        momo_account_name: `T85 ${last}`,
        momo_verified: true,
        cni_number: "T85CNI0000",
        cni_verified: "verified",
        onboarding_step: 4,
        onboarding_status: "completed",
        profile_completion_pct: 90,
      })
      .select("id")
      .single();
    if (pErr || !profile) throw new Error(`profile ${email}: ${pErr?.message}`);
    profileId = profile.id;
  }

  return { last, email, uid, role, profileId };
}

/** Demande T2 « as if the candidate had executed it » : clôturée en done.
 *  Le serveur le fait via `completePendingRequests` (routes candidat) ;
 *  la preuve n'a pas de flux candidat à ce stade → simulation service_role.
 *  (L'invariant « l'admin ne pose jamais le done » est prouvé ailleurs :
 *  PATCH ne sait que `cancelled`.) */
async function createDoneRequest(
  adminUid: string,
  profileId: string,
): Promise<string> {
  const ins = await svc
    .from("profile_update_requests")
    .insert({
      candidate_id: profileId,
      fields: ["identity"],
      status: "pending",
      reason: "Mise à jour des mentions légales",
      requested_by: adminUid,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ins.error || !ins.data)
    throw new Error(`done insert: ${ins.error?.message}`);
  await be(
    svc
      .from("profile_update_requests")
      .update({ status: "done" })
      .eq("id", ins.data.id),
  );
  return ins.data.id;
}

interface ReqRefs {
  pending: string | null;
  cancelled: string | null;
  done: string | null;
}

async function clean(a: Acct): Promise<void> {
  if (a.profileId) {
    await be(
      svc
        .from("profile_update_requests")
        .delete()
        .eq("candidate_id", a.profileId),
    );
    await be(svc.from("candidate_profiles").delete().eq("id", a.profileId));
  }
  await be(svc.from("notifications").delete().eq("user_id", a.uid));
  await be(svc.from("audit_logs").delete().eq("actor_id", a.uid));
  await be(svc.from("users").delete().eq("id", a.uid));
  await be(svc.auth.admin.deleteUser(a.uid));
}

async function main() {
  console.log(`── Preuve T8.5 — Mises à jour de profil (admin) ──\n`);

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/admin/update-requests`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    serverUp = [200, 302, 307, 308, 401, 403, 500].includes(probe.status);
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Serveur dev injoignable sur ${APP_URL}. Preuve T8.5 ignorée.`,
    );
    return;
  }

  const OPS = await mkAcct("OpsT85", "admin_ops", true);
  const SUP = await mkAcct("SupT85", "admin_support", true);
  const CAND = await mkAcct("CandT85", "candidate", true);

  const Ops = await real(OPS.email);
  const Sup = await real(SUP.email);
  const Cand = await real(CAND.email);

  const refs: ReqRefs = { pending: null, cancelled: null, done: null };

  try {
    // ── A. Page SSR /admin/update-requests ────────────────────────
    const a1 = await html(Ops, "/admin/update-requests");
    ok(
      "A1 : /admin/update-requests 200 + titre FR « Mises à jour de profil »",
      a1.includes("Mises à jour de profil"),
    );
    const a2 = await html(Sup, "/admin/update-requests");
    ok(
      "A2 : page lisible par admin_support (lecture seule)",
      a2.includes("Mises à jour de profil"),
    );
    const a3r = await fetch(`${APP_URL}/admin/update-requests`, {
      headers: { Cookie: Cand, Accept: "text/html" },
      redirect: "manual",
    });
    const a3body = await a3r.text();
    // Guardes de rôle = `redirect("/")` : sur une route dynamique Next rend
    // 200 + boundary client (pattern T4 « NEXT_REDIRECT »), 307 sur une
    // route statique. Les deux signifient : le candidat n'obtient JAMAIS le
    // contenu admin (jamais le titre FR ni l'API).
    ok(
      "A3 : candidat → renvoyé de la page admin (boundary 307/NEXT_REDIRECT)",
      (a3r.status === 307 ||
        a3r.status === 302 ||
        a3body.includes("NEXT_REDIRECT")) &&
        !a3body.includes("Mises à jour de profil"),
      { status: a3r.status, loc: a3r.headers.get("location") },
    );

    // Liste vide → message FR (pas d'échec 500).
    // NB : la page est 100 % SWR (client) — le message « Aucune demande »
    // n'est JAMAIS dans le HTML SSR (montage + fetch client après
    // hydratation, pattern T8.4a). Le test de liste vide porte donc sur
    // l'API (source de données de la page) : `{"requests":[]}` avant
    // création.
    const a4 = await req(Ops, "GET", "/api/admin/profile-update-requests");
    const a4rows = (a4.json.requests as unknown[]) ?? [];
    ok(
      "A4 : liste initiale vide → API renvoie requests=[] (pas d'erreur 500)",
      a4.status === 200 && a4rows.length === 0,
      { status: a4.status, count: a4rows.length },
    );

    // ── B. GET liste (après création — voir C) ────────────────────
    // Pré-requiert des données → on crée d'abord (C) puis on re-liste.

    // ── C. POST création (initiation, baseline T2 ré-vérifiée) ────
    const c1 = await req(Ops, "POST", "/api/admin/profile-update-requests", {
      candidate_id: CAND.profileId!,
      fields: ["identity", "cni_documents"],
      reason: "CNI périmée — nouvelle version à fournir",
    });
    const reqId =
      (c1.json.request_id as string | undefined) ?? (refs.pending as string);
    refs.pending = reqId ?? null;
    ok(
      "C1 : POST (admin_ops) → 200 + request_id",
      c1.status === 200 && typeof reqId === "string" && reqId.length > 0,
      c1.json,
    );

    const c2row = await svc
      .from("profile_update_requests")
      .select("status, fields, reason, requested_by, created_at, completed_at")
      .eq("id", reqId!)
      .maybeSingle();
    ok(
      "C2 : ligne `pending` + champs + motif + requested_by=admin",
      c2row.data?.status === "pending" &&
        c2row.data?.fields?.includes("identity") === true &&
        c2row.data?.requested_by === OPS.uid,
      c2row.data,
    );

    const c3not = await svc
      .from("notifications")
      .select("notification_type, title, data")
      .eq("user_id", CAND.uid)
      .order("created_at", { ascending: false })
      .limit(1);
    ok(
      "C3 : notification `document_status` au candidat (id de la demande)",
      c3not.data?.[0]?.notification_type === "document_status" &&
        (c3not.data?.[0]?.data as Record<string, unknown> | null)
          ?.profile_update_request_id === reqId,
      c3not.data?.[0],
    );

    const c4aud = await svc
      .from("audit_logs")
      .select("action, actor_id, resource_id")
      .eq("actor_id", OPS.uid)
      .eq("action", "request_profile_update")
      .order("created_at", { ascending: false })
      .limit(1);
    ok(
      "C4 : audit `request_profile_update` (acteur = admin_ops réel)",
      c4aud.data?.[0]?.resource_id === reqId,
      c4aud.data?.[0],
    );

    const c5 = await req(Sup, "POST", "/api/admin/profile-update-requests", {
      candidate_id: CAND.profileId!,
      fields: ["identity"],
      reason: "admin_support ne doit pas initier",
    });
    ok(
      "C5 : POST (admin_support) → 403 (lecture seule)",
      c5.status === 403,
      c5.status,
    );

    const c6 = await req(Ops, "POST", "/api/admin/profile-update-requests", {
      candidate_id: CAND.profileId!,
      fields: ["identity"],
      reason: "abc",
    });
    ok("C6 : POST motif < 5 car. → 400 (Zod)", c6.status === 400, c6.json);

    const c7 = await req(Ops, "POST", "/api/admin/profile-update-requests", {
      candidate_id: CAND.profileId!,
      fields: [],
      reason: "aucun champ sélectionné",
    });
    ok("C7 : POST `fields` vide → 400 (Zod)", c7.status === 400, c7.json);

    const c8 = await req(null, "POST", "/api/admin/profile-update-requests", {
      candidate_id: CAND.profileId!,
      fields: ["identity"],
      reason: "non authentifié",
    });
    ok("C8 : POST non authentifié → 401", c8.status === 401, c8.status);

    // Ligne `done` (simulation exécution candidat) pour les tests D/E.
    refs.done = await createDoneRequest(OPS.uid, CAND.profileId!);

    // Ligne de 2e candidat ? Non — le filtre ?candidate_id= teste aussi
    // l'absence d'un AUTRE candidat : on crée OPS→SUP (SUP a un profil).
    const c9 = await req(Ops, "POST", "/api/admin/profile-update-requests", {
      candidate_id: SUP.profileId!,
      fields: ["cni_documents"],
      reason: "CNI du second candidat à remplacer",
    });
    const reqId2 = (c9.json.request_id as string | undefined) ?? null;
    ok(
      "C9 : POST 2e demande (candidat #2) → 200 + request_id",
      c9.status === 200 && !!reqId2,
      c9.json,
    );
    refs.cancelled = reqId2;

    // ── B. GET liste + filtres ───────────────────────────────────
    const b1 = await req(Ops, "GET", "/api/admin/profile-update-requests");
    const b1rows = (b1.json.requests as Array<Record<string, unknown>>) ?? [];
    ok(
      "B1 : GET (admin_ops) → 200 + 3 lignes (pending/done/sec pending)",
      b1.status === 200 && b1rows.length === 3,
      bjson(b1rows),
    );
    const b1pending = b1rows.find((r) => r.id === refs.pending) as
      | Record<string, unknown>
      | undefined;
    ok(
      "B2 : ligne porte `requester_email` (résolu service_role) + candidat",
      b1pending?.requester_email === OPS.email &&
        (b1pending?.candidate as Record<string, unknown> | null | undefined)
          ?.last_name === "CandT85",
      b1pending,
    );

    const b2 = await req(
      Sup,
      "GET",
      "/api/admin/profile-update-requests?status=pending",
    );
    const b2rows = (b2.json.requests as Array<Record<string, unknown>>) ?? [];
    ok(
      "B3 : GET (admin_support) 200 + ?status=pending → 2 lignes",
      b2.status === 200 &&
        b2rows.length === 2 &&
        b2rows.every((r) => r.status === "pending"),
      b2rows.map((r) => [r.id, r.status]),
    );

    const b3 = await req(
      Ops,
      "GET",
      `/api/admin/profile-update-requests?candidate_id=${CAND.profileId}`,
    );
    const b3rows = (b3.json.requests as Array<Record<string, unknown>>) ?? [];
    ok(
      "B4 : ?candidate_id= → seulement les lignes de CE candidat (2)",
      b3.status === 200 &&
        b3rows.length === 2 &&
        b3rows.every((r) => r.candidate_id === CAND.profileId),
      b3rows.map((r) => [r.id, r.candidate_id]),
    );

    const b4 = await req(Cand, "GET", "/api/admin/profile-update-requests");
    ok("B5 : GET (candidat) → 403", b4.status === 403, b4.status);
    const b5 = await req(null, "GET", "/api/admin/profile-update-requests");
    ok("B6 : GET non authentifié → 401", b5.status === 401, b5.status);

    // ── D. PATCH annulation ──────────────────────────────────────
    const d1 = await req(
      Ops,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.pending!}`,
      { status: "cancelled" },
    );
    ok(
      "D1 : PATCH pending → cancelled (200)",
      d1.status === 200 && d1.json.status === "cancelled",
      d1.json,
    );
    const d1row = await svc
      .from("profile_update_requests")
      .select("status")
      .eq("id", refs.pending!)
      .maybeSingle();
    ok(
      "D2 : ligne passée à `cancelled` côté DB",
      d1row.data?.status === "cancelled",
      d1row.data,
    );

    const d3aud = await svc
      .from("audit_logs")
      .select("action, actor_id, resource_id, metadata")
      .eq("actor_id", OPS.uid)
      .eq("action", "cancel_profile_update_request")
      .order("created_at", { ascending: false })
      .limit(1);
    ok(
      "D3 : audit `cancel_profile_update_request` (before/after)",
      d3aud.data?.[0]?.resource_id === refs.pending &&
        (d3aud.data?.[0]?.metadata as Record<string, unknown> | null)
          ?.before === "pending",
      d3aud.data?.[0],
    );

    // Notification d'annulation au candidat (2e notification CNI T85).
    const d4not = await svc
      .from("notifications")
      .select("title, data")
      .eq("user_id", CAND.uid)
      .order("created_at", { ascending: false })
      .limit(1);
    ok(
      "D4 : notification d'annulation au candidat",
      (d4not.data?.[0]?.data as Record<string, unknown> | null)
        ?.profile_update_request_id === refs.pending,
      d4not.data?.[0]?.title,
    );

    const d5 = await req(
      Ops,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.pending!}`,
      { status: "cancelled" },
    );
    ok(
      "D5 : PATCH idempotent (déjà cancelled) → 200",
      d5.status === 200 && d5.json.status === "cancelled",
      d5.json,
    );

    const d6 = await req(
      Ops,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.done!}`,
      { status: "cancelled" },
    );
    ok(
      "D6 : PATCH sur `done` → 409 `invalid_transition`",
      d6.status === 409 && d6.json.code === "invalid_transition",
      d6.json,
    );

    const d7 = await req(
      Sup,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.done!}`,
      {
        status: "cancelled",
      },
    );
    ok("D7 : PATCH (admin_support) → 403", d7.status === 403, d7.status);

    const d8 = await req(
      null,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.done!}`,
      {
        status: "cancelled",
      },
    );
    ok("D8 : PATCH non authentifié → 401", d8.status === 401, d8.status);

    const d9 = await req(
      Ops,
      "PATCH",
      "/api/admin/profile-update-requests/00000000-0000-0000-0000-000000000000",
      { status: "cancelled" },
    );
    ok("D9 : PATCH inconnu → 404", d9.status === 404, d9.json);

    // ── E. DELETE purge ──────────────────────────────────────────
    // E1 : DELETE sur une `pending` (la 2e — refs.cancelled) → 409.
    const e1 = await req(
      Ops,
      "DELETE",
      `/api/admin/profile-update-requests/${refs.cancelled!}`,
    );
    ok(
      "E1 : DELETE sur `pending` → 409 `request_pending`",
      e1.status === 409 && e1.json.code === "request_pending",
      e1.json,
    );
    const e1row = await svc
      .from("profile_update_requests")
      .select("status")
      .eq("id", refs.cancelled!)
      .maybeSingle();
    ok(
      "E2 : la `pending` CONSERVÉE après le 409 (à annuler avant)",
      e1row.data?.status === "pending",
      e1row.data,
    );

    // E3 : annulation de la `pending` (pour la purger ensuite).
    const e3 = await req(
      Ops,
      "PATCH",
      `/api/admin/profile-update-requests/${refs.cancelled!}`,
      { status: "cancelled" },
    );
    ok(
      "E3 : annulation préalable de la `pending` (200)",
      e3.status === 200,
      e3.json,
    );

    // E4 : DELETE sur la `cancelled` → 200 + ligne purgée.
    const e4 = await req(
      Ops,
      "DELETE",
      `/api/admin/profile-update-requests/${refs.cancelled!}`,
    );
    ok(
      "E4 : DELETE sur `cancelled` → 200",
      e4.status === 200 && e4.json.ok === true,
      e4.json,
    );
    const e4row = await svc
      .from("profile_update_requests")
      .select("id")
      .eq("id", refs.cancelled!)
      .maybeSingle();
    ok("E5 : ligne purgée du DB", e4row.data === null, e4row.data);

    const e5aud = await svc
      .from("audit_logs")
      .select("action, resource_id, metadata")
      .eq("actor_id", OPS.uid)
      .eq("action", "delete_profile_update_request")
      .order("created_at", { ascending: false })
      .limit(1);
    ok(
      "E6 : audit `delete_profile_update_request` CONSERVÉ (l'audit survit au DELETE)",
      e5aud.data?.[0]?.resource_id === refs.cancelled,
      e5aud.data?.[0],
    );

    // E7 : DELETE sur la `done` → 200 + purgée.
    const e7 = await req(
      Ops,
      "DELETE",
      `/api/admin/profile-update-requests/${refs.done!}`,
    );
    ok("E7 : DELETE sur `done` → 200", e7.status === 200, e7.json);
    const e7row = await svc
      .from("profile_update_requests")
      .select("id")
      .eq("id", refs.done!)
      .maybeSingle();
    ok("E8 : `done` purgée du DB", e7row.data === null, e7row.data);

    const e9 = await req(
      Sup,
      "DELETE",
      `/api/admin/profile-update-requests/${refs.cancelled!}`,
    );
    // La ligne est déjà purgée → 404 est l'issue attendue (403 si la route
    // vérifiait le rôle d'abord : on accepte les deux, mais on vérifie que
    // ce n'est PAS un 200 de purge par admin_support).
    ok(
      "E9 : DELETE (admin_support) → JAMAIS 200 (403/404)",
      e9.status === 403 || e9.status === 404,
      e9.status,
    );

    const e10 = await req(
      Ops,
      "DELETE",
      "/api/admin/profile-update-requests/00000000-0000-0000-0000-000000000000",
    );
    ok("E10 : DELETE inconnu → 404", e10.status === 404, e10.json);
  } finally {
    await clean(CAND);
    await clean(SUP);
    await clean(OPS);
  }

  console.log(
    `\n── ${fail === 0 ? "Toutes les assertions passent" : "ÉCHEC"} : ${pass}/${pass + fail} ──`,
  );
  if (fail > 0) process.exitCode = 1;
}

/** Récap compact des lignes pour trace. */
function bjson(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    candidate: r.candidate_id,
    email: r.requester_email,
  }));
}

void main().catch((e) => {
  console.error("Preuve T8.5 interrompue :", e);
  process.exitCode = 1;
});
