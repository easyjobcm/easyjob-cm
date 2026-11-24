/**
 * Preuve lot 17d-3 — interventions du support sur les engagements.
 * Décisions : ANN-17 (retrait ciblé décidé par le support), ANN-18
 * (engagements d'un candidat suspendu), SAN-08 (constat d'absence
 * injustifiée, sans effet), validées le 2026-11-23 ; ANN-15, ANN-16,
 * ANN-06, ECH-09, ADM-04, DON-04.
 *
 * Fixtures en clé service ; sélections par « Signer et sélectionner » en
 * session ; demandes et décisions par les vraies routes et RPC sous des
 * sessions réelles ; état relu en clé service. Instants exacts : fonctions
 * temporaires `proof_17d3_*` (pile de preuve) qui placent l'échéance à
 * now() + décalage puis appellent la vraie RPC dans la même transaction.
 * La décision du lot 16 sur la réalisation (`mission_incident_decisions`)
 * est posée par la voie de maintenance : sa double validation réelle est
 * prouvée par `mission-disputes`.
 *
 *   R. Retrait ciblé : demande tracée, refus par rôle, grades, ancien jeton
 *      suspendu, limite exacte du début, acceptation imputée à l'entreprise,
 *      candidat prévenu sans motif, doubles envois, courses, panne.
 *   S. Suspension : tâche ouverte sans annulation, ancien appel fermé,
 *      demande du candidat sans manquement, décision revérifiée, entreprise
 *      informée sans cause, levée avant et après la décision, journée non
 *      couverte, course avec l'entreprise.
 *   F. Constat d'absence : instruction parallèle, décision bloquée par la
 *      réalisation, 72 h exactes, nouvelle pièce, double validation, aucun
 *      effet de sanction, recours de 7 jours, confidentialité.
 *   G. Articulation avec la réalisation par les vrais parcours du lot 16
 *      (signalement, début, proposition et revue par deux agents, demande de
 *      révision) : parcours propre sans dossier décidé, contestation ouverte
 *      bloquante, travail confirmé et situation ambiguë sans absence
 *      injustifiée, course avec le début de la journée.
 *   H. Modalités du 2026-11-24 : origine des délais (notifications),
 *      support instructeur, historique après infirmation, nouveaux
 *      éléments, réexamen d'un refus de retrait et début franchi.
 *   I. Élément reçu pendant l'instruction (même après 72 h) et course avec
 *      la seconde validation ; aucun plafond cumulatif ; un réexamen par refus.
 *   D. Tables et fonctions fermées.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays, type FixtureDay } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectRpc } from "./lib/sign-and-select";
import { purgeProofJobs } from "./lib/proof-purge";
import { rescheduleFixture } from "./lib/mission-schedule-fixture";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF = "support-interventions";
const PROOF_PASSWORD = "Proof-L17d3-support-01!";
const PROOF_USER_METADATA = { proofSupportInterventions: true };

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: PROOF });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
  return r.stdout;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
const serviceRpc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

const FUNCTIONS: Record<string, string> = {
  // Suspension posée comme par la base (cause fraude, fin choisie).
  "proof_17d3_suspend(uuid, timestamptz)": `
create or replace function public.proof_17d3_suspend(p_user uuid, p_ends timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.account_suspensions (user_id, cause, starts_at, ends_at, reason)
  values (p_user, 'fraud', now() - interval '1 second', p_ends, 'Fixture de preuve 17d-3.')
  returning id into v_id;
  perform public.refresh_account_active(p_user, now());
  return v_id;
end $$`,
  // Début d'une journée à now() + décalage, puis décision sous l'identité
  // de l'agent, dans la même transaction.
  "proof_17d3_decide(uuid, uuid, text, uuid[], text, uuid, interval)": `
create or replace function public.proof_17d3_decide(
  p_actor uuid, p_id uuid, p_decision text, p_days uuid[], p_note text, p_shift uuid, p_delta interval)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text;
begin
  if p_shift is not null then
    alter table public.mission_days disable trigger trg_protect_mission_day_writes;
    update public.mission_days d set starts_at = now() + p_delta, ends_at = now() + p_delta + interval '6 hours'
    where d.id = p_shift;
    alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.admin_decide_engagement_request(p_id, p_decision, p_days, p_note) x;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  // Décision du lot 16 sur la réalisation (voie de maintenance) : issue,
  // échéance de révision à now() + décalage, révision demandée ou non.
  "proof_17d3_realization(uuid, text, interval, text)": `
create or replace function public.proof_17d3_realization(
  p_incident uuid, p_outcome text, p_delta interval, p_appeal text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_dec uuid;
begin
  alter table public.mission_incident_decisions disable trigger user;
  alter table public.mission_incident_appeals disable trigger user;
  insert into public.mission_incident_decisions (incident_id, kind, outcome, facts_retained,
    elements_verified, contradictions, justification, decided_by_role, decided_at, review_deadline)
  values (p_incident, 'initial', p_outcome, 'Faits de preuve.', 'Éléments de preuve.', 'Aucune.',
          'Justification de preuve.', 'admin_ops', now(), now() + p_delta)
  returning id into v_dec;
  if p_appeal is not null then
    insert into public.mission_incident_appeals (incident_id, decision_id, status)
    values (p_incident, v_dec, p_appeal);
  end if;
  alter table public.mission_incident_appeals enable trigger user;
  alter table public.mission_incident_decisions enable trigger user;
  return v_dec;
end $$`,
  // Échéance de réponse du candidat à now() + décalage, puis réponse.
  "proof_17d3_answer(uuid, uuid, interval, text)": `
create or replace function public.proof_17d3_answer(
  p_actor uuid, p_finding uuid, p_delta interval, p_statement text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text;
begin
  alter table public.absence_findings disable trigger trg_protect_absence_findings;
  update public.absence_findings f set candidate_due_at = now() + p_delta, candidate_notified_at = now() + p_delta - interval '72 hours' where f.id = p_finding;
  alter table public.absence_findings enable trigger trg_protect_absence_findings;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.answer_absence_finding(p_finding, p_statement) x;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  // Échéance de réponse placée dans le passé (silence du candidat).
  "proof_17d3_expire(uuid)": `
create or replace function public.proof_17d3_expire(p_finding uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.absence_findings disable trigger trg_protect_absence_findings;
  update public.absence_findings f set candidate_due_at = now() - interval '1 second', candidate_notified_at = now() - interval '1 second' - interval '72 hours' where f.id = p_finding;
  alter table public.absence_findings enable trigger trg_protect_absence_findings;
end $$`,
  // Échéance de recours à now() + décalage, puis demande de recours.
  "proof_17d3_review(uuid, uuid, interval, text)": `
create or replace function public.proof_17d3_review(
  p_actor uuid, p_finding uuid, p_delta interval, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text;
begin
  alter table public.absence_findings disable trigger trg_protect_absence_findings;
  update public.absence_findings f set review_deadline = now() + p_delta, decision_notified_at = now() + p_delta - interval '7 days' where f.id = p_finding;
  alter table public.absence_findings enable trigger trg_protect_absence_findings;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.request_absence_finding_review(p_finding, p_note) x;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  // Échéance de révision d'une décision réelle du lot 16 (horloge seule).
  "proof_17d3_review_window(uuid, interval)": `
create or replace function public.proof_17d3_review_window(p_incident uuid, p_delta interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_incident_decisions disable trigger trg_protect_mission_incident_decisions;
  update public.mission_incident_decisions d set review_deadline = now() + p_delta
  where d.incident_id = p_incident and d.kind = 'initial';
  alter table public.mission_incident_decisions enable trigger trg_protect_mission_incident_decisions;
end $$`,
  "proof_17d3_rep(text, uuid)": `
create or replace function public.proof_17d3_rep(p_type text, p_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(r) from public.compute_reputation(p_type, p_id) r;
$$`,
  "proof_17d3_conflicts(uuid, timestamptz, timestamptz)": `
create or replace function public.proof_17d3_conflicts(p_candidate uuid, p_from timestamptz, p_to timestamptz)
returns integer language sql security definer set search_path = '' as $$
  select cardinality(public.candidate_schedule_conflicts(p_candidate, array[tstzrange(p_from, p_to)]));
$$`,
};
const DROP_ALL = [
  ...Object.keys(FUNCTIONS).map((f) => `drop function if exists public.${f}`),
  "drop trigger if exists proof_17d3_fail_audit on public.audit_logs",
  "drop function if exists public.proof_17d3_fail_audit()",
  "drop trigger if exists proof_17d3_slow_element on public.absence_finding_events",
  "drop function if exists public.proof_17d3_slow_element()",
  "drop trigger if exists proof_17d3_slow_decision on public.absence_findings",
  "drop function if exists public.proof_17d3_slow_decision()",
  "drop function if exists public.proof_sleeping_backends()",
];

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
        ? `+2376996${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M3D${String(Date.now()).slice(-9)}${name.length}`,
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
      date_of_birth: "1996-04-12",
      city: "Douala",
      address: "Bonamoussadi, rue privée",
      latitude: 4.07,
      longitude: 9.75,
      bio: "Candidat de preuve du lot 17d-3.",
      cni_number: `CNI3D${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677172172",
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
  purgeProofJobs(PROOF, { userIds: ids });
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
      await serviceClient
        .from("candidate_cancellations")
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
      .filter((u) => u.user_metadata?.proofSupportInterventions === true)
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

const REASON = "Profil ne correspondant plus au poste, sans faute du candidat.";
const NOTE = "Décision motivée du support après examen du dossier.";
type Res = { error: string | null; result: Record<string, unknown> | null };

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17d3-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    const keys = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const uidList = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idOps2 = await createAccount(mail("ops2"), "admin_ops");
    const idFnd = await createAccount(mail("fnd"), "admin_founder");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("off"), "admin_ops");
    ids.push(idA, idB, ...uidList, idOps, idOps2, idFnd, idSup, idOff);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, uidList[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Traiteur Akwa");
    await createCompany(idB, "Hôtel Bonanjo");
    const prof = Object.fromEntries(
      await Promise.all(
        keys.map(async (k) => [
          k,
          await createCandidate(uid[k], k.toUpperCase()),
        ]),
      ),
    ) as Record<K, string>;
    const sessionKeys = ["a", "b", ...keys, "ops", "ops2", "fnd", "sup", "off"];
    const sess = Object.fromEntries(
      await Promise.all(
        sessionKeys.map(async (k) => [k, await realSession(mail(k))]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;
    // Ancien jeton : session ouverte, puis compte suspendu.
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);

    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      return new Date(Date.UTC(2099, 5, 1) + dayNo * 86_400_000)
        .toISOString()
        .slice(0, 10);
    };
    const fullPeriod = async (ks: K[], n: number, title: string) => {
      const days: FixtureDay[] = Array.from({ length: n }, () => ({
        date: nextDate(),
        start_time: "08:00",
        end_time: "14:00",
      }));
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-3.",
          address: "Rue Joss",
          city: "Douala",
          title,
          company_id: coA,
          mission_pay_per_candidate: 30000,
          positions_available: ks.length,
        },
        days,
        "full_period",
      );
      const by: Record<
        string,
        { missionId: string; applicationId: string; dayIds: string[] }
      > = {};
      for (const k of ks) {
        const { data: app, error } = await sess[k].client.rpc("apply_to_job", {
          p_job_id: jobId,
        });
        if (error || !app) throw new Error(`apply ${title}: ${error?.message}`);
        const sel = await signAndSelectRpc(A.client, app.id);
        if (sel.error) throw new Error(`select ${title}: ${sel.error.message}`);
        const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", missionId)
          .order("scheduled_date");
        by[k] = {
          missionId,
          applicationId: app.id,
          dayIds: md!.map((d) => d.id),
        };
      }
      return { jobId, by, dates: days.map((d) => d.date) };
    };
    const reqRow = async (id: string) =>
      (
        await serviceClient
          .from("engagement_requests")
          .select("*")
          .eq("id", id)
          .single()
      ).data!;
    const cancelledBy = async (dayIds: string[]) => {
      const out: Record<string, string> = {};
      for (const [t, by] of [
        ["company_cancellation_days", "company"],
        ["candidate_cancellation_days", "candidate"],
        ["support_cancellation_days", "support"],
      ] as const) {
        const { data } = await serviceClient
          .from(t)
          .select("mission_day_id")
          .in("mission_day_id", dayIds);
        for (const r of data ?? []) out[r.mission_day_id] = by;
      }
      return out;
    };
    const notifs = async (userId: string, kind: string) =>
      (
        (
          await serviceClient
            .from("notifications")
            .select("title, body, data")
            .eq("user_id", userId)
        ).data ?? []
      ).filter((n) => (n.data as { kind?: string } | null)?.kind === kind);
    const contractOf = async (appId: string) =>
      JSON.stringify(
        (
          await serviceClient
            .from("contracts")
            .select("*")
            .eq("application_id", appId)
        ).data,
      );
    const incidentsOf = async (k: K) =>
      (
        await serviceClient
          .from("reputation_incidents")
          .select("id")
          .eq("subject_id", prof[k])
      ).data?.length ?? 0;
    const decide = (
      s: Session,
      id: string,
      decision: string,
      day_ids: string[],
      note = NOTE,
    ) =>
      http("POST", `/api/admin/engagement-requests/${id}/decision`, s.cookie, {
        decision,
        day_ids,
        note,
      });
    const removal = (
      jobId: string,
      day_ids: string[],
      reason = REASON,
      request_id = randomUUID(),
      cookie = A.cookie,
    ) =>
      http("POST", `/api/jobs/${jobId}/removal-requests`, cookie, {
        request_id,
        day_ids,
        reason,
      });
    const reqIdOf = (r: HttpResult) =>
      (r.body.result as { engagement_request_id: string } | undefined)
        ?.engagement_request_id ?? "";

    // ── R. Retrait ciblé (ANN-17) ─────────────────────────────
    {
      const job = await fullPeriod(["c1", "c2"], 2, "Hôtesses (retrait)");
      const c1Days = job.by.c1.dayIds;
      const contract = await contractOf(job.by.c1.applicationId);
      const short = await removal(job.jobId, c1Days, "court");
      const other = await removal(
        job.jobId,
        c1Days,
        REASON,
        randomUUID(),
        sess.b.cookie,
      );
      const cand = await removal(
        job.jobId,
        c1Days,
        REASON,
        randomUUID(),
        sess.c1.cookie,
      );
      const mixed = await removal(job.jobId, [c1Days[0], job.by.c2.dayIds[0]]);
      const rq = randomUUID();
      const ok = await removal(job.jobId, c1Days, REASON, rq);
      const replay = await removal(job.jobId, c1Days, REASON, rq);
      const dup = await removal(job.jobId, [c1Days[0]]);
      const id = reqIdOf(ok);
      const untouched = Object.keys(await cancelledBy(c1Days)).length;
      report(
        "R1 demande de retrait tracée, motif obligatoire ; autre entreprise, candidat et journées de deux candidats refusés ; relance idempotente ; une seule demande en attente par journée ; rien ne change avant la décision",
        short.status === 400 &&
          short.body.code === "cancellation_reason_required" &&
          other.status === 404 &&
          cand.status === 403 &&
          mixed.status === 400 &&
          ok.status === 200 &&
          (replay.body.result as { already_recorded: boolean })
            .already_recorded === true &&
          reqIdOf(replay) === id &&
          dup.status === 409 &&
          dup.body.code === "removal_already_requested" &&
          untouched === 0 &&
          (await reqRow(id)).status === "pending",
        {
          short: short.body.code,
          other: other.status,
          cand: cand.status,
          mixed: mixed.body.code,
          dup: dup.body.code,
        },
      );
      const sup = await decide(sess.sup, id, "accept", c1Days);
      const off = await decide(sess.off, id, "accept", c1Days);
      const co = await decide(A, id, "accept", c1Days);
      const listSup = await http(
        "GET",
        "/api/admin/engagement-requests",
        sess.sup.cookie,
      );
      const listCand = await http(
        "GET",
        "/api/admin/engagement-requests",
        sess.c1.cookie,
      );
      report(
        "R2 décision réservée à un ops ou fondateur actif : support, ops suspendu (ancien jeton) et entreprise refusés ; le support lit la file, le candidat non",
        sup.status === 403 &&
          off.status === 403 &&
          co.status === 403 &&
          listSup.status === 200 &&
          listSup.text.includes(id) &&
          listCand.status === 403 &&
          (await reqRow(id)).status === "pending",
        {
          sup: sup.status,
          off: off.status,
          co: co.status,
          listSup: listSup.status,
          listCand: listCand.status,
        },
      );
      // Limite : début à l'instant exact → refus ; 1 µs plus tard → accepté.
      const atStart = await proofRpc<Res>("proof_17d3_decide", {
        p_actor: idOps,
        p_id: id,
        p_decision: "accept",
        p_days: [c1Days[0]],
        p_note: NOTE,
        p_shift: c1Days[0],
        p_delta: "0",
      });
      const stillPending = (await reqRow(id)).status;
      const justBefore = await proofRpc<Res>("proof_17d3_decide", {
        p_actor: idOps,
        p_id: id,
        p_decision: "accept",
        p_days: c1Days,
        p_note: NOTE,
        p_shift: c1Days[0],
        p_delta: "1 microsecond",
      });
      report(
        "R3 décision avant le début : à l'instant exact du début refusée (day_already_begun) sans effet ; 1 µs avant, acceptée",
        atStart.error === "day_already_begun" &&
          stillPending === "pending" &&
          justBefore.error === null,
        { atStart: atStart.error, justBefore: justBefore.error },
      );
      const row = await reqRow(id);
      const { data: cc } = await serviceClient
        .from("company_cancellations")
        .select("*")
        .eq("support_request_id", id)
        .single();
      const by = await cancelledBy([...c1Days, ...job.by.c2.dayIds]);
      const { data: m1 } = await serviceClient
        .from("missions")
        .select("status, cancelled_by, cancellation_reason")
        .eq("id", job.by.c1.missionId)
        .single();
      const { data: app1 } = await serviceClient
        .from("job_applications")
        .select("status")
        .eq("id", job.by.c1.applicationId)
        .single();
      const { data: jobRow } = await serviceClient
        .from("jobs")
        .select("positions_filled")
        .eq("id", job.jobId)
        .single();
      const candN = await notifs(uid.c1, "company_cancellation");
      const coN = await notifs(idA, "targeted_removal");
      report(
        "R4 acceptation imputée à l'entreprise (company_cancellations, support et auteur tracés, qualification ANN-06) ; candidat c2 intact ; mission close par l'entreprise ; candidature, place et contrat conservés ; aucun manquement ; candidat prévenu sans le motif ; entreprise prévenue",
        row.status === "accepted" &&
          !!cc &&
          cc.decided_by === idOps &&
          cc.reason === REASON &&
          by[c1Days[0]] === "company" &&
          by[c1Days[1]] === "company" &&
          !by[job.by.c2.dayIds[0]] &&
          m1?.status === "cancelled" &&
          m1.cancelled_by === "company" &&
          app1?.status === "selected" &&
          jobRow?.positions_filled === 2 &&
          (await contractOf(job.by.c1.applicationId)) === contract &&
          (await incidentsOf("c1")) === 0 &&
          candN.length === 1 &&
          !JSON.stringify(candN).includes("correspondant") &&
          coN.length === 1,
        {
          status: row.status,
          cc: cc?.decided_by === idOps,
          m1,
          app1,
          filled: jobRow?.positions_filled,
          candN: candN.length,
        },
      );
      const again = await decide(sess.ops, id, "accept", c1Days);
      const flip = await decide(sess.ops2, id, "refuse", []);
      const { count: ccCount } = await serviceClient
        .from("company_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("support_request_id", id);
      // Créneau libéré (ECH-09).
      const { data: d0 } = await serviceClient
        .from("mission_days")
        .select("starts_at, ends_at")
        .eq("id", c1Days[1])
        .single();
      const free = await proofRpc<number>("proof_17d3_conflicts", {
        p_candidate: prof.c1,
        p_from: d0!.starts_at,
        p_to: d0!.ends_at,
      });
      report(
        "R5 relance de la même décision : résultat d'origine ; décision contraire refusée (request_already_decided) ; une seule annulation ; créneau du candidat libéré (ECH-09)",
        again.status === 200 &&
          (again.body.result as { already_decided: boolean })
            .already_decided === true &&
          flip.status === 409 &&
          flip.body.code === "request_already_decided" &&
          ccCount === 1 &&
          free === 0,
        { again: again.body, flip: flip.body.code, ccCount, free },
      );

      // Refus motivé, courses et panne.
      const j2 = await fullPeriod(["c2", "c4"], 3, "Vestiaire (retrait)");
      const r2 = reqIdOf(await removal(j2.jobId, [j2.by.c2.dayIds[0]]));
      const refused = await decide(sess.fnd, r2, "refuse", []);
      const refN = await notifs(idA, "targeted_removal");
      report(
        "R6 refus motivé par le fondateur : engagement intact, entreprise prévenue",
        refused.status === 200 &&
          (await reqRow(r2)).status === "refused" &&
          Object.keys(await cancelledBy([j2.by.c2.dayIds[0]])).length === 0 &&
          refN.length === 2,
        { refused: refused.body },
      );
      // Deux agents décident en même temps.
      const r3 = reqIdOf(await removal(j2.jobId, [j2.by.c2.dayIds[1]]));
      const [x1, x2] = await Promise.all([
        decide(sess.ops, r3, "accept", [j2.by.c2.dayIds[1]]),
        decide(sess.ops2, r3, "refuse", []),
      ]);
      const st3 = (await reqRow(r3)).status;
      const one =
        [x1, x2].filter((x) => x.status === 200).length === 1 &&
        [x1, x2].some((x) => x.body.code === "request_already_decided");
      // Désistement du candidat et décision du support en même temps.
      const r4 = reqIdOf(await removal(j2.jobId, [j2.by.c2.dayIds[2]]));
      const [dec4, cand4] = await Promise.all([
        decide(sess.ops, r4, "accept", [j2.by.c2.dayIds[2]]),
        http(
          "POST",
          `/api/missions/${j2.by.c2.missionId}/cancellation`,
          sess.c2.cookie,
          {
            request_id: randomUUID(),
            day_ids: [j2.by.c2.dayIds[2]],
            reason_code: null,
            reason_text: null,
            evidence_choice: null,
          },
        ),
      ]);
      const by4 = await cancelledBy([j2.by.c2.dayIds[2]]);
      report(
        "R7 courses : deux décisions contraires simultanées → une seule ; décision et désistement simultanés → une seule annulation, l'autre refusée",
        one &&
          (st3 === "accepted" || st3 === "refused") &&
          Object.keys(by4).length === 1 &&
          [dec4, cand4].filter((x) => x.status === 200).length === 1 &&
          [dec4, cand4].some((x) => x.body.code === "day_already_cancelled"),
        {
          x: [x1.body.code ?? x1.status, x2.body.code ?? x2.status],
          dec4: dec4.body.code ?? dec4.status,
          cand4: cand4.body.code ?? cand4.status,
          by4,
        },
      );
      // Début et décision simultanés (journée dans 10 minutes).
      const r5 = reqIdOf(await removal(j2.jobId, [j2.by.c4.dayIds[0]]));
      execSql(`do $$ begin alter table public.mission_days disable trigger trg_protect_mission_day_writes;
        update public.mission_days set starts_at = now() + interval '10 minutes', ends_at = now() + interval '6 hours' where id = '${j2.by.c4.dayIds[0]}';
        alter table public.mission_days enable trigger trg_protect_mission_day_writes; end $$`);
      const [start5, dec5] = await Promise.all([
        sess.c4.client.rpc("start_mission", {
          p_mission_id: j2.by.c4.missionId,
          p_mission_day_id: j2.by.c4.dayIds[0],
        }),
        decide(sess.ops, r5, "accept", [j2.by.c4.dayIds[0]]),
      ]);
      const { data: d5 } = await serviceClient
        .from("mission_days")
        .select("actual_start_time")
        .eq("id", j2.by.c4.dayIds[0])
        .single();
      const c5x = Object.keys(await cancelledBy([j2.by.c4.dayIds[0]])).length;
      const startWon =
        !start5.error &&
        dec5.body.code === "day_started" &&
        !!d5?.actual_start_time &&
        c5x === 0;
      const decWon =
        dec5.status === 200 &&
        start5.error?.message === "day_cancelled" &&
        !d5?.actual_start_time &&
        c5x === 1;
      report(
        "R8 début et décision simultanés : une seule issue (journée commencée → interruption existante, ou annulée)",
        startWon !== decWon,
        {
          start: start5.error?.message ?? "ok",
          dec: dec5.body.code ?? dec5.status,
          c5x,
        },
      );
      // Panne de l'audit : aucun effet partiel.
      const r6 = reqIdOf(await removal(j2.jobId, [j2.by.c4.dayIds[1]]));
      execSql(`create or replace function public.proof_17d3_fail_audit() returns trigger language plpgsql as $$ begin
        if new.resource_id = '${r6}'::uuid and new.action = 'decide_engagement_request' then raise exception 'proof_17d3_forced_failure'; end if;
        return new; end $$`);
      execSql(
        "create trigger proof_17d3_fail_audit before insert on public.audit_logs for each row execute function public.proof_17d3_fail_audit()",
      );
      const fail = await decide(sess.ops, r6, "accept", [j2.by.c4.dayIds[1]]);
      execSql(
        "drop trigger if exists proof_17d3_fail_audit on public.audit_logs",
      );
      report(
        "R9 panne de l'audit pendant la décision : réponse 500 générique, demande en attente, aucune annulation ni avis",
        fail.status === 500 &&
          !fail.text.includes("proof_17d3") &&
          (await reqRow(r6)).status === "pending" &&
          Object.keys(await cancelledBy([j2.by.c4.dayIds[1]])).length === 0,
        { fail: fail.status },
      );
    }

    // ── S. Candidat suspendu (ANN-18) ─────────────────────────
    {
      const job = await fullPeriod(["c3"], 3, "Buffet (indisponibilité)");
      const d = job.by.c3.dayIds;
      const contract = await contractOf(job.by.c3.applicationId);
      const t0 = new Date().toISOString();
      const susp = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.c3,
        p_active: false,
      });
      const { data: tasks } = await serviceClient
        .from("engagement_requests")
        .select("id, status")
        .eq("candidate_user_id", uid.c3)
        .eq("kind", "suspension_task");
      const { count: taskDays } = await serviceClient
        .from("engagement_request_days")
        .select("mission_day_id", { count: "exact", head: true })
        .eq("engagement_request_id", tasks?.[0]?.id ?? randomUUID());
      const coNotes =
        (
          await serviceClient
            .from("notifications")
            .select("body, created_at")
            .eq("user_id", idA)
            .gte("created_at", t0)
        ).data ?? [];
      report(
        "S1 suspension (admin_set_user_active par un ops) : tâche du support ouverte immédiatement avec les 3 journées couvertes, aucune annulation automatique, entreprise non informée",
        !susp.error &&
          tasks?.length === 1 &&
          tasks[0].status === "pending" &&
          taskDays === 3 &&
          Object.keys(await cancelledBy(d)).length === 0 &&
          coNotes.every((n) => !/suspen|indisponible/i.test(n.body)),
        { susp: susp.error?.message, tasks, taskDays, coNotes: coNotes.length },
      );
      const oldRpc = await sess.c3.client.rpc(
        "request_candidate_cancellation",
        {
          p_request_id: randomUUID(),
          p_day_ids: [d[0]],
          p_reason_code: "illness",
          p_reason_text: null as unknown as string,
          p_evidence_choice: "none",
        },
      );
      const oldRoute = await http(
        "POST",
        `/api/missions/${job.by.c3.missionId}/cancellation`,
        sess.c3.cookie,
        {
          request_id: randomUUID(),
          day_ids: [d[0]],
          reason_code: null,
          reason_text: null,
          evidence_choice: null,
        },
      );
      const { count: candCancels } = await serviceClient
        .from("candidate_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("candidate_user_id", uid.c3);
      const preview = await http(
        "GET",
        "/api/support-cancellation",
        sess.c3.cookie,
      );
      const myReq = await http(
        "POST",
        "/api/support-cancellation",
        sess.c3.cookie,
        {
          request_id: randomUUID(),
          day_ids: [d[0], d[1]],
          message: "Je ne pourrai pas venir pendant ma suspension.",
        },
      );
      const dossiers = await http(
        "GET",
        `/api/missions/${job.by.c3.missionId}`,
        sess.c3.cookie,
      );
      report(
        "S2 candidat suspendu : ancien appel d'annulation fermé en base et par la route (account_suspended), aucun désistement ; « Demander l'annulation au support » ouvert (journées couvertes), demande en attente ; accès à sa mission conservé ; aucun manquement",
        oldRpc.error?.message === "account_suspended" &&
          oldRoute.status === 403 &&
          candCancels === 0 &&
          preview.status === 200 &&
          preview.body.suspended === true &&
          (preview.body.days as unknown[]).length === 3 &&
          myReq.status === 200 &&
          dossiers.status === 200 &&
          (await incidentsOf("c3")) === 0 &&
          Object.keys(await cancelledBy(d)).length === 0,
        {
          oldRpc: oldRpc.error?.message,
          oldRoute: oldRoute.body.code,
          preview: preview.status,
          myReq: myReq.body.code ?? myReq.status,
        },
      );
      const candReq = reqIdOf(myReq);
      const taskId = tasks![0].id;
      const repBefore = await proofRpc<{
        experience_units: number;
        breach_count: number;
      }>("proof_17d3_rep", { p_type: "candidate", p_id: prof.c3 });
      const acc = await decide(sess.ops2, candReq, "accept", [d[0], d[1]]);
      const by = await cancelledBy(d);
      const coN = await notifs(idA, "support_cancellation");
      const candN = await notifs(uid.c3, "support_cancellation");
      const missions = await http(
        "GET",
        `/api/jobs/${job.jobId}/missions`,
        A.cookie,
      );
      const repAfter = await proofRpc<{
        experience_units: number;
        breach_count: number;
      }>("proof_17d3_rep", { p_type: "candidate", p_id: prof.c3 });
      report(
        "S3 demande du candidat acceptée par un ops : journées annulées par le support (sans manquement ni effet de réputation) ; entreprise prévenue « candidat indisponible » sans cause ; vue de l'entreprise : auteur « support » ; contrat conservé ; 3e journée intacte",
        acc.status === 200 &&
          by[d[0]] === "support" &&
          by[d[1]] === "support" &&
          !by[d[2]] &&
          coN.length === 1 &&
          coN[0].title === "Candidat indisponible" &&
          !/suspen|fraude|exclu|sanction/i.test(JSON.stringify(coN)) &&
          candN.length === 1 &&
          missions.status === 200 &&
          /"cancelled_by":"support"/.test(missions.text) &&
          !/suspen|fraud/i.test(missions.text) &&
          (await contractOf(job.by.c3.applicationId)) === contract &&
          (await incidentsOf("c3")) === 0 &&
          repAfter.breach_count === repBefore.breach_count &&
          repAfter.experience_units === repBefore.experience_units,
        {
          acc: acc.body.code ?? acc.status,
          flags: {
            title: coN[0]?.title,
            noCause: !/suspen|fraude|exclu|sanction/i.test(JSON.stringify(coN)),
            candN: candN.length,
            missions: missions.status,
            support: /"cancelled_by":"support"/.test(missions.text),
            noLeak: !/suspen|fraud/i.test(missions.text),
            contract: (await contractOf(job.by.c3.applicationId)) === contract,
            incidents: await incidentsOf("c3"),
          },
          by,
          coN: coN.map((n) => n.body),
          rep: [repBefore, repAfter],
        },
      );
      // La tâche : journées déjà annulées → refus ; la journée restante seule → acceptée.
      const stale = await decide(sess.ops, taskId, "accept", [d[0], d[2]]);
      const accTask = await decide(sess.fnd, taskId, "accept", [d[2]]);
      const { data: m3 } = await serviceClient
        .from("missions")
        .select("status, cancelled_by, cancellation_reason")
        .eq("id", job.by.c3.missionId)
        .single();
      report(
        "S4 tâche revérifiée à la décision : journée déjà annulée → refus sans effet (day_already_cancelled) ; dernière journée acceptée ; mission close par le support (admin, support_cancellation)",
        stale.status === 409 &&
          stale.body.code === "day_already_cancelled" &&
          accTask.status === 200 &&
          m3?.status === "cancelled" &&
          m3.cancelled_by === "admin" &&
          m3.cancellation_reason === "support_cancellation",
        {
          stale: stale.body.code,
          accTask: accTask.body.code ?? accTask.status,
          m3,
        },
      );
      // Levée après la décision : rien n'est restauré.
      const lift = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.c3,
        p_active: true,
      });
      const { data: u3 } = await serviceClient
        .from("users")
        .select("is_active")
        .eq("id", uid.c3)
        .single();
      const after = await cancelledBy(d);
      const restart = await sess.c3.client.rpc("start_mission", {
        p_mission_id: job.by.c3.missionId,
        p_mission_day_id: d[0],
      });
      report(
        "S5 levée de suspension après la décision : compte réactivé, journées toujours annulées, aucun début possible, mission non rouverte",
        !lift.error &&
          u3?.is_active === true &&
          Object.keys(after).length === 3 &&
          !!restart.error,
        { lift: lift.error?.message, restart: restart.error?.message },
      );

      // Levée avant la décision ; journée non couverte ; course avec l'entreprise.
      const j2 = await fullPeriod(["c4"], 3, "Buffet (retour)");
      const { data: d2end } = await serviceClient
        .from("mission_days")
        .select("starts_at")
        .eq("id", j2.by.c4.dayIds[1])
        .single();
      // Suspension jusqu'au début de la 2e journée : seule la 1re est couverte.
      const sId = await proofRpc<string>("proof_17d3_suspend", {
        p_user: uid.c4,
        p_ends: d2end!.starts_at,
      });
      const { data: task2 } = await serviceClient
        .from("engagement_requests")
        .select("id")
        .eq("suspension_id", sId)
        .single();
      const { data: t2days } = await serviceClient
        .from("engagement_request_days")
        .select("mission_day_id")
        .eq("engagement_request_id", task2!.id);
      const notCovered = await http(
        "POST",
        "/api/support-cancellation",
        sess.c4.cookie,
        {
          request_id: randomUUID(),
          day_ids: [j2.by.c4.dayIds[1]],
          message: null,
        },
      );
      const liftEarly = await sess.ops.client.rpc("admin_lift_suspension", {
        p_suspension_id: sId,
        p_reason: "Levée de preuve avant décision.",
        p_from_contest: false,
      });
      const late = await decide(sess.ops, task2!.id, "accept", [
        j2.by.c4.dayIds[0],
      ]);
      const close = await decide(sess.ops, task2!.id, "refuse", []);
      report(
        "S6 suspension jusqu'au début de la 2e journée : tâche limitée à la 1re (limite exclue), demande sur la 2e refusée (day_not_covered) ; levée avant la décision → acceptation refusée (suspension_not_active), tâche close par un refus, rien d'annulé",
        (t2days ?? []).some((x) => x.mission_day_id === j2.by.c4.dayIds[0]) &&
          !(t2days ?? []).some(
            (x) =>
              x.mission_day_id === j2.by.c4.dayIds[1] ||
              x.mission_day_id === j2.by.c4.dayIds[2],
          ) &&
          notCovered.status === 409 &&
          notCovered.body.code === "day_not_covered" &&
          !liftEarly.error &&
          late.status === 409 &&
          late.body.code === "suspension_not_active" &&
          close.status === 200 &&
          Object.keys(await cancelledBy(j2.by.c4.dayIds)).length === 0,
        {
          t2days: t2days?.length,
          notCovered: notCovered.body.code,
          late: late.body.code,
          close: close.status,
        },
      );
      const sId2 = await proofRpc<string>("proof_17d3_suspend", {
        p_user: uid.c4,
        p_ends: null,
      });
      const { data: task3 } = await serviceClient
        .from("engagement_requests")
        .select("id")
        .eq("suspension_id", sId2)
        .single();
      const [dec, comp] = await Promise.all([
        decide(sess.ops, task3!.id, "accept", [j2.by.c4.dayIds[2]]),
        http("POST", `/api/jobs/${j2.jobId}/cancellation`, A.cookie, {
          request_id: randomUUID(),
          day_ids: [j2.by.c4.dayIds[2]],
          reason: "Annulation concurrente de preuve.",
          acknowledge_late: false,
        }),
      ]);
      const by3 = await cancelledBy([j2.by.c4.dayIds[2]]);
      report(
        "S7 décision du support et annulation par l'entreprise simultanées : une seule annulation, l'autre refusée",
        Object.keys(by3).length === 1 &&
          [dec, comp].filter((x) => x.status === 200).length === 1,
        {
          dec: dec.body.code ?? dec.status,
          comp: comp.body.code ?? comp.status,
          by3,
        },
      );
      await sess.ops.client.rpc("admin_lift_suspension", {
        p_suspension_id: sId2,
        p_reason: "Fin de la preuve S7.",
        p_from_contest: false,
      });
    }

    // ── F. Constat d'absence injustifiée (SAN-08) ─────────────
    {
      const job = await fullPeriod(["c5", "c6"], 1, "Plonge (absence)");
      const absentDay = async (k: K) => {
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", job.by[k].missionId)
          .single();
        const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const { error } = await rescheduleFixture(
          "mission_days",
          "id",
          md!.id,
          {
            scheduled_date: y,
            scheduled_start_time: "00:00",
            scheduled_end_time: "23:00",
          },
          PROOF,
        );
        if (error) throw new Error(error.message);
        const { data: inc, error: e2 } = await A.client.rpc(
          "report_mission_incident",
          {
            p_mission_id: job.by[k].missionId,
            p_mission_day_id: md!.id,
            p_kind: "absence",
            p_statement: "Le candidat ne s'est pas présenté ce jour-là.",
            p_late_minutes: null as unknown as number,
          },
        );
        if (e2) throw new Error(e2.message);
        return (inc as { incident_id: string }[])[0].incident_id;
      };
      const inc5 = await absentDay("c5");
      const coOpen = await http(
        "POST",
        "/api/admin/absence-findings",
        A.cookie,
        { incident_id: inc5 },
      );
      const open = await http(
        "POST",
        "/api/admin/absence-findings",
        sess.sup.cookie,
        { incident_id: inc5 },
      );
      const again = await http(
        "POST",
        "/api/admin/absence-findings",
        sess.sup.cookie,
        { incident_id: inc5 },
      );
      const fid = (open.body.result as { finding_id: string }).finding_id;
      const fRow = async () =>
        (
          await serviceClient
            .from("absence_findings")
            .select("*")
            .eq("id", fid)
            .single()
        ).data!;
      const candOpenN = await notifs(uid.c5, "absence_finding");
      report(
        "F1 instruction ouverte par le support (admin_support), en parallèle de la décision sur la réalisation ; entreprise refusée ; relance idempotente ; candidat invité à répondre sous 72 h, sans présomption de faute",
        coOpen.status === 403 &&
          open.status === 200 &&
          (again.body.result as { already_open: boolean }).already_open ===
            true &&
          candOpenN.length === 1 &&
          /pas une faute établie/.test(candOpenN[0].body),
        { coOpen: coOpen.status, open: open.body, n: candOpenN.length },
      );
      const prop = (s: Session, outcome: string, rev: number) =>
        http("POST", `/api/admin/absence-findings/${fid}/proposal`, s.cookie, {
          outcome,
          note: NOTE,
          expected_revision: rev,
        });
      const pNoDecision = await prop(sess.ops, "established", 1);
      const decOpen = await proofRpc<string>("proof_17d3_realization", {
        p_incident: inc5,
        p_outcome: "not_established",
        p_delta: "7 days",
        p_appeal: null,
      });
      const pWindow = await prop(sess.ops, "established", 1);
      void decOpen;
      // Réponse à l'instant exact de l'échéance : reçue ; 1 µs après : refusée.
      const atDue = await proofRpc<Res>("proof_17d3_answer", {
        p_actor: uid.c5,
        p_finding: fid,
        p_delta: "0",
        p_statement: "J'étais à l'hôpital ce jour-là.",
      });
      const afterDue = await proofRpc<Res>("proof_17d3_answer", {
        p_actor: uid.c5,
        p_finding: fid,
        p_delta: "-1 microsecond",
        p_statement: "Seconde version hors délai.",
      });
      const supPropose = await prop(sess.sup, "established", 2);
      report(
        "F2 sans décision sur la réalisation, puis décision du lot 16 dans sa fenêtre de révision sans recours demandé : seul le délai de réponse du candidat retient la proposition (response_window_open, décision du 2026-11-24) ; réponse du candidat reçue à l'instant exact de l'échéance de 72 h, refusée 1 µs après ; le support ne propose pas",
        pNoDecision.body.code === "response_window_open" &&
          pWindow.body.code === "response_window_open" &&
          atDue.error === null &&
          afterDue.error === "response_window_closed" &&
          supPropose.status === 403 &&
          (await fRow()).revision === 2,
        {
          pNoDecision: pNoDecision.body.code,
          pWindow: pWindow.body.code,
          atDue: atDue.error,
          afterDue: afterDue.error,
          sup: supPropose.status,
        },
      );
      // Décision définitive « non établi » (révision close), révision demandée ensuite fermée.
      const inc6 = await absentDay("c6");
      await proofRpc("proof_17d3_realization", {
        p_incident: inc6,
        p_outcome: "not_established",
        p_delta: "-1 second",
        p_appeal: "pending_assignment",
      });
      const open6 = await http(
        "POST",
        "/api/admin/absence-findings",
        sess.ops.cookie,
        { incident_id: inc6 },
      );
      const f6 = (open6.body.result as { finding_id: string }).finding_id;
      await proofRpc("proof_17d3_expire", { p_finding: f6 });
      const pAppeal = await http(
        "POST",
        `/api/admin/absence-findings/${f6}/proposal`,
        sess.ops.cookie,
        { outcome: "established", note: NOTE, expected_revision: 1 },
      );
      // inc5 : décision définitive (échéance de révision passée, aucune demande).
      await proofRpc("proof_17d3_realization", {
        p_incident: inc5,
        p_outcome: "not_established",
        p_delta: "-1 second",
        p_appeal: null,
      });
      const stale = await prop(sess.ops, "established", 1);
      const p1 = await prop(sess.ops, "established", 2);
      // Nouvelle pièce pendant le délai : la proposition tombe.
      execSql(`do $$ begin alter table public.absence_findings disable trigger trg_protect_absence_findings;
        update public.absence_findings set candidate_due_at = now() + interval '1 hour', candidate_notified_at = now() + interval '1 hour' - interval '72 hours' where id = '${fid}';
        alter table public.absence_findings enable trigger trg_protect_absence_findings; end $$`);
      const form = new FormData();
      form.append(
        "file",
        new Blob(
          [
            new TextEncoder().encode(
              "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
            ),
          ],
          { type: "application/pdf" },
        ),
        "certificat.pdf",
      );
      const ev = await appFetch(
        `${APP_URL}/api/absence-findings/${fid}/evidence`,
        { method: "POST", headers: { Cookie: sess.c5.cookie }, body: form },
      );
      const afterPiece = await fRow();
      const staleValid = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.ops2.cookie,
        { approve: true, note: NOTE, expected_revision: 2 },
      );
      report(
        "F3 révision demandée sur la réalisation → décision bloquée ; décision définitive « non établi » : proposition sur révision périmée refusée (finding_stale) puis acceptée ; nouvelle pièce du candidat : révision suivante, proposition annulée, validation périmée refusée",
        pAppeal.status === 409 &&
          pAppeal.body.code === "realization_review_open" &&
          stale.body.code === "finding_stale" &&
          p1.status === 200 &&
          ev.status === 200 &&
          afterPiece.revision === 3 &&
          afterPiece.status === "instruction" &&
          staleValid.status === 409,
        {
          pAppeal: pAppeal.body.code,
          stale: stale.body.code,
          p1: p1.status,
          ev: ev.status,
          rev: afterPiece.revision,
          sv: staleValid.body.code,
        },
      );
      await proofRpc("proof_17d3_expire", { p_finding: fid });
      const lateEv = new FormData();
      lateEv.append(
        "file",
        new Blob([new TextEncoder().encode("%PDF-1.4\n%%EOF\n")], {
          type: "application/pdf",
        }),
        "tard.pdf",
      );
      const late = await appFetch(
        `${APP_URL}/api/absence-findings/${fid}/evidence`,
        { method: "POST", headers: { Cookie: sess.c5.cookie }, body: lateEv },
      );
      const p2 = await prop(sess.ops, "established", 4);
      const self = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.ops.cookie,
        { approve: true, note: NOTE, expected_revision: 4 },
      );
      const supVal = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.sup.cookie,
        { approve: true, note: NOTE, expected_revision: 4 },
      );
      const offVal = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.off.cookie,
        { approve: true, note: NOTE, expected_revision: 4 },
      );
      const repBefore = await proofRpc<{
        experience_units: number;
        breach_count: number;
      }>("proof_17d3_rep", { p_type: "candidate", p_id: prof.c5 });
      const { count: suspBefore } = await serviceClient
        .from("account_suspensions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid.c5);
      const v = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.ops2.cookie,
        { approve: true, note: NOTE, expected_revision: 4 },
      );
      const v2 = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/validation`,
        sess.ops2.cookie,
        { approve: true, note: NOTE, expected_revision: 4 },
      );
      report(
        "F4 pièce après l'échéance, avant la décision : nouvel élément qui crée une révision (consigne du 2026-11-24) ; double validation : même agent, support et ops suspendu refusés ; second ops actif : constat décidé ; relance : résultat d'origine",
        late.status === 200 &&
          p2.status === 200 &&
          self.body.code === "validator_must_differ" &&
          supVal.status === 403 &&
          offVal.status === 403 &&
          v.status === 200 &&
          (v.body.result as { outcome: string }).outcome === "established" &&
          (v2.body.result as { already_decided: boolean }).already_decided ===
            true,
        {
          late: late.status,
          self: self.body.code,
          sup: supVal.status,
          off: offVal.status,
          v: v.body,
        },
      );
      const repAfter = await proofRpc<{
        experience_units: number;
        breach_count: number;
      }>("proof_17d3_rep", { p_type: "candidate", p_id: prof.c5 });
      const { count: suspAfter } = await serviceClient
        .from("account_suspensions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid.c5);
      const { data: dayRow } = await serviceClient
        .from("mission_days")
        .select("completion_source")
        .eq("mission_id", job.by.c5.missionId)
        .single();
      const readers = execSql(
        "select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%absence_findings%'",
      );
      const expected = [
        "absence_finding_check",
        "absence_finding_json",
        "admin_add_absence_finding_note",
        "submit_absence_finding_element",
        "absence_finding_touch",
        "guard_confirmation_vs_absence_finding",
        "admin_absence_findings",
        "admin_decide_absence_finding_review",
        "admin_open_absence_finding",
        "admin_propose_absence_finding",
        "admin_validate_absence_finding",
        "answer_absence_finding",
        "my_absence_findings",
        "proof_17d3_answer",
        "proof_17d3_expire",
        "proof_17d3_review",
        "protect_support_intervention_writes",
        "record_absence_finding_evidence",
        "request_absence_finding_review",
        "rt_on_absence_finding_events",
      ];
      const readerList = (
        readers.match(/[a-z0-9_]+(,[a-z0-9_]+)+/)?.[0] ?? ""
      ).split(",");
      report(
        "F5 constat « absence injustifiée établie » sans aucun effet : aucun manquement (candidate_no_show), réputation, suspension ni cycle inchangés, journée toujours non confirmée ; aucune fonction de sanction ou de réputation ne lit les constats",
        (await incidentsOf("c5")) === 0 &&
          repAfter.breach_count === repBefore.breach_count &&
          repAfter.experience_units === repBefore.experience_units &&
          suspAfter === suspBefore &&
          dayRow?.completion_source === null &&
          readerList.length > 0 &&
          readerList.every((r) => expected.includes(r)) &&
          !readerList.some((r) =>
            /reputation|sanction|cycle|sweep|suspension/.test(r),
          ),
        {
          rep: [repBefore, repAfter],
          susp: [suspBefore, suspAfter],
          readerList,
        },
      );
      // Confidentialité et recours.
      const coView = await http("GET", "/api/absence-findings", A.cookie);
      const candView = await http(
        "GET",
        `/api/absence-findings?mission_id=${job.by.c5.missionId}`,
        sess.c5.cookie,
      );
      report(
        "F6 entreprise : issue du constat sans la version, les pièces ni la note ; candidat : sa version, ses pièces et la note",
        coView.status === 200 &&
          coView.text.includes(fid) &&
          !coView.text.includes("hôpital") &&
          !/"candidate_statement"|"evidence"|"decision_note"/.test(
            coView.text,
          ) &&
          candView.status === 200 &&
          candView.text.includes("hôpital") &&
          candView.text.includes("decision_note"),
        { co: coView.status, cand: candView.status },
      );
      const closed = await proofRpc<Res>("proof_17d3_review", {
        p_actor: uid.c5,
        p_finding: fid,
        p_delta: "0",
        p_note: "Je conteste ce constat, j'étais malade.",
      });
      const inWindow = await proofRpc<Res>("proof_17d3_review", {
        p_actor: uid.c5,
        p_finding: fid,
        p_delta: "1 microsecond",
        p_note: "Je conteste ce constat, j'étais malade.",
      });
      const coReview = await http(
        "POST",
        `/api/absence-findings/${fid}/review`,
        A.cookie,
        { statement: "L'entreprise conteste aussi ce constat." },
      );
      const byProposer = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/review`,
        sess.ops.cookie,
        { outcome: "overturned", note: NOTE },
      );
      const byValidator = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/review`,
        sess.ops2.cookie,
        { outcome: "overturned", note: NOTE },
      );
      const byThird = await http(
        "POST",
        `/api/admin/absence-findings/${fid}/review`,
        sess.fnd.cookie,
        { outcome: "overturned", note: NOTE },
      );
      const reopened = await fRow();
      const { data: evts } = await serviceClient
        .from("absence_finding_events")
        .select("kind")
        .eq("finding_id", fid)
        .order("created_at");
      report(
        "F7 recours : à l'instant exact de l'échéance de 7 jours refusé, 1 µs avant reçu ; un seul recours ; proposeur et validateur ne tranchent pas ; un tiers infirme → retour à l'instruction, nouvelle double validation exigée, historique conservé",
        closed.error === "review_window_closed" &&
          inWindow.error === null &&
          coReview.status === 409 &&
          coReview.body.code === "review_already_requested" &&
          byProposer.body.code === "reviewer_must_differ" &&
          byValidator.body.code === "reviewer_must_differ" &&
          byThird.status === 200 &&
          reopened.status === "instruction" &&
          reopened.outcome === null &&
          (evts ?? []).some((e) => e.kind === "decided") &&
          (evts ?? []).some((e) => e.kind === "review_decided"),
        {
          closed: closed.error,
          inWindow: inWindow.error,
          co: coReview.body.code,
          p: byProposer.body.code,
          v: byValidator.body.code,
          t: byThird.status,
          st: reopened.status,
        },
      );
      // Silence : l'échéance passée ne décide rien.
      const silent = await serviceClient
        .from("absence_findings")
        .select("status, outcome")
        .eq("id", f6)
        .single();
      report(
        "F8 silence du candidat : échéance passée, aucune issue déduite (constat toujours en instruction, sans issue)",
        silent.data?.status === "instruction" && silent.data.outcome === null,
        silent.data,
      );
    }

    // ── G. Articulation avec la réalisation, par les vrais parcours ──
    {
      const DECISION = {
        facts_retained:
          "Faits retenus après examen des versions des deux parties.",
        elements_verified:
          "Versions, horaires et échanges vérifiés par le support.",
        contradictions: "Les parties ne s'accordent pas sur la présence.",
        justification: "Les éléments réunis fondent la proposition motivée.",
        conflict: "none",
      };
      const absenceCase = async (k: K, title: string, started: boolean) => {
        const { jobId } = await insertJobWithDays(
          serviceClient,
          {
            description: "Preuve 17d-3 (G).",
            address: "Rue Joss",
            city: "Douala",
            title,
            company_id: coA,
            mission_pay_per_candidate: 12000,
            positions_available: 1,
          },
          [{ date: nextDate(), start_time: "09:00", end_time: "17:00" }],
          "full_period",
        );
        const { data: app } = await sess[k].client.rpc("apply_to_job", {
          p_job_id: jobId,
        });
        const sel = await signAndSelectRpc(A.client, app!.id);
        const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", missionId)
          .single();
        // Journée d'hier, terminée (date de la fixture, jamais une décision).
        const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const rs = await rescheduleFixture(
          "mission_days",
          "id",
          md!.id,
          {
            scheduled_date: y,
            scheduled_start_time: "00:00",
            scheduled_end_time: "23:00",
          },
          PROOF,
        );
        if (rs.error) throw new Error(rs.error.message);
        if (started) {
          const st = await http(
            "POST",
            `/api/missions/${missionId}/start`,
            sess[k].cookie,
          );
          if (st.status !== 200)
            throw new Error(`start: ${st.text.slice(0, 200)}`);
        }
        const rep = await http(
          "POST",
          `/api/missions/${missionId}/incidents`,
          A.cookie,
          {
            mission_day_id: md!.id,
            kind: "absence",
            statement: "Le candidat ne s'est pas présenté ce jour-là.",
          },
        );
        const incidentId = (rep.body.incident as { incident_id?: string })
          ?.incident_id;
        if (!incidentId) throw new Error(`absence: ${rep.text.slice(0, 200)}`);
        const open = await http(
          "POST",
          "/api/admin/absence-findings",
          sess.sup.cookie,
          { incident_id: incidentId },
        );
        const findingId = (open.body.result as { finding_id: string })
          .finding_id;
        return { missionId, dayId: md!.id, incidentId, findingId };
      };
      const revisionOf = async (id: string) =>
        (
          await serviceClient
            .from("absence_findings")
            .select("revision")
            .eq("id", id)
            .single()
        ).data!.revision;
      const propose = async (s: Session, id: string, outcome: string) =>
        http("POST", `/api/admin/absence-findings/${id}/proposal`, s.cookie, {
          outcome,
          note: NOTE,
          expected_revision: await revisionOf(id),
        });
      const validate = async (s: Session, id: string, approve = true) =>
        http("POST", `/api/admin/absence-findings/${id}/validation`, s.cookie, {
          approve,
          note: NOTE,
          expected_revision: await revisionOf(id),
        });
      const answer = (k: K, id: string) =>
        http("POST", `/api/absence-findings/${id}/answer`, sess[k].cookie, {
          statement: "Je n'ai pas pu venir, sans prévenir à temps.",
        });
      const lot16Propose = (s: Session, incident: string, outcome: string) =>
        http("POST", `/api/admin/incidents/${incident}/proposals`, s.cookie, {
          outcome,
          ...DECISION,
        });
      const lot16Review = (s: Session, proposal: string) =>
        http(
          "POST",
          `/api/admin/incident-proposals/${proposal}/review`,
          s.cookie,
          {
            approve: true,
            note: "Seconde lecture du dossier complète.",
            conflict: "none",
          },
        );
      const proposalId = (r: HttpResult) =>
        String((r.body.result as { proposal_id?: string })?.proposal_id ?? "");

      // G1 Sans contestation ni dossier du lot 16 : parcours propre.
      const g1 = await absenceCase("c1", "Plonge (G1)", false);
      await answer("c1", g1.findingId);
      const g1p = await propose(sess.fnd, g1.findingId, "established");
      const g1v = await validate(sess.ops, g1.findingId);
      const { count: g1decisions } = await serviceClient
        .from("mission_incident_decisions")
        .select("id", { count: "exact", head: true })
        .eq("incident_id", g1.incidentId);
      report(
        "G1 aucune contestation sur la réalisation et aucun dossier du lot 16 décidé : le constat suit son propre parcours (version, proposition, seconde validation) jusqu'à la décision",
        g1p.status === 200 &&
          g1v.status === 200 &&
          (g1v.body.result as { outcome: string }).outcome === "established" &&
          g1decisions === 0,
        {
          g1p: g1p.body.code ?? g1p.status,
          g1v: g1v.body.code ?? g1v.status,
          g1decisions,
        },
      );
      // Réciproque : constat établi en vigueur → journée non confirmable
      // (clé service comprise), même par la suite.
      const direct = await serviceClient
        .from("mission_days")
        .update({
          completion_source: "support",
          actual_end_time: new Date().toISOString(),
        })
        .eq("id", g1.dayId)
        .select("id");
      report(
        "G2 constat « absence injustifiée établie » en vigueur : confirmation de la journée refusée, même en clé service (absence_finding_established)",
        !!direct.error &&
          /absence_finding_established/.test(direct.error.message),
        { direct: direct.error?.message },
      );

      // G3 Contestation ouverte par le vrai parcours du lot 16.
      const g3 = await absenceCase("c2", "Plonge (G3)", false);
      await answer("c2", g3.findingId);
      const p16 = await lot16Propose(
        sess.ops,
        g3.incidentId,
        "not_established",
      );
      const whilePending = await propose(sess.fnd, g3.findingId, "established");
      const r16 = await lot16Review(sess.ops2, proposalId(p16));
      const inWindow = await propose(sess.fnd, g3.findingId, "established");
      const appeal = await http(
        "POST",
        `/api/incidents/${g3.incidentId}/review`,
        sess.c2.cookie,
        { statement: "Je conteste la décision sur cette journée." },
      );
      const { count: appeals } = await serviceClient
        .from("mission_incident_appeals")
        .select("id", { count: "exact", head: true })
        .eq("incident_id", g3.incidentId);
      // Échéance de révision passée (fixture d'horloge ; la décision et la
      // demande sont réelles) : la révision demandée reste ouverte.
      await proofRpc("proof_17d3_review_window", {
        p_incident: g3.incidentId,
        p_delta: "-1 second",
      });
      const appealOpen = await validate(sess.ops, g3.findingId);
      const statusG3 = (
        await serviceClient
          .from("absence_findings")
          .select("status, outcome")
          .eq("id", g3.findingId)
          .single()
      ).data;
      report(
        "G3 vrais parcours du lot 16 : proposition en attente → bloquée ; décision « non établi » dans sa fenêtre sans recours demandé → proposition du constat permise ; recours demandé non résolu → validation bloquée ; « non établi » ne décide rien (constat non décidé)",
        p16.status === 200 &&
          whilePending.body.code === "realization_review_open" &&
          r16.status === 200 &&
          inWindow.status === 200 &&
          (appeals ?? 0) >= 1 &&
          appealOpen.body.code === "realization_review_open" &&
          statusG3?.status === "proposed" &&
          statusG3.outcome === null,
        {
          p16: p16.body.code ?? p16.status,
          whilePending: whilePending.body.code,
          r16: r16.body.code ?? r16.status,
          inWindow: inWindow.body.code,
          appeal: appeal.status,
          appeals,
          appealOpen: appealOpen.body.code,
        },
      );

      // G4 Travail confirmé par les vrais parcours : aucune absence injustifiée.
      const g4 = await absenceCase("c4", "Plonge (G4)", true);
      await answer("c4", g4.findingId);
      const ambiguous = await propose(sess.fnd, g4.findingId, "established");
      const e16 = await lot16Propose(sess.ops, g4.incidentId, "established");
      const contested = await propose(sess.fnd, g4.findingId, "established");
      const v16 = await lot16Review(sess.ops2, proposalId(e16));
      const { data: g4day } = await serviceClient
        .from("mission_days")
        .select("completion_source")
        .eq("id", g4.dayId)
        .single();
      const confirmed = await propose(sess.fnd, g4.findingId, "established");
      const notImputable = await propose(
        sess.fnd,
        g4.findingId,
        "not_established",
      );
      const g4v = await validate(sess.ops, g4.findingId);
      report(
        "G4 journée commencée : « établie » refusée (realization_ambiguous) ; proposition « établi » du lot 16 en attente : bloquée ; travail confirmé par la double validation du lot 16 (journée exceptional) : « établie » refusée (work_confirmed), « non imputable » possible et validée",
        ambiguous.body.code === "realization_ambiguous" &&
          e16.status === 200 &&
          contested.body.code === "realization_review_open" &&
          v16.status === 200 &&
          g4day?.completion_source === "exceptional" &&
          confirmed.body.code === "work_confirmed" &&
          notImputable.status === 200 &&
          g4v.status === 200 &&
          (g4v.body.result as { outcome: string }).outcome ===
            "not_established",
        {
          ambiguous: ambiguous.body.code,
          e16: e16.body.code ?? e16.status,
          contested: contested.body.code,
          v16: v16.body.code ?? v16.status,
          day: g4day,
          confirmed: confirmed.body.code,
          notImputable: notImputable.body.code ?? notImputable.status,
        },
      );

      // G5 Course : validation d'un constat « établie » et début de la journée.
      const g5 = await absenceCase("c6", "Plonge (G5)", false);
      await answer("c6", g5.findingId);
      const g5p = await propose(sess.fnd, g5.findingId, "established");
      const rev5 = await revisionOf(g5.findingId);
      const [val5, start5] = await Promise.all([
        http(
          "POST",
          `/api/admin/absence-findings/${g5.findingId}/validation`,
          sess.ops.cookie,
          { approve: true, note: NOTE, expected_revision: rev5 },
        ),
        http("POST", `/api/missions/${g5.missionId}/start`, sess.c6.cookie),
      ]);
      const f5 = (
        await serviceClient
          .from("absence_findings")
          .select("status, outcome")
          .eq("id", g5.findingId)
          .single()
      ).data;
      const startFirst =
        val5.body.code === "realization_ambiguous" &&
        start5.status === 200 &&
        f5?.status === "proposed";
      const validFirst = val5.status === 200 && f5?.outcome === "established";
      // Puis le lot 16 tente de confirmer la journée : refusé si le constat est établi.
      let confirmAfter = "skipped";
      if (validFirst && start5.status === 200) {
        const e = await lot16Propose(sess.ops2, g5.incidentId, "established");
        const r = await lot16Review(sess.fnd, proposalId(e));
        confirmAfter =
          r.status === 200 ? "confirmed" : String(r.body.code ?? r.status);
      }
      const { data: d5 } = await serviceClient
        .from("mission_days")
        .select("completion_source")
        .eq("id", g5.dayId)
        .single();
      report(
        "G5 course entre la validation d'un constat « établie » et le début de la journée : une seule issue cohérente ; jamais à la fois une absence injustifiée établie et une journée confirmée",
        g5p.status === 200 &&
          (startFirst || validFirst) &&
          !(f5?.outcome === "established" && d5?.completion_source !== null) &&
          (confirmAfter === "skipped" ||
            confirmAfter === "absence_finding_established"),
        {
          val5: val5.body.code ?? val5.status,
          start5: start5.status,
          f5,
          confirmAfter,
          d5,
        },
      );
    }

    // ── H. Modalités du 2026-11-24 ──────────────────────────────
    {
      const H_NOTE = "Décision motivée du support après examen.";
      // H1 Origine des délais : notifications créées dans la transaction.
      const { jobId: hj } = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-3 (H).",
          address: "Rue Joss",
          city: "Douala",
          title: "Plonge (H1)",
          company_id: coA,
          mission_pay_per_candidate: 12000,
          positions_available: 1,
        },
        [{ date: nextDate(), start_time: "09:00", end_time: "17:00" }],
        "full_period",
      );
      const { data: happ } = await sess.c3.client.rpc("apply_to_job", {
        p_job_id: hj,
      });
      const hsel = await signAndSelectRpc(A.client, happ!.id);
      const hm = (hsel.data as { mission_id: string }[])[0].mission_id;
      const { data: hd } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("mission_id", hm)
        .single();
      const yh = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await rescheduleFixture(
        "mission_days",
        "id",
        hd!.id,
        {
          scheduled_date: yh,
          scheduled_start_time: "00:00",
          scheduled_end_time: "23:00",
        },
        PROOF,
      );
      const hrep = await http(
        "POST",
        `/api/missions/${hm}/incidents`,
        A.cookie,
        {
          mission_day_id: hd!.id,
          kind: "absence",
          statement: "Le candidat ne s'est pas présenté ce jour-là.",
        },
      );
      const hinc = (hrep.body.incident as { incident_id: string }).incident_id;
      const hopen = await http(
        "POST",
        "/api/admin/absence-findings",
        sess.sup.cookie,
        { incident_id: hinc },
      );
      const hf = (hopen.body.result as { finding_id: string }).finding_id;
      const hRow = async () =>
        (
          await serviceClient
            .from("absence_findings")
            .select("*")
            .eq("id", hf)
            .single()
        ).data!;
      const r0 = await hRow();
      const { data: n0 } = await serviceClient
        .from("notifications")
        .select("id, user_id, created_at, is_read, read_at")
        .eq("id", r0.candidate_notification_id!)
        .single();
      const ms = (x: string | null | undefined) => (x ? Date.parse(x) : NaN);
      report(
        "H1 72 h à compter de la notification d'ouverture au candidat, créée dans la même transaction (instant identique) ; notification non lue",
        !!n0 &&
          n0.user_id === uid.c3 &&
          ms(n0.created_at) === ms(r0.candidate_notified_at) &&
          ms(r0.opened_at) === ms(r0.candidate_notified_at) &&
          ms(r0.candidate_due_at) - ms(r0.candidate_notified_at) ===
            72 * 3600_000 &&
          n0.is_read === false &&
          n0.read_at === null,
        { n0, notified: r0.candidate_notified_at, due: r0.candidate_due_at },
      );
      // H2 Support : instruit (note), ne propose ni ne valide.
      const supNote = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/notes`,
        sess.sup.cookie,
        { note: "Appel du candidat tenté, sans réponse." },
      );
      const coNote = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/notes`,
        A.cookie,
        { note: "Note de l'entreprise refusée." },
      );
      const offNote = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/notes`,
        sess.off.cookie,
        { note: "Note d'un ops suspendu refusée." },
      );
      await http("POST", `/api/absence-findings/${hf}/answer`, sess.c3.cookie, {
        statement: "J'avais un empêchement familial ce jour-là.",
      });
      const rev1 = (await hRow()).revision;
      const supProp = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/proposal`,
        sess.sup.cookie,
        { outcome: "not_established", note: H_NOTE, expected_revision: rev1 },
      );
      const p1 = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/proposal`,
        sess.fnd.cookie,
        { outcome: "not_established", note: H_NOTE, expected_revision: rev1 },
      );
      const supVal = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/validation`,
        sess.sup.cookie,
        { approve: true, note: H_NOTE, expected_revision: rev1 },
      );
      report(
        "H2 admin_support instruit (note d'instruction) sans proposer ni valider ; entreprise et ops suspendu refusés",
        supNote.status === 200 &&
          coNote.status === 403 &&
          offNote.status === 403 &&
          supProp.status === 403 &&
          p1.status === 200 &&
          supVal.status === 403,
        {
          supNote: supNote.status,
          coNote: coNote.status,
          offNote: offNote.status,
          supProp: supProp.status,
          supVal: supVal.status,
        },
      );
      const v1 = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/validation`,
        sess.ops.cookie,
        { approve: true, note: H_NOTE, expected_revision: rev1 },
      );
      const r1 = await hRow();
      const { data: n1 } = await serviceClient
        .from("notifications")
        .select("id, user_id, created_at, is_read, body")
        .eq("id", r1.decision_notification_id!)
        .single();
      const coDecision =
        (
          await serviceClient
            .from("notifications")
            .select("body, data")
            .eq("user_id", idA)
        ).data?.filter(
          (x) => (x.data as { finding_id?: string } | null)?.finding_id === hf,
        ) ?? [];
      report(
        "H3 « absence injustifiée non établie » : 7 jours de recours à compter de la notification de la décision au candidat, créée dans la même transaction ; non lue ; candidat et entreprise informés que l'issue ne confirme ni le travail ni un droit au paiement",
        v1.status === 200 &&
          (v1.body.result as { outcome: string }).outcome ===
            "not_established" &&
          !!n1 &&
          n1.user_id === uid.c3 &&
          ms(n1.created_at) === ms(r1.decision_notified_at) &&
          ms(r1.decided_at) === ms(r1.decision_notified_at) &&
          ms(r1.review_deadline) - ms(r1.decision_notified_at) ===
            7 * 86_400_000 &&
          n1.is_read === false &&
          /non établie/.test(n1.body) &&
          /ne confirme ni le travail ni un droit au paiement/.test(n1.body) &&
          coDecision.some((x) =>
            /ne confirme ni le travail ni un droit au paiement/.test(x.body),
          ),
        {
          v1: v1.body.code ?? v1.status,
          n1: n1?.created_at,
          notified: r1.decision_notified_at,
          deadline: r1.review_deadline,
        },
      );
      // H4 Nouveaux éléments : ni infirmation, ni réouverture, ni délai.
      const before = await hRow();
      const eCand = await http(
        "POST",
        `/api/absence-findings/${hf}/elements`,
        sess.c3.cookie,
        { text: "Attestation de l'empêchement familial disponible." },
      );
      const eCo = await http(
        "POST",
        `/api/absence-findings/${hf}/elements`,
        A.cookie,
        { text: "Nous maintenons que le candidat était absent." },
      );
      const eOther = await http(
        "POST",
        `/api/absence-findings/${hf}/elements`,
        sess.c1.cookie,
        { text: "Élément d'un tiers refusé par la base." },
      );
      const form = new FormData();
      form.append(
        "file",
        new Blob([new TextEncoder().encode("%PDF-1.4\n%%EOF\n")], {
          type: "application/pdf",
        }),
        "attestation.pdf",
      );
      const eFile = await appFetch(
        `${APP_URL}/api/absence-findings/${hf}/evidence`,
        { method: "POST", headers: { Cookie: sess.c3.cookie }, body: form },
      );
      const after = await hRow();
      const { data: elems } = await serviceClient
        .from("absence_finding_events")
        .select("kind, actor_role")
        .eq("finding_id", hf)
        .eq("kind", "new_element");
      const coView = await http("GET", "/api/absence-findings", A.cookie);
      report(
        "H4 nouveaux éléments des deux parties (texte et pièce) après la décision : constat, issue, révision et échéance de recours inchangés ; tiers refusé ; l'entreprise ne voit pas les éléments du candidat",
        eCand.status === 200 &&
          eCo.status === 200 &&
          eOther.status === 404 &&
          eFile.status === 200 &&
          after.status === before.status &&
          after.outcome === before.outcome &&
          after.revision === before.revision &&
          after.review_deadline === before.review_deadline &&
          (elems ?? []).length === 3 &&
          !coView.text.includes("empêchement familial"),
        {
          eCand: eCand.status,
          eCo: eCo.status,
          eOther: eOther.status,
          eFile: eFile.status,
          elems: elems?.length,
        },
      );
      // H5 Recours de l'entreprise, infirmation par un tiers, nouvelle décision :
      // toutes les décisions sont conservées.
      const rq = await http(
        "POST",
        `/api/absence-findings/${hf}/review`,
        A.cookie,
        { statement: "L'entreprise conteste cette conclusion." },
      );
      const ov = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/review`,
        sess.ops2.cookie,
        { outcome: "overturned", note: H_NOTE },
      );
      const rev2 = (await hRow()).revision;
      await http(
        "POST",
        `/api/admin/absence-findings/${hf}/proposal`,
        sess.fnd.cookie,
        { outcome: "not_established", note: H_NOTE, expected_revision: rev2 },
      );
      const v2 = await http(
        "POST",
        `/api/admin/absence-findings/${hf}/validation`,
        sess.ops2.cookie,
        { approve: true, note: H_NOTE, expected_revision: rev2 },
      );
      const adm = await http(
        "GET",
        "/api/admin/absence-findings",
        sess.sup.cookie,
      );
      const mine = (
        (adm.body.findings as {
          id: string;
          decisions: { kind: string; outcome: string }[];
        }[]) ?? []
      ).find((x) => x.id === hf);
      const { data: decidedEvents } = await serviceClient
        .from("absence_finding_events")
        .select("data")
        .eq("finding_id", hf)
        .eq("kind", "decided")
        .order("created_at");
      report(
        "H5 recours de l'entreprise, infirmation par un agent distinct, nouvelle décision : décisions successives conservées (décidé, recours infirmé, décidé), notes et validateurs d'origine gardés",
        rq.status === 200 &&
          ov.status === 200 &&
          v2.status === 200 &&
          JSON.stringify((mine?.decisions ?? []).map((d) => d.kind)) ===
            JSON.stringify(["decided", "review_decided", "decided"]) &&
          (decidedEvents ?? []).length === 2 &&
          (decidedEvents ?? []).every(
            (e) => (e.data as { note?: string }).note === H_NOTE,
          ),
        {
          rq: rq.status,
          ov: ov.status,
          v2: v2.body.code ?? v2.status,
          decisions: mine?.decisions,
        },
      );

      // H6 Réexamen d'un refus de retrait ciblé.
      const job = await fullPeriod(["c1", "c2"], 3, "Hôtesses (réexamen)");
      const d1 = job.by.c1.dayIds;
      const orig = reqIdOf(await removal(job.jobId, [d1[0], d1[1]]));
      const refused = await decide(sess.ops, orig, "refuse", []);
      const short = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        A.cookie,
        { request_id: randomUUID(), reason: "court" },
      );
      const other = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        sess.b.cookie,
        { request_id: randomUUID(), reason: REASON },
      );
      const rqId = randomUUID();
      const rx = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        A.cookie,
        {
          request_id: rqId,
          reason: "Nouveaux éléments : le poste a été supprimé.",
        },
      );
      const rxReplay = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        A.cookie,
        {
          request_id: rqId,
          reason: "Nouveaux éléments : le poste a été supprimé.",
        },
      );
      const rxDup = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        A.cookie,
        {
          request_id: randomUUID(),
          reason: "Deuxième demande de réexamen simultanée.",
        },
      );
      const rxId = reqIdOf(rx);
      const origRow = await reqRow(orig);
      const rxRow = await reqRow(rxId);
      report(
        "H6 réexamen motivé d'un refus : motif obligatoire, autre entreprise refusée ; nouvelle demande liée (relance idempotente, une seule en attente), demande initiale et refus conservés ; aucune annulation automatique",
        refused.status === 200 &&
          short.status === 400 &&
          other.status === 404 &&
          rx.status === 200 &&
          (rxReplay.body.result as { already_recorded: boolean })
            .already_recorded === true &&
          rxDup.status === 409 &&
          rxDup.body.code === "reexamination_exists" &&
          origRow.status === "refused" &&
          !!origRow.decision_note &&
          rxRow.reexamination_of === orig &&
          rxRow.status === "pending" &&
          Object.keys(await cancelledBy(d1)).length === 0,
        {
          short: short.body.code,
          other: other.status,
          rx: rx.status,
          dup: rxDup.body.code,
          origRow: origRow.status,
        },
      );
      const notRefused = await http(
        "POST",
        `/api/removal-requests/${rxId}/review`,
        A.cookie,
        {
          request_id: randomUUID(),
          reason: "Réexamen d'une demande non refusée.",
        },
      );
      // Franchissement du début pendant le traitement : la 1re journée
      // commence, la décision ne peut porter que sur la 2e.
      const crossed = await proofRpc<Res>("proof_17d3_decide", {
        p_actor: idFnd,
        p_id: rxId,
        p_decision: "accept",
        p_days: [d1[0], d1[1]],
        p_note: H_NOTE,
        p_shift: d1[0],
        p_delta: "-1 second",
      });
      const stillPending = (await reqRow(rxId)).status;
      const accepted = await decide(sess.fnd, rxId, "accept", [d1[1]]);
      const byAfter = await cancelledBy(d1);
      report(
        "H7 réexamen d'une demande non refusée refusé ; début franchi pendant le traitement : décision sur cette journée refusée (day_already_begun) sans effet ; décision du fondateur sur la journée restante : annulation par l'entreprise ; refus initial toujours conservé",
        notRefused.status === 409 &&
          notRefused.body.code === "request_not_refused" &&
          crossed.error === "day_already_begun" &&
          stillPending === "pending" &&
          accepted.status === 200 &&
          byAfter[d1[1]] === "company" &&
          !byAfter[d1[0]] &&
          (await reqRow(orig)).status === "refused",
        {
          notRefused: notRefused.body.code,
          crossed: crossed.error,
          accepted: accepted.body.code ?? accepted.status,
          byAfter,
        },
      );
    }

    // ── I. Points finalisés (élément pendant l'instruction, plafonds, réexamens) ──
    {
      const I_NOTE = "Décision motivée après relecture complète.";
      const newCase = async (k: K, title: string) => {
        const { jobId } = await insertJobWithDays(
          serviceClient,
          {
            description: "Preuve 17d-3 (I).",
            address: "Rue Joss",
            city: "Douala",
            title,
            company_id: coA,
            mission_pay_per_candidate: 12000,
            positions_available: 1,
          },
          [{ date: nextDate(), start_time: "09:00", end_time: "17:00" }],
          "full_period",
        );
        const { data: app } = await sess[k].client.rpc("apply_to_job", {
          p_job_id: jobId,
        });
        const sel = await signAndSelectRpc(A.client, app!.id);
        const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", missionId)
          .single();
        const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        await rescheduleFixture(
          "mission_days",
          "id",
          md!.id,
          {
            scheduled_date: y,
            scheduled_start_time: "00:00",
            scheduled_end_time: "23:00",
          },
          PROOF,
        );
        const rep = await http(
          "POST",
          `/api/missions/${missionId}/incidents`,
          A.cookie,
          {
            mission_day_id: md!.id,
            kind: "absence",
            statement: "Le candidat ne s'est pas présenté ce jour-là.",
          },
        );
        const inc = (rep.body.incident as { incident_id: string }).incident_id;
        const open = await http(
          "POST",
          "/api/admin/absence-findings",
          sess.sup.cookie,
          { incident_id: inc },
        );
        const id = (open.body.result as { finding_id: string }).finding_id;
        // 72 h écoulées, sans réponse (horloge seule).
        await proofRpc("proof_17d3_expire", { p_finding: id });
        return id;
      };
      const row = async (id: string) =>
        (
          await serviceClient
            .from("absence_findings")
            .select("status, revision, proposal_revision, outcome")
            .eq("id", id)
            .single()
        ).data!;
      const elements = async (id: string) =>
        (
          await serviceClient
            .from("absence_finding_events")
            .select("kind, actor_role, data")
            .eq("finding_id", id)
            .eq("kind", "new_element")
        ).data ?? [];
      const prop = async (id: string) =>
        http(
          "POST",
          `/api/admin/absence-findings/${id}/proposal`,
          sess.fnd.cookie,
          {
            outcome: "not_established",
            note: I_NOTE,
            expected_revision: (await row(id)).revision,
          },
        );

      // I1 Texte de l'entreprise après les 72 h, avant la décision.
      const f1 = await newCase("c1", "Plonge (I1)");
      await prop(f1);
      const read = (await row(f1)).revision;
      const el = await http(
        "POST",
        `/api/absence-findings/${f1}/elements`,
        A.cookie,
        { text: "Nouveau témoignage du chef d'équipe." },
      );
      const afterEl = await row(f1);
      const stale = await http(
        "POST",
        `/api/admin/absence-findings/${f1}/validation`,
        sess.ops.cookie,
        { approve: true, note: I_NOTE, expected_revision: read },
      );
      const p2 = await prop(f1);
      const ok = await http(
        "POST",
        `/api/admin/absence-findings/${f1}/validation`,
        sess.ops.cookie,
        {
          approve: true,
          note: I_NOTE,
          expected_revision: (await row(f1)).revision,
        },
      );
      report(
        "I1 élément reçu après les 72 h mais avant la décision : révision suivante, proposition antérieure périmée ; seconde validation de l'ancienne version refusée (finding_stale, relecture) ; nouvelle proposition puis validation acceptées",
        el.status === 200 &&
          afterEl.revision === read + 1 &&
          afterEl.status === "instruction" &&
          stale.status === 409 &&
          stale.body.code === "finding_stale" &&
          p2.status === 200 &&
          ok.status === 200,
        {
          el: el.status,
          read,
          after: afterEl,
          stale: stale.body.code,
          ok: ok.body.code ?? ok.status,
        },
      );
      // I2 Pièce du candidat après les 72 h : même effet.
      const f2 = await newCase("c2", "Plonge (I2)");
      await prop(f2);
      const read2 = (await row(f2)).revision;
      const form = new FormData();
      form.append(
        "file",
        new Blob([new TextEncoder().encode("%PDF-1.4\n%%EOF\n")], {
          type: "application/pdf",
        }),
        "piece.pdf",
      );
      const up = await appFetch(
        `${APP_URL}/api/absence-findings/${f2}/evidence`,
        { method: "POST", headers: { Cookie: sess.c2.cookie }, body: form },
      );
      const stale2 = await http(
        "POST",
        `/api/admin/absence-findings/${f2}/validation`,
        sess.ops.cookie,
        { approve: true, note: I_NOTE, expected_revision: read2 },
      );
      report(
        "I2 pièce du candidat après les 72 h, avant la décision : révision suivante, ancienne version refusée à la seconde validation, aucun délai prolongé",
        up.status === 200 &&
          (await row(f2)).revision === read2 + 1 &&
          stale2.body.code === "finding_stale",
        { up: up.status, stale2: stale2.body.code },
      );
      // I3 Course dépôt / seconde validation, chaque ordre imposé par la
      // barrière du lot 11 (déclencheur ralenti, puis attente observée).
      await installBarrier(execSql, serviceRpc);
      // Dépôt d'abord : le dépôt tient le dossier pendant l'écriture de
      // l'élément ; la validation attend puis lit la nouvelle révision.
      const fa = await newCase("c3", "Plonge (I3a)");
      await prop(fa);
      const ra = (await row(fa)).revision;
      execSql(`create or replace function public.proof_17d3_slow_element() returns trigger language plpgsql as $$ begin
        if new.finding_id = '${fa}'::uuid and new.kind = 'new_element' then perform pg_sleep(1.5); end if; return new; end $$`);
      execSql(
        "create trigger proof_17d3_slow_element before insert on public.absence_finding_events for each row execute function public.proof_17d3_slow_element()",
      );
      const depA = http(
        "POST",
        `/api/absence-findings/${fa}/elements`,
        A.cookie,
        { text: "Élément concurrent déposé en premier." },
      );
      await waitSleeping(serviceRpc);
      const valA = await http(
        "POST",
        `/api/admin/absence-findings/${fa}/validation`,
        sess.ops.cookie,
        { approve: true, note: I_NOTE, expected_revision: ra },
      );
      const depAres = await depA;
      execSql(
        "drop trigger if exists proof_17d3_slow_element on public.absence_finding_events",
      );
      const finA = await row(fa);
      const elsA = await elements(fa);
      // Décision d'abord : la validation tient le dossier pendant sa mise à
      // jour ; le dépôt attend puis s'ajoute après la décision.
      const fb = await newCase("c4", "Plonge (I3b)");
      await prop(fb);
      const rb = (await row(fb)).revision;
      execSql(`create or replace function public.proof_17d3_slow_decision() returns trigger language plpgsql as $$ begin
        if new.id = '${fb}'::uuid and new.status = 'decided' and old.status <> 'decided' then perform pg_sleep(1.5); end if; return new; end $$`);
      execSql(
        "create trigger proof_17d3_slow_decision before update on public.absence_findings for each row execute function public.proof_17d3_slow_decision()",
      );
      const valB = http(
        "POST",
        `/api/admin/absence-findings/${fb}/validation`,
        sess.ops.cookie,
        { approve: true, note: I_NOTE, expected_revision: rb },
      );
      await waitSleeping(serviceRpc);
      const depB = await http(
        "POST",
        `/api/absence-findings/${fb}/elements`,
        A.cookie,
        { text: "Élément concurrent déposé après la décision." },
      );
      const valBres = await valB;
      execSql(
        "drop trigger if exists proof_17d3_slow_decision on public.absence_findings",
      );
      dropBarrier(execSql);
      const finB = await row(fb);
      const elsB = await elements(fb);
      report(
        "I3 courses imposées : dépôt enregistré avant la décision → ancienne proposition refusée (finding_stale), élément conservé ; décision enregistrée avant le dépôt → constat décidé, élément conservé après la décision ; aucun élément perdu",
        depAres.status === 200 &&
          valA.body.code === "finding_stale" &&
          finA.status === "instruction" &&
          finA.revision === ra + 1 &&
          elsA.length === 1 &&
          valBres.status === 200 &&
          depB.status === 200 &&
          finB.status === "decided" &&
          elsB.length === 1 &&
          (elsB[0].data as { after_decision?: boolean }).after_decision ===
            true,
        {
          valA: valA.body.code ?? valA.status,
          finA,
          valB: valBres.body.code ?? valBres.status,
          finB,
          elsB: elsB.map((e) => e.data),
        },
      );
      // I4 Aucun plafond cumulatif : 12 textes et 6 pièces d'une même partie.
      const f4 = await newCase("c5", "Plonge (I4)");
      const texts = [];
      for (let i = 0; i < 12; i++)
        texts.push(
          await http("POST", `/api/absence-findings/${f4}/elements`, A.cookie, {
            text: `Élément numéro ${i + 1} de l'entreprise.`,
          }),
        );
      const files = [];
      for (let i = 0; i < 6; i++) {
        const fd = new FormData();
        fd.append(
          "file",
          new Blob([new TextEncoder().encode(`%PDF-1.4\n% ${i}\n%%EOF\n`)], {
            type: "application/pdf",
          }),
          `p${i}.pdf`,
        );
        files.push(
          await appFetch(`${APP_URL}/api/absence-findings/${f4}/evidence`, {
            method: "POST",
            headers: { Cookie: A.cookie },
            body: fd,
          }),
        );
      }
      const bad = new FormData();
      bad.append(
        "file",
        new Blob(["pas un document"], { type: "text/plain" }),
        "x.txt",
      );
      const badType = await appFetch(
        `${APP_URL}/api/absence-findings/${f4}/evidence`,
        { method: "POST", headers: { Cookie: A.cookie }, body: bad },
      );
      report(
        "I4 aucun plafond cumulatif : 12 textes et 6 pièces d'une même partie acceptés ; contrôle technique du format conservé (fichier texte refusé)",
        texts.every((x) => x.status === 200) &&
          files.every((x) => x.status === 200) &&
          (await elements(f4)).length === 18 &&
          badType.status === 400,
        {
          texts: texts.map((x) => x.status),
          files: files.map((x) => x.status),
          badType: badType.status,
        },
      );
      // I5 Réexamens : un seul par refus, même en concurrence ; refus
      // successifs (réexamen d'un réexamen refusé) : non limités, non décidés.
      const job = await fullPeriod(["c1"], 2, "Hôtesse (réexamens)");
      const days = job.by.c1.dayIds;
      const orig = reqIdOf(await removal(job.jobId, days));
      await decide(sess.ops, orig, "refuse", []);
      const [x1, x2] = await Promise.all([
        http("POST", `/api/removal-requests/${orig}/review`, A.cookie, {
          request_id: randomUUID(),
          reason: "Premier réexamen, nouveaux éléments.",
        }),
        http("POST", `/api/removal-requests/${orig}/review`, A.cookie, {
          request_id: randomUUID(),
          reason: "Second réexamen simultané du même refus.",
        }),
      ]);
      const { count: reexams } = await serviceClient
        .from("engagement_requests")
        .select("id", { count: "exact", head: true })
        .eq("reexamination_of", orig);
      const first = [x1, x2].find((x) => x.status === 200)!;
      const rx = reqIdOf(first);
      await decide(sess.fnd, rx, "refuse", []);
      const again = await http(
        "POST",
        `/api/removal-requests/${orig}/review`,
        A.cookie,
        {
          request_id: randomUUID(),
          reason: "Troisième demande sur le même refus.",
        },
      );
      const chain = await http(
        "POST",
        `/api/removal-requests/${rx}/review`,
        A.cookie,
        { request_id: randomUUID(), reason: "Réexamen du réexamen refusé." },
      );
      report(
        "I5 un même refus ne produit qu'une demande de réexamen, y compris en concurrence (reexamination_exists, contrôle serveur) ; réexamen d'un réexamen refusé : accepté en base, nombre non décidé (non limité)",
        [x1, x2].filter((x) => x.status === 200).length === 1 &&
          [x1, x2].some(
            (x) =>
              x.body.code === "reexamination_exists" ||
              x.body.code === "removal_already_requested",
          ) &&
          reexams === 1 &&
          again.status === 409 &&
          again.body.code === "reexamination_exists" &&
          chain.status === 200,
        {
          x: [x1.body.code ?? x1.status, x2.body.code ?? x2.status],
          reexams,
          again: again.body.code,
          chain: chain.status,
        },
      );
    }

    // ── D. Tables et fonctions fermées ────────────────────────
    {
      const tables = [
        "engagement_requests",
        "engagement_request_days",
        "support_cancellations",
        "support_cancellation_days",
        "absence_findings",
        "absence_finding_events",
      ];
      const res = await Promise.all(
        tables.map(async (t) => {
          const sel = await A.client.from(t as never).select("*");
          const ins = await serviceClient
            .from(t as "absence_findings")
            .insert({} as never)
            .select("*");
          // Colonne réelle de chaque table, sur des lignes existantes : seule
          // la protection (privilège ou déclencheur) peut refuser.
          const target: Record<string, [string, Record<string, unknown>]> = {
            engagement_requests: [
              "decision_note",
              { decision_note: "Note modifiée hors décision." },
            ],
            engagement_request_days: [
              "mission_day_id",
              { starts_at: new Date().toISOString() },
            ],
            support_cancellations: ["id", { day_count: 99 }],
            support_cancellation_days: [
              "mission_day_id",
              { starts_at: new Date().toISOString() },
            ],
            absence_findings: ["id", { revision: 99 }],
            absence_finding_events: ["id", { kind: "altered" }],
          };
          const [key, values] = target[t];
          const upd = await serviceClient
            .from(t as "absence_findings")
            .update(values as never)
            .not(key as "id", "is", null)
            .select("*");
          return { t, sel: !!sel.error, ins: !!ins.error, upd: !!upd.error };
        }),
      );
      const fns = execSql(
        "select string_agg(p.proname || '=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('support_day_state','suspension_covers_day','absence_realization_state','absence_finding_touch','record_absence_finding_evidence','admin_decide_engagement_request','request_targeted_removal')",
      );
      report(
        "D1 nouvelles tables fermées aux sessions ; insertion et modification refusées en clé service ; fonctions internes non exécutables en session",
        res.every((r) => r.sel && r.ins && r.upd) &&
          /absence_finding_touch=false/.test(fns) &&
          /absence_realization_state=false/.test(fns) &&
          /record_absence_finding_evidence=false/.test(fns) &&
          /support_day_state=false/.test(fns) &&
          /suspension_covers_day=false/.test(fns) &&
          /admin_decide_engagement_request=true/.test(fns) &&
          /request_targeted_removal=true/.test(fns),
        { res, fns: fns.match(/[a-z_]+=\w+(,[a-z_]+=\w+)+/)?.[0] },
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
