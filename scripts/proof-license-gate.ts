/**
 * Preuve E2E T3.1 — catégories de permis + verrou des compétences de
 * conduite (SRS §6.14.2).
 *
 * Méthode (même philosophie que les preuves T0/T1/T2/T3) :
 *   1. Seeds en service role : candidats avec / sans permis vérifié
 *      (`candidate_documents` seedés en `status = 'verified'`).
 *   2. Sessions RÉELLES : signInWithPassword(email) via @supabase/ssr
 *      createServerClient (la même fonction que l'app) — l'INSERT passe
 *      par la RLS candidat, et le TRIGGER prouve qu'il est au niveau DB
 *      (pas juste client).
 *   3. Assertions :
 *      A. Candidat SANS permis : INSERT « Conduite moto » (session) →
 *         REFUSÉ préfixe EASYJOB_LICENSE_REQUIRED ; « Cuisine » OK ;
 *         insertion service role → REFUSÉ aussi (trigger indépendant RLS).
 *      B. Permis moto vérifié : « Conduite moto » OK ; « Conduite voiture »
 *         REFUSÉ (strict par catégorie).
 *      C. Permis tous_types vérifié : « Conduite camion » + « Conduite moto »
 *         OK (wildcard).
 *      D. Permis camion vérifié : « Conduite fourgon » OK (set {fourgon,
 *         camion}) ; « Conduite bus » REFUSÉ (pas de transitivité).
 *      E. RPC SQL `has_verified_license_for` : table de vérité complète par
 *         candidat (équiv. SQL ↔ TS).
 *      F. Onboarding (HTML SSR, cookies réels) : chips « Conduite moto » /
 *         « Conduite voiture » `disabled` sans permis couvrant ; « Conduite
 *         moto » active avec un permis moto vérifié.
 *   4. Nettoyage complet des lignes de preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;
type LicenseCat =
  | "moto"
  | "voiture"
  | "fourgon"
  | "camion"
  | "bus"
  | "tous_types";

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
const PROOF_PASSWORD = "Proof-T31-98!";
const PROOF_USER_METADATA = { proofT31: true };
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

async function getHtml(
  cookies: CookieEntry[],
  reqPath: string,
): Promise<{ status: number; html: string }> {
  const res = await fetch(`${APP_URL}${reqPath}`, {
    headers: { Cookie: cookieHeader(cookies), Accept: "text/html" },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await res.text();
  return { status: res.status, html };
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tag <button> dont le texte est exactement `label` (chips onboarding). */
function buttonTagFor(html: string, label: string): string | null {
  const re = new RegExp(`<button[^>]*>${escapeRegex(label)}</button>`, "i");
  const m = html.match(re);
  return m ? m[0] : null;
}

// ─── Seed / cleanup ──────────────────────────────────────────────
interface ProofUser {
  authUserId: string;
  profileId: string;
  email: string;
}

async function createTestCandidate(
  email: string,
  onboardingStep: number,
): Promise<ProofUser> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role: "candidate", phone_verified: true },
  });
  if (error || !created.user) {
    throw new Error(`user creation failed: ${error?.message}`);
  }
  const authUserId = created.user.id;

  const { error: rowsErr } = await serviceClient.from("users").insert({
    id: authUserId,
    email,
    role: "candidate",
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  const { data: profile, error: profileErr } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: authUserId,
      first_name: "Permis",
      last_name: "Testeur",
      date_of_birth: "1995-07-07",
      city: "Douala",
      quartier: "Bonanjo",
      cni_verified: "pending",
      momo_verified: false,
      onboarding_step: onboardingStep,
      onboarding_status: onboardingStep > 4 ? "completed" : "in_progress",
      profile_completion_pct: 60,
      sandbox_level: 0,
    })
    .select("id")
    .single();
  if (profileErr || !profile) {
    throw new Error(`profile insert: ${profileErr?.message}`);
  }
  return { authUserId, profileId: profile.id, email };
}

async function seedVerifiedLicense(
  candidateId: string,
  category: LicenseCat,
): Promise<void> {
  const { error } = await serviceClient.from("candidate_documents").insert({
    candidate_id: candidateId,
    document_type: "permis_conduire",
    title: `Permis ${category} (preuve T3.1)`,
    issuing_organization: "Ministere des Transports (preuve)",
    issued_at: "2024-01-01",
    expires_at: "2029-01-01",
    status: "verified",
    license_category: category,
    storage_path: "license-gate-proof/permis-seeded.png",
  });
  if (error) throw new Error(`seed license ${category}: ${error.message}`);
}

async function countSkills(
  candidateId: string,
  skillName: string,
): Promise<number> {
  const { data, error } = await serviceClient
    .from("candidate_skills")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("skill_name", skillName);
  if (error) throw new Error(`countSkills: ${error.message}`);
  return (data ?? []).length;
}

async function cleanCandidate(c: ProofUser): Promise<void> {
  await serviceClient
    .from("candidate_documents")
    .delete()
    .eq("candidate_id", c.profileId);
  await serviceClient
    .from("candidate_skills")
    .delete()
    .eq("candidate_id", c.profileId);
  await serviceClient
    .from("candidate_profiles")
    .delete()
    .eq("user_id", c.authUserId);
  await serviceClient.from("users").delete().eq("id", c.authUserId);
  await serviceClient.auth.admin.deleteUser(c.authUserId).catch(() => {});
  const { data: notifs } = await serviceClient
    .from("notifications")
    .select("id")
    .eq("user_id", c.authUserId);
  if (notifs?.length) {
    await serviceClient
      .from("notifications")
      .delete()
      .in(
        "id",
        notifs.map((n) => n.id),
      );
  }
}

// ─── SQL local (bypass système) via `supabase db query` ──────────
function runPsql(sql: string): { ok: boolean; out: string } {
  // Le chemin temp ne contient jamais d'espace (tempfile dans %TEMP%) →
  // guillemets inutiles (et brisants avec `cmd /c` qui re-quote la chaîne).
  const tmp = path.join(os.tmpdir(), `proof-license-gate-${Date.now()}.sql`);
  fs.writeFileSync(tmp, sql, "utf-8");
  const isWin = process.platform === "win32";
  const args = isWin
    ? ["/d", "/s", "/c", `pnpm exec supabase db query --local -f ${tmp}`]
    : ["-c", `pnpm exec supabase db query --local -f '${tmp}'`];
  const r = spawnSync(isWin ? "cmd.exe" : "sh", args, {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  fs.rmSync(tmp, { force: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) return { ok: false, out: `${r.error}\n${out}` };
  return { ok: r.status === 0, out };
}

// ─── Scénario ────────────────────────────────────────────────────
async function main() {
  console.log("── Preuve T3.1 — permis + verrou conduite (SRS §6.14.2) ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/profile/skills`, {
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
        "Preuve E2E ignorée (les tests unitaires tests/license-requirements.test.ts " +
        "couvrent le mapping/sets en TS ; la migration est appliquée en local).",
    );
    return;
  }

  // Nettoyage des preuves T3.1 précédentes.
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT31 === true,
  );
  if (marked.length > 0) {
    const ids = marked.map((u) => u.id);
    const { data: profiles } = await serviceClient
      .from("candidate_profiles")
      .select("id")
      .in("user_id", ids);
    const pids = (profiles ?? []).map((p) => p.id as string);
    if (pids.length > 0) {
      await serviceClient
        .from("candidate_documents")
        .delete()
        .in("candidate_id", pids);
      await serviceClient
        .from("candidate_skills")
        .delete()
        .in("candidate_id", pids);
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
  const mk = (tag: string) => `t31-${tag}+${suffix}@proof.easyjob.cm`;

  const completed: ProofUser[] = [];
  const inOnboarding: ProofUser[] = [];
  const allCleanup: ProofUser[] = [];
  for (const tag of ["a", "b", "c", "d", "g"]) {
    completed.push(await createTestCandidate(mk(tag), 4));
  }
  inOnboarding.push(await createTestCandidate(mk("o1"), 3));
  inOnboarding.push(await createTestCandidate(mk("o2"), 3));
  allCleanup.push(...completed, ...inOnboarding);

  const [candA, candB, candC, candD, candG] = completed;
  const [candO1, candO2] = inOnboarding;

  const clients = new Map<string, DB>();
  const cookiesOfUser = new Map<string, CookieEntry[]>();
  for (const c of allCleanup) {
    const { client, cookies } = await realClientFor(c.email);
    clients.set(c.email, client);
    cookiesOfUser.set(c.email, cookies);
  }

  // Permis seedés (service role, statut `verified`) — simulation d'une
  // validation admin déjà effectuée.
  await seedVerifiedLicense(candB.profileId, "moto");
  await seedVerifiedLicense(candC.profileId, "tous_types");
  await seedVerifiedLicense(candD.profileId, "camion");
  await seedVerifiedLicense(candO2.profileId, "moto");

  try {
    const insertAs = (
      c: ProofUser,
      skill: string,
    ): Promise<{ refused: boolean; error: string; rows: number }> =>
      (async () => {
        const client = clients.get(c.email)!;
        const { error } = await client
          .from("candidate_skills")
          .insert({
            candidate_id: c.profileId,
            skill_name: skill,
            skill_level: 3,
          })
          .select("id");
        const refused =
          !!error &&
          typeof error.message === "string" &&
          error.message.includes("EASYJOB_LICENSE_REQUIRED");
        const rows = await countSkills(c.profileId, skill);
        return { refused, error: error?.message ?? "", rows };
      })();

    // ── A. Candidat SANS permis ─────────────────────────────────
    const a1 = await insertAs(candA, "Conduite moto");
    report(
      "A1 : sans permis, INSERT « Conduite moto » (session réelle) REFUSÉ + préfixe EASYJOB_LICENSE_REQUIRED",
      a1.refused && a1.rows === 0,
      a1,
    );
    const { data: reqMoto, error: drvCheck } = await serviceClient.rpc(
      "skill_requires_license",
      { p_skill_name: "Conduite moto" },
    );
    report(
      "A2 : RPC skill_requires_license('Conduite moto') = 'moto'",
      !drvCheck && reqMoto === "moto",
      { got: reqMoto },
    );
    const a3 = await insertAs(candA, "Cuisine");
    report(
      "A3 : sans permis, INSERT « Cuisine » (non-conduite) OK (1 ligne)",
      !a3.refused && a3.rows === 1,
      a3,
    );
    const { error: svcErr } = await serviceClient
      .from("candidate_skills")
      .insert({
        candidate_id: candA.profileId,
        skill_name: "Conduite moto",
        skill_level: 3,
      });
    report(
      "A4 : le REJET s'applique aussi au service role (trigger DB, pas RLS)",
      !!svcErr && svcErr.message.includes("EASYJOB_LICENSE_REQUIRED"),
      svcErr?.message,
    );

    // ── B. Permis moto vérifié ───────────────────────────────────
    const b1 = await insertAs(candB, "Conduite moto");
    report(
      "B1 : permis moto vérifié → « Conduite moto » INSERT OK",
      !b1.refused && b1.rows === 1,
      b1,
    );
    const b2 = await insertAs(candB, "Conduite voiture");
    report(
      "B2 : permis moto ≠ voiture → « Conduite voiture » REFUSÉ (strict)",
      b2.refused && b2.rows === 0,
      b2,
    );

    // ── C. Permis tous_types vérifié (wildcard) ──────────────────
    const c1 = await insertAs(candC, "Conduite camion");
    report(
      "C1 : tous_types (wildcard) → « Conduite camion » INSERT OK",
      !c1.refused && c1.rows === 1,
      c1,
    );
    const c2 = await insertAs(candC, "Conduite moto");
    report(
      "C2 : tous_types (wildcard) → « Conduite moto » INSERT OK",
      !c2.refused && c2.rows === 1,
      c2,
    );

    // ── D. Permis camion vérifié (set {fourgon, camion}) ─────────
    const d1 = await insertAs(candD, "Conduite fourgon");
    report(
      "D1 : permis camion couvre fourgon (set) → « Conduite fourgon » INSERT OK",
      !d1.refused && d1.rows === 1,
      d1,
    );
    const d2 = await insertAs(candD, "Conduite bus");
    report(
      "D2 : pas de transitivité → « Conduite bus » avec un permis camion REFUSÉ",
      d2.refused && d2.rows === 0,
      d2,
    );

    // ── E. Table de vérité RPC has_verified_license_for ─────────
    const TRUTH: Record<string, Record<string, boolean>> = {
      [candA.profileId]: {
        "Conduite moto": false,
        "Taxi moto": false,
        "Livraison moto": false,
        "Conduite voiture": false,
        "Livraison voiture": false,
        "Conduite fourgon": false,
        "Conduite camion": false,
        "Conduite bus": false,
        Cuisine: true,
      },
      [candB.profileId]: {
        "Conduite moto": true,
        "Taxi moto": true,
        "Livraison moto": true,
        "Conduite voiture": false,
        "Livraison voiture": false,
        "Conduite fourgon": false,
        "Conduite camion": false,
        "Conduite bus": false,
        Cuisine: true,
      },
      [candC.profileId]: {
        "Conduite moto": true,
        "Taxi moto": true,
        "Livraison moto": true,
        "Conduite voiture": true,
        "Livraison voiture": true,
        "Conduite fourgon": true,
        "Conduite camion": true,
        "Conduite bus": true,
        Cuisine: true,
      },
      [candD.profileId]: {
        "Conduite moto": false,
        "Taxi moto": false,
        "Livraison moto": false,
        "Conduite voiture": false,
        "Livraison voiture": false,
        "Conduite fourgon": true,
        "Conduite camion": true,
        "Conduite bus": false,
        Cuisine: true,
      },
    };
    const truthDetail: Record<
      string,
      Partial<Record<string, { expected: boolean; got: unknown }>>
    > = {};
    let truthOk = true;
    for (const [pid, expected] of Object.entries(TRUTH)) {
      truthDetail[pid] = {};
      for (const [skill, exp] of Object.entries(expected)) {
        const { data, error } = await serviceClient.rpc(
          "has_verified_license_for",
          { p_candidate_id: pid, p_skill_name: skill },
        );
        if (error || data !== exp) {
          truthOk = false;
          truthDetail[pid][skill] = {
            expected: exp,
            got: data ?? error?.message,
          };
        }
      }
    }
    report(
      "E : RPC has_verified_license_for — table de vérité complète (4 candidats × 9 skills)",
      truthOk,
      `36 combinaisons vérifiées — A: aucune conduite / B: moto / C: toutes (wildcard) / D: fourgon+camion${
        truthOk ? "" : ` — divergences : ${JSON.stringify(truthDetail)}`
      }`,
    );

    // ── F. Onboarding SSR : chips de conduite désactivées ────────
    const htmlO1 = await getHtml(
      cookiesOfUser.get(candO1.email)!,
      "/onboarding/candidate",
    );
    const htmlO2 = await getHtml(
      cookiesOfUser.get(candO2.email)!,
      "/onboarding/candidate",
    );
    report(
      "F1 : onboarding (sans permis) 200 + chips « Conduite moto » et « Conduite voiture » disabled",
      htmlO1.status === 200 &&
        buttonTagFor(htmlO1.html, "Conduite moto")?.includes("disabled") ===
          true &&
        buttonTagFor(htmlO1.html, "Conduite voiture")?.includes("disabled") ===
          true,
      {
        status: htmlO1.status,
        moto: buttonTagFor(htmlO1.html, "Conduite moto"),
        voiture: buttonTagFor(htmlO1.html, "Conduite voiture"),
      },
    );
    report(
      "F2 : sans permis, chip « Cuisine » est active + hint « permis verifie » présent",
      buttonTagFor(htmlO1.html, "Cuisine")?.includes("disabled") !== true &&
        htmlO1.html.includes("necessitent un permis de conduire verifie"),
    );
    report(
      "F3 : avec permis moto verifié, chip « Conduite moto » active, « Conduite voiture » toujours disabled",
      buttonTagFor(htmlO2.html, "Conduite moto")?.includes("disabled") !==
        true &&
        buttonTagFor(htmlO2.html, "Conduite voiture")?.includes("disabled") ===
          true,
      {
        moto: buttonTagFor(htmlO2.html, "Conduite moto"),
        voiture: buttonTagFor(htmlO2.html, "Conduite voiture"),
      },
    );

    // ── G. Bypass système via psql (superuser local) ────────────
    const gPid = candG.profileId;
    const control = runPsql(
      `insert into public.candidate_skills (candidate_id, skill_name, skill_level) values ('${gPid}', 'Conduite moto', 3);`,
    );
    report(
      "G1 : contrôle psql (sans flag) → INSERT « Conduite moto » REFUSÉ par le trigger",
      !control.ok && control.out.includes("EASYJOB_LICENSE_REQUIRED"),
      control.out.slice(0, 240),
    );
    // `supabase db query` exécute le fichier comme UNE prepared statement
    // (plusieurs commandes = erreur) : on embarque SET + INSERT dans un DO
    // plpgsql (une seule commande) ; le set_config(is_local = true) s'applique
    // à la transaction courante → visible par le trigger sur l'INSERT.
    const bypass = runPsql(
      `do $b$
begin
  perform set_config('easyjob.system_update', 'on', true);
  insert into public.candidate_skills (candidate_id, skill_name, skill_level)
  values ('${gPid}', 'Conduite moto', 3);
end;
$b$;`,
    );
    const gRow = await countSkills(candG.profileId, "Conduite moto");
    report(
      "G2 : bypass psql (easyjob.system_update = on) → INSERT OK (1 ligne)",
      bypass.ok && gRow === 1,
      { psqlOk: bypass.ok, row: gRow, tail: bypass.out.slice(-160) },
    );
  } finally {
    for (const c of allCleanup) {
      await cleanCandidate(c);
    }
    console.log(
      "Nettoyage : documents, skills, profils, comptes de preuve supprimés.",
    );
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0
        ? "verrou de permis de conduite opérationnel (T3.1)"
        : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
