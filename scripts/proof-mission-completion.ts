/**
 * Preuve lot 15 — fin de journée : code reçu à la fin prévue, « code non
 * remis » au support et confirmation manuelle d'une journée.
 *
 * Fixtures en clé service (entreprises A, B et Q, candidats C1 à C4, admins
 * ops, support et ops suspendu ; offres d'une journée et une période de deux
 * journées, sélections par « Signer et sélectionner ») ; tentatives en
 * sessions RÉELLES (routes avec cookies, RPC avec le JWT) ; état relu en clé
 * service. Horaires contrôlés sans attente :
 *   - `proof_l15_case` (fonction temporaire, clé service) place la fin
 *     prévue d'une journée à now() + décalage puis appelle la vraie RPC sous
 *     l'identité voulue, dans la même transaction (instant exact) ;
 *   - sinon, journées recalées en clé service avant tout début (horaires
 *     réels, calculés par la base en heure de Douala).
 *
 *   T. Échéance du code : juste avant (bon code refusé, code, essais,
 *      blocage et réalisation intacts), à l'instant exact (accepté), route
 *      et appel direct ; journée de 22 h à 6 h (ouverte à 6 h le
 *      lendemain) ; journée finie après minuit.
 *   R. « Code non remis » : avant la fin et sans début refusés (route et
 *      appel direct), à l'instant exact accepté, relance = même dossier ;
 *      retard inchangé.
 *   S. Support : contacts (demande distincte de la réponse obtenue),
 *      validations, refus par rôle (support, parties, anonyme, ops suspendu
 *      avec un ancien jeton), confirmation sans réponse « travail confirmé »
 *      refusée, décision générique refusée ; confirmation : provenance
 *      « support », code jamais marqué saisi, décision, audit, notifications,
 *      confidentialité ; relance ; code saisi ensuite.
 *   C. Concurrence code / support, dans les deux ordres imposés (barrière) ;
 *      support qui ouvre le dossier puis code reçu avant la décision.
 *   P. Panne pendant la confirmation : rien n'est écrit, puis reprise.
 *   E. Effets : période complète terminée à sa dernière journée, Tâches,
 *      évaluation admissible, réputation candidat (+1 par mission) et
 *      entreprise (+1 par offre, une fois), aucune sanction.
 *   X. Tables du lot fermées aux sessions.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { addDays, insertJobWithDays } from "./lib/job-days-fixture";
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
const PROOF_PASSWORD = "Proof-L15-completion-01!";
const PROOF_USER_METADATA = { proofMissionCompletion: true };
const HOUR = 3600_000;

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "mission-completion" });
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

// ─── Fonctions et déclencheurs temporaires (pile de preuve) ───────
const CASE_FN = `
create or replace function public.proof_l15_case(
  p_kind text, p_actor uuid, p_day uuid, p_end_offset interval, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission uuid;
  v_res jsonb;
  v_err text;
  v_detail text;
begin
  select d.mission_id into v_mission from public.mission_days d where d.id = p_day;
  -- Fin prévue placée à now() + décalage, journée commencée 7 h plus tôt.
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d
  set starts_at = now() - interval '8 hours',
      ends_at = now() + p_end_offset,
      actual_start_time = coalesce(d.actual_start_time, now() - interval '7 hours')
  where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  -- Début de la mission enregistré comme le fait start_mission.
  update public.missions m
  set actual_start_time = now() - interval '7 hours', status = 'in_progress'
  where m.id = v_mission and m.actual_start_time is null;
  if p_kind = 'shift' then
    return jsonb_build_object('ends_at', now() + p_end_offset);
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    if p_kind = 'code' then
      select to_jsonb(x) into v_res
      from public.submit_completion_code(v_mission, p_args ->> 'code', p_day) x;
    elsif p_kind = 'report' then
      select to_jsonb(x) into v_res
      from public.report_mission_incident(v_mission, p_day, 'code_not_received',
        'Code de fin non remis (preuve du lot 15).') x;
    elsif p_kind = 'confirm' then
      select to_jsonb(x) into v_res
      from public.admin_confirm_mission_day((p_args ->> 'incident')::uuid,
        (p_args ->> 'contact')::uuid, p_args ->> 'reason') x;
    end if;
  exception when others then
    v_err := sqlerrm;
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  return jsonb_build_object(
    'error', v_err,
    'detail', v_detail,
    'result', v_res,
    'ends_at', now() + p_end_offset,
    'code', (select jsonb_build_object('consumed_at', c.consumed_at,
               'failed_attempts', c.failed_attempts, 'locked_until', c.locked_until,
               'window', c.attempt_window_started_at)
             from public.mission_completion_codes c where c.mission_day_id = p_day),
    'day', (select jsonb_build_object('actual_end_time', d.actual_end_time,
              'completion_source', d.completion_source)
            from public.mission_days d where d.id = p_day),
    'incidents', (select count(*) from public.mission_incidents i
                  where i.mission_day_id = p_day and i.kind = 'code_not_received'));
end;
$$`;

// Clôture du recrutement d'une offre par le temps (verrous levés le temps
// du seul déplacement, comme proof_l12_close).
const CLOSE_FN = `
create or replace function public.proof_l15_close(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_close timestamptz := now() - interval '1 second';
begin
  alter table public.jobs disable trigger trg_job_publication_guard;
  alter table public.job_days disable trigger trg_protect_job_day_writes;
  update public.job_days d set applications_close_at = v_close
  where d.job_id = p_job and d.applications_close_at is not null;
  update public.jobs j set applications_close_at = v_close where j.id = p_job;
  alter table public.job_days enable trigger trg_protect_job_day_writes;
  alter table public.jobs enable trigger trg_job_publication_guard;
end;
$$`;

const DROP_ALL = [
  "drop trigger if exists proof_l15_slow on public.mission_days",
  "drop trigger if exists proof_l15_fail on public.audit_logs",
  "drop function if exists public.proof_l15_slow()",
  "drop function if exists public.proof_l15_fail()",
  "drop function if exists public.proof_l15_case(text, uuid, uuid, interval, jsonb)",
  "drop function if exists public.proof_l15_close(uuid)",
];

function installFunctions() {
  for (const sql of DROP_ALL) execSql(sql);
  execSql(CASE_FN);
  execSql(CLOSE_FN);
  for (const fn of [
    "proof_l15_case(text, uuid, uuid, interval, jsonb)",
    "proof_l15_close(uuid)",
  ]) {
    execSql(
      `revoke all on function public.${fn} from public, anon, authenticated`,
    );
    execSql(`grant execute on function public.${fn} to service_role`);
  }
  execSql("notify pgrst, 'reload schema'");
}

/** Ralentit la réalisation d'une journée (verrous tenus), pour l'ordre. */
function installSlow(dayId: string) {
  execSql(`create or replace function public.proof_l15_slow()
returns trigger language plpgsql set search_path = '' as $$
begin perform pg_sleep(2); return new; end $$`);
  execSql(`create trigger proof_l15_slow before update of actual_end_time
on public.mission_days for each row
when (new.id = '${dayId}'::uuid and old.actual_end_time is null
      and new.actual_end_time is not null)
execute function public.proof_l15_slow()`);
}
function dropSlow() {
  execSql("drop trigger if exists proof_l15_slow on public.mission_days");
}

/** Panne : la trace de la confirmation d'une journée précise échoue. */
function installFailure(dayId: string) {
  execSql(`create or replace function public.proof_l15_fail()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'proof_l15_failure'; end $$`);
  execSql(`create trigger proof_l15_fail before insert on public.audit_logs
for each row when (new.action = 'confirm_mission_day'
                   and new.resource_id::text = '${dayId}')
execute function public.proof_l15_fail()`);
}
function dropFailure() {
  execSql("drop trigger if exists proof_l15_fail on public.audit_logs");
}

type CaseResult = {
  error: string | null;
  detail: string | null;
  result: Record<string, unknown> | null;
  ends_at: string;
  code: {
    consumed_at: string | null;
    failed_attempts: number;
    locked_until: string | null;
    window: string | null;
  } | null;
  day: { actual_end_time: string | null; completion_source: string | null };
  incidents: number;
};

async function proofCase(
  kind: "shift" | "code" | "report" | "confirm",
  actor: string,
  dayId: string,
  endOffset: string,
  args: Record<string, string> = {},
): Promise<CaseResult> {
  const end = Date.now() + 15_000;
  for (;;) {
    const { data, error } = await serviceRpc.rpc("proof_l15_case", {
      p_kind: kind,
      p_actor: actor,
      p_day: dayId,
      p_end_offset: endOffset,
      p_args: args,
    });
    if (!error) return data as CaseResult;
    // Attente du rechargement du cache de schéma (installation seulement).
    if (Date.now() > end || !/schema cache|function/i.test(error.message)) {
      throw new Error(`proof_l15_case: ${error.message}`);
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
        ? `+2376995${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M15${String(Date.now()).slice(-9)}${name.length}`,
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
      bio: "Candidat de preuve du lot 15.",
      cni_number: "CNI15000151",
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677151515",
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
      .filter((u) => u.user_metadata?.proofMissionCompletion === true)
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
/** Date et heure locales de Douala d'un instant. */
const doualaParts = (ms: number) => {
  const iso = new Date(ms + HOUR).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};

const CONTENT = {
  description: "Preuve de la fin de journée (lot 15).",
  address: "Boulevard de la Liberté",
  city: "Douala",
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l15-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    await installBarrier(execSql, serviceRpc);

    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idQ = await createAccount(mail("q"), "company");
    const [idC1, idC2, idC3, idC4] = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("opsoff"), "admin_ops");
    ids.push(idA, idB, idQ, idC1, idC2, idC3, idC4, idOps, idSup, idOff);
    const coA = await createCompany(idA, "Brasserie Akwa");
    await createCompany(idB, "Hôtel Tiers");
    const coQ = await createCompany(idQ, "Traiteur Bonapriso");
    const [cand1, , , cand4] = await Promise.all([
      createCandidate(idC1, "Aline"),
      createCandidate(idC2, "Boris"),
      createCandidate(idC3, "Carine"),
      createCandidate(idC4, "Denis"),
    ]);

    const [A, B, Q, C1, C2, C3, C4, OPS, SUP, OFF] = await Promise.all(
      ["a", "b", "q", "c1", "c2", "c3", "c4", "ops", "sup", "opsoff"].map((k) =>
        realSession(mail(k)),
      ),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Offres d'une journée (dates distinctes, futures à la sélection).
    let seq = 0;
    const singleMission = async (
      cand: Session,
      company: { id: string; session: Session },
      title: string,
    ) => {
      seq += 1;
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: company.id,
          mission_pay_per_candidate: 7000,
          positions_available: 1,
        },
        [
          {
            date: `2099-11-${String(seq).padStart(2, "0")}`,
            start_time: "09:00",
            end_time: "17:00",
          },
        ],
      );
      const { data: app, error } = await cand.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !app) throw new Error(`apply: ${error?.message}`);
      const sel = await signAndSelectHttp(
        APP_URL,
        app.id,
        company.session.cookie,
      );
      const missionId = (sel.body.selection as { mission_id?: string })
        ?.mission_id;
      if (!missionId) throw new Error(`select: ${sel.text.slice(0, 200)}`);
      const { data: day } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", missionId)
        .single();
      return { jobId, missionId, dayId: day!.id, applicationId: app.id };
    };
    const compA = { id: coA, session: A };
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
          .select(
            "starts_at, ends_at, actual_start_time, actual_end_time, completion_source",
          )
          .eq("id", dayId)
          .single()
      ).data!;
    /** Journée réelle terminée (hier 00:00–23:00), avant tout début. */
    const endedDay = async (dayId: string, offset = -1) => {
      const { error } = await serviceClient
        .from("mission_days")
        .update({
          scheduled_date: doualaDay(offset),
          scheduled_start_time: "00:00",
          scheduled_end_time: "23:00",
        })
        .eq("id", dayId);
      if (error) throw new Error(`ended day: ${error.message}`);
    };
    const complete = (s: Session | null, missionId: string, body: unknown) =>
      http(
        "POST",
        `/api/missions/${missionId}/complete`,
        s?.cookie ?? null,
        body,
      );
    const start = (s: Session, missionId: string) =>
      http("POST", `/api/missions/${missionId}/start`, s.cookie);
    const reportCode = (s: Session | null, missionId: string, dayId: string) =>
      http("POST", `/api/missions/${missionId}/incidents`, s?.cookie ?? null, {
        mission_day_id: dayId,
        kind: "code_not_received",
        statement: "J'ai fini ma journée, pas de code remis.",
      });
    const contact = (s: Session | null, incidentId: string, body: unknown) =>
      http(
        "POST",
        `/api/admin/incidents/${incidentId}/contacts`,
        s?.cookie ?? null,
        body,
      );
    const confirm = (
      s: Session | null,
      incidentId: string,
      contactId: string,
      reason = "Gérant joint par téléphone : journée effectuée.",
    ) =>
      http(
        "POST",
        `/api/admin/incidents/${incidentId}/confirm-day`,
        s?.cookie ?? null,
        { contact_id: contactId, reason },
      );
    const notifs = async (userId: string, kind: string) =>
      (
        await serviceClient
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("data->>kind", kind)
      ).data?.length ?? -1;
    const nowIso = () => new Date(Date.now() - 60_000).toISOString();
    const confirmedAnswer = (reference: string) => ({
      entry_type: "response",
      channel: "phone",
      occurred_at: nowIso(),
      result: "work_confirmed",
      reference,
    });

    // ── T. Échéance du code ──────────────────────────────────────
    console.log("\n── T. Saisie du code à la fin prévue ──");
    const m1 = await singleMission(C1, compA, "Service du midi");
    const c1 = await codeOf(m1.dayId);
    const early = await proofCase("code", idC1, m1.dayId, "1 millisecond", {
      code: c1.code,
    });
    report(
      "T1 juste avant la fin prévue (+1 ms, heure de la base) : bon code refusé (completion_not_open, heure d'ouverture) ; code non consommé, aucun essai, aucun blocage, journée non confirmée",
      early.error === "completion_not_open" &&
        !!early.detail &&
        Math.abs(Date.parse(early.detail) - Date.parse(early.ends_at)) < 1000 &&
        early.code?.consumed_at === null &&
        early.code.failed_attempts === 0 &&
        early.code.locked_until === null &&
        early.code.window === null &&
        early.day.actual_end_time === null,
      early,
    );
    // Essais déjà comptés et blocage en cours : intacts aussi.
    const lockAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const windowAt = new Date(Date.now() - 60_000).toISOString();
    await serviceClient
      .from("mission_completion_codes")
      .update({
        failed_attempts: 3,
        attempt_window_started_at: windowAt,
        locked_until: lockAt,
      })
      .eq("mission_day_id", m1.dayId);
    const earlyLocked = await proofCase(
      "code",
      idC1,
      m1.dayId,
      "1 millisecond",
      { code: "000000" === c1.code ? "111111" : "000000" },
    );
    report(
      "T2 juste avant, mauvais code pendant un blocage : refus d'échéance, compteur (3), fenêtre et blocage inchangés",
      earlyLocked.error === "completion_not_open" &&
        earlyLocked.code?.failed_attempts === 3 &&
        Date.parse(earlyLocked.code.locked_until ?? "") ===
          Date.parse(lockAt) &&
        Date.parse(earlyLocked.code.window ?? "") === Date.parse(windowAt),
      earlyLocked.code,
    );
    await serviceClient
      .from("mission_completion_codes")
      .update({
        failed_attempts: 0,
        attempt_window_started_at: null,
        locked_until: null,
      })
      .eq("mission_day_id", m1.dayId);
    // Route et appel direct, fin prévue dans deux heures.
    const shifted = await proofCase("shift", idC1, m1.dayId, "2 hours");
    const [viaRoute, viaRpc] = await Promise.all([
      complete(C1, m1.missionId, { code: c1.code }),
      C1.client.rpc("submit_completion_code", {
        p_mission_id: m1.missionId,
        p_code: c1.code,
      }),
    ]);
    const afterEarly = await codeOf(m1.dayId);
    report(
      "T3 avant l'échéance, route (409 completion_not_open + available_at) et appel direct (refus) : rien n'est consommé ni compté",
      viaRoute.status === 409 &&
        viaRoute.body.code === "completion_not_open" &&
        Math.abs(
          Date.parse(String(viaRoute.body.available_at)) -
            Date.parse(shifted.ends_at),
        ) < 1000 &&
        viaRpc.error?.message === "completion_not_open" &&
        afterEarly.consumed_at === null &&
        afterEarly.failed_attempts === 0 &&
        (await dayRow(m1.dayId)).actual_end_time === null,
      { route: viaRoute.body, rpc: viaRpc.error?.message },
    );
    const exact = await proofCase("code", idC1, m1.dayId, "0", {
      code: c1.code,
    });
    report(
      "T4 à l'instant exact de la fin prévue : bon code accepté, journée confirmée par code (provenance « code »), code consommé",
      exact.error === null &&
        exact.result?.result === "completed" &&
        exact.result.already_completed === false &&
        exact.day.completion_source === "code" &&
        exact.code?.consumed_at !== null,
      exact,
    );

    // Journée de nuit 22 h → 6 h : horaire réel, début enregistré.
    const m2 = await singleMission(C2, compA, "Gardiennage de nuit");
    const today = doualaDay(0);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: today,
        scheduled_start_time: "22:00",
        scheduled_end_time: "06:00",
      })
      .eq("id", m2.dayId);
    await serviceClient
      .from("mission_days")
      .update({ actual_start_time: new Date().toISOString() })
      .eq("id", m2.dayId);
    const night = await dayRow(m2.dayId);
    const nightGet = await http(
      "GET",
      `/api/missions/${m2.missionId}`,
      C2.cookie,
    );
    const nightDays = ((nightGet.body.mission as { days?: unknown[] })?.days ??
      []) as { completion_available_at?: string }[];
    const nightTry = await complete(C2, m2.missionId, {
      code: (await codeOf(m2.dayId)).code,
    });
    const expectedEnd = Date.parse(`${addDays(today, 1)}T06:00:00+01:00`);
    report(
      "T5 journée de 22 h à 6 h : fin prévue à 6 h le lendemain (heure de Douala), lue par l'écran ; code refusé avant, ouverture annoncée à 6 h le lendemain",
      Date.parse(night.ends_at) === expectedEnd &&
        Date.parse(nightDays[0]?.completion_available_at ?? "") ===
          expectedEnd &&
        nightTry.status === 409 &&
        nightTry.body.code === "completion_not_open" &&
        Date.parse(String(nightTry.body.available_at)) === expectedEnd,
      {
        ends_at: night.ends_at,
        available: nightTry.body.available_at,
        screen: nightDays[0]?.completion_available_at,
      },
    );

    // Journée commencée la veille à 23:59, finie après minuit (déjà passée).
    const m3 = await singleMission(C3, compA, "Inventaire de nuit");
    const endLocal = doualaParts(Date.now() - 2 * 60_000);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: addDays(endLocal.date, -1),
        scheduled_start_time: "23:59",
        scheduled_end_time: endLocal.time,
      })
      .eq("id", m3.dayId);
    const s3 = await start(C3, m3.missionId);
    const midnight = await dayRow(m3.dayId);
    const afterMidnight = await complete(C3, m3.missionId, {
      code: (await codeOf(m3.dayId)).code,
    });
    report(
      "T6 journée commencée la veille (23:59) et finie après minuit : fin prévue le lendemain, déjà passée → code accepté",
      s3.status === 200 &&
        doualaParts(Date.parse(midnight.starts_at)).date ===
          addDays(endLocal.date, -1) &&
        doualaParts(Date.parse(midnight.ends_at)).date === endLocal.date &&
        Date.parse(midnight.ends_at) <= Date.now() &&
        afterMidnight.status === 200,
      { midnight, status: afterMidnight.status, body: afterMidnight.body },
    );

    // ── R. « Code non remis » ────────────────────────────────────
    console.log("\n── R. Code non remis : même échéance ──");
    const m4 = await singleMission(C4, compA, "Service du soir");
    const notStarted = await reportCode(C4, m4.missionId, m4.dayId);
    await proofCase("shift", idC4, m4.dayId, "3 hours");
    const [beforeEnd, beforeEndRpc, lateOk] = await Promise.all([
      reportCode(C4, m4.missionId, m4.dayId),
      C4.client.rpc("report_mission_incident", {
        p_mission_id: m4.missionId,
        p_mission_day_id: m4.dayId,
        p_kind: "code_not_received",
        p_statement: "Appel direct avant la fin prévue.",
      }),
      http("POST", `/api/missions/${m4.missionId}/incidents`, C4.cookie, {
        mission_day_id: m4.dayId,
        kind: "late",
        statement: "Arrivé 20 minutes en retard ce soir.",
        late_minutes: 20,
      }),
    ]);
    const { count: noCase } = await serviceClient
      .from("mission_incidents")
      .select("id", { count: "exact", head: true })
      .eq("mission_day_id", m4.dayId)
      .eq("kind", "code_not_received");
    report(
      "R1 code non remis : journée non commencée → start_not_confirmed ; avant la fin prévue → day_not_ended (route et appel direct) ; aucun dossier ; retard toujours signalable",
      notStarted.status === 409 &&
        notStarted.body.code === "start_not_confirmed" &&
        beforeEnd.status === 409 &&
        beforeEnd.body.code === "day_not_ended" &&
        typeof beforeEnd.body.available_at === "string" &&
        beforeEndRpc.error?.message === "day_not_ended" &&
        noCase === 0 &&
        lateOk.status === 200,
      [
        notStarted.body.code,
        beforeEnd.body,
        beforeEndRpc.error?.message,
        lateOk.status,
      ],
    );
    const justBefore = await proofCase(
      "report",
      idC4,
      m4.dayId,
      "1 millisecond",
    );
    const atEnd = await proofCase("report", idC4, m4.dayId, "0");
    const caseId = String(atEnd.result?.incident_id ?? "");
    const relaunch = await reportCode(C4, m4.missionId, m4.dayId);
    report(
      "R2 juste avant : refusé ; à l'instant exact : dossier ouvert ; relance depuis la tâche : même dossier (already_reported), une seule ligne",
      justBefore.error === "day_not_ended" &&
        justBefore.incidents === 0 &&
        atEnd.error === null &&
        atEnd.incidents === 1 &&
        relaunch.status === 200 &&
        (relaunch.body.incident as { incident_id?: string })?.incident_id ===
          caseId &&
        (relaunch.body.incident as { already_reported?: boolean })
          ?.already_reported === true,
      {
        justBefore: justBefore.error,
        atEnd: atEnd.result,
        relaunch: relaunch.body,
      },
    );

    // ── S. Support ───────────────────────────────────────────────
    console.log("\n── S. Instruction et confirmation par le support ──");
    const day4 = await dayRow(m4.dayId);
    const req1 = await contact(SUP, caseId, {
      entry_type: "request",
      channel: "phone",
      occurred_at: nowIso(),
      result: "no_answer",
      note: "Messagerie du gérant.",
    });
    // Date du contact absente : refusée avant la base.
    const req1Again = await contact(SUP, caseId, {
      entry_type: "request",
      channel: "phone",
      result: "no_answer",
    });
    const disputed = await contact(SUP, caseId, {
      entry_type: "response",
      channel: "whatsapp",
      occurred_at: nowIso(),
      result: "work_disputed",
      reference: "Message WhatsApp du gérant, 18 h 40",
    });
    const disputedId = String(
      (disputed.body.contact as { contact_id?: string })?.contact_id ?? "",
    );
    const [noRef, badDate, mixed, partyContact] = await Promise.all([
      contact(SUP, caseId, {
        entry_type: "response",
        channel: "phone",
        occurred_at: nowIso(),
        result: "work_confirmed",
      }),
      contact(SUP, caseId, {
        entry_type: "request",
        channel: "sms",
        occurred_at: new Date(
          Date.parse(day4.starts_at) - 3 * HOUR,
        ).toISOString(),
        result: "sent",
      }),
      contact(SUP, caseId, {
        entry_type: "request",
        channel: "sms",
        occurred_at: nowIso(),
        result: "work_confirmed",
        reference: "SMS",
      }),
      contact(C4, caseId, {
        entry_type: "response",
        channel: "phone",
        occurred_at: nowIso(),
        result: "work_confirmed",
        reference: "Je confirme moi-même",
      }),
    ]);
    const directNoRef = await SUP.client.rpc("admin_record_incident_contact", {
      p_incident_id: caseId,
      p_entry_type: "response",
      p_channel: "phone",
      p_occurred_at: nowIso(),
      p_result: "work_confirmed",
    });
    report(
      "S1 support (admin_support actif) consigne une demande sans réponse et une réponse « travail contesté » ; contact sans date refusé",
      req1.status === 200 &&
        disputed.status === 200 &&
        req1Again.status === 400 &&
        req1Again.body.code === "contact_date_invalid",
      [req1.status, disputed.status, req1Again.body.code],
    );
    report(
      "S2 validations (route et appel direct) : confirmation sans référence (reference_required), date avant la journée (contact_date_invalid), résultat de réponse sur une demande (contact_invalid) ; candidat refusé (403)",
      noRef.status === 400 &&
        noRef.body.code === "reference_required" &&
        directNoRef.error?.message === "reference_required" &&
        badDate.status === 400 &&
        badDate.body.code === "contact_date_invalid" &&
        mixed.status === 400 &&
        mixed.body.code === "contact_invalid" &&
        partyContact.status === 403,
      [
        noRef.body.code,
        directNoRef.error?.message,
        badDate.body.code,
        mixed.body.code,
        partyContact.status,
      ],
    );
    const sameReq = {
      entry_type: "request",
      channel: "sms",
      occurred_at: nowIso(),
      result: "sent",
    };
    const [dupA, dupB] = await Promise.all([
      contact(SUP, caseId, sameReq),
      contact(SUP, caseId, sameReq),
    ]);
    const { count: contactCount } = await serviceClient
      .from("mission_incident_contacts")
      .select("id", { count: "exact", head: true })
      .eq("incident_id", caseId);
    report(
      "S3 double envoi d'un même contact : une ligne (already_recorded)",
      dupA.status === 200 &&
        dupB.status === 200 &&
        (dupA.body.contact as { contact_id?: string })?.contact_id ===
          (dupB.body.contact as { contact_id?: string })?.contact_id &&
        contactCount === 3,
      { contactCount },
    );

    // Refus : sans réponse « travail confirmé », grades, ancien jeton.
    const withoutConfirmation = await confirm(OPS, caseId, disputedId);
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);
    const [
      bySup,
      byCand,
      byCompany,
      byAnon,
      byOffConfirm,
      byOffContact,
      byOffRead,
    ] = await Promise.all([
      confirm(SUP, caseId, disputedId),
      confirm(C4, caseId, disputedId),
      confirm(A, caseId, disputedId),
      confirm(null, caseId, disputedId),
      confirm(OFF, caseId, disputedId),
      contact(OFF, caseId, sameReq),
      http("GET", `/api/admin/incidents/${caseId}`, OFF.cookie),
    ]);
    const offDirect = await OFF.client.rpc("admin_confirm_mission_day", {
      p_incident_id: caseId,
      p_contact_id: disputedId,
      p_reason: "Ancien jeton d'un ops suspendu.",
    });
    const generic = await http(
      "POST",
      `/api/admin/incidents/${caseId}`,
      OPS.cookie,
      {
        outcome: "established",
        note: "Décision générique sur un code non remis.",
      },
    );
    const stillOpen = await dayRow(m4.dayId);
    const { data: caseRow } = await serviceClient
      .from("mission_incidents")
      .select("status, outcome")
      .eq("id", caseId)
      .single();
    report(
      "S4 travail contesté seulement : confirmation refusée (company_confirmation_required) ; décision générique refusée (use_day_confirmation) ; le dossier reste en instruction, journée non confirmée",
      withoutConfirmation.status === 409 &&
        withoutConfirmation.body.code === "company_confirmation_required" &&
        generic.status === 409 &&
        generic.body.code === "use_day_confirmation" &&
        caseRow?.status === "open" &&
        caseRow.outcome === null &&
        stillOpen.actual_end_time === null,
      [withoutConfirmation.body.code, generic.body.code, caseRow],
    );
    report(
      "S5 confirmation refusée : support (403), candidat et entreprise (403), anonyme (401) ; ops suspendu avec un jeton émis avant la suspension refusé (route, appel direct, contact, lecture)",
      bySup.status === 403 &&
        byCand.status === 403 &&
        byCompany.status === 403 &&
        byAnon.status === 401 &&
        byOffConfirm.status === 403 &&
        offDirect.error?.message === "forbidden" &&
        byOffContact.status === 403 &&
        byOffRead.status === 403,
      [
        bySup.status,
        byCand.status,
        byCompany.status,
        byAnon.status,
        byOffConfirm.status,
        offDirect.error?.message,
        byOffContact.status,
        byOffRead.status,
      ],
    );

    const confirmedContact = await contact(
      SUP,
      caseId,
      confirmedAnswer("Appel sortant au gérant M. Ekané, 19 h 05"),
    );
    const confirmedId = String(
      (confirmedContact.body.contact as { contact_id?: string })?.contact_id ??
        "",
    );
    const codeBefore = await codeOf(m4.dayId);
    const done = await confirm(OPS, caseId, confirmedId);
    const again = await confirm(OPS, caseId, confirmedId);
    const day4After = await dayRow(m4.dayId);
    const codeAfter = await codeOf(m4.dayId);
    const { data: m4Row } = await serviceClient
      .from("missions")
      .select("status, actual_end_time, payment_status")
      .eq("id", m4.missionId)
      .single();
    const { data: confRows } = await serviceClient
      .from("mission_day_confirmations")
      .select(
        "mission_day_id, candidate_id, incident_id, contact_id, reason, basis",
      )
      .eq("incident_id", caseId);
    const { data: caseAfter } = await serviceClient
      .from("mission_incidents")
      .select("status, outcome, decided_by")
      .eq("id", caseId)
      .single();
    const { data: audit } = await serviceClient
      .from("audit_logs")
      .select("actor_id, action, metadata")
      .eq("action", "confirm_mission_day")
      .eq("resource_id", m4.dayId);
    const { count: departures } = await serviceClient
      .from("mission_check_ins")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", m4.missionId)
      .eq("check_in_type", "departure");
    report(
      "S6 ops actif sur la réponse « travail confirmé » : journée confirmée par le support (provenance « support »), code jamais marqué saisi (non consommé, compteurs inchangés, aucun départ), mission réalisée",
      done.status === 200 &&
        (done.body.confirmation as { result?: string })?.result ===
          "confirmed" &&
        (done.body.confirmation as { completed_via?: string })
          ?.completed_via === "support" &&
        day4After.completion_source === "support" &&
        day4After.actual_end_time !== null &&
        codeAfter.consumed_at === null &&
        codeAfter.failed_attempts === codeBefore.failed_attempts &&
        departures === 0 &&
        m4Row?.status === "completed" &&
        m4Row.actual_end_time !== null,
      { done: done.body, day4After, codeAfter, departures, m4Row },
    );
    report(
      "S7 décision rattachée au candidat, à la journée et au dossier, avec la référence de l'entreprise et le motif ; dossier tranché (établi, ops) ; une trace d'audit",
      confRows?.length === 1 &&
        confRows[0].mission_day_id === m4.dayId &&
        confRows[0].candidate_id === cand4 &&
        confRows[0].contact_id === confirmedId &&
        confRows[0].basis === "company_confirmed" &&
        caseAfter?.status === "decided" &&
        caseAfter.outcome === "established" &&
        caseAfter.decided_by === idOps &&
        audit?.length === 1 &&
        audit[0].actor_id === idOps,
      { confRows, caseAfter, audit: audit?.length },
    );
    const [notifC4, notifA] = [
      await notifs(idC4, "mission_day_confirmed"),
      await notifs(idA, "mission_day_confirmed"),
    ];
    const codeLater = await complete(C4, m4.missionId, {
      code: codeBefore.code,
    });
    report(
      "S8 relance de la confirmation : résultat acquis (already_confirmed) sans écriture ; candidat et entreprise notifiés une fois ; code saisi ensuite → réalisation d'origine, code toujours non consommé",
      (again.body.confirmation as { already_confirmed?: boolean })
        ?.already_confirmed === true &&
        notifC4 === 1 &&
        notifA === 1 &&
        codeLater.status === 200 &&
        (codeLater.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        (await codeOf(m4.dayId)).consumed_at === null &&
        (await serviceClient
          .from("mission_day_confirmations")
          .select("id", { count: "exact", head: true })
          .eq("incident_id", caseId)
          .then((r) => r.count)) === 1,
      { notifC4, notifA, code: codeLater.body },
    );
    const [partyC, partyA, adminView, companyRows, tasksC4] = await Promise.all(
      [
        http("GET", `/api/missions/${m4.missionId}/incidents`, C4.cookie),
        http("GET", `/api/missions/${m4.missionId}/incidents`, A.cookie),
        http("GET", `/api/admin/incidents/${caseId}`, SUP.cookie),
        http("GET", `/api/jobs/${m4.jobId}/missions`, A.cookie),
        http("GET", "/api/tasks", C4.cookie),
      ],
    );
    const partyCase = (r: HttpResult) =>
      ((r.body.incidents ?? []) as Record<string, unknown>[]).find(
        (i) => i.incident_id === caseId,
      );
    const secret = "M. Ekané";
    const companyRow = (
      (companyRows.body.missions ?? []) as Record<string, unknown>[]
    )[0];
    const taskM4 = (
      (tasksC4.body.missions ?? []) as {
        mission_id: string;
        completed_at: string | null;
        candidate_reviewed: boolean;
        days: { completed_via?: string }[];
      }[]
    ).find((m) => m.mission_id === m4.missionId);
    const admin = adminView.body.incident as {
      contacts?: unknown[];
      confirmation?: { reason?: string } | null;
      day?: { completed_via?: string };
    };
    report(
      "S9 parties : « journée confirmée par le support », sans motif ni référence ; support : contacts et motif ; entreprise : provenance « support », code retiré ; Tâches : évaluation à faire, journée confirmée par le support",
      partyCase(partyC)?.resolution === "support_confirmed_day" &&
        partyCase(partyC)?.decision_note === null &&
        partyCase(partyA)?.resolution === "support_confirmed_day" &&
        !partyC.text.includes(secret) &&
        !partyA.text.includes(secret) &&
        !partyA.text.includes("Gérant joint") &&
        adminView.status === 200 &&
        (admin.contacts ?? []).length === 4 &&
        !!admin.confirmation?.reason &&
        admin.day?.completed_via === "support" &&
        companyRow?.completed_via === "support" &&
        companyRow.completion_code === null &&
        companyRow.code_used === false &&
        !!taskM4?.completed_at &&
        taskM4.candidate_reviewed === false &&
        taskM4.days[0]?.completed_via === "support",
      {
        party: partyCase(partyC),
        company: companyRow,
        task: taskM4 && {
          completed_at: taskM4.completed_at,
          days: taskM4.days,
        },
      },
    );

    // ── C. Concurrence code / support ────────────────────────────
    console.log("\n── C. Concurrence code et support ──");
    /** Journée terminée, commencée, dossier ouvert, réponse consignée. */
    const readyCase = async (cand: Session, candId: string, title: string) => {
      const m = await singleMission(cand, compA, title);
      await endedDay(m.dayId);
      const st = await start(cand, m.missionId);
      const rep = await reportCode(cand, m.missionId, m.dayId);
      const incident = String(
        (rep.body.incident as { incident_id?: string })?.incident_id ?? "",
      );
      const ans = await contact(
        SUP,
        incident,
        confirmedAnswer(`Appel du gérant pour ${title}`),
      );
      if (st.status !== 200 || rep.status !== 200 || ans.status !== 200) {
        throw new Error(
          `readyCase ${title}: ${st.status}/${rep.status}/${ans.status} (${candId})`,
        );
      }
      return {
        ...m,
        incident,
        contactId: String(
          (ans.body.contact as { contact_id?: string })?.contact_id ?? "",
        ),
        code: (await codeOf(m.dayId)).code,
      };
    };
    const realizations = async (dayId: string, missionId: string) => {
      const [day, code, conf, dep] = await Promise.all([
        dayRow(dayId),
        codeOf(dayId),
        serviceClient
          .from("mission_day_confirmations")
          .select("id", { count: "exact", head: true })
          .eq("mission_day_id", dayId),
        serviceClient
          .from("mission_check_ins")
          .select("id", { count: "exact", head: true })
          .eq("mission_id", missionId)
          .eq("check_in_type", "departure"),
      ]);
      return {
        source: day.completion_source,
        consumed: code.consumed_at !== null,
        confirmations: conf.count,
        departures: dep.count,
      };
    };

    // C1 : le code d'abord (ralenti, verrous tenus), puis le support.
    const k1 = await readyCase(C1, idC1, "Course code d'abord");
    installSlow(k1.dayId);
    const codeFirst = complete(C1, k1.missionId, { code: k1.code });
    await waitSleeping(serviceRpc);
    const supportSecond = await confirm(OPS, k1.incident, k1.contactId);
    const codeFirstRes = await codeFirst;
    dropSlow();
    const r1 = await realizations(k1.dayId, k1.missionId);
    const { data: k1Case } = await serviceClient
      .from("mission_incidents")
      .select("status, closed_reason")
      .eq("id", k1.incident)
      .single();
    report(
      "C1 code puis support (ordre imposé) : une seule réalisation (code consommé, provenance « code », un départ, aucune confirmation manuelle) ; le support retrouve le résultat acquis ; dossier clos « journée confirmée »",
      codeFirstRes.status === 200 &&
        (codeFirstRes.body.completion as { already_completed?: boolean })
          ?.already_completed === false &&
        supportSecond.status === 200 &&
        (supportSecond.body.confirmation as { already_confirmed?: boolean })
          ?.already_confirmed === true &&
        (supportSecond.body.confirmation as { completed_via?: string })
          ?.completed_via === "code" &&
        r1.source === "code" &&
        r1.consumed &&
        r1.confirmations === 0 &&
        r1.departures === 1 &&
        k1Case?.status === "closed" &&
        k1Case.closed_reason === "day_confirmed",
      { r1, support: supportSecond.body, k1Case },
    );

    // C2 : le support d'abord (ralenti), puis le code.
    const k2 = await readyCase(C2, idC2, "Course support d'abord");
    installSlow(k2.dayId);
    const supportFirst = confirm(OPS, k2.incident, k2.contactId);
    await waitSleeping(serviceRpc);
    const codeSecond = await complete(C2, k2.missionId, { code: k2.code });
    const supportFirstRes = await supportFirst;
    dropSlow();
    const r2 = await realizations(k2.dayId, k2.missionId);
    report(
      "C2 support puis code (ordre imposé) : une seule réalisation (provenance « support », code non consommé, aucun départ) ; le code retrouve la réalisation acquise",
      supportFirstRes.status === 200 &&
        (supportFirstRes.body.confirmation as { result?: string })?.result ===
          "confirmed" &&
        codeSecond.status === 200 &&
        (codeSecond.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        r2.source === "support" &&
        !r2.consumed &&
        r2.confirmations === 1 &&
        r2.departures === 0,
      { r2, code: codeSecond.body },
    );

    // C3 : le support ouvre le dossier, le candidat reçoit son code avant
    // la décision.
    const k3 = await readyCase(C3, idC3, "Code reçu pendant l'instruction");
    const opened = await http(
      "GET",
      `/api/admin/incidents/${k3.incident}`,
      OPS.cookie,
    );
    const byCode = await complete(C3, k3.missionId, { code: k3.code });
    const late = await confirm(OPS, k3.incident, k3.contactId);
    const reopened = await http(
      "GET",
      `/api/admin/incidents/${k3.incident}`,
      OPS.cookie,
    );
    const r3 = await realizations(k3.dayId, k3.missionId);
    const view3 = reopened.body.incident as {
      status?: string;
      can_confirm_day?: boolean;
      day?: { completed_via?: string };
    };
    report(
      "C3 dossier ouvert par le support, code reçu avant la décision : journée confirmée par code ; confirmation ensuite → résultat acquis sans écriture ; dossier clos, plus de confirmation possible",
      (opened.body.incident as { can_confirm_day?: boolean })
        ?.can_confirm_day === true &&
        byCode.status === 200 &&
        (late.body.confirmation as { already_confirmed?: boolean })
          ?.already_confirmed === true &&
        r3.source === "code" &&
        r3.confirmations === 0 &&
        view3.status === "closed" &&
        view3.can_confirm_day === false &&
        view3.day?.completed_via === "code",
      { r3, view3 },
    );

    // ── P et E. Période complète : panne puis effets ─────────────
    console.log("\n── P. Panne pendant la confirmation ──");
    const { jobId: jobQ } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Banquet sur deux jours",
        company_id: coQ,
        mission_pay_per_candidate: 25000,
        positions_available: 1,
      },
      [
        { date: "2099-12-14", start_time: "08:00", end_time: "16:00" },
        { date: "2099-12-15", start_time: "08:00", end_time: "16:00" },
      ],
    );
    const { data: appQ } = await C4.client.rpc("apply_to_job", {
      p_job_id: jobQ,
    });
    const selQ = await signAndSelectHttp(APP_URL, appQ!.id, Q.cookie);
    const mQ = (selQ.body.selection as { mission_id: string }).mission_id;
    const { data: qDays } = await serviceClient
      .from("mission_days")
      .select("id")
      .eq("mission_id", mQ)
      .order("starts_at");
    const [qd1, qd2] = qDays!;
    await endedDay(qd1.id, -3);
    await endedDay(qd2.id, -2);
    const repBefore = async () =>
      (
        await serviceRpc.rpc("compute_reputation", {
          p_subject_type: "candidate",
          p_subject_id: cand4,
        })
      ).data?.[0] as
        | { confirmed_count?: number; breach_count?: number }
        | undefined;
    const rep0 = await repBefore();
    for (const d of [qd1, qd2]) {
      await http("POST", `/api/missions/${mQ}/start`, C4.cookie, {
        mission_day_id: d.id,
      });
    }
    const q1Code = await complete(C4, mQ, {
      code: (await codeOf(qd1.id)).code,
      mission_day_id: qd1.id,
    });
    const { data: mQHalf } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", mQ)
      .single();
    const rep1 = await repBefore();
    const qReport = await reportCode(C4, mQ, qd2.id);
    const qIncident = String(
      (qReport.body.incident as { incident_id?: string })?.incident_id ?? "",
    );
    const qAnswer = await contact(
      SUP,
      qIncident,
      confirmedAnswer("E-mail du traiteur reçu à 16 h 30"),
    );
    const qContact = String(
      (qAnswer.body.contact as { contact_id?: string })?.contact_id ?? "",
    );
    const notifBefore = await notifs(idC4, "mission_day_confirmed");
    installFailure(qd2.id);
    let failed: HttpResult;
    try {
      failed = await confirm(OPS, qIncident, qContact);
    } finally {
      dropFailure();
    }
    const qd2Failed = await dayRow(qd2.id);
    const { data: qCaseFailed } = await serviceClient
      .from("mission_incidents")
      .select("status, outcome")
      .eq("id", qIncident)
      .single();
    const { count: qConfFailed } = await serviceClient
      .from("mission_day_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("incident_id", qIncident);
    const { data: mQFailed } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", mQ)
      .single();
    report(
      "P1 panne pendant la confirmation (trace refusée) : 500 générique ; ni réalisation, ni confirmation, ni décision, ni notification, mission inchangée",
      failed.status === 500 &&
        failed.body.code === "confirmation_failed" &&
        !failed.text.includes("proof_l15_failure") &&
        qd2Failed.actual_end_time === null &&
        qd2Failed.completion_source === null &&
        qConfFailed === 0 &&
        qCaseFailed?.status === "open" &&
        qCaseFailed.outcome === null &&
        (await notifs(idC4, "mission_day_confirmed")) === notifBefore &&
        mQFailed?.actual_end_time === null,
      { failed: failed.body, qd2Failed, qCaseFailed, mQFailed },
    );
    const retry = await confirm(OPS, qIncident, qContact);
    const { data: mQDone } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", mQ)
      .single();
    report(
      "P2 reprise après la panne : confirmation enregistrée une fois",
      retry.status === 200 &&
        (retry.body.confirmation as { result?: string })?.result ===
          "confirmed" &&
        (await notifs(idC4, "mission_day_confirmed")) === notifBefore + 1,
      retry.body,
    );

    console.log("\n── E. Effets sur la mission, les avis et la réputation ──");
    const rep2 = await repBefore();
    const rep2again = await repBefore();
    report(
      "E1 période complète : après la journée 1 (code) mission en cours, après la journée 2 (support) mission réalisée ; candidat +1 pour la période, une seule fois (recalcul identique)",
      q1Code.status === 200 &&
        mQHalf?.status === "in_progress" &&
        mQHalf.actual_end_time === null &&
        (rep1?.confirmed_count ?? -1) === (rep0?.confirmed_count ?? -2) &&
        mQDone?.status === "completed" &&
        mQDone.actual_end_time !== null &&
        (rep2?.confirmed_count ?? -1) === (rep0?.confirmed_count ?? -2) + 1 &&
        rep2again?.confirmed_count === rep2?.confirmed_count,
      { rep0, rep1, rep2, mQHalf, mQDone },
    );
    const reviewC4 = await http(
      "POST",
      `/api/missions/${mQ}/review`,
      C4.cookie,
      {
        rating: 5,
      },
    );
    const admissible = execSql(
      `select public.reputation_review_admissible(r.id) as ok from public.reviews r where r.mission_id = '${mQ}' and r.reviewer_type = 'candidate'`,
    );
    const offersBefore = (
      ((
        await serviceRpc.rpc("reputation_company_offers", {
          p_company_id: coQ,
        })
      ).data ?? []) as { offer_id: string }[]
    ).map((o) => o.offer_id);
    const { error: closeErr } = await serviceRpc.rpc("proof_l15_close", {
      p_job: jobQ,
    });
    const offersAfter = (
      ((
        await serviceRpc.rpc("reputation_company_offers", {
          p_company_id: coQ,
        })
      ).data ?? []) as { offer_id: string }[]
    ).map((o) => o.offer_id);
    const repQ = (
      await serviceRpc.rpc("compute_reputation", {
        p_subject_type: "company",
        p_subject_id: coQ,
      })
    ).data?.[0] as { confirmed_count?: number } | undefined;
    report(
      "E2 évaluation de l'entreprise ouverte et admissible (travail confirmé) ; offre : aucune unité avant la clôture, +1 une seule fois après",
      reviewC4.status === 200 &&
        /"ok":\s*true/.test(admissible) &&
        !offersBefore.includes(jobQ) &&
        !closeErr &&
        offersAfter.filter((o) => o === jobQ).length === 1 &&
        repQ?.confirmed_count === 1,
      {
        review: reviewC4.status,
        admissible: admissible.slice(0, 120),
        offersAfter,
        repQ,
      },
    );
    const { count: sanctions } = await serviceClient
      .from("reputation_incidents")
      .select("id", { count: "exact", head: true })
      .in("subject_id", [cand4, cand1, coA, coQ]);
    const { data: payments } = await serviceClient
      .from("missions")
      .select("payment_status")
      .in("id", [m4.missionId, mQ, k2.missionId]);
    const rep1C4 = await repBefore();
    report(
      "E3 aucune sanction, aucun paiement : aucun manquement enregistré, statut de paiement inchangé (pending) ; candidat C4 : deux missions réalisées (journée unique confirmée par le support, période complète), aucun retrait",
      sanctions === 0 &&
        (payments ?? []).every((p) => p.payment_status === "pending") &&
        rep1C4?.confirmed_count === 2 &&
        rep1C4.breach_count === 0,
      { sanctions, payments, rep1C4 },
    );

    // ── X. Tables du lot fermées aux sessions ────────────────────
    console.log("\n── X. Accès directs ──");
    const [selC, selA, selSup, insSup, insConf] = await Promise.all([
      C4.client.from("mission_incident_contacts").select("id"),
      A.client.from("mission_day_confirmations").select("id"),
      SUP.client.from("mission_incident_contacts").select("id"),
      SUP.client.from("mission_incident_contacts").insert({
        incident_id: caseId,
        entry_type: "response",
        channel: "phone",
        occurred_at: nowIso(),
        result: "work_confirmed",
        reference: "Écriture directe",
        recorded_by_role: "admin_support",
      }),
      OPS.client.from("mission_day_confirmations").insert({
        mission_day_id: k3.dayId,
        mission_id: k3.missionId,
        candidate_id: cand1,
        incident_id: k3.incident,
        contact_id: k3.contactId,
        reason: "Écriture directe interdite.",
        confirmed_by_role: "admin_ops",
      }),
    ]);
    const dayWrite = await OPS.client
      .from("mission_days")
      .update({ completion_source: "support" })
      .eq("id", k3.dayId)
      .select("id");
    const thirdRead = await http(
      "GET",
      `/api/missions/${m4.missionId}/incidents`,
      B.cookie,
    );
    report(
      "X1 contacts et confirmations illisibles et non modifiables en session (parties, support) ; provenance non modifiable ; entreprise tierce refusée (404)",
      [selC, selA, selSup].every(
        (r) => !!r.error || (r.data ?? []).length === 0,
      ) &&
        !!insSup.error &&
        !!insConf.error &&
        (dayWrite.data ?? []).length === 0 &&
        thirdRead.status === 404,
      [
        selC.error?.code,
        selSup.error?.code,
        insSup.error?.code,
        insConf.error?.code,
        thirdRead.status,
      ],
    );
    const anonRpc = await anon.rpc("admin_confirm_mission_day", {
      p_incident_id: caseId,
      p_contact_id: confirmedId,
      p_reason: "Anonyme qui tente une confirmation.",
    });
    report(
      "X2 RPC de confirmation refusée à l'anonyme",
      !!anonRpc.error,
      anonRpc.error?.code,
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
