/**
 * Preuve — interruption d'une journée commencée (décisions du 2026-11-19
 * et du 2026-11-20) : instruction par le support, décision et règlement
 * réservés au fondateur actif, délais contrôlés à l'heure de la base.
 *
 * Fixtures en clé service (entreprises A et B, candidats C1 à C6, admins
 * support, ops, fondateur, fondateur suspendu) ; tentatives en sessions
 * RÉELLES (routes avec cookies, RPC avec le JWT) ; état relu en clé
 * service. Journées placées en cours par `proof_lip_progress` ; instants
 * des délais déplacés par des fonctions `proof_lip_*` (jamais d'attente de
 * 72 h). Bornes validées de la migration (entier, 0 au plafond lu dans le
 * contrat figé), jamais remplacées par la preuve ; aucune proposition ni
 * acceptation n'est insérée directement en base.
 *
 *   P. Pouvoirs : support et ops instruisent sans décider ; double
 *      validation du lot 16 refusée ; parties sans pouvoir ; fondateur
 *      suspendu (ancien jeton) refusé ; proposition fermée sans bornes.
 *   R. Signalement : validations, double envoi, avis « mis à disposition ».
 *   D. Délais d'instruction : bornes exactes, version et réponse refusées
 *      après l'échéance, nouvel élément recevable, examen du fondateur.
 *   F. Fondateur : échéance de 72 h, dépassement visible et rappelé une
 *      fois, prolongation datée, aucune décision automatique.
 *   S. Proposition : versions, réponses, refus, silence, expiration,
 *      acceptations concurrentes, accord puis code après l'échéance,
 *      recours, finalisation manuelle et courses.
 *   C. Clôtures : désaccord non résolu, non établie, doublon sans
 *      réouverture.
 *   N. Avis et montants : consultation distincte de la notification,
 *      rappels idempotents, tâches après reconnexion, montants reconnus et
 *      contrat conservés, réputation et signaux.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays, type FixtureDay } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectRpc } from "./lib/sign-and-select";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-Interruption-01!";
const PROOF_USER_METADATA = { proofInterruption: true };

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "mission-interruptions" });
  if (r.status !== 0)
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  return r.stdout;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
const serviceRpc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

const FUNCTIONS: Record<string, string> = {
  // Journée commencée il y a 1 h, fin prévue à now() + décalage.
  "proof_lip_progress(uuid, interval)": `
create or replace function public.proof_lip_progress(p_day uuid, p_end_offset interval)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mission uuid;
begin
  select d.mission_id into v_mission from public.mission_days d where d.id = p_day;
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d
  set starts_at = now() - interval '2 hours', ends_at = now() + p_end_offset,
      actual_start_time = coalesce(d.actual_start_time, now() - interval '1 hour')
  where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  update public.missions m set actual_start_time = coalesce(m.actual_start_time, now() - interval '1 hour'),
    status = 'in_progress' where m.id = v_mission and m.status in ('pending', 'confirmed');
end $$`,
  // Journée réalisée par code (fixture de réalisation antérieure).
  "proof_lip_complete(uuid)": `
create or replace function public.proof_lip_complete(p_day uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d
  set starts_at = now() - interval '10 hours', ends_at = now() - interval '2 hours',
      actual_start_time = now() - interval '9 hours', actual_end_time = now() - interval '1 hour',
      completion_source = 'code'
  where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  update public.mission_completion_codes c set consumed_at = now() - interval '1 hour'
  where c.mission_day_id = p_day;
end $$`,
  // Confirmation par une autre voie (support, exceptionnelle) : seule la
  // protection des écritures de session est levée ; la garde des
  // confirmations contradictoires reste active.
  "proof_lip_force(uuid, text)": `
create or replace function public.proof_lip_force(p_day uuid, p_source text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  begin
    update public.mission_days d set actual_end_time = now(), completion_source = p_source
    where d.id = p_day;
  exception when others then
    alter table public.mission_days enable trigger trg_protect_mission_day_writes;
    return sqlerrm;
  end;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  return 'updated';
end $$`,
  // Ouverture du dossier déplacée (origine du délai de version).
  "proof_lip_opened(uuid, timestamptz)": `
create or replace function public.proof_lip_opened(p_incident uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_incidents disable trigger trg_protect_mission_incidents;
  update public.mission_incidents i set created_at = p_at where i.id = p_incident;
  alter table public.mission_incidents enable trigger trg_protect_mission_incidents;
end $$`,
  // Échéance d'une demande de complément déplacée.
  "proof_lip_request_due(uuid, timestamptz)": `
create or replace function public.proof_lip_request_due(p_request uuid, p_due timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.mission_incident_info_requests r set respond_by = p_due where r.id = p_request;
end $$`,
  // Proposition (et ses réponses) vieillie d'un intervalle : l'ordre
  // réponses / échéance est conservé.
  "proof_lip_age_proposal(uuid, interval)": `
create or replace function public.proof_lip_age_proposal(p_proposal uuid, p_by interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_interruption_proposals disable trigger trg_protect_mission_interruption_proposals;
  alter table public.mission_interruption_responses disable trigger trg_protect_mission_interruption_responses;
  update public.mission_interruption_proposals p
  set proposed_at = p.proposed_at - p_by, respond_by = p.respond_by - p_by where p.id = p_proposal;
  update public.mission_interruption_responses r
  set responded_at = r.responded_at - p_by where r.proposal_id = p_proposal;
  alter table public.mission_interruption_proposals enable trigger trg_protect_mission_interruption_proposals;
  alter table public.mission_interruption_responses enable trigger trg_protect_mission_interruption_responses;
end $$`,
  // Échéance d'une proposition fixée (réponses inchangées).
  "proof_lip_proposal_due(uuid, timestamptz)": `
create or replace function public.proof_lip_proposal_due(p_proposal uuid, p_due timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_interruption_proposals disable trigger trg_protect_mission_interruption_proposals;
  update public.mission_interruption_proposals p
  set proposed_at = p_due - interval '48 hours', respond_by = p_due where p.id = p_proposal;
  alter table public.mission_interruption_proposals enable trigger trg_protect_mission_interruption_proposals;
end $$`,
  "proof_lip_state(uuid, timestamptz)": `
create or replace function public.proof_lip_state(p_incident uuid, p_at timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select public.interruption_state(p_incident, p_at);
$$`,
  "proof_lip_open(timestamptz, timestamptz)": `
create or replace function public.proof_lip_open(p_due timestamptz, p_at timestamptz)
returns boolean language sql security definer set search_path = '' as $$
  select public.interruption_deadline_open(p_due, p_at);
$$`,
  "proof_lip_count(text)": `
create or replace function public.proof_lip_count(p_pattern text)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like p_pattern;
$$`,
  "proof_lip_rep(uuid)": `
create or replace function public.proof_lip_rep(p_profile uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(r) from public.compute_reputation('candidate', p_profile) r;
$$`,
  "proof_lip_messages(text, timestamptz)": `
create or replace function public.proof_lip_messages(p_topic text, p_since timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
  from realtime.messages m where m.topic = p_topic and m.inserted_at >= p_since;
$$`,
};
const DROP_ALL = Object.keys(FUNCTIONS).map(
  (f) => `drop function if exists public.${f}`,
);

function installFunctions() {
  for (const sql of DROP_ALL) execSql(sql);
  for (const [sig, sql] of Object.entries(FUNCTIONS)) {
    execSql(sql);
    execSql(
      `revoke all on function public.${sig} from public, anon, authenticated`,
    );
    execSql(`grant execute on function public.${sig} to service_role`);
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
    if (Date.now() > end || !/schema cache|function/i.test(error.message)) {
      throw new Error(`${fn}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

type Session = { client: DB; cookie: string; userId: string };
async function realSession(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
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
  if (error || !data.session)
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  const cookie = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  return { client, cookie, userId: data.user.id };
}

let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`,
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
    role,
    is_verified: role === "candidate",
    phone_verified: true,
    is_active: true,
    locale: "fr",
    phone:
      role === "candidate"
        ? `+2376995${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
        : null,
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
      niu: `M21${String(Date.now()).slice(-9)}${name.length}`,
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
      date_of_birth: "1994-02-11",
      city: "Douala",
      address: "Logbessou",
      latitude: 4.09,
      longitude: 9.78,
      bio: "Preuve des interruptions.",
      cni_number: `CNI21${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/f.jpg`,
      cni_back_url: `${userId}/b.jpg`,
      cni_selfie_url: `${userId}/s.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677212121",
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
  purgeProofJobs("mission-interruptions", { userIds: ids });
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
      await serviceClient
        .from("mission_incidents")
        .delete()
        .in("job_id", jobIds);
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
  for (const id of ids)
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
}
async function cleanStaleProofs() {
  for (const sql of DROP_ALL) execSql(sql);
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofInterruption === true)
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
  description: "Preuve des interruptions.",
  address: "Rue Joss",
  city: "Douala",
};
const SIGNAL_KEYS = new Set(["d", "r", "id"]);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MOTIF = "Versions et pièces examinées, arrêt vers midi constaté.";

type State = {
  stage: string;
  due_at: string | null;
  overdue: boolean;
  review_since?: string;
  proposal_status: string | null;
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `lip-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  try {
    installFunctions();
    const keys = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const candIds = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idFnd = await createAccount(mail("fnd"), "admin_founder");
    const idOff = await createAccount(mail("off"), "admin_founder");
    ids.push(idA, idB, ...candIds, idSup, idOps, idFnd, idOff);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, candIds[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Imprimerie Bonapriso");
    await createCompany(idB, "Concurrent Deido");
    const prof = Object.fromEntries(
      await Promise.all(
        keys.map(async (k) => [
          k,
          await createCandidate(uid[k], k.toUpperCase()),
        ]),
      ),
    ) as Record<K, string>;
    const sess = Object.fromEntries(
      await Promise.all(
        ["a", "b", ...keys, "sup", "ops", "fnd", "off"].map(async (k) => [
          k,
          await realSession(mail(k)),
        ]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;
    const B = sess.b;
    const SUP = sess.sup;
    const OPS = sess.ops;
    const FND = sess.fnd;
    const OFF = sess.off;

    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      return new Date(Date.UTC(2099, 6, 1) + dayNo * 86_400_000)
        .toISOString()
        .slice(0, 10);
    };
    type M = { missionId: string; dayId: string; jobId: string };
    /** Une offre « par journée » d'une journée, candidat sélectionné. */
    const perDay = async (k: K, pay: number, title: string): Promise<M> => {
      const days: FixtureDay[] = [
        {
          date: nextDate(),
          start_time: "08:00",
          end_time: "16:00",
          pay,
          positions: 1,
        },
      ];
      const { jobId, dayIds } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: coA,
          mission_pay_per_candidate: pay,
          positions_available: 1,
        },
        days,
        "per_day",
      );
      const { error } = await sess[k].client.rpc("apply_to_job_days", {
        p_job_id: jobId,
        p_day_ids: dayIds,
      });
      if (error) throw new Error(`apply ${title}: ${error.message}`);
      const { data: app } = await serviceClient
        .from("job_applications")
        .select("id")
        .eq("job_id", jobId)
        .eq("candidate_id", prof[k])
        .single();
      const sel = await signAndSelectRpc(A.client, app!.id);
      if (sel.error) throw new Error(`select ${title}: ${sel.error.message}`);
      const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
      const { data: md } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", missionId)
        .single();
      return { missionId, dayId: md!.id, jobId };
    };
    const progress = (m: M, offset: string) =>
      proofRpc("proof_lip_progress", { p_day: m.dayId, p_end_offset: offset });
    const codeOf = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_completion_codes")
          .select("code, consumed_at, failed_attempts, locked_until")
          .eq("mission_day_id", dayId)
          .single()
      ).data!;
    const dayRow = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_days")
          .select("actual_end_time, completion_source")
          .eq("id", dayId)
          .single()
      ).data!;
    const incidentsOf = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_incidents")
          .select("*")
          .eq("mission_day_id", dayId)
          .eq("kind", "interruption")
      ).data ?? [];
    const versionsOf = async (incidentId: string) =>
      (
        await serviceClient
          .from("mission_interruption_versions")
          .select("*")
          .eq("incident_id", incidentId)
      ).data ?? [];
    const proposalsOf = async (incidentId: string) =>
      (
        await serviceClient
          .from("mission_interruption_proposals")
          .select("*")
          .eq("incident_id", incidentId)
          .order("version")
      ).data ?? [];
    const responsesOf = async (proposalId: string) =>
      (
        await serviceClient
          .from("mission_interruption_responses")
          .select("*")
          .eq("proposal_id", proposalId)
      ).data ?? [];
    const closureOf = async (incidentId: string) =>
      (
        await serviceClient
          .from("mission_interruption_closures")
          .select("*")
          .eq("incident_id", incidentId)
      ).data ?? [];
    const noticesOf = async (incidentId: string, kind?: string) => {
      let q = serviceClient
        .from("mission_interruption_notices")
        .select("*")
        .eq("incident_id", incidentId);
      if (kind) q = q.eq("kind", kind);
      return (await q).data ?? [];
    };
    const stateOf = (incidentId: string, at?: string) =>
      proofRpc<State>("proof_lip_state", {
        p_incident: incidentId,
        p_at: at ?? new Date().toISOString(),
      });
    const reportBody = (
      m: M,
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      kind: "interruption",
      mission_day_id: m.dayId,
      cause: "company_stopped",
      declared_at: ago(20),
      work_done: "Mise sous pli de 400 enveloppes sur 900.",
      statement: "Le responsable a arrêté la tâche faute de stock.",
      ...extra,
    });
    const reportAs = (s: Session | null, m: M, extra = {}) =>
      http(
        "POST",
        `/api/missions/${m.missionId}/incidents`,
        s?.cookie ?? null,
        reportBody(m, extra),
      );
    const versionAs = (s: Session, m: M) =>
      reportAs(s, m, {
        cause: "candidate_left",
        work_done: "Environ 300 enveloppes, puis départ du candidat.",
        statement: "Le candidat est parti sans prévenir vers midi.",
      });
    const incidentOf = (r: HttpResult) =>
      (r.body.incident ?? {}) as {
        incident_id?: string;
        already_reported?: boolean;
      };
    const submit = (s: Session, missionId: string, code: string) =>
      s.client.rpc("submit_completion_code", {
        p_mission_id: missionId,
        p_code: code,
      });
    const resultOf = (r: {
      data: unknown;
      error: { message: string } | null;
    }) =>
      r.error
        ? r.error.message
        : ((r.data as { result: string }[])[0]?.result ?? "none");
    const founder = (s: Session | null, id: string, body: unknown) =>
      http(
        "POST",
        `/api/admin/incidents/${id}/interruption`,
        s?.cookie ?? null,
        body,
      );
    const proposeAs = (
      s: Session,
      id: string,
      amount: number,
      expected: number,
      motivation = MOTIF,
    ) =>
      founder(s, id, {
        action: "propose",
        amount,
        motivation,
        expected_version: expected,
      });
    const party = (s: Session | null, id: string, body: unknown) =>
      http("POST", `/api/interruptions/${id}`, s?.cookie ?? null, body);
    const respond = (
      s: Session | null,
      id: string,
      proposalId: string,
      version: number,
      decision: "accept" | "refuse",
    ) =>
      party(s, id, {
        action: "respond",
        proposal_id: proposalId,
        version,
        decision,
      });
    const askInfo = (
      s: Session,
      id: string,
      to: "candidate" | "company",
      question: string,
    ) =>
      http("POST", `/api/admin/incidents/${id}/info-requests`, s.cookie, {
        party: to,
        question,
      });
    const requestsOf = async (incidentId: string) =>
      (
        await serviceClient
          .from("mission_incident_info_requests")
          .select("*")
          .eq("incident_id", incidentId)
          .order("created_at")
      ).data ?? [];
    const acquired = async (s: Session, missionId: string) =>
      (
        await s.client.rpc("mission_acquired_amount", {
          p_mission_id: missionId,
        })
      ).data as {
        status: string;
        acquired_exact: number;
        settled_total: number;
        days: {
          awaiting_settlement: boolean;
          realized: boolean;
          realized_via: string | null;
          unresolved?: boolean;
          settled_amount: number | null;
        }[];
      } | null;
    const partyView = async (s: Session, m: M) => {
      const r = await http(
        "GET",
        `/api/missions/${m.missionId}/incidents`,
        s.cookie,
      );
      const inc = ((r.body.incidents ?? []) as Record<string, unknown>[]).find(
        (i) => i.kind === "interruption",
      );
      return (inc?.interruption ?? null) as Record<string, unknown> | null;
    };
    const adminView = async (s: Session, id: string) => {
      const r = await http("GET", `/api/admin/incidents/${id}`, s.cookie);
      return {
        status: r.status,
        detail: ((r.body.incident as Record<string, unknown> | undefined)
          ?.interruption ?? null) as Record<string, unknown> | null,
      };
    };
    const sweep = (at: string) =>
      proofRpc<number>("interruption_deadline_sweep", { p_at: at });
    const t0 = new Date(Date.now() - 1000).toISOString();
    const rep0 = await proofRpc<unknown>("proof_lip_rep", {
      p_profile: prof.c1,
    });

    // ── R. Signalement ───────────────────────────────────────────
    console.log("\n── R. Signalement ──");
    const m1 = await perDay("c1", 9000, "Mise sous pli (interruption)");
    {
      const notStarted = await reportAs(sess.c1, m1);
      await progress(m1, "4 hours");
      const [badCause, early, future, shortWork, anon, other, third] =
        await Promise.all([
          reportAs(sess.c1, m1, { cause: "weather" }),
          reportAs(sess.c1, m1, { declared_at: ago(180) }),
          reportAs(sess.c1, m1, { declared_at: inMs(HOUR) }),
          reportAs(sess.c1, m1, { work_done: "peu" }),
          reportAs(null, m1),
          reportAs(B, m1),
          reportAs(sess.c3, m1),
        ]);
      report(
        "R1 journée non commencée refusée ; cause, heure hors période, travail trop court refusés ; anonyme 401 ; autre entreprise et autre candidat refusés comme une mission inexistante ; aucun dossier",
        notStarted.body.code === "start_not_confirmed" &&
          badCause.body.code === "interruption_cause_invalid" &&
          early.body.code === "declared_time_invalid" &&
          future.body.code === "declared_time_invalid" &&
          shortWork.body.code === "work_done_invalid" &&
          anon.status === 401 &&
          other.status === 404 &&
          third.status === 404 &&
          (await incidentsOf(m1.dayId)).length === 0,
        [notStarted.body.code, badCause.body.code, anon.status, other.status],
      );
    }
    let x1 = "";
    {
      const [r1, r2] = await Promise.all([
        reportAs(sess.c1, m1),
        reportAs(sess.c1, m1),
      ]);
      const list = await incidentsOf(m1.dayId);
      x1 = list[0]?.id ?? "";
      const notices = await noticesOf(x1, "version_request");
      const req = (await requestsOf(x1)).length;
      const st = await stateOf(x1);
      report(
        "R2 double envoi : un dossier, une version ; version de l'entreprise demandée par un avis unique « mis à disposition » (notification liée, consultation non observée) ; étape « instruction » jusqu'à ouverture + 72 h",
        r1.status === 200 &&
          r2.status === 200 &&
          list.length === 1 &&
          (await versionsOf(x1)).length === 1 &&
          notices.length === 1 &&
          notices[0].recipient_id === idA &&
          !!notices[0].notification_id &&
          notices[0].viewed_at === null &&
          req === 0 &&
          st.stage === "instruction" &&
          Date.parse(st.due_at ?? "") ===
            Date.parse(list[0].created_at) + 72 * HOUR &&
          [incidentOf(r1).already_reported, incidentOf(r2).already_reported]
            .sort()
            .join() === "false,true",
        { notices: notices.length, st },
      );
    }

    // ── P. Pouvoirs ──────────────────────────────────────────────
    console.log("\n── P. Pouvoirs ──");
    {
      const close = {
        action: "close",
        outcome: "disagreement",
        motivation: MOTIF,
      };
      const [
        supClose,
        opsClose,
        opsPropose,
        opsExtend,
        companyRoute,
        candRoute,
        anon,
      ] = await Promise.all([
        founder(SUP, x1, close),
        founder(OPS, x1, close),
        proposeAs(OPS, x1, 4500, 0),
        founder(OPS, x1, {
          action: "extend",
          ends_at: inMs(100 * HOUR),
          reason: "Prolongation tentée par ops.",
        }),
        proposeAs(A, x1, 4500, 0),
        founder(sess.c1, x1, close),
        founder(null, x1, close),
      ]);
      const direct = await Promise.all(
        [OPS, SUP, A, sess.c1].map((s) =>
          s.client.rpc("admin_propose_interruption_amount", {
            p_incident_id: x1,
            p_amount: 4500,
            p_motivation: MOTIF,
            p_expected_version: 0,
          }),
        ),
      );
      const directClose = await OPS.client.rpc("admin_close_interruption", {
        p_incident_id: x1,
        p_outcome: "disagreement",
        p_motivation: MOTIF,
      });
      const lot16 = await http(
        "POST",
        `/api/admin/incidents/${x1}/proposals`,
        OPS.cookie,
        {
          outcome: "partial",
          facts_retained: "Arrêt vers midi selon les deux parties.",
          elements_verified: "Versions des parties et photo du stock.",
          contradictions: "La cause reste discutée entre les parties.",
          justification: "Travail partiel reconnu à ce stade du dossier.",
          conflict: "none",
        },
      );
      const generic = await http(
        "POST",
        `/api/admin/incidents/${x1}`,
        OPS.cookie,
        {
          outcome: "not_established",
          note: "Décision générique tentée.",
        },
      );
      const info = await askInfo(
        SUP,
        x1,
        "company",
        "Pouvez-vous joindre le bon de livraison du stock ?",
      );
      const opsView = await adminView(OPS, x1);
      report(
        "P1 support et ops instruisent sans décider : clôture, proposition et prolongation refusées (route 403, appels directs « forbidden »), double validation du lot 16 et décision générique refusées (use_founder_decision) ; demande de justificatif du support acceptée ; dossier lisible par ops",
        supClose.status === 403 &&
          opsClose.status === 403 &&
          opsPropose.status === 403 &&
          opsExtend.status === 403 &&
          direct.every((d) => d.error?.message === "forbidden") &&
          directClose.error?.message === "forbidden" &&
          lot16.body.code === "use_founder_decision" &&
          generic.body.code === "use_founder_decision" &&
          info.status === 200 &&
          opsView.status === 200 &&
          (opsView.detail?.founder as { can_close?: boolean })?.can_close ===
            false &&
          (await closureOf(x1)).length === 0 &&
          (await proposalsOf(x1)).length === 0,
        {
          sup: supClose.status,
          ops: [opsClose.status, opsPropose.status, opsExtend.status],
          direct: direct.map((d) => d.error?.message),
          lot16: lot16.body.code,
          generic: generic.body.code,
          info: info.status,
        },
      );
      report(
        "P2 parties sans pouvoir : entreprise et candidat refusés sur la route du fondateur (403), anonyme 401 ; tables fermées aux sessions ; anciennes fonctions et route de règlement absentes",
        companyRoute.status === 403 &&
          candRoute.status === 403 &&
          anon.status === 401 &&
          (
            await Promise.all([
              A.client.from("mission_interruption_proposals").select("id"),
              sess.c1.client.from("mission_interruption_notices").select("id"),
              A.client.from("mission_interruption_closures").select("id"),
            ])
          ).every((t) => !!t.error) &&
          (await proofRpc<number>("proof_lip_count", {
            p_pattern: "%partial_agreement%",
          })) === 0 &&
          (await proofRpc<number>("proof_lip_count", {
            p_pattern: "respond_partial_settlement",
          })) === 0 &&
          (await http("POST", `/api/partial-settlements/${x1}`, A.cookie, {}))
            .status === 404,
        {
          company: companyRoute.status,
          cand: candRoute.status,
          anon: anon.status,
        },
      );
    }
    {
      // Fondateur suspendu : son ancien jeton reste en main.
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", idOff);
      const [route, viewed] = await Promise.all([
        founder(OFF, x1, {
          action: "close",
          outcome: "not_established",
          motivation: MOTIF,
        }),
        founder(OFF, x1, { action: "viewed" }),
      ]);
      const directs = await Promise.all([
        OFF.client.rpc("admin_close_interruption", {
          p_incident_id: x1,
          p_outcome: "not_established",
          p_motivation: MOTIF,
        }),
        OFF.client.rpc("admin_extend_interruption_review", {
          p_incident_id: x1,
          p_ends_at: inMs(100 * HOUR),
          p_reason: "Ancien jeton d'un fondateur suspendu.",
        }),
        OFF.client.rpc("admin_finalize_interruption", {
          p_incident_id: x1,
          p_version: 1,
          p_motivation: MOTIF,
        }),
      ]);
      const view = await adminView(OFF, x1);
      report(
        "P3 fondateur suspendu avec son ancien jeton : route 403 (décision et consultation), clôture, prolongation et finalisation directes « forbidden », lecture du dossier refusée",
        route.status === 403 &&
          viewed.status === 403 &&
          directs.every((d) => d.error?.message === "forbidden") &&
          view.status === 403 &&
          (await closureOf(x1)).length === 0,
        {
          route: route.status,
          directs: directs.map((d) => d.error?.message),
          view: view.status,
        },
      );
    }

    // ── D. Délais d'instruction ──────────────────────────────────
    console.log("\n── D. Délais d'instruction (72 h) ──");
    {
      const t = new Date().toISOString();
      const tPlus = new Date(Date.parse(t) + 1).toISOString();
      const [atDue, after] = await Promise.all([
        proofRpc<boolean>("proof_lip_open", { p_due: t, p_at: t }),
        proofRpc<boolean>("proof_lip_open", { p_due: t, p_at: tPlus }),
      ]);
      const [req] = await requestsOf(x1);
      report(
        "D1 bornes exactes : une réponse est recevable à l'instant d'échéance inclus, refusée 1 ms après ; demande du support à l'entreprise : échéance = demande + 72 h, avis « justificatif demandé » mis à disposition",
        atDue === true &&
          after === false &&
          !!req &&
          Date.parse(req.respond_by!) ===
            Date.parse(req.created_at) + 72 * HOUR &&
          (await noticesOf(x1, "info_request")).filter(
            (n) => n.recipient_id === idA,
          ).length === 1,
        { atDue, after, req: req && [req.created_at, req.respond_by] },
      );
    }
    {
      // Version de l'entreprise : ouverture à now − 72 h + 5 s (dans le délai).
      await proofRpc("proof_lip_opened", {
        p_incident: x1,
        p_at: new Date(Date.now() - 72 * HOUR + 5000).toISOString(),
      });
      const v = await versionAs(A, m1);
      const [req] = await requestsOf(x1);
      const answer = await http(
        "POST",
        `/api/incident-info/${req.id}`,
        A.cookie,
        {
          statement: "Bon de livraison joint : stock vide à 11 h 40.",
        },
      );
      // Seconde demande, au candidat, dont l'échéance est passée.
      await askInfo(
        SUP,
        x1,
        "candidate",
        "Pouvez-vous préciser l'heure exacte du départ ?",
      );
      const req2 = (await requestsOf(x1)).find((r) => r.party === "candidate")!;
      await proofRpc("proof_lip_request_due", {
        p_request: req2.id,
        p_due: new Date(Date.now() - 1000).toISOString(),
      });
      const late = await http(
        "POST",
        `/api/incident-info/${req2.id}`,
        sess.c1.cookie,
        {
          statement: "Je suis parti à 12 h 05 sur demande.",
        },
      );
      const element = await http(
        "POST",
        `/api/incidents/${x1}/statements`,
        sess.c1.cookie,
        { statement: "Nouvel élément : message du responsable à 12 h." },
      );
      const st = await stateOf(x1);
      const req2After = (await requestsOf(x1)).find((r) => r.id === req2.id)!;
      report(
        "D2 version de l'entreprise dans le délai acceptée ; réponse de l'entreprise acceptée ; réponse du candidat après l'échéance refusée (response_deadline_passed) sans écriture, nouvel élément recevable ; toutes les demandes closes → examen du fondateur",
        v.status === 200 &&
          !incidentOf(v).already_reported &&
          answer.status === 200 &&
          late.status === 409 &&
          late.body.code === "response_deadline_passed" &&
          !req2After.answered_at &&
          element.status === 200 &&
          st.stage === "founder_review",
        {
          v: v.status,
          answer: answer.status,
          late: late.body.code,
          el: element.status,
          st,
        },
      );
    }
    let x2 = "";
    const m2 = await perDay("c2", 8000, "Rayonnage (désaccord)");
    {
      await progress(m2, "4 hours");
      x2 = incidentOf(await reportAs(sess.c2, m2)).incident_id ?? "";
      const during = await founder(FND, x2, {
        action: "close",
        outcome: "disagreement",
        motivation: MOTIF,
      });
      await proofRpc("proof_lip_opened", {
        p_incident: x2,
        p_at: new Date(Date.now() - 72 * HOUR - 1000).toISOString(),
      });
      const late = await versionAs(A, m2);
      const st = await stateOf(x2);
      const exp = await incidentsOf(m2.dayId);
      const code = (await codeOf(m2.dayId)).code;
      await progress(m2, "-1 minute");
      const sub = await submit(sess.c2, m2.missionId, code);
      report(
        "D3 clôture pendant l'instruction refusée (instruction_pending) ; version de l'entreprise 1 s après l'échéance refusée (response_deadline_passed), aucune version écrite ; examen du fondateur à partir de l'échéance (+72 h) ; le silence ne confirme rien (code refusé)",
        during.body.code === "instruction_pending" &&
          late.status === 409 &&
          late.body.code === "response_deadline_passed" &&
          (await versionsOf(x2)).length === 1 &&
          st.stage === "founder_review" &&
          Date.parse(st.review_since ?? "") ===
            Date.parse(exp[0].created_at) + 72 * HOUR &&
          Date.parse(st.due_at ?? "") ===
            Date.parse(exp[0].created_at) + 144 * HOUR &&
          sub.error?.message === "interruption_pending",
        {
          during: during.body.code,
          late: late.body.code,
          st,
          sub: sub.error?.message,
        },
      );
    }

    // ── F. Délai du fondateur ────────────────────────────────────
    console.log("\n── F. Délai du fondateur (72 h) ──");
    {
      await proofRpc("proof_lip_opened", {
        p_incident: x2,
        p_at: new Date(Date.now() - 145 * HOUR).toISOString(),
      });
      const st = await stateOf(x2);
      const list = await http("GET", "/api/admin/incidents", FND.cookie);
      const row = (
        (list.body.incidents ?? []) as Record<string, unknown>[]
      ).find((r) => r.incident_id === x2);
      const now = new Date().toISOString();
      const [s1, s2] = await Promise.all([sweep(now), sweep(now)]);
      await sweep(new Date().toISOString());
      const overdue = await noticesOf(x2, "founder_overdue");
      const lot16 = await proofRpc<number>("incident_deadline_sweep", {
        p_at: inMs(49 * HOUR),
      });
      const { count: lot16Events } = await serviceClient
        .from("mission_incident_events")
        .select("id", { count: "exact", head: true })
        .in("incident_id", [x1, x2])
        .in("event_type", ["reminder_24h", "escalation_48h"]);
      report(
        "F1 délai du fondateur dépassé : visible dans sa file (badge, en tête) ; rappel unique au fondateur actif malgré trois balayages dont deux simultanés, jamais au fondateur suspendu ; aucune clôture automatique ; relances 24 h / 48 h du lot 16 jamais appliquées aux interruptions",
        st.stage === "founder_review" &&
          st.overdue === true &&
          row?.interruption_overdue === true &&
          ((list.body.incidents ?? []) as Record<string, unknown>[])[0]
            ?.interruption_overdue === true &&
          overdue.length === 1 &&
          overdue[0].recipient_id === idFnd &&
          s1 + s2 >= 1 &&
          (await closureOf(x2)).length === 0 &&
          (lot16Events ?? 0) === 0 &&
          typeof lot16 === "number",
        {
          st,
          overdue: overdue.length,
          row: row?.interruption_overdue,
          lot16Events,
        },
      );
    }
    {
      const st0 = await stateOf(x2);
      const due0 = Date.parse(st0.due_at!);
      const reason = "Pièce attendue de l'entreprise.";
      const [tooEarly, tooLate] = await Promise.all([
        founder(FND, x2, {
          action: "extend",
          ends_at: new Date(due0 - 1000).toISOString(),
          reason,
        }),
        founder(FND, x2, {
          action: "extend",
          ends_at: new Date(due0 + 7 * 24 * HOUR + 1000).toISOString(),
          reason,
        }),
      ]);
      const ends = new Date(due0 + 7 * 24 * HOUR).toISOString();
      const ext = { action: "extend", ends_at: ends, reason };
      const [e1, e2] = [
        await founder(FND, x2, ext),
        await founder(FND, x2, ext),
      ];
      const second = await founder(FND, x2, {
        action: "extend",
        ends_at: new Date(due0 + 2 * 24 * HOUR).toISOString(),
        reason: "Seconde prolongation tentée.",
      });
      const st = await stateOf(x2);
      await sweep(new Date().toISOString());
      const { data: exts } = await serviceClient
        .from("mission_interruption_extensions")
        .select("*")
        .eq("incident_id", x2);
      report(
        "F2 prolongation : avant l'échéance ou 7 jours + 1 s refusée (extension_date_invalid) ; 7 jours exactement acceptés, rattachés à l'échéance prolongée, enregistrés une fois (double envoi) ; seconde prolongation refusée (extension_already_used) ; plus de dépassement ; avis aux deux parties ; aucun nouveau rappel",
        tooEarly.body.code === "extension_date_invalid" &&
          tooLate.body.code === "extension_date_invalid" &&
          e1.status === 200 &&
          e2.status === 200 &&
          second.body.code === "extension_already_used" &&
          (exts ?? []).length === 1 &&
          Date.parse(exts![0].extends_due) === due0 &&
          Date.parse(st.due_at ?? "") === Date.parse(ends) &&
          st.overdue === false &&
          (await noticesOf(x2, "review_extended")).length === 2 &&
          (await noticesOf(x2, "founder_overdue")).length === 1,
        {
          early: tooEarly.body.code,
          late: tooLate.body.code,
          second: second.body.code,
          st,
        },
      );
    }
    {
      // Bornes réelles (mission d'une journée : plafond = 9 000 du contrat).
      const [above, negative, fraction] = await Promise.all([
        proposeAs(FND, x1, 9001, 0),
        proposeAs(FND, x1, -1, 0),
        proposeAs(FND, x1, 4500.5, 0),
      ]);
      const directFraction = await FND.client.rpc(
        "admin_propose_interruption_amount",
        {
          p_incident_id: x1,
          p_amount: 4500.5,
          p_motivation: MOTIF,
          p_expected_version: 0,
        },
      );
      const view = await adminView(FND, x1);
      const fin = view.detail?.finance as { cap?: number } | undefined;
      report(
        "P4 bornes validées de la migration : au-dessus du plafond (9 001 > 9 000 du contrat) refusé (amount_above_cap), négatif et fractionnaire refusés (amount_invalid, route et appel direct) ; plafond affiché au fondateur ; rien n'est écrit",
        above.body.code === "amount_above_cap" &&
          negative.body.code === "amount_invalid" &&
          fraction.body.code === "amount_invalid" &&
          !!directFraction.error &&
          fin?.cap === 9000 &&
          (view.detail?.founder as { can_propose?: boolean })?.can_propose ===
            true &&
          (await proposalsOf(x1)).length === 0,
        {
          above: above.body.code,
          negative: negative.body.code,
          fraction: fraction.body.code,
          direct: directFraction.error?.message?.slice(0, 60),
          cap: fin?.cap,
        },
      );
    }

    // ── S. Proposition et consentement (règles de la migration) ──
    console.log("\n── S. Proposition (bornes validées de la migration) ──");
    let p1 = "";
    {
      const [o1, o2] = [
        await proposeAs(FND, x1, 4500, 0),
        await proposeAs(FND, x1, 4500, 0),
      ];
      const stale = await proposeAs(
        FND,
        x1,
        4200,
        0,
        "Autre motivation sur ancienne version.",
      );
      const tooHigh = await proposeAs(FND, x1, 9001, 1);
      const list = await proposalsOf(x1);
      p1 = list[0]?.id ?? "";
      const [vc, va] = await Promise.all([
        partyView(sess.c1, m1),
        partyView(A, m1),
      ]);
      const cur = (v: Record<string, unknown> | null) =>
        ((v?.proposals ?? []) as { amount: number; current: boolean }[]).find(
          (p) => p.current,
        );
      report(
        "S1 proposition motivée du fondateur : une version (double envoi), échéance = proposition + 48 h, avis aux deux parties ; version attendue périmée refusée (settlement_changed) ; montant au-dessus du plafond refusé (amount_above_cap) ; même montant vu par le candidat et l'entreprise",
        o1.status === 200 &&
          o2.status === 200 &&
          (o2.body.result as { already_recorded?: boolean })
            ?.already_recorded === true &&
          list.length === 1 &&
          Date.parse(list[0].respond_by) ===
            Date.parse(list[0].proposed_at) + 48 * HOUR &&
          stale.body.code === "settlement_changed" &&
          tooHigh.body.code === "amount_above_cap" &&
          (await noticesOf(x1, "proposal")).length === 2 &&
          cur(vc)?.amount === 4500 &&
          cur(va)?.amount === 4500,
        { o1: o1.status, stale: stale.body.code, tooHigh: tooHigh.body.code },
      );
    }
    let p2 = "";
    {
      const accept1 = await respond(sess.c1, x1, p1, 1, "accept");
      const before = (await proposalsOf(x1))[0];
      await sleep(5);
      const amend = await proposeAs(
        FND,
        x1,
        4000,
        1,
        "Correction : 400 enveloppes sur 900 reconnues.",
      );
      const list = await proposalsOf(x1);
      p2 = list[1]?.id ?? "";
      const old = await respond(sess.c1, x1, p1, 1, "accept");
      const wrongVersion = await respond(A, x1, p2, 1, "accept");
      const view = await partyView(sess.c1, m1);
      const props = (view?.proposals ?? []) as {
        version: number;
        status: string;
        motivation: string;
        responses: unknown[];
      }[];
      report(
        "S2 modification après une première acceptation : nouvelle version 2, la version 1 remplacée et conservée (motivation et acceptation du candidat dans l'historique), aucune acceptation reportée, nouveau délai de 48 h ; réponse sur l'ancienne version ou sur un mauvais numéro refusée (settlement_changed)",
        accept1.status === 200 &&
          amend.status === 200 &&
          list.length === 2 &&
          !!list[0].superseded_at &&
          (await responsesOf(p1)).length === 1 &&
          (await responsesOf(p2)).length === 0 &&
          Date.parse(list[1].respond_by) > Date.parse(before.respond_by) &&
          old.body.code === "settlement_changed" &&
          wrongVersion.body.code === "settlement_changed" &&
          props.length === 2 &&
          props[0].status === "superseded" &&
          props[0].responses.length === 1,
        {
          amend: amend.status,
          old: old.body.code,
          wrong: wrongVersion.body.code,
        },
      );
    }
    {
      // Une seule réponse : pas d'accord, code toujours refusé.
      const code = (await codeOf(m1.dayId)).code;
      const one = await respond(sess.c1, x1, p2, 2, "accept");
      const again = await respond(sess.c1, x1, p2, 2, "accept");
      const change = await respond(sess.c1, x1, p2, 2, "refuse");
      const [otherCo, otherCand, anon] = await Promise.all([
        respond(B, x1, p2, 2, "accept"),
        respond(sess.c5, x1, p2, 2, "accept"),
        respond(null, x1, p2, 2, "accept"),
      ]);
      const early = await submit(sess.c1, m1.missionId, code);
      const intact = await codeOf(m1.dayId);
      const st = await stateOf(x1);
      const tasksA = await http("GET", "/api/interruptions/tasks", A.cookie);
      const taskA = (
        (tasksA.body.tasks ?? []) as Record<string, unknown>[]
      ).find((t) => t.incident_id === x1);
      report(
        "S3 une seule acceptation : double clic idempotent, changement d'avis refusé (already_responded) ; autre entreprise et autre candidat refusés (404), anonyme 401 ; aucun accord, code refusé (settlement_not_accepted) sans essai consommé ; tâche persistante de l'entreprise « accepter ou refuser » avec l'échéance exacte",
        one.status === 200 &&
          again.status === 200 &&
          change.body.code === "already_responded" &&
          otherCo.status === 404 &&
          otherCand.status === 404 &&
          anon.status === 401 &&
          (await responsesOf(p2)).length === 1 &&
          early.error?.message === "settlement_not_accepted" &&
          intact.failed_attempts === 0 &&
          st.stage === "awaiting_parties" &&
          taskA?.action === "respond_proposal" &&
          Date.parse(String(taskA?.due_at)) ===
            Date.parse((await proposalsOf(x1))[1].respond_by),
        {
          change: change.body.code,
          early: early.error?.message,
          st: st.stage,
          taskA,
        },
      );
    }
    {
      const close = await founder(FND, x1, {
        action: "close",
        outcome: "disagreement",
        motivation: MOTIF,
      });
      const [ca, cb] = await Promise.all([
        respond(A, x1, p2, 2, "accept"),
        respond(A, x1, p2, 2, "accept"),
      ]);
      const st = await stateOf(x1);
      const amend = await proposeAs(FND, x1, 3000, 2);
      const closeAgree = await founder(FND, x1, {
        action: "close",
        outcome: "disagreement",
        motivation: MOTIF,
      });
      report(
        "S4 pendant la proposition, clôture refusée (proposal_open) ; acceptations simultanées de l'entreprise : une seule réponse, accord des deux parties sur la version 2, avis « accord » une fois par partie ; un accord valide ne peut plus être modifié ni clos (settlement_accepted)",
        close.body.code === "proposal_open" &&
          ca.status === 200 &&
          cb.status === 200 &&
          (await responsesOf(p2)).length === 2 &&
          st.stage === "agreement" &&
          (await noticesOf(x1, "agreement")).length === 2 &&
          amend.body.code === "settlement_accepted" &&
          closeAgree.body.code === "settlement_accepted",
        { close: close.body.code, st: st.stage, amend: amend.body.code },
      );
    }
    {
      // Accord accepté avant l'échéance, puis code saisi après elle, avant
      // la fin prévue de la journée.
      await proofRpc("proof_lip_age_proposal", {
        p_proposal: p2,
        p_by: "49 hours",
      });
      const st = await stateOf(x1);
      const code = (await codeOf(m1.dayId)).code;
      const [k1, k2] = await Promise.all([
        submit(sess.c1, m1.missionId, code),
        submit(sess.c1, m1.missionId, code),
      ]);
      const day = await dayRow(m1.dayId);
      const closure = await closureOf(x1);
      const amount = await acquired(sess.c1, m1.missionId);
      const late = await respond(A, x1, p2, 2, "refuse");
      report(
        "S5 accord accepté avant l'échéance de 48 h, code saisi après elle et avant la fin prévue : l'échéance n'annule pas l'accord ; une seule confirmation (double envoi), provenance « partial », clôture « réglée » au montant accepté 4 000 (jamais 9 000 prévus) ; réponse tardive refusée ; montant acquis 4 000",
        st.stage === "agreement" &&
          [resultOf(k1), resultOf(k2)].every((r) => r === "completed") &&
          day.completion_source === "partial" &&
          closure.length === 1 &&
          closure[0].outcome === "settled" &&
          closure[0].amount === 4000 &&
          late.status === 409 &&
          amount?.settled_total === 4000 &&
          amount.acquired_exact === 4000 &&
          amount.days[0]?.realized === false,
        {
          st: st.stage,
          k: [resultOf(k1), resultOf(k2)],
          day,
          closure,
          late: late.body.code,
        },
      );
    }

    // Refus, silence, expiration et courses.
    const m3 = await perDay("c3", 7000, "Plonge (refus)");
    let x3 = "";
    {
      await progress(m3, "4 hours");
      x3 =
        incidentOf(await reportAs(A, m3, { cause: "candidate_left" }))
          .incident_id ?? "";
      await versionAs(sess.c3, m3);
      await proposeAs(FND, x3, 3500, 0);
      const [p] = await proposalsOf(x3);
      const refuse = await respond(sess.c3, x3, p.id, 1, "refuse");
      const lateAccept = await respond(A, x3, p.id, 1, "accept");
      const st = await stateOf(x3);
      const code = (await codeOf(m3.dayId)).code;
      const sub = await submit(sess.c3, m3.missionId, code);
      const [resp] = (await responsesOf(p.id)).filter(
        (r) => r.decision === "refuse",
      );
      report(
        "S6 refus du candidat : proposition aussitôt non acceptée, l'autre acceptation ensuite refusée (proposal_refused) ; dossier renvoyé au fondateur (examen à partir du refus, avis au fondateur) ; code refusé",
        refuse.status === 200 &&
          lateAccept.body.code === "proposal_refused" &&
          st.stage === "founder_review" &&
          st.proposal_status === "refused" &&
          Date.parse(st.review_since ?? "") === Date.parse(resp.responded_at) &&
          (await noticesOf(x3, "proposal_refused")).some(
            (n) => n.recipient_id === idFnd,
          ) &&
          sub.error?.message === "settlement_not_accepted",
        { lateAccept: lateAccept.body.code, st, sub: sub.error?.message },
      );
    }
    {
      // Silence puis expiration : une seule acceptation avant l'échéance.
      await proposeAs(
        FND,
        x3,
        3000,
        1,
        "Nouvelle proposition après le refus du candidat.",
      );
      const p = (await proposalsOf(x3))[1];
      await proofRpc("proof_lip_proposal_due", {
        p_proposal: p.id,
        p_due: inMs(1500),
      });
      const beforeDue = await respond(A, x3, p.id, 2, "accept");
      await sleep(2000);
      const afterDue = await respond(sess.c3, x3, p.id, 2, "accept");
      const st = await stateOf(x3);
      const now = new Date().toISOString();
      const [w1, w2] = await Promise.all([sweep(now), sweep(now)]);
      const expired = await noticesOf(x3, "proposal_expired");
      const code = (await codeOf(m3.dayId)).code;
      const sub = await submit(sess.c3, m3.missionId, code);
      report(
        "S7 silence : acceptation de l'entreprise avant l'échéance, celle du candidat 0,5 s après refusée (proposal_expired) ; proposition expirée, jamais acceptée ; avis d'expiration uniques aux deux parties et au fondateur malgré deux balayages simultanés ; code refusé ; retour au fondateur",
        beforeDue.status === 200 &&
          afterDue.body.code === "proposal_expired" &&
          st.proposal_status === "expired" &&
          st.stage === "founder_review" &&
          expired.length === 3 &&
          w1 + w2 >= 3 &&
          sub.error?.message === "settlement_not_accepted" &&
          (await responsesOf(p.id)).length === 1,
        { after: afterDue.body.code, st, expired: expired.length, w: [w1, w2] },
      );
    }
    {
      // Course : modification du fondateur et acceptation sur la version
      // courante, simultanées.
      await proposeAs(FND, x3, 2800, 2, "Troisième version, encore discutée.");
      const p3 = (await proposalsOf(x3))[2];
      const [amend, acc] = await Promise.all([
        proposeAs(FND, x3, 2600, 3, "Quatrième version concurrente."),
        respond(sess.c3, x3, p3.id, 3, "accept"),
      ]);
      const list = await proposalsOf(x3);
      const p4 = list[3];
      const r4 = p4 ? await responsesOf(p4.id) : [];
      const st = await stateOf(x3);
      report(
        "S8 course modification / acceptation : la modification aboutit, l'acceptation est soit enregistrée sur la version 3 (aussitôt remplacée), soit refusée (settlement_changed) ; jamais reportée sur la version 4 ; pas d'accord",
        amend.status === 200 &&
          !!p4 &&
          r4.length === 0 &&
          (acc.status === 200 || acc.body.code === "settlement_changed") &&
          st.stage === "awaiting_parties",
        { amend: amend.status, acc: acc.body.code ?? acc.status, st: st.stage },
      );
    }

    // Recours et finalisation manuelle.
    const m4 = await perDay("c4", 9000, "Inventaire (recours)");
    let x4 = "";
    {
      await progress(m4, "4 hours");
      x4 = incidentOf(await reportAs(sess.c4, m4)).incident_id ?? "";
      const contract0 = (
        await serviceClient
          .from("contracts")
          .select("contract_data")
          .eq("job_id", m4.jobId)
          .single()
      ).data;
      const closeEarly = await founder(FND, x4, {
        action: "close",
        outcome: "not_established",
        motivation: MOTIF,
      });
      await versionAs(A, m4);
      await proposeAs(FND, x4, 5000, 0);
      const [p] = await proposalsOf(x4);
      await Promise.all([
        respond(sess.c4, x4, p.id, 1, "accept"),
        respond(A, x4, p.id, 1, "accept"),
      ]);
      const noRecourse = await founder(FND, x4, {
        action: "finalize",
        version: 1,
        motivation: MOTIF,
      });
      const opsFinal = await founder(OPS, x4, {
        action: "finalize",
        version: 1,
        motivation: MOTIF,
      });
      const [rc1, rc2] = [
        await party(sess.c4, x4, { action: "recourse" }),
        await party(sess.c4, x4, { action: "recourse" }),
      ];
      const wrong = await founder(FND, x4, {
        action: "finalize",
        version: 2,
        motivation: MOTIF,
      });
      const code = (await codeOf(m4.dayId)).code;
      const [fin, sub] = await Promise.all([
        founder(FND, x4, {
          action: "finalize",
          version: 1,
          motivation:
            "Appel aux deux parties : code non remis, accord confirmé.",
        }),
        submit(sess.c4, m4.missionId, code),
      ]);
      const day = await dayRow(m4.dayId);
      const closure = await closureOf(x4);
      const contract1 = (
        await serviceClient
          .from("contracts")
          .select("contract_data")
          .eq("job_id", m4.jobId)
          .single()
      ).data;
      const amount = await acquired(sess.c4, m4.missionId);
      report(
        "S9 recours immédiat après l'accord : finalisation sans recours refusée (recourse_required), par ops refusée (403), sur une autre version refusée ; recours enregistré une fois et signalé au fondateur ; finalisation et code simultanés : une seule confirmation (« partial_support » ou « partial »), une clôture au montant accepté 5 000 ; contrat signé intact ; jamais une réalisation complète",
        closeEarly.body.code === "instruction_pending" &&
          noRecourse.body.code === "recourse_required" &&
          opsFinal.status === 403 &&
          rc1.status === 200 &&
          (rc2.body.result as { already_recorded?: boolean })
            ?.already_recorded === true &&
          (await noticesOf(x4, "recourse")).filter(
            (n) => n.recipient_id === idFnd,
          ).length === 1 &&
          wrong.body.code === "settlement_changed" &&
          (fin.status === 200 || resultOf(sub) === "completed") &&
          ["partial", "partial_support"].includes(
            day.completion_source ?? "",
          ) &&
          closure.length === 1 &&
          closure[0].amount === 5000 &&
          closure[0].completion_source === day.completion_source &&
          JSON.stringify(contract0) === JSON.stringify(contract1) &&
          amount?.days[0]?.realized === false &&
          amount.acquired_exact === 5000,
        {
          noRecourse: noRecourse.body.code,
          ops: opsFinal.status,
          wrong: wrong.body.code,
          fin: fin.body.code ?? fin.status,
          sub: resultOf(sub),
          day,
          closure: closure.map((c) => [c.amount, c.completion_source]),
        },
      );
    }

    // ── C. Clôtures ──────────────────────────────────────────────
    console.log("\n── C. Clôtures ──");
    {
      const close = await founder(FND, x2, {
        action: "close",
        outcome: "disagreement",
        motivation:
          "Versions inconciliables sur la cause, aucune pièce décisive.",
      });
      const again = await founder(FND, x2, {
        action: "close",
        outcome: "disagreement",
        motivation:
          "Versions inconciliables sur la cause, aucune pièce décisive.",
      });
      const code = (await codeOf(m2.dayId)).code;
      const sub = await submit(sess.c2, m2.missionId, code);
      const forced = await proofRpc<string>("proof_lip_force", {
        p_day: m2.dayId,
        p_source: "support",
      });
      const amount = await acquired(sess.c2, m2.missionId);
      const view = await partyView(sess.c2, m2);
      const { count: sanctions } = await serviceClient
        .from("candidate_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", prof.c2);
      const { count: suspensions } = await serviceClient
        .from("account_suspensions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid.c2);
      report(
        "C1 « désaccord non résolu » par le fondateur seul (sans seconde validation), double envoi idempotent : journée non confirmée, code refusé (interruption_unresolved), confirmation support refusée ; aucun montant définitif (« en attente », désaccord signalé, jamais 0 réglé) ; aucune sanction ni suspension",
        close.status === 200 &&
          (again.body.result as { already_recorded?: boolean })
            ?.already_recorded === true &&
          sub.error?.message === "interruption_unresolved" &&
          /interruption_pending/.test(forced) &&
          !(await dayRow(m2.dayId)).actual_end_time &&
          amount?.status === "settlement_pending" &&
          amount.days[0]?.unresolved === true &&
          amount.days[0]?.settled_amount === null &&
          view?.amount_state === "unresolved" &&
          (sanctions ?? 0) === 0 &&
          (suspensions ?? 0) === 0,
        {
          close: close.status,
          sub: sub.error?.message,
          forced,
          amount: amount?.status,
        },
      );
    }
    {
      const m5 = await perDay("c5", 6000, "Emballage (non établi)");
      await progress(m5, "4 hours");
      const x5 =
        incidentOf(await reportAs(sess.c5, m5, { cause: "candidate_left" }))
          .incident_id ?? "";
      await versionAs(A, m5);
      const close = await founder(FND, x5, {
        action: "close",
        outcome: "not_established",
        motivation: MOTIF,
      });
      const dup = await reportAs(sess.c5, m5, { cause: "candidate_left" });
      const dupCompany = await versionAs(A, m5);
      const element = await http(
        "POST",
        `/api/incidents/${x5}/statements`,
        sess.c5.cookie,
        {
          statement: "Nouvel élément : photo du poste à 11 h.",
        },
      );
      const st = await stateOf(x5);
      const inc = (await incidentsOf(m5.dayId))[0];
      const code = (await codeOf(m5.dayId)).code;
      const early = await submit(sess.c5, m5.missionId, code);
      const afterEarly = await codeOf(m5.dayId);
      await progress(m5, "-1 minute");
      const late = await submit(sess.c5, m5.missionId, code);
      report(
        "C2 « non établie » : signalement identique et version en double sans réouverture (already_reported, un dossier, aucune version de plus) ; nouvel élément recevable et signalé au fondateur sans rouvrir le blocage ; parcours normal : code refusé avant la fin prévue sans essai consommé, accepté après (provenance « code »)",
        close.status === 200 &&
          incidentOf(dup).already_reported === true &&
          incidentOf(dupCompany).already_reported === true &&
          (await incidentsOf(m5.dayId)).length === 1 &&
          (await versionsOf(x5)).length === 2 &&
          element.status === 200 &&
          (await noticesOf(x5, "new_element")).some(
            (n) => n.recipient_id === idFnd,
          ) &&
          st.stage === "closed" &&
          inc.outcome === "not_established" &&
          early.error?.message === "completion_not_open" &&
          afterEarly.failed_attempts === 0 &&
          resultOf(late) === "completed" &&
          (await dayRow(m5.dayId)).completion_source === "code",
        {
          dup: incidentOf(dup),
          el: element.status,
          early: early.error?.message,
          late: resultOf(late),
        },
      );
    }

    {
      // Réexamen d'un désaccord non résolu (x2) puis d'un accord réglé (x1).
      const st0 = await stateOf(x2);
      const [r1, r1bis] = [
        await party(sess.c2, x2, {
          action: "reexamination",
          reason: "La photo du stock prouve l'arrêt demandé par l'entreprise.",
        }),
        await party(sess.c2, x2, {
          action: "reexamination",
          reason: "La photo du stock prouve l'arrêt demandé par l'entreprise.",
        }),
      ];
      const stAfter = await stateOf(x2);
      const blocked = await submit(
        sess.c2,
        m2.missionId,
        (await codeOf(m2.dayId)).code,
      );
      const { data: rx } = await serviceClient
        .from("mission_interruption_reexaminations")
        .select("*")
        .eq("incident_id", x2);
      const rid = rx![0].id;
      const opsDecide = await founder(OPS, x2, {
        action: "reexamination",
        reexamination_id: rid,
        decision: "maintained",
        motivation: "Décision tentée par un agent ops.",
      });
      const kept = await founder(FND, x2, {
        action: "reexamination",
        reexamination_id: rid,
        decision: "maintained",
        motivation: "La photo ne date pas l'arrêt : décision maintenue.",
      });
      const r2 = await party(A, x2, {
        action: "reexamination",
        reason: "Nous retrouvons un message qui précise l'heure de l'arrêt.",
      });
      const rid2 = (
        await serviceClient
          .from("mission_interruption_reexaminations")
          .select("id")
          .eq("incident_id", x2)
          .eq("party", "company")
          .single()
      ).data!.id;
      const reopen = await founder(FND, x2, {
        action: "reexamination",
        reexamination_id: rid2,
        decision: "reopened",
        motivation: "Élément nouveau sur l'heure : examen rouvert.",
      });
      const stReopen = await stateOf(x2);
      const history =
        (
          await serviceClient
            .from("mission_interruption_closure_history")
            .select("*")
            .eq("incident_id", x2)
        ).data ?? [];
      const reExtend = await founder(FND, x2, {
        action: "extend",
        ends_at: stReopen.due_at
          ? new Date(Date.parse(stReopen.due_at) + HOUR).toISOString()
          : inMs(HOUR),
        reason: "Prolongation après réouverture.",
      });
      // Accord réglé (x1) : aucune réouverture, traitement distinct.
      await party(sess.c1, x1, {
        action: "reexamination",
        reason: "Le montant réglé ne correspond pas aux 400 enveloppes.",
      });
      const rid3 = (
        await serviceClient
          .from("mission_interruption_reexaminations")
          .select("id")
          .eq("incident_id", x1)
          .single()
      ).data!.id;
      const reopenSettled = await founder(FND, x1, {
        action: "reexamination",
        reexamination_id: rid3,
        decision: "reopened",
        motivation: "Tentative de réouverture d'un accord réglé.",
      });
      const separate = await founder(FND, x1, {
        action: "reexamination",
        reexamination_id: rid3,
        decision: "separate_handling",
        motivation: "Correction d'un accord réglé : traitement distinct.",
      });
      const closure1 = await closureOf(x1);
      report(
        "C3 réexamen : demande motivée enregistrée une fois, sans changer l'étape, l'échéance ni le blocage ; ops refusé ; fondateur « maintenue » ; seconde demande « rouverte » : décision passée à l'historique, retour à l'examen du fondateur, prolongation non renouvelée ; accord réglé jamais rouvert (requires_separate_handling), « traitement distinct » sans modifier l'accord (4 000, « partial »)",
        r1.status === 200 &&
          (r1bis.body.result as { already_recorded?: boolean })
            ?.already_recorded === true &&
          JSON.stringify(st0) === JSON.stringify(stAfter) &&
          blocked.error?.message === "interruption_unresolved" &&
          (rx ?? []).length === 1 &&
          opsDecide.status === 403 &&
          kept.status === 200 &&
          r2.status === 200 &&
          reopen.status === 200 &&
          stReopen.stage === "founder_review" &&
          history.length === 1 &&
          history[0].outcome === "disagreement" &&
          (await closureOf(x2)).length === 0 &&
          reExtend.body.code === "extension_already_used" &&
          reopenSettled.body.code === "requires_separate_handling" &&
          separate.status === 200 &&
          closure1.length === 1 &&
          closure1[0].amount === 4000 &&
          (await dayRow(m1.dayId)).completion_source === "partial",
        {
          r1: r1.status,
          reopen: reopen.body.code ?? reopen.status,
          r2: r2.body.code ?? r2.status,
          kept: kept.body.code ?? kept.status,
          stReopen,
          stage: stReopen.stage,
          reExtend: reExtend.body.code,
          reopenSettled: reopenSettled.body.code,
        },
      );
    }

    {
      // Instruction après réouverture (x2 rouvert en C3), puis nouvelle
      // clôture : actions contrôlées par l'état courant du dossier.
      const contact = (sess_: Session | null) =>
        http(
          "POST",
          `/api/admin/incidents/${x2}/contacts`,
          sess_?.cookie ?? null,
          {
            entry_type: "request",
            channel: "phone",
            occurred_at: ago(5),
            result: "no_answer",
            note: "Appel au responsable après réouverture.",
          },
        );
      const incBefore = (await incidentsOf(m2.dayId))[0];
      const [c1, cA, cOff, cAnon] = await Promise.all([
        contact(SUP),
        contact(A),
        contact(OFF),
        contact(null),
      ]);
      const sit = await http(
        "POST",
        `/api/admin/incidents/${x2}/situation`,
        OPS.cookie,
        {
          situation: "partial_work",
        },
      );
      const note = await http(
        "POST",
        `/api/admin/incidents/${x2}/notes`,
        SUP.cookie,
        {
          body: "Note interne après réouverture.",
        },
      );
      const ask = await askInfo(
        SUP,
        x2,
        "company",
        "Pouvez-vous joindre le message reçu à midi ?",
      );
      const ask2 = await askInfo(
        SUP,
        x2,
        "candidate",
        "Pouvez-vous préciser l'heure de votre départ ?",
      );
      const reqs = (await requestsOf(x2)).filter((r) => !r.answered_at);
      const reqCompany = reqs.find((r) => r.party === "company")!;
      const reqCand = reqs.find((r) => r.party === "candidate")!;
      const answer = await http(
        "POST",
        `/api/incident-info/${reqCompany.id}`,
        A.cookie,
        {
          statement: "Message du responsable joint, reçu à 12 h 02.",
        },
      );
      const view = await adminView(SUP, x2);
      const incAfter = (await incidentsOf(m2.dayId))[0];
      // Nouvelle clôture motivée du fondateur.
      await proofRpc("proof_lip_request_due", {
        p_request: reqCand.id,
        p_due: new Date(Date.now() + 3 * HOUR).toISOString(),
      });
      const closeNow = await founder(FND, x2, {
        action: "close",
        outcome: "disagreement",
        motivation: "Après réouverture : versions toujours inconciliables.",
      });
      // L'instruction attend la réponse du candidat : on clôt l'échéance.
      await proofRpc("proof_lip_request_due", {
        p_request: reqCand.id,
        p_due: new Date(Date.now() - 1000).toISOString(),
      });
      const close2 = await founder(FND, x2, {
        action: "close",
        outcome: "disagreement",
        motivation: "Après réouverture : versions toujours inconciliables.",
      });
      await proofRpc("proof_lip_request_due", {
        p_request: reqCand.id,
        p_due: new Date(Date.now() + 3 * HOUR).toISOString(),
      });
      const [cClosed, sitClosed, askClosed, answerClosed, element] =
        await Promise.all([
          contact(SUP),
          http("POST", `/api/admin/incidents/${x2}/situation`, OPS.cookie, {
            situation: "presence_disputed",
          }),
          askInfo(
            SUP,
            x2,
            "company",
            "Question après la nouvelle clôture du dossier ?",
          ),
          http("POST", `/api/incident-info/${reqCand.id}`, sess.c2.cookie, {
            statement: "Réponse envoyée après la nouvelle clôture.",
          }),
          http("POST", `/api/incidents/${x2}/statements`, sess.c2.cookie, {
            statement: "Nouvel élément après la nouvelle clôture.",
          }),
        ]);
      const viewClosed = await adminView(SUP, x2);
      const history =
        (
          await serviceClient
            .from("mission_interruption_closure_history")
            .select("*")
            .eq("incident_id", x2)
        ).data ?? [];
      const { data: rx } = await serviceClient
        .from("mission_interruption_reexaminations")
        .select("decision")
        .eq("incident_id", x2);
      const closures = await closureOf(x2);
      const incFinal = (await incidentsOf(m2.dayId))[0];
      const contactsCount = (
        await serviceClient
          .from("mission_incident_contacts")
          .select("id", { count: "exact", head: true })
          .eq("incident_id", x2)
      ).count;
      report(
        "C4 dossier rouvert : contact, situation, note, demandes et réponse acceptés ; tiers, admin suspendu et anonyme refusés ; première décision figée (statut et motif du signalement inchangés) ; état courant lu partout (« instruction ouverte » dans la lecture du support) ; clôture refusée tant qu'une réponse est attendue, puis nouvelle clôture : historique, réexamens et décisions conservés ; après elle, contact, situation, demande et réponse refusés (incident_closed), nouvel élément libre recevable",
        c1.status === 200 &&
          cA.status === 403 &&
          cOff.status === 403 &&
          cAnon.status === 401 &&
          sit.status === 200 &&
          note.status === 200 &&
          ask.status === 200 &&
          ask2.status === 200 &&
          answer.status === 200 &&
          (view.detail?.instruction_open as boolean) === true &&
          incAfter.status === incBefore.status &&
          incAfter.outcome === incBefore.outcome &&
          incAfter.decision_note === incBefore.decision_note &&
          incAfter.decided_at === incBefore.decided_at &&
          closeNow.body.code === "instruction_pending" &&
          close2.status === 200 &&
          closures.length === 1 &&
          history.length === 1 &&
          (rx ?? []).length === 2 &&
          incFinal.outcome === incBefore.outcome &&
          incFinal.decided_at === incBefore.decided_at &&
          cClosed.body.code === "incident_closed" &&
          sitClosed.body.code === "incident_closed" &&
          askClosed.body.code === "incident_closed" &&
          answerClosed.body.code === "incident_closed" &&
          element.status === 200 &&
          (viewClosed.detail?.instruction_open as boolean) === false &&
          contactsCount === 1,
        {
          c: [c1.status, cA.status, cOff.status, cAnon.status],
          sit: sit.body.code ?? sit.status,
          ask: [ask.status, ask2.status],
          answer: answer.body.code ?? answer.status,
          closeNow: closeNow.body.code,
          close2: close2.body.code ?? close2.status,
          after: [
            cClosed.body.code,
            sitClosed.body.code,
            askClosed.body.code,
            answerClosed.body.code,
            element.status,
          ],
          history: history.length,
          contactsCount,
        },
      );
    }

    // ── N. Avis, rappels, tâches, montants ───────────────────────
    console.log("\n── N. Avis, rappels, tâches et montants ──");
    {
      const before = await noticesOf(x3);
      const mine = before.filter((n) => n.recipient_id === uid.c3);
      const others = before.filter((n) => n.recipient_id !== uid.c3);
      const { data: notifs0 } = await serviceClient
        .from("notifications")
        .select("id, is_read, read_at")
        .in("id", mine.map((n) => n.notification_id!).filter(Boolean));
      const viewed = await party(sess.c3, x3, { action: "viewed" });
      const third = await party(sess.c1, x3, { action: "viewed" });
      const after = await noticesOf(x3);
      const { data: notifs1 } = await serviceClient
        .from("notifications")
        .select("id, is_read, read_at")
        .in("id", mine.map((n) => n.notification_id!).filter(Boolean));
      report(
        "N1 consultation observée distincte de la notification : avis du candidat « mis à disposition » sans consultation, puis consultés à l'affichage du dossier ; avis de l'entreprise et du fondateur inchangés ; notifications jamais marquées lues ; tiers refusé",
        mine.length > 0 &&
          mine.every((n) => !!n.notification_id && n.viewed_at === null) &&
          viewed.status === 200 &&
          third.status === 404 &&
          after
            .filter((n) => n.recipient_id === uid.c3)
            .every((n) => n.viewed_at !== null) &&
          after
            .filter((n) => others.some((o) => o.id === n.id))
            .every((n) => n.viewed_at === null) &&
          (notifs0 ?? []).every(
            (n) => n.is_read === false && n.read_at === null,
          ) &&
          (notifs1 ?? []).every(
            (n) => n.is_read === false && n.read_at === null,
          ),
        { mine: mine.length, others: others.length, third: third.status },
      );
    }
    {
      const m6 = await perDay("c6", 7500, "Étiquetage (rappels)");
      await progress(m6, "4 hours");
      const x6 = incidentOf(await reportAs(sess.c6, m6)).incident_id ?? "";
      const opened = (await incidentsOf(m6.dayId))[0].created_at;
      const due = Date.parse(opened) + 72 * HOUR;
      const [early] = [await sweep(new Date(due - 25 * HOUR).toISOString())];
      const at = new Date(due - 23 * HOUR).toISOString();
      await Promise.all([sweep(at), sweep(at), sweep(at)]);
      const reminders = await noticesOf(x6, "version_reminder");
      const relogin = await realSession(mail("a"));
      const tasks = await http(
        "GET",
        "/api/interruptions/tasks",
        relogin.cookie,
      );
      const task = ((tasks.body.tasks ?? []) as Record<string, unknown>[]).find(
        (t) => t.incident_id === x6,
      );
      const exp = new Date(due + 1000).toISOString();
      await Promise.all([sweep(exp), sweep(exp)]);
      const expired = await noticesOf(x6, "version_expired");
      report(
        "N2 rappels idempotents : rien à 25 h de l'échéance, un rappel unique à 23 h (trois balayages simultanés), un avis d'expiration unique après l'échéance ; après reconnexion, tâche persistante « donner votre version » avec l'échéance exacte",
        (await noticesOf(x6, "version_reminder")).length === 1 &&
          reminders.length === 1 &&
          reminders[0].recipient_id === idA &&
          early >= 0 &&
          task?.action === "give_version" &&
          Date.parse(String(task?.due_at)) === due &&
          expired.length === 1,
        { reminders: reminders.length, task, expired: expired.length },
      );
    }
    {
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title: "Inventaire (période)",
          company_id: coA,
          mission_pay_per_candidate: 30000,
          positions_available: 1,
        },
        [
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
        ],
        "full_period",
      );
      const { data: app } = await sess.c6.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      const sel = await signAndSelectRpc(A.client, app!.id);
      const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
      const { data: days } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", missionId)
        .order("starts_at");
      const [d1, d2] = days!.map((d) => d.id);
      await proofRpc("proof_lip_complete", { p_day: d1 });
      await proofRpc("proof_lip_progress", {
        p_day: d2,
        p_end_offset: "4 hours",
      });
      const before = await acquired(sess.c6, missionId);
      const onDone = await reportAs(sess.c6, { missionId, dayId: d1, jobId });
      const onCurrent = await reportAs(A, { missionId, dayId: d2, jobId });
      const after = await acquired(sess.c6, missionId);
      const view = await partyView(sess.c6, { missionId, dayId: d2, jobId });
      report(
        "N3 forfait de 30 000 sur 3 journées, la 1re réalisée : signalement sur la journée réalisée refusé, journée intacte ; interruption de la 2e : 10 000 reconnus conservés, 2e journée « en examen » (jamais présentée comme 0), statut « en attente de règlement »",
        onDone.body.code === "day_already_confirmed" &&
          (await dayRow(d1)).completion_source === "code" &&
          onCurrent.status === 200 &&
          before?.acquired_exact === 10000 &&
          after?.acquired_exact === 10000 &&
          after.status === "settlement_pending" &&
          after.days[1]?.awaiting_settlement === true &&
          after.days[1]?.settled_amount === null &&
          after.days[0]?.realized === true &&
          view?.amount_state === "under_review",
        { onDone: onDone.body.code, before, after: after?.status },
      );
    }
    {
      // Forfait de 10 000 sur des journées de 8 h, 8 h et 5 h : plafonds
      // fractionnaires arrondis à l'entier inférieur, lus dans le contrat.
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title: "Inventaire (durées inégales)",
          company_id: coA,
          mission_pay_per_candidate: 10000,
          positions_available: 1,
        },
        [
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
          { date: nextDate(), start_time: "08:00", end_time: "13:00" },
        ],
        "full_period",
      );
      const { data: app } = await sess.c4.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      const sel = await signAndSelectRpc(A.client, app!.id);
      const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
      const { data: days } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", missionId)
        .order("starts_at");
      const [d1, d2, d3] = days!.map((d) => d.id);
      // Offre modifiée après la sélection : sans effet sur le plafond.
      const jobEdit = await serviceClient
        .from("jobs")
        .update({ mission_pay_per_candidate: 99000 })
        .eq("id", jobId);
      await proofRpc("proof_lip_complete", { p_day: d1 });
      await proofRpc("proof_lip_progress", {
        p_day: d2,
        p_end_offset: "4 hours",
      });
      const m = { missionId, dayId: d2, jobId };
      const x = incidentOf(await reportAs(sess.c4, m)).incident_id ?? "";
      await versionAs(A, m);
      const view = await adminView(FND, x);
      const cap = (view.detail?.finance as { cap?: number })?.cap;
      const over = await proposeAs(FND, x, 3810, 0);
      const atCap = await proposeAs(FND, x, 3809, 0);
      const [pp] = await proposalsOf(x);
      await Promise.all([
        respond(sess.c4, x, pp.id, 1, "accept"),
        respond(A, x, pp.id, 1, "accept"),
      ]);
      const code = (await codeOf(d2)).code;
      const sub = await sess.c4.client.rpc("submit_completion_code", {
        p_mission_id: missionId,
        p_code: code,
        p_mission_day_id: d2,
      });
      const amount = await acquired(sess.c4, missionId);
      const d3row = await dayRow(d3);
      report(
        "N5 forfait 10 000 sur 8 h, 8 h, 5 h : plafond de la 2e journée = floor(10 000 × 480 ÷ 1 260) = 3 809 lu dans le contrat (offre modifiée sans effet) ; 3 810 refusé, 3 809 accepté par les deux puis code ; 1re journée reconnue au prorata (3 809,52), 2e journée réglée 3 809, total 7 618,52 sans double comptage ; 3e journée indépendante, non confirmée",
        cap === 3809 &&
          over.body.code === "amount_above_cap" &&
          atCap.status === 200 &&
          resultOf(sub) === "completed" &&
          amount?.settled_total === 3809 &&
          Math.abs((amount?.acquired_exact ?? 0) - 7618.5238) < 0.001 &&
          amount?.days[0]?.realized === true &&
          amount?.days[1]?.realized === false &&
          amount?.days[1]?.settled_amount === 3809 &&
          !d3row.actual_end_time &&
          amount?.status === "in_progress",
        {
          cap,
          over: over.body.code,
          atCap: atCap.body.code ?? atCap.status,
          sub: resultOf(sub),
          jobEdit: jobEdit.error?.message ?? "ok",
          exact: amount?.acquired_exact,
          settled: amount?.settled_total,
        },
      );
    }
    {
      // Montant nul : mêmes garanties qu'un montant positif.
      const mz = await perDay("c5", 5000, "Tri (montant nul)");
      await progress(mz, "4 hours");
      const xz =
        incidentOf(await reportAs(A, mz, { cause: "candidate_left" }))
          .incident_id ?? "";
      await versionAs(sess.c5, mz);
      const noMotif = await proposeAs(FND, xz, 0, 0, "court");
      const z1 = await proposeAs(
        FND,
        xz,
        0,
        0,
        "Aucun travail exploitable selon les deux versions.",
      );
      const [pz1] = await proposalsOf(xz);
      await respond(A, xz, pz1.id, 1, "accept");
      await proofRpc("proof_lip_age_proposal", {
        p_proposal: pz1.id,
        p_by: "49 hours",
      });
      const silent = await stateOf(xz);
      const codeZ = (await codeOf(mz.dayId)).code;
      const subSilent = await submit(sess.c5, mz.missionId, codeZ);
      const close = await founder(FND, xz, {
        action: "close",
        outcome: "disagreement",
        motivation: "Aucune acceptation du candidat dans le délai.",
      });
      const closures = await closureOf(xz);
      const amount = await acquired(sess.c5, mz.missionId);
      report(
        "N6 montant nul : motif exigé (motivation_invalid) ; proposition de 0 acceptée par l'entreprise seule puis expirée : jamais acceptée, code refusé ; clôture administrative « désaccord » sans aucun montant 0 réglé (en examen non résolu)",
        noMotif.body.code === "motivation_invalid" &&
          z1.status === 200 &&
          silent.proposal_status === "expired" &&
          subSilent.error?.message === "settlement_not_accepted" &&
          close.status === 200 &&
          closures[0]?.outcome === "disagreement" &&
          closures[0]?.amount === null &&
          amount?.settled_total === 0 &&
          amount?.days[0]?.settled_amount === null &&
          amount?.days[0]?.unresolved === true,
        {
          z1: z1.status,
          silent: silent.proposal_status,
          sub: subSilent.error?.message,
        },
      );
      const mz2 = await perDay("c5", 5000, "Tri (montant nul accepté)");
      await progress(mz2, "4 hours");
      const xz2 =
        incidentOf(await reportAs(A, mz2, { cause: "candidate_left" }))
          .incident_id ?? "";
      await versionAs(sess.c5, mz2);
      await proposeAs(
        FND,
        xz2,
        0,
        0,
        "Aucun travail exploitable selon les deux versions.",
      );
      const [pz2] = await proposalsOf(xz2);
      const viewZ = await partyView(sess.c5, mz2);
      await Promise.all([
        respond(sess.c5, xz2, pz2.id, 1, "accept"),
        respond(A, xz2, pz2.id, 1, "accept"),
      ]);
      const sub = await submit(
        sess.c5,
        mz2.missionId,
        (await codeOf(mz2.dayId)).code,
      );
      const cl = await closureOf(xz2);
      const amount2 = await acquired(sess.c5, mz2.missionId);
      report(
        "N7 montant nul affiché clairement (proposition en attente : 0) puis accepté explicitement par les deux parties sur la même version : code immédiat avant la fin prévue, clôture « réglée » à 0 (provenance « partial ») ; montant acquis définitif 0",
        (viewZ?.finance as { pending_amount?: number })?.pending_amount === 0 &&
          resultOf(sub) === "completed" &&
          cl[0]?.outcome === "settled" &&
          cl[0]?.amount === 0 &&
          (await dayRow(mz2.dayId)).completion_source === "partial" &&
          amount2?.status === "final" &&
          amount2?.acquired_exact === 0,
        { sub: resultOf(sub), cl: cl.map((c) => [c.outcome, c.amount]) },
      );
    }
    {
      const rep1 = await proofRpc<unknown>("proof_lip_rep", {
        p_profile: prof.c1,
      });
      const { count: repIncidents } = await serviceClient
        .from("reputation_incidents")
        .select("id", { count: "exact", head: true })
        .eq("subject_id", prof.c1);
      const msgs = await proofRpc<Record<string, unknown>[]>(
        "proof_lip_messages",
        {
          p_topic: `user:${uid.c1}`,
          p_since: t0,
        },
      );
      const msgsA = await proofRpc<Record<string, unknown>[]>(
        "proof_lip_messages",
        {
          p_topic: `user:${idA}`,
          p_since: t0,
        },
      );
      const all = [...msgs, ...msgsA];
      report(
        "N4 journée réglée partiellement : aucune unité ni incident de réputation ; signaux privés aux deux parties, charge {d, r, id} seulement",
        JSON.stringify(rep0) === JSON.stringify(rep1) &&
          (repIncidents ?? 0) === 0 &&
          msgs.length > 0 &&
          msgsA.length > 0 &&
          all.every((m) => Object.keys(m).every((k) => SIGNAL_KEYS.has(k))),
        { n: [msgs.length, msgsA.length], sample: all[0] },
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
