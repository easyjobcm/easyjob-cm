/**
 * Preuve lot 16 — instruction des journées contestées : délais, double
 * validation exceptionnelle, résultats et révision interne.
 *
 * Fixtures en clé service (entreprises A et B, candidats C1 à C4, admins
 * OPS1, OPS2, OPS3, support et ops suspendu ; offres d'une journée,
 * sélections par « Signer et sélectionner ») ; tentatives en sessions
 * RÉELLES (routes avec cookies, RPC avec le JWT) ; état relu en clé
 * service. Instants contrôlés sans attente : le balayage des échéances
 * reçoit l'instant à rejouer (p_at) ; la fin du délai de révision est
 * placée à now() + décalage dans la même transaction que la demande
 * (fonction temporaire `proof_l16_review`).
 *
 *   D. Délais : relance à 24 h et examen renforcé à 48 h (juste avant,
 *      instant exact), balayages répétés et concurrents sans doublon,
 *      prolongation motivée et tracée, réponse de l'entreprise qui arrête
 *      les relances, silence sans confirmation.
 *   I. Instruction : situation, complément demandé et réponse, notes
 *      internes ; confidentialité et isolation entre missions.
 *   V. Double validation : grades, support exclu, auto-approbation
 *      refusée, conflit d'intérêts, examen renforcé et second canal exigés
 *      pour un silence, dossier modifié pendant la seconde revue, admin
 *      suspendu (ancien jeton), décision atomique et relances.
 *   C. Concurrence code / décision et confirmation de l'entreprise /
 *      décision (ordres imposés), panne transactionnelle.
 *   R. Non établi, partiel, désaccord : aucune sanction, journée et
 *      forfait inchangés.
 *   A. Révision : sept jours exacts, demandes des deux parties, agent
 *      distinct, attente d'affectation, décisions successives, arbitrage
 *      pour une journée confirmée.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectHttp } from "./lib/sign-and-select";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L16-disputes-01!";
const PROOF_USER_METADATA = { proofMissionDisputes: true };
const HOUR = 3600_000;

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "mission-disputes" });
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

// Fin du délai de révision placée à now() + décalage, puis vraie demande
// sous l'identité de la partie, dans la même transaction (instant exact).
const REVIEW_FN = `
create or replace function public.proof_l16_review(
  p_actor uuid, p_incident uuid, p_offset interval, p_statement text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
  v_err text;
begin
  alter table public.mission_incident_decisions disable trigger trg_protect_mission_incident_decisions;
  update public.mission_incident_decisions d set review_deadline = now() + p_offset
  where d.incident_id = p_incident and d.kind = 'initial';
  alter table public.mission_incident_decisions enable trigger trg_protect_mission_incident_decisions;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.request_incident_review(p_incident, p_statement) x;
  exception when others then
    v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res,
    'deadline', now() + p_offset,
    'appeals', (select count(*) from public.mission_incident_appeals a where a.incident_id = p_incident));
end;
$$`;

// Balayage rejoué à l'instant exact created_at + décalage (microsecondes).
const SWEEP_FN = `
create or replace function public.proof_l16_sweep(p_incident uuid, p_offset interval)
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.incident_deadline_sweep(
    (select i.created_at from public.mission_incidents i where i.id = p_incident) + p_offset);
$$`;

const DROP_ALL = [
  "drop function if exists public.proof_l16_sweep(uuid, interval)",
  "drop trigger if exists proof_l16_slow on public.mission_days",
  "drop trigger if exists proof_l16_fail on public.audit_logs",
  "drop function if exists public.proof_l16_slow()",
  "drop function if exists public.proof_l16_fail()",
  "drop function if exists public.proof_l16_review(uuid, uuid, interval, text)",
];

function installFunctions() {
  for (const sql of DROP_ALL) execSql(sql);
  execSql(REVIEW_FN);
  execSql(SWEEP_FN);
  execSql(
    "revoke all on function public.proof_l16_sweep(uuid, interval) from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_l16_sweep(uuid, interval) to service_role",
  );
  execSql(
    "revoke all on function public.proof_l16_review(uuid, uuid, interval, text) from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_l16_review(uuid, uuid, interval, text) to service_role",
  );
  execSql("notify pgrst, 'reload schema'");
}

/** Ralentit la réalisation d'une journée (verrous tenus), pour l'ordre. */
function installSlow(dayId: string) {
  execSql(`create or replace function public.proof_l16_slow()
returns trigger language plpgsql set search_path = '' as $$
begin perform pg_sleep(2); return new; end $$`);
  execSql(`create trigger proof_l16_slow before update of actual_end_time
on public.mission_days for each row
when (new.id = '${dayId}'::uuid and old.actual_end_time is null
      and new.actual_end_time is not null)
execute function public.proof_l16_slow()`);
}
function dropSlow() {
  execSql("drop trigger if exists proof_l16_slow on public.mission_days");
}

/** Panne : la trace de la décision d'un dossier précis échoue. */
function installFailure(incidentId: string) {
  execSql(`create or replace function public.proof_l16_fail()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'proof_l16_failure'; end $$`);
  execSql(`create trigger proof_l16_fail before insert on public.audit_logs
for each row when (new.action = 'decide_incident_double_validation'
                   and new.resource_id::text = '${incidentId}')
execute function public.proof_l16_fail()`);
}
function dropFailure() {
  execSql("drop trigger if exists proof_l16_fail on public.audit_logs");
}

async function reviewCase(
  actor: string,
  incident: string,
  offset: string,
  statement: string,
): Promise<{
  error: string | null;
  result: Record<string, unknown> | null;
  appeals: number;
}> {
  const end = Date.now() + 15_000;
  for (;;) {
    const { data, error } = await serviceRpc.rpc("proof_l16_review", {
      p_actor: actor,
      p_incident: incident,
      p_offset: offset,
      p_statement: statement,
    });
    if (!error) return data;
    if (Date.now() > end || !/schema cache|function/i.test(error.message)) {
      throw new Error(`proof_l16_review: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ─── Sessions réelles ─────────────────────────────────────────────
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
      niu: `M16${String(Date.now()).slice(-9)}${name.length}`,
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
      last_name: "Mbarga",
      date_of_birth: "1997-03-21",
      city: "Douala",
      address: "Akwa, rue privée",
      latitude: 4.05,
      longitude: 9.7,
      bio: "Candidat de preuve du lot 16.",
      cni_number: "CNI16000161",
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677161616",
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
      .filter((u) => u.user_metadata?.proofMissionDisputes === true)
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

/** Date calendaire de Douala (UTC+1) décalée de `days` jours. */
const doualaDay = (days: number) =>
  new Date(Date.now() + HOUR + days * 24 * HOUR).toISOString().slice(0, 10);

const CONTENT = {
  description: "Preuve des journées contestées (lot 16).",
  address: "Boulevard de la Liberté",
  city: "Douala",
};
// Marqueurs internes : jamais dans une réponse lue par une partie.
const SECRET_ELEMENTS = "Élément interne vérifié : journal d'appels n° 4471";
const SECRET_NOTE = "Note interne : gérant joint hors ligne 2290";
const SECRET_REF = "Réf privée SMS 8890";

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l16-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    await installBarrier(execSql, serviceRpc);

    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const [idC1, idC2, idC3, idC4] = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps1 = await createAccount(mail("ops1"), "admin_ops");
    const idOps2 = await createAccount(mail("ops2"), "admin_founder");
    const idOps3 = await createAccount(mail("ops3"), "admin_ops");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("off"), "admin_ops");
    ids.push(
      idA,
      idB,
      idC1,
      idC2,
      idC3,
      idC4,
      idOps1,
      idOps2,
      idOps3,
      idSup,
      idOff,
    );
    const coA = await createCompany(idA, "Restaurant Wouri");
    await createCompany(idB, "Hôtel Tiers");
    const [, cand2] = await Promise.all([
      createCandidate(idC1, "Aline"),
      createCandidate(idC2, "Boris"),
      createCandidate(idC3, "Carine"),
      createCandidate(idC4, "Denis"),
    ]);
    const [A, B, C1, C2, C3, C4, OPS1, OPS2, OPS3, SUP, OFF] =
      await Promise.all(
        [
          "a",
          "b",
          "c1",
          "c2",
          "c3",
          "c4",
          "ops1",
          "ops2",
          "ops3",
          "sup",
          "off",
        ].map((k) => realSession(mail(k))),
      );

    let seq = 0;
    const mission = async (cand: Session, title: string) => {
      seq += 1;
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: coA,
          mission_pay_per_candidate: 9000,
          positions_available: 1,
        },
        [
          {
            date: `2099-10-${String(seq).padStart(2, "0")}`,
            start_time: "09:00",
            end_time: "17:00",
          },
        ],
      );
      const { data: app, error } = await cand.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !app) throw new Error(`apply: ${error?.message}`);
      const sel = await signAndSelectHttp(APP_URL, app.id, A.cookie);
      const missionId = (sel.body.selection as { mission_id?: string })
        ?.mission_id;
      if (!missionId) throw new Error(`select: ${sel.text.slice(0, 200)}`);
      const { data: day } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", missionId)
        .single();
      // Journée terminée (hier), avant tout début.
      const { error: shiftErr } = await serviceClient
        .from("mission_days")
        .update({
          scheduled_date: doualaDay(-1),
          scheduled_start_time: "00:00",
          scheduled_end_time: "23:00",
        })
        .eq("id", day!.id);
      if (shiftErr) throw new Error(`shift: ${shiftErr.message}`);
      return {
        jobId,
        missionId,
        dayId: day!.id,
        applicationId: app.id as string,
      };
    };
    type M = Awaited<ReturnType<typeof mission>>;
    const start = (s: Session, m: M) =>
      http("POST", `/api/missions/${m.missionId}/start`, s.cookie);
    const reportAs = async (
      s: Session,
      m: M,
      kind: string,
      statement: string,
    ) => {
      const r = await http(
        "POST",
        `/api/missions/${m.missionId}/incidents`,
        s.cookie,
        {
          mission_day_id: m.dayId,
          kind,
          statement,
        },
      );
      const id = (r.body.incident as { incident_id?: string })?.incident_id;
      if (!id) throw new Error(`report ${kind}: ${r.text.slice(0, 200)}`);
      return id;
    };
    const statementAs = (s: Session, incident: string, statement: string) =>
      http("POST", `/api/incidents/${incident}/statements`, s.cookie, {
        statement,
      });
    const incident = async (id: string) =>
      (
        await serviceClient
          .from("mission_incidents")
          .select("*")
          .eq("id", id)
          .single()
      ).data!;
    const events = async (id: string, type: string) =>
      (
        await serviceClient
          .from("mission_incident_events")
          .select("id, visibility, data")
          .eq("incident_id", id)
          .eq("event_type", type)
      ).data ?? [];
    const notifs = async (userId: string, kind: string, incidentId: string) =>
      (
        await serviceClient
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("data->>kind", kind)
          .eq("data->>incident_id", incidentId)
      ).data?.length ?? -1;
    /** Balayage à created_at + décalage, calculé par la base (µs). */
    const sweep = async (id: string, offset: string) => {
      const { data, error } = await serviceRpc.rpc("proof_l16_sweep", {
        p_incident: id,
        p_offset: offset,
      });
      if (error) throw new Error(`sweep: ${error.message}`);
      return data as number;
    };
    const dayRow = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_days")
          .select("actual_end_time, completion_source")
          .eq("id", dayId)
          .single()
      ).data!;
    const codeOf = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_completion_codes")
          .select("code, consumed_at")
          .eq("mission_day_id", dayId)
          .single()
      ).data!;
    const contact = (s: Session, id: string, body: Record<string, unknown>) =>
      http("POST", `/api/admin/incidents/${id}/contacts`, s.cookie, {
        channel: "phone",
        occurred_at: new Date(Date.now() - 60_000).toISOString(),
        ...body,
      });
    const decisionBody = (
      outcome: string,
      extra: Record<string, unknown> = {},
    ) => ({
      outcome,
      facts_retained:
        "Le candidat était présent de 9 h à 17 h selon deux témoins.",
      elements_verified: SECRET_ELEMENTS,
      contradictions:
        "L'entreprise ne conteste pas la présence, elle n'a pas répondu.",
      justification:
        "Les éléments concordants établissent la journée effectuée.",
      conflict: "none",
      ...extra,
    });
    const propose = (
      s: Session,
      id: string,
      outcome: string,
      extra: Record<string, unknown> = {},
    ) =>
      http(
        "POST",
        `/api/admin/incidents/${id}/proposals`,
        s.cookie,
        decisionBody(outcome, extra),
      );
    const proposalOf = (r: HttpResult) =>
      String((r.body.result as { proposal_id?: string })?.proposal_id ?? "");
    const review = (
      s: Session | null,
      proposal: string,
      approve = true,
      conflict: string | null = "none",
    ) =>
      http(
        "POST",
        `/api/admin/incident-proposals/${proposal}/review`,
        s?.cookie ?? null,
        {
          approve,
          note: "Seconde lecture du dossier complète.",
          ...(conflict ? { conflict } : {}),
        },
      );
    const resultOf = (r: HttpResult) =>
      (r.body.result ?? {}) as Record<string, unknown>;
    const decisions = async (id: string) =>
      (
        await serviceClient
          .from("mission_incident_decisions")
          .select("*")
          .eq("incident_id", id)
          .order("decided_at")
      ).data ?? [];
    const partyView = async (s: Session, m: M) => {
      const r = await http(
        "GET",
        `/api/missions/${m.missionId}/incidents`,
        s.cookie,
      );
      return {
        ...r,
        list: (r.body.incidents ?? []) as Record<string, unknown>[],
      };
    };

    // ── D. Délais ────────────────────────────────────────────────
    console.log("\n── D. Délais : relance 24 h, examen renforcé 48 h ──");
    const m1 = await mission(C1, "Dossier silencieux");
    await start(C1, m1);
    const x1 = await reportAs(
      C1,
      m1,
      "code_not_received",
      "J'ai travaillé, l'entreprise ne répond plus.",
    );
    await sweep(x1, "24 hours -1 microsecond");
    const before24 = (await events(x1, "reminder_24h")).length;
    await sweep(x1, "24 hours");
    const r24exact = (await events(x1, "reminder_24h")).length;
    await Promise.all([
      sweep(x1, "24 hours"),
      sweep(x1, "24 hours"),
      sweep(x1, "30 hours"),
    ]);
    const r24 = await events(x1, "reminder_24h");
    const opened = await events(x1, "opened");
    const notified = await events(x1, "party_notified");
    report(
      "D1 relance à 24 h exactement (rien à 24 h − 1 µs) ; balayages répétés et concurrents : une relance, une notification dans l'application à l'entreprise ; ouverture et notification initiale tracées",
      before24 === 0 &&
        r24exact === 1 &&
        r24.length === 1 &&
        r24[0].visibility === "party" &&
        (await notifs(idA, "mission_incident_reminder", x1)) === 1 &&
        opened.length === 1 &&
        notified.length === 1 &&
        (notified[0].data as { channel?: string }).channel === "in_app",
      { before24, r24: r24.length, opened: opened.length },
    );
    const earlyPropose = await propose(OPS1, x1, "established");
    report(
      "V0 silence avant l'examen renforcé : proposition « établie » refusée (escalation_pending)",
      earlyPropose.status === 409 &&
        earlyPropose.body.code === "escalation_pending",
      earlyPropose.body,
    );
    await sweep(x1, "48 hours -1 microsecond");
    const before48 = (await events(x1, "escalation_48h")).length;
    await sweep(x1, "48 hours");
    const e48exact = (await events(x1, "escalation_48h")).length;
    await Promise.all([sweep(x1, "48 hours"), sweep(x1, "50 hours")]);
    const e48 = await events(x1, "escalation_48h");
    const x1Row = await incident(x1);
    const c1View = await partyView(C1, m1);
    const c1Timeline = (
      (c1View.list[0]?.timeline ?? []) as { type: string }[]
    ).map((e) => e.type);
    report(
      "D2 examen renforcé à 48 h exactement (rien à 48 h − 1 µs), une seule fois, interne au support ; la partie voit ouverture, notification et relance, jamais l'examen interne",
      before48 === 0 &&
        e48exact === 1 &&
        e48.length === 1 &&
        e48[0].visibility === "admin" &&
        c1Timeline.includes("opened") &&
        c1Timeline.includes("reminder_24h") &&
        !c1Timeline.includes("escalation_48h"),
      { e48: e48.length, c1Timeline },
    );
    report(
      "D3 silence : aucune confirmation automatique (journée non confirmée, dossier ouvert, aucune décision)",
      (await dayRow(m1.dayId)).actual_end_time === null &&
        x1Row.status === "open" &&
        (await decisions(x1)).length === 0,
      x1Row.status,
    );

    const m2 = await mission(C2, "Dossier prolongé");
    await start(C2, m2);
    const x2 = await reportAs(
      C2,
      m2,
      "code_not_received",
      "Journée finie, pas de code remis.",
    );
    const [extBad, extShort, ext] = await Promise.all([
      http("POST", `/api/admin/incidents/${x2}/extend`, SUP.cookie, {
        hours: 0,
        reason: "Gérant en déplacement.",
      }),
      http("POST", `/api/admin/incidents/${x2}/extend`, SUP.cookie, {
        hours: 12,
        reason: "court",
      }),
      http("POST", `/api/admin/incidents/${x2}/extend`, SUP.cookie, {
        hours: 12,
        reason: "Gérant en déplacement jusqu'à demain midi.",
      }),
    ]);
    await sweep(x2, "24 hours");
    await sweep(x2, "36 hours -1 microsecond");
    const beforeExt = (await events(x2, "reminder_24h")).length;
    await sweep(x2, "36 hours");
    const extEvents = await events(x2, "deadline_extended");
    const { data: extAudit } = await serviceClient
      .from("audit_logs")
      .select("actor_id")
      .eq("action", "extend_incident_deadlines")
      .eq("resource_id", x2);
    const c2Timeline = (
      ((await partyView(C2, m2)).list[0]?.timeline ?? []) as { type: string }[]
    ).map((e) => e.type);
    report(
      "D4 prolongation motivée (12 h) : invalide refusée (extension_invalid, note_invalid) ; tracée (motif, heures, agent, audit) ; relance décalée à 36 h exactement ; non montrée aux parties",
      extBad.body.code === "extension_invalid" &&
        extShort.body.code === "note_invalid" &&
        ext.status === 200 &&
        beforeExt === 0 &&
        (await events(x2, "reminder_24h")).length === 1 &&
        extEvents.length === 1 &&
        (extEvents[0].data as { reason?: string; hours?: number }).hours ===
          12 &&
        (extEvents[0].data as { reason?: string }).reason ===
          "Gérant en déplacement jusqu'à demain midi." &&
        extAudit?.length === 1 &&
        extAudit[0].actor_id === idSup &&
        !c2Timeline.includes("deadline_extended"),
      { beforeExt, c2Timeline },
    );

    const m3 = await mission(C3, "Dossier répondu");
    await start(C3, m3);
    const x3 = await reportAs(
      C3,
      m3,
      "code_not_received",
      "Pas de code remis ce soir-là.",
    );
    await statementAs(
      A,
      x3,
      "Le candidat est parti à 15 h, nous contestons la journée.",
    );
    await sweep(x3, "48 hours");
    report(
      "D5 l'entreprise a répondu dans l'application : ni relance ni examen renforcé",
      (await events(x3, "reminder_24h")).length === 0 &&
        (await events(x3, "escalation_48h")).length === 0,
    );

    // ── I. Instruction ───────────────────────────────────────────
    console.log("\n── I. Instruction : situation, compléments, notes ──");
    const rev0 = (await incident(x3)).revision;
    const sit = await http(
      "POST",
      `/api/admin/incidents/${x3}/situation`,
      SUP.cookie,
      { situation: "presence_disputed" },
    );
    const ask = await http(
      "POST",
      `/api/admin/incidents/${x3}/info-requests`,
      SUP.cookie,
      {
        party: "company",
        question: "À quelle heure exacte le candidat est-il parti ?",
      },
    );
    const reqId = String(
      (ask.body.result as { request_id?: string })?.request_id ?? "",
    );
    const note = await http(
      "POST",
      `/api/admin/incidents/${x3}/notes`,
      SUP.cookie,
      { body: SECRET_NOTE },
    );
    const [askC3, answerWrong] = await Promise.all([
      partyView(C3, m3),
      http("POST", `/api/incident-info/${reqId}`, C3.cookie, {
        statement: "Je réponds à la place de l'entreprise.",
      }),
    ]);
    const answer = await http("POST", `/api/incident-info/${reqId}`, A.cookie, {
      statement: "Il est parti vers 15 h 10 d'après le chef.",
    });
    const answerAgain = await http(
      "POST",
      `/api/incident-info/${reqId}`,
      A.cookie,
      { statement: "Il est parti vers 15 h 10 d'après le chef." },
    );
    const aView = await partyView(A, m3);
    const aReq = (aView.list[0]?.info_requests ?? []) as {
      id: string;
      answered_at: string | null;
    }[];
    report(
      "I1 support : situation qualifiée, complément demandé à l'entreprise (visible d'elle seule), réponse enregistrée une fois ; le candidat ne voit ni ne répond à la question (404) ; nouvelle version du dossier",
      sit.status === 200 &&
        ask.status === 200 &&
        note.status === 200 &&
        ((askC3.list[0]?.info_requests ?? []) as unknown[]).length === 0 &&
        answerWrong.status === 404 &&
        answer.status === 200 &&
        (answerAgain.body.result as { already_answered?: boolean })
          ?.already_answered === true &&
        aReq.length === 1 &&
        !!aReq[0].answered_at &&
        (await incident(x3)).revision >= rev0 + 2 &&
        (await notifs(idA, "mission_incident_info", x3)) === 1,
      {
        revision: [rev0, (await incident(x3)).revision],
        answerWrong: answerWrong.status,
      },
    );

    // ── V. Double validation ─────────────────────────────────────
    console.log("\n── V. Double validation exceptionnelle ──");
    const noSecond = await propose(OPS1, x1, "established");
    await contact(SUP, x1, {
      entry_type: "request",
      channel: "phone",
      result: "no_answer",
    });
    await contact(SUP, x1, {
      entry_type: "request",
      channel: "sms",
      result: "sent",
      channel_verified: true,
      reference: SECRET_REF,
    });
    const [bySupPropose, p1res] = [
      await propose(SUP, x1, "established"),
      await propose(OPS1, x1, "established"),
    ];
    const p1 = proposalOf(p1res);
    report(
      "V1 silence à 48 h : second canal vérifié exigé (second_channel_required), puis proposition d'OPS1 sur la version courante ; support refusé (403)",
      noSecond.status === 409 &&
        noSecond.body.code === "second_channel_required" &&
        bySupPropose.status === 403 &&
        p1res.status === 200 &&
        !!p1,
      [noSecond.body.code, bySupPropose.status, p1res.status],
    );
    const [selfRev, supRev, companyRev, noConflict] = await Promise.all([
      review(OPS1, p1),
      review(SUP, p1),
      review(A, p1),
      review(OPS3, p1, true, null),
    ]);
    const concerned = await review(OPS3, p1, true, "concerned");
    const afterConcerned = await review(OPS3, p1, true, "none");
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);
    const offRev = await review(OFF, p1);
    const offDirect = await OFF.client.rpc("admin_review_incident_proposal", {
      p_proposal_id: p1,
      p_approve: true,
      p_note: "Ancien jeton d'un agent suspendu.",
      p_conflict: "none",
    });
    report(
      "V2 auto-approbation refusée (self_review_forbidden) ; support et entreprise 403 ; déclaration de conflit exigée ; agent déclaré concerné bloqué ensuite (conflict_of_interest) ; ops suspendu avec un ancien jeton refusé (route et appel direct)",
      selfRev.body.code === "self_review_forbidden" &&
        supRev.status === 403 &&
        companyRev.status === 403 &&
        noConflict.body.code === "conflict_declaration_required" &&
        resultOf(concerned).result === "conflict_declared" &&
        afterConcerned.body.code === "conflict_of_interest" &&
        offRev.status === 403 &&
        offDirect.error?.message === "forbidden",
      [
        selfRev.body.code,
        supRev.status,
        noConflict.body.code,
        resultOf(concerned).result,
        afterConcerned.body.code,
        offRev.status,
      ],
    );
    await statementAs(
      C1,
      x1,
      "J'ajoute : le chef de rang m'a vu partir à 17 h.",
    );
    const stale = await review(OPS2, p1);
    const p1Row = (
      await serviceClient
        .from("mission_incident_proposals")
        .select("status")
        .eq("id", p1)
        .single()
    ).data;
    report(
      "V3 dossier modifié pendant la seconde revue (nouvelle déclaration) : validation refusée (proposal_stale), rien n'est décidé, journée non confirmée",
      stale.status === 409 &&
        stale.body.code === "proposal_stale" &&
        p1Row?.status === "pending" &&
        (await decisions(x1)).length === 0 &&
        (await dayRow(m1.dayId)).actual_end_time === null,
      stale.body,
    );
    const p2 = proposalOf(await propose(OPS1, x1, "established"));
    const codeBefore = await codeOf(m1.dayId);
    const [d1, d2] = await Promise.all([review(OPS2, p2), review(OPS2, p2)]);
    const d3 = await review(OPS2, p2);
    const x1Dec = await decisions(x1);
    const day1 = await dayRow(m1.dayId);
    const { data: m1Row } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", m1.missionId)
      .single();
    const { data: decAudit } = await serviceClient
      .from("audit_logs")
      .select("actor_id, metadata")
      .eq("action", "decide_incident_double_validation")
      .eq("resource_id", x1);
    const results = [d1, d2].map((r) => resultOf(r).result).sort();
    report(
      "V4 relecture puis seconde validation par OPS2 (double clic, puis relance) : une décision, journée confirmée « exceptional », code non consommé, mission réalisée ; proposition OPS1, décision OPS2, une trace",
      results.join() === "already_decided,decided" &&
        resultOf(d3).result === "already_decided" &&
        resultOf(d3).decision_id === x1Dec[0]?.id &&
        x1Dec.length === 1 &&
        x1Dec[0].proposed_by === idOps1 &&
        x1Dec[0].decided_by === idOps2 &&
        day1.completion_source === "exceptional" &&
        (await codeOf(m1.dayId)).consumed_at === null &&
        codeBefore.consumed_at === null &&
        m1Row?.status === "completed" &&
        decAudit?.length === 1 &&
        decAudit[0].actor_id === idOps2 &&
        (
          await serviceClient
            .from("mission_incident_proposals")
            .select("status")
            .eq("id", p1)
            .single()
        ).data?.status === "superseded",
      { results, day1, m1Row },
    );
    const deadlineMs =
      Date.parse(x1Dec[0].review_deadline!) - Date.parse(x1Dec[0].decided_at);
    const codeLater = await http(
      "POST",
      `/api/missions/${m1.missionId}/complete`,
      C1.cookie,
      { code: codeBefore.code },
    );
    report(
      "V5 révision possible pendant exactement sept jours après la décision notifiée ; parties notifiées une fois ; code saisi ensuite : réalisation acquise, code non consommé",
      deadlineMs === 7 * 24 * HOUR &&
        (await notifs(idC1, "mission_incident_decision", x1)) === 1 &&
        (await notifs(idA, "mission_incident_decision", x1)) === 1 &&
        codeLater.status === 200 &&
        (codeLater.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        (await codeOf(m1.dayId)).consumed_at === null,
      { deadlineMs },
    );

    // ── C. Concurrence et panne ──────────────────────────────────
    console.log("\n── C. Concurrence et panne ──");
    const disputed = async (cand: Session, title: string) => {
      const m = await mission(cand, title);
      await start(cand, m);
      const x = await reportAs(
        cand,
        m,
        "code_not_received",
        "Journée effectuée, aucun code remis.",
      );
      await statementAs(
        A,
        x,
        "Nous contestons : travail non terminé selon le chef.",
      );
      const p = proposalOf(await propose(OPS1, x, "established"));
      if (!p) throw new Error(`proposition ${title}`);
      return { m, x, p, code: (await codeOf(m.dayId)).code };
    };
    const k1 = await disputed(C2, "Course code d'abord");
    installSlow(k1.m.dayId);
    const codeFirst = http(
      "POST",
      `/api/missions/${k1.m.missionId}/complete`,
      C2.cookie,
      { code: k1.code },
    );
    await waitSleeping(serviceRpc);
    const decSecond = await review(OPS2, k1.p);
    const codeFirstRes = await codeFirst;
    dropSlow();
    report(
      "C1 code puis décision (ordre imposé) : une réalisation par code ; la décision relit l'état (already_confirmed) sans effet : aucune décision, proposition inchangée",
      codeFirstRes.status === 200 &&
        resultOf(decSecond).result === "already_confirmed" &&
        (await dayRow(k1.m.dayId)).completion_source === "code" &&
        (await decisions(k1.x)).length === 0 &&
        (
          await serviceClient
            .from("mission_incident_proposals")
            .select("status")
            .eq("id", k1.p)
            .single()
        ).data?.status === "pending",
      { decision: resultOf(decSecond) },
    );
    const k2 = await disputed(C3, "Course décision d'abord");
    installSlow(k2.m.dayId);
    const decFirst = review(OPS2, k2.p);
    await waitSleeping(serviceRpc);
    const codeSecond = await http(
      "POST",
      `/api/missions/${k2.m.missionId}/complete`,
      C3.cookie,
      { code: k2.code },
    );
    const decFirstRes = await decFirst;
    dropSlow();
    report(
      "C2 décision puis code (ordre imposé) : une réalisation « exceptional » ; le code retrouve la réalisation acquise sans consommation",
      resultOf(decFirstRes).result === "decided" &&
        codeSecond.status === 200 &&
        (codeSecond.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        (await dayRow(k2.m.dayId)).completion_source === "exceptional" &&
        (await codeOf(k2.m.dayId)).consumed_at === null,
      { decision: resultOf(decFirstRes).result },
    );
    const k3m = await mission(C4, "Confirmation de l'entreprise");
    await start(C4, k3m);
    const k3x = await reportAs(
      C4,
      k3m,
      "code_not_received",
      "Code non remis, je relance le support.",
    );
    const k3c = await contact(SUP, k3x, {
      entry_type: "response",
      result: "work_confirmed",
      reference: "Appel du gérant, confirmation",
    });
    const k3p = proposalOf(await propose(OPS1, k3x, "established"));
    const explicit = await http(
      "POST",
      `/api/admin/incidents/${k3x}/confirm-day`,
      OPS3.cookie,
      {
        contact_id: (k3c.body.contact as { contact_id?: string })?.contact_id,
        reason: "Le gérant confirme la journée au téléphone.",
      },
    );
    const afterExplicit = await review(OPS2, k3p);
    report(
      "C3 confirmation explicite de l'entreprise (lot 15) puis seconde validation : journée « support », la décision relit l'état sans effet",
      explicit.status === 200 &&
        resultOf(afterExplicit).result === "already_confirmed" &&
        (await dayRow(k3m.dayId)).completion_source === "support" &&
        (await decisions(k3x)).length === 0,
      resultOf(afterExplicit),
    );
    const k4 = await disputed(C1, "Panne pendant la décision");
    installFailure(k4.x);
    let failed: HttpResult;
    try {
      failed = await review(OPS2, k4.p);
    } finally {
      dropFailure();
    }
    const failedState = {
      decisions: (await decisions(k4.x)).length,
      proposal: (
        await serviceClient
          .from("mission_incident_proposals")
          .select("status")
          .eq("id", k4.p)
          .single()
      ).data?.status,
      day: (await dayRow(k4.m.dayId)).actual_end_time,
      status: (await incident(k4.x)).status,
      notifs: await notifs(idC1, "mission_incident_decision", k4.x),
    };
    const retry = await review(OPS2, k4.p);
    report(
      "C4 panne de la trace pendant la décision : 500 générique, rien n'est écrit (décision, proposition, journée, dossier, notification) ; reprise : décision enregistrée une fois",
      failed.status === 500 &&
        failed.body.code === "review_failed" &&
        !failed.text.includes("proof_l16_failure") &&
        failedState.decisions === 0 &&
        failedState.proposal === "pending" &&
        failedState.day === null &&
        failedState.status === "answered" &&
        failedState.notifs === 0 &&
        resultOf(retry).result === "decided" &&
        (await decisions(k4.x)).length === 1,
      { failed: failed.body, failedState },
    );

    // ── R. Résultats sans sanction ───────────────────────────────
    console.log("\n── R. Non établi, partiel, désaccord ──");
    const repC2 = async () =>
      (
        await serviceRpc.rpc("compute_reputation", {
          p_subject_type: "candidate",
          p_subject_id: cand2,
        })
      ).data?.[0] as
        | { confirmed_count?: number; breach_count?: number }
        | undefined;
    const r1m = await mission(C2, "Absence contestée");
    const r1x = await reportAs(
      A,
      r1m,
      "absence",
      "Le candidat ne s'est pas présenté.",
    );
    await statementAs(C2, r1x, "J'étais présent, le vigile peut le confirmer.");
    const genericAbsence = await http(
      "POST",
      `/api/admin/incidents/${r1x}`,
      OPS1.cookie,
      {
        outcome: "not_established",
        note: "Décision générique sur une absence.",
      },
    );
    const repBefore = await repC2();
    const { data: r1Before } = await serviceClient
      .from("missions")
      .select("status")
      .eq("id", r1m.missionId)
      .single();
    const r1p = proposalOf(
      await propose(OPS1, r1x, "not_established", {
        facts_retained: "Ni la présence ni l'absence ne sont démontrées.",
        justification:
          "Les versions restent contradictoires sans élément vérifiable.",
      }),
    );
    const r1d = await review(OPS2, r1p);
    const { data: r1After } = await serviceClient
      .from("missions")
      .select("status")
      .eq("id", r1m.missionId)
      .single();
    const repAfter = await repC2();
    const { count: sanctions } = await serviceClient
      .from("reputation_incidents")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", cand2);
    report(
      "R1 réalisation non établie (absence contestée) : décision générique refusée (use_dispute_decision) ; double validation ; aucune absence fautive ni sanction, journée et mission inchangées, réputation inchangée",
      genericAbsence.body.code === "use_dispute_decision" &&
        resultOf(r1d).result === "decided" &&
        (await incident(r1x)).outcome === "not_established" &&
        sanctions === 0 &&
        (await dayRow(r1m.dayId)).actual_end_time === null &&
        r1After?.status === r1Before?.status &&
        repAfter?.confirmed_count === repBefore?.confirmed_count &&
        repAfter?.breach_count === 0,
      { repBefore, repAfter, sanctions },
    );
    const r2m = await mission(C3, "Travail partiel");
    await start(C3, r2m);
    const r2x = await reportAs(
      C3,
      r2m,
      "code_not_received",
      "Code non remis, j'ai fait la matinée.",
    );
    await statementAs(
      A,
      r2x,
      "Seule la matinée a été faite, il est parti à midi.",
    );
    const { data: contractBefore } = await serviceClient
      .from("contracts")
      .select("contract_data")
      .eq("application_id", r2m.applicationId)
      .single();
    const r2d = await review(
      OPS2,
      proposalOf(await propose(OPS1, r2x, "partial")),
    );
    const { data: contractAfter } = await serviceClient
      .from("contracts")
      .select("contract_data")
      .eq("application_id", r2m.applicationId)
      .single();
    const { data: r2Mission } = await serviceClient
      .from("missions")
      .select("actual_end_time")
      .eq("id", r2m.missionId)
      .single();
    report(
      "R2 réalisation partielle : dossier identifié (partial), journée non terminée, mission non réalisée, forfait inchangé (contrat identique)",
      resultOf(r2d).result === "decided" &&
        (await incident(r2x)).outcome === "partial" &&
        (await dayRow(r2m.dayId)).actual_end_time === null &&
        r2Mission?.actual_end_time === null &&
        JSON.stringify(contractAfter?.contract_data) ===
          JSON.stringify(contractBefore?.contract_data),
    );
    const r3m = await mission(C4, "Désaccord persistant");
    await start(C4, r3m);
    const r3x = await reportAs(
      C4,
      r3m,
      "code_not_received",
      "Code non remis, désaccord sur la qualité.",
    );
    await statementAs(
      A,
      r3x,
      "La qualité du service était insuffisante ce jour-là.",
    );
    const noFollow = await propose(OPS1, r3x, "disagreement");
    const r3d = await review(
      OPS2,
      proposalOf(
        await propose(OPS1, r3x, "disagreement", {
          amicable_attempt:
            "Appel conjoint proposé le 18/11, refusé par l'entreprise.",
          orientation: "Orientation vers l'inspection du travail de Douala.",
        }),
      ),
    );
    const r3party = await partyView(C4, r3m);
    const r3dec = (
      (r3party.list.find((i) => i.incident_id === r3x)?.decisions ??
        []) as Record<string, unknown>[]
    )[0];
    report(
      "R3 désaccord persistant : tentative amiable et orientation exigées (400), puis consignées et lues par la partie avec les faits retenus, contradictions et justification",
      noFollow.body.code === "disagreement_followup_required" &&
        resultOf(r3d).result === "decided" &&
        typeof r3dec?.amicable_attempt === "string" &&
        typeof r3dec?.orientation === "string" &&
        typeof r3dec?.facts_retained === "string" &&
        !("elements_verified" in (r3dec ?? {})),
      r3dec,
    );

    // ── A. Révision interne ──────────────────────────────────────
    console.log("\n── A. Révision interne (sept jours) ──");
    const atLimit = await reviewCase(
      idC2,
      r1x,
      "0",
      "Je demande une révision de cette décision.",
    );
    const justBefore = await reviewCase(
      idC2,
      r1x,
      "1 millisecond",
      "Je demande une révision de cette décision.",
    );
    const companyJoins = await reviewCase(
      idA,
      r1x,
      "1 hour",
      "Nous demandons aussi une révision.",
    );
    const again = await http(
      "POST",
      `/api/incidents/${r1x}/review`,
      C2.cookie,
      { statement: "Je demande une révision de cette décision." },
    );
    report(
      "A1 révision : refusée à l'échéance exacte (review_window_closed), acceptée 1 ms avant ; l'autre partie rejoint la même révision ; relance = même demande",
      atLimit.error === "review_window_closed" &&
        atLimit.appeals === 0 &&
        justBefore.error === null &&
        companyJoins.error === null &&
        companyJoins.appeals === 1 &&
        again.status === 200 &&
        (again.body.result as { already_requested?: boolean })
          ?.already_requested === true,
      {
        atLimit: atLimit.error,
        justBefore: justBefore.error,
        companyJoins: companyJoins.error,
      },
    );
    const appealId = String(
      (justBefore.result as { appeal_id?: string })?.appeal_id ?? "",
    );
    const takeProposer = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/take`,
      OPS1.cookie,
      { conflict: "none" },
    );
    const takeDecider = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/take`,
      OPS2.cookie,
      { conflict: "none" },
    );
    const takeSup = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/take`,
      SUP.cookie,
      { conflict: "none" },
    );
    const take = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/take`,
      OPS3.cookie,
      { conflict: "none" },
    );
    const appealBody = {
      facts_retained: "Le vigile confirme une présence partielle le matin.",
      elements_verified: SECRET_ELEMENTS,
      contradictions: "Les horaires déclarés par les parties divergent.",
      justification:
        "La révision retient un travail partiel au vu du témoignage.",
    };
    const decideByOther = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/decide`,
      OPS2.cookie,
      {
        result: "revised",
        new_outcome: "partial",
        ...appealBody,
      },
    );
    const revised = await http(
      "POST",
      `/api/admin/incident-appeals/${appealId}/decide`,
      OPS3.cookie,
      {
        result: "revised",
        new_outcome: "partial",
        ...appealBody,
      },
    );
    const r1Decs = await decisions(r1x);
    const r1Party = (await partyView(C2, r1m)).list.find(
      (i) => i.incident_id === r1x,
    );
    report(
      "A2 révision examinée par un agent distinct : auteur de la proposition et décideur refusés (reviewer_not_eligible), support 403 ; OPS3 affecté seul décide ; décisions successives conservées (initiale puis révision « partielle »), sans nouvelle révision",
      takeProposer.body.code === "reviewer_not_eligible" &&
        takeDecider.body.code === "reviewer_not_eligible" &&
        takeSup.status === 403 &&
        take.status === 200 &&
        decideByOther.body.code === "appeal_not_assigned" &&
        revised.status === 200 &&
        r1Decs.length === 2 &&
        r1Decs[0].outcome === "not_established" &&
        r1Decs[1].kind === "appeal" &&
        r1Decs[1].outcome === "partial" &&
        r1Decs[1].supersedes_id === r1Decs[0].id &&
        r1Decs[1].review_deadline === null &&
        (r1Party?.review as { open?: boolean })?.open === false &&
        (await notifs(idC2, "mission_incident_decision", r1x)) === 2,
      { decs: r1Decs.map((d) => [d.kind, d.outcome]), take: take.status },
    );
    // Décision « établie » contestée : la révision ne l'annule pas.
    const k2Appeal = await http(
      "POST",
      `/api/incidents/${k2.x}/review`,
      C3.cookie,
      { statement: "Je conteste les motifs retenus." },
    );
    const k2AppealId = String(
      (k2Appeal.body.result as { appeal_id?: string })?.appeal_id ?? "",
    );
    await http(
      "POST",
      `/api/admin/incident-appeals/${k2AppealId}/take`,
      OPS3.cookie,
      { conflict: "none" },
    );
    const undo = await http(
      "POST",
      `/api/admin/incident-appeals/${k2AppealId}/decide`,
      OPS3.cookie,
      {
        result: "revised",
        new_outcome: "not_established",
        ...appealBody,
      },
    );
    const arbitration = await http(
      "POST",
      `/api/admin/incident-appeals/${k2AppealId}/decide`,
      OPS3.cookie,
      {
        result: "arbitration_required",
        ...appealBody,
      },
    );
    report(
      "A3 révision d'une journée confirmée : annulation refusée (arbitration_required), arbitrage consigné ; journée toujours confirmée « exceptional »",
      undo.body.code === "arbitration_required" &&
        arbitration.status === 200 &&
        (await dayRow(k2.m.dayId)).completion_source === "exceptional" &&
        (await decisions(k2.x)).map((d) => d.appeal_result ?? d.kind).join() ===
          "initial,arbitration_required",
    );
    // Sans agent distinct disponible : en attente d'affectation.
    const x1Appeal = await http(
      "POST",
      `/api/incidents/${x1}/review`,
      C1.cookie,
      { statement: "Je souhaite une révision de cette journée." },
    );
    const x1AppealId = String(
      (x1Appeal.body.result as { appeal_id?: string })?.appeal_id ?? "",
    );
    const takeConcerned = await http(
      "POST",
      `/api/admin/incident-appeals/${x1AppealId}/take`,
      OPS3.cookie,
      { conflict: "none" },
    );
    const { data: others } = await serviceClient
      .from("users")
      .select("id")
      .in("role", ["admin_ops", "admin_founder"])
      .neq("is_active", false)
      .not("id", "in", `(${[idOps1, idOps2, idOps3].join(",")})`);
    const adminX1 = await http("GET", `/api/admin/incidents/${x1}`, SUP.cookie);
    const ap = ((
      adminX1.body.incident as {
        appeals?: { status: string; eligible_count: number }[];
      }
    )?.appeals ?? [])[0];
    report(
      "A4 agents ayant proposé, décidé ou déclarés concernés exclus : la révision reste en attente d'affectation, nombre d'agents distincts disponibles affiché",
      takeConcerned.body.code === "conflict_of_interest" &&
        ap?.status === "pending_assignment" &&
        ap.eligible_count === (others ?? []).length,
      { eligible: ap?.eligible_count, others: (others ?? []).length },
    );

    // ── X. Confidentialité et isolation ──────────────────────────
    console.log("\n── X. Confidentialité et isolation ──");
    const [vC1, vA, vC2other, tblSel] = await Promise.all([
      partyView(C1, m1),
      partyView(A, m1),
      http("GET", `/api/missions/${m1.missionId}/incidents`, C2.cookie),
      C1.client.from("mission_incident_decisions").select("id"),
    ]);
    const [notesSel, propSel, evSel, thirdRead] = await Promise.all([
      A.client.from("mission_incident_notes").select("id"),
      SUP.client.from("mission_incident_proposals").select("id"),
      C1.client.from("mission_incident_events").select("id"),
      http("GET", `/api/missions/${m3.missionId}/incidents`, B.cookie),
    ]);
    const x3Party = JSON.stringify((await partyView(A, m3)).body);
    const leaks = [vC1.text, vA.text, x3Party].some(
      (t) =>
        t.includes(SECRET_ELEMENTS) ||
        t.includes(SECRET_NOTE) ||
        t.includes(SECRET_REF),
    );
    report(
      "X1 parties : ni éléments vérifiés, ni notes internes, ni références privées ; autre candidat et entreprise tierce 404 ; tables du lot fermées en session",
      vC1.status === 200 &&
        vA.status === 200 &&
        !leaks &&
        vC2other.status === 404 &&
        thirdRead.status === 404 &&
        [tblSel, notesSel, propSel, evSel].every(
          (r) => !!r.error || (r.data ?? []).length === 0,
        ),
      { leaks, other: vC2other.status },
    );
  } finally {
    try {
      dropSlow();
      dropFailure();
      dropBarrier(execSql);
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
