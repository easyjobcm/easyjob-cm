/**
 * Preuve lot 12 — offres de plusieurs journées (dates choisies une à une).
 *
 * Données fictives, pile locale uniquement. Vraies sessions : entreprises A
 * (plan Pro) et B, candidats C1 à C7, admin ops O1, client anonyme. Les
 * routes de l'application sont appelées quand elles existent ; sinon la RPC
 * sous l'identité de la session.
 *
 *   K. Calendrier : dates non consécutives, horaires communs ou propres,
 *      journée qui traverse minuit, refus (doublon, chevauchement, début =
 *      fin, plus de 31, montants, intervalle sans journées), parcours d'une
 *      seule journée, écritures directes.
 *   P. Publication : régime de la période fondé sur le premier début ;
 *      régime et échéance propres à chaque journée au choix ; refus tout ou
 *      rien avec les journées nommées ; calendrier figé (ajout, retrait,
 *      horaires, format) pour tout auteur ; mêmes journées acceptées ; offre
 *      antérieure à intervalle (job_days_missing).
 *   A. Candidatures : période complète ; journées au choix (tout ou rien,
 *      journées bloquantes nommées), candidature ultérieure aux journées
 *      restantes, retrait d'une journée, aucune réouverture, doubles
 *      soumissions, aucune place réservée.
 *   E. Échéances par journée à la microseconde (avant, exactement, après),
 *      candidature et sélection ; nouvelle approbation sans réouverture.
 *   S. Sélection : capacité par journée (dernière place disputée), mission
 *      globale, codes distincts, contrat figé (format, journées, montant non
 *      divisé, devise, empreinte), signature.
 *   C. Conflits : 3 h exactement admis, 3 h − 1 µs refusé, chevauchement,
 *      une journée d'une période suffit à refuser l'ensemble, journées d'une
 *      même mission non distinctes, deux entreprises en course (ordre
 *      imposé), aucun détail révélé à l'entreprise.
 *   M. Réalisation : début par journée (H−15), code d'une autre journée ou
 *      d'un autre candidat refusé, blocage par journée, mission non terminée
 *      après une journée, évaluation après la dernière, réputation sans
 *      double comptage (candidat et entreprise), confidentialité des codes
 *      (candidat, tiers, notifications, Realtime), écritures directes.
 *   Q. Réputation entreprise : +1 par offre seulement quand un travail est
 *      confirmé, tous les engagements résolus et le recrutement clos.
 *   V. Choix confirmés : contrat formalisé dès trois journées du même
 *      contrat, 31 journées travaillées au plus, conflits détectés dès la
 *      candidature sur les seuls engagements sélectionnés.
 *   W. Conflit expliqué avant l'envoi : compatibilité de chaque journée lue
 *      par le candidat (même fonction que la candidature et la sélection),
 *      candidature en attente non bloquante, limite exacte de 3 h, écran
 *      périmé refusé sans écriture partielle, confidentialité des réponses
 *      et des signaux.
 *   D. Suspension du candidat et de l'entreprise, dossier entreprise.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database, Json } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectRpc } from "./lib/sign-and-select";
import { signAndSelectHttp } from "./lib/sign-and-select";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { addDays, insertJobWithDays } from "./lib/job-days-fixture";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type AnyRpc = Pick<SupabaseClient, "rpc">;

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L12-multiday-01!";
const PROOF_USER_METADATA = { proofMultiDayJobs: true };
const STAMP = Date.now();
const HOUR = 3_600_000;

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
const serviceRpc = serviceClient as unknown as AnyRpc;

type Session = { id: string; client: DB; cookie: string };

async function realSession(id: string, email: string): Promise<Session> {
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
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  }
  const cookie = [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return { id, client, cookie };
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

function execSql(sql: string) {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "multi-day-jobs" });
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
}

// ─── Fonction de preuve temporaire ───────────────────────────────
// Échéance d'une journée placée à now() + p_offset, puis vraie RPC sous
// l'identité p_actor, dans la même transaction (instant exact). Le verrou
// de la journée (régime et échéance figés pour tout auteur) est levé le
// temps du seul déplacement (pile jetable).
const CASE_FN = `
create or replace function public.proof_l12_case(
  p_kind text, p_day uuid, p_actor uuid, p_target uuid, p_offset interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_err text;
  v_detail text;
begin
  select d.job_id into v_job from public.job_days d where d.id = p_day;
  alter table public.job_days disable trigger trg_protect_job_day_writes;
  update public.job_days d set applications_close_at = now() + p_offset
  where d.id = p_day;
  alter table public.job_days enable trigger trg_protect_job_day_writes;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    if p_kind = 'apply' then
      perform * from public.apply_to_job_days(v_job, array[p_day]);
    elsif p_kind = 'select' then
      perform * from public.sign_and_select(p_target,
        coalesce((select p.terms_hash from public.contract_selection_preview(p_target) p), ''));
    end if;
  exception when others then
    v_err := sqlerrm;
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  return jsonb_build_object(
    'error', v_err,
    'detail', v_detail,
    'applications', (select count(*) from public.job_applications a where a.job_day_id = p_day),
    'selected', (select count(*) from public.job_applications a
                 where a.job_day_id = p_day and a.status = 'selected'));
end;
$$`;

// Clôture par le temps (pile jetable) : l'échéance de l'offre et de ses
// journées est placée juste avant now() (verrous levés le temps du seul
// déplacement), puis l'instant de recalcul déjà programmé pour l'entreprise
// (next_expiry_at) est placé à la même échéance passée : c'est l'état
// qu'atteindrait la base si le temps avait réellement passé. Aucun
// recalcul n'est lancé ici.
const CLOSE_FN = `
create or replace function public.proof_l12_close(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_planned timestamptz;
  v_close timestamptz := now() - interval '1 second';
begin
  select j.company_id into v_company from public.jobs j where j.id = p_job;
  select s.next_expiry_at into v_planned from public.reputation_scores s
  where s.subject_type = 'company' and s.subject_id = v_company;
  alter table public.jobs disable trigger trg_job_publication_guard;
  alter table public.job_days disable trigger trg_protect_job_day_writes;
  update public.job_days d set applications_close_at = v_close
  where d.job_id = p_job and d.applications_close_at is not null;
  update public.jobs j set applications_close_at = v_close where j.id = p_job;
  alter table public.job_days enable trigger trg_protect_job_day_writes;
  alter table public.jobs enable trigger trg_job_publication_guard;
  update public.reputation_scores s set next_expiry_at = v_close
  where s.subject_type = 'company' and s.subject_id = v_company
    and s.next_expiry_at is not null;
  return jsonb_build_object('planned', v_planned);
end;
$$`;

function installCase() {
  execSql(CASE_FN);
  execSql(
    "revoke all on function public.proof_l12_case(text, uuid, uuid, uuid, interval) from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_l12_case(text, uuid, uuid, uuid, interval) to service_role",
  );
  execSql(CLOSE_FN);
  execSql(
    "revoke all on function public.proof_l12_close(uuid) from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_l12_close(uuid) to service_role",
  );
}

/** Ralentit la sélection d'une candidature précise (ordre imposé). */
function installSlowSelection(applicationId: string) {
  execSql(`
create or replace function public.proof_l12_slow_select() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id = '${applicationId}'::uuid and new.status = 'selected' then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$`);
  execSql(
    "create trigger proof_l12_slow_select before update on public.job_applications for each row execute function public.proof_l12_slow_select()",
  );
}

function dropProofObjects() {
  execSql(
    "drop trigger if exists proof_l12_slow_select on public.job_applications",
  );
  execSql("drop function if exists public.proof_l12_slow_select()");
  execSql(
    "drop function if exists public.proof_l12_case(text, uuid, uuid, uuid, interval)",
  );
  execSql("drop function if exists public.proof_l12_close(uuid)");
  dropBarrier(execSql);
}

type CaseResult = {
  error: string | null;
  detail: string | null;
  applications: number;
  selected: number;
};

async function runCase(
  kind: "apply" | "select",
  day: string,
  actor: string,
  offset: string,
  target: string | null = null,
): Promise<CaseResult> {
  const { data, error } = await serviceRpc.rpc("proof_l12_case", {
    p_kind: kind,
    p_day: day,
    p_actor: actor,
    p_target: target,
    p_offset: offset,
  });
  if (error) throw new Error(`proof_l12_case : ${error.message}`);
  return data as CaseResult;
}

// ─── Fixtures ────────────────────────────────────────────────────
async function createAccount(email: string, role: Role): Promise<string> {
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
      niu: `M0${String(STAMP).slice(-9)}${name.length}E`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
      subscription_plan: "pro",
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
      last_name: "Journées",
      date_of_birth: "1996-04-10",
      city: "Douala",
      address: "Akwa",
      latitude: 4.05,
      longitude: 9.7,
      cni_number: `CNI12${firstName}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677007013",
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
      const { data: missions } = await serviceClient
        .from("missions")
        .select("id")
        .in("job_id", jobIds);
      const missionIds = (missions ?? []).map((m) => m.id);
      if (missionIds.length > 0) {
        await serviceClient
          .from("reviews")
          .delete()
          .in("mission_id", missionIds);
        await serviceClient
          .from("mission_check_ins")
          .delete()
          .in("mission_id", missionIds);
      }
      await serviceClient.from("contracts").delete().in("job_id", jobIds);
      await serviceClient.from("missions").delete().in("job_id", jobIds);
      await serviceClient
        .from("job_applications")
        .delete()
        .in("job_id", jobIds);
      await serviceClient.from("audit_logs").delete().in("resource_id", jobIds);
      // Calendrier figé après publication : la suppression de l'offre
      // emporte ses journées (cascade, offre déjà absente).
      await serviceClient.from("jobs").delete().in("id", jobIds);
    }
    await serviceClient
      .from("audit_logs")
      .delete()
      .in("resource_id", companyIds);
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

async function cleanStale() {
  dropProofObjects();
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofMultiDayJobs === true)
      .map((u) => u.id),
  );
}

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  raw: string;
};

async function http(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, raw };
}

/** Date de Douala (UTC+1) décalée de `days` jours depuis maintenant. */
const doualaDay = (days: number) =>
  new Date(Date.now() + HOUR + days * 24 * HOUR).toISOString().slice(0, 10);

const CONTENT = {
  description: "Preuve des offres de plusieurs journées (lot 12).",
  address: "Boulevard de la Liberté",
  city: "Douala",
};

// ─── Preuve ──────────────────────────────────────────────────────
async function main() {
  console.log("Preuve lot 12 — offres de plusieurs journées\n");
  await cleanStale();
  const ids: string[] = [];
  try {
    const mail = (k: string) => `proof-l12-${k}-${STAMP}@easyjob.test`;
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idO = await createAccount(mail("ops"), "admin_ops");
    const idQ = await createAccount(mail("q"), "company");
    const cand = await Promise.all(
      ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((k) =>
        createAccount(mail(k), "candidate"),
      ),
    );
    ids.push(idA, idB, idO, idQ, ...cand);
    const coA = await createCompany(idA, "Journées SARL");
    const coB = await createCompany(idB, "Autre SARL");
    const coQ = await createCompany(idQ, "Réputation SARL");
    const prof = await Promise.all(
      cand.map((id, i) => createCandidate(id, `Cand${i + 1}`)),
    );
    const A = await realSession(idA, mail("a"));
    const B = await realSession(idB, mail("b"));
    const O = await realSession(idO, mail("ops"));
    const Q = await realSession(idQ, mail("q"));
    const [C1, C2, C3, C4, C5, C6, C7] = await Promise.all(
      cand.map((id, i) => realSession(id, mail(`c${i + 1}`))),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    installCase();
    await installBarrier(execSql, serviceClient);

    const daysOf = async (jobId: string) =>
      (
        await serviceClient
          .from("job_days")
          .select(
            "id, day_date, start_time, end_time, starts_at, ends_at, mission_pay_per_candidate, positions_available, positions_filled, publication_regime, applications_close_at",
          )
          .eq("job_id", jobId)
          .order("starts_at")
      ).data ?? [];
    const jobRow = async (jobId: string) =>
      (
        await serviceClient
          .from("jobs")
          .select(
            "status, schedule_format, start_date, end_date, start_time, end_time, publication_regime, applications_close_at, first_published_at, mission_pay_per_candidate, positions_available, positions_filled",
          )
          .eq("id", jobId)
          .single()
      ).data;
    const approve = (jobId: string) =>
      http("POST", `/api/admin/jobs/${jobId}/moderate`, O.cookie, {
        action: "approve",
      });
    const createViaRoute = (session: Session, body: unknown) =>
      http("POST", "/api/jobs", session.cookie, body);

    // ── K. Calendrier ────────────────────────────────────────────
    const d3 = doualaDay(3);
    const d5 = doualaDay(5);
    const d9 = doualaDay(9);
    const k1 = await createViaRoute(A, {
      ...CONTENT,
      title: "Inventaire non consécutif",
      start_date: d3,
      start_time: "08:00",
      end_time: "12:00",
      mission_pay_per_candidate: 30000,
      positions_available: 2,
      schedule_format: "full_period",
      days: [
        { date: d9, start_time: "08:00", end_time: "12:00" },
        { date: d3, start_time: "08:00", end_time: "12:00" },
        { date: d5, start_time: "08:00", end_time: "12:00" },
      ],
    });
    const jobFull = (k1.body.job as { id?: string } | undefined)?.id ?? "";
    const k1Days = await daysOf(jobFull);
    const k1Job = await jobRow(jobFull);
    report(
      "K1 dates non consécutives, horaires communs (route) : trois journées exactement, aucune date intermédiaire, résumé première/dernière",
      k1.status === 201 &&
        JSON.stringify(k1Days.map((d) => d.day_date)) ===
          JSON.stringify([d3, d5, d9]) &&
        k1Job?.start_date === d3 &&
        k1Job?.end_date === d9 &&
        k1Job?.schedule_format === "full_period" &&
        k1Days.every((d) => d.mission_pay_per_candidate === null),
      { status: k1.status, days: k1Days.map((d) => d.day_date) },
    );

    const { data: night, error: nightErr } = await A.client.rpc("create_job", {
      p_job: {
        ...CONTENT,
        title: "Veille de nuit",
        mission_pay_per_candidate: 15000,
        schedule_format: "per_day",
        days: [
          {
            date: d3,
            start_time: "22:00",
            end_time: "06:00",
            mission_pay_per_candidate: 15000,
            positions_available: 2,
          },
          {
            date: d5,
            start_time: "09:00",
            end_time: "17:30",
            mission_pay_per_candidate: 12000,
            positions_available: 1,
          },
        ],
      },
    });
    const nightDays = night ? await daysOf(night.id) : [];
    const n0 = nightDays[0];
    report(
      "K2 horaires propres et journée qui traverse minuit : 22:00 → 06:00 le lendemain (heure de Douala), montants et places par journée",
      !nightErr &&
        !!n0 &&
        Date.parse(n0.starts_at) === Date.parse(`${d3}T22:00:00+01:00`) &&
        Date.parse(n0.ends_at) ===
          Date.parse(`${addDays(d3, 1)}T06:00:00+01:00`) &&
        nightDays[1]?.mission_pay_per_candidate === 12000 &&
        nightDays[1]?.positions_available === 1 &&
        night?.mission_pay_per_candidate === 12000 &&
        night?.positions_available === 3,
      { err: nightErr?.message, n0 },
    );

    const refusals: [string, unknown, string][] = [
      [
        "doublon",
        {
          schedule_format: "full_period",
          days: [
            { date: d3, start_time: "08:00", end_time: "10:00" },
            { date: d3, start_time: "14:00", end_time: "16:00" },
          ],
        },
        "days_duplicate",
      ],
      [
        "chevauchement interne",
        {
          schedule_format: "full_period",
          days: [
            { date: d3, start_time: "22:00", end_time: "06:00" },
            { date: addDays(d3, 1), start_time: "05:00", end_time: "09:00" },
          ],
        },
        "days_overlap",
      ],
      [
        "début = fin",
        {
          schedule_format: "full_period",
          days: [{ date: d3, start_time: "08:00", end_time: "08:00" }],
        },
        "days_time",
      ],
      [
        "32 journées",
        {
          schedule_format: "full_period",
          days: Array.from({ length: 32 }, (_, i) => ({
            date: addDays(d3, i),
            start_time: "08:00",
            end_time: "10:00",
          })),
        },
        "days_count",
      ],
      [
        "au choix sans montant",
        {
          schedule_format: "per_day",
          days: [{ date: d3, start_time: "08:00", end_time: "10:00" }],
        },
        "days_pay",
      ],
      [
        "au choix, montant fractionnaire",
        {
          schedule_format: "per_day",
          days: [
            {
              date: d3,
              start_time: "08:00",
              end_time: "10:00",
              mission_pay_per_candidate: 1000.5,
            },
          ],
        },
        "days_pay",
      ],
      [
        "au choix, montant négatif",
        {
          schedule_format: "per_day",
          days: [
            {
              date: d3,
              start_time: "08:00",
              end_time: "10:00",
              mission_pay_per_candidate: -5,
            },
          ],
        },
        "days_pay",
      ],
      [
        "période complète avec montant journalier",
        {
          schedule_format: "full_period",
          days: [
            {
              date: d3,
              start_time: "08:00",
              end_time: "10:00",
              mission_pay_per_candidate: 1000,
            },
          ],
        },
        "days_pay",
      ],
      [
        "intervalle sans journées",
        {
          start_date: d3,
          end_date: d9,
          start_time: "08:00",
          end_time: "10:00",
        },
        "end_date",
      ],
    ];
    const refusalResults = [];
    for (const [label, extra, detail] of refusals) {
      const { error } = await A.client.rpc("create_job", {
        p_job: {
          ...CONTENT,
          title: `Refus ${label}`,
          mission_pay_per_candidate: 5000,
          ...(extra as Record<string, unknown>),
        },
      });
      refusalResults.push({
        label,
        ok: error?.message === "invalid_job_data" && error.details === detail,
        got: `${error?.message}/${error?.details}`,
      });
    }
    const { count: refusedCreated } = await serviceClient
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", coA)
      .like("title", "Refus %");
    report(
      "K3 refus en base : doublon, chevauchement interne (nuit), début = fin, 32 journées, montants manquants, fractionnaires, négatifs ou journaliers en période complète, intervalle sans journées ; aucune offre créée",
      refusalResults.every((r) => r.ok) && refusedCreated === 0,
      refusalResults.filter((r) => !r.ok),
    );

    const kRoute = await createViaRoute(A, {
      ...CONTENT,
      title: "Refus route",
      start_date: d3,
      start_time: "08:00",
      end_time: "10:00",
      mission_pay_per_candidate: 5000,
      schedule_format: "full_period",
      days: [
        { date: d3, start_time: "08:00", end_time: "10:00" },
        { date: d3, start_time: "12:00", end_time: "14:00" },
      ],
    });
    report(
      "K3b même refus par la route (validation partagée)",
      kRoute.status === 400 && kRoute.body.code === "invalid_job_data",
      kRoute.body,
    );

    const { data: single, error: singleErr } = await A.client.rpc(
      "create_job",
      {
        p_job: {
          ...CONTENT,
          title: "Une seule journée",
          start_date: d5,
          start_time: "10:00",
          end_time: "14:00",
          mission_pay_per_candidate: 8000,
        },
      },
    );
    const singleDays = single ? await daysOf(single.id) : [];
    report(
      "K4 parcours simple d'une journée (sans calendrier) conservé : une journée, période complète",
      !singleErr &&
        single?.schedule_format === "full_period" &&
        singleDays.length === 1 &&
        singleDays[0].day_date === d5,
      singleErr?.message,
    );

    const { error: insDayErr } = await A.client.from("job_days").insert({
      job_id: jobFull,
      day_date: d9,
      start_time: "13:00",
      end_time: "14:00",
      starts_at: new Date().toISOString(),
      ends_at: new Date().toISOString(),
    });
    const { data: updDay } = await A.client
      .from("job_days")
      .update({ start_time: "07:00" })
      .eq("job_id", jobFull)
      .select("id");
    const { count: anonDays } = await anon
      .from("job_days")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobFull);
    report(
      "K5 écritures directes refusées (insertion, modification) ; offre non publiée invisible des tiers, journées comprises",
      insDayErr !== null &&
        (updDay ?? []).length === 0 &&
        (anonDays ?? 0) === 0,
      { ins: insDayErr?.code, upd: updDay, anonDays },
    );

    // ── P. Publication ───────────────────────────────────────────
    const p1 = await approve(jobFull);
    const p1Job = await jobRow(jobFull);
    const p1Days = await daysOf(jobFull);
    const firstStart = Date.parse(`${d3}T08:00:00+01:00`);
    report(
      "P1 période complète : régime et échéance fondés sur le premier début (normal, H−24), aucune échéance par journée",
      p1.status === 200 &&
        p1Job?.status === "active" &&
        p1Job.publication_regime === "normal" &&
        Date.parse(p1Job.applications_close_at ?? "") ===
          firstStart - 24 * HOUR &&
        p1Days.every((d) => d.applications_close_at === null),
      { status: p1.status, job: p1Job },
    );

    // Journées au choix : une journée urgente (dans ~10 h), une normale.
    const soon = new Date(Date.now() + 10 * HOUR + HOUR);
    const soonDate = soon.toISOString().slice(0, 10);
    const soonTime = soon.toISOString().slice(11, 16);
    const later = doualaDay(4);
    const { data: perDayJob, error: perDayErr } = await A.client.rpc(
      "create_job",
      {
        p_job: {
          ...CONTENT,
          title: "Journées au choix",
          mission_pay_per_candidate: 1,
          schedule_format: "per_day",
          days: [
            {
              date: soonDate,
              start_time: soonTime,
              end_time: soonTime === "23:59" ? "00:30" : "23:59",
              mission_pay_per_candidate: 9000,
              positions_available: 1,
            },
            {
              date: later,
              start_time: "08:00",
              end_time: "12:00",
              mission_pay_per_candidate: 11000,
              positions_available: 2,
            },
            {
              date: doualaDay(6),
              start_time: "08:00",
              end_time: "12:00",
              mission_pay_per_candidate: 11000,
              positions_available: 1,
            },
          ],
        },
      },
    );
    const jobPer = perDayJob?.id ?? "";
    const p2 = await approve(jobPer);
    const perDays = await daysOf(jobPer);
    const perJob = await jobRow(jobPer);
    report(
      "P2 journées au choix : régime et échéance propres à chaque journée (urgente H−2, normale H−24), offre ouverte jusqu'à la dernière échéance",
      !perDayErr &&
        p2.status === 200 &&
        perDays[0]?.publication_regime === "urgent" &&
        Date.parse(perDays[0].applications_close_at ?? "") ===
          Date.parse(perDays[0].starts_at) - 2 * HOUR &&
        perDays[1]?.publication_regime === "normal" &&
        Date.parse(perDays[1].applications_close_at ?? "") ===
          Date.parse(perDays[1].starts_at) - 24 * HOUR &&
        perJob?.publication_regime === "per_day" &&
        perJob.applications_close_at === perDays[2]?.applications_close_at,
      { err: perDayErr?.message, p2: p2.body, perDays },
    );

    // Calendrier devenu en partie non publiable avant l'approbation.
    const { data: partial } = await A.client.rpc("create_job", {
      p_job: {
        ...CONTENT,
        title: "Calendrier en partie trop proche",
        mission_pay_per_candidate: 1,
        schedule_format: "per_day",
        days: [
          {
            date: doualaDay(2),
            start_time: "08:00",
            end_time: "12:00",
            mission_pay_per_candidate: 5000,
          },
          {
            date: doualaDay(7),
            start_time: "08:00",
            end_time: "12:00",
            mission_pay_per_candidate: 5000,
          },
        ],
      },
    });
    const partialJob = partial?.id ?? "";
    const tooSoon = new Date(Date.now() + 3 * HOUR + HOUR);
    await serviceClient
      .from("job_days")
      .update({
        day_date: tooSoon.toISOString().slice(0, 10),
        start_time: tooSoon.toISOString().slice(11, 19),
        end_time: "23:59:59",
      })
      .eq("job_id", partialJob)
      .eq("day_date", doualaDay(2));
    const p3 = await approve(partialJob);
    const p3Job = await jobRow(partialJob);
    const p3Days = await daysOf(partialJob);
    report(
      "P3 une journée non publiable à l'approbation : refus de toute l'offre (409 job_start_too_close), journée nommée, aucune publication partielle",
      p3.status === 409 &&
        p3.body.code === "job_start_too_close" &&
        JSON.stringify(p3.body.days) ===
          JSON.stringify([tooSoon.toISOString().slice(0, 10)]) &&
        p3Job?.status === "pending_review" &&
        p3Job.first_published_at === null &&
        p3Days.every((d) => d.applications_close_at === null),
      { p3: p3.body, job: p3Job?.status },
    );

    // Calendrier figé après publication, pour tout auteur.
    const svcIns = await serviceClient.from("job_days").insert({
      job_id: jobFull,
      day_date: addDays(d9, 2),
      start_time: "08:00",
      end_time: "12:00",
      starts_at: new Date().toISOString(),
      ends_at: new Date().toISOString(),
    });
    const svcDel = await serviceClient
      .from("job_days")
      .delete()
      .eq("job_id", jobFull)
      .eq("day_date", d9)
      .select("id");
    const svcUpd = await serviceClient
      .from("job_days")
      .update({ end_time: "13:00" })
      .eq("job_id", jobFull)
      .eq("day_date", d5)
      .select("id");
    const svcFormat = await serviceClient
      .from("jobs")
      .update({ schedule_format: "per_day" })
      .eq("id", jobFull)
      .select("id");
    report(
      "P4 après publication, ajout, retrait et changement d'horaire d'une journée, changement de format : refusés même pour la clé service",
      svcIns.error?.message === "job_schedule_locked" &&
        svcDel.error?.message === "job_schedule_locked" &&
        svcUpd.error?.message === "job_schedule_locked" &&
        svcFormat.error?.message === "job_schedule_locked" &&
        (await daysOf(jobFull)).length === 3,
      {
        ins: svcIns.error?.message,
        del: svcDel.error?.message,
        upd: svcUpd.error?.message,
        fmt: svcFormat.error?.message,
      },
    );

    const fullDaysBody = [
      { date: d3, start_time: "08:00", end_time: "12:00" },
      { date: d5, start_time: "08:00", end_time: "12:00" },
      { date: d9, start_time: "08:00", end_time: "12:00" },
    ];
    const baseEdit = {
      ...CONTENT,
      title: "Inventaire non consécutif",
      start_date: d3,
      start_time: "08:00",
      end_time: "12:00",
      mission_pay_per_candidate: 30000,
      positions_available: 2,
      schedule_format: "full_period",
    };
    const p5add = await http("PATCH", `/api/jobs/${jobFull}`, A.cookie, {
      ...baseEdit,
      days: [
        ...fullDaysBody,
        { date: addDays(d9, 3), start_time: "08:00", end_time: "12:00" },
      ],
    });
    const p5del = await http("PATCH", `/api/jobs/${jobFull}`, A.cookie, {
      ...baseEdit,
      days: fullDaysBody.slice(0, 2),
    });
    const p5hours = await http("PATCH", `/api/jobs/${jobFull}`, A.cookie, {
      ...baseEdit,
      days: fullDaysBody.map((d) => ({ ...d, end_time: "12:30" })),
    });
    const closeBefore = (await jobRow(jobFull))?.applications_close_at;
    const p5same = await http("PATCH", `/api/jobs/${jobFull}`, A.cookie, {
      ...baseEdit,
      title: "Inventaire non consécutif (corrigé)",
      days: fullDaysBody,
    });
    const p5re = await approve(jobFull);
    const p5Job = await jobRow(jobFull);
    report(
      "P5 correction par la route : ajout, retrait, horaires changés → 409 job_schedule_locked ; mêmes journées acceptées, nouvelle approbation sans changement de régime ni d'échéance",
      p5add.body.code === "job_schedule_locked" &&
        p5del.body.code === "job_schedule_locked" &&
        p5hours.body.code === "job_schedule_locked" &&
        p5same.status === 200 &&
        p5re.status === 200 &&
        p5Job?.applications_close_at === closeBefore &&
        (await daysOf(jobFull)).length === 3,
      {
        add: p5add.body.code,
        del: p5del.body.code,
        hours: p5hours.body.code,
        same: p5same.status,
        re: p5re.status,
      },
    );

    const { data: legacy } = await serviceClient
      .from("jobs")
      .insert({
        ...CONTENT,
        title: "Offre antérieure à intervalle",
        company_id: coA,
        start_date: d3,
        end_date: d9,
        start_time: "08:00",
        end_time: "12:00",
        mission_pay_per_candidate: 5000,
        status: "pending_review",
      })
      .select("id")
      .single();
    const p6 = await approve(legacy?.id ?? "");
    report(
      "P6 offre à intervalle sans calendrier (sens non établi) : aucune journée déduite, publication refusée (job_days_missing)",
      p6.body.code === "job_days_missing" &&
        (await daysOf(legacy?.id ?? "")).length === 0,
      p6.body,
    );

    // ── A. Candidatures ─────────────────────────────────────────
    const a1 = await http("POST", `/api/jobs/${jobFull}/apply`, C1.cookie);
    const a1b = await http("POST", `/api/jobs/${jobFull}/apply`, C2.cookie, {
      day_ids: [p1Days[0].id],
    });
    report(
      "A1 période complète : candidature à l'ensemble (route) ; choisir des journées refusé (job_days_not_selectable)",
      a1.status === 200 &&
        a1b.status === 400 &&
        a1b.body.code === "job_days_not_selectable",
      { a1: a1.status, a1b: a1b.body },
    );

    const [pd0, pd1, pd2] = perDays;
    const a2none = await http("POST", `/api/jobs/${jobPer}/apply`, C1.cookie);
    const a2 = await http("POST", `/api/jobs/${jobPer}/apply`, C1.cookie, {
      day_ids: [pd0.id, pd1.id],
    });
    const { data: c1View } = await C1.client.rpc("job_days_for_candidate", {
      p_job_id: jobPer,
    });
    report(
      "A2 journées au choix : sans journée → 400 job_days_required ; deux journées envoyées ensemble → deux candidatures, état lisible par journée, troisième encore ouverte",
      a2none.body.code === "job_days_required" &&
        a2.status === 200 &&
        (a2.body.applications as unknown[]).length === 2 &&
        c1View?.find((d) => d.day_id === pd0.id)?.my_application_status ===
          "pending" &&
        c1View?.find((d) => d.day_id === pd2.id)?.my_application_status ===
          null &&
        c1View?.find((d) => d.day_id === pd2.id)?.recruitment_open === true,
      { a2none: a2none.body.code, a2: a2.status },
    );

    const a3mixed = await http("POST", `/api/jobs/${jobPer}/apply`, C1.cookie, {
      day_ids: [pd2.id, pd1.id],
    });
    const { count: c1AfterMixed } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobPer)
      .eq("candidate_id", prof[0]);
    const a3later = await http("POST", `/api/jobs/${jobPer}/apply`, C1.cookie, {
      day_ids: [pd2.id],
    });
    report(
      "A3 envoi mêlant une journée nouvelle et une déjà demandée : refus tout ou rien (journée bloquante nommée), puis candidature ultérieure à la journée restante",
      a3mixed.status === 409 &&
        a3mixed.body.code === "job_days_unavailable" &&
        JSON.stringify(a3mixed.body.days) ===
          JSON.stringify([
            { id: pd1.id, date: pd1.day_date, reason: "already_applied" },
          ]) &&
        c1AfterMixed === 2 &&
        a3later.status === 200,
      { mixed: a3mixed.body, after: c1AfterMixed, later: a3later.status },
    );

    const c1Apps =
      (
        await serviceClient
          .from("job_applications")
          .select("id, job_day_id, status")
          .eq("job_id", jobPer)
          .eq("candidate_id", prof[0])
      ).data ?? [];
    const c1Day2 = c1Apps.find((a) => a.job_day_id === pd2.id);
    const a4 = await http(
      "DELETE",
      `/api/jobs/${jobPer}/apply?application=${c1Day2?.id}`,
      C1.cookie,
    );
    const a4re = await http("POST", `/api/jobs/${jobPer}/apply`, C1.cookie, {
      day_ids: [pd2.id],
    });
    const c1AppsAfter =
      (
        await serviceClient
          .from("job_applications")
          .select("job_day_id, status")
          .eq("job_id", jobPer)
          .eq("candidate_id", prof[0])
      ).data ?? [];
    report(
      "A4 retrait d'une seule journée : les autres inchangées ; nouvelle candidature à la journée retirée refusée (aucune réouverture)",
      a4.status === 200 &&
        a4re.status === 409 &&
        (a4re.body.days as { reason?: string }[])?.[0]?.reason ===
          "already_applied" &&
        c1AppsAfter.filter((a) => a.status === "pending").length === 2 &&
        c1AppsAfter.find((a) => a.job_day_id === pd2.id)?.status ===
          "withdrawn",
      { a4: a4.status, a4re: a4re.body },
    );

    const dup = await Promise.all(
      Array.from({ length: 5 }, () =>
        C2.client.rpc("apply_to_job_days", {
          p_job_id: jobPer,
          p_day_ids: [pd1.id],
        }),
      ),
    );
    const { count: c2Rows } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_day_id", pd1.id)
      .eq("candidate_id", prof[1]);
    report(
      "A5 cinq envois simultanés de la même journée : une candidature, les autres refusées",
      dup.filter((r) => !r.error).length === 1 && c2Rows === 1,
      dup.map((r) => r.error?.message ?? "ok"),
    );

    await C3.client.rpc("apply_to_job_days", {
      p_job_id: jobPer,
      p_day_ids: [pd0.id],
    });
    const { data: pd0After } = await serviceClient
      .from("job_days")
      .select("positions_filled")
      .eq("id", pd0.id)
      .single();
    report(
      "A6 une candidature ne réserve aucune place : deux candidatures sur la journée d'une place, aucune place prise",
      pd0After?.positions_filled === 0,
      pd0After,
    );

    // ── E. Échéances par journée (instant exact) ────────────────
    const { data: eJob } = await A.client.rpc("create_job", {
      p_job: {
        ...CONTENT,
        title: "Échéances par journée",
        mission_pay_per_candidate: 1,
        schedule_format: "per_day",
        days: [
          {
            date: doualaDay(4),
            start_time: "09:00",
            end_time: "12:00",
            mission_pay_per_candidate: 7000,
            positions_available: 3,
          },
          {
            date: doualaDay(8),
            start_time: "09:00",
            end_time: "12:00",
            mission_pay_per_candidate: 7000,
            positions_available: 3,
          },
        ],
      },
    });
    await approve(eJob?.id ?? "");
    const [ed0, ed1] = await daysOf(eJob?.id ?? "");
    const eBefore = await runCase("apply", ed0.id, cand[3], "1 microsecond");
    const eExact = await runCase("apply", ed0.id, cand[4], "0 seconds");
    const eAfter = await runCase("apply", ed0.id, cand[5], "-1 microsecond");
    const eOther = await C6.client.rpc("apply_to_job_days", {
      p_job_id: eJob?.id ?? "",
      p_day_ids: [ed1.id],
    });
    report(
      "E1 candidature à une journée : 1 µs avant son échéance acceptée, à l'instant exact et après refusée (recruitment_closed nommée) ; l'autre journée reste ouverte",
      eBefore.error === null &&
        eExact.error === "job_days_unavailable" &&
        (eExact.detail ?? "").includes("recruitment_closed") &&
        eAfter.error === "job_days_unavailable" &&
        !eOther.error,
      { eBefore, eExact, eAfter, other: eOther.error?.message },
    );
    const { data: c4App } = await serviceClient
      .from("job_applications")
      .select("id")
      .eq("job_day_id", ed0.id)
      .eq("candidate_id", prof[3])
      .single();
    const sExact = await runCase("select", ed0.id, idA, "0 seconds", c4App?.id);
    const sBefore = await runCase(
      "select",
      ed0.id,
      idA,
      "1 microsecond",
      c4App?.id,
    );
    report(
      "E2 sélection sur une journée : refusée à l'instant exact de son échéance, acceptée 1 µs avant",
      sExact.error === "recruitment_closed" &&
        sExact.selected === 0 &&
        sBefore.error === null &&
        sBefore.selected === 1,
      { sExact, sBefore },
    );
    // Échéance de la première journée passée : nouvelle approbation après
    // correction, aucune réouverture.
    await runCase("apply", ed0.id, cand[6], "-1 hour");
    const eEdit = await http("PATCH", `/api/jobs/${eJob?.id}`, A.cookie, {
      ...CONTENT,
      title: "Échéances par journée (corrigée)",
      start_date: ed0.day_date,
      start_time: "09:00",
      end_time: "12:00",
      mission_pay_per_candidate: 7000,
      positions_available: 6,
      schedule_format: "per_day",
      days: [ed0, ed1].map((d) => ({
        date: d.day_date,
        start_time: "09:00",
        end_time: "12:00",
        mission_pay_per_candidate: 7000,
        positions_available: 3,
      })),
    });
    const closesBefore = (await daysOf(eJob?.id ?? "")).map(
      (d) => d.applications_close_at,
    );
    // Offre avec une sélection : correction refusée (règle existante).
    report(
      "E3 correction d'une offre au choix déjà engagée : règles existantes conservées (job_has_selected_candidates)",
      eEdit.body.code === "job_has_selected_candidates",
      eEdit.body,
    );
    const c7Late = await C7.client.rpc("apply_to_job_days", {
      p_job_id: eJob?.id ?? "",
      p_day_ids: [ed0.id],
    });
    report(
      "E4 journée close : aucune réouverture, échéances inchangées",
      c7Late.error?.message === "job_days_unavailable" &&
        JSON.stringify(
          (await daysOf(eJob?.id ?? "")).map((d) => d.applications_close_at),
        ) === JSON.stringify(closesBefore),
      c7Late.error?.message,
    );

    // ── S. Sélection, capacité, contrat ─────────────────────────
    const appOf = async (dayId: string, profileId: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("id")
          .eq("job_day_id", dayId)
          .eq("candidate_id", profileId)
          .single()
      ).data?.id ?? "";
    const raceA = await appOf(pd0.id, prof[0]);
    const raceB = await appOf(pd0.id, prof[2]);
    const race = await Promise.all([
      signAndSelectHttp(APP_URL, raceA, A.cookie),
      signAndSelectHttp(APP_URL, raceB, A.cookie),
    ]);
    const { data: pd0Sel } = await serviceClient
      .from("job_days")
      .select("positions_filled")
      .eq("id", pd0.id)
      .single();
    report(
      "S1 dernière place d'une journée disputée : une sélection, l'autre no_positions ; places de la journée = 1",
      race.filter((r) => r.status === 200).length === 1 &&
        race.some((r) => r.body.code === "no_positions") &&
        pd0Sel?.positions_filled === 1,
      race.map((r) => r.body.code ?? r.status),
    );
    const winner = race[0].status === 200 ? raceA : raceB;
    const { data: perMission } = await serviceClient
      .from("missions")
      .select("id, contract_type")
      .eq("application_id", winner)
      .single();
    const { count: perMissionDays } = await serviceClient
      .from("mission_days")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", perMission?.id ?? "");
    const { data: perContract } = await serviceClient
      .from("contracts")
      .select("contract_template, contract_data")
      .eq("application_id", winner)
      .single();
    const perTerms = (perContract?.contract_data ?? {}) as Record<
      string,
      unknown
    >;
    report(
      "S2 journée au choix : sa mission, son contrat simple, son code ; montant de la journée figé (XAF)",
      perMissionDays === 1 &&
        perContract?.contract_template === "simple" &&
        perTerms.mission_pay_per_candidate === 9000 &&
        perTerms.currency === "XAF" &&
        perTerms.schedule_format === "per_day" &&
        (perTerms.days as unknown[]).length === 1,
      { perMissionDays, perTerms },
    );

    const fullApp =
      (
        await serviceClient
          .from("job_applications")
          .select("id")
          .eq("job_id", jobFull)
          .eq("candidate_id", prof[0])
          .single()
      ).data?.id ?? "";
    const s3 = await signAndSelectHttp(APP_URL, fullApp, A.cookie);
    const fullSel = s3.body.selection as
      | { mission_id?: string; contract_id?: string }
      | undefined;
    const { data: fullDaysRows } = await serviceClient
      .from("mission_days")
      .select("id, scheduled_date")
      .eq("mission_id", fullSel?.mission_id ?? "")
      .order("starts_at");
    const { data: fullCodes } = await serviceClient
      .from("mission_completion_codes")
      .select("code, mission_day_id")
      .eq("mission_id", fullSel?.mission_id ?? "");
    const { data: fullContract } = await serviceClient
      .from("contracts")
      .select("contract_template, contract_data, terms_hash")
      .eq("id", fullSel?.contract_id ?? "")
      .single();
    const ft = (fullContract?.contract_data ?? {}) as Record<string, Json>;
    report(
      "S3 période complète : une mission globale, trois journées, trois codes distincts ; contrat formalisé (3 journées), format, journées, montant non divisé, devise, clauses v3",
      s3.status === 200 &&
        JSON.stringify((fullDaysRows ?? []).map((d) => d.scheduled_date)) ===
          JSON.stringify([d3, d5, d9]) &&
        new Set((fullCodes ?? []).map((c) => c.code)).size === 3 &&
        fullContract?.contract_template === "formal" &&
        ft.schedule_format === "full_period" &&
        ft.day_count === 3 &&
        ft.mission_pay_per_candidate === 30000 &&
        ft.currency === "XAF" &&
        (ft.clauses as { version?: string })?.version === "formal-v3",
      { s3: s3.body, ft },
    );

    const view = await http(
      "GET",
      `/api/contracts/${fullSel?.contract_id}`,
      C1.cookie,
    );
    const viewed = view.body.contract as
      | { terms_hash?: string; terms?: { days?: unknown[] } }
      | undefined;
    const sign = await http(
      "POST",
      `/api/contracts/${fullSel?.contract_id}/sign`,
      C1.cookie,
      { terms_hash: viewed?.terms_hash, consent: true },
    );
    const tampered = await serviceClient
      .from("contracts")
      .update({
        contract_data: {
          ...ft,
          days: (ft.days as Json[]).slice(0, 2),
        } as Json,
      })
      .eq("id", fullSel?.contract_id ?? "")
      .select("id");
    report(
      "S4 empreinte : journées lues par le candidat, signature acceptée ; journées du contrat non modifiables (même clé service)",
      (viewed?.terms?.days ?? []).length === 3 &&
        viewed?.terms_hash === fullContract?.terms_hash &&
        sign.status === 200 &&
        tampered.error !== null,
      { sign: sign.status, tampered: tampered.error?.message },
    );

    // ── C. Conflits d'engagements ───────────────────────────────
    // C4 engagé (entreprise A) le 2099-08-01 et le 2099-08-03, 08:00-12:00.
    const { jobId: cBase } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Engagement de base",
        company_id: coA,
        mission_pay_per_candidate: 5000,
        positions_available: 3,
      },
      [
        { date: "2099-08-01", start_time: "08:00", end_time: "12:00" },
        { date: "2099-08-03", start_time: "08:00", end_time: "12:00" },
      ],
    );
    const mk = (
      title: string,
      days: { date: string; start_time: string; end_time: string }[],
      company = coB,
    ) =>
      insertJobWithDays(
        serviceClient,
        {
          ...CONTENT,
          title,
          company_id: company,
          mission_pay_per_candidate: 5000,
          positions_available: 3,
        },
        days,
      );
    const { jobId: cExact } = await mk("Exactement 3 h après", [
      { date: "2099-08-03", start_time: "15:00", end_time: "18:00" },
    ]);
    const { jobId: cShort } = await mk("3 h moins 1 µs", [
      { date: "2099-08-03", start_time: "14:59:59.999999", end_time: "18:00" },
    ]);
    const { jobId: cBefore } = await mk("Fin exactement 3 h avant", [
      { date: "2099-08-01", start_time: "01:00", end_time: "05:00" },
    ]);
    const { jobId: cPeriod } = await mk("Période dont une journée gêne", [
      { date: "2099-08-05", start_time: "08:00", end_time: "12:00" },
      { date: "2099-08-03", start_time: "13:00", end_time: "14:00" },
      { date: "2099-08-07", start_time: "08:00", end_time: "12:00" },
    ]);
    // Candidatures déposées AVANT l'engagement : la sélection tranche.
    const applyFull = async (s: Session, job: string) => {
      const { data, error } = await s.client.rpc("apply_to_job", {
        p_job_id: job,
      });
      if (error || !data) throw new Error(`apply ${job}: ${error?.message}`);
      return data.id;
    };
    const baseApp = await applyFull(C4, cBase);
    const exactApp = await applyFull(C4, cExact);
    const shortApp = await applyFull(C4, cShort);
    const beforeApp = await applyFull(C4, cBefore);
    const periodApp = await applyFull(C4, cPeriod);
    const selBase = await signAndSelectHttp(APP_URL, baseApp, A.cookie);
    const selExact = await signAndSelectHttp(APP_URL, exactApp, B.cookie);
    const selShort = await signAndSelectHttp(APP_URL, shortApp, B.cookie);
    const selBefore = await signAndSelectHttp(APP_URL, beforeApp, B.cookie);
    const selPeriod = await signAndSelectHttp(APP_URL, periodApp, B.cookie);
    const { data: periodState } = await serviceClient
      .from("job_applications")
      .select("status")
      .eq("id", periodApp)
      .single();
    const { count: periodMissions } = await serviceClient
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("application_id", periodApp);
    report(
      "C1 écart exactement 3 h (après et avant) admis ; 3 h − 1 µs refusé (candidate_schedule_conflict)",
      selBase.status === 200 &&
        selExact.status === 200 &&
        selBefore.status === 200 &&
        selShort.status === 409 &&
        selShort.body.code === "candidate_schedule_conflict",
      [selBase.status, selExact.status, selBefore.status, selShort.body.code],
    );
    report(
      "C2 période complète dont une seule journée gêne : sélection de l'ensemble refusée, aucune mission, candidature intacte",
      selPeriod.body.code === "candidate_schedule_conflict" &&
        periodState?.status === "pending" &&
        periodMissions === 0,
      selPeriod.body,
    );
    const forbidden = [
      "Engagement de base",
      "Journées SARL",
      "2099-08-01",
      "08:00",
      "12:00",
    ];
    report(
      "C3 refus envoyé à l'entreprise : code seul, aucun détail de l'autre engagement (offre, entreprise, dates, horaires)",
      Object.keys(selShort.body).sort().join(",") === "code,error" &&
        !forbidden.some((f) => selShort.raw.includes(f)),
      selShort.body,
    );
    const ownApply = await C4.client.rpc("apply_to_job", {
      p_job_id: (
        await mk("Chevauche directement", [
          { date: "2099-08-01", start_time: "10:00", end_time: "11:00" },
        ])
      ).jobId,
    });
    report(
      "C4 le candidat lui-même est prévenu à la candidature (schedule_conflict, journée de l'offre nommée)",
      ownApply.error?.message === "schedule_conflict" &&
        (ownApply.error.details ?? "").includes("2099-08-01"),
      ownApply.error?.message,
    );
    const { jobId: cSame } = await mk(
      "Nuit sur deux journées d'une même mission",
      [
        { date: "2099-09-10", start_time: "20:00", end_time: "23:59" },
        { date: "2099-09-11", start_time: "00:30", end_time: "04:00" },
      ],
    );
    const sameApp = await applyFull(C5, cSame);
    const selSame = await signAndSelectHttp(APP_URL, sameApp, B.cookie);
    report(
      "C5 journées d'une même mission globale à moins de 3 h : pas des engagements distincts, sélection acceptée",
      selSame.status === 200,
      selSame.body,
    );

    // Deux entreprises sélectionnent C6 au même moment sur deux offres
    // incompatibles : ordre imposé (A ralentie sous verrou), B attend puis
    // relit l'engagement validé.
    const { jobId: raceJobA } = await mk(
      "Course A",
      [{ date: "2099-10-01", start_time: "08:00", end_time: "12:00" }],
      coA,
    );
    const { jobId: raceJobB } = await mk("Course B", [
      { date: "2099-10-01", start_time: "13:00", end_time: "16:00" },
    ]);
    const raceAppA = await applyFull(C6, raceJobA);
    const raceAppB = await applyFull(C6, raceJobB);
    installSlowSelection(raceAppA);
    const pA = signAndSelectHttp(APP_URL, raceAppA, A.cookie);
    await waitSleeping(serviceClient, 1);
    const pB = signAndSelectHttp(APP_URL, raceAppB, B.cookie);
    const [rA, rB] = await Promise.all([pA, pB]);
    execSql(
      "drop trigger if exists proof_l12_slow_select on public.job_applications",
    );
    const { count: c6Missions } = await serviceClient
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", prof[5]);
    report(
      "C6 deux entreprises en course sur le même candidat (ordre imposé) : la première réussit, la seconde attend le verrou puis est refusée ; une seule mission",
      rA.status === 200 &&
        rB.body.code === "candidate_schedule_conflict" &&
        c6Missions === 1,
      { a: rA.status, b: rB.body.code, c6Missions },
    );

    // ── V. Choix confirmés du lot 12 ─────────────────────────────
    // (1) Contrat formalisé dès trois journées prévues dans le MÊME contrat ;
    //     trois missions journalières restent trois contrats simples.
    // (2) 31 journées travaillées au plus, quelle que soit l'étendue
    //     calendaire.
    // (3) Conflits vérifiés dès la candidature, sur les seuls engagements
    //     sélectionnés, marge de 3 h ; comportement : REFUS (rien n'est
    //     créé), journées incompatibles nommées ; une candidature en attente
    //     ne bloque rien.
    const spread = (n: number, step: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: addDays(doualaDay(3), i * step),
        start_time: "08:00",
        end_time: "10:00",
      }));
    const span = (days: { date: string }[]) =>
      (Date.parse(days[days.length - 1].date) - Date.parse(days[0].date)) /
        86_400_000 +
      1;
    const days20 = spread(20, 3);
    const days31 = spread(31, 2);
    const days32 = spread(32, 2);
    const mkSpread = (title: string, days: typeof days20) =>
      A.client.rpc("create_job", {
        p_job: {
          ...CONTENT,
          title,
          mission_pay_per_candidate: 25000,
          schedule_format: "full_period",
          days,
        },
      });
    const v20 = await mkSpread("Vingt journées sur deux mois", days20);
    const v31 = await mkSpread("Trente et une journées", days31);
    const v32 = await mkSpread("Trente-deux journées", days32);
    const v31Days = v31.data ? (await daysOf(v31.data.id)).length : 0;
    report(
      "V1 limite de 31 journées travaillées, pas de 31 jours calendaires : 20 journées sur plus de deux mois et 31 journées sur deux mois acceptées ; 32 refusées (days_count)",
      span(days20) > 56 &&
        !v20.error &&
        span(days31) === 61 &&
        !v31.error &&
        v31Days === 31 &&
        v32.error?.message === "invalid_job_data" &&
        v32.error.details === "days_count",
      {
        span20: span(days20),
        v20: v20.error?.message,
        v31: v31.error?.message,
        v31Days,
        v32: v32.error?.details,
      },
    );

    const { jobId: v3Job, dayIds: v3Days } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Trois journées au choix",
        company_id: coB,
        mission_pay_per_candidate: 4000,
        positions_available: 3,
      },
      [
        {
          date: "2099-11-10",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
        },
        {
          date: "2099-11-12",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
        },
        {
          date: "2099-11-14",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
        },
      ],
      "per_day",
    );
    await C5.client.rpc("apply_to_job_days", {
      p_job_id: v3Job,
      p_day_ids: v3Days,
    });
    const v3Apps =
      (
        await serviceClient
          .from("job_applications")
          .select("id")
          .eq("job_id", v3Job)
          .eq("candidate_id", prof[4])
      ).data ?? [];
    for (const a of v3Apps) {
      await signAndSelectHttp(APP_URL, a.id, B.cookie);
    }
    const { data: v3Contracts } = await serviceClient
      .from("contracts")
      .select("id, contract_template, contract_data")
      .eq("job_id", v3Job);
    // Borne basse : période complète de deux journées (C5) → contrat simple.
    const { data: twoDayContract } = await serviceClient
      .from("contracts")
      .select("contract_template, contract_data")
      .eq("application_id", sameApp)
      .single();
    report(
      "V2 trois journées au choix du même candidat : trois missions et trois contrats distincts, tous simples (une journée chacun) ; période complète de deux journées : contrat simple ; de trois journées non consécutives : formalisé (S3)",
      twoDayContract?.contract_template === "simple" &&
        (twoDayContract.contract_data as { day_count?: number })?.day_count ===
          2 &&
        (v3Contracts ?? []).length === 3 &&
        new Set((v3Contracts ?? []).map((c) => c.id)).size === 3 &&
        (v3Contracts ?? []).every(
          (c) =>
            c.contract_template === "simple" &&
            (c.contract_data as { day_count?: number })?.day_count === 1,
        ),
      {
        perDay: (v3Contracts ?? []).map((c) => c.contract_template),
        twoDays: twoDayContract?.contract_template,
      },
    );

    // C4 est engagé (sélectionné) le 2099-08-03 de 15:00 à 18:00 (C1).
    const { jobId: vExact } = await mk("Candidature à 3 h exactement", [
      { date: "2099-08-03", start_time: "21:00", end_time: "23:00" },
    ]);
    const { jobId: vShort } = await mk("Candidature à 3 h moins 1 µs", [
      { date: "2099-08-03", start_time: "20:59:59.999999", end_time: "23:00" },
    ]);
    const vaExact = await C4.client.rpc("apply_to_job", { p_job_id: vExact });
    const vaShort = await C4.client.rpc("apply_to_job", { p_job_id: vShort });
    const { count: vShortRows } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", vShort)
      .eq("candidate_id", prof[3]);
    report(
      "V3 candidature : écart exactement 3 h avec un engagement sélectionné accepté ; 3 h − 1 µs refusé (schedule_conflict, journée nommée), aucune candidature créée",
      !vaExact.error &&
        vaShort.error?.message === "schedule_conflict" &&
        (vaShort.error.details ?? "").includes("2099-08-03") &&
        vShortRows === 0,
      { exact: vaExact.error?.message, short: vaShort.error?.message },
    );

    // La candidature en attente sur vExact (21:00-23:00) ne bloque rien.
    const { jobId: vOverPending } = await mk(
      "Chevauche une candidature en attente",
      [{ date: "2099-08-03", start_time: "21:30", end_time: "22:30" }],
    );
    const vaPending = await C4.client.rpc("apply_to_job", {
      p_job_id: vOverPending,
    });
    report(
      "V4 une candidature en attente (non sélectionnée) ne bloque pas une autre candidature au même créneau",
      !vaPending.error,
      vaPending.error?.message,
    );

    const { jobId: vMixed, dayIds: vMixedDays } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Journées au choix, une incompatible",
        company_id: coB,
        mission_pay_per_candidate: 4000,
        positions_available: 2,
      },
      [
        {
          date: "2099-08-03",
          start_time: "13:00",
          end_time: "14:00",
          pay: 4000,
        },
        {
          date: "2099-08-25",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
        },
      ],
      "per_day",
    );
    const vMixedHttp = await http(
      "POST",
      `/api/jobs/${vMixed}/apply`,
      C4.cookie,
      {
        day_ids: vMixedDays,
      },
    );
    const { count: vMixedRows } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", vMixed)
      .eq("candidate_id", prof[3]);
    const vMixedOk = await http(
      "POST",
      `/api/jobs/${vMixed}/apply`,
      C4.cookie,
      {
        day_ids: [vMixedDays[1]],
      },
    );
    report(
      "V5 journées au choix dont une incompatible avec un engagement sélectionné : refus de tout l'envoi (409), journée nommée avec le motif schedule_conflict, rien créé ; la journée compatible seule est acceptée",
      vMixedHttp.status === 409 &&
        JSON.stringify(vMixedHttp.body.days) ===
          JSON.stringify([
            {
              id: vMixedDays[0],
              date: "2099-08-03",
              reason: "schedule_conflict",
            },
          ]) &&
        vMixedRows === 0 &&
        vMixedOk.status === 200,
      { refused: vMixedHttp.body, rows: vMixedRows, ok: vMixedOk.status },
    );

    // ── W. Conflit expliqué avant l'envoi (refus conservé) ───────
    // La lecture des journées (job_days_for_candidate) donne au candidat de
    // la session la compatibilité de chaque journée avec ses engagements
    // déjà sélectionnés, par la fonction qu'utilisent la candidature et la
    // sélection. Engagement E (entreprise B) : 2099-07-10, 20:00 → 02:00.
    const { jobId: wE } = await mk("Engagement de nuit W", [
      { date: "2099-07-10", start_time: "20:00", end_time: "02:00" },
    ]);
    const {
      jobId: wX,
      dayIds: [wX1, wX2, wX3],
    } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Journées au choix W",
        company_id: coA,
        mission_pay_per_candidate: 4000,
        positions_available: 3,
      },
      [
        {
          date: "2099-07-08",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
        },
        // Fin 3 h − 1 µs avant le début de E : incompatible.
        {
          date: "2099-07-10",
          start_time: "14:00",
          end_time: "17:00:00.000001",
          pay: 4000,
        },
        // Début exactement 3 h après la fin de E : compatible.
        {
          date: "2099-07-11",
          start_time: "05:00",
          end_time: "09:00",
          pay: 4000,
        },
      ],
      "per_day",
    );
    const { jobId: wP } = await mk(
      "Période W",
      [
        { date: "2099-07-09", start_time: "08:00", end_time: "12:00" },
        { date: "2099-07-10", start_time: "21:00", end_time: "23:00" },
        { date: "2099-07-13", start_time: "08:00", end_time: "12:00" },
      ],
      coA,
    );
    type CompatRow = {
      day_date: string;
      schedule_compatible: boolean | null;
      schedule_reason: string | null;
      my_application_status: string | null;
    };
    const readDays = async (client: DB, job: string) => {
      const { data, error } = await client.rpc("job_days_for_candidate", {
        p_job_id: job,
      });
      const rows = (data ?? []) as unknown as (CompatRow &
        Record<string, unknown>)[];
      return {
        rows,
        keys: rows[0] ? Object.keys(rows[0]).sort() : [],
        // Sans l'heure du serveur (valeur variable, sans rapport).
        raw: JSON.stringify(rows.map((r) => ({ ...r, server_now: undefined }))),
        error: error?.message ?? null,
      };
    };
    const compat = (rows: CompatRow[]) =>
      rows.map((r) => [r.day_date, r.schedule_compatible, r.schedule_reason]);

    // Candidature en attente sur E : elle ne bloque rien.
    const wEApp = await applyFull(C7, wE);
    const w1X = await readDays(C7.client, wX);
    const w1P = await readDays(C7.client, wP);
    report(
      "W1 candidature en attente au même créneau : toutes les journées restent compatibles, aucun blocage",
      w1X.error === null &&
        w1X.rows.length === 3 &&
        w1X.rows.every(
          (r) => r.schedule_compatible === true && r.schedule_reason === null,
        ) &&
        w1P.rows.length === 3 &&
        w1P.rows.every((r) => r.schedule_compatible === true),
      { x: compat(w1X.rows), p: compat(w1P.rows), error: w1X.error },
    );

    // L'entreprise B sélectionne le candidat sur E.
    const wSel = await signAndSelectHttp(APP_URL, wEApp, B.cookie);
    const w2X = await readDays(C7.client, wX);
    const w2P = await readDays(C7.client, wP);
    report(
      "W2 engagement sélectionné : journée à 3 h − 1 µs incompatible (schedule_conflict), journée à exactement 3 h et journée éloignée compatibles ; période complète : la seule journée incompatible est identifiée",
      wSel.status === 200 &&
        JSON.stringify(compat(w2X.rows)) ===
          JSON.stringify([
            ["2099-07-08", true, null],
            ["2099-07-10", false, "schedule_conflict"],
            ["2099-07-11", true, null],
          ]) &&
        JSON.stringify(compat(w2P.rows)) ===
          JSON.stringify([
            ["2099-07-09", true, null],
            ["2099-07-10", false, "schedule_conflict"],
            ["2099-07-13", true, null],
          ]),
      { sel: wSel.status, x: compat(w2X.rows), p: compat(w2P.rows) },
    );

    // Écran périmé : le candidat envoie ce qu'il voyait avant la sélection.
    const w3Days = await http("POST", `/api/jobs/${wX}/apply`, C7.cookie, {
      day_ids: [wX1, wX2],
    });
    const w3Period = await http("POST", `/api/jobs/${wP}/apply`, C7.cookie);
    const { count: w3Rows } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .in("job_id", [wX, wP])
      .eq("candidate_id", prof[6]);
    report(
      "W3 écran périmé : envoi de journées lues avant la sélection → 409, journée incompatible nommée ; période complète → 409 schedule_conflict, journée nommée ; aucune écriture, même partielle",
      w3Days.status === 409 &&
        w3Days.body.code === "job_days_unavailable" &&
        JSON.stringify(w3Days.body.days) ===
          JSON.stringify([
            { id: wX2, date: "2099-07-10", reason: "schedule_conflict" },
          ]) &&
        w3Period.status === 409 &&
        w3Period.body.code === "schedule_conflict" &&
        JSON.stringify(w3Period.body.days) === JSON.stringify(["2099-07-10"]) &&
        w3Rows === 0,
      { days: w3Days.body, period: w3Period.body, rows: w3Rows },
    );

    // Les journées compatibles peuvent être envoyées.
    const w4 = await http("POST", `/api/jobs/${wX}/apply`, C7.cookie, {
      day_ids: [wX1, wX3],
    });
    const w4X = await readDays(C7.client, wX);
    report(
      "W4 journées au choix : les journées compatibles sont envoyées (dont celle à exactement 3 h) ; la journée incompatible reste signalée, les journées demandées portent l'état de leur candidature",
      w4.status === 200 &&
        ((w4.body.applications as unknown[] | undefined) ?? []).length === 2 &&
        JSON.stringify(
          w4X.rows.map((r) => [
            r.day_date,
            r.schedule_compatible,
            r.my_application_status,
          ]),
        ) ===
          JSON.stringify([
            ["2099-07-08", null, "pending"],
            ["2099-07-10", false, null],
            ["2099-07-11", null, "pending"],
          ]),
      {
        status: w4.status,
        rows: w4X.rows.map((r) => [
          r.day_date,
          r.schedule_compatible,
          r.my_application_status,
        ]),
      },
    );

    // Confidentialité : journée, compatibilité, code de motif, rien d'autre.
    const { data: wEMission } = await serviceClient
      .from("missions")
      .select("id")
      .eq("application_id", wEApp)
      .single();
    const wSecrets = [
      wE,
      wEApp,
      wEMission?.id ?? "mission-introuvable",
      coB,
      idB,
      "Engagement de nuit W",
      "Autre SARL",
      // Début et fin de E (UTC), absents des journées lues.
      "T19:00:00",
      "T01:00:00",
    ];
    const wAllowedKeys = [
      "applications_close_at",
      "day_date",
      "day_id",
      "end_time",
      "ends_at",
      "is_full",
      "mission_pay_per_candidate",
      "my_application_id",
      "my_application_status",
      "recruitment_open",
      "schedule_compatible",
      "schedule_reason",
      "server_now",
      "start_time",
      "starts_at",
    ];
    const wAnon = await readDays(anon, wX);
    const wOther = await readDays(C2.client, wX);
    const wOwner = await readDays(A.client, wX);
    const { data: wApplicants } = await A.client.rpc("company_job_applicants", {
      p_job_id: wX,
    });
    const wCompanyView = JSON.stringify(wApplicants ?? null);
    const wLeaks = [
      w2X.raw,
      w2P.raw,
      w4X.raw,
      w3Days.raw,
      w3Period.raw,
      wOwner.raw,
      wCompanyView,
    ].flatMap((text) => wSecrets.filter((secret) => text.includes(secret)));
    report(
      "W5 confidentialité : réponse limitée aux colonnes prévues (journée, compatibilité, code de motif) ; aucun détail de l'autre engagement (offre, entreprise, mission, horaires) dans les lectures du candidat, les refus ni la vue de l'entreprise ; anonyme et entreprise propriétaire : compatibilité non renseignée ; autre candidat : la sienne seulement",
      JSON.stringify(w2X.keys) === JSON.stringify(wAllowedKeys) &&
        wLeaks.length === 0 &&
        (wApplicants ?? []).length === 2 &&
        !wCompanyView.includes("schedule_") &&
        wAnon.rows.length === 3 &&
        wAnon.rows.every(
          (r) => r.schedule_compatible === null && r.schedule_reason === null,
        ) &&
        wOwner.rows.length === 3 &&
        wOwner.rows.every((r) => r.schedule_compatible === null) &&
        wOther.rows.length === 3 &&
        wOther.rows.every((r) => r.schedule_compatible === true),
      {
        keys: w2X.keys,
        leaks: wLeaks,
        anon: compat(wAnon.rows),
        owner: compat(wOwner.rows),
        other: compat(wOther.rows),
      },
    );

    // Signaux : le candidat est prévenu par son canal privé ({d, r}) ; rien
    // de l'engagement E ne part vers l'entreprise A (offre consultée).
    const wSignals = runSupabaseQuery(
      DB_URL,
      `select
         (select count(*) from realtime.messages m
          where m.topic = 'user:${cand[6]}'
            and m.inserted_at > now() - interval '30 minutes'
            and m.payload ->> 'd' = 'applications'
            and m.payload ->> 'r' = '${wEApp}') as candidate_signals,
         (select count(*) from realtime.messages m
          where m.inserted_at > now() - interval '30 minutes'
            and exists (select 1 from jsonb_object_keys(m.payload) k
                        where k not in ('d', 'r', 'id'))) as extra_keys,
         (select count(*) from realtime.messages m
          where m.topic = 'user:${idA}'
            and m.inserted_at > now() - interval '30 minutes'
            and (m.payload::text like '%${wE}%'
                 or m.payload::text like '%${wEApp}%'
                 or m.payload::text like '%${wEMission?.id ?? "x"}%')) as leaked_to_company`,
      { proof: "multi-day-jobs" },
    );
    const wCount = (name: string) =>
      Number(
        new RegExp(`"${name}":\\s*(\\d+)`).exec(wSignals.stdout)?.[1] ?? "-1",
      );
    report(
      "W6 signaux : la sélection est signalée au candidat sur son canal privé (domaine et identifiant seulement) ; aucune charge utile hors {d, r} ; rien de l'engagement ne part vers l'entreprise de l'offre consultée",
      wSignals.status === 0 &&
        wCount("candidate_signals") >= 1 &&
        wCount("extra_keys") === 0 &&
        wCount("leaked_to_company") === 0,
      {
        candidate: wCount("candidate_signals"),
        extraKeys: wCount("extra_keys"),
        leaked: wCount("leaked_to_company"),
      },
    );

    // ── M. Réalisation par journée ──────────────────────────────
    const missionFull = fullSel?.mission_id ?? "";
    const [md1, md2, md3] = fullDaysRows ?? [];
    // Journées 1 et 2 recalées sur des journées passées et terminées (clé
    // service, jamais commencées) : depuis le lot 15, le code n'est reçu
    // qu'à la fin prévue (`mission-completion`). La troisième reste future.
    const yesterday = doualaDay(-1);
    const today = doualaDay(0);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: yesterday,
        scheduled_start_time: "00:00",
        scheduled_end_time: "23:00",
      })
      .eq("id", md1.id);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: addDays(today, -3),
        scheduled_start_time: "00:00",
        scheduled_end_time: "23:00",
      })
      .eq("id", md2.id);
    const mStartNoDay = await http(
      "POST",
      `/api/missions/${missionFull}/start`,
      C1.cookie,
    );
    const mStart1 = await http(
      "POST",
      `/api/missions/${missionFull}/start`,
      C1.cookie,
      {
        mission_day_id: md1.id,
      },
    );
    const mStart3 = await http(
      "POST",
      `/api/missions/${missionFull}/start`,
      C1.cookie,
      {
        mission_day_id: md3.id,
      },
    );
    report(
      "M1 mission de plusieurs journées : journée exigée (mission_day_required) ; début de la journée 1 enregistré ; journée future → too_early",
      mStartNoDay.body.code === "mission_day_required" &&
        mStart1.status === 200 &&
        mStart3.body.code === "too_early",
      [mStartNoDay.body.code, mStart1.status, mStart3.body.code],
    );

    const codeOf = (dayId: string) =>
      (fullCodes ?? []).find((c) => c.mission_day_id === dayId)?.code ?? "";
    const { data: otherCode } = await serviceClient
      .from("mission_completion_codes")
      .select("code")
      .eq("mission_id", perMission?.id ?? "")
      .single();
    const wrongDay = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md2.id),
        mission_day_id: md1.id,
      },
    );
    const wrongCand = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: otherCode?.code,
        mission_day_id: md1.id,
      },
    );
    const good1 = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md1.id),
        mission_day_id: md1.id,
      },
    );
    const { data: mAfter1 } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", missionFull)
      .single();
    report(
      "M2 code d'une autre journée puis d'un autre candidat : refusés et comptés ; bon code : journée confirmée, mission non terminée",
      wrongDay.body.code === "invalid_code" &&
        wrongCand.body.code === "invalid_code" &&
        wrongCand.body.remaining_attempts === 3 &&
        good1.status === 200 &&
        (good1.body.completion as { mission_completed?: boolean })
          ?.mission_completed === false &&
        mAfter1?.status === "in_progress" &&
        mAfter1.actual_end_time === null,
      {
        wrongDay: wrongDay.body,
        wrongCand: wrongCand.body,
        good1: good1.body,
        mAfter1,
      },
    );

    const rep = async (type: "candidate" | "company", id: string) =>
      (
        await serviceRpc.rpc("compute_reputation", {
          p_subject_type: type,
          p_subject_id: id,
        })
      ).data?.[0] as { confirmed_count?: number } | undefined;
    const earlyReview = await http(
      "POST",
      `/api/missions/${missionFull}/review`,
      C1.cookie,
      {
        rating: 5,
      },
    );
    const repAfterOne = await rep("candidate", prof[0]);
    report(
      "M3 après une seule journée : aucune progression de réputation pour la période, évaluation pas encore ouverte",
      earlyReview.body.code === "mission_not_completed" &&
        (repAfterOne?.confirmed_count ?? -1) === 0,
      { review: earlyReview.body.code, rep: repAfterOne },
    );

    // Blocage propre à une journée : 5 erreurs sur la journée 2.
    await http("POST", `/api/missions/${missionFull}/start`, C1.cookie, {
      mission_day_id: md2.id,
    });
    let lock: HttpResult | null = null;
    for (let i = 0; i < 5; i++) {
      lock = await http(
        "POST",
        `/api/missions/${missionFull}/complete`,
        C1.cookie,
        {
          code: "000000" === codeOf(md2.id) ? "111111" : "000000",
          mission_day_id: md2.id,
        },
      );
    }
    const lockedGood = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md2.id),
        mission_day_id: md2.id,
      },
    );
    report(
      "M4 cinq erreurs sur une journée : cette journée bloquée 15 min (même le bon code), compteurs propres à la journée",
      lock?.body.code === "code_locked" &&
        lockedGood.body.code === "code_locked",
      { lock: lock?.body.code, good: lockedGood.body.code },
    );
    // Fin du blocage simulée (clé service) puis dernière journée.
    await serviceClient
      .from("mission_completion_codes")
      .update({
        locked_until: null,
        failed_attempts: 0,
        attempt_window_started_at: null,
      })
      .eq("mission_day_id", md2.id);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: addDays(today, -2),
        scheduled_start_time: "00:00",
        scheduled_end_time: "23:00",
      })
      .eq("id", md3.id);
    const good2 = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md2.id),
        mission_day_id: md2.id,
      },
    );
    await http("POST", `/api/missions/${missionFull}/start`, C1.cookie, {
      mission_day_id: md3.id,
    });
    const good3 = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md3.id),
        mission_day_id: md3.id,
      },
    );
    const good3again = await http(
      "POST",
      `/api/missions/${missionFull}/complete`,
      C1.cookie,
      {
        code: codeOf(md3.id),
        mission_day_id: md3.id,
      },
    );
    const { data: mDone } = await serviceClient
      .from("missions")
      .select("status, actual_end_time")
      .eq("id", missionFull)
      .single();
    const repDone = await rep("candidate", prof[0]);
    report(
      "M5 dernière journée confirmée : mission globale réalisée ; relance idempotente ; candidat +1 (une fois pour la période)",
      good2.status === 200 &&
        (good2.body.completion as { mission_completed?: boolean })
          ?.mission_completed === false &&
        (good3.body.completion as { mission_completed?: boolean })
          ?.mission_completed === true &&
        (good3again.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        mDone?.status === "completed" &&
        repDone?.confirmed_count === 1,
      { good2: good2.body, good3: good3.body, mDone, repDone },
    );
    const review1 = await http(
      "POST",
      `/api/missions/${missionFull}/review`,
      C1.cookie,
      {
        rating: 5,
      },
    );
    const review2 = await http(
      "POST",
      `/api/missions/${missionFull}/review`,
      C1.cookie,
      {
        rating: 4,
      },
    );
    const { count: reviewRows } = await serviceClient
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", missionFull)
      .eq("reviewer_type", "candidate");
    const { data: tasksAfter } = await C1.client.rpc("candidate_tasks");
    report(
      "M6 évaluation obligatoire de l'entreprise : une par mission globale (relance sans doublon) ; la tâche disparaît une fois le contrat signé",
      review1.status === 200 &&
        review2.status === 200 &&
        reviewRows === 1 &&
        !(tasksAfter ?? []).some((t) => t.mission_id === missionFull),
      { review1: review1.status, review2: review2.body, reviewRows },
    );

    // Journées au choix : deux missions journalières du même candidat.
    const { jobId: pjob, dayIds: pdays } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Deux journées réalisées",
        company_id: coB,
        mission_pay_per_candidate: 4000,
        positions_available: 2,
      },
      [
        {
          date: "2099-11-01",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
          positions: 1,
        },
        {
          date: "2099-11-04",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4500,
          positions: 1,
        },
      ],
      "per_day",
    );
    await C7.client.rpc("apply_to_job_days", {
      p_job_id: pjob,
      p_day_ids: pdays,
    });
    const pApps =
      (
        await serviceClient
          .from("job_applications")
          .select("id")
          .eq("job_id", pjob)
          .eq("candidate_id", prof[6])
      ).data ?? [];
    const pMissions: string[] = [];
    for (const a of pApps) {
      const r = await signAndSelectHttp(APP_URL, a.id, B.cookie);
      pMissions.push(
        (r.body.selection as { mission_id?: string })?.mission_id ?? "",
      );
    }
    for (const [i, mid] of pMissions.entries()) {
      await serviceClient
        .from("missions")
        .update({
          scheduled_date: addDays(today, -1 - 2 * i),
          scheduled_start_time: "08:00",
          scheduled_end_time: "12:00",
        })
        .eq("id", mid);
      await http("POST", `/api/missions/${mid}/start`, C7.cookie);
      const { data: c } = await serviceClient
        .from("mission_completion_codes")
        .select("code")
        .eq("mission_id", mid)
        .single();
      await http("POST", `/api/missions/${mid}/complete`, C7.cookie, {
        code: c?.code,
      });
      if (i === 0) {
        const companyMid = (
          await serviceRpc.rpc("reputation_company_offers", {
            p_company_id: coB,
          })
        ).data as { offer_id: string }[] | null;
        report(
          "M7a entreprise : offre non réalisée tant qu'une journée n'est pas résolue (une journée sur deux)",
          !(companyMid ?? []).some((o) => o.offer_id === pjob),
          companyMid,
        );
      }
    }
    const repC7 = await rep("candidate", prof[6]);
    const offersOf = async () =>
      ((
        await serviceRpc.rpc("reputation_company_offers", { p_company_id: coB })
      ).data ?? []) as { offer_id: string }[];
    // Règle validée : rien tant que le recrutement reste ouvert ; clôture
    // par l'échéance (fonction de preuve), puis une seule unité.
    const offersOpen = await offersOf();
    await serviceRpc.rpc("proof_l12_close", { p_job: pjob });
    const offersB = await offersOf();
    report(
      "M7 journées au choix : +1 par mission journalière pour le candidat (2) ; entreprise : rien tant que le recrutement est ouvert, puis +1 pour l'offre, jamais par journée ni par candidat",
      repC7?.confirmed_count === 2 &&
        !offersOpen.some((o) => o.offer_id === pjob) &&
        offersB.filter((o) => o.offer_id === pjob).length === 1,
      { repC7, open: offersOpen.length, offers: offersB.length },
    );

    // Confidentialité des codes.
    const allCodes = (fullCodes ?? []).map((c) => c.code);
    const { data: gm } = await C1.client.rpc("get_mission", {
      p_mission_id: missionFull,
    });
    const { data: ct } = await C1.client.rpc("candidate_tasks");
    const { data: notes } = await serviceClient
      .from("notifications")
      .select("title, body, data")
      .in("user_id", [idA, cand[0]]);
    const { data: thirdMissions, error: thirdErr } = await B.client.rpc(
      "company_job_missions",
      { p_job_id: jobFull },
    );
    const { data: candMissions, error: candErr } = await C1.client.rpc(
      "company_job_missions",
      { p_job_id: jobFull },
    );
    const { data: ownMissions } = await A.client.rpc("company_job_missions", {
      p_job_id: jobFull,
    });
    const directCodes = await C1.client
      .from("mission_completion_codes")
      .select("code");
    const directDays = await C1.client.from("mission_days").select("id");
    const leaked = JSON.stringify({ gm, ct, notes });
    report(
      "M8 codes : jamais dans les lectures du candidat ni les notifications ; tiers et candidat refusés (job_not_found) ; tables fermées aux sessions ; l'entreprise propriétaire lit une ligne par journée",
      !allCodes.some((c) => c && leaked.includes(c)) &&
        thirdErr?.message === "job_not_found" &&
        !thirdMissions &&
        candErr?.message === "job_not_found" &&
        !candMissions &&
        directCodes.error !== null &&
        directDays.error !== null &&
        (ownMissions ?? []).filter((m) => m.mission_id === missionFull)
          .length === 3,
      {
        third: thirdErr?.message,
        cand: candErr?.message,
        directCodes: directCodes.error?.code,
      },
    );
    const rtLeak = runSupabaseQuery(
      DB_URL,
      `select count(*) as n from realtime.messages where inserted_at > now() - interval '30 minutes' and (${allCodes
        .map((c) => `payload::text like '%${c}%'`)
        .join(" or ")})`,
      { proof: "multi-day-jobs" },
    );
    report(
      "M9 Realtime : aucun code dans les signaux émis (charge utile {d, r})",
      rtLeak.status === 0 && /"n":\s*0\b/.test(rtLeak.stdout),
      rtLeak.stdout.slice(0, 200),
    );

    const { data: writeDay } = await C1.client
      .from("mission_days")
      .update({ actual_end_time: new Date().toISOString() })
      .eq("id", md1.id)
      .select("id");
    const { error: writeApp } = await C2.client
      .from("job_applications")
      .update({ job_day_id: pd2.id })
      .eq("job_day_id", pd1.id);
    report(
      "M10 écritures directes : journée de mission et journée d'une candidature non modifiables en session",
      (writeDay ?? []).length === 0 && writeApp !== null,
      { writeApp: writeApp?.code },
    );

    // ── Q. Réputation entreprise (décision validée du lot 12) ──
    // Une offre rapporte +1, une seule fois, quand une réalisation au moins
    // est confirmée par code, que tous ses engagements sont résolus (seule
    // résolution livrée : le travail confirmé) et que son recrutement est
    // clos par son échéance. Entreprise isolée (coQ) ; quatre offres
    // historiques réalisées pour que la cinquième unité franchise une
    // demi-étoile (notification et variation observables).
    const stored = async () =>
      (
        await serviceClient
          .from("reputation_scores")
          .select("experience_units, stars, next_expiry_at")
          .eq("subject_type", "company")
          .eq("subject_id", coQ)
          .maybeSingle()
      ).data;
    const offersQ = async (at?: string) =>
      (
        ((
          await serviceRpc.rpc("reputation_company_offers", {
            p_company_id: coQ,
            ...(at ? { p_at: at } : {}),
          })
        ).data ?? []) as { offer_id: string }[]
      ).map((o) => o.offer_id);
    const changesQ = async () =>
      (
        await serviceClient
          .from("reputation_changes")
          .select("id, direction, cause")
          .eq("subject_type", "company")
          .eq("subject_id", coQ)
      ).data ?? [];
    const refreshQ = () =>
      serviceRpc.rpc("refresh_reputation", {
        p_subject_type: "company",
        p_subject_id: coQ,
        p_cause: "job",
      });
    let pastOffset = -30;
    /** Mission d'une journée recalée dans le passé puis réalisée par code. */
    const realize = async (s: Session, missionId: string) => {
      pastOffset -= 2;
      await serviceClient
        .from("missions")
        .update({
          scheduled_date: addDays(today, pastOffset),
          scheduled_start_time: "08:00",
          scheduled_end_time: "12:00",
        })
        .eq("id", missionId);
      const st = await http(
        "POST",
        `/api/missions/${missionId}/start`,
        s.cookie,
      );
      const { data: c } = await serviceClient
        .from("mission_completion_codes")
        .select("code")
        .eq("mission_id", missionId)
        .single();
      const done = await http(
        "POST",
        `/api/missions/${missionId}/complete`,
        s.cookie,
        {
          code: c?.code,
        },
      );
      if (st.status !== 200 || done.status !== 200) {
        throw new Error(
          `realize: ${st.status}/${done.status} ${done.raw.slice(0, 120)}`,
        );
      }
    };
    const selectQ = async (applicationId: string) => {
      const { data, error } = await signAndSelectRpc(Q.client, applicationId);
      if (error || !data?.[0]?.mission_id) {
        throw new Error(`select: ${error?.message}`);
      }
      return data[0].mission_id;
    };
    const applyDays = async (s: Session, job: string, days: string[]) => {
      const { data, error } = await s.client.rpc("apply_to_job_days", {
        p_job_id: job,
        p_day_ids: days,
      });
      if (error || !data) throw new Error(`apply days: ${error?.message}`);
      return data.map((a) => a.id);
    };
    const closeQ = async (job: string) => {
      const { data, error } = await serviceRpc.rpc("proof_l12_close", {
        p_job: job,
      });
      if (error) throw new Error(`proof_l12_close: ${error.message}`);
      return data as { planned: string | null };
    };
    const sweep = () => serviceRpc.rpc("reputation_expiry_sweep");

    // Historique : quatre offres closes, une mission chacune, confirmée.
    for (let i = 0; i < 4; i++) {
      const past = addDays(today, -60 - 3 * i);
      const { data: hj } = await serviceClient
        .from("jobs")
        .insert({
          ...CONTENT,
          title: `Historique réalisé ${i}`,
          company_id: coQ,
          start_date: past,
          start_time: "08:00",
          end_time: "12:00",
          mission_pay_per_candidate: 3000,
          status: "filled",
          first_published_at: new Date(
            Date.parse(past) - 5 * 86_400_000,
          ).toISOString(),
          publication_regime: "normal",
          applications_close_at: new Date(
            Date.parse(past) - 86_400_000,
          ).toISOString(),
        })
        .select("id")
        .single();
      const { data: ha } = await serviceClient
        .from("job_applications")
        .insert({
          job_id: hj?.id ?? "",
          candidate_id: prof[6],
          status: "selected",
        })
        .select("id")
        .single();
      const { data: hm } = await serviceClient
        .from("missions")
        .insert({
          job_id: hj?.id ?? "",
          candidate_id: prof[6],
          application_id: ha?.id ?? "",
          scheduled_date: past,
          scheduled_start_time: "08:00",
          scheduled_end_time: "12:00",
          contract_type: "simple",
        })
        .select("id")
        .single();
      const at = new Date(Date.parse(past) + 10 * 3_600_000).toISOString();
      await serviceClient
        .from("missions")
        .update({ actual_start_time: at, status: "in_progress" })
        .eq("id", hm?.id ?? "");
      await serviceClient
        .from("mission_completion_codes")
        .update({ consumed_at: at })
        .eq("mission_id", hm?.id ?? "");
      // Lot 15 : la journée porte la réalisation et sa provenance (code),
      // comme l'écrit submit_completion_code.
      await serviceClient
        .from("mission_days")
        .update({
          actual_start_time: at,
          actual_end_time: at,
          completion_source: "code",
        })
        .eq("mission_id", hm?.id ?? "");
      await serviceClient
        .from("missions")
        .update({ actual_end_time: at, status: "completed" })
        .eq("id", hm?.id ?? "");
    }
    await refreshQ();
    const q0 = await stored();
    const changes0 = (await changesQ()).length;

    // Offre au choix : D1 (2 places), D2 (1 place).
    const {
      jobId: jA,
      dayIds: [qa1, qa2],
    } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Offre au choix réputation",
        company_id: coQ,
        mission_pay_per_candidate: 4000,
        positions_available: 3,
      },
      [
        {
          date: "2099-12-01",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
          positions: 2,
        },
        {
          date: "2099-12-03",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
          positions: 1,
        },
      ],
      "per_day",
    );
    const [appQ1] = await applyDays(C1, jA, [qa1]);
    const [appQ2] = await applyDays(C2, jA, [qa1]);
    const [appQ3] = await applyDays(C3, jA, [qa2]);
    const mQ1 = await selectQ(appQ1);
    await realize(C1, mQ1);
    const q1 = await stored();
    report(
      "Q1 offre au choix, une réalisation confirmée, recrutement encore ouvert : aucune unité",
      !(await offersQ()).includes(jA) &&
        q0?.experience_units === 4 &&
        q1?.experience_units === 4,
      { q0, q1 },
    );

    const mQ2 = await selectQ(appQ2);
    const q2a = await stored();
    await realize(C2, mQ2);
    const q2b = await stored();
    const mQ3 = await selectQ(appQ3);
    const q2c = await stored();
    report(
      "Q2 nouvelles sélections et réalisations avant la clôture : aucun gain ni retrait provisoire (projection et variations inchangées)",
      [q2a, q2b, q2c].every((x) => x?.experience_units === 4) &&
        (await changesQ()).length === changes0,
      { q2a, q2b, q2c },
    );

    // Dossier remis en revue : offre masquée, recrutement NON clos.
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coQ);
    const hiddenOffers = await offersQ();
    const { data: hiddenAvail } = await anon.rpc("job_availability", {
      p_job_id: jA,
    });
    await approveCompanyDossier(serviceClient, coQ);
    const changes3 = (await changesQ()).length;
    report(
      "Q3 dossier entreprise remis en revue (offre masquée) : pas une clôture du recrutement, aucune unité",
      hiddenAvail === "unavailable" && !hiddenOffers.includes(jA),
      { hiddenAvail },
    );

    const planned = await closeQ(jA);
    const { data: jAclose } = await serviceClient
      .from("jobs")
      .select("applications_close_at")
      .eq("id", jA)
      .single();
    await sweep();
    const q4 = await stored();
    report(
      "Q4 recrutement clos, une journée sélectionnée sans réalisation (pas de code) : engagement non résolu, aucune unité ; le manque de code n'est pas une absence",
      !!planned.planned &&
        !(await offersQ()).includes(jA) &&
        q4?.experience_units === 4,
      { planned, close: jAclose, q4 },
    );

    // Statuts génériques : jamais assimilés à une résolution.
    await serviceClient
      .from("missions")
      .update({ status: "cancelled" })
      .eq("id", mQ3);
    const qCancelled = (await offersQ()).includes(jA);
    await serviceClient
      .from("missions")
      .update({ status: "no_show" })
      .eq("id", mQ3);
    const qNoShowMission = (await offersQ()).includes(jA);
    await serviceClient
      .from("job_applications")
      .update({ status: "no_show" })
      .eq("id", appQ3);
    const qNoShowApp = (await offersQ()).includes(jA);
    await serviceClient
      .from("job_applications")
      .update({ status: "selected" })
      .eq("id", appQ3);
    await serviceClient
      .from("missions")
      .update({ status: "pending" })
      .eq("id", mQ3);
    report(
      "Q5 mission annulée, absence de mission ou de candidature (statuts sans parcours de validation ni remboursement) : non résolus, aucune unité",
      !qCancelled &&
        !qNoShowMission &&
        !qNoShowApp &&
        (await stored())?.experience_units === 4,
      { qCancelled, qNoShowMission, qNoShowApp },
    );

    await realize(C3, mQ3);
    const q6 = await stored();
    const changes6 = await changesQ();
    const notes6 =
      (
        await serviceClient
          .from("notifications")
          .select("id, data")
          .eq("user_id", idQ)
      ).data?.filter(
        (n) => (n.data as { kind?: string })?.kind === "reputation",
      ) ?? [];
    report(
      "Q6 dernière réalisation après la clôture : +1 pour l'offre (trois candidats, deux journées : jamais plus de +1), une variation et une notification",
      q6?.experience_units === 5 &&
        (await offersQ()).filter((o) => o === jA).length === 1 &&
        changes6.length === changes3 + 1 &&
        changes6.filter((c) => c.direction === "gain").length >= 1 &&
        notes6.length === changes6.length,
      { q6, changes: changes6.length - changes3, notes: notes6.length },
    );

    await Promise.all([
      refreshQ(),
      refreshQ(),
      refreshQ(),
      refreshQ(),
      sweep(),
      sweep(),
    ]);
    await refreshQ();
    const q7 = await stored();
    const changes7 = await changesQ();
    report(
      "Q7 recalculs, relances et balayages concurrents : aucune unité, variation ni notification en double",
      q7?.experience_units === 5 && changes7.length === changes6.length,
      { q7, changes: changes7.length },
    );

    // Période complète : une journée confirmée ne masque pas l'autre.
    const { jobId: jB } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Période réputation",
        company_id: coQ,
        mission_pay_per_candidate: 9000,
        positions_available: 1,
      },
      [
        { date: "2099-12-10", start_time: "08:00", end_time: "12:00" },
        { date: "2099-12-12", start_time: "08:00", end_time: "12:00" },
      ],
    );
    const { data: appB } = await C4.client.rpc("apply_to_job", {
      p_job_id: jB,
    });
    const mB = await selectQ(appB?.id ?? "");
    const { data: mbDays } = await serviceClient
      .from("mission_days")
      .select("id")
      .eq("mission_id", mB)
      .order("starts_at");
    const [mb1, mb2] = mbDays ?? [];
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: addDays(today, -50),
        scheduled_start_time: "08:00",
        scheduled_end_time: "12:00",
      })
      .eq("id", mb1.id);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: addDays(today, -48),
        scheduled_start_time: "08:00",
        scheduled_end_time: "12:00",
      })
      .eq("id", mb2.id);
    const codeOfDay = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_completion_codes")
          .select("code")
          .eq("mission_day_id", dayId)
          .single()
      ).data?.code;
    await http("POST", `/api/missions/${mB}/start`, C4.cookie, {
      mission_day_id: mb1.id,
    });
    await http("POST", `/api/missions/${mB}/complete`, C4.cookie, {
      code: await codeOfDay(mb1.id),
      mission_day_id: mb1.id,
    });
    await closeQ(jB);
    await sweep();
    const q8 = await stored();
    report(
      "Q8 période complète close, une journée confirmée sur deux : journée non résolue, aucune unité (forfait global, aucune division)",
      !(await offersQ()).includes(jB) && q8?.experience_units === 5,
      q8,
    );
    await http("POST", `/api/missions/${mB}/start`, C4.cookie, {
      mission_day_id: mb2.id,
    });
    await http("POST", `/api/missions/${mB}/complete`, C4.cookie, {
      code: await codeOfDay(mb2.id),
      mission_day_id: mb2.id,
    });
    const q9 = await stored();
    report(
      "Q9 dernière journée confirmée : +1 pour la période",
      (await offersQ()).includes(jB) && q9?.experience_units === 6,
      q9,
    );

    // Offre sans travail réalisé, close : aucune unité.
    const {
      jobId: jZ,
      dayIds: [qz1],
    } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Offre sans travail",
        company_id: coQ,
        mission_pay_per_candidate: 4000,
        positions_available: 1,
      },
      [
        {
          date: "2099-12-20",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
          positions: 1,
        },
      ],
      "per_day",
    );
    const [appZ] = await applyDays(C5, jZ, [qz1]);
    await selectQ(appZ);
    const { jobId: jEmpty } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Offre sans sélection",
        company_id: coQ,
        mission_pay_per_candidate: 4000,
        positions_available: 1,
      },
      [{ date: "2099-12-22", start_time: "08:00", end_time: "12:00" }],
    );
    await closeQ(jZ);
    await closeQ(jEmpty);
    await sweep();
    const q10 = await stored();
    report(
      "Q10 offres closes sans travail réalisé (sélection non réalisée, aucune sélection) : aucune unité",
      !(await offersQ()).includes(jZ) &&
        !(await offersQ()).includes(jEmpty) &&
        q10?.experience_units === 6,
      q10,
    );

    // Clôture par le temps seule : réalisation pendant le recrutement, puis
    // échéance passée sans aucune autre action que la tâche planifiée.
    const {
      jobId: jT,
      dayIds: [qt1],
    } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Clôture par le temps",
        company_id: coQ,
        mission_pay_per_candidate: 4000,
        positions_available: 1,
      },
      [
        {
          date: "2099-12-26",
          start_time: "08:00",
          end_time: "12:00",
          pay: 4000,
          positions: 1,
        },
      ],
      "per_day",
    );
    const [appT] = await applyDays(C6, jT, [qt1]);
    const mT = await selectQ(appT);
    await realize(C6, mT);
    const beforeClose = await stored();
    // Offre T entièrement réalisée, recrutement encore ouvert : une remise en
    // revue du dossier la masque mais ne clôt pas son recrutement.
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coQ);
    const reviewAvail = (await anon.rpc("job_availability", { p_job_id: jT }))
      .data;
    const reviewOffers = await offersQ();
    await refreshQ();
    const reviewStored = await stored();
    await approveCompanyDossier(serviceClient, coQ);
    report(
      "Q3b offre entièrement réalisée, dossier remis en revue (offre masquée, recrutement temporairement impossible) : pas une clôture, aucune unité",
      reviewAvail === "unavailable" &&
        !reviewOffers.includes(jT) &&
        reviewStored?.experience_units === 6,
      { reviewAvail, reviewStored },
    );
    const { data: jtRow } = await serviceClient
      .from("jobs")
      .select("applications_close_at")
      .eq("id", jT)
      .single();
    const plannedT = await closeQ(jT);
    const { data: closedT } = await serviceClient
      .from("jobs")
      .select("applications_close_at")
      .eq("id", jT)
      .single();
    const projectionBefore = await stored();
    const swept = await sweep();
    const afterSweep = await stored();
    const atBefore = new Date(
      Date.parse(closedT?.applications_close_at ?? "") - 1,
    ).toISOString();
    report(
      "Q11 clôture par le temps sans autre action : recalcul programmé à l'échéance (next_expiry_at), tâche planifiée → +1 ; recalcul déterministe (avant l'échéance : rien)",
      beforeClose?.experience_units === 6 &&
        Date.parse(plannedT.planned ?? "") ===
          Date.parse(jtRow?.applications_close_at ?? "") &&
        projectionBefore?.experience_units === 6 &&
        swept.error === null &&
        afterSweep?.experience_units === 7 &&
        (await offersQ()).includes(jT) &&
        !(await offersQ(atBefore)).includes(jT),
      { beforeClose, plannedT, projectionBefore, afterSweep },
    );

    // ── D. Suspension et dossier ────────────────────────────────
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", cand[1]);
    const dSusp = await C2.client.rpc("apply_to_job_days", {
      p_job_id: jobPer,
      p_day_ids: [pd2.id],
    });
    await serviceClient
      .from("users")
      .update({ is_active: true })
      .eq("id", cand[1]);
    const c2app = await appOf(pd1.id, prof[1]);
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idA);
    const dCompany = await signAndSelectRpc(A.client, c2app);
    await serviceClient.from("users").update({ is_active: true }).eq("id", idA);
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coA);
    const dDossier = await signAndSelectRpc(A.client, c2app);
    const dAnonDays = await anon.rpc("job_days_for_candidate", {
      p_job_id: jobPer,
    });
    await approveCompanyDossier(serviceClient, coA);
    report(
      "D1 candidat suspendu, entreprise suspendue, dossier entreprise non valide : candidature et sélection refusées ; offre masquée aux nouveaux visiteurs, journées comprises",
      dSusp.error?.message === "account_suspended" &&
        dCompany.error?.message === "account_suspended" &&
        (dDossier.error?.message === "company_not_verified" ||
          dDossier.error?.message === "job_not_available") &&
        dAnonDays.error?.message === "job_not_found",
      {
        susp: dSusp.error?.message,
        company: dCompany.error?.message,
        dossier: dDossier.error?.message,
        anon: dAnonDays.error?.message,
      },
    );
  } finally {
    dropProofObjects();
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(
    `Preuve lot 12 échouée : ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  dropProofObjects();
  process.exit(1);
});
