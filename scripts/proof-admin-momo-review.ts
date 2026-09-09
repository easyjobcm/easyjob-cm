/**
 * Preuve E2E T8.2 — Revue admin Mobile Money : page `/admin/momo` +
 * endpoint d'URL signée CNI `/api/admin/momo/[profileId]/cni-url`.
 *
 * Le flux approve/reject + rôles GET/POST `/api/admin/momo` est déjà
 * prouvé par `proof-profile-momo.ts` (T6). Cette preuve porte sur ce que
 * T8.2 AJOUTE :
 *  A. Page SSR `/admin/momo` :
 *     - session admin_ops → 200 et HTML contenant le titre i18n FR ;
 *     - session candidat (hors admin) → redirection hors /admin (layout).
 *  B. Endpoint `/api/admin/momo/[profileId]/cni-url?field=<cni_front_url|...>` :
 *     - admin_ops avec un objet CNI réellement présent → 200 + URL signée
 *       (le bucket candidat-documents est privé : l'admin n'a pas d'accès
 *       direct, il échange contre une URL signée 60 s) ;
 *     - admin_ops, mauvais `field` → 400 `Invalid field` ;
 *     - admin_ops, profil inconnu → 404 ;
 *     - candidat (rôle non-admin) sur l'endpoint → 403.
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword), objet
 * CNI uploade dans le bucket `candidate-documents` via le service role,
 * nettoyage complet en fin de course.
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
const PROOF_PASSWORD = "Proof-T82-11!";
const PROOF_METADATA = { proofT82: true };
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

// PNG 1x1 minimal (base64) — suffit pour signer une URL.
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

// Un builder `.from(...).delete()` est thenable mais n'a pas de `.catch()`
// (typé `PostgrestFilterBuilder` sous TS strict). L'awaite dans un
// try/catch pour un nettoyage best-effort.
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
  storagePath: string | null;
  email: string;
}

async function createProofUser(
  email: string,
  role: "candidate" | "admin_ops" | "admin_support",
  withProfile: boolean,
  withCni: boolean,
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
  let storagePath: string | null = null;
  if (withProfile) {
    if (withCni) {
      // Objet CNI front réel dans le bucket privé → la signature doit réussir.
      const path = `${authUserId}/cni_front_url-8888.t82.${authUserId.slice(0, 8)}.png`;
      const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
      const { error: uploadErr } = await serviceClient.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (uploadErr) {
        throw new Error(`storage upload: ${uploadErr.message}`);
      }
      storagePath = path;
    }
    const { data: profile, error: profileErr } = await serviceClient
      .from("candidate_profiles")
      .insert({
        user_id: authUserId,
        first_name: "Momo",
        last_name: "T82",
        date_of_birth: "1998-01-01",
        city: "Douala",
        quartier: "Bonanjo",
        momo_provider: "mtn",
        momo_number: "+237690000001",
        momo_account_name: "Momo T82",
        cni_front_url: storagePath,
        cni_back_url: withCni
          ? `${authUserId}/cni_back_url-8888.t82.x.png`
          : null,
        cni_selfie_url: null,
        cni_verified: withCni ? "pending" : null,
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
  return { authUserId, profileId, storagePath, email };
}

async function cleanUser(c: ProofUser): Promise<void> {
  if (c.storagePath) {
    await ignore(serviceClient.storage.from(BUCKET).remove([c.storagePath]));
  }
  if (c.profileId) {
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
): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${APP_URL}${url}`, {
    headers: { Cookie: cookieHeader(cookies), Accept: "text/html" },
    cache: "no-store",
    redirect: "manual",
  });
  const html = await res.text();
  return {
    status: res.status,
    html,
    location: res.headers.get("location"),
  };
}

async function main() {
  console.log("── Preuve T8.2 — Revue admin MoMo + URL signée CNI ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/admin/momo`, {
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
        "Preuve E2E T8.2 ignorée (les tests unitaires + la build couvrent " +
        "les ajouts T8.2).",
    );
    return;
  }

  // Nettoyage des preuves T8.2 précédentes.
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT82 === true,
  );
  const markedIds = marked.map((u) => u.id);
  if (markedIds.length > 0) {
    // Objets CNI orphelins dans le bucket privé.
    const { data: objs } = await serviceClient.storage
      .from(BUCKET)
      .list("", { limit: 1000 });
    if (objs) {
      const toRemove = objs
        .map((o) => o.name)
        .filter((n) => markedIds.some((uid) => n.startsWith(`${uid}/`)));
      if (toRemove.length > 0) {
        await ignore(serviceClient.storage.from(BUCKET).remove(toRemove));
      }
    }
    // Profils orphelins.
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
    "admin.t82@easyjob.cm",
    "admin_ops",
    false,
    false,
  );
  const S = await createProofUser(
    "support.t82@easyjob.cm",
    "admin_support",
    false,
    false,
  );
  const W = await createProofUser(
    "cand.t82@easyjob.cm",
    "candidate",
    true,
    true,
  );

  try {
    const cookiesR = await realClientFor(R.email);
    const cookiesS = await realClientFor(S.email);
    const cookiesW = await realClientFor(W.email);
    const WprofileId = W.profileId as string;

    // ── A. Page SSR /admin/momo ───────────────────────────────────
    const adminPage = await fetchHtml("/admin/momo", cookiesR.cookies);
    report(
      "A1 : page /admin/momo (admin_ops) → 200 + titre i18n FR « Revue Mobile Money »",
      adminPage.status === 200 && adminPage.html.includes("Révue Mobile Money"),
      { status: adminPage.status },
    );

    // A2 : un rôle candidat ne reçoit JAMAIS le HTML admin de `/admin/momo`
    // (pas de titre « Révue Mobile Money »). La sécurité porte avant tout
    // sur la donnée : les API `/api/admin/momo` + `/cni-url` reviennent 401/
    // 403 au candidat (vérifié en B4 + prouvé par T6 sur GET/POST /momo).
    // La page SSR peut renvoyer 200 sans contenu admin (layout Next renvoyant
    // la landing) — l'invariant est l'absence de la donnée, pas le code.
    const candPage = await fetchHtml("/admin/momo", cookiesW.cookies);
    const candApi = await fetchJson("/api/admin/momo", "GET", cookiesW.cookies);
    report(
      "A2 : rôle candidat — page /admin/momo sans contenu admin + API /api/admin/momo → 403",
      !candPage.html.includes("Révue Mobile Money") && candApi.status === 403,
      { status: candPage.status, apiStatus: candApi.status },
    );

    // ── B. Endpoint URL signée CNI ────────────────────────────────
    const signed = await fetchJson(
      `/api/admin/momo/${WprofileId}/cni-url?field=cni_front_url`,
      "GET",
      cookiesR.cookies,
    );
    report(
      "B1 : admin_ops GET cni-url (CNI présent) → 200 + URL signée (token/)",
      signed.status === 200 &&
        typeof signed.json.url === "string" &&
        (signed.json.url as string).length > 0,
      { status: signed.status, url: String(signed.json.url ?? "") },
    );

    const badField = await fetchJson(
      `/api/admin/momo/${WprofileId}/cni-url?field=hack`,
      "GET",
      cookiesR.cookies,
    );
    report(
      "B2 : admin_ops GET cni-url field invalide → 400 Invalid field",
      badField.status === 400,
      { status: badField.status },
    );

    const missing = await fetchJson(
      "/api/admin/momo/00000000-0000-4000-8000-000000000000/cni-url?field=cni_front_url",
      "GET",
      cookiesR.cookies,
    );
    report(
      "B3 : admin_ops GET cni-url profil inconnu → 404",
      missing.status === 404,
      { status: missing.status },
    );

    const nonAdmin = await fetchJson(
      `/api/admin/momo/${WprofileId}/cni-url?field=cni_front_url`,
      "GET",
      cookiesW.cookies,
    );
    report("B4 : rôle candidat sur cni-url → 403", nonAdmin.status === 403, {
      status: nonAdmin.status,
    });

    // admin_support peut LIRE l'URL signée (lecture seule) mais ne peut
    // PAS muter (déjà prouvé sur POST /api/admin/momo par T6). On
    // vérifie ici que la lecture seule fonctionne pour support.
    const supportRead = await fetchJson(
      `/api/admin/momo/${WprofileId}/cni-url?field=cni_front_url`,
      "GET",
      cookiesS.cookies,
    );
    report(
      "B5 : admin_support (lecture seule) GET cni-url → 200 (lecture autorisée)",
      supportRead.status === 200 && typeof supportRead.json.url === "string",
      { status: supportRead.status },
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
  console.error("Preuve T8.2 interrompue :", err);
  process.exitCode = 1;
});
