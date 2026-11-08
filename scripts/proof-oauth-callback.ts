/**
 * Preuve lot 8 — retour OAuth `/auth/callback` (F-13, F-03c).
 *
 * Méthode (aucun appel à Google) :
 *   - `signInWithOAuth({ skipBrowserRedirect: true })` d'un client
 *     @supabase/ssr génère le vérificateur PKCE dans un pot de cookies et
 *     l'URL d'autorisation, sans requête réseau.
 *   - La ligne `auth.flow_state` que Supabase Auth crée au retour du
 *     fournisseur est posée en base (même `code_challenge`, fournisseur
 *     `google`, code d'autorisation à usage unique).
 *   - La route réelle de l'application est appelée avec ces cookies,
 *     `redirect: "manual"` : la destination finale est l'en-tête `Location`.
 *
 * Cas :
 *   R. destinations : chemin interne avec query string accepté ; URL
 *      externe, //domaine, barre oblique inverse, @domaine et variantes
 *      encodées ramenés à `/` ; la redirection reste sur l'origine de l'app.
 *   E. erreurs : sans code, code invalide → `/auth/error`, page servie avec
 *      une action pour reprendre la connexion.
 *   A. compte existant (candidat vérifié) revenant par l'inscription
 *      entreprise : rôle en base et app_metadata inchangés. Nouveau compte :
 *      ligne users créée avec le rôle de l'inscription, app_metadata intact.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";

type DB = SupabaseClient<Database>;

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const EMAIL_PREFIX = "proof-l8-oauth-";
const PROOF_METADATA = { proofOauthCallback: true };
const APP_ORIGIN = new URL(APP_URL).origin;

const service: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`,
  );
}

function execSql(sql: string) {
  const tmp = path.join(os.tmpdir(), `proof-oauth-callback-${Date.now()}.sql`);
  fs.writeFileSync(tmp, sql, "utf-8");
  const command = "pnpm exec supabase db query --output-format json";
  const isWin = process.platform === "win32";
  const args = isWin
    ? ["/d", "/s", "/c", `${command} --db-url ${DB_URL} -f ${tmp}`]
    : ["-c", `${command} --db-url '${DB_URL}' -f '${tmp}'`];
  const r = spawnSync(isWin ? "cmd.exe" : "sh", args, {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0)
    throw new Error(
      `supabase db query : ${(r.stdout || r.stderr || "").slice(0, 300)}`,
    );
}

const created: string[] = [];
const run = Date.now();

async function makeUser(tag: string): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `${EMAIL_PREFIX}${tag}-${run}@example.test`,
    email_confirm: true,
    user_metadata: PROOF_METADATA,
  });
  if (error || !data.user)
    throw new Error(`createUser(${tag}) : ${error?.message}`);
  created.push(data.user.id);
  return data.user.id;
}

/**
 * Prépare un retour OAuth pour `userId` : cookies PKCE réels et code
 * d'autorisation enregistré par Supabase Auth.
 */
async function oauthReturn(
  userId: string,
): Promise<{ code: string; cookie: string }> {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (entries) => {
        for (const { name, value } of entries) {
          if (value === "") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${APP_URL}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url)
    throw new Error(`signInWithOAuth : ${error?.message}`);
  const challenge = new URL(data.url).searchParams.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge))
    throw new Error("code_challenge inattendu");
  const code = randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("uuid attendu");
  execSql(
    "insert into auth.flow_state (id, user_id, auth_code, code_challenge_method, code_challenge, " +
      "provider_type, provider_access_token, provider_refresh_token, authentication_method, " +
      "created_at, updated_at, auth_code_issued_at) values (gen_random_uuid(), " +
      `'${userId}', '${code}', 's256', '${challenge}', 'google', '', '', 'oauth', now(), now(), now())`,
  );
  return {
    code,
    cookie: [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; "),
  };
}

async function callback(
  query: string,
  cookie = "",
): Promise<{ status: number; location: string | null }> {
  const res = await appFetch(`${APP_URL}/auth/callback?${query}`, {
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: res.status, location: res.headers.get("location") };
}

const expectLocation = (path: string) => new URL(path, APP_ORIGIN).toString();

async function cleanup(ids: string[]) {
  if (ids.length === 0) return;
  await service.from("users").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
}

async function cleanupLeftovers() {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  await cleanup(
    (data?.users ?? [])
      .filter(
        (u) =>
          u.email?.startsWith(EMAIL_PREFIX) &&
          u.user_metadata?.proofOauthCallback === true,
      )
      .map((u) => u.id),
  );
}

async function main() {
  await cleanupLeftovers();

  // ── R. Destinations ──
  const visitor = await makeUser("visitor");
  // [libellé, valeur de `next` telle qu'écrite dans l'URL, destination attendue]
  const cases: [string, string, string][] = [
    [
      "R1. chemin interne avec query string",
      encodeURIComponent("/jobs?city=Douala&q=a%20b"),
      "/jobs?city=Douala&q=a%20b",
    ],
    ["R2. URL externe", encodeURIComponent("https://evil.example/login"), "/"],
    ["R3. //domaine", encodeURIComponent("//evil.example"), "/"],
    ["R4. //domaine non encodé", "//evil.example", "/"],
    ["R5. barre oblique inverse", encodeURIComponent("/\\evil.example"), "/"],
    [
      "R6. @domaine (ancienne concaténation origin+next)",
      encodeURIComponent("@evil.example"),
      "/",
    ],
    ["R7. // encodé deux fois", encodeURIComponent("%2F%2Fevil.example"), "/"],
    ["R8. \\ encodé", encodeURIComponent("/%5Cevil.example"), "/"],
    [
      "R9. / puis / encodé deux fois",
      encodeURIComponent("/%252Fevil.example"),
      "/",
    ],
    ["R10. sans next", "", "/"],
  ];
  for (const [label, next, expected] of cases) {
    const { code, cookie } = await oauthReturn(visitor);
    const r = await callback(
      `code=${code}${next ? `&next=${next}` : ""}`,
      cookie,
    );
    const host = r.location ? new URL(r.location).origin : null;
    report(
      `${label} → ${expected}`,
      r.status >= 300 &&
        r.status < 400 &&
        r.location === expectLocation(expected) &&
        host === APP_ORIGIN,
      r,
    );
  }

  // ── E. Erreurs ──
  {
    const noCode = await callback(`next=${encodeURIComponent("/jobs")}`);
    const badCode = await callback(
      `code=${randomUUID()}&next=${encodeURIComponent("/jobs")}`,
    );
    const providerError = await callback(
      "error=access_denied&error_description=%3Cscript%3E",
    );
    report(
      "E1. sans code, code invalide ou erreur du fournisseur → /auth/error",
      [noCode, badCode, providerError].every(
        (r) => r.location === expectLocation("/auth/error"),
      ),
      { noCode, badCode, providerError },
    );
    const page = await appFetch(`${APP_URL}/auth/error`, {
      headers: { Accept: "text/html" },
    });
    const html = await page.text();
    report(
      "E2. /auth/error existe et propose de reprendre la connexion",
      page.status === 200 &&
        html.includes('href="/auth/login"') &&
        html.includes("Reprendre la connexion"),
      { status: page.status },
    );
  }

  // ── A. Rôle d'un compte existant ──
  {
    const existing = await makeUser("existing");
    await service.from("users").insert({
      id: existing,
      email: `${EMAIL_PREFIX}existing-${run}@example.test`,
      role: "candidate",
      phone_verified: true,
      phone: `+23769${String(run % 10_000_000).padStart(7, "0")}`,
    });
    await service.auth.admin.updateUserById(existing, {
      app_metadata: { role: "candidate", phone_verified: true },
    });
    const { code, cookie } = await oauthReturn(existing);
    const r = await callback(
      `code=${code}&next=${encodeURIComponent("/auth/signup/company?step=phone")}`,
      cookie,
    );
    const { data: row } = await service
      .from("users")
      .select("role, phone_verified")
      .eq("id", existing)
      .single();
    const { data: auth } = await service.auth.admin.getUserById(existing);
    report(
      "A1. compte candidat existant via l'inscription entreprise : rôle en base et app_metadata inchangés",
      r.location === expectLocation("/auth/signup/company?step=phone") &&
        row?.role === "candidate" &&
        row?.phone_verified === true &&
        auth.user?.app_metadata?.role === "candidate" &&
        auth.user?.app_metadata?.phone_verified === true,
      { location: r.location, row, app: auth.user?.app_metadata },
    );

    const fresh = await makeUser("fresh");
    const ret = await oauthReturn(fresh);
    await callback(
      `code=${ret.code}&next=${encodeURIComponent("/auth/signup/company?step=phone")}`,
      ret.cookie,
    );
    const { data: freshRow } = await service
      .from("users")
      .select("role, phone_verified")
      .eq("id", fresh)
      .single();
    const { data: freshAuth } = await service.auth.admin.getUserById(fresh);
    report(
      "A2. nouveau compte via l'inscription entreprise : ligne users « company », non vérifiée, app_metadata sans rôle",
      freshRow?.role === "company" &&
        freshRow?.phone_verified !== true &&
        freshAuth.user?.app_metadata?.role === undefined,
      { freshRow, app: freshAuth.user?.app_metadata },
    );

    const sneaky = await makeUser("sneaky");
    const s = await oauthReturn(sneaky);
    await callback(
      `code=${s.code}&next=${encodeURIComponent("/jobs?x=/auth/signup/company")}`,
      s.cookie,
    );
    const { data: sneakyRow } = await service
      .from("users")
      .select("role")
      .eq("id", sneaky)
      .maybeSingle();
    report(
      "A3. « /signup/company » dans la query string ne crée aucune ligne ni rôle",
      sneakyRow === null,
      sneakyRow,
    );
  }
}

main()
  .catch((e: unknown) => report("exécution", false, (e as Error).message))
  .finally(async () => {
    await cleanup(created).catch(() => undefined);
    console.log(`\n${passCount} réussies, ${failCount} échecs`);
    process.exitCode = failCount > 0 ? 1 : 0;
  });
