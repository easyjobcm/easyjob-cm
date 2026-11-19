/**
 * Preuve lot 17a — plan candidat effectif, attribution administrative de
 * Premium et conditions d'engagement figées à la sélection.
 *
 * Fixtures en clé service (entreprise vérifiée A, candidats, admins ops,
 * fondateur, support et ops suspendu) ; tentatives en sessions RÉELLES
 * (routes avec cookies, RPC avec le JWT) ; état relu en clé service.
 * Instants exacts sans attente : `proof_l17a_*` (fonctions temporaires, clé
 * service) placent l'échéance à now() + décalage puis appellent la vraie
 * fonction sous l'identité voulue, dans la même transaction.
 *
 *   P. Plan effectif : règle unique (rôle ET fin future), échéance exacte
 *      (Free à l'instant même, Premium 1 µs avant), my_account_state.
 *   W. Écritures refusées : candidat (plan, dates, rôle, historique),
 *      tiers, admin_support (lecture seule), ops suspendu (ancien jeton),
 *      anonyme ; fonction de plan fermée aux sessions.
 *   G. Activation, prolongation, arrêt par la route (ops, fondateur) :
 *      état, historique, audit, notification, aucune ligne de paiement ;
 *      contrôles de période, de motif et d'état lu.
 *   I. Idempotence et concurrence : cinq relances simultanées, deux agents
 *      simultanés, clé réutilisée pour d'autres paramètres.
 *   S. Sélection : Free puis activation ; Premium puis arrêt ou expiration ;
 *      sélection à l'instant exact de l'expiration (et 1 µs avant) ;
 *      période complète (mêmes conditions par journée) ; journées au choix
 *      (conditions propres à chaque sélection) ; relance de la sélection ;
 *      conditions immuables, même en clé service.
 *   L. Engagement antérieur au lot : ligne « legacy » sans plan ni délai.
 *   A. Page admin du candidat : garde commune, admin suspendu refusé.
 *   C. Confidentialité : tables fermées aux sessions ; réponses et signaux
 *      destinés à l'entreprise sans plan ; signaux du candidat et du
 *      support réduits à {d, r, id}.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectHttp, signAndSelectSql } from "./lib/sign-and-select";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L17a-premium-01!";
const PROOF_USER_METADATA = { proofCandidatePremium: true };
const DAY = 86_400_000;

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "candidate-premium" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
  return r.stdout;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
// Fonctions de preuve temporaires : absentes des types générés.
const serviceRpc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Fonctions temporaires (pile de preuve) ───────────────────────
// État du compte à l'instant exact : fin placée à now() + décalage.
const STATE_FN = `
create or replace function public.proof_l17a_state(p_user uuid, p_offset interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  update public.users u set role = 'candidate_premium' where u.id = p_user;
  update public.candidate_profiles cp set premium_until = now() + p_offset
  where cp.user_id = p_user;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_state := public.my_account_state();
  return jsonb_build_object(
    'state', v_state,
    'plan_at_end', public.candidate_effective_plan(p_user, now() + p_offset),
    'plan_before_end', public.candidate_effective_plan(
      p_user, now() + p_offset - interval '1 microsecond'));
end;
$$`;

// Sélection à l'instant exact : fin Premium placée à now() + décalage,
// puis « Signer et sélectionner » par l'entreprise dans la transaction.
const SELECT_FN = `
create or replace function public.proof_l17a_select(
  p_company_user uuid, p_candidate_user uuid, p_application uuid, p_offset interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
begin
  update public.users u set role = 'candidate_premium' where u.id = p_candidate_user;
  update public.candidate_profiles cp set premium_until = now() + p_offset
  where cp.user_id = p_candidate_user;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_company_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_company_user::text, true);
  begin
    ${signAndSelectSql("p_application")}
  exception when others then
    v_err := sqlerrm;
  end;
  return jsonb_build_object(
    'error', v_err,
    'now', now(),
    'premium_until', now() + p_offset,
    'terms', (select jsonb_agg(jsonb_build_object(
                'plan', t.candidate_plan, 'hours', t.cancellation_notice_hours,
                'selected_at', t.selected_at))
              from public.mission_day_commitment_terms t
              where t.application_id = p_application));
end;
$$`;

// Signaux émis depuis un instant (payloads seulement).
const MESSAGES_FN = `
create or replace function public.proof_l17a_messages(p_topic text, p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
  from realtime.messages m
  where m.topic = p_topic and m.inserted_at >= p_since;
$$`;

// Engagement historique : conditions retirées (état d'avant la migration),
// puis fonction de reprise de la migration, deux fois (idempotence).
const LEGACY_FN = `
create or replace function public.proof_l17a_legacy(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_deleted integer;
  v_first integer;
  v_second integer;
begin
  select count(*) into v_before from public.mission_day_commitment_terms t
  where t.terms_source = 'selection';
  delete from public.mission_day_commitment_terms t
  where t.application_id = p_application;
  get diagnostics v_deleted = row_count;
  v_first := public.mark_legacy_commitment_terms();
  v_second := public.mark_legacy_commitment_terms();
  return jsonb_build_object(
    'first', v_first,
    'second', v_second,
    'selection_rows_before', v_before - v_deleted,
    'selection_rows', (select count(*) from public.mission_day_commitment_terms t
                       where t.terms_source = 'selection'),
    'terms', (select jsonb_agg(jsonb_build_object(
                'source', t.terms_source, 'plan', t.candidate_plan,
                'hours', t.cancellation_notice_hours, 'selected_at', t.selected_at))
              from public.mission_day_commitment_terms t
              where t.application_id = p_application));
end;
$$`;

const DROP_ALL = [
  "drop function if exists public.proof_l17a_state(uuid, interval)",
  "drop function if exists public.proof_l17a_select(uuid, uuid, uuid, interval)",
  "drop function if exists public.proof_l17a_messages(text, timestamptz)",
  "drop function if exists public.proof_l17a_legacy(uuid)",
];

function installFunctions() {
  for (const sql of DROP_ALL) execSql(sql);
  execSql(STATE_FN);
  execSql(SELECT_FN);
  execSql(MESSAGES_FN);
  execSql(LEGACY_FN);
  for (const fn of [
    "proof_l17a_state(uuid, interval)",
    "proof_l17a_select(uuid, uuid, uuid, interval)",
    "proof_l17a_messages(text, timestamptz)",
    "proof_l17a_legacy(uuid)",
  ]) {
    execSql(
      `revoke all on function public.${fn} from public, anon, authenticated`,
    );
    execSql(`grant execute on function public.${fn} to service_role`);
  }
  execSql("notify pgrst, 'reload schema'");
}

async function proofRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) {
    const { data, error } = await serviceRpc.rpc(fn, args);
    if (!error) return data as T;
    // Attente du rechargement du cache de schéma (installation seulement).
    if (Date.now() > end || !/schema cache|function/i.test(error.message)) {
      throw new Error(`${fn}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ─── Sessions réelles ─────────────────────────────────────────────
type CookieEntry = { name: string; value: string };
type Session = { client: DB; cookie: string; userId: string };

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
  return { client, cookie, userId: data.user.id };
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

async function createAccount(email: string, role: Role): Promise<string> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role, phone_verified: true },
  });
  if (error || !created.user) throw new Error(`user: ${error?.message}`);
  const id = created.user.id;
  const { error: rowErr } = await serviceClient.from("users").insert({
    id,
    email,
    phone:
      role === "candidate"
        ? `+2376997${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
        : null,
    role,
    is_verified: role === "candidate",
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowErr) throw new Error(`users insert: ${rowErr.message}`);
  return id;
}

async function createCompany(userId: string, name: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("company_profiles")
    .insert({
      user_id: userId,
      company_name: name,
      city: "Douala",
      address: "Rue de la preuve",
      onboarding_status: "completed",
      verification_status: "verified",
      niu: `M17${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

async function createCandidate(userId: string, firstName: string) {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: "Ngono",
      date_of_birth: "1996-05-14",
      city: "Douala",
      address: "Bonamoussadi, rue privée",
      latitude: 4.08,
      longitude: 9.74,
      bio: "Candidat de preuve du lot 17a.",
      cni_number: `CNI17${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677171717",
      momo_verified: true,
      onboarding_status: "completed",
      onboarding_step: 6,
      profile_completion_pct: 100,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`candidate insert: ${error?.message}`);
  return data.id;
}

async function cleanAccounts(ids: string[]) {
  if (ids.length === 0) return;
  purgeProofJobs("candidate-premium", { userIds: ids });
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  if (companyIds.length > 0) {
    const { data: jobs } = await serviceClient
      .from("jobs")
      .select("id")
      .in("company_id", companyIds);
    const jobIds = (jobs ?? []).map((j) => j.id);
    if (jobIds.length > 0) {
      await serviceClient.from("contracts").delete().in("job_id", jobIds);
      await serviceClient.from("missions").delete().in("job_id", jobIds);
      await serviceClient
        .from("job_applications")
        .delete()
        .in("job_id", jobIds);
      await serviceClient.from("jobs").delete().in("id", jobIds);
    }
  }
  // Historique en ajout seul : retiré avec les comptes de preuve.
  await serviceClient
    .from("candidate_premium_grants")
    .delete()
    .in("candidate_user_id", ids);
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("company_profiles").delete().in("user_id", ids);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  for (const sql of DROP_ALL) execSql(sql);
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofCandidatePremium === true)
      .map((u) => u.id),
  );
}

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  text: string;
};
async function http(
  method: "GET" | "POST",
  url: string,
  cookie: string | null,
  json?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await appFetch(`${APP_URL}${url}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

const CONTENT = {
  description: "Preuve du plan candidat (lot 17a).",
  address: "Boulevard de la Réunification",
  city: "Douala",
};

/** Un plan ou un délai apparaît-il dans un texte destiné à l'entreprise ? */
const PLAN_LEAK =
  /premium|candidate_plan|cancellation_notice|notice_hours|"plan"|premium_until/i;

/** Forme d'un signal : domaine, ressource et identifiant du message
 * (ajouté par realtime.send), comme dans la preuve `realtime` (X1). */
const SIGNAL_KEYS = new Set(["d", "r", "id"]);

type Terms = {
  mission_day_id: string;
  candidate_plan: string;
  cancellation_notice_hours: number;
  selected_at: string;
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17a-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();

    const idA = await createAccount(mail("a"), "company");
    const candKeys = ["c1", "c2", "c3", "cf", "cp", "cd", "ce", "t"] as const;
    const candIds = await Promise.all(
      candKeys.map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idFnd = await createAccount(mail("fnd"), "admin_founder");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("off"), "admin_ops");
    ids.push(idA, ...candIds, idOps, idFnd, idSup, idOff);
    const coA = await createCompany(idA, "Supermarché Deido");
    const uid = Object.fromEntries(
      candKeys.map((k, i) => [k, candIds[i]]),
    ) as Record<(typeof candKeys)[number], string>;
    const prof = Object.fromEntries(
      await Promise.all(
        candKeys.map(async (k) => [k, await createCandidate(uid[k], k)]),
      ),
    ) as Record<(typeof candKeys)[number], string>;

    const sessions = await Promise.all(
      ["a", ...candKeys, "ops", "fnd", "sup", "off"].map((k) =>
        realSession(mail(k)),
      ),
    );
    const [A, C1, C2, C3, CF, CP, CD, CE, T, OPS, FND, SUP, OFF] = sessions;
    void C2;
    void C3;
    void CD;
    void CE;
    // Ops suspendu APRÈS l'ouverture de sa session (ancien jeton).
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const route = (userId: string) => `/api/admin/candidates/${userId}/premium`;
    const profileOf = async (userId: string) => {
      const [{ data: u }, { data: cp }] = await Promise.all([
        serviceClient.from("users").select("role").eq("id", userId).single(),
        serviceClient
          .from("candidate_profiles")
          .select("premium_until, premium_started_at")
          .eq("user_id", userId)
          .single(),
      ]);
      return { role: u?.role, ...cp! };
    };
    const countOf = async (
      table: "candidate_premium_grants" | "notifications" | "audit_logs",
      column: string,
      value: string,
      extra?: (q: ReturnType<DB["from"]>) => unknown,
    ) => {
      let q = serviceClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq(column, value);
      if (extra) q = extra(q as never) as typeof q;
      const { count } = await q;
      return count ?? 0;
    };
    const grantsOf = (userId: string) =>
      countOf("candidate_premium_grants", "candidate_user_id", userId);
    const premiumNotifs = async (userId: string) => {
      const { data } = await serviceClient
        .from("notifications")
        .select("data")
        .eq("user_id", userId)
        .eq("notification_type", "system");
      return (data ?? []).filter(
        (n) =>
          (n.data as { kind?: string } | null)?.kind === "candidate_premium",
      ).length;
    };
    const auditsOf = async (userId: string) => {
      const { data } = await serviceClient
        .from("audit_logs")
        .select("metadata, action")
        .like("action", "candidate_premium_%");
      return (data ?? []).filter(
        (a) =>
          (a.metadata as { candidate_user_id?: string })?.candidate_user_id ===
          userId,
      ).length;
    };
    const iso = (ms: number) => new Date(ms).toISOString();
    const action = (
      operation: "activate" | "extend" | "stop",
      endsAt: string | null,
      expected: string | null,
      reason = "Attribution de preuve du lot 17a.",
      requestId: string = randomUUID(),
    ) => ({
      request_id: requestId,
      operation,
      ends_at: endsAt,
      expected_until: expected,
      reason,
    });

    // ── P. Plan effectif ─────────────────────────────────────────
    {
      type StateCase = {
        state: { candidate: { plan: string; premium: boolean } };
        plan_at_end: string;
        plan_before_end: string;
      };
      const atEnd = await proofRpc<StateCase>("proof_l17a_state", {
        p_user: uid.c3,
        p_offset: "0 seconds",
      });
      const justBefore = await proofRpc<StateCase>("proof_l17a_state", {
        p_user: uid.c3,
        p_offset: "1 microsecond",
      });
      report(
        "P1 échéance exacte : Free à l'instant même, Premium 1 µs avant (my_account_state et fonction unique)",
        atEnd.state.candidate.plan === "free" &&
          atEnd.state.candidate.premium === false &&
          atEnd.plan_at_end === "free" &&
          atEnd.plan_before_end === "premium" &&
          justBefore.state.candidate.plan === "premium" &&
          justBefore.state.candidate.premium === true,
        { atEnd, justBefore },
      );
      // Rôle premium sans fin, ou fin future sans rôle : Free.
      await serviceClient
        .from("candidate_profiles")
        .update({ premium_until: iso(Date.now() + DAY) })
        .eq("user_id", uid.c2);
      const { data: c2State } = await C2.client.rpc("my_account_state");
      await serviceClient
        .from("users")
        .update({ role: "candidate_premium" })
        .eq("id", uid.c3);
      await serviceClient
        .from("candidate_profiles")
        .update({ premium_until: null })
        .eq("user_id", uid.c3);
      const { data: c3State } = await C3.client.rpc("my_account_state");
      const plan = (s: unknown) =>
        (s as { candidate?: { plan?: string } })?.candidate?.plan;
      report(
        "P2 rôle et fin exigés ensemble : fin future sans rôle → Free ; rôle sans fin → Free",
        plan(c2State) === "free" && plan(c3State) === "free",
        { c2: plan(c2State), c3: plan(c3State) },
      );
      // Remise à zéro (fixtures en clé service).
      await serviceClient
        .from("candidate_profiles")
        .update({ premium_until: null })
        .eq("user_id", uid.c2);
      await serviceClient
        .from("users")
        .update({ role: "candidate" })
        .eq("id", uid.c3);
    }

    // ── W. Écritures refusées ────────────────────────────────────
    {
      const future = iso(Date.now() + 10 * DAY);
      const p1 = await C1.client
        .from("candidate_profiles")
        .update({ premium_until: future })
        .eq("user_id", uid.c1)
        .select("id");
      const p2 = await C1.client
        .from("candidate_profiles")
        .update({ premium_started_at: future } as never)
        .eq("user_id", uid.c1)
        .select("id");
      const p3 = await C1.client
        .from("users")
        .update({ role: "candidate_premium" })
        .eq("id", uid.c1)
        .select("id");
      const p4 = await C1.client
        .from("candidate_premium_grants")
        .insert({
          request_id: randomUUID(),
          candidate_user_id: uid.c1,
          operation: "activate",
          ends_at: future,
          reason: "Auto-attribution refusée.",
          actor_id: uid.c1,
          actor_role: "candidate",
        })
        .select("id");
      const p5 = await C1.client.rpc("admin_manage_candidate_premium", {
        p_request_id: randomUUID(),
        p_user_id: uid.c1,
        p_operation: "activate",
        p_ends_at: future,
        p_expected_until: null as unknown as string,
        p_reason: "Auto-attribution refusée.",
      });
      const p6 = await http(
        "POST",
        route(uid.c1),
        C1.cookie,
        action("activate", future, null),
      );
      const after = await profileOf(uid.c1);
      report(
        "W1 candidat : plan, début, rôle, historique, RPC et route refusés ; rien n'a changé",
        !!p1.error &&
          !!p2.error &&
          !!p3.error &&
          !!p4.error &&
          p5.error?.message === "forbidden" &&
          p6.status === 403 &&
          after.role === "candidate" &&
          after.premium_until === null &&
          (await grantsOf(uid.c1)) === 0,
        {
          p1: p1.error?.code,
          p2: p2.error?.code,
          p3: p3.error?.code,
          p4: p4.error?.code,
          p5: p5.error?.message,
          p6: p6.status,
          after,
        },
      );

      const t1 = await http(
        "POST",
        route(uid.c1),
        T.cookie,
        action("activate", future, null),
      );
      const t2 = await http("GET", route(uid.c1), T.cookie);
      const t3 = await A.client.rpc("admin_candidate_premium", {
        p_user_id: uid.c1,
      });
      report(
        "W2 tiers (autre candidat, entreprise) : ni écriture ni lecture du plan d'un candidat",
        t1.status === 403 &&
          t2.status === 403 &&
          t3.error?.message === "forbidden",
        { t1: t1.status, t2: t2.status, t3: t3.error?.message },
      );

      const s1 = await http("GET", route(uid.c1), SUP.cookie);
      const s2 = await http(
        "POST",
        route(uid.c1),
        SUP.cookie,
        action("activate", future, null),
      );
      report(
        "W3 admin_support : lecture autorisée, écriture refusée (forbidden)",
        s1.status === 200 &&
          (s1.body.premium as { plan?: string })?.plan === "free" &&
          s2.status === 403 &&
          s2.body.code === "forbidden" &&
          (await grantsOf(uid.c1)) === 0,
        { s1: s1.status, s2: s2.body },
      );

      const o1 = await http(
        "POST",
        route(uid.c1),
        OFF.cookie,
        action("activate", future, null),
      );
      const o2 = await http("GET", route(uid.c1), OFF.cookie);
      const o3 = await OFF.client.rpc("admin_manage_candidate_premium", {
        p_request_id: randomUUID(),
        p_user_id: uid.c1,
        p_operation: "activate",
        p_ends_at: future,
        p_expected_until: null as unknown as string,
        p_reason: "Ops suspendu avec un ancien jeton.",
      });
      report(
        "W4 ops suspendu (jeton antérieur à la suspension) : écriture et lecture refusées",
        o1.status === 403 &&
          o2.status === 403 &&
          o3.error?.message === "forbidden",
        { o1: o1.status, o2: o2.status, o3: o3.error?.message },
      );

      const a1 = await anon.rpc("admin_manage_candidate_premium", {
        p_request_id: randomUUID(),
        p_user_id: uid.c1,
        p_operation: "activate",
        p_ends_at: future,
        p_expected_until: null as unknown as string,
        p_reason: "Anonyme qui tente une attribution.",
      });
      const a2 = await http(
        "POST",
        route(uid.c1),
        null,
        action("activate", future, null),
      );
      const f1 = await C1.client.rpc(
        "candidate_effective_plan" as never,
        {
          p_user_id: uid.c1,
          p_at: iso(Date.now()),
        } as never,
      );
      report(
        "W5 anonyme refusé ; candidate_effective_plan fermée aux sessions",
        !!a1.error && a2.status === 401 && !!(f1 as { error: unknown }).error,
        {
          a1: a1.error?.code,
          a2: a2.status,
          f1: (f1 as { error: { code?: string } | null }).error?.code,
        },
      );
    }

    // ── G. Activation, prolongation, arrêt ───────────────────────
    let c1Until = "";
    {
      const end1 = iso(Date.now() + 30 * DAY);
      const t0 = new Date().toISOString();
      const g1 = await http(
        "POST",
        route(uid.c1),
        OPS.cookie,
        action("activate", end1, null),
      );
      const st = await profileOf(uid.c1);
      c1Until = st.premium_until ?? "";
      const { data: c1State } = await C1.client.rpc("my_account_state");
      const cand = (c1State as { candidate: Record<string, unknown> })
        .candidate;
      const { count: subs } = await serviceClient
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid.c1);
      const { count: pays, error: paysErr } = await serviceClient
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("candidate_id", [prof.c1, uid.c1]);
      if (paysErr) throw new Error(`payments: ${paysErr.message}`);
      const { data: grant } = await serviceClient
        .from("candidate_premium_grants")
        .select(
          "operation, source, actor_id, actor_role, period_started_at, ends_at, reason",
        )
        .eq("candidate_user_id", uid.c1)
        .single();
      report(
        "G1 activation par ops (route) : Premium jusqu'à la fin choisie, début enregistré, auteur = session",
        g1.status === 200 &&
          (g1.body.result as { plan?: string })?.plan === "premium" &&
          st.role === "candidate_premium" &&
          Date.parse(st.premium_until ?? "") === Date.parse(end1) &&
          !!st.premium_started_at &&
          Date.parse(st.premium_started_at!) >= Date.parse(t0) - 5_000 &&
          cand.plan === "premium" &&
          Date.parse(String(cand.premium_until)) === Date.parse(end1) &&
          grant?.operation === "activate" &&
          grant?.source === "admin_grant" &&
          grant?.actor_id === idOps &&
          grant?.actor_role === "admin_ops",
        { g1: g1.body, st, cand, grant },
      );
      report(
        "G2 historique, audit et notification uniques ; aucune ligne d'abonnement ni de paiement",
        (await grantsOf(uid.c1)) === 1 &&
          (await auditsOf(uid.c1)) === 1 &&
          (await premiumNotifs(uid.c1)) === 1 &&
          (subs ?? 0) === 0 &&
          (pays ?? 0) === 0,
        { subs, pays },
      );

      const bad = [
        await http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("activate", end1, null, "court"),
        ),
        await http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("activate", iso(Date.now() - 60_000), null),
        ),
        await http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("activate", null, null),
        ),
        await http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("extend", end1, null),
        ),
        await http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("stop", null, null),
        ),
        await http(
          "POST",
          route(uid.c1),
          OPS.cookie,
          action("activate", end1, c1Until),
        ),
        await http(
          "POST",
          route(uid.c1),
          OPS.cookie,
          action("extend", iso(Date.now() + 40 * DAY), null),
        ),
        await http(
          "POST",
          route(uid.c1),
          OPS.cookie,
          action("extend", end1, c1Until),
        ),
        await http(
          "POST",
          route(idA),
          OPS.cookie,
          action("activate", end1, null),
        ),
      ];
      const codes = bad.map((r) => `${r.status}:${String(r.body.code)}`);
      report(
        "G3 refus : motif court, fin passée, fin absente, prolonger ou arrêter un Free, réactiver, état lu périmé, fin non postérieure, compte non candidat",
        JSON.stringify(codes) ===
          JSON.stringify([
            "400:reason_invalid",
            "400:period_invalid",
            "400:period_invalid",
            "409:premium_not_active",
            "409:premium_not_active",
            "409:premium_already_active",
            "409:premium_state_changed",
            "400:period_invalid",
            "404:candidate_not_found",
          ]) &&
          (await grantsOf(uid.c1)) === 1 &&
          (await grantsOf(uid.c2)) === 0,
        codes,
      );

      const end2 = iso(Date.now() + 60 * DAY);
      const g4 = await http(
        "POST",
        route(uid.c1),
        FND.cookie,
        action("extend", end2, c1Until),
      );
      const st2 = await profileOf(uid.c1);
      report(
        "G4 prolongation par le fondateur : nouvelle fin, début conservé, fin précédente historisée",
        g4.status === 200 &&
          Date.parse(st2.premium_until ?? "") === Date.parse(end2) &&
          st2.premium_started_at === st.premium_started_at &&
          (await grantsOf(uid.c1)) === 2,
        { g4: g4.body, st2 },
      );

      const g5 = await http(
        "POST",
        route(uid.c1),
        OPS.cookie,
        action("stop", null, st2.premium_until),
      );
      const st3 = await profileOf(uid.c1);
      const { data: c1After } = await C1.client.rpc("my_account_state");
      const hist = await http("GET", route(uid.c1), SUP.cookie);
      const history = (
        (
          hist.body.premium as {
            history?: { operation: string; previous_ends_at: string | null }[];
          }
        )?.history ?? []
      ).map((h) => h.operation);
      const sig = await proofRpc<{ d: string; r: string | null }[]>(
        "proof_l17a_messages",
        {
          p_topic: `user:${uid.c1}`,
          p_since: t0,
        },
      );
      const adminSig = await proofRpc<{ d: string; r: string | null }[]>(
        "proof_l17a_messages",
        {
          p_topic: "admin",
          p_since: t0,
        },
      );
      report(
        "G5 arrêt : Free immédiatement (fin = instant de l'arrêt), rôle candidat, historique complet lisible par le support",
        g5.status === 200 &&
          (g5.body.result as { plan?: string })?.plan === "free" &&
          st3.role === "candidate" &&
          st3.premium_started_at === null &&
          Date.parse(st3.premium_until ?? "") <= Date.now() + 1_000 &&
          (c1After as { candidate: { plan: string } }).candidate.plan ===
            "free" &&
          JSON.stringify(history) ===
            JSON.stringify(["stop", "extend", "activate"]) &&
          (await auditsOf(uid.c1)) === 3 &&
          (await premiumNotifs(uid.c1)) === 3,
        { g5: g5.body, st3, history },
      );
      report(
        "G6 signaux : candidat et support avertis (« subscription »), charge utile {d, r, id} seulement",
        sig.some((m) => m.d === "subscription") &&
          adminSig.some((m) => m.d === "subscription" && m.r === null) &&
          [...sig, ...adminSig].every((m) =>
            Object.keys(m).every((k) => SIGNAL_KEYS.has(k)),
          ),
        { sig, adminSig: adminSig.filter((m) => m.d === "subscription") },
      );
    }

    // ── I. Idempotence et concurrence ────────────────────────────
    {
      const end = iso(Date.now() + 15 * DAY);
      const body = action("activate", end, null, "Relance réseau du lot 17a.");
      const replays = await Promise.all(
        Array.from({ length: 5 }, () =>
          http("POST", route(uid.c2), OPS.cookie, body),
        ),
      );
      const applied = replays.map(
        (r) =>
          (r.body.result as { already_applied?: boolean })?.already_applied,
      );
      report(
        "I1 cinq envois simultanés de la même opération : une écriture, un audit, une notification",
        replays.every((r) => r.status === 200) &&
          applied.filter((a) => a === false).length === 1 &&
          applied.filter((a) => a === true).length === 4 &&
          (await grantsOf(uid.c2)) === 1 &&
          (await auditsOf(uid.c2)) === 1 &&
          (await premiumNotifs(uid.c2)) === 1,
        applied,
      );

      const conflict = await http("POST", route(uid.c2), OPS.cookie, {
        ...body,
        ends_at: iso(Date.now() + 20 * DAY),
      });
      const otherCandidate = await http(
        "POST",
        route(uid.cd),
        OPS.cookie,
        body,
      );
      report(
        "I2 même clé pour d'autres paramètres ou un autre candidat : request_conflict, rien d'écrit",
        conflict.status === 409 &&
          conflict.body.code === "request_conflict" &&
          otherCandidate.status === 409 &&
          otherCandidate.body.code === "request_conflict" &&
          (await grantsOf(uid.cd)) === 0,
        { conflict: conflict.body, other: otherCandidate.body },
      );

      const until = (await profileOf(uid.c2)).premium_until;
      const [x, y] = await Promise.all([
        http(
          "POST",
          route(uid.c2),
          OPS.cookie,
          action("extend", iso(Date.now() + 40 * DAY), until),
        ),
        http(
          "POST",
          route(uid.c2),
          FND.cookie,
          action("extend", iso(Date.now() + 50 * DAY), until),
        ),
      ]);
      const ok = [x, y].filter((r) => r.status === 200).length;
      const refused = [x, y].find((r) => r.status !== 200);
      report(
        "I3 deux agents prolongent en même temps sur le même état lu : une seule réussite, l'autre premium_state_changed",
        ok === 1 &&
          refused?.body.code === "premium_state_changed" &&
          (await grantsOf(uid.c2)) === 2 &&
          (await auditsOf(uid.c2)) === 2,
        { x: x.body, y: y.body },
      );
    }

    // ── S. Conditions d'engagement à la sélection ────────────────
    let date = 0;
    const nextDate = () => {
      date += 1;
      return `2099-12-${String(date).padStart(2, "0")}`;
    };
    const termsOf = async (applicationId: string): Promise<Terms[]> => {
      const { data } = await serviceClient
        .from("mission_day_commitment_terms")
        .select(
          "mission_day_id, candidate_plan, cancellation_notice_hours, selected_at",
        )
        .eq("application_id", applicationId);
      return (data ?? []) as Terms[];
    };
    const selectedAt = async (applicationId: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("selected_at")
          .eq("id", applicationId)
          .single()
      ).data?.selected_at;
    const singleJob = async (title: string) =>
      (
        await insertJobWithDays(
          serviceClient,
          {
            ...CONTENT,
            title,
            company_id: coA,
            mission_pay_per_candidate: 8000,
            positions_available: 1,
          },
          [{ date: nextDate(), start_time: "08:00", end_time: "16:00" }],
        )
      ).jobId;
    const applyOne = async (s: Session, jobId: string) => {
      const { data, error } = await s.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !data) throw new Error(`apply: ${error?.message}`);
      return data.id;
    };
    const grant = (
      userId: string,
      op: "activate" | "stop",
      endsAt: string | null,
      expected: string | null,
    ) => http("POST", route(userId), OPS.cookie, action(op, endsAt, expected));

    {
      // S1 : Free sélectionné, puis Premium activé.
      const job = await singleJob("Mise en rayon (Free)");
      const app = await applyOne(CF, job);
      const t0 = new Date().toISOString();
      const sel = await signAndSelectHttp(APP_URL, app, A.cookie);
      const before = await termsOf(app);
      const g = await grant(
        uid.cf,
        "activate",
        iso(Date.now() + 30 * DAY),
        null,
      );
      const after = await termsOf(app);
      report(
        "S1 sélection Free : 48 h et instant de sélection enregistrés ; l'activation ultérieure ne change rien",
        sel.status === 200 &&
          g.status === 200 &&
          before.length === 1 &&
          before[0].candidate_plan === "free" &&
          before[0].cancellation_notice_hours === 48 &&
          Date.parse(before[0].selected_at) ===
            Date.parse((await selectedAt(app)) ?? "") &&
          JSON.stringify(after) === JSON.stringify(before),
        { before, after },
      );

      // C1 : réponses et signaux de l'entreprise sans plan.
      const preview = await http(
        "GET",
        `/api/applications/${app}/contract-preview`,
        A.cookie,
      );
      const { data: applicants } = await A.client.rpc(
        "company_job_applicants",
        { p_job_id: job },
      );
      const companySig = await proofRpc<Record<string, unknown>[]>(
        "proof_l17a_messages",
        {
          p_topic: `user:${idA}`,
          p_since: t0,
        },
      );
      const direct = await A.client
        .from("mission_day_commitment_terms")
        .select("*");
      report(
        "C1 entreprise : aperçu, sélection, liste des candidats et signaux sans plan ni délai ; conditions illisibles",
        !PLAN_LEAK.test(sel.text) &&
          !PLAN_LEAK.test(preview.text) &&
          !PLAN_LEAK.test(JSON.stringify(applicants ?? [])) &&
          companySig.length > 0 &&
          companySig.every((m) => m.d !== "subscription") &&
          companySig.every((m) =>
            Object.keys(m).every((k) => SIGNAL_KEYS.has(k)),
          ) &&
          !!direct.error,
        {
          signals: companySig,
          direct: direct.error?.code,
        },
      );
    }

    {
      // S2 : Premium sélectionné sur une période complète, puis arrêt.
      const g = await grant(
        uid.cp,
        "activate",
        iso(Date.now() + 30 * DAY),
        null,
      );
      const d1 = nextDate();
      const d2 = nextDate();
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title: "Inventaire (période complète)",
          company_id: coA,
          mission_pay_per_candidate: 20000,
          positions_available: 1,
        },
        [
          { date: d1, start_time: "08:00", end_time: "16:00" },
          { date: d2, start_time: "08:00", end_time: "16:00" },
        ],
        "full_period",
      );
      const app = await applyOne(CP, jobId);
      const sel = await signAndSelectHttp(APP_URL, app, A.cookie);
      const before = await termsOf(app);
      const at = await selectedAt(app);
      const replay = await signAndSelectHttp(APP_URL, app, A.cookie);
      const afterReplay = await termsOf(app);
      const until = (await profileOf(uid.cp)).premium_until;
      const stop = await grant(uid.cp, "stop", null, until);
      const afterStop = await termsOf(app);
      report(
        "S2 période complète Premium : 24 h et même instant pour chaque journée ; relance de la sélection et arrêt sans effet",
        g.status === 200 &&
          sel.status === 200 &&
          before.length === 2 &&
          before.every(
            (t) =>
              t.candidate_plan === "premium" &&
              t.cancellation_notice_hours === 24 &&
              Date.parse(t.selected_at) === Date.parse(at ?? ""),
          ) &&
          replay.status === 200 &&
          (replay.body.selection as { already_selected?: boolean })
            ?.already_selected === true &&
          afterReplay.length === 2 &&
          stop.status === 200 &&
          JSON.stringify(afterStop) === JSON.stringify(before),
        { before, afterStop, replay: replay.body },
      );

      // S3 : immuables pour tout auteur, fermées aux sessions.
      const upd = await serviceClient
        .from("mission_day_commitment_terms")
        .update({ candidate_plan: "free", cancellation_notice_hours: 48 })
        .eq("application_id", app)
        .select("mission_day_id");
      const candRead = await CP.client
        .from("mission_day_commitment_terms")
        .select("*");
      const candIns = await CP.client
        .from("mission_day_commitment_terms")
        .insert({
          mission_day_id: before[0].mission_day_id,
          mission_id: randomUUID(),
          application_id: app,
          candidate_id: prof.cp,
          candidate_plan: "premium",
          cancellation_notice_hours: 24,
          selected_at: iso(Date.now()),
        })
        .select("mission_day_id");
      const grantUpd = await serviceClient
        .from("candidate_premium_grants")
        .update({ reason: "Réécriture de l'historique refusée." })
        .eq("candidate_user_id", uid.cp)
        .select("id");
      report(
        "S3 conditions et historique immuables (clé service comprise) ; lecture et écriture fermées aux sessions",
        !!upd.error &&
          !!candRead.error &&
          !!candIns.error &&
          !!grantUpd.error &&
          JSON.stringify(await termsOf(app)) === JSON.stringify(before),
        {
          upd: upd.error?.message,
          candRead: candRead.error?.code,
          candIns: candIns.error?.code,
          grantUpd: grantUpd.error?.message,
        },
      );
    }

    {
      // S4 : journées au choix, Premium à la première sélection, puis
      // expiration (fin passée) avant la seconde.
      const g = await grant(
        uid.cd,
        "activate",
        iso(Date.now() + 30 * DAY),
        null,
      );
      const { jobId, dayIds } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title: "Animation (journées au choix)",
          company_id: coA,
          mission_pay_per_candidate: 9000,
          positions_available: 1,
        },
        [
          {
            date: nextDate(),
            start_time: "09:00",
            end_time: "17:00",
            pay: 9000,
            positions: 1,
          },
          {
            date: nextDate(),
            start_time: "09:00",
            end_time: "17:00",
            pay: 9000,
            positions: 1,
          },
        ],
        "per_day",
      );
      const { error: applyErr } = await CD.client.rpc("apply_to_job_days", {
        p_job_id: jobId,
        p_day_ids: dayIds,
      });
      if (applyErr) throw new Error(`apply days: ${applyErr.message}`);
      const { data: apps } = await serviceClient
        .from("job_applications")
        .select("id, job_day_id")
        .eq("job_id", jobId)
        .eq("candidate_id", prof.cd);
      const app1 = apps!.find((a) => a.job_day_id === dayIds[0])!.id;
      const app2 = apps!.find((a) => a.job_day_id === dayIds[1])!.id;
      const s1 = await signAndSelectHttp(APP_URL, app1, A.cookie);
      // Expiration naturelle : fin placée dans le passé (aucune écriture
      // n'est faite à l'échéance en production).
      await serviceClient
        .from("candidate_profiles")
        .update({ premium_until: iso(Date.now() - 1_000) })
        .eq("user_id", uid.cd);
      const s2 = await signAndSelectHttp(APP_URL, app2, A.cookie);
      const t1 = await termsOf(app1);
      const t2 = await termsOf(app2);
      report(
        "S4 journées au choix : chaque sélection a ses conditions (Premium 24 h, puis Free 48 h après l'expiration)",
        g.status === 200 &&
          s1.status === 200 &&
          s2.status === 200 &&
          t1.length === 1 &&
          t1[0].candidate_plan === "premium" &&
          t1[0].cancellation_notice_hours === 24 &&
          t2.length === 1 &&
          t2[0].candidate_plan === "free" &&
          t2[0].cancellation_notice_hours === 48 &&
          Date.parse(t2[0].selected_at) > Date.parse(t1[0].selected_at),
        { t1, t2 },
      );
    }

    {
      // S5 : sélection à l'instant exact de l'expiration, et 1 µs avant.
      const jobExact = await singleJob("Caisse (instant exact)");
      const jobBefore = await singleJob("Caisse (1 µs avant)");
      const appExact = await applyOne(CE, jobExact);
      const appBefore = await applyOne(CE, jobBefore);
      type SelectCase = {
        error: string | null;
        now: string;
        premium_until: string;
        terms: { plan: string; hours: number; selected_at: string }[] | null;
      };
      const exact = await proofRpc<SelectCase>("proof_l17a_select", {
        p_company_user: idA,
        p_candidate_user: uid.ce,
        p_application: appExact,
        p_offset: "0 seconds",
      });
      const before = await proofRpc<SelectCase>("proof_l17a_select", {
        p_company_user: idA,
        p_candidate_user: uid.ce,
        p_application: appBefore,
        p_offset: "1 microsecond",
      });
      report(
        "S5 sélection à l'instant exact de l'expiration → Free 48 h ; 1 µs avant → Premium 24 h",
        exact.error === null &&
          exact.terms?.length === 1 &&
          exact.terms[0].plan === "free" &&
          exact.terms[0].hours === 48 &&
          exact.terms[0].selected_at === exact.premium_until &&
          before.error === null &&
          before.terms?.length === 1 &&
          before.terms[0].plan === "premium" &&
          before.terms[0].hours === 24,
        { exact, before },
      );
    }

    {
      // S6 : sélection sans conditions dans l'historique (fixture de
      // service sans sélection) : aucune ligne inventée.
      const job = await singleJob("Journée sans sélection");
      const { data: app } = await serviceClient
        .from("job_applications")
        .insert({ job_id: job, candidate_id: prof.t, status: "pending" })
        .select("id")
        .single();
      const { data: mission } = await serviceClient
        .from("missions")
        .insert({
          job_id: job,
          candidate_id: prof.t,
          application_id: app!.id,
          scheduled_date: "2099-12-28",
          scheduled_start_time: "08:00",
          scheduled_end_time: "16:00",
        })
        .select("id")
        .single();
      const { count } = await serviceClient
        .from("mission_day_commitment_terms")
        .select("mission_day_id", { count: "exact", head: true })
        .eq("mission_id", mission!.id);
      report(
        "S6 journée créée hors sélection réussie : aucune condition inventée",
        !!mission && count === 0,
        { count },
      );
    }

    {
      // L1 : engagement sélectionné avant le lot 17a (conditions absentes,
      // simulées en retirant celles de la sélection) → marqué « legacy »
      // par la fonction de reprise de la migration, sans plan ni délai.
      const job = await singleJob("Engagement historique");
      const app = await applyOne(C1, job);
      const sel = await signAndSelectHttp(APP_URL, app, A.cookie);
      const { data: fresh } = await serviceClient
        .from("mission_day_commitment_terms")
        .select("terms_source")
        .eq("application_id", app);
      type LegacyCase = {
        first: number;
        second: number;
        terms: {
          source: string;
          plan: string | null;
          hours: number | null;
          selected_at: string | null;
        }[];
        selection_rows: number;
        selection_rows_before: number;
      };
      const legacy = await proofRpc<LegacyCase>("proof_l17a_legacy", {
        p_application: app,
      });
      const at = await selectedAt(app);
      report(
        "L1 engagement antérieur : ligne « legacy » sans plan ni délai, instant de sélection repris ; reprise idempotente, conditions des nouvelles sélections intactes",
        sel.status === 200 &&
          fresh?.[0]?.terms_source === "selection" &&
          legacy.first >= 1 &&
          legacy.second === 0 &&
          legacy.terms.length === 1 &&
          legacy.terms[0].source === "legacy" &&
          legacy.terms[0].plan === null &&
          legacy.terms[0].hours === null &&
          Date.parse(legacy.terms[0].selected_at ?? "") ===
            Date.parse(at ?? "") &&
          legacy.selection_rows === legacy.selection_rows_before,
        legacy,
      );
    }

    {
      // G7 : aucune durée commerciale imposée ; borne technique seulement.
      const far = iso(Date.now() + 3 * 365 * DAY);
      const g1 = await http(
        "POST",
        route(uid.c3),
        OPS.cookie,
        action("activate", far, null),
      );
      const until = (await profileOf(uid.c3)).premium_until;
      const rpc = (endsAt: string) =>
        FND.client.rpc("admin_manage_candidate_premium", {
          p_request_id: randomUUID(),
          p_user_id: uid.c3,
          p_operation: "extend",
          p_ends_at: endsAt,
          p_expected_until: until as string,
          p_reason: "Borne technique de la date de fin.",
        });
      const inf = await rpc("infinity");
      const y10k = await rpc("10000-01-01T00:00:00+00:00");
      const max = await http(
        "POST",
        route(uid.c3),
        FND.cookie,
        action("extend", "9999-12-31T23:59:59Z", until),
      );
      const after = await profileOf(uid.c3);
      report(
        "G7 fin à trois ans puis au 9999-12-31 acceptées (aucune limite de durée) ; « infinity » et 10000-01-01 refusées (period_invalid)",
        g1.status === 200 &&
          inf.error?.message === "period_invalid" &&
          y10k.error?.message === "period_invalid" &&
          max.status === 200 &&
          Date.parse(after.premium_until ?? "") ===
            Date.parse("9999-12-31T23:59:59Z"),
        {
          g1: g1.status,
          inf: inf.error?.message,
          y10k: y10k.error?.message,
          max: max.body,
          after,
        },
      );
    }

    {
      // A1 : page admin du candidat, garde commune (compte actif exigé).
      // Redirection en 3xx, ou NEXT_REDIRECT dans le flux une fois la
      // réponse commencée (même critère que admin-centralization I5).
      const page = async (s: Session) => {
        const res = await appFetch(`${APP_URL}/admin/candidates/${uid.c1}`, {
          headers: { Cookie: s.cookie },
          redirect: "manual",
        });
        const html = await res.text();
        return {
          status: res.status,
          redirected:
            (res.status >= 300 && res.status < 400) ||
            html.includes("NEXT_REDIRECT"),
        };
      };
      const [off, ops, sup] = await Promise.all([
        page(OFF),
        page(OPS),
        page(SUP),
      ]);
      report(
        "A1 page admin du candidat : ops suspendu (jeton antérieur à la suspension) redirigé ; ops et support actifs admis",
        off.redirected &&
          !ops.redirected &&
          ops.status === 200 &&
          !sup.redirected &&
          sup.status === 200,
        { off, ops, sup },
      );
    }
  } finally {
    try {
      for (const sql of DROP_ALL) execSql(sql);
    } finally {
      await cleanAccounts(ids);
    }
  }

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
