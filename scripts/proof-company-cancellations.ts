/**
 * Preuve lot 17d-2 — annulation par l'entreprise après sélection.
 * Décisions : ANN-06 (délai Free 48 h / Premium 24 h, limites incluses,
 * plan figé à chaque sélection, tardive sans conséquence, engagements
 * antérieurs : délai inconnu) ; ANN-04 étendu à l'entreprise (une demande =
 * un événement, instruction du 2026-11-22) ; ANN-08 en partie (dates
 * entières, journées futures non commencées, motif ; à confirmer).
 *
 * Fixtures en clé service ; sélections par « Signer et sélectionner » en
 * session ; tentatives en sessions RÉELLES (route avec cookies, RPC avec le
 * JWT) ; état relu en clé service. Instants exacts : `proof_l17d2_cancel`
 * place le début des journées à now() + décalage puis appelle la vraie RPC
 * sous l'identité de l'entreprise, dans la même transaction ;
 * `proof_l17d2_classify` évalue la qualification à la limite exacte et
 * 1 µs après.
 *
 *   T. Conditions figées : Free 48 h, Premium 24 h à la sélection ; arrêt,
 *      activation et prolongation ultérieurs sans effet ; conditions
 *      immuables, fermées aux sessions et à la clé service ; engagement
 *      antérieur → legacy, jamais reconstitué depuis le plan actuel.
 *   L. Limites exactes (qualification seule, aucune conséquence).
 *   A. Parcours : aperçu (dates, candidats, qualification), un événement
 *      pour plusieurs journées et candidats, avis, audit, contrat,
 *      candidature et place conservés, missions closes, montant reconnu.
 *   V. Refus sans effet : motif, date partielle (retrait ciblé), tardive
 *      non vue, journée commencée, débutée ou confirmée.
 *   I. Relances et concurrence : même clé, cinq envois simultanés, deux
 *      demandes sur les mêmes journées, clé réutilisée pour d'autres jours.
 *   R. Courses : début, désistement du candidat ; journée annulée ensuite
 *      ni commencée, ni confirmée (clé service comprise), ni signalée, ni
 *      imputée au candidat.
 *   P. Panne en cours de transaction : aucun effet partiel.
 *   F. Créneau libéré (décision du 2026-11-22) : période complète, journées
 *      au choix, désistement avec justificatif en attente, autres journées
 *      toujours bloquantes, annulation refusée ou en cours face à une
 *      sélection définitive, compte suspendu ; S. horaires figés en clé
 *      service ; M. motif réservé à l'entreprise et à l'administration.
 *   D. Droits : autre entreprise, candidat, admin, anonyme, compte suspendu ;
 *      aucune sanction ni réputation ; avis et signaux sans motif,
 *      qualification ni plan.
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
import { grantCompanyPremium } from "./lib/company-premium-fixture";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF = "company-cancellations";
const PROOF_PASSWORD = "Proof-L17d2-cancel-01!";
const PROOF_USER_METADATA = { proofCompanyCancellations: true };

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

// ─── Fonctions temporaires (pile de preuve) ───────────────────────
const FUNCTIONS: Record<string, string> = {
  // Début des journées à now() + décalage, puis demande sous l'identité de
  // l'entreprise, dans la même transaction.
  "proof_l17d2_cancel(uuid, uuid, uuid, uuid[], uuid[], interval[], text, boolean)": `
create or replace function public.proof_l17d2_cancel(
  p_actor uuid, p_request uuid, p_job uuid, p_days uuid[],
  p_shift uuid[], p_offsets interval[], p_reason text, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb; v_err text; i integer;
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  for i in 1 .. coalesce(cardinality(p_offsets), 0) loop
    update public.mission_days d
    set starts_at = now() + p_offsets[i], ends_at = now() + p_offsets[i] + interval '6 hours'
    where d.id = p_shift[i];
  end loop;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    select to_jsonb(x) into v_res from public.request_company_cancellation(
      p_request, p_job, p_days, p_reason, p_ack) x;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res,
    'classes', (select jsonb_agg(cd.classification order by cd.starts_at, cd.mission_day_id)
                from public.company_cancellation_days cd
                where cd.mission_day_id = any (p_days)));
end $$`,
  // Qualification à un instant exact (limite calculée par la base).
  "proof_l17d2_classify(uuid, interval)": `
create or replace function public.proof_l17d2_classify(p_day uuid, p_delta interval)
returns text language plpgsql security definer set search_path = '' as $$
declare v_t public.mission_day_company_terms; v_d public.mission_days;
begin
  select * into v_t from public.mission_day_company_terms where mission_day_id = p_day;
  select * into v_d from public.mission_days where id = p_day;
  return (select k.classification from public.company_cancellation_classify(p_day,
    v_d.starts_at - make_interval(hours => v_t.cancellation_notice_hours) + p_delta) k);
end $$`,
  "proof_l17d2_shift(uuid[], interval)": `
create or replace function public.proof_l17d2_shift(p_days uuid[], p_delta interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d set starts_at = now() + p_delta, ends_at = now() + p_delta + interval '6 hours'
  where d.id = any (p_days);
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
end $$`,
  // Début d'une journée placé à un instant exact (voie de maintenance).
  "proof_l17d2_place(uuid, timestamptz)": `
create or replace function public.proof_l17d2_place(p_day uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  update public.mission_days d set starts_at = p_at, ends_at = p_at + interval '6 hours'
  where d.id = p_day;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
end $$`,
  // Sélection du candidat antidatée de 3 jours (sinon délai de réaction).
  "proof_l17d2_age(uuid[])": `
create or replace function public.proof_l17d2_age(p_days uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.mission_day_commitment_terms disable trigger trg_protect_mission_day_commitment_terms;
  update public.mission_day_commitment_terms t set selected_at = t.selected_at - interval '3 days'
  where t.mission_day_id = any (p_days);
  alter table public.mission_day_commitment_terms enable trigger trg_protect_mission_day_commitment_terms;
end $$`,
  // Journée confirmée par code (fixture de réalisation).
  "proof_l17d2_complete(uuid)": `
create or replace function public.proof_l17d2_complete(p_day uuid)
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
  // Engagement antérieur au lot : conditions remplacées par « legacy »
  // (maintenance directe, comme la reprise de la migration).
  "proof_l17d2_legacy(uuid[])": `
create or replace function public.proof_l17d2_legacy(p_days uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mission_day_company_terms t where t.mission_day_id = any (p_days);
  insert into public.mission_day_company_terms (mission_day_id, mission_id, application_id,
    job_id, company_id, terms_source, company_plan, cancellation_notice_hours, selected_at)
  select d.id, m.id, a.id, m.job_id, j.company_id, 'legacy', null, null, a.selected_at
  from public.mission_days d join public.missions m on m.id = d.mission_id
  join public.job_applications a on a.id = m.application_id
  join public.jobs j on j.id = m.job_id where d.id = any (p_days);
end $$`,
  // Tentative de modification par le propriétaire (voie de maintenance).
  "proof_l17d2_tamper(uuid)": `
create or replace function public.proof_l17d2_tamper(p_day uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update public.mission_day_company_terms t set company_plan = 'premium',
    cancellation_notice_hours = 24 where t.mission_day_id = p_day;
  return null;
exception when others then return sqlerrm;
end $$`,
  "proof_l17d2_rep(text, uuid)": `
create or replace function public.proof_l17d2_rep(p_type text, p_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(r) from public.compute_reputation(p_type, p_id) r;
$$`,
  "proof_l17d2_messages(text, timestamptz)": `
create or replace function public.proof_l17d2_messages(p_topic text, p_since timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
  from realtime.messages m where m.topic = p_topic and m.inserted_at >= p_since;
$$`,
  "proof_l17d2_acquired(uuid)": `
create or replace function public.proof_l17d2_acquired(p_mission uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select cp.user_id into v_user from public.missions m
  join public.candidate_profiles cp on cp.id = m.candidate_id where m.id = p_mission;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  return public.mission_acquired_amount(p_mission);
end $$`,
};
const DROP_ALL = [
  ...Object.keys(FUNCTIONS).map((f) => `drop function if exists public.${f}`),
  "drop trigger if exists proof_l17d2_fail_audit on public.audit_logs",
  "drop function if exists public.proof_l17d2_fail_audit()",
  "drop trigger if exists proof_l17d2_slow_cancel on public.company_cancellation_days",
  "drop function if exists public.proof_l17d2_slow_cancel()",
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

/** Arrêt de Premium par la vraie RPC (admin_ops actif de la preuve). */
function stopCompanyPremium(companyId: string, adminUserId: string) {
  const sql = `do $stop$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '${adminUserId}', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '${adminUserId}', true);
  perform public.admin_manage_company_premium(
    gen_random_uuid(), '${companyId}', 'stop', null,
    (select cp.subscription_expires_at from public.company_profiles cp where cp.id = '${companyId}'),
    'Fixture de preuve company-cancellations : arrêt.');
end
$stop$`;
  const r = runSupabaseQuery(DB_URL, sql, { proof: PROOF });
  if (r.status !== 0) throw new Error(`stopCompanyPremium : ${r.out}`);
}
/** Prolongation de Premium par la vraie RPC. */
function extendCompanyPremium(
  companyId: string,
  adminUserId: string,
  endsAt: string,
) {
  const sql = `do $ext$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '${adminUserId}', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '${adminUserId}', true);
  perform public.admin_manage_company_premium(
    gen_random_uuid(), '${companyId}', 'extend', '${endsAt}'::timestamptz,
    (select cp.subscription_expires_at from public.company_profiles cp where cp.id = '${companyId}'),
    'Fixture de preuve company-cancellations : prolongation.');
end
$ext$`;
  const r = runSupabaseQuery(DB_URL, sql, { proof: PROOF });
  if (r.status !== 0) throw new Error(`extendCompanyPremium : ${r.out}`);
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
      niu: `M2D${String(Date.now()).slice(-9)}${name.length}`,
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
      bio: "Candidat de preuve du lot 17d-2.",
      cni_number: `CNI2D${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
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
      .filter((u) => u.user_metadata?.proofCompanyCancellations === true)
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

const SIGNAL_KEYS = new Set(["d", "r", "id"]);
const CONTENT = {
  description: "Preuve de l'annulation par l'entreprise (lot 17d-2).",
  address: "Rue Joss",
  city: "Douala",
};
const REASON = "Événement annulé par notre client, salle indisponible.";

type CancelResult = {
  cancellation_id: string;
  day_count: number;
  date_count: number;
  candidate_count: number;
  in_time_count: number;
  late_count: number;
  legacy_count: number;
  created_at: string;
  already_recorded: boolean;
};
type CancelCase = {
  error: string | null;
  result: CancelResult | null;
  classes: string[] | null;
};
type PreviewDay = {
  mission_day_id: string;
  mission_id: string;
  day_date: string;
  first_name: string | null;
  last_initial: string | null;
  state: string;
  classification: string;
  company_plan: string | null;
  cancellation_notice_hours: number | null;
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17d2-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    const keys = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idS = await createAccount(mail("s"), "company");
    const uidList = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    ids.push(idA, idB, idS, ...uidList, idOps);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, uidList[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Traiteur Bonapriso");
    const coB = await createCompany(idB, "Hôtel Wouri");
    const coS = await createCompany(idS, "Société suspendue");
    const prof = Object.fromEntries(
      await Promise.all(
        keys.map(async (k) => [
          k,
          await createCandidate(uid[k], k.toUpperCase()),
        ]),
      ),
    ) as Record<K, string>;

    const sessionKeys = ["a", "b", "s", ...keys, "ops"];
    const sess = Object.fromEntries(
      await Promise.all(
        sessionKeys.map(async (k) => [k, await realSession(mail(k))]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Fixtures ─────────────────────────────────────────────
    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      const d = new Date(Date.UTC(2099, 2, 1) + dayNo * 86_400_000);
      return d.toISOString().slice(0, 10);
    };
    const period = (n: number): FixtureDay[] =>
      Array.from({ length: n }, () => ({
        date: nextDate(),
        start_time: "08:00",
        end_time: "14:00",
      }));
    /**
     * Offre « période complète » de l'entreprise `company`, candidats `ks`
     * sélectionnés par « Signer et sélectionner » (session de `owner`).
     */
    const fullPeriod = async (
      ks: K[],
      n: number,
      pay: number,
      title: string,
      company = coA,
      owner: Session = A,
    ) => {
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: company,
          mission_pay_per_candidate: pay,
          positions_available: ks.length,
        },
        period(n),
        "full_period",
      );
      const out: Record<
        string,
        { missionId: string; applicationId: string; dayIds: string[] }
      > = {};
      for (const k of ks) {
        const { data: app, error } = await sess[k].client.rpc("apply_to_job", {
          p_job_id: jobId,
        });
        if (error || !app) throw new Error(`apply ${title}: ${error?.message}`);
        const sel = await signAndSelectRpc(owner.client, app.id);
        if (sel.error) throw new Error(`select ${title}: ${sel.error.message}`);
        const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
        const { data: md } = await serviceClient
          .from("mission_days")
          .select("id, scheduled_date")
          .eq("mission_id", missionId)
          .order("scheduled_date");
        out[k] = {
          missionId,
          applicationId: app.id,
          dayIds: md!.map((d) => d.id),
        };
      }
      return { jobId, by: out };
    };
    const terms = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_day_company_terms")
          .select("terms_source, company_plan, cancellation_notice_hours")
          .eq("mission_day_id", dayId)
          .single()
      ).data;
    const cancelAt = (
      jobId: string,
      days: string[],
      shift: string[],
      offsets: string[],
      ack: boolean,
      reason: string = REASON,
      request: string = randomUUID(),
      actor: string = idA,
    ) =>
      proofRpc<CancelCase>("proof_l17d2_cancel", {
        p_actor: actor,
        p_request: request,
        p_job: jobId,
        p_days: days,
        p_shift: shift,
        p_offsets: offsets,
        p_reason: reason,
        p_ack: ack,
      });
    const post = (
      jobId: string,
      body: Record<string, unknown>,
      cookie: string | null = A.cookie,
    ) => http("POST", `/api/jobs/${jobId}/cancellation`, cookie, body);
    const eventsOf = async (jobId: string) =>
      (
        await serviceClient
          .from("company_cancellations")
          .select("*")
          .eq("job_id", jobId)
      ).data ?? [];
    const cancelledDays = async (dayIds: string[]) =>
      (
        await serviceClient
          .from("company_cancellation_days")
          .select("mission_day_id, classification, cancellation_id")
          .in("mission_day_id", dayIds)
      ).data ?? [];
    const notifs = async (userIds: string[], kind = "company_cancellation") =>
      (
        await serviceClient
          .from("notifications")
          .select("user_id, title, body, data")
          .in("user_id", userIds)
      ).data?.filter(
        (n) => (n.data as { kind?: string } | null)?.kind === kind,
      ) ?? [];
    const audits = async (jobId: string) =>
      (
        await serviceClient
          .from("audit_logs")
          .select("id, metadata")
          .eq("resource_id", jobId)
          .eq("action", "company_cancellation")
      ).data ?? [];
    const snapshot = async (applicationIds: string[]) =>
      JSON.stringify(
        (
          await serviceClient
            .from("contracts")
            .select("*")
            .in("application_id", applicationIds)
            .order("id")
        ).data,
      );

    // ── T. Conditions figées à la sélection ──────────────────
    {
      // Free à la sélection (A) ; Premium à la sélection (B).
      const free = await fullPeriod(
        ["c1"],
        2,
        20000,
        "Service traiteur (Free)",
      );
      grantCompanyPremium(DB_URL, {
        companyId: coB,
        adminUserId: idOps,
        endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        proof: PROOF,
      });
      const prem = await fullPeriod(
        ["c1"],
        2,
        20000,
        "Réception (Premium)",
        coB,
        sess.b,
      );
      const tFree = await terms(free.by.c1.dayIds[0]);
      const tPrem = await terms(prem.by.c1.dayIds[0]);
      report(
        "T1 plan effectif figé à « Signer et sélectionner » : Free → 48 h, Premium → 24 h (ANN-06)",
        tFree?.terms_source === "selection" &&
          tFree.company_plan === "free" &&
          tFree.cancellation_notice_hours === 48 &&
          tPrem?.terms_source === "selection" &&
          tPrem.company_plan === "premium" &&
          tPrem.cancellation_notice_hours === 24,
        { tFree, tPrem },
      );

      // Changements ultérieurs : A devient Premium, B prolongé puis arrêté.
      grantCompanyPremium(DB_URL, {
        companyId: coA,
        adminUserId: idOps,
        endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        proof: PROOF,
      });
      extendCompanyPremium(
        coB,
        idOps,
        new Date(Date.now() + 60 * 86_400_000).toISOString(),
      );
      stopCompanyPremium(coB, idOps);
      const tFree2 = await terms(free.by.c1.dayIds[0]);
      const tPrem2 = await terms(prem.by.c1.dayIds[0]);
      // Qualification à la limite du délai figé (48 h pour A malgré
      // Premium actif ; 24 h pour B malgré l'arrêt).
      const freeAt0 = await proofRpc<string>("proof_l17d2_classify", {
        p_day: free.by.c1.dayIds[0],
        p_delta: "0",
      });
      const premAt0 = await proofRpc<string>("proof_l17d2_classify", {
        p_day: prem.by.c1.dayIds[0],
        p_delta: "0",
      });
      report(
        "T2 activation, prolongation et arrêt ultérieurs sans effet : conditions et qualification inchangées",
        JSON.stringify(tFree2) === JSON.stringify(tFree) &&
          JSON.stringify(tPrem2) === JSON.stringify(tPrem) &&
          freeAt0 === "in_time" &&
          premAt0 === "in_time",
        { tFree2, tPrem2, freeAt0, premAt0 },
      );
      // Nouvelle sélection d'A, désormais Premium : 24 h pour elle seule.
      const after = await fullPeriod(["c2"], 1, 9000, "Service (A Premium)");
      const tAfter = await terms(after.by.c2.dayIds[0]);
      stopCompanyPremium(coA, idOps);
      const tAfter2 = await terms(after.by.c2.dayIds[0]);
      report(
        "T3 chaque sélection fige le plan du moment : A Premium → 24 h sur la nouvelle sélection, conservées après l'arrêt",
        tAfter?.company_plan === "premium" &&
          tAfter.cancellation_notice_hours === 24 &&
          JSON.stringify(tAfter2) === JSON.stringify(tAfter),
        { tAfter, tAfter2 },
      );

      // Protections : sessions, clé service, propriétaire.
      const day = free.by.c1.dayIds[0];
      const sessRead = await A.client
        .from("mission_day_company_terms" as never)
        .select("*");
      const sessUpd = await sess.c1.client
        .from("mission_day_company_terms" as never)
        .update({ company_plan: "premium" } as never)
        .eq("mission_day_id", day);
      const svcUpd = await serviceClient
        .from("mission_day_company_terms")
        .update({ company_plan: "premium", cancellation_notice_hours: 24 })
        .eq("mission_day_id", day)
        .select("mission_day_id");
      const svcIns = await serviceClient
        .from("mission_day_company_terms")
        .insert({
          mission_day_id: prem.by.c1.dayIds[1],
          mission_id: prem.by.c1.missionId,
          application_id: prem.by.c1.applicationId,
          job_id: prem.jobId,
          company_id: coB,
          terms_source: "legacy",
        })
        .select("mission_day_id");
      const svcDel = await serviceClient
        .from("mission_day_company_terms")
        .delete()
        .eq("mission_day_id", day)
        .select("mission_day_id");
      const owner = await proofRpc<string | null>("proof_l17d2_tamper", {
        p_day: day,
      });
      const truncatePriv = execSql(
        "select has_table_privilege('service_role', 'public.mission_day_company_terms', 'TRUNCATE')::text || ',' || has_table_privilege('authenticated', 'public.mission_day_company_terms', 'SELECT')::text",
      );
      const tFinal = await terms(day);
      report(
        "T4 conditions protégées : lecture et écriture refusées en session, insertion, modification et suppression refusées en clé service, modification refusée au propriétaire, pas de TRUNCATE ; valeurs intactes",
        (!!sessRead.error || (sessRead.data ?? []).length === 0) &&
          !!sessUpd.error &&
          !!svcUpd.error &&
          !!svcIns.error &&
          !!svcDel.error &&
          /immutable/.test(owner ?? "") &&
          /false,false/.test(truncatePriv) &&
          JSON.stringify(tFinal) === JSON.stringify(tFree),
        {
          sessRead: sessRead.error?.message ?? sessRead.data?.length,
          sessUpd: sessUpd.error?.message,
          svcUpd: svcUpd.error?.message,
          svcIns: svcIns.error?.message,
          svcDel: svcDel.error?.message,
          owner,
          truncatePriv: truncatePriv.trim().split("\n").pop(),
        },
      );

      // Engagement antérieur : legacy, jamais reconstitué (B est Free
      // aujourd'hui, A aussi : aucune valeur ne doit être déduite).
      await proofRpc("proof_l17d2_legacy", { p_days: prem.by.c1.dayIds });
      const pv = await http(
        "GET",
        `/api/jobs/${prem.jobId}/cancellation`,
        sess.b.cookie,
      );
      const pvDays = (pv.body.days as PreviewDay[] | undefined) ?? [];
      const lg = await cancelAt(
        prem.jobId,
        prem.by.c1.dayIds,
        [prem.by.c1.dayIds[0], prem.by.c1.dayIds[1]],
        ["2 hours", "26 hours"],
        false,
        REASON,
        randomUUID(),
        idB,
      );
      const lgRow = (await eventsOf(prem.jobId))[0];
      report(
        "T5 engagement antérieur : qualification « legacy » (délai inconnu), aucun plan reconstitué, annulation possible sans accord de tardiveté, aucune conséquence",
        pv.status === 200 &&
          pvDays.length === 2 &&
          pvDays.every(
            (d) =>
              d.classification === "legacy" &&
              d.company_plan === null &&
              d.cancellation_notice_hours === null,
          ) &&
          lg.error === null &&
          JSON.stringify(lg.classes) === JSON.stringify(["legacy", "legacy"]) &&
          lgRow?.legacy_count === 2 &&
          lgRow.late_count === 0,
        { pv: pv.status, pvDays, lg },
      );
    }

    // ── L. Limites exactes (qualification seule) ─────────────
    {
      const job = await fullPeriod(["c3"], 4, 40000, "Inventaire (limites)");
      const d = job.by.c3.dayIds;
      const exact = await proofRpc<string>("proof_l17d2_classify", {
        p_day: d[0],
        p_delta: "0",
      });
      const after = await proofRpc<string>("proof_l17d2_classify", {
        p_day: d[0],
        p_delta: "1 microsecond",
      });
      const before = await proofRpc<string>("proof_l17d2_classify", {
        p_day: d[0],
        p_delta: "-1 microsecond",
      });
      // Demande réelle : journée à exactement 48 h → dans le délai ; à
      // 48 h − 1 µs → tardive (accord exigé).
      const atLimit = await cancelAt(
        job.jobId,
        [d[0]],
        [d[0]],
        ["48 hours"],
        false,
      );
      const noAck = await cancelAt(
        job.jobId,
        [d[1]],
        [d[1]],
        ["48 hours -1 microsecond"],
        false,
      );
      const noAckRows = await cancelledDays([d[1]]);
      const lateAck = await cancelAt(
        job.jobId,
        [d[1]],
        [d[1]],
        ["48 hours -1 microsecond"],
        true,
      );
      report(
        "L1 Free : 48 h exactement → dans le délai (limite incluse) ; 1 µs après → tardive ; demande tardive sans accord refusée sans effet, puis enregistrée avec l'accord",
        exact === "in_time" &&
          before === "in_time" &&
          after === "late" &&
          atLimit.error === null &&
          JSON.stringify(atLimit.classes) === JSON.stringify(["in_time"]) &&
          noAck.error === "late_not_acknowledged" &&
          noAckRows.length === 0 &&
          lateAck.error === null &&
          JSON.stringify(lateAck.classes) === JSON.stringify(["late"]) &&
          lateAck.result?.late_count === 1,
        { exact, before, after, atLimit, noAck, lateAck },
      );
      grantCompanyPremium(DB_URL, {
        companyId: coA,
        adminUserId: idOps,
        endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        proof: PROOF,
      });
      const pj = await fullPeriod(["c4"], 2, 12000, "Inventaire (Premium)");
      stopCompanyPremium(coA, idOps);
      const pd = pj.by.c4.dayIds;
      const pExact = await cancelAt(
        pj.jobId,
        [pd[0]],
        [pd[0]],
        ["24 hours"],
        false,
      );
      const pLate = await cancelAt(
        pj.jobId,
        [pd[1]],
        [pd[1]],
        ["24 hours -1 microsecond"],
        true,
      );
      report(
        "L2 Premium (figé, arrêté depuis) : 24 h exactement → dans le délai ; 24 h − 1 µs → tardive",
        pExact.error === null &&
          JSON.stringify(pExact.classes) === JSON.stringify(["in_time"]) &&
          pLate.error === null &&
          JSON.stringify(pLate.classes) === JSON.stringify(["late"]),
        { pExact, pLate },
      );
      const rep = await proofRpc<{ breach_count: number }>("proof_l17d2_rep", {
        p_type: "company",
        p_id: coA,
      });
      const { count: companyIncidents } = await serviceClient
        .from("reputation_incidents")
        .select("id", { count: "exact", head: true })
        .eq("subject_id", coA);
      report(
        "L3 tardive sans conséquence : aucun manquement company_late_cancellation, aucun retrait (ANN-06, SAN-06 non appliqué)",
        companyIncidents === 0 && rep.breach_count === 0,
        { companyIncidents, rep },
      );
    }

    // ── A. Parcours : un événement, plusieurs journées et candidats ──
    let main3: Awaited<ReturnType<typeof fullPeriod>>;
    {
      main3 = await fullPeriod(["c5", "c6"], 3, 30000, "Hôtesses (salon)");
      const all = [...main3.by.c5.dayIds, ...main3.by.c6.dayIds];
      const contractsBefore = await snapshot([
        main3.by.c5.applicationId,
        main3.by.c6.applicationId,
      ]);
      const { data: jobBefore } = await serviceClient
        .from("jobs")
        .select("positions_filled")
        .eq("id", main3.jobId)
        .single();
      const repBefore = await proofRpc<{ experience_units: number }>(
        "proof_l17d2_rep",
        { p_type: "candidate", p_id: prof.c5 },
      );
      const pv = await http(
        "GET",
        `/api/jobs/${main3.jobId}/cancellation`,
        A.cookie,
      );
      const pvDays = (pv.body.days as PreviewDay[] | undefined) ?? [];
      const leak = /phone|email|cni|momo|address|Ngono|latitude/i;
      report(
        "A1 aperçu : 6 journées (3 dates × 2 candidats), prénom et initiale seulement, qualification et plan figé de l'entreprise, heure du serveur",
        pv.status === 200 &&
          pvDays.length === 6 &&
          pvDays.every(
            (d) =>
              d.state === "cancellable" &&
              d.classification === "in_time" &&
              d.company_plan === "free" &&
              d.last_initial === "N",
          ) &&
          !leak.test(JSON.stringify(pvDays)) &&
          typeof pv.body.server_now === "string",
        { status: pv.status, n: pvDays.length, sample: pvDays[0] },
      );

      const t0 = new Date().toISOString();
      const twoDates = [
        main3.by.c5.dayIds[1],
        main3.by.c6.dayIds[1],
        main3.by.c5.dayIds[2],
        main3.by.c6.dayIds[2],
      ];
      const rq = randomUUID();
      const res = await post(main3.jobId, {
        request_id: rq,
        day_ids: twoDates,
        reason: REASON,
        acknowledge_late: false,
      });
      const ev = await eventsOf(main3.jobId);
      const cd = await cancelledDays(all);
      const { data: ms } = await serviceClient
        .from("missions")
        .select("id, status, cancelled_by")
        .in("id", [main3.by.c5.missionId, main3.by.c6.missionId]);
      const { data: apps } = await serviceClient
        .from("job_applications")
        .select("status")
        .in("id", [main3.by.c5.applicationId, main3.by.c6.applicationId]);
      const n = await notifs([uid.c5, uid.c6]);
      const nCompany = (await notifs([idA])).filter(
        (x) => (x.data as { job_id?: string }).job_id === main3.jobId,
      );
      const au = await audits(main3.jobId);
      const msgC5 = await proofRpc<Record<string, unknown>[]>(
        "proof_l17d2_messages",
        { p_topic: `user:${uid.c5}`, p_since: t0 },
      );
      report(
        "A2 deux dates × deux candidats : un seul événement (4 journées, 2 dates, 2 candidats), missions toujours en cours (une journée restante), candidatures « selected », un avis par candidat, un audit",
        res.status === 200 &&
          ev.length === 1 &&
          ev[0].day_count === 4 &&
          ev[0].date_count === 2 &&
          ev[0].candidate_count === 2 &&
          ev[0].notified_users === 2 &&
          cd.length === 4 &&
          new Set(cd.map((x) => x.cancellation_id)).size === 1 &&
          (ms ?? []).every((m) => m.status !== "cancelled") &&
          (apps ?? []).every((a) => a.status === "selected") &&
          n.length === 2 &&
          new Set(n.map((x) => x.user_id)).size === 2 &&
          nCompany.length === 1 &&
          au.length === 1 &&
          msgC5.length > 0 &&
          msgC5.every((m) => Object.keys(m).every((k) => SIGNAL_KEYS.has(k))),
        {
          res: res.body,
          ev: ev.length,
          notified: ev[0]?.notified_users,
          cd: cd.length,
          ms,
          apps,
          n: n.length,
          nCompany: nCompany.length,
          audits: au.length,
          signals: msgC5,
        },
      );
      const bodies = JSON.stringify(n);
      report(
        "A3 avis aux candidats : offre et dates, non imputée au candidat ; sans motif, qualification, plan ni délai",
        !bodies.includes("salle indisponible") &&
          !/tardiv|late|premium|free|48 h|24 h|délai/i.test(
            n.map((x) => `${x.title} ${x.body}`).join(" "),
          ) &&
          /ne vous est pas imputée/.test(bodies),
        { sample: n[0]?.body },
      );

      // Dernière date : missions closes par l'entreprise.
      const last = [main3.by.c5.dayIds[0], main3.by.c6.dayIds[0]];
      const res2 = await post(main3.jobId, {
        request_id: randomUUID(),
        day_ids: last,
        reason: REASON,
        acknowledge_late: false,
      });
      const { data: ms2 } = await serviceClient
        .from("missions")
        .select("status, cancelled_by, cancellation_reason")
        .in("id", [main3.by.c5.missionId, main3.by.c6.missionId]);
      const { data: apps2 } = await serviceClient
        .from("job_applications")
        .select("status")
        .in("id", [main3.by.c5.applicationId, main3.by.c6.applicationId]);
      const { data: jobAfter } = await serviceClient
        .from("jobs")
        .select("positions_filled, status")
        .eq("id", main3.jobId)
        .single();
      const contractsAfter = await snapshot([
        main3.by.c5.applicationId,
        main3.by.c6.applicationId,
      ]);
      const repAfter = await proofRpc<{ experience_units: number }>(
        "proof_l17d2_rep",
        { p_type: "candidate", p_id: prof.c5 },
      );
      const { count: candIncidents } = await serviceClient
        .from("reputation_incidents")
        .select("id", { count: "exact", head: true })
        .in("subject_id", [prof.c5, prof.c6]);
      report(
        "A4 dernière date : missions annulées par l'entreprise (company_cancellation) ; candidature, place, contrat et réputation du candidat inchangés ; aucun manquement ; aucune réouverture",
        res2.status === 200 &&
          (ms2 ?? []).every(
            (m) =>
              m.status === "cancelled" &&
              m.cancelled_by === "company" &&
              m.cancellation_reason === "company_cancellation",
          ) &&
          (apps2 ?? []).every((a) => a.status === "selected") &&
          jobAfter?.positions_filled === jobBefore?.positions_filled &&
          contractsAfter === contractsBefore &&
          repAfter.experience_units === repBefore.experience_units &&
          candIncidents === 0 &&
          (await eventsOf(main3.jobId)).length === 2,
        { ms2, apps2, jobAfter, candIncidents },
      );

      // Vue du candidat : auteur de l'annulation, sans motif.
      const mv = await http(
        "GET",
        `/api/missions/${main3.by.c5.missionId}`,
        sess.c5.cookie,
      );
      const cpv = await sess.c5.client.rpc("candidate_cancellation_preview", {
        p_mission_id: main3.by.c5.missionId,
      });
      report(
        "A5 candidat : journées « annulées par l'entreprise » (cancelled_by), sans motif ni qualification ; plus aucune journée à annuler de son côté",
        mv.status === 200 &&
          /"cancelled_by":"company"/.test(mv.text) &&
          !mv.text.includes("salle indisponible") &&
          !/"classification"|"company_plan"/.test(mv.text) &&
          !cpv.error &&
          (cpv.data ?? []).length === 0,
        { mv: mv.status, cpv: cpv.error?.message ?? cpv.data?.length },
      );
    }

    // Période commencée : journée confirmée conservée, montant reconnu.
    {
      const job = await fullPeriod(["c1"], 3, 30000, "Plonge (période)");
      const d = job.by.c1.dayIds;
      await proofRpc("proof_l17d2_complete", { p_day: d[0] });
      const before = await snapshot([job.by.c1.applicationId]);
      const r = await cancelAt(job.jobId, [d[1], d[2]], [], [], false);
      const { data: m } = await serviceClient
        .from("missions")
        .select("status, cancelled_by, cancellation_reason")
        .eq("id", job.by.c1.missionId)
        .single();
      const { data: day0 } = await serviceClient
        .from("mission_days")
        .select("completion_source, actual_end_time")
        .eq("id", d[0])
        .single();
      const acq = await proofRpc<{
        acquired_exact: number;
        company_cancelled_days: number;
        status: string;
        contract_pay: number;
      }>("proof_l17d2_acquired", { p_mission: job.by.c1.missionId });
      report(
        "A6 période dont une journée est confirmée : journées futures annulées, mission close (company_cancellation_interrupted), journée confirmée et contrat intacts, montant reconnu des journées confirmées (10 000 sur 30 000), journées annulées signalées à part",
        r.error === null &&
          m?.status === "cancelled" &&
          m.cancelled_by === "company" &&
          m.cancellation_reason === "company_cancellation_interrupted" &&
          day0?.completion_source === "code" &&
          !!day0.actual_end_time &&
          (await snapshot([job.by.c1.applicationId])) === before &&
          Number(acq.acquired_exact) === 10000 &&
          acq.company_cancelled_days === 2 &&
          Number(acq.contract_pay) === 30000,
        { r, m, acq },
      );
    }

    // ── V. Refus sans effet ──────────────────────────────────
    {
      const job = await fullPeriod(["c2", "c3"], 2, 15000, "Accueil (refus)");
      const both = [job.by.c2.dayIds[0], job.by.c3.dayIds[0]];
      const short = await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: both,
        reason: "court",
        acknowledge_late: false,
      });
      const long = await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: both,
        reason: "x".repeat(501),
        acknowledge_late: false,
      });
      const rpcShort = await A.client.rpc("request_company_cancellation", {
        p_request_id: randomUUID(),
        p_job_id: job.jobId,
        p_day_ids: both,
        p_reason: "    court    ",
        p_acknowledge_late: false,
      });
      const targeted = await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: [job.by.c2.dayIds[0]],
        reason: REASON,
        acknowledge_late: false,
      });
      report(
        "V1 motif obligatoire (route et base), date partielle refusée (retrait ciblé d'un candidat : cancellation_preview_stale), aucun effet",
        short.status === 400 &&
          short.body.code === "cancellation_reason_required" &&
          long.status === 400 &&
          long.body.code === "cancellation_reason_too_long" &&
          rpcShort.error?.message === "cancellation_reason_required" &&
          targeted.status === 409 &&
          targeted.body.code === "cancellation_preview_stale" &&
          (await eventsOf(job.jobId)).length === 0 &&
          (await cancelledDays([...job.by.c2.dayIds, ...job.by.c3.dayIds]))
            .length === 0,
        {
          short: short.body,
          long: long.body,
          rpc: rpcShort.error?.message,
          targeted: targeted.body,
        },
      );

      // Début atteint, journée commencée, journée confirmée.
      const k = await fullPeriod(["c4"], 3, 15000, "Accueil (commencée)");
      const kd = k.by.c4.dayIds;
      await proofRpc("proof_l17d2_shift", {
        p_days: [kd[0]],
        p_delta: "-5 minutes",
      });
      const begunPv = await http(
        "GET",
        `/api/jobs/${k.jobId}/cancellation`,
        A.cookie,
      );
      const begun = await cancelAt(k.jobId, [kd[0]], [], [], true);
      await proofRpc("proof_l17d2_shift", {
        p_days: [kd[1]],
        p_delta: "10 minutes",
      });
      const st = await sess.c4.client.rpc("start_mission", {
        p_mission_id: k.by.c4.missionId,
        p_mission_day_id: kd[1],
      });
      const started = await cancelAt(k.jobId, [kd[1]], [], [], true);
      await proofRpc("proof_l17d2_complete", { p_day: kd[2] });
      const done = await cancelAt(k.jobId, [kd[2]], [], [], true);
      const bpv = (begunPv.body.days as PreviewDay[] | undefined) ?? [];
      report(
        "V2 début prévu atteint → day_already_begun (aperçu « begun ») ; journée commencée → day_started ; journée confirmée → day_started (absente de l'aperçu) ; aucun effet",
        begun.error === "day_already_begun" &&
          bpv.find((x) => x.mission_day_id === kd[0])?.state === "begun" &&
          !st.error &&
          started.error === "day_started" &&
          done.error === "day_started" &&
          (await cancelledDays(kd)).length === 0,
        {
          begun: begun.error,
          st: st.error?.message,
          started: started.error,
          done: done.error,
        },
      );
    }

    // ── I. Relances et concurrence ───────────────────────────
    {
      const job = await fullPeriod(["c5"], 4, 20000, "Vestiaire (relances)");
      const d = job.by.c5.dayIds;
      const rq = randomUUID();
      const body = {
        request_id: rq,
        day_ids: [d[0]],
        reason: REASON,
        acknowledge_late: false,
      };
      const r1 = await post(job.jobId, body);
      const r2 = await post(job.jobId, body);
      const conflict = await post(job.jobId, { ...body, day_ids: [d[1]] });
      report(
        "I1 relance de la même demande : même résultat (already_recorded), un seul événement, un seul avis ; clé réutilisée pour d'autres journées → request_conflict",
        r1.status === 200 &&
          r2.status === 200 &&
          (r2.body.cancellation as CancelResult).already_recorded === true &&
          (r2.body.cancellation as CancelResult).cancellation_id ===
            (r1.body.cancellation as CancelResult).cancellation_id &&
          (await eventsOf(job.jobId)).length === 1 &&
          (await notifs([uid.c5])).filter(
            (x) =>
              (x.data as { cancellation_id?: string }).cancellation_id ===
              (r1.body.cancellation as CancelResult).cancellation_id,
          ).length === 1 &&
          conflict.status === 409 &&
          conflict.body.code === "request_conflict",
        { r1: r1.body, r2: r2.body, conflict: conflict.body },
      );
      const same = randomUUID();
      const five = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(job.jobId, {
            request_id: same,
            day_ids: [d[1]],
            reason: REASON,
            acknowledge_late: false,
          }),
        ),
      );
      const twoDiff = await Promise.all(
        [randomUUID(), randomUUID()].map((r) =>
          post(job.jobId, {
            request_id: r,
            day_ids: [d[2]],
            reason: REASON,
            acknowledge_late: false,
          }),
        ),
      );
      const evs = await eventsOf(job.jobId);
      report(
        "I2 cinq envois simultanés de la même demande → un événement ; deux demandes distinctes sur la même journée → une seule enregistrée, l'autre day_already_cancelled",
        five.every((x) => x.status === 200) &&
          five.filter(
            (x) =>
              (x.body.cancellation as CancelResult).already_recorded === false,
          ).length === 1 &&
          twoDiff.filter((x) => x.status === 200).length === 1 &&
          twoDiff.filter(
            (x) => x.status === 409 && x.body.code === "day_already_cancelled",
          ).length === 1 &&
          evs.length === 3 &&
          (await cancelledDays([d[2]])).length === 1,
        {
          five: five.map((x) => x.status),
          twoDiff: twoDiff.map((x) => x.body.code ?? x.status),
          events: evs.length,
        },
      );
    }

    // ── R. Courses avec le candidat ──────────────────────────
    {
      const job = await fullPeriod(["c6"], 3, 18000, "Service (courses)");
      const d = job.by.c6.dayIds;
      await proofRpc("proof_l17d2_shift", {
        p_days: [d[0]],
        p_delta: "10 minutes",
      });
      const [start, cancel] = await Promise.all([
        sess.c6.client.rpc("start_mission", {
          p_mission_id: job.by.c6.missionId,
          p_mission_day_id: d[0],
        }),
        post(job.jobId, {
          request_id: randomUUID(),
          day_ids: [d[0]],
          reason: REASON,
          acknowledge_late: true,
        }),
      ]);
      const { data: day0 } = await serviceClient
        .from("mission_days")
        .select("actual_start_time")
        .eq("id", d[0])
        .single();
      const c0 = (await cancelledDays([d[0]])).length;
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
        "R1 début et annulation par l'entreprise simultanés : une seule issue",
        startWon !== cancelWon,
        { start: start.error?.message ?? "ok", cancel: cancel.body, c0 },
      );

      // Désistement du candidat et annulation de l'entreprise simultanés.
      const [cand, comp] = await Promise.all([
        http(
          "POST",
          `/api/missions/${job.by.c6.missionId}/cancellation`,
          sess.c6.cookie,
          {
            request_id: randomUUID(),
            day_ids: [d[1]],
            reason_code: null,
            reason_text: null,
            evidence_choice: null,
          },
        ),
        post(job.jobId, {
          request_id: randomUUID(),
          day_ids: [d[1]],
          reason: REASON,
          acknowledge_late: false,
        }),
      ]);
      const inCand = (
        await serviceClient
          .from("candidate_cancellation_days")
          .select("mission_day_id")
          .eq("mission_day_id", d[1])
      ).data?.length;
      const inComp = (await cancelledDays([d[1]])).length;
      report(
        "R2 désistement du candidat et annulation de l'entreprise simultanés : une seule annulation enregistrée, l'autre refusée (day_already_cancelled)",
        inCand! + inComp === 1 &&
          [cand, comp].filter((x) => x.status === 200).length === 1 &&
          [cand, comp].some((x) => x.body.code === "day_already_cancelled"),
        { cand: cand.body, comp: comp.body, inCand, inComp },
      );

      // Journée annulée par l'entreprise, puis tentatives.
      await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: [d[2]],
        reason: REASON,
        acknowledge_late: true,
      });
      await proofRpc("proof_l17d2_shift", {
        p_days: [d[2]],
        p_delta: "-1 hour",
      });
      const st = await sess.c6.client.rpc("start_mission", {
        p_mission_id: job.by.c6.missionId,
        p_mission_day_id: d[2],
      });
      const direct = await serviceClient
        .from("mission_days")
        .update({
          completion_source: "support",
          actual_end_time: new Date().toISOString(),
        })
        .eq("id", d[2])
        .select("id");
      const absence = await A.client.rpc("report_mission_incident", {
        p_mission_id: job.by.c6.missionId,
        p_mission_day_id: d[2],
        p_kind: "absence",
        p_statement: "Le candidat n'est pas venu (journée annulée).",
      });
      const { data: dd } = await serviceClient
        .from("mission_days")
        .select("starts_at")
        .eq("id", d[2])
        .single();
      const noShow = await serviceClient
        .from("reputation_incidents")
        .insert({
          subject_type: "candidate",
          subject_id: prof.c6,
          kind: "candidate_no_show",
          source: "support_decision",
          mission_id: job.by.c6.missionId,
          scheduled_start_at: dd!.starts_at,
          occurred_at: new Date().toISOString(),
        })
        .select("id");
      const late = await serviceClient
        .from("reputation_incidents")
        .insert({
          subject_type: "candidate",
          subject_id: prof.c6,
          kind: "candidate_late_cancellation",
          source: "support_decision",
          mission_id: job.by.c6.missionId,
          scheduled_start_at: dd!.starts_at,
          occurred_at: new Date().toISOString(),
        })
        .select("id");
      report(
        "R3 journée annulée par l'entreprise : début refusé (day_cancelled), confirmation refusée même en clé service, signalement d'absence refusé, absence ou annulation tardive du candidat refusées (jamais une faute du candidat)",
        st.error?.message === "day_cancelled" &&
          !!direct.error &&
          /day_cancelled/.test(direct.error.message) &&
          absence.error?.message === "day_cancelled" &&
          !!noShow.error &&
          /incident_conflicts_with_company_cancellation/.test(
            noShow.error.message,
          ) &&
          !!late.error &&
          /incident_conflicts_with_company_cancellation/.test(
            late.error.message,
          ),
        {
          st: st.error?.message,
          direct: direct.error?.message,
          absence: absence.error?.message,
          noShow: noShow.error?.message,
          late: late.error?.message,
        },
      );
    }

    // ── P. Panne en cours de transaction ─────────────────────
    {
      const job = await fullPeriod(["c1", "c2"], 2, 16000, "Buffet (panne)");
      const all = [...job.by.c1.dayIds, ...job.by.c2.dayIds];
      execSql(`
        create or replace function public.proof_l17d2_fail_audit() returns trigger
        language plpgsql as $$ begin
          if new.resource_id = '${job.jobId}'::uuid and new.action = 'company_cancellation' then
            raise exception 'proof_l17d2_forced_failure';
          end if;
          return new;
        end $$`);
      execSql(
        "create trigger proof_l17d2_fail_audit before insert on public.audit_logs for each row execute function public.proof_l17d2_fail_audit()",
      );
      const n0 = (await notifs([uid.c1, uid.c2, idA])).length;
      const fail = await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: all,
        reason: REASON,
        acknowledge_late: false,
      });
      execSql(
        "drop trigger if exists proof_l17d2_fail_audit on public.audit_logs",
      );
      const { data: ms } = await serviceClient
        .from("missions")
        .select("status")
        .in("id", [job.by.c1.missionId, job.by.c2.missionId]);
      report(
        "P1 panne de l'audit : réponse 500 générique, aucun événement, aucune journée annulée, aucun avis, missions inchangées",
        fail.status === 500 &&
          !/proof_l17d2_forced_failure/.test(fail.text) &&
          (await eventsOf(job.jobId)).length === 0 &&
          (await cancelledDays(all)).length === 0 &&
          (await notifs([uid.c1, uid.c2, idA])).length === n0 &&
          (ms ?? []).every((m) => m.status !== "cancelled"),
        { fail: fail.status, body: fail.body },
      );
      const retry = await post(job.jobId, {
        request_id: randomUUID(),
        day_ids: all,
        reason: REASON,
        acknowledge_late: false,
      });
      report(
        "P2 après la panne, nouvelle demande enregistrée normalement",
        retry.status === 200 && (await eventsOf(job.jobId)).length === 1,
        { retry: retry.body },
      );
    }

    // ── F. Créneau libéré (décision du 2026-11-22, ECH-04) ──────
    {
      const mkJob = async (
        title: string,
        days: FixtureDay[],
        format: "full_period" | "per_day" = "full_period",
        company = coA,
      ) =>
        (
          await insertJobWithDays(
            serviceClient,
            {
              ...CONTENT,
              title,
              company_id: company,
              mission_pay_per_candidate: 10000,
              positions_available: 1,
            },
            days,
            format,
          )
        ).jobId;
      const applyTo = (k: K, jobId: string) =>
        sess[k].client.rpc("apply_to_job", { p_job_id: jobId });
      const compatible = async (k: K, jobId: string) =>
        (
          (
            await sess[k].client.rpc("job_days_for_candidate", {
              p_job_id: jobId,
            })
          ).data ?? []
        ).map((d) => d.schedule_compatible);
      const daysOfMission = async (missionId: string) =>
        (
          await serviceClient
            .from("mission_days")
            .select("id, scheduled_date")
            .eq("mission_id", missionId)
            .order("scheduled_date")
        ).data ?? [];
      const day = (date: string, start: string, end: string): FixtureDay => ({
        date,
        start_time: start,
        end_time: end,
      });

      // F1 période complète : seule la date annulée cesse de bloquer.
      const [D1, D2, D3] = [nextDate(), nextDate(), nextDate()];
      const j1 = await mkJob(
        "Période (créneau)",
        [D1, D2, D3].map((d) => day(d, "08:00", "14:00")),
      );
      const { data: app1 } = await applyTo("c1", j1);
      const sel1 = await signAndSelectRpc(A.client, app1!.id);
      const m1 = (sel1.data as { mission_id: string }[])[0].mission_id;
      const md1 = await daysOfMission(m1);
      // J2 : le jour D2, 2 h après la fin (dans la marge de 3 h) ;
      // J3 : le jour D1 ; J4 : le jour D3, 1 h avant le début.
      const j2 = await mkJob("Soirée D2", [day(D2, "16:00", "18:00")]);
      const j3 = await mkJob("Soirée D1", [day(D1, "16:00", "18:00")]);
      const j4 = await mkJob("Matin D3", [day(D3, "06:00", "07:00")]);
      const before = await compatible("c1", j2);
      const applyBefore = await applyTo("c1", j2);
      const contractBefore = await snapshot([app1!.id]);
      const cancel = await post(j1, {
        request_id: randomUUID(),
        day_ids: [md1[1].id],
        reason: REASON,
        acknowledge_late: false,
      });
      const after = await compatible("c1", j2);
      const applyAfter = await applyTo("c1", j2);
      const still3 = await compatible("c1", j3);
      const still4 = await compatible("c1", j4);
      const { data: app1After } = await serviceClient
        .from("job_applications")
        .select("status")
        .eq("id", app1!.id)
        .single();
      const termsKept = await terms(md1[1].id);
      report(
        "F1 période complète : la date annulée par l'entreprise et sa marge de 3 h ne bloquent plus (aperçu et candidature) ; les deux autres journées et leur marge bloquent toujours ; contrat, candidature et conditions figées conservés",
        JSON.stringify(before) === "[false]" &&
          applyBefore.error?.message === "schedule_conflict" &&
          cancel.status === 200 &&
          JSON.stringify(after) === "[true]" &&
          !applyAfter.error &&
          JSON.stringify(still3) === "[false]" &&
          JSON.stringify(still4) === "[false]" &&
          app1After?.status === "selected" &&
          termsKept?.terms_source === "selection" &&
          (await snapshot([app1!.id])) === contractBefore,
        {
          before,
          applyBefore: applyBefore.error?.message,
          after,
          applyAfter: applyAfter.error?.message ?? "ok",
          still3,
          still4,
        },
      );
      // Aucune place rouverte : un autre candidat ne peut être sélectionné.
      const { data: otherApp, error: otherApply } = await applyTo("c2", j1);
      const otherSel = otherApp
        ? await signAndSelectRpc(A.client, otherApp.id)
        : null;
      const { data: j1Row } = await serviceClient
        .from("jobs")
        .select("positions_filled")
        .eq("id", j1)
        .single();
      report(
        "F2 libération du créneau sans réouverture : la place de l'offre reste occupée (candidature ou sélection d'un autre candidat refusée)",
        (!!otherApply || !!otherSel?.error) && j1Row?.positions_filled === 1,
        {
          apply: otherApply?.message,
          select: otherSel?.error?.message,
          filled: j1Row?.positions_filled,
        },
      );

      // F3 journées au choix, annulation par le candidat tardive avec
      // justificatif annoncé : libérée avant toute décision du support.
      const [E1, E2] = [nextDate(), nextDate()];
      const j5 = await mkJob(
        "Au choix (créneau)",
        [
          { ...day(E1, "08:00", "14:00"), pay: 9000, positions: 1 },
          { ...day(E2, "08:00", "14:00"), pay: 9000, positions: 1 },
        ],
        "per_day",
      );
      const { data: j5Days } = await serviceClient
        .from("job_days")
        .select("id")
        .eq("job_id", j5)
        .order("day_date");
      await sess.c3.client.rpc("apply_to_job_days", {
        p_job_id: j5,
        p_day_ids: j5Days!.map((d) => d.id),
      });
      const { data: apps5 } = await serviceClient
        .from("job_applications")
        .select("id, job_day_id")
        .eq("job_id", j5)
        .eq("candidate_id", prof.c3);
      const perDayMissions: string[] = [];
      for (const jd of j5Days!) {
        const a = apps5!.find((x) => x.job_day_id === jd.id)!;
        const sel = await signAndSelectRpc(A.client, a.id);
        perDayMissions.push(
          (sel.data as { mission_id: string }[])[0].mission_id,
        );
      }
      const e1Day = (await daysOfMission(perDayMissions[0]))[0].id;
      // Journée E1 placée demain 10:00 (heure de Douala) : hors délai du
      // candidat ; sélection antidatée (sinon délai de réaction).
      const tomorrow = new Date(Date.now() + 86_400_000 + 3_600_000)
        .toISOString()
        .slice(0, 10);
      await proofRpc("proof_l17d2_place", {
        p_day: e1Day,
        p_at: `${tomorrow}T09:00:00Z`,
      });
      await proofRpc("proof_l17d2_age", { p_days: [e1Day] });
      const j6 = await mkJob(
        "Demain (créneau)",
        [day(tomorrow, "11:00", "12:00")],
        "full_period",
        coB,
      );
      const j7 = await mkJob("E2 (créneau)", [day(E2, "15:00", "16:00")]);
      const before6 = await compatible("c3", j6);
      const candCancel = await http(
        "POST",
        `/api/missions/${perDayMissions[0]}/cancellation`,
        sess.c3.cookie,
        {
          request_id: randomUUID(),
          day_ids: [e1Day],
          reason_code: "illness",
          reason_text: null,
          evidence_choice: "provided",
        },
      );
      const after6 = await compatible("c3", j6);
      const apply6 = await applyTo("c3", j6);
      const still7 = await compatible("c3", j7);
      report(
        "F3 journées au choix, désistement tardif avec justificatif en attente : la journée annulée ne bloque plus, avant toute décision ; l'autre journée bloque toujours",
        JSON.stringify(before6) === "[false]" &&
          candCancel.status === 200 &&
          (candCancel.body.cancellation as { status: string }).status ===
            "awaiting_evidence" &&
          JSON.stringify(after6) === "[true]" &&
          !apply6.error &&
          JSON.stringify(still7) === "[false]",
        {
          before6,
          cancel: candCancel.body,
          after6,
          apply6: apply6.error?.message ?? "ok",
          still7,
        },
      );

      // F3b période complète, désistement tardif du candidat sur une seule
      // journée (justificatif annoncé, aucune décision) : cette journée ne
      // bloque plus, la suivante bloque toujours (mission toujours en cours).
      const P2 = nextDate();
      const jp = await mkJob(
        "Période (désistement partiel)",
        [day(tomorrow, "08:00", "14:00"), day(P2, "08:00", "14:00")],
        "full_period",
        coB,
      );
      const { data: appP } = await applyTo("c5", jp);
      const selP = await signAndSelectRpc(sess.b.client, appP!.id);
      const mP = (selP.data as { mission_id: string }[])[0].mission_id;
      const dP = await daysOfMission(mP);
      await proofRpc("proof_l17d2_age", { p_days: dP.map((d) => d.id) });
      const jq = await mkJob("Demain après-midi", [
        day(tomorrow, "15:00", "16:00"),
      ]);
      const jr = await mkJob("P2 après-midi", [day(P2, "15:00", "16:00")]);
      const beforeQ = await compatible("c5", jq);
      const partial = await http(
        "POST",
        `/api/missions/${mP}/cancellation`,
        sess.c5.cookie,
        {
          request_id: randomUUID(),
          day_ids: [dP[0].id],
          reason_code: "transport",
          reason_text: null,
          evidence_choice: "provided",
        },
      );
      const { data: mPRow } = await serviceClient
        .from("missions")
        .select("status")
        .eq("id", mP)
        .single();
      const afterQ = await compatible("c5", jq);
      const applyQ = await applyTo("c5", jq);
      const stillR = await compatible("c5", jr);
      report(
        "F3b période complète, désistement tardif du candidat sur une journée (justificatif en attente) : cette journée et sa marge ne bloquent plus, la journée restante bloque toujours ; mission toujours en cours",
        JSON.stringify(beforeQ) === "[false]" &&
          partial.status === 200 &&
          (partial.body.cancellation as { status: string }).status ===
            "awaiting_evidence" &&
          mPRow?.status !== "cancelled" &&
          JSON.stringify(afterQ) === "[true]" &&
          !applyQ.error &&
          JSON.stringify(stillR) === "[false]",
        {
          beforeQ,
          partial: partial.body,
          mission: mPRow?.status,
          afterQ,
          applyQ: applyQ.error?.message ?? "ok",
          stillR,
        },
      );

      // F4 annulation non effective (refusée), puis en cours face à une
      // sélection définitive : le créneau reste bloqué tant qu'elle n'est
      // pas enregistrée.
      const G = nextDate();
      const j8 = await mkJob(
        "Offre B (course)",
        [day(G, "08:00", "14:00")],
        "full_period",
        coB,
      );
      const { data: app8 } = await applyTo("c4", j8);
      // Période de deux journées : seule la première est annulée, la
      // mission reste en cours (le statut de mission ne libère rien).
      const j9 = await mkJob("Offre A (course)", [
        day(G, "09:00", "13:00"),
        day(nextDate(), "09:00", "13:00"),
      ]);
      const { data: app9 } = await applyTo("c4", j9);
      const sel9 = await signAndSelectRpc(A.client, app9!.id);
      const m9 = (sel9.data as { mission_id: string }[])[0].mission_id;
      const g9 = (await daysOfMission(m9))[0].id;
      const refused = await post(j9, {
        request_id: randomUUID(),
        day_ids: [g9],
        reason: "court",
        acknowledge_late: false,
      });
      const blocked = await signAndSelectRpc(sess.b.client, app8!.id);
      await installBarrier(execSql, serviceRpc);
      execSql(`
        create or replace function public.proof_l17d2_slow_cancel() returns trigger
        language plpgsql as $$ begin
          if new.mission_day_id = '${g9}'::uuid then perform pg_sleep(1.5); end if;
          return new;
        end $$`);
      execSql(
        "create trigger proof_l17d2_slow_cancel after insert on public.company_cancellation_days for each row execute function public.proof_l17d2_slow_cancel()",
      );
      const inflight = post(j9, {
        request_id: randomUUID(),
        day_ids: [g9],
        reason: REASON,
        acknowledge_late: false,
      });
      await waitSleeping(serviceRpc);
      const during = await signAndSelectRpc(sess.b.client, app8!.id);
      const done = await inflight;
      execSql(
        "drop trigger if exists proof_l17d2_slow_cancel on public.company_cancellation_days",
      );
      dropBarrier(execSql);
      const afterSel = await signAndSelectRpc(sess.b.client, app8!.id);
      const { count: c4Missions } = await serviceClient
        .from("missions")
        .select("id", { count: "exact", head: true })
        .eq("job_id", j8);
      report(
        "F4 annulation refusée (motif) : créneau toujours bloqué ; annulation en cours pendant la sélection définitive : sélection refusée (candidate_schedule_conflict) ; une fois enregistrée : sélection acceptée, une seule mission",
        refused.status === 400 &&
          /schedule_conflict/.test(blocked.error?.message ?? "") &&
          /schedule_conflict/.test(during.error?.message ?? "") &&
          done.status === 200 &&
          !afterSel.error &&
          c4Missions === 1,
        {
          refused: refused.body.code,
          blocked: blocked.error?.message,
          during: during.error?.message,
          done: done.status,
          afterSel: afterSel.error?.message ?? "ok",
          c4Missions,
        },
      );

      // F5 compte suspendu : la libération ne le réactive pas.
      const H = nextDate();
      const j10 = await mkJob("Suspendu (créneau)", [day(H, "08:00", "14:00")]);
      const { data: app10 } = await applyTo("c6", j10);
      const sel10 = await signAndSelectRpc(A.client, app10!.id);
      const m10 = (sel10.data as { mission_id: string }[])[0].mission_id;
      const j11 = await mkJob("Après suspension", [day(H, "10:00", "12:00")]);
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", uid.c6);
      const c10 = await post(j10, {
        request_id: randomUUID(),
        day_ids: [(await daysOfMission(m10))[0].id],
        reason: REASON,
        acknowledge_late: false,
      });
      const apply11 = await applyTo("c6", j11);
      const { data: u6 } = await serviceClient
        .from("users")
        .select("is_active")
        .eq("id", uid.c6)
        .single();
      await serviceClient
        .from("users")
        .update({ is_active: true })
        .eq("id", uid.c6);
      report(
        "F5 candidat suspendu : journée annulée et créneau libéré, mais candidature toujours refusée (account_suspended) et compte resté suspendu",
        c10.status === 200 &&
          apply11.error?.message === "account_suspended" &&
          u6?.is_active === false,
        { c10: c10.status, apply11: apply11.error?.message, active: u6 },
      );

      // S. Calendrier figé pour tout auteur applicatif, clé service comprise.
      const k = (await daysOfMission(m1))[2];
      const svcDay = await serviceClient
        .from("mission_days")
        .update({ scheduled_start_time: "09:00" })
        .eq("id", k.id)
        .select("id");
      const svcStarts = await serviceClient
        .from("mission_days")
        .update({ starts_at: new Date().toISOString() })
        .eq("id", k.id)
        .select("id");
      const svcMission = await serviceClient
        .from("missions")
        .update({ scheduled_date: nextDate() })
        .eq("id", m10)
        .select("id");
      const { data: jd } = await serviceClient
        .from("job_days")
        .select("id")
        .eq("job_id", j1)
        .limit(1)
        .single();
      const svcJobDay = await serviceClient
        .from("job_days")
        .update({ start_time: "09:00" })
        .eq("id", jd!.id)
        .select("id");
      const { data: kAfter } = await serviceClient
        .from("mission_days")
        .select("scheduled_date, scheduled_start_time")
        .eq("id", k.id)
        .single();
      report(
        "S1 horaires d'une journée de mission, de son début calculé, d'une mission et d'une journée publiée : modification refusée en clé service avant le début (mission_schedule_locked, job_schedule_locked) ; valeurs intactes",
        /mission_schedule_locked/.test(svcDay.error?.message ?? "") &&
          /mission_schedule_locked/.test(svcStarts.error?.message ?? "") &&
          /mission_schedule_locked/.test(svcMission.error?.message ?? "") &&
          /job_schedule_locked/.test(svcJobDay.error?.message ?? "") &&
          kAfter?.scheduled_date === D3 &&
          String(kAfter?.scheduled_start_time).startsWith("08:00"),
        {
          day: svcDay.error?.message,
          starts: svcStarts.error?.message,
          mission: svcMission.error?.message,
          jobDay: svcJobDay.error?.message,
          kAfter,
        },
      );

      // M. Motif : entreprise et administration seulement.
      const adm = await sess.ops.client.rpc("admin_company_cancellations", {
        p_job_id: j1,
      });
      const candAdm = await sess.c1.client.rpc("admin_company_cancellations", {
        p_job_id: j1,
      });
      const coAdm = await sess.b.client.rpc("admin_company_cancellations", {
        p_job_id: j1,
      });
      const mine = await http("GET", `/api/jobs/${j1}/cancellation`, A.cookie);
      const candView = await http("GET", `/api/missions/${m1}`, sess.c1.cookie);
      const candNotifs = JSON.stringify(await notifs([uid.c1]));
      report(
        "M1 motif lu par l'administration active et par l'entreprise, refusé au candidat et à une autre entreprise ; absent de la vue et des avis du candidat",
        JSON.stringify(adm.data ?? []).includes(REASON) &&
          candAdm.error?.message === "forbidden" &&
          coAdm.error?.message === "forbidden" &&
          mine.text.includes(REASON) &&
          candView.status === 200 &&
          !candView.text.includes(REASON) &&
          !candNotifs.includes(REASON),
        {
          adm: adm.error?.message ?? (adm.data as unknown[] | null)?.length,
          cand: candAdm.error?.message,
          co: coAdm.error?.message,
        },
      );
    }

    // ── D. Droits ────────────────────────────────────────────
    {
      const job = await fullPeriod(["c3"], 1, 9000, "Accueil (droits)");
      const day = job.by.c3.dayIds;
      const body = {
        request_id: randomUUID(),
        day_ids: day,
        reason: REASON,
        acknowledge_late: true,
      };
      const other = await post(job.jobId, body, sess.b.cookie);
      const otherPv = await http(
        "GET",
        `/api/jobs/${job.jobId}/cancellation`,
        sess.b.cookie,
      );
      const cand = await post(job.jobId, body, sess.c3.cookie);
      const admin = await post(job.jobId, body, sess.ops.cookie);
      const noSession = await post(job.jobId, body, null);
      const anonRpc = await anon.rpc("request_company_cancellation", {
        p_request_id: randomUUID(),
        p_job_id: job.jobId,
        p_day_ids: day,
        p_reason: REASON,
        p_acknowledge_late: true,
      });
      // Compte suspendu : session encore valide, compte inactif.
      const sj = await fullPeriod(
        ["c4"],
        1,
        9000,
        "Accueil (suspendue)",
        coS,
        sess.s,
      );
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", idS);
      const susp = await post(
        sj.jobId,
        { ...body, request_id: randomUUID(), day_ids: sj.by.c4.dayIds },
        sess.s.cookie,
      );
      await serviceClient
        .from("users")
        .update({ is_active: true })
        .eq("id", idS);
      report(
        "D1 refus par rôle : autre entreprise (job_not_found, aperçu compris), candidat et admin (not_a_company), sans session (401), anonyme (refus), compte suspendu (account_suspended) ; aucun effet",
        other.status === 404 &&
          other.body.code === "job_not_found" &&
          otherPv.status === 404 &&
          cand.status === 403 &&
          cand.body.code === "not_a_company" &&
          admin.status === 403 &&
          admin.body.code === "not_a_company" &&
          noSession.status === 401 &&
          !!anonRpc.error &&
          susp.status === 403 &&
          susp.body.code === "account_suspended" &&
          (await eventsOf(job.jobId)).length === 0 &&
          (await eventsOf(sj.jobId)).length === 0,
        {
          other: other.body,
          cand: cand.body,
          admin: admin.body,
          noSession: noSession.status,
          anon: anonRpc.error?.message,
          susp: susp.body,
        },
      );
      const direct = await Promise.all(
        ["company_cancellations", "company_cancellation_days"].map(
          async (t) => {
            const sel = await A.client.from(t as never).select("*");
            const ins = await serviceClient
              .from(t as "company_cancellations")
              .insert({} as never)
              .select("*");
            return {
              t,
              sel: sel.error?.message ?? (sel.data ?? []).length,
              ins: ins.error?.message ?? "inserted",
            };
          },
        ),
      );
      const upd = await serviceClient
        .from("company_cancellations")
        .update({ reason: "Motif modifié en clé service." })
        .eq("job_id", main3.jobId)
        .select("id");
      const del = await serviceClient
        .from("company_cancellations")
        .delete()
        .eq("job_id", main3.jobId)
        .select("id");
      report(
        "D2 événements et journées annulées : fermés aux sessions ; insertion, modification et suppression refusées en clé service",
        direct.every(
          (x) =>
            (typeof x.sel === "string" || x.sel === 0) && x.ins !== "inserted",
        ) &&
          !!upd.error &&
          !!del.error &&
          (await eventsOf(main3.jobId)).length === 2,
        { direct, upd: upd.error?.message, del: del.error?.message },
      );
      const fns = execSql(
        "select string_agg(p.proname || '=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('company_cancellation_classify','company_cancellation_actor','record_mission_day_company_terms','mission_day_cancelled_by','request_company_cancellation','company_cancellation_preview')",
      );
      report(
        "D3 fonctions internes non exécutables en session (qualification, contrôle, enregistrement des conditions) ; aperçu et demande exposés",
        /company_cancellation_actor=false/.test(fns) &&
          /company_cancellation_classify=false/.test(fns) &&
          /company_cancellation_preview=true/.test(fns) &&
          /mission_day_cancelled_by=false/.test(fns) &&
          /record_mission_day_company_terms=false/.test(fns) &&
          /request_company_cancellation=true/.test(fns),
        { fns: fns.trim().split("\n").pop() },
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
