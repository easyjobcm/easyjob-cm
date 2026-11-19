/**
 * Preuve lots 17b–17c — annulation par le candidat, justification,
 * manquement unique, exclusions progressives, suspensions par cause,
 * fraude présumée et montant acquis d'un forfait interrompu.
 *
 * Fixtures en clé service ; tentatives en sessions RÉELLES (routes avec
 * cookies, RPC avec le JWT) ; état relu en clé service. Instants exacts :
 * `proof_l17bc_cancel` place le début des journées à now() + décalage puis
 * appelle la vraie RPC sous l'identité du candidat, dans la même
 * transaction ; `proof_l17bc_classify` évalue le classement à un instant
 * calculé par la base (limite exacte, 1 µs après).
 *
 *   L. Limites : Free 48 h, Premium 24 h (incluses), délai de réaction
 *      jusqu'à sélection + 1 h inclus, historique sans délai opposable.
 *   A. Annulation : journées annulées tout de suite, entreprise prévenue,
 *      place libérée, motif et choix exigés hors délai, sans justificatif →
 *      manquement immédiat.
 *   M. Journées mixtes : un seul événement, un seul manquement ; envoi de
 *      pièce échoué → toujours en attente ; décision refusée puis recours
 *      (agent distinct) ; décision acceptée ; relances et concurrence.
 *   R. Courses : début et annulation simultanés, réalisation bloquée sur une
 *      journée annulée, journée commencée ou débutée non annulable,
 *      signalement d'absence et absence sanctionnée refusés.
 *   X. Exclusions : 3 manquements → 6 mois, autre cause (admin) maintenue à
 *      l'échéance, dossier ancien décidé tard hors cycle, 3 nouveaux → 1 an,
 *      3 nouveaux → définitive, recours qui annule un manquement retenu.
 *   F. Fraude : signalement (support), suspension par ops, contestation,
 *      levée ; support sans pouvoir de suspension.
 *   P. Prorata : 60 000 XAF sur 8 h, 6 h (nuit) et 6 h → 42 000 ; arrondi ;
 *      journée partielle provisoire ; contrat inchangé.
 *   C. Droits et confidentialité : entreprise sans classement ni plan,
 *      tables fermées, support en lecture seule, admin suspendu refusé,
 *      signaux {d, r, id}.
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

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L17bc-cancel-01!";
const PROOF_USER_METADATA = { proofCandidateCancellations: true };

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "candidate-cancellations" });
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

// ─── Fonctions temporaires (pile de preuve) ───────────────────────
const FUNCTIONS: Record<string, string> = {
  // Début des journées à now() + décalage, puis demande sous l'identité du
  // candidat, dans la même transaction.
  "proof_l17bc_cancel(uuid, uuid, uuid[], interval[], text, text)": `
create or replace function public.proof_l17bc_cancel(
  p_actor uuid, p_request uuid, p_days uuid[], p_offsets interval[],
  p_reason text, p_choice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb; v_err text; i integer;
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  for i in 1 .. coalesce(cardinality(p_offsets), 0) loop
    update public.mission_days d
    set starts_at = now() + p_offsets[i], ends_at = now() + p_offsets[i] + interval '6 hours'
    where d.id = p_days[i];
  end loop;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.request_candidate_cancellation(
      p_request, p_days, p_reason, null, p_choice) x;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res,
    'classes', (select jsonb_agg(cd.classification order by cd.starts_at)
                from public.candidate_cancellation_days cd
                where cd.mission_day_id = any (p_days)));
end $$`,
  // Classement à un instant exact, calculé par la base.
  "proof_l17bc_classify(uuid, text, interval)": `
create or replace function public.proof_l17bc_classify(p_day uuid, p_base text, p_delta interval)
returns text language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz; v_t public.mission_day_commitment_terms; v_d public.mission_days;
begin
  select * into v_t from public.mission_day_commitment_terms where mission_day_id = p_day;
  select * into v_d from public.mission_days where id = p_day;
  v_at := case p_base
    when 'deadline' then v_d.starts_at - make_interval(hours => v_t.cancellation_notice_hours)
    when 'reaction' then v_t.selected_at + interval '1 hour' end + p_delta;
  return (select k.classification from public.classify_cancellation_day(p_day, v_at) k);
end $$`,
  // Début d'une journée placé relativement à un repère (sélection).
  "proof_l17bc_shift(uuid, text, interval)": `
create or replace function public.proof_l17bc_shift(p_day uuid, p_base text, p_delta interval)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  v_at := case p_base when 'selected' then
            (select t.selected_at from public.mission_day_commitment_terms t where t.mission_day_id = p_day)
          else now() end + p_delta;
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d set starts_at = v_at, ends_at = v_at + interval '6 hours' where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  return v_at;
end $$`,
  // Journée confirmée par code (fixture de réalisation).
  "proof_l17bc_complete(uuid)": `
create or replace function public.proof_l17bc_complete(p_day uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d
  set starts_at = now() - interval '10 hours', ends_at = now() - interval '2 hours',
      actual_start_time = now() - interval '9 hours', actual_end_time = now() - interval '1 hour',
      completion_source = 'code'
  where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
end $$`,
  // Conditions retirées : engagement antérieur au lot 17a.
  "proof_l17bc_legacy(uuid)": `
create or replace function public.proof_l17bc_legacy(p_day uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mission_day_commitment_terms t where t.mission_day_id = p_day;
  perform public.mark_legacy_commitment_terms();
end $$`,
  // Fin d'une suspension placée dans le passé (échéance atteinte).
  "proof_l17bc_end_suspension(uuid)": `
create or replace function public.proof_l17bc_end_suspension(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.account_suspensions s
  set starts_at = now() - interval '400 days', ends_at = now() - interval '1 millisecond'
  where s.id = p_id;
end $$`,
  // Sélection antidatée de 3 jours (fixture) : sans elle, une journée
  // proche d'une sélection récente est toujours dans le délai de réaction.
  "proof_l17bc_age(uuid[])": `
create or replace function public.proof_l17bc_age(p_days uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_day_commitment_terms disable trigger trg_protect_mission_day_commitment_terms;
  update public.mission_day_commitment_terms t set selected_at = t.selected_at - interval '3 days'
  where t.mission_day_id = any (p_days);
  alter table public.mission_day_commitment_terms enable trigger trg_protect_mission_day_commitment_terms;
end $$`,
  "proof_l17bc_rep(uuid)": `
create or replace function public.proof_l17bc_rep(p_profile uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(r) from public.compute_reputation('candidate', p_profile) r;
$$`,
  "proof_l17bc_messages(text, timestamptz)": `
create or replace function public.proof_l17bc_messages(p_topic text, p_since timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
  from realtime.messages m where m.topic = p_topic and m.inserted_at >= p_since;
$$`,
};
const DROP_ALL = [
  ...Object.keys(FUNCTIONS).map((f) => `drop function if exists public.${f}`),
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
      niu: `M18${String(Date.now()).slice(-9)}${name.length}`,
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
      last_name: "Tchoumi",
      date_of_birth: "1995-08-09",
      city: "Douala",
      address: "Makepe, rue privée",
      latitude: 4.07,
      longitude: 9.75,
      bio: "Candidat de preuve des lots 17b–17c.",
      cni_number: `CNI18${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677181818",
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
  await serviceClient.from("account_suspensions").delete().in("user_id", ids);
  await serviceClient.from("fraud_reports").delete().in("subject_user_id", ids);
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
      .filter((u) => u.user_metadata?.proofCandidateCancellations === true)
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
  form?: FormData,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await appFetch(`${APP_URL}${url}`, {
    method,
    headers,
    body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
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

const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const pdfForm = () => {
  const f = new FormData();
  f.append(
    "file",
    new Blob([PDF], { type: "application/pdf" }),
    "certificat.pdf",
  );
  return f;
};
const badForm = () => {
  const f = new FormData();
  f.append(
    "file",
    new Blob(["pas un document"], { type: "text/plain" }),
    "x.txt",
  );
  return f;
};

const SIGNAL_KEYS = new Set(["d", "r", "id"]);
const CONTENT = {
  description: "Preuve des annulations (lots 17b–17c).",
  address: "Rue Joss",
  city: "Douala",
};

type CancelCase = {
  error: string | null;
  result: {
    cancellation_id: string;
    status: string;
    late_day_count: number;
    day_count: number;
    already_recorded: boolean;
  } | null;
  classes: string[] | null;
};
type Rep = {
  breach_count: number;
  experience_units: number;
  confirmed_count: number;
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17bc-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    const keys = [
      "cf",
      "cp",
      "cr",
      "cm",
      "ce",
      "cl",
      "ck",
      "cx",
      "cz",
      "cn",
      "t",
    ] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const uidList = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idOps2 = await createAccount(mail("ops2"), "admin_ops");
    const idFnd = await createAccount(mail("fnd"), "admin_founder");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("off"), "admin_ops");
    ids.push(idA, ...uidList, idOps, idOps2, idFnd, idSup, idOff);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, uidList[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Hôtel Akwa Palace");
    const prof = Object.fromEntries(
      await Promise.all(
        keys.map(async (k) => [
          k,
          await createCandidate(uid[k], k.toUpperCase()),
        ]),
      ),
    ) as Record<K, string>;
    // Premium actif pour CP (rôle et fin future), avant la sélection.
    await serviceClient
      .from("users")
      .update({ role: "candidate_premium" })
      .eq("id", uid.cp);
    await serviceClient
      .from("candidate_profiles")
      .update({
        premium_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })
      .eq("user_id", uid.cp);

    const sessionKeys = ["a", ...keys, "ops", "ops2", "fnd", "sup", "off"];
    const sess = Object.fromEntries(
      await Promise.all(
        sessionKeys.map(async (k) => [k, await realSession(mail(k))]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Fixtures d'engagements ─────────────────────────────────
    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      const d = new Date(Date.UTC(2099, 0, 1) + dayNo * 86_400_000);
      return d.toISOString().slice(0, 10);
    };
    /** Offre « journées au choix » ; le candidat est sélectionné sur chaque journée. */
    const perDay = async (k: K, n: number, title: string, pay = 9000) => {
      const days: FixtureDay[] = Array.from({ length: n }, () => ({
        date: nextDate(),
        start_time: "08:00",
        end_time: "14:00",
        pay,
        positions: 1,
      }));
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
      if (error) throw new Error(`apply days ${title}: ${error.message}`);
      const { data: apps } = await serviceClient
        .from("job_applications")
        .select("id, job_day_id")
        .eq("job_id", jobId)
        .eq("candidate_id", prof[k]);
      const missionDays: string[] = [];
      const missions: string[] = [];
      for (const jd of dayIds) {
        const app = apps!.find((a) => a.job_day_id === jd)!;
        const sel = await signAndSelectRpc(A.client, app.id);
        if (sel.error) throw new Error(`select ${title}: ${sel.error.message}`);
        const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", missionId)
          .single();
        missions.push(missionId);
        missionDays.push(md!.id);
      }
      return { jobId, dayIds: missionDays, missions, apps: apps! };
    };
    /** Offre « période complète » (journées de la liste). */
    const fullPeriod = async (
      k: K,
      days: FixtureDay[],
      pay: number,
      title: string,
    ) => {
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: coA,
          mission_pay_per_candidate: pay,
          positions_available: 1,
        },
        days,
        "full_period",
      );
      const { data: app, error } = await sess[k].client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !app) throw new Error(`apply ${title}: ${error?.message}`);
      const sel = await signAndSelectRpc(A.client, app.id);
      if (sel.error) throw new Error(`select ${title}: ${sel.error.message}`);
      const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
      const { data: md } = await serviceClient
        .from("mission_days")
        .select("id, scheduled_date")
        .eq("mission_id", missionId)
        .order("scheduled_date");
      return {
        jobId,
        missionId,
        applicationId: app.id,
        dayIds: md!.map((d) => d.id),
      };
    };
    const cancelAt = (
      k: K,
      days: string[],
      offsets: string[],
      reason: string | null,
      choice: string | null,
      request: string = randomUUID(),
    ) =>
      proofRpc<CancelCase>("proof_l17bc_cancel", {
        p_actor: uid[k],
        p_request: request,
        p_days: days,
        p_offsets: offsets,
        p_reason: reason,
        p_choice: choice,
      });
    const rep = (k: K) =>
      proofRpc<Rep>("proof_l17bc_rep", { p_profile: prof[k] });
    const cancellationOf = async (id: string) =>
      (
        await serviceClient
          .from("candidate_cancellations")
          .select("*")
          .eq("id", id)
          .single()
      ).data!;
    const incidentsOf = async (k: K) =>
      (
        await serviceClient
          .from("reputation_incidents")
          .select("id, cancellation_id, source, voided_at, occurred_at")
          .eq("subject_id", prof[k])
          .eq("kind", "candidate_late_cancellation")
      ).data ?? [];
    const suspensionsOf = async (userId: string) =>
      (
        await serviceClient
          .from("account_suspensions")
          .select("*")
          .eq("user_id", userId)
          .order("created_at")
      ).data ?? [];
    const isActive = async (userId: string) =>
      (
        await serviceClient
          .from("users")
          .select("is_active")
          .eq("id", userId)
          .single()
      ).data?.is_active;

    // ── L. Limites exactes ───────────────────────────────────────
    {
      const free = await perDay("cf", 2, "Accueil (salle A)");
      const prem = await perDay("cp", 1, "Accueil (salle B)");
      // Journées loin dans le temps : limites évaluées par la base.
      const fAt = await proofRpc<string>("proof_l17bc_classify", {
        p_day: free.dayIds[0],
        p_base: "deadline",
        p_delta: "0 seconds",
      });
      const fAfter = await proofRpc<string>("proof_l17bc_classify", {
        p_day: free.dayIds[0],
        p_base: "deadline",
        p_delta: "1 microsecond",
      });
      const pAt = await proofRpc<string>("proof_l17bc_classify", {
        p_day: prem.dayIds[0],
        p_base: "deadline",
        p_delta: "0 seconds",
      });
      const pAfter = await proofRpc<string>("proof_l17bc_classify", {
        p_day: prem.dayIds[0],
        p_base: "deadline",
        p_delta: "1 microsecond",
      });
      const { data: terms } = await serviceClient
        .from("mission_day_commitment_terms")
        .select("candidate_plan, cancellation_notice_hours")
        .in("mission_day_id", [free.dayIds[0], prem.dayIds[0]]);
      report(
        "L1 limites incluses : Free à J−48 h exactement dans le délai, 1 µs après hors délai ; Premium à J−24 h idem",
        fAt === "in_time" &&
          fAfter === "late" &&
          pAt === "in_time" &&
          pAfter === "late" &&
          terms?.some((t) => t.cancellation_notice_hours === 48) === true &&
          terms?.some((t) => t.cancellation_notice_hours === 24) === true,
        { fAt, fAfter, pAt, pAfter, terms },
      );
      // Demande réelle à la limite exacte (début = now() + 48 h) : sans sanction.
      const atLimit = await cancelAt(
        "cf",
        [free.dayIds[0]],
        ["48 hours"],
        null,
        null,
      );
      const { data: jobAfter } = await serviceClient
        .from("job_days")
        .select("positions_filled")
        .eq("job_id", free.jobId);
      const { data: appAfter } = await serviceClient
        .from("job_applications")
        .select("status")
        .eq("id", free.apps[0].id)
        .single();
      const { data: mAfter } = await serviceClient
        .from("missions")
        .select("status, cancellation_reason")
        .eq("id", free.missions[0])
        .single();
      const { data: companyNotifs } = await serviceClient
        .from("notifications")
        .select("body, data")
        .eq("user_id", idA);
      const notif = (companyNotifs ?? []).filter(
        (n) =>
          (n.data as { kind?: string } | null)?.kind ===
          "candidate_cancellation",
      );
      report(
        "A1 annulation à la limite exacte (Free, J−48 h) : sans sanction ni justificatif ; mission annulée, place libérée, entreprise prévenue sans classement ni plan",
        atLimit.error === null &&
          atLimit.result?.status === "closed_no_sanction" &&
          JSON.stringify(atLimit.classes) === JSON.stringify(["in_time"]) &&
          mAfter?.status === "cancelled" &&
          appAfter?.status === "withdrawn" &&
          (jobAfter ?? []).reduce((s, d) => s + d.positions_filled, 0) === 1 &&
          notif.length === 1 &&
          !/premium|free|48|24 h|hors délai|délai|sanction/i.test(
            notif[0].body,
          ),
        { atLimit, mAfter, appAfter, notif: notif.map((n) => n.body) },
      );
      // 1 µs après la limite : hors délai ; motif puis choix exigés.
      const noReason = await cancelAt(
        "cf",
        [free.dayIds[1]],
        ["48 hours -1 microsecond"],
        null,
        null,
      );
      const noChoice = await cancelAt(
        "cf",
        [free.dayIds[1]],
        ["48 hours -1 microsecond"],
        "illness",
        null,
      );
      const before = await rep("cf");
      const none = await cancelAt(
        "cf",
        [free.dayIds[1]],
        ["48 hours -1 microsecond"],
        "illness",
        "none",
      );
      const after = await rep("cf");
      const inc = await incidentsOf("cf");
      report(
        "A2 1 µs après J−48 h : motif exigé, puis choix exigé ; « Je n'ai pas de justificatif » → manquement immédiat (source cancellation_flow)",
        noReason.error === "reason_required" &&
          noChoice.error === "evidence_choice_required" &&
          none.result?.status === "sanctioned_no_evidence" &&
          JSON.stringify(none.classes) === JSON.stringify(["late"]) &&
          inc.length === 1 &&
          inc[0].source === "cancellation_flow" &&
          after.breach_count === before.breach_count + 1,
        {
          noReason: noReason.error,
          noChoice: noChoice.error,
          none,
          inc,
          before,
          after,
        },
      );
      const premLate = await cancelAt(
        "cp",
        [prem.dayIds[0]],
        ["24 hours"],
        null,
        null,
      );
      report(
        "L2 Premium à J−24 h exactement : sans sanction",
        premLate.result?.status === "closed_no_sanction" &&
          JSON.stringify(premLate.classes) === JSON.stringify(["in_time"]),
        premLate,
      );
    }

    {
      // Délai de réaction : sélection après le seuil personnel.
      const r = await perDay("cr", 2, "Inventaire (réaction)");
      for (const d of r.dayIds) {
        await proofRpc("proof_l17bc_shift", {
          p_day: d,
          p_base: "selected",
          p_delta: "30 hours",
        });
      }
      const atReaction = await proofRpc<string>("proof_l17bc_classify", {
        p_day: r.dayIds[0],
        p_base: "reaction",
        p_delta: "0 seconds",
      });
      const afterReaction = await proofRpc<string>("proof_l17bc_classify", {
        p_day: r.dayIds[0],
        p_base: "reaction",
        p_delta: "1 microsecond",
      });
      const res = await http(
        "POST",
        `/api/missions/${r.missions[0]}/cancellation`,
        sess.cr.cookie,
        {
          request_id: randomUUID(),
          day_ids: [r.dayIds[0]],
          reason_code: null,
          reason_text: null,
          evidence_choice: null,
        },
      );
      const rid = (
        res.body.cancellation as { cancellation_id?: string } | undefined
      )?.cancellation_id;
      const c = rid ? await cancellationOf(rid) : null;
      report(
        "L3 sélection après le seuil (Free, journée à sélection + 30 h) : sans sanction jusqu'à sélection + 1 h inclus, hors délai 1 µs après ; annulation par la route dans ce délai",
        atReaction === "reaction_window" &&
          afterReaction === "late" &&
          res.status === 200 &&
          c?.status === "closed_no_sanction",
        { atReaction, afterReaction, res: res.body },
      );
    }

    {
      // Historique : conditions inconnues → aucune sanction automatique.
      const l = await perDay("cl", 1, "Service (historique)");
      await proofRpc("proof_l17bc_legacy", { p_day: l.dayIds[0] });
      const res = await cancelAt("cl", [l.dayIds[0]], ["2 hours"], null, null);
      const { data: terms } = await serviceClient
        .from("mission_day_commitment_terms")
        .select("terms_source, candidate_plan")
        .eq("mission_day_id", l.dayIds[0])
        .single();
      report(
        "L4 engagement historique (legacy) annulé 2 h avant : classé « legacy », sans motif exigé ni sanction automatique",
        terms?.terms_source === "legacy" &&
          res.result?.status === "closed_no_sanction" &&
          JSON.stringify(res.classes) === JSON.stringify(["legacy"]) &&
          (await incidentsOf("cl")).length === 0,
        { res, terms },
      );
    }

    // ── M. Journées mixtes, pièces, décision, recours ─────────────
    {
      const m = await perDay("cm", 3, "Banquet (journées mixtes)");
      await proofRpc("proof_l17bc_age", { p_days: m.dayIds });
      const req = randomUUID();
      const mixed = await cancelAt(
        "cm",
        m.dayIds,
        ["20 hours", "30 hours", "94 hours"],
        "late_notification",
        "provided",
        req,
      );
      const id = mixed.result!.cancellation_id;
      const { count: cancelledDays } = await serviceClient
        .from("candidate_cancellation_days")
        .select("mission_day_id", { count: "exact", head: true })
        .eq("cancellation_id", id);
      report(
        "M1 trois journées (deux hors délai, une dans le délai) en une demande : un événement, journées annulées tout de suite, en attente de pièce, aucune sanction",
        mixed.result?.status === "awaiting_evidence" &&
          mixed.result?.late_day_count === 2 &&
          JSON.stringify(mixed.classes) ===
            JSON.stringify(["late", "late", "in_time"]) &&
          cancelledDays === 3 &&
          (await incidentsOf("cm")).length === 0,
        mixed,
      );
      const replay = await cancelAt(
        "cm",
        m.dayIds,
        [],
        "late_notification",
        "provided",
        req,
      );
      const conflict = await cancelAt(
        "cm",
        [m.dayIds[0]],
        [],
        "late_notification",
        "provided",
        req,
      );
      report(
        "M2 relance de la même demande : résultat d'origine ; même clé pour d'autres journées : request_conflict",
        replay.result?.already_recorded === true &&
          replay.result.cancellation_id === id &&
          conflict.error === "request_conflict",
        { replay: replay.result, conflict: conflict.error },
      );
      const bad = await http(
        "POST",
        `/api/cancellations/${id}/evidence`,
        sess.cm.cookie,
        undefined,
        badForm(),
      );
      const stillWaiting = await cancellationOf(id);
      const other = await http(
        "POST",
        `/api/cancellations/${id}/evidence`,
        sess.t.cookie,
        undefined,
        pdfForm(),
      );
      const good = await http(
        "POST",
        `/api/cancellations/${id}/evidence`,
        sess.cm.cookie,
        undefined,
        pdfForm(),
      );
      const underReview = await cancellationOf(id);
      report(
        "M3 envoi échoué (fichier invalide) : dossier toujours en attente, sans manquement ; pièce d'un tiers refusée ; pièce valide → examen",
        bad.status === 400 &&
          stillWaiting.status === "awaiting_evidence" &&
          other.status === 404 &&
          good.status === 200 &&
          underReview.status === "under_review" &&
          (await incidentsOf("cm")).length === 0,
        { bad: bad.body, other: other.body, good: good.body },
      );
      const supDecide = await http(
        "POST",
        `/api/admin/cancellations/${id}/decision`,
        sess.sup.cookie,
        {
          decision: "refused",
          note: "Le support ne décide pas.",
        },
      );
      const offDecide = await http(
        "POST",
        `/api/admin/cancellations/${id}/decision`,
        sess.off.cookie,
        {
          decision: "refused",
          note: "Ops suspendu avec un ancien jeton.",
        },
      );
      const candDecide = await sess.cm.client.rpc(
        "admin_decide_candidate_cancellation",
        {
          p_id: id,
          p_decision: "accepted",
          p_note: "Le candidat ne décide pas.",
        },
      );
      const repBefore = await rep("cm");
      const [d1, d2] = await Promise.all([
        http(
          "POST",
          `/api/admin/cancellations/${id}/decision`,
          sess.ops.cookie,
          {
            decision: "refused",
            note: "Justificatif illisible et non daté.",
          },
        ),
        http(
          "POST",
          `/api/admin/cancellations/${id}/decision`,
          sess.ops.cookie,
          {
            decision: "refused",
            note: "Justificatif illisible et non daté.",
          },
        ),
      ]);
      const repAfter = await rep("cm");
      const inc = await incidentsOf("cm");
      const swapped = await http(
        "POST",
        `/api/admin/cancellations/${id}/decision`,
        sess.fnd.cookie,
        {
          decision: "accepted",
          note: "Décision contraire après coup.",
        },
      );
      report(
        "M4 décision : support, ops suspendu et candidat refusés ; refus motivé par ops (double envoi simultané) → un seul manquement pour deux journées hors délai ; décision contraire ensuite refusée",
        supDecide.status === 403 &&
          offDecide.status === 403 &&
          candDecide.error?.message === "forbidden" &&
          d1.status === 200 &&
          d2.status === 200 &&
          inc.length === 1 &&
          inc[0].source === "support_decision" &&
          repAfter.breach_count === repBefore.breach_count + 1 &&
          swapped.status === 409 &&
          swapped.body.code === "already_decided",
        {
          d1: d1.body,
          d2: d2.body,
          inc,
          repBefore,
          repAfter,
          swapped: swapped.body,
        },
      );
      const rv = await http(
        "POST",
        `/api/cancellations/${id}/review`,
        sess.cm.cookie,
        {
          note: "La notification de sélection a été vue trop tard.",
        },
      );
      const sameAgent = await http(
        "POST",
        `/api/admin/cancellations/${id}/review`,
        sess.ops.cookie,
        {
          outcome: "overturned",
          note: "Recours examiné par le même agent.",
        },
      );
      const over = await http(
        "POST",
        `/api/admin/cancellations/${id}/review`,
        sess.ops2.cookie,
        {
          outcome: "overturned",
          note: "Notification lue tardivement, établie.",
        },
      );
      const incAfter = await incidentsOf("cm");
      const repFinal = await rep("cm");
      report(
        "M5 recours : agent auteur de la décision refusé ; autre ops → manquement annulé, réputation rejouée (aucune double sanction)",
        rv.status === 200 &&
          sameAgent.status === 409 &&
          sameAgent.body.code === "reviewer_must_differ" &&
          over.status === 200 &&
          incAfter.length === 1 &&
          !!incAfter[0].voided_at &&
          repFinal.breach_count === repBefore.breach_count,
        { rv: rv.body, sameAgent: sameAgent.body, over: over.body, repFinal },
      );
    }

    {
      const e = await perDay("ce", 1, "Plonge (justificatif accepté)");
      await proofRpc("proof_l17bc_age", { p_days: e.dayIds });
      const res = await cancelAt(
        "ce",
        e.dayIds,
        ["10 hours"],
        "illness",
        "provided",
      );
      const id = res.result!.cancellation_id;
      await http(
        "POST",
        `/api/cancellations/${id}/evidence`,
        sess.ce.cookie,
        undefined,
        pdfForm(),
      );
      const dec = await http(
        "POST",
        `/api/admin/cancellations/${id}/decision`,
        sess.fnd.cookie,
        {
          decision: "accepted",
          note: "Certificat médical cohérent avec la date.",
        },
      );
      const detail = await http(
        "GET",
        `/api/admin/cancellations/${id}`,
        sess.sup.cookie,
      );
      const evId = ((detail.body.evidence as { id: string }[]) ?? [])[0]?.id;
      const url = await http(
        "GET",
        `/api/admin/case-evidence/${evId}`,
        sess.sup.cookie,
      );
      const urlCand = await http(
        "GET",
        `/api/admin/case-evidence/${evId}`,
        sess.ce.cookie,
      );
      report(
        "M6 justificatif accepté par le fondateur : aucune sanction ; pièce lisible par le support (URL signée), refusée au candidat",
        dec.status === 200 &&
          (await cancellationOf(id)).status === "accepted" &&
          (await incidentsOf("ce")).length === 0 &&
          detail.status === 200 &&
          url.status === 200 &&
          typeof url.body.url === "string" &&
          urlCand.status === 403,
        { dec: dec.body, url: url.status, urlCand: urlCand.status },
      );
    }

    // ── R. Courses et double comptage ────────────────────────────
    {
      const k = await perDay("ck", 4, "Vestiaire (courses)");
      // Début possible (H−15) : journée dans 10 minutes.
      await proofRpc("proof_l17bc_shift", {
        p_day: k.dayIds[0],
        p_base: "now",
        p_delta: "10 minutes",
      });
      const [start, cancel] = await Promise.all([
        sess.ck.client.rpc("start_mission", {
          p_mission_id: k.missions[0],
          p_mission_day_id: k.dayIds[0],
        }),
        http(
          "POST",
          `/api/missions/${k.missions[0]}/cancellation`,
          sess.ck.cookie,
          {
            request_id: randomUUID(),
            day_ids: [k.dayIds[0]],
            reason_code: "transport",
            reason_text: null,
            evidence_choice: "none",
          },
        ),
      ]);
      const { data: day0 } = await serviceClient
        .from("mission_days")
        .select("actual_start_time")
        .eq("id", k.dayIds[0])
        .single();
      const { count: c0 } = await serviceClient
        .from("candidate_cancellation_days")
        .select("mission_day_id", { count: "exact", head: true })
        .eq("mission_day_id", k.dayIds[0]);
      const startWon =
        !start.error &&
        cancel.status === 409 &&
        cancel.body.code === "day_started" &&
        !!day0?.actual_start_time &&
        c0 === 0;
      const cancelWon =
        cancel.status === 200 &&
        start.error?.message === "day_cancelled" &&
        !day0?.actual_start_time &&
        c0 === 1;
      report(
        "R1 début et annulation simultanés : une seule issue (journée commencée et non annulée, ou annulée et jamais commencée)",
        startWon !== cancelWon,
        {
          start: start.error?.message ?? "ok",
          cancel: cancel.body,
          started: !!day0?.actual_start_time,
          c0,
        },
      );
      // Journée annulée d'une période qui continue : ni début, ni
      // réalisation, ni signalement.
      const pk = await fullPeriod(
        "ck",
        [
          { date: nextDate(), start_time: "08:00", end_time: "14:00" },
          { date: nextDate(), start_time: "08:00", end_time: "14:00" },
          { date: nextDate(), start_time: "08:00", end_time: "14:00" },
        ],
        30000,
        "Vestiaire (période)",
      );
      await cancelAt("ck", [pk.dayIds[1]], ["3 days"], null, null);
      await proofRpc("proof_l17bc_shift", {
        p_day: pk.dayIds[1],
        p_base: "now",
        p_delta: "-1 hour",
      });
      const { data: pkMission } = await serviceClient
        .from("missions")
        .select("status")
        .eq("id", pk.missionId)
        .single();
      const st = await sess.ck.client.rpc("start_mission", {
        p_mission_id: pk.missionId,
        p_mission_day_id: pk.dayIds[1],
      });
      const direct = await serviceClient
        .from("mission_days")
        .update({
          completion_source: "support",
          actual_end_time: new Date().toISOString(),
        })
        .eq("id", pk.dayIds[1])
        .select("id");
      const absence = await A.client.rpc("report_mission_incident", {
        p_mission_id: pk.missionId,
        p_mission_day_id: pk.dayIds[1],
        p_kind: "absence",
        p_statement: "Le candidat n'est pas venu (journée annulée).",
      });
      const noShow = await serviceClient
        .from("reputation_incidents")
        .insert({
          subject_type: "candidate",
          subject_id: prof.ck,
          kind: "candidate_no_show",
          source: "support_decision",
          mission_id: pk.missionId,
          scheduled_start_at: (
            await serviceClient
              .from("mission_days")
              .select("starts_at")
              .eq("id", pk.dayIds[1])
              .single()
          ).data!.starts_at,
          occurred_at: new Date().toISOString(),
        })
        .select("id");
      report(
        "R2 journée annulée d'une période qui continue : début refusé (day_cancelled), réalisation refusée même en clé service, signalement d'absence refusé, absence sanctionnée refusée (pas de double comptage)",
        pkMission?.status !== "cancelled" &&
          st.error?.message === "day_cancelled" &&
          !!direct.error &&
          /day_cancelled/.test(direct.error.message) &&
          absence.error?.message === "day_cancelled" &&
          !!noShow.error &&
          /incident_conflicts_with_cancellation/.test(noShow.error.message),
        {
          mission: pkMission?.status,
          st: st.error?.message,
          direct: direct.error?.message,
          absence: absence.error?.message,
          noShow: noShow.error?.message,
        },
      );
      await proofRpc("proof_l17bc_complete", { p_day: k.dayIds[2] });
      const done = await cancelAt("ck", [k.dayIds[2]], [], null, null);
      await proofRpc("proof_l17bc_shift", {
        p_day: k.dayIds[3],
        p_base: "now",
        p_delta: "-5 minutes",
      });
      const begun = await cancelAt("ck", [k.dayIds[3]], [], null, null);
      report(
        "R3 journée confirmée ou déjà débutée : non annulable (day_started, day_already_begun), travail conservé",
        done.error === "day_started" && begun.error === "day_already_begun",
        { done: done.error, begun: begun.error },
      );
      const fiveTimes = await Promise.all(
        Array.from({ length: 5 }, () =>
          cancelAt(
            "ck",
            [k.dayIds[3]],
            ["5 days"],
            null,
            null,
            "00000000-0000-4000-8000-0000000000c5",
          ),
        ),
      );
      const { count: recs } = await serviceClient
        .from("candidate_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("request_id", "00000000-0000-4000-8000-0000000000c5");
      report(
        "R4 cinq envois simultanés de la même demande : une seule demande enregistrée",
        recs === 1 && fiveTimes.filter((x) => x.error).length === 0,
        fiveTimes.map((x) => x.error ?? x.result?.already_recorded),
      );
    }

    // ── X. Exclusions progressives ───────────────────────────────
    {
      const x = await perDay("cx", 12, "Cuisine (exclusions)");
      await proofRpc("proof_l17bc_age", { p_days: x.dayIds });
      const late = async (i: number, choice: "none" | "provided" = "none") =>
        cancelAt("cx", [x.dayIds[i]], ["5 hours"], "other", choice);
      for (const i of [0, 1]) await late(i);
      const beforeThird = await isActive(uid.cx);
      await late(2);
      const s1 = (await suspensionsOf(uid.cx)).filter(
        (s) => s.cause === "cancellation_cycle",
      );
      const s1Row = s1[0];
      const { data: notifs } = await serviceClient
        .from("notifications")
        .select("title, body, data")
        .eq("user_id", uid.cx);
      const suspNotif = (notifs ?? []).find(
        (n) => (n.data as { kind?: string })?.kind === "account_suspension",
      );
      report(
        "X1 troisième manquement → suspension de 6 mois (cycle 1), compte inactif, notification (motif, durée, événements, recours) ; engagements futurs conservés",
        beforeThird === true &&
          s1.length === 1 &&
          s1Row.cycle === 1 &&
          !!s1Row.ends_at &&
          (await isActive(uid.cx)) === false &&
          !!suspNotif &&
          /6|jusqu/.test(suspNotif.body) &&
          /Recours/.test(suspNotif.body) &&
          (
            await serviceClient
              .from("missions")
              .select("status")
              .eq("id", x.missions[11])
              .single()
          ).data?.status === "pending",
        { s1, notif: suspNotif?.body },
      );
      // Durée calendaire calculée par la base.
      const { data: cal } = await serviceClient
        .from("account_suspensions")
        .select("starts_at, ends_at")
        .eq("id", s1Row.id)
        .single();
      const st = new Date(cal!.starts_at);
      const en = new Date(cal!.ends_at!);
      const expected = new Date(st);
      expected.setUTCMonth(expected.getUTCMonth() + 6);
      report(
        "X2 durée en mois calendaires : fin = début + 6 mois (calcul de la base)",
        Math.abs(en.getTime() - expected.getTime()) < 1000 * 3600 * 2,
        { starts: cal!.starts_at, ends: cal!.ends_at },
      );
      // Dossier commis pendant la suspension, décidé plus tard.
      const old = await late(3, "provided");
      await http(
        "POST",
        `/api/cancellations/${old.result!.cancellation_id}/evidence`,
        sess.cx.cookie,
        undefined,
        pdfForm(),
      );
      // Suspension administrative en plus (autre cause).
      const adminOn = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.cx,
        p_active: false,
      });
      const react = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.cx,
        p_active: true,
      });
      // react lève la cause admin ; la remettre pour l'échéance.
      await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.cx,
        p_active: false,
      });
      await proofRpc("proof_l17bc_end_suspension", { p_id: s1Row.id });
      await serviceRpc.rpc("account_suspension_sweep", {
        p_at: new Date().toISOString(),
      });
      const stillBlocked = await isActive(uid.cx);
      const reactivate = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.cx,
        p_active: true,
      });
      report(
        "X3 plusieurs causes : réactivation admin refusée pendant le cycle (other_suspension_active) ; à l'échéance du cycle, compte encore bloqué par la suspension admin ; levée admin ensuite → actif",
        !adminOn.error &&
          react.error === null &&
          stillBlocked === false &&
          !reactivate.error &&
          (await isActive(uid.cx)) === true,
        {
          adminOn: adminOn.error?.message,
          react: react.error?.message,
          stillBlocked,
          reactivate: reactivate.error?.message,
        },
      );
      const otherCause = await sess.ops.client.rpc("admin_set_user_active", {
        p_user_id: uid.cx,
        p_active: true,
      });
      // Ancien dossier décidé après le retour : ne compte pas pour le cycle 2.
      await http(
        "POST",
        `/api/admin/cancellations/${old.result!.cancellation_id}/decision`,
        sess.ops.cookie,
        {
          decision: "refused",
          note: "Justificatif sans rapport avec la date.",
        },
      );
      for (const i of [4, 5]) await late(i);
      const beforeC2 = (await suspensionsOf(uid.cx)).filter(
        (s) => s.cause === "cancellation_cycle",
      ).length;
      await late(6);
      const c2 = (await suspensionsOf(uid.cx)).filter(
        (s) => s.cause === "cancellation_cycle",
      );
      report(
        "X4 après le retour : le dossier ancien décidé tard reste hors cycle (deux nouveaux faits → pas de suspension) ; troisième nouveau fait → 1 an (cycle 2)",
        otherCause.error === null &&
          beforeC2 === 1 &&
          c2.length === 2 &&
          c2[1].cycle === 2 &&
          (await isActive(uid.cx)) === false,
        {
          otherCause: otherCause.error?.message ?? null,
          beforeC2,
          c2: c2.map((s) => ({
            cycle: s.cycle,
            starts: s.starts_at,
            ends: s.ends_at,
            ids: s.incident_ids,
          })),
          incidents: (await incidentsOf("cx")).map((i) => ({
            id: i.id,
            at: i.occurred_at,
          })),
        },
      );
      const { data: c2cal } = await serviceClient
        .from("account_suspensions")
        .select("starts_at, ends_at")
        .eq("id", c2[1].id)
        .single();
      const yr = new Date(c2cal!.starts_at);
      yr.setUTCFullYear(yr.getUTCFullYear() + 1);
      const yearOk =
        Math.abs(new Date(c2cal!.ends_at!).getTime() - yr.getTime()) < 1000;
      await proofRpc("proof_l17bc_end_suspension", { p_id: c2[1].id });
      await serviceRpc.rpc("account_suspension_sweep", {
        p_at: new Date().toISOString(),
      });
      const activeAfterC2 = await isActive(uid.cx);
      const c3ids: string[] = [];
      for (const i of [7, 8, 9]) {
        const r = await late(i);
        c3ids.push(r.result!.cancellation_id);
      }
      const c3 = (await suspensionsOf(uid.cx)).filter(
        (s) => s.cause === "cancellation_cycle",
      );
      report(
        "X5 1 an calendaire ; après le deuxième retour, trois nouveaux manquements → exclusion définitive (cycle 3, sans fin)",
        yearOk &&
          activeAfterC2 === true &&
          c3.length === 3 &&
          c3[2].cycle === 3 &&
          c3[2].ends_at === null &&
          (await isActive(uid.cx)) === false,
        { c3: c3.map((s) => ({ cycle: s.cycle, ends: s.ends_at })) },
      );
      // Recours qui annule un manquement de l'exclusion : levée, compte actif.
      const rv = await http(
        "POST",
        `/api/cancellations/${c3ids[2]}/review`,
        sess.cx.cookie,
        {
          note: "Empêchement réel, certificat joint au recours.",
        },
      );
      const over = await http(
        "POST",
        `/api/admin/cancellations/${c3ids[2]}/review`,
        sess.ops2.cookie,
        {
          outcome: "overturned",
          note: "Empêchement établi par la pièce du recours.",
        },
      );
      const afterVoid = (await suspensionsOf(uid.cx)).filter(
        (s) => s.cause === "cancellation_cycle",
      );
      report(
        "X6 recours accepté sur un manquement de l'exclusion : cycle 3 levé (decision_voided), compte réactivé, historique conservé",
        rv.status === 200 &&
          over.status === 200 &&
          afterVoid.length === 3 &&
          afterVoid[2].lift_kind === "decision_voided" &&
          (await isActive(uid.cx)) === true,
        {
          over: over.body,
          voided: (await incidentsOf("cx"))
            .filter((i) => i.voided_at)
            .map((i) => i.id),
          afterVoid: afterVoid.map((s) => ({
            cycle: s.cycle,
            lift: s.lift_kind,
            ids: s.incident_ids,
          })),
        },
      );
      // Recours tardif sur un manquement du cycle 1, après les cycles suivants : arbitrage.
      const firstCancellation = (
        await serviceClient
          .from("candidate_cancellations")
          .select("id")
          .eq("candidate_user_id", uid.cx)
          .order("created_at")
          .limit(1)
          .single()
      ).data!.id;
      await serviceClient
        .from("candidate_cancellations")
        .update({
          review_requested_at: new Date().toISOString(),
          review_note: "Recours tardif (fixture).",
        })
        .eq("id", firstCancellation);
      await http(
        "POST",
        `/api/admin/cancellations/${firstCancellation}/review`,
        sess.ops2.cookie,
        {
          outcome: "overturned",
          note: "Erreur reconnue sur le premier dossier.",
        },
      );
      const { data: arb } = await serviceClient
        .from("audit_logs")
        .select("metadata")
        .eq("action", "cancellation_cycle_arbitration_needed");
      const arbMine = (arb ?? []).filter(
        (a) => (a.metadata as { user_id?: string })?.user_id === uid.cx,
      );
      report(
        "X7 manquement du cycle 1 annulé alors que le cycle 2 est appliqué : cycle 1 levé, cycle 2 conservé, arbitrage tracé (audit)",
        arbMine.length >= 1 &&
          (await suspensionsOf(uid.cx)).filter(
            (s) =>
              s.cause === "cancellation_cycle" &&
              s.cycle === 2 &&
              s.lift_kind === null,
          ).length === 1,
        { arbitration: arbMine.length },
      );
    }

    // ── F. Fraude ────────────────────────────────────────────────
    {
      const fr = await http(
        "POST",
        "/api/admin/fraud-reports",
        sess.sup.cookie,
        {
          subject_user_id: uid.cz,
          cancellation_id: null,
          reason: "Justificatifs identiques sur trois dossiers différents.",
        },
      );
      const reportId = (fr.body.result as string) ?? "";
      const ev = await http(
        "POST",
        `/api/admin/fraud-reports/${reportId}/evidence`,
        sess.sup.cookie,
        undefined,
        pdfForm(),
      );
      const supSusp = await http(
        "POST",
        `/api/admin/fraud-reports/${reportId}/suspend`,
        sess.sup.cookie,
        {
          ends_at: null,
          reason: "Suspension demandée par le support.",
        },
      );
      const ends = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const opsSusp = await http(
        "POST",
        `/api/admin/fraud-reports/${reportId}/suspend`,
        sess.ops.cookie,
        {
          ends_at: ends,
          reason: "Fraude présumée : documents falsifiés.",
        },
      );
      const suspId = opsSusp.body.result as string;
      const inactive = (await isActive(uid.cz)) === false;
      const mine = await http(
        "GET",
        "/api/account/suspensions",
        sess.cz.cookie,
      );
      const contest = await http(
        "POST",
        `/api/account/suspensions/${suspId}/contest`,
        sess.cz.cookie,
        {
          note: "Les documents sont authentiques, je peux le prouver.",
        },
      );
      const keep = await http(
        "POST",
        `/api/admin/suspensions/${suspId}`,
        sess.ops.cookie,
        {
          action: "maintain",
          note: "Éléments insuffisants à ce stade.",
          from_contest: true,
        },
      );
      const lift = await http(
        "POST",
        `/api/admin/suspensions/${suspId}`,
        sess.fnd.cookie,
        {
          action: "lift",
          note: "Authenticité confirmée par l'émetteur.",
          from_contest: false,
        },
      );
      report(
        "F1 fraude : signalement et pièce par le support ; suspension refusée au support, décidée par ops (fin explicite) ; le candidat suspendu lit et conteste ; maintien puis levée motivés",
        fr.status === 200 &&
          ev.status === 200 &&
          supSusp.status === 403 &&
          opsSusp.status === 200 &&
          inactive &&
          mine.status === 200 &&
          contest.status === 200 &&
          keep.status === 200 &&
          lift.status === 200 &&
          (await isActive(uid.cz)) === true,
        {
          fr: fr.body,
          supSusp: supSusp.body,
          opsSusp: opsSusp.body,
          contest: contest.body,
          lift: lift.body,
        },
      );
    }

    // ── P. Montant acquis (prorata) ──────────────────────────────
    {
      const period = await fullPeriod(
        "cn",
        [
          { date: nextDate(), start_time: "08:00", end_time: "16:00" },
          { date: nextDate(), start_time: "22:00", end_time: "04:00" },
          { date: nextDate(), start_time: "09:00", end_time: "15:00" },
        ],
        60000,
        "Gardiennage (période complète)",
      );
      const { data: contractBefore } = await serviceClient
        .from("contracts")
        .select("terms_hash, contract_data")
        .eq("application_id", period.applicationId)
        .single();
      await proofRpc("proof_l17bc_complete", { p_day: period.dayIds[0] });
      await proofRpc("proof_l17bc_complete", { p_day: period.dayIds[1] });
      const amountBefore = await http(
        "GET",
        `/api/missions/${period.missionId}/acquired-amount`,
        sess.cn.cookie,
      );
      const c = await cancelAt(
        "cn",
        [period.dayIds[2]],
        ["5 days"],
        null,
        null,
      );
      const amount = await http(
        "GET",
        `/api/missions/${period.missionId}/acquired-amount`,
        sess.cn.cookie,
      );
      const companyAmount = await http(
        "GET",
        `/api/missions/${period.missionId}/acquired-amount`,
        A.cookie,
      );
      const thirdAmount = await http(
        "GET",
        `/api/missions/${period.missionId}/acquired-amount`,
        sess.t.cookie,
      );
      const a = amount.body.amount as {
        acquired_exact: number;
        acquired_rounded: number;
        status: string;
        is_integer: boolean;
        planned_minutes_total: number;
        realized_minutes: number;
      };
      const { data: contractAfter } = await serviceClient
        .from("contracts")
        .select("terms_hash, contract_data")
        .eq("application_id", period.applicationId)
        .single();
      const { data: m } = await serviceClient
        .from("missions")
        .select("status, cancellation_reason")
        .eq("id", period.missionId)
        .single();
      const { data: app } = await serviceClient
        .from("job_applications")
        .select("status")
        .eq("id", period.applicationId)
        .single();
      report(
        "P1 60 000 XAF, 8 h + 6 h (nuit 22 h → 4 h) + 6 h, deux journées réalisées puis la dernière annulée → 42 000 XAF exact, définitif ; mission interrompue, place conservée, contrat inchangé ; lisible par les parties, pas par un tiers",
        (amountBefore.body.amount as { status: string }).status ===
          "in_progress" &&
          c.result?.status === "closed_no_sanction" &&
          a.acquired_exact === 42000 &&
          a.acquired_rounded === 42000 &&
          a.is_integer === true &&
          a.status === "final" &&
          a.planned_minutes_total === 1200 &&
          a.realized_minutes === 840 &&
          m?.status === "cancelled" &&
          m?.cancellation_reason === "candidate_cancellation_interrupted" &&
          app?.status === "selected" &&
          contractAfter?.terms_hash === contractBefore?.terms_hash &&
          JSON.stringify(contractAfter?.contract_data) ===
            JSON.stringify(contractBefore?.contract_data) &&
          companyAmount.status === 200 &&
          thirdAmount.status === 404,
        { a, m, app: app?.status, third: thirdAmount.status },
      );
      const odd = await fullPeriod(
        "cn",
        [
          { date: nextDate(), start_time: "08:00", end_time: "11:00" },
          { date: nextDate(), start_time: "08:00", end_time: "12:00" },
        ],
        10000,
        "Inventaire (arrondi)",
      );
      await proofRpc("proof_l17bc_complete", { p_day: odd.dayIds[0] });
      await cancelAt("cn", [odd.dayIds[1]], ["5 days"], null, null);
      const oddAmount = (
        await http(
          "GET",
          `/api/missions/${odd.missionId}/acquired-amount`,
          sess.cn.cookie,
        )
      ).body.amount as {
        acquired_exact: number;
        acquired_rounded: number;
        is_integer: boolean;
      };
      report(
        "P2 résultat non entier : 10 000 × 3 h ÷ 7 h = 4 285,7143 (exact) ; arrondi au franc proposé 4 286, à valider",
        Math.abs(oddAmount.acquired_exact - 4285.7143) < 0.0001 &&
          oddAmount.acquired_rounded === 4286 &&
          oddAmount.is_integer === false,
        oddAmount,
      );
      const part = await fullPeriod(
        "cn",
        [
          { date: nextDate(), start_time: "08:00", end_time: "14:00" },
          { date: nextDate(), start_time: "08:00", end_time: "14:00" },
        ],
        20000,
        "Livraison (partielle)",
      );
      await proofRpc("proof_l17bc_complete", { p_day: part.dayIds[0] });
      const { data: md } = await serviceClient
        .from("mission_days")
        .select("id")
        .eq("id", part.dayIds[1])
        .single();
      const { error: incErr } = await serviceClient
        .from("mission_incidents")
        .insert({
          mission_id: part.missionId,
          mission_day_id: md!.id,
          job_id: part.jobId,
          candidate_id: prof.cn,
          company_id: coA,
          kind: "code_not_received",
          reported_by_party: "candidate",
          status: "decided",
          outcome: "partial",
          decided_at: new Date().toISOString(),
          decision_note: "Réalisation partielle identifiée (fixture).",
        });
      const partAmount = (
        await http(
          "GET",
          `/api/missions/${part.missionId}/acquired-amount`,
          sess.cn.cookie,
        )
      ).body.amount as { status: string; acquired_exact: number };
      report(
        "P3 journée partielle (issue « partial » du support) : « en attente de règlement », aucune durée ni aucun montant inventés (seule la journée confirmée compte)",
        !incErr &&
          partAmount.status === "settlement_pending" &&
          partAmount.acquired_exact === 10000,
        { incErr: incErr?.message, partAmount },
      );
    }

    // ── C. Droits, confidentialité, signaux ──────────────────────
    {
      const t0 = new Date(Date.now() - 1000).toISOString();
      const c = await perDay("t", 1, "Boutique (confidentialité)");
      await proofRpc("proof_l17bc_age", { p_days: c.dayIds });
      const res = await cancelAt("t", c.dayIds, ["10 hours"], "other", "none");
      const companyPreview = await A.client.rpc(
        "candidate_cancellation_preview",
        { p_mission_id: c.missions[0] },
      );
      const companyList = await A.client.rpc("company_job_cancellations", {
        p_job_id: c.jobId,
      });
      const mission = await http(
        "GET",
        `/api/missions/${c.missions[0]}`,
        A.cookie,
      );
      const { data: jm } = await A.client.rpc("company_job_missions", {
        p_job_id: c.jobId,
      });
      const direct = await Promise.all([
        A.client.from("candidate_cancellations").select("*"),
        sess.t.client.from("candidate_cancellation_days").select("*"),
        sess.t.client.from("account_suspensions").select("*"),
        sess.t.client.from("case_evidence").select("*"),
      ]);
      const otherCand = await http(
        "GET",
        `/api/missions/${c.missions[0]}/cancellation`,
        sess.cf.cookie,
      );
      const anonCall = await anon.rpc("request_candidate_cancellation", {
        p_request_id: randomUUID(),
        p_day_ids: c.dayIds,
        p_reason_code: "other",
        p_reason_text: "x",
        p_evidence_choice: "none",
      });
      const companySig = await proofRpc<Record<string, unknown>[]>(
        "proof_l17bc_messages",
        {
          p_topic: `user:${idA}`,
          p_since: t0,
        },
      );
      const leak =
        /classification|in_time|late|premium|candidate_plan|notice|reason_code|evidence/i;
      report(
        "C1 entreprise : aperçu refusé, liste limitée aux dates d'annulation, mission et journées sans classement ni plan ni motif ; tables fermées aux sessions ; autre candidat et anonyme refusés ; signaux {d, r, id}, aucun signal de compte du candidat",
        res.result?.status === "sanctioned_no_evidence" &&
          companyPreview.error?.message === "mission_not_found" &&
          !companyList.error &&
          JSON.stringify(
            Object.keys((companyList.data ?? [])[0] ?? {}).sort(),
          ) ===
            JSON.stringify(["cancelled_at", "mission_day_id", "mission_id"]) &&
          mission.status === 200 &&
          !leak.test(mission.text) &&
          !leak.test(JSON.stringify(jm ?? [])) &&
          direct.every((d) => !!d.error) &&
          otherCand.status === 404 &&
          !!anonCall.error &&
          companySig.length > 0 &&
          companySig.every((m) =>
            Object.keys(m).every((k) => SIGNAL_KEYS.has(k)),
          ) &&
          companySig.every((m) => m.d !== "account"),
        {
          companyPreview: companyPreview.error?.message,
          list: companyList.data,
          signals: companySig,
          otherCand: otherCand.status,
        },
      );
      const supRead = await http(
        "GET",
        "/api/admin/cancellations?status=to_review",
        sess.sup.cookie,
      );
      const offRead = await http(
        "GET",
        "/api/admin/cancellations",
        sess.off.cookie,
      );
      const candRead = await http(
        "GET",
        "/api/admin/cancellations",
        sess.t.cookie,
      );
      report(
        "C2 support actif : lecture des dossiers ; admin suspendu et candidat refusés",
        supRead.status === 200 &&
          offRead.status === 403 &&
          candRead.status === 403,
        { sup: supRead.status, off: offRead.status, cand: candRead.status },
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
