/**
 * Preuve lot 6 (F-09) — création, modération et publication des offres.
 *
 * Méthode :
 *   1. Fixtures en service role : entreprises V (vérifiée, plan free),
 *      P (vérifiée, plan pro), B (vérifiée, autre entreprise), N (non
 *      vérifiée), S (vérifiée, compte suspendu) ; candidat C éligible ;
 *      admins admin_ops (R), admin_founder (F), admin_support (U).
 *      La vérification des entreprises est posée en clé service : c'est une
 *      fixture, pas une preuve du parcours de validation des entreprises,
 *      qui n'existe pas encore.
 *   2. Tentatives en sessions RÉELLES (signInWithPassword) : PostgREST et
 *      RPC directs avec le JWT de l'utilisateur, routes de l'application avec
 *      ses cookies. La clé service ne sert qu'aux fixtures et aux relectures.
 *   3. Assertions (état relu en service role) :
 *      A. Création : entreprise vérifiée acceptée, statut imposé ; refus pour
 *         non vérifiée, suspendue, candidat, anonyme ; propriétaire, statut et
 *         compteurs forgés ignorés ; données invalides refusées.
 *      B. Écritures directes : INSERT, UPDATE, UPSERT, publication,
 *         falsification de modération, compteurs, propriétaire ; catalogue.
 *      C. Lecture : offre en attente invisible au candidat, à l'anonyme et
 *         à une autre entreprise ; visible du propriétaire et des admins.
 *      D. Modération : grades refusés, motif obligatoire, version périmée,
 *         approbation tracée et notifiée, répétition et concurrence.
 *      E. Refus motivé puis correction : nouvelle soumission.
 *      F. Modification après publication : plan free verrouillé, plan pro
 *         remis en modération, candidat sélectionné, autre entreprise.
 *      G. Sélection : compteur tenu par la base.
 *      H. Échecs sans effet partiel : entreprise inéligible, erreur
 *         provoquée dans la transaction de modération.
 *      I. Suppression : DELETE direct refusé ; offre sans engagement
 *         supprimée ; candidat sélectionné, mission ou contrat → refus, données
 *         conservées ; sélection concurrente d'une suppression.
 *   4. Nettoyage : contrats, missions, offres, candidatures, notifications,
 *      journaux, comptes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L6-jobs-01!";
const PROOF_USER_METADATA = { proofJobModeration: true };

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };
type Session = { client: DB; cookie: string };

async function realSession(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: (): CookieEntry[] =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (entries) => {
        for (const { name, value } of entries) {
          if (value === "" || value === "0") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
    auth: { autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  }
  const cookie = [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return { client, cookie };
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

// ─── SQL local (catalogue et panne provoquée, pile dédiée) ────────
// La CLI n'exécute qu'une instruction par appel.
function runSql(sql: string): { status: number | null; out: string } {
  const tmp = path.join(os.tmpdir(), `proof-job-moderation-${Date.now()}.sql`);
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
  return { status: r.status, out: r.stdout || r.stderr || "" };
}

function execSql(sql: string) {
  const r = runSql(sql);
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
}

function dropSlowTriggers() {
  execSql("drop trigger if exists proof_l6_slow_job_delete on public.jobs");
  execSql("drop function if exists public.proof_l6_slow_job_delete()");
  execSql(
    "drop trigger if exists proof_l6_slow_selection on public.job_applications",
  );
  execSql("drop function if exists public.proof_l6_slow_selection()");
}

function queryRows(sql: string): Record<string, unknown>[] {
  const { status, out } = runSql(sql);
  const starts = [out.indexOf("["), out.indexOf("{")].filter((i) => i >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = out.lastIndexOf(out[start] === "[" ? "]" : "}");
  if (status !== 0 || start < 0 || end < start) {
    throw new Error(`supabase db query : ${out.slice(0, 300)}`);
  }
  const parsed = JSON.parse(out.slice(start, end + 1)) as
    | Record<string, unknown>[]
    | { rows: Record<string, unknown>[] };
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

// ─── Fixtures ────────────────────────────────────────────────────
async function createAccount(
  email: string,
  role: Role,
  active = true,
): Promise<string> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role, phone_verified: true },
  });
  if (error || !created.user) {
    throw new Error(`user creation failed: ${error?.message}`);
  }
  const id = created.user.id;
  const { error: rowErr } = await serviceClient.from("users").insert({
    id,
    email,
    role,
    is_verified: role === "candidate",
    phone_verified: true,
    is_active: active,
    locale: "fr",
  });
  if (rowErr) throw new Error(`users insert: ${rowErr.message}`);
  return id;
}

/** Profil entreprise ; la vérification est une fixture de confiance. */
async function createCompany(
  userId: string,
  name: string,
  verified: boolean,
  plan: "free" | "pro" = "free",
): Promise<string> {
  const { data, error } = await serviceClient
    .from("company_profiles")
    .insert({
      user_id: userId,
      company_name: name,
      city: "Douala",
      address: "Rue de la preuve",
      onboarding_status: "completed",
      verification_status: verified ? "verified" : "pending",
      subscription_plan: plan,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  return data.id;
}

async function createEligibleCandidate(userId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: "Aline",
      last_name: "Mbarga",
      date_of_birth: "1997-03-12",
      city: "Douala",
      bio: "Candidate de preuve du lot 6.",
      profile_photo_url: "photos/proof-l6.jpg",
      cni_front_url: "cni/l6-front.jpg",
      cni_back_url: "cni/l6-back.jpg",
      cni_selfie_url: "cni/l6-selfie.jpg",
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677000006",
      momo_verified: true,
      onboarding_status: "completed",
      onboarding_step: 6,
      profile_completion_pct: 100,
      sandbox_level: 1,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`candidate insert: ${error?.message}`);
  return data.id;
}

async function cleanAccounts(ids: string[]) {
  if (ids.length === 0) return;
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const { data: candidates } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  const candidateIds = (candidates ?? []).map((c) => c.id);
  const jobIds: string[] = [];
  if (companyIds.length > 0) {
    const { data: jobs } = await serviceClient
      .from("jobs")
      .select("id")
      .in("company_id", companyIds);
    jobIds.push(...(jobs ?? []).map((j) => j.id));
  }
  if (jobIds.length > 0) {
    await serviceClient.from("contracts").delete().in("job_id", jobIds);
    await serviceClient.from("missions").delete().in("job_id", jobIds);
    await serviceClient.from("job_applications").delete().in("job_id", jobIds);
    await serviceClient.from("audit_logs").delete().in("resource_id", jobIds);
    await serviceClient.from("jobs").delete().in("id", jobIds);
  }
  if (candidateIds.length > 0) {
    await serviceClient
      .from("job_applications")
      .delete()
      .in("candidate_id", candidateIds);
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .in("id", candidateIds);
  }
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("company_profiles").delete().in("user_id", ids);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofJobModeration === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
const JOB_BODY = {
  title: "Serveur preuve L6",
  description: "Service en salle, preuve du lot 6.",
  address: "Rue de la preuve",
  city: "Douala",
  start_date: "2099-01-15",
  start_time: "09:00",
  end_time: "17:00",
  mission_pay_per_candidate: 1500,
};

type HttpResult = { status: number; body: Record<string, unknown> };

async function http(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  cookie: string | null,
  body?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${APP_URL}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function readJob(id: string): Promise<JobRow | null> {
  const { data } = await serviceClient
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function countJobs(companyId: string): Promise<number> {
  const { count } = await serviceClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  return count ?? 0;
}

async function countAudit(jobId: string): Promise<number> {
  const { count } = await serviceClient
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("resource_id", jobId);
  return count ?? 0;
}

async function notificationsFor(jobId: string) {
  const { data } = await serviceClient
    .from("notifications")
    .select("user_id, title, body, data")
    .eq("data->>job_id", jobId);
  return data ?? [];
}

/** Offre en attente créée par une fixture (service role). */
async function seedJob(
  companyId: string,
  status: Database["public"]["Enums"]["job_status"],
  extra: Partial<JobRow> = {},
): Promise<string> {
  const { data, error } = await serviceClient
    .from("jobs")
    .insert({ ...JOB_BODY, company_id: companyId, status, ...extra })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job seed: ${error?.message}`);
  return data.id;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();

  const suffix = Date.now();
  const mail = (k: string) => `l6-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  let failingTrigger = false;
  let slowTriggers = false;

  try {
    const idV = await createAccount(mail("v"), "company");
    const idP = await createAccount(mail("p"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idN = await createAccount(mail("n"), "company");
    const idS = await createAccount(mail("s"), "company", false);
    const idC = await createAccount(mail("c"), "candidate");
    const idR = await createAccount(mail("r"), "admin_ops");
    const idF = await createAccount(mail("f"), "admin_founder");
    const idU = await createAccount(mail("u"), "admin_support");
    ids.push(idV, idP, idB, idN, idS, idC, idR, idF, idU);

    const coV = await createCompany(idV, "Restaurant V", true);
    const coP = await createCompany(idP, "Hôtel P", true, "pro");
    const coB = await createCompany(idB, "Commerce B", true);
    const coN = await createCompany(idN, "Société N", false);
    await createCompany(idS, "Société S", true);
    const candC = await createEligibleCandidate(idC);

    const V = await realSession(mail("v"));
    const P = await realSession(mail("p"));
    const B = await realSession(mail("b"));
    const N = await realSession(mail("n"));
    const S = await realSession(mail("s"));
    const C = await realSession(mail("c"));
    const R = await realSession(mail("r"));
    const F = await realSession(mail("f"));
    const U = await realSession(mail("u"));
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── A. Création ──────────────────────────────────────────────
    const a1 = await http("POST", "/api/jobs", V.cookie, JOB_BODY);
    const j1 = String((a1.body.job as { id?: string } | undefined)?.id ?? "");
    const j1Row = j1 ? await readJob(j1) : null;
    report(
      "A1 : entreprise vérifiée et active → 201, offre en attente, champs système par défaut",
      a1.status === 201 &&
        j1Row?.company_id === coV &&
        j1Row.status === "pending_review" &&
        j1Row.positions_filled === 0 &&
        j1Row.published_at === null &&
        j1Row.moderated_at === null &&
        j1Row.moderation_by === null,
      { status: a1.status, row: j1Row?.status },
    );

    for (const [label, session, code, status] of [
      ["A2 : non vérifiée", N, "company_not_verified", 403],
      ["A3 : compte suspendu", S, "account_suspended", 403],
      ["A4 : candidat", C, "not_a_company", 403],
    ] as const) {
      const r = await http("POST", "/api/jobs", session.cookie, JOB_BODY);
      report(
        `${label} → ${status} ${code}`,
        r.status === status && r.body.code === code,
        r,
      );
    }
    const a5 = await http("POST", "/api/jobs", null, JOB_BODY);
    report("A5 : anonyme → 401", a5.status === 401, a5);
    report("A2-A5 : aucune offre créée pour N", (await countJobs(coN)) === 0);

    const a6 = await http("POST", "/api/jobs", V.cookie, {
      ...JOB_BODY,
      company_id: coB,
      status: "active",
      positions_filled: 5,
      moderation_by: idR,
      published_at: new Date().toISOString(),
      urgency_fee: 0,
    });
    const a6Row = await readJob(
      String((a6.body.job as { id?: string } | undefined)?.id ?? ""),
    );
    report(
      "A6 : propriétaire, statut et compteurs forgés (route) → ignorés",
      a6.status === 201 &&
        a6Row?.company_id === coV &&
        a6Row.status === "pending_review" &&
        a6Row.positions_filled === 0 &&
        a6Row.moderation_by === null &&
        a6Row.published_at === null &&
        (await countJobs(coB)) === 0,
      { status: a6.status, row: a6Row?.status },
    );

    const { data: a7Job, error: a7Err } = await V.client.rpc("create_job", {
      p_job: {
        ...JOB_BODY,
        company_id: coB,
        status: "active",
        positions_filled: 3,
      },
    });
    report(
      "A7 : RPC create_job directe avec champs forgés → propriétaire et statut imposés",
      !a7Err &&
        a7Job?.company_id === coV &&
        a7Job.status === "pending_review" &&
        a7Job.positions_filled === 0,
      { error: a7Err?.message, status: a7Job?.status },
    );

    const rpcRefusals: [string, DB, string][] = [
      ["A8 : RPC directe, non vérifiée", N.client, "company_not_verified"],
      ["A9 : RPC directe, suspendue", S.client, "account_suspended"],
      ["A10 : RPC directe, candidat", C.client, "not_a_company"],
      ["A11 : RPC directe, admin", R.client, "not_a_company"],
    ];
    for (const [label, client, code] of rpcRefusals) {
      const { error } = await client.rpc("create_job", { p_job: JOB_BODY });
      report(`${label} → ${code}`, error?.message === code, error?.message);
    }
    const { error: a12Err } = await anon.rpc("create_job", { p_job: JOB_BODY });
    report("A12 : RPC directe, anonyme → refus", !!a12Err, a12Err?.message);

    const vCountBeforeInvalid = await countJobs(coV);
    const { error: a13Err } = await V.client.rpc("create_job", {
      p_job: { ...JOB_BODY, start_date: "2000-01-01" },
    });
    const { error: a14Err } = await V.client.rpc("create_job", {
      p_job: { ...JOB_BODY, mission_pay_per_candidate: -5 },
    });
    const { error: a15Err } = await V.client.rpc("create_job", {
      p_job: { ...JOB_BODY, urgency: "critical" },
    });
    const a16 = await http("POST", "/api/jobs", V.cookie, {
      ...JOB_BODY,
      title: "",
    });
    report(
      "A13-A16 : date passée, montant négatif, urgence réservée, titre vide → refusés sans offre créée",
      a13Err?.message === "invalid_job_data" &&
        a13Err.details === "start_date" &&
        a14Err?.details === "mission_pay_per_candidate" &&
        a15Err?.details === "urgency" &&
        a16.status === 400 &&
        a16.body.code === "invalid_job_data" &&
        (await countJobs(coV)) === vCountBeforeInvalid,
      {
        a13: a13Err?.details,
        a14: a14Err?.details,
        a15: a15Err?.details,
        a16: a16.status,
      },
    );

    // ── P. Montant par candidat pour la mission (lot 7c-bis) ────
    // Appel direct de la RPC (sans Zod) : la base applique seule la règle
    // « entier XAF strictement positif » et refuse l'ancien taux horaire.
    const payCases: [string, Record<string, unknown>, string][] = [
      ["zéro", { mission_pay_per_candidate: 0 }, "mission_pay_per_candidate"],
      [
        "négatif",
        { mission_pay_per_candidate: -10000 },
        "mission_pay_per_candidate",
      ],
      [
        "fractionnaire",
        { mission_pay_per_candidate: 10000.5 },
        "mission_pay_per_candidate",
      ],
      [
        "chaîne",
        { mission_pay_per_candidate: "10000" },
        "mission_pay_per_candidate",
      ],
      [
        "absent",
        { mission_pay_per_candidate: undefined },
        "mission_pay_per_candidate",
      ],
      [
        "au-delà d'integer",
        { mission_pay_per_candidate: 3_000_000_000 },
        "mission_pay_per_candidate",
      ],
      ["ancien taux horaire", { hourly_rate: 1500 }, "hourly_rate"],
    ];
    const vCountBeforePay = await countJobs(coV);
    const payResults: Record<string, unknown> = {};
    let payOk = true;
    for (const [label, patch, field] of payCases) {
      const { error } = await V.client.rpc("create_job", {
        p_job: JSON.parse(JSON.stringify({ ...JOB_BODY, ...patch })),
      });
      payResults[label] = `${error?.message}/${error?.details}`;
      payOk &&=
        error?.message === "invalid_job_data" && error.details === field;
    }
    report(
      "P1 : RPC directe, montant nul, négatif, fractionnaire, chaîne, absent, hors borne ou taux horaire → invalid_job_data sur le champ, aucune offre",
      payOk && (await countJobs(coV)) === vCountBeforePay,
      payResults,
    );

    const p2 = await Promise.all(
      [0, -5, 10000.5].map((amount) =>
        http("POST", "/api/jobs", V.cookie, {
          ...JOB_BODY,
          mission_pay_per_candidate: amount,
        }),
      ),
    );
    report(
      "P2 : route POST /api/jobs, montant nul, négatif ou fractionnaire → 400 (Zod), aucune offre",
      p2.every((r) => r.status === 400 && r.body.code === "invalid_job_data") &&
        (await countJobs(coV)) === vCountBeforePay,
      p2.map((r) => r.status),
    );

    const { data: p3Job, error: p3Err } = await V.client.rpc("create_job", {
      p_job: {
        ...JOB_BODY,
        title: "Inventaire preuve L7c-bis",
        start_time: "08:00",
        end_time: "12:00",
        positions_available: 3,
        mission_pay_per_candidate: 10000,
      },
    });
    const { data: p3Row } = p3Job
      ? await serviceClient
          .from("jobs")
          .select(
            "status, mission_pay_per_candidate, currency, positions_available, start_time, end_time",
          )
          .eq("id", p3Job.id)
          .single()
      : { data: null };
    report(
      "P3 : 10 000 XAF, 3 places, 8 h-12 h → offre en attente, montant entier par candidat, devise XAF, horaires conservés",
      !p3Err &&
        p3Row?.status === "pending_review" &&
        p3Row.mission_pay_per_candidate === 10000 &&
        p3Row.currency === "XAF" &&
        p3Row.positions_available === 3 &&
        p3Row.start_time === "08:00:00" &&
        p3Row.end_time === "12:00:00",
      p3Err?.message ?? p3Row,
    );

    // Contrainte en base, même pour la clé service (hors RPC).
    const { error: p4Err } = p3Job
      ? await serviceClient
          .from("jobs")
          .update({ mission_pay_per_candidate: 0 })
          .eq("id", p3Job.id)
      : { error: null };
    const { error: p4bErr } = p3Job
      ? await serviceClient
          .from("jobs")
          .update({ currency: "EUR" })
          .eq("id", p3Job.id)
      : { error: null };
    report(
      "P4 : contraintes jobs_mission_pay_per_candidate_chk et jobs_currency_xaf_chk (clé service) → refus",
      !!p4Err &&
        p4Err.message.includes("jobs_mission_pay_per_candidate_chk") &&
        !!p4bErr &&
        p4bErr.message.includes("jobs_currency_xaf_chk"),
      [p4Err?.message, p4bErr?.message],
    );

    // ── B. Écritures directes ───────────────────────────────────
    const vCountBeforeB1 = await countJobs(coV);
    const { data: b1Rows, error: b1Err } = await V.client
      .from("jobs")
      .insert({ ...JOB_BODY, company_id: coV, status: "active" })
      .select("id");
    report(
      "B1 : INSERT direct en statut active → 42501, aucune ligne",
      b1Err?.code === "42501" &&
        (b1Rows ?? []).length === 0 &&
        (await countJobs(coV)) === vCountBeforeB1,
      { code: b1Err?.code },
    );

    async function expectUpdateRefused(
      label: string,
      client: DB,
      jobId: string,
      values: Database["public"]["Tables"]["jobs"]["Update"],
    ) {
      const before = await readJob(jobId);
      const { data, error } = await client
        .from("jobs")
        .update(values)
        .eq("id", jobId)
        .select("id");
      const after = await readJob(jobId);
      report(
        label,
        !!error && (data ?? []).length === 0 && same(before, after),
        {
          code: error?.code,
          rows: data?.length,
          unchanged: same(before, after),
        },
      );
    }

    await expectUpdateRefused(
      "B2 : publication directe (status = active) → refus",
      V.client,
      j1,
      {
        status: "active",
        published_at: new Date().toISOString(),
      },
    );
    await expectUpdateRefused(
      "B3 : falsification de modération → refus",
      V.client,
      j1,
      {
        moderated_at: new Date().toISOString(),
        moderation_by: idV,
        rejection_reason: null,
        moderation_notes: "auto",
      },
    );
    await expectUpdateRefused(
      "B4 : compteurs et montants internes → refus",
      V.client,
      j1,
      {
        positions_filled: 9,
        urgency_fee: 0,
        currency: "XAF",
        sandbox_level_required: 0,
      },
    );
    await expectUpdateRefused(
      "B5 : changement de propriétaire → refus",
      V.client,
      j1,
      {
        company_id: coB,
      },
    );
    await expectUpdateRefused(
      "B6 : contenu seul hors RPC → refus",
      V.client,
      j1,
      {
        title: "Modification directe",
      },
    );
    await expectUpdateRefused(
      "B7 : admin_ops en écriture directe → refus",
      R.client,
      j1,
      {
        status: "active",
      },
    );
    await expectUpdateRefused("B8 : anonyme → refus", anon, j1, {
      status: "active",
    });

    const b9Before = await readJob(j1);
    const { error: b9Err } = await V.client
      .from("jobs")
      .upsert({ ...(b9Before as JobRow), status: "active" })
      .select("id");
    report(
      "B9 : UPSERT sur sa propre offre → 42501, ligne inchangée",
      b9Err?.code === "42501" && same(b9Before, await readJob(j1)),
      { code: b9Err?.code },
    );

    const [catalog] = queryRows(`
      select
        has_table_privilege('authenticated', 'public.jobs', 'INSERT')
          or has_table_privilege('authenticated', 'public.jobs', 'UPDATE')
          or has_table_privilege('anon', 'public.jobs', 'INSERT')
          or has_table_privilege('anon', 'public.jobs', 'UPDATE')
          or has_table_privilege('authenticated', 'public.jobs', 'DELETE')
          or has_table_privilege('anon', 'public.jobs', 'DELETE') as table_write,
        (select coalesce(string_agg(c.column_name, ','), '')
           from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'jobs'
            and has_column_privilege('authenticated', 'public.jobs',
                                     c.column_name, 'UPDATE')) as updatable,
        has_function_privilege('authenticated', 'public.protect_job_writes()', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.sync_job_positions_filled()', 'EXECUTE')
          or has_function_privilege('authenticated',
               'public.job_apply_content(public.jobs, jsonb)', 'EXECUTE') as internal_exec,
        has_function_privilege('anon', 'public.create_job(jsonb)', 'EXECUTE')
          or has_function_privilege('anon', 'public.update_job(uuid, jsonb)', 'EXECUTE')
          or has_function_privilege('anon',
               'public.moderate_job(uuid, text, text, timestamptz)', 'EXECUTE')
          or has_function_privilege('anon', 'public.delete_job(uuid)', 'EXECUTE') as anon_exec,
        (select tgenabled from pg_trigger where tgname = 'trg_protect_job_writes') as protect_trigger,
        (select tgenabled from pg_trigger where tgname = 'trg_sync_job_positions_filled') as sync_trigger,
        (select count(*) from pg_policy
          where polrelid = 'public.jobs'::regclass and polcmd in ('a', 'w', 'd', '*')) as write_policies
    `);
    report(
      "B10 : catalogue — aucune écriture ni suppression en session, fonctions internes non exécutables, triggers actifs",
      catalog?.table_write === false &&
        catalog?.updatable === "" &&
        catalog?.internal_exec === false &&
        catalog?.anon_exec === false &&
        catalog?.protect_trigger === "O" &&
        catalog?.sync_trigger === "O" &&
        Number(catalog?.write_policies) === 0,
      catalog,
    );

    // ── C. Lecture ───────────────────────────────────────────────
    async function visibleTo(client: DB, jobId: string): Promise<boolean> {
      const { data } = await client.from("jobs").select("id").eq("id", jobId);
      return (data ?? []).length === 1;
    }
    const c1Api = await http("GET", `/api/jobs/${j1}`, C.cookie);
    // La page est rendue en streaming (loading.tsx) : notFound() répond 200
    // avec l'écran « introuvable ». On vérifie donc l'absence du contenu.
    const c1Page = await fetch(`${APP_URL}/jobs/${j1}`, {
      headers: { Cookie: C.cookie },
      redirect: "manual",
    });
    const c1Html = await c1Page.text();
    const c1List = await http("GET", "/api/jobs?limit=100", C.cookie);
    report(
      "C1 : candidat — offre en attente invisible (PostgREST, API détail, page, liste)",
      !(await visibleTo(C.client, j1)) &&
        c1Api.status === 404 &&
        !c1Html.includes(JOB_BODY.description) &&
        !JSON.stringify(c1List.body).includes(j1),
      { api: c1Api.status, page: c1Page.status },
    );
    report(
      "C2 : anonyme — offre en attente invisible",
      !(await visibleTo(anon, j1)),
    );
    const { data: c3Del } = await B.client
      .from("jobs")
      .delete()
      .eq("id", j1)
      .select("id");
    report(
      "C3 : autre entreprise — ni lecture ni suppression",
      !(await visibleTo(B.client, j1)) &&
        (c3Del ?? []).length === 0 &&
        !!(await readJob(j1)),
    );
    report(
      "C4 : propriétaire — lit son offre en attente",
      await visibleTo(V.client, j1),
    );
    report(
      "C5 : admin_support et admin_ops — lisent l'offre en attente",
      (await visibleTo(U.client, j1)) && (await visibleTo(R.client, j1)),
    );

    // ── D. Modération ────────────────────────────────────────────
    const moderate = (session: Session, jobId: string, body: unknown) =>
      http("POST", `/api/admin/jobs/${jobId}/moderate`, session.cookie, body);

    const d1Before = await readJob(j1);
    const d1 = await moderate(U, j1, { action: "approve" });
    const { error: d2Err } = await V.client.rpc("moderate_job", {
      p_job_id: j1,
      p_action: "approve",
    });
    const { error: d3Err } = await C.client.rpc("moderate_job", {
      p_job_id: j1,
      p_action: "approve",
    });
    report(
      "D1-D3 : admin_support (route), entreprise et candidat (RPC) → forbidden, rien d'écrit",
      d1.status === 403 &&
        d1.body.code === "forbidden" &&
        d2Err?.message === "forbidden" &&
        d3Err?.message === "forbidden" &&
        same(d1Before, await readJob(j1)) &&
        (await countAudit(j1)) === 0 &&
        (await notificationsFor(j1)).length === 0,
      { d1: d1.status, d2: d2Err?.message, d3: d3Err?.message },
    );

    const d4 = await moderate(R, j1, { action: "reject", reason: " " });
    const { error: d4bErr } = await R.client.rpc("moderate_job", {
      p_job_id: j1,
      p_action: "reject",
      p_reason: "no",
    });
    const { error: d4cErr } = await R.client.rpc("moderate_job", {
      p_job_id: j1,
      p_action: "publish",
    });
    report(
      "D4 : refus sans motif (route et RPC), action inconnue → refusés, rien d'écrit",
      d4.status === 400 &&
        d4.body.code === "reason_required" &&
        d4bErr?.message === "reason_required" &&
        d4cErr?.message === "invalid_action" &&
        same(d1Before, await readJob(j1)),
      { d4: d4.body.code, d4b: d4bErr?.message, d4c: d4cErr?.message },
    );

    const d5 = await moderate(R, j1, {
      action: "approve",
      seen_updated_at: "2000-01-01T00:00:00.000Z",
    });
    report(
      "D5 : décision sur une version périmée → 409 job_changed, rien d'écrit",
      d5.status === 409 &&
        d5.body.code === "job_changed" &&
        same(d1Before, await readJob(j1)),
      d5,
    );

    const d6 = await moderate(R, j1, {
      action: "approve",
      seen_updated_at: d1Before?.updated_at,
    });
    const j1Approved = await readJob(j1);
    const { data: d6Audit } = await serviceClient
      .from("audit_logs")
      .select("actor_id, actor_role, action, resource_type")
      .eq("resource_id", j1);
    const d6Notif = await notificationsFor(j1);
    report(
      "D6 : admin_ops approuve → active, champs de modération posés par la base",
      d6.status === 200 &&
        d6.body.status === "active" &&
        j1Approved?.status === "active" &&
        j1Approved.moderation_by === idR &&
        !!j1Approved.moderated_at &&
        !!j1Approved.published_at &&
        j1Approved.rejection_reason === null,
      { status: d6.status, row: j1Approved?.status },
    );
    report(
      "D7 : une trace audit_logs (approve_job, admin réel) et une notification à l'entreprise",
      d6Audit?.length === 1 &&
        d6Audit[0].action === "approve_job" &&
        d6Audit[0].actor_id === idR &&
        d6Audit[0].actor_role === "admin_ops" &&
        d6Notif.length === 1 &&
        d6Notif[0].user_id === idV,
      { audit: d6Audit, notifications: d6Notif.length },
    );

    const d8 = await moderate(R, j1, { action: "approve" });
    const { error: d8bErr } = await F.client.rpc("moderate_job", {
      p_job_id: j1,
      p_action: "reject",
      p_reason: "Trop tard",
    });
    report(
      "D8 : décision répétée → 409 job_not_pending, ni nouvelle trace ni nouvelle notification",
      d8.status === 409 &&
        d8.body.code === "job_not_pending" &&
        d8bErr?.message === "job_not_pending" &&
        (await readJob(j1))?.status === "active" &&
        (await countAudit(j1)) === 1 &&
        (await notificationsFor(j1)).length === 1,
      { d8: d8.body.code, d8b: d8bErr?.message },
    );

    const d9Api = await http("GET", `/api/jobs/${j1}`, C.cookie);
    const d9Html = await (
      await fetch(`${APP_URL}/jobs/${j1}`, { headers: { Cookie: C.cookie } })
    ).text();
    const d9Apply = await http("POST", `/api/jobs/${j1}/apply`, C.cookie, {});
    report(
      "D9 : après approbation, le candidat lit l'offre (API, page) et postule",
      (await visibleTo(C.client, j1)) &&
        d9Api.status === 200 &&
        d9Html.includes(JOB_BODY.description) &&
        d9Apply.status === 200 &&
        d9Apply.body.success === true,
      { api: d9Api.status, apply: d9Apply },
    );

    // Concurrence : double clic du même admin, puis deux admins.
    for (const [label, first, second] of [
      ["D10 : double clic simultané (même admin)", R, R],
      ["D11 : deux admins simultanés (approbation contre refus)", R, F],
    ] as const) {
      const jobId = await seedJob(coV, "pending_review");
      const results = await Promise.all([
        moderate(first, jobId, { action: "approve" }),
        moderate(second, jobId, {
          action: label.startsWith("D11") ? "reject" : "approve",
          reason: "Motif concurrent",
        }),
      ]);
      const ok = results.filter((r) => r.status === 200);
      const conflicts = results.filter(
        (r) => r.status === 409 && r.body.code === "job_not_pending",
      );
      const row = await readJob(jobId);
      report(
        `${label} → un succès, un 409, une trace, une notification, statut du gagnant`,
        ok.length === 1 &&
          conflicts.length === 1 &&
          row?.status === ok[0].body.status &&
          (await countAudit(jobId)) === 1 &&
          (await notificationsFor(jobId)).length === 1,
        results.map((r) => [r.status, r.body.code ?? r.body.status]),
      );
    }

    // ── E. Refus motivé puis correction ─────────────────────────
    const j3 = await seedJob(coV, "pending_review");
    const reason = "Précisez la tenue exigée et l'adresse exacte.";
    const e1 = await moderate(F, j3, { action: "reject", reason });
    const j3Rejected = await readJob(j3);
    const e1Notif = await notificationsFor(j3);
    const { data: e1Audit } = await serviceClient
      .from("audit_logs")
      .select("action, actor_role")
      .eq("resource_id", j3);
    report(
      "E1 : admin_founder refuse avec motif → rejected, motif enregistré, trace et notification",
      e1.status === 200 &&
        j3Rejected?.status === "rejected" &&
        j3Rejected.rejection_reason === reason &&
        j3Rejected.moderation_by === idF &&
        j3Rejected.published_at === null &&
        e1Audit?.[0]?.action === "reject_job" &&
        e1Notif.length === 1 &&
        String(e1Notif[0].body).includes(reason),
      { status: e1.status, row: j3Rejected?.status },
    );
    report(
      "E2 : offre refusée invisible du candidat",
      !(await visibleTo(C.client, j3)) &&
        (await http("GET", `/api/jobs/${j3}`, C.cookie)).status === 404,
    );
    const e3 = await http("PATCH", `/api/jobs/${j3}`, V.cookie, {
      ...JOB_BODY,
      title: "Serveur preuve L6 (corrigée)",
      dress_code: "Chemise blanche",
    });
    const j3Fixed = await readJob(j3);
    report(
      "E3 : correction par l'entreprise → pending_review, motif et modération effacés, contenu mis à jour",
      e3.status === 200 &&
        j3Fixed?.status === "pending_review" &&
        j3Fixed.title === "Serveur preuve L6 (corrigée)" &&
        j3Fixed.dress_code === "Chemise blanche" &&
        j3Fixed.rejection_reason === null &&
        j3Fixed.moderated_at === null &&
        j3Fixed.moderation_by === null,
      { status: e3.status, row: j3Fixed?.status },
    );
    const { data: e4Job, error: e4Err } = await V.client.rpc("update_job", {
      p_job_id: j3,
      p_job: {
        ...JOB_BODY,
        status: "active",
        company_id: coB,
        positions_filled: 4,
      },
    });
    report(
      "E4 : RPC update_job avec statut, propriétaire et compteur forgés → ignorés",
      !e4Err &&
        e4Job?.status === "pending_review" &&
        e4Job.company_id === coV &&
        e4Job.positions_filled === 0,
      { error: e4Err?.message, status: e4Job?.status },
    );
    const e5 = await moderate(R, j3, { action: "approve" });
    report(
      "E5 : la version corrigée est approuvée",
      e5.status === 200 && (await readJob(j3))?.status === "active",
      e5,
    );

    // ── F. Modification après publication ───────────────────────
    const f1Before = await readJob(j1);
    const f1 = await http("PATCH", `/api/jobs/${j1}`, V.cookie, {
      ...JOB_BODY,
      title: "Titre changé après approbation",
    });
    report(
      "F1 : plan free, offre active → 403 job_locked_plan, offre inchangée et publiée",
      f1.status === 403 &&
        f1.body.code === "job_locked_plan" &&
        same(f1Before, await readJob(j1)),
      f1,
    );

    const jP = await seedJob(coP, "pending_review");
    await moderate(R, jP, { action: "approve" });
    const f2 = await http("PATCH", `/api/jobs/${jP}`, P.cookie, {
      ...JOB_BODY,
      mission_pay_per_candidate: 2500,
    });
    const jPRow = await readJob(jP);
    report(
      "F2 : plan pro, offre active modifiée → nouvelle modération, retirée du public",
      f2.status === 200 &&
        jPRow?.status === "pending_review" &&
        jPRow.mission_pay_per_candidate === 2500 &&
        jPRow.published_at === null &&
        !(await visibleTo(C.client, jP)),
      { status: f2.status, row: jPRow?.status },
    );

    const f4Before = await readJob(j3);
    const f4 = await http("PATCH", `/api/jobs/${j3}`, B.cookie, JOB_BODY);
    report(
      "F4 : autre entreprise → 404 job_not_found, offre inchangée",
      f4.status === 404 &&
        f4.body.code === "job_not_found" &&
        same(f4Before, await readJob(j3)),
      f4,
    );
    const jFilled = await seedJob(coV, "filled");
    const f5 = await http("PATCH", `/api/jobs/${jFilled}`, V.cookie, JOB_BODY);
    report(
      "F5 : offre pourvue → 409 job_not_editable",
      f5.status === 409 && f5.body.code === "job_not_editable",
      f5,
    );

    // ── G. Sélection : compteur tenu par la base ────────────────
    const { data: app1 } = await serviceClient
      .from("job_applications")
      .select("id")
      .eq("job_id", j1)
      .eq("candidate_id", candC)
      .single();
    // Depuis le lot 7a, la sélection passe par select_candidate.
    const { data: g1Rows, error: g1Err } = await V.client.rpc(
      "select_candidate",
      { p_application_id: app1?.id ?? "" },
    );
    const g1Job = await readJob(j1);
    report(
      "G1 : sélection par l'entreprise (select_candidate) → positions_filled = 1",
      !g1Err &&
        g1Rows?.[0]?.status === "selected" &&
        g1Job?.positions_filled === 1,
      { error: g1Err?.message, filled: g1Job?.positions_filled },
    );
    // Annulation : correction de confiance seulement (le cycle d'annulation
    // relève du lot 7) ; le compteur suit.
    await serviceClient
      .from("job_applications")
      .update({ status: "rejected", rejection_reason: "Preuve" })
      .eq("id", app1?.id ?? "");
    report(
      "G2 : sélection annulée par correction de confiance → positions_filled = 0",
      (await readJob(j1))?.positions_filled === 0,
    );

    // Plan pro avec candidat sélectionné : modification refusée.
    const jP2 = await seedJob(coP, "active");
    const { data: app2 } = await serviceClient
      .from("job_applications")
      .insert({ job_id: jP2, candidate_id: candC, status: "pending" })
      .select("id")
      .single();
    await P.client.rpc("select_candidate", {
      p_application_id: app2?.id ?? "",
    });
    const f3Before = await readJob(jP2);
    const f3 = await http("PATCH", `/api/jobs/${jP2}`, P.cookie, JOB_BODY);
    report(
      "F3 : plan pro, candidat déjà sélectionné → 409 job_has_selected_candidates",
      f3Before?.positions_filled === 1 &&
        f3.status === 409 &&
        f3.body.code === "job_has_selected_candidates" &&
        same(f3Before, await readJob(jP2)),
      f3,
    );

    // ── I. Suppression ───────────────────────────────────────────
    const countWhere = async (
      table: "job_applications" | "missions" | "contracts",
      jobId: string,
    ) => {
      const { count } = await serviceClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      return count ?? 0;
    };
    const seedApplication = async (
      jobId: string,
      status: Database["public"]["Enums"]["application_status"],
    ) => {
      const { data, error } = await serviceClient
        .from("job_applications")
        .insert({ job_id: jobId, candidate_id: candC, status })
        .select("id")
        .single();
      if (error || !data)
        throw new Error(`application seed: ${error?.message}`);
      return data.id;
    };

    // I1 : offre sans engagement, avec une candidature en attente.
    const jFree = await seedJob(coV, "active");
    await seedApplication(jFree, "pending");
    const { data: i1Rows, error: i1Err } = await V.client
      .from("jobs")
      .delete()
      .eq("id", jFree)
      .select("id");
    report(
      "I1 : DELETE direct en session → refusé, offre conservée",
      !!i1Err && (i1Rows ?? []).length === 0 && !!(await readJob(jFree)),
      { code: i1Err?.code },
    );
    const i2Other = await http("DELETE", `/api/jobs/${jFree}`, B.cookie);
    const { error: i2AnonErr } = await anon.rpc("delete_job", {
      p_job_id: jFree,
    });
    report(
      "I2 : autre entreprise (route) et anonyme (RPC) → refusés, offre conservée",
      i2Other.status === 404 &&
        i2Other.body.code === "job_not_found" &&
        !!i2AnonErr &&
        !!(await readJob(jFree)),
      { other: i2Other.status, anon: i2AnonErr?.message },
    );
    const i3 = await http("DELETE", `/api/jobs/${jFree}`, V.cookie);
    report(
      "I3 : offre sans engagement → supprimée, candidature en attente effacée",
      i3.status === 200 &&
        i3.body.deleted === jFree &&
        !(await readJob(jFree)) &&
        (await countWhere("job_applications", jFree)) === 0,
      i3,
    );
    const jPending = await seedJob(coV, "pending_review");
    const { data: i4Id, error: i4Err } = await V.client.rpc("delete_job", {
      p_job_id: jPending,
    });
    report(
      "I4 : RPC directe, offre en attente → supprimée",
      !i4Err && i4Id === jPending && !(await readJob(jPending)),
      { error: i4Err?.message },
    );

    async function expectCommitmentKept(
      label: string,
      jobId: string,
      table: "job_applications" | "missions" | "contracts",
    ) {
      const before = await readJob(jobId);
      const linked = await countWhere(table, jobId);
      const viaRoute = await http("DELETE", `/api/jobs/${jobId}`, V.cookie);
      const { error: viaRpc } = await V.client.rpc("delete_job", {
        p_job_id: jobId,
      });
      report(
        label,
        viaRoute.status === 409 &&
          viaRoute.body.code === "job_has_commitments" &&
          viaRpc?.message === "job_has_commitments" &&
          same(before, await readJob(jobId)) &&
          linked > 0 &&
          (await countWhere(table, jobId)) === linked,
        { route: viaRoute.status, rpc: viaRpc?.message, linked },
      );
    }

    const jSel = await seedJob(coV, "active");
    const appSel = await seedApplication(jSel, "pending");
    await V.client.rpc("select_candidate", { p_application_id: appSel });
    await expectCommitmentKept(
      "I5 : candidat sélectionné → 409 job_has_commitments (route et RPC), offre et candidature conservées",
      jSel,
      "job_applications",
    );

    const jMission = await seedJob(coV, "active");
    const { error: missionErr } = await serviceClient.from("missions").insert({
      job_id: jMission,
      candidate_id: candC,
      scheduled_date: JOB_BODY.start_date,
      scheduled_start_time: JOB_BODY.start_time,
      scheduled_end_time: JOB_BODY.end_time,
    });
    if (missionErr) throw new Error(`mission seed: ${missionErr.message}`);
    await expectCommitmentKept(
      "I6 : mission associée → 409, offre et mission conservées",
      jMission,
      "missions",
    );

    const jContract = await seedJob(coV, "active");
    const appContract = await seedApplication(jContract, "rejected");
    const { error: contractErr } = await serviceClient
      .from("contracts")
      .insert({
        job_id: jContract,
        application_id: appContract,
        candidate_id: candC,
        company_id: coV,
        contract_template: "simple",
      });
    if (contractErr) throw new Error(`contract seed: ${contractErr.message}`);
    await expectCommitmentKept(
      "I7 : contrat associé → 409, offre et contrat conservés",
      jContract,
      "contracts",
    );

    // Sélection et suppression simultanées : jamais une sélection réussie
    // sur une offre supprimée, ni d'erreur inattendue (verrou mortel).
    type RaceSetup = (jobId: string, appId: string) => Promise<void>;
    async function race(
      setup?: RaceSetup,
      first?: "selection" | "deletion",
    ): Promise<{ ok: boolean; outcome: unknown }> {
      const jobId = await seedJob(coV, "active");
      const appId = await seedApplication(jobId, "pending");
      if (setup) await setup(jobId, appId);
      const delay = (who: "selection" | "deletion") =>
        first && first !== who
          ? new Promise((r) => setTimeout(r, 400))
          : Promise.resolve();
      const [selection, deletion] = await Promise.all([
        delay("selection").then(() =>
          V.client.rpc("select_candidate", { p_application_id: appId }),
        ),
        delay("deletion").then(() =>
          http("DELETE", `/api/jobs/${jobId}`, V.cookie),
        ),
      ]);
      const job = await readJob(jobId);
      const { data: app } = await serviceClient
        .from("job_applications")
        .select("status")
        .eq("id", appId)
        .maybeSingle();
      const selected =
        !selection.error && selection.data?.[0]?.status === "selected";
      const deletedFirst = deletion.status === 200 && !job && !app && !selected;
      const selectedFirst =
        deletion.status === 409 &&
        deletion.body.code === "job_has_commitments" &&
        selected &&
        app?.status === "selected" &&
        job?.positions_filled === 1;
      return {
        ok: deletedFirst || selectedFirst,
        outcome: deletedFirst
          ? "supprimée"
          : selectedFirst
            ? "sélectionnée"
            : {
                deletion: deletion.status,
                selection: selection.error?.code ?? selection.data?.length,
                job: !!job,
                app: app?.status,
              },
      };
    }

    const free = await Promise.all([race(), race(), race(), race()]);
    report(
      "I8 : sélections et suppressions simultanées → un seul gagnant cohérent à chaque essai",
      free.every((r) => r.ok),
      free.map((r) => r.outcome),
    );

    // Ordres forcés : un trigger temporaire (pile dédiée) ralentit la
    // transaction partie en premier, l'autre arrive pendant qu'elle tient
    // ses verrous.
    slowTriggers = true;
    const slowDeletion = await race(async (jobId) => {
      execSql(`
        create or replace function public.proof_l6_slow_job_delete() returns trigger
        language plpgsql as $$ begin
          if old.id = '${jobId}'::uuid then perform pg_sleep(1.5); end if;
          return old;
        end $$
      `);
      execSql(`
        create trigger proof_l6_slow_job_delete before delete on public.jobs
          for each row execute function public.proof_l6_slow_job_delete()
      `);
    }, "deletion");
    report(
      "I9 : suppression engagée puis sélection → offre supprimée, sélection sans effet",
      slowDeletion.ok && slowDeletion.outcome === "supprimée",
      slowDeletion.outcome,
    );
    const slowSelection = await race(async (_jobId, appId) => {
      execSql(`
        create or replace function public.proof_l6_slow_selection() returns trigger
        language plpgsql as $$ begin
          if new.id = '${appId}'::uuid then perform pg_sleep(1.5); end if;
          return null;
        end $$
      `);
      execSql(`
        create trigger proof_l6_slow_selection after update on public.job_applications
          for each row execute function public.proof_l6_slow_selection()
      `);
    }, "selection");
    report(
      "I10 : sélection engagée puis suppression → 409, offre et sélection conservées",
      slowSelection.ok && slowSelection.outcome === "sélectionnée",
      slowSelection.outcome,
    );
    dropSlowTriggers();
    slowTriggers = false;

    // ── H. Échecs sans effet partiel ────────────────────────────
    const jB = await seedJob(coB, "pending_review");
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coB);
    const h1Before = await readJob(jB);
    const h1 = await moderate(R, jB, { action: "approve" });
    report(
      "H1 : entreprise repassée en revue → 409 company_not_eligible, ni publication, ni trace, ni notification",
      h1.status === 409 &&
        h1.body.code === "company_not_eligible" &&
        same(h1Before, await readJob(jB)) &&
        (await countAudit(jB)) === 0 &&
        (await notificationsFor(jB)).length === 0,
      h1,
    );

    // Panne provoquée à l'écriture de la trace : l'offre ne doit pas rester
    // publiée sans ses effets obligatoires.
    const jH = await seedJob(coV, "pending_review");
    failingTrigger = true;
    execSql(`
      create or replace function public.proof_l6_fail_audit() returns trigger
      language plpgsql as $$ begin
        if new.resource_id = '${jH}'::uuid then
          raise exception 'proof_l6_forced_failure';
        end if;
        return new;
      end $$
    `);
    execSql(`
      create trigger proof_l6_fail_audit before insert on public.audit_logs
        for each row execute function public.proof_l6_fail_audit()
    `);
    const h2Before = await readJob(jH);
    const h2 = await moderate(R, jH, { action: "approve" });
    const h2After = await readJob(jH);
    report(
      "H2 : erreur dans la transaction de modération → 500, offre toujours en attente, aucune notification",
      h2.status === 500 &&
        same(h2Before, h2After) &&
        h2After?.status === "pending_review" &&
        (await notificationsFor(jH)).length === 0,
      { status: h2.status, row: h2After?.status },
    );
  } finally {
    if (slowTriggers) dropSlowTriggers();
    if (failingTrigger) {
      execSql(
        "drop trigger if exists proof_l6_fail_audit on public.audit_logs",
      );
      execSql("drop function if exists public.proof_l6_fail_audit()");
    }
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} réussite(s), ${failCount} échec(s)`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
