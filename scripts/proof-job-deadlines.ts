/**
 * Preuve lot 11b — échéances de candidature et de sélection (décisions
 * produit validées le 2026-11-11).
 *
 * Données fictives, pile locale uniquement. Vraies sessions : entreprise A
 * (plan Pro pour la modification directe), candidats C1 à C6, admins ops
 * O1 et O2, client anonyme.
 *
 * Limites temporelles exactes : une fonction de preuve temporaire
 * (`proof_l11b_case`, clé service seulement) place l'échéance ou le début
 * relativement à now() PUIS appelle la vraie RPC sous l'identité de la
 * session, dans la même transaction : now() y est identique, l'instant
 * testé est donc exact à la microseconde (avant, exactement, après). Aucune
 * attente, aucune relance. Pour une offre publiée, horaires et échéance
 * étant figés pour tout auteur, la fonction désactive le trigger de garde le
 * temps de ce seul déplacement, dans sa transaction (pile jetable).
 *
 *   N. Régime normal : candidature juste avant H−24, exactement H−24, juste
 *      après ; sélection aux mêmes instants.
 *   U. Régime urgent : mêmes cas à H−2.
 *   P. Publication (moderate_job) : H−24 + 1 µs (normal), exactement H−24
 *      (refus), H−24 − 1 µs (urgent), H−4 (urgent), H−4 − 1 µs (refus),
 *      début passé (RPC et route), écriture directe de service.
 *   L. Liste, lien direct et disponibilité d'une offre close ; offre dont le
 *      début est passé (route et RPC).
 *   G. Badge « Urgente » d'une offre normale : aucune prolongation.
 *   V. Revalidation du dossier après clôture : aucune réouverture, régime
 *      et échéance inchangés.
 *   S. Relance d'une sélection réussie après clôture : même mission et même
 *      contrat ; contrat signable, retrait d'une candidature en attente.
 *   F. Champs forgés par une session : régime, échéance, première
 *      publication (RPC, PostgREST direct) ; ancienne option `urgency` ;
 *      début non publiable à la saisie (RPC et route) ; régime figé même
 *      pour la clé service.
 *   D. Dates et horaires après la première publication (règle de
 *      lancement) : modifiables avant, refusés après par route, RPC et
 *      écriture privilégiée (clé service) ; mêmes valeurs renvoyées
 *      acceptées ; offres normales et urgentes, ouvertes et closes ; offre
 *      revenue en modération ; offre close avec candidatures ; correction
 *      d'un autre champ puis nouvelle modération sans changement temporel ;
 *      revalidation du dossier ; contrat inchangé ; offre publiée avant le
 *      lot (close, dates figées, jamais de régime).
 *   R. Concurrence : double approbation à ordre imposé (un seul régime),
 *      relances simultanées, candidatures simultanées sur une offre close.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database, Json } from "@/lib/database.types";
import { isJobUrgent } from "@/lib/jobs/urgency";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
// Fonction de preuve temporaire : absente des types générés.
type AnyRpc = Pick<SupabaseClient, "rpc">;

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L11b-deadlines-01!";
const PROOF_USER_METADATA = { proofJobDeadlines: true };
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
  const r = runSupabaseQuery(DB_URL, sql, { proof: "job-deadlines" });
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
}

// ─── Fonctions de preuve temporaires ─────────────────────────────
// Temps simulé dans la transaction de la RPC testée. `apply` / `select` :
// l'échéance est placée à now() + p_offset et le début reste cohérent avec
// le régime figé (H−24 ou H−2). `moderate` : le début d'une offre en
// attente est placé à now() + p_offset. Puis la vraie RPC est appelée sous
// l'identité p_actor ; un refus annule ses effets (sous-bloc).
const CASE_FN = `
create or replace function public.proof_l11b_case(
  p_kind text, p_job uuid, p_actor uuid, p_target uuid, p_offset interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regime text;
  v_start timestamptz;
  v_local timestamp;
  v_err text;
  v_ret jsonb;
begin
  if p_kind in ('apply', 'select') then
    select j.publication_regime into v_regime from public.jobs j where j.id = p_job;
    v_start := now() + p_offset
      + case when v_regime = 'urgent' then interval '2 hours' else interval '24 hours' end;
    v_local := v_start at time zone 'Africa/Douala';
    alter table public.jobs disable trigger trg_job_publication_guard;
    update public.jobs j
    set start_date = v_local::date, start_time = v_local::time,
        applications_close_at = now() + p_offset
    where j.id = p_job;
    alter table public.jobs enable trigger trg_job_publication_guard;
  elsif p_kind = 'moderate' then
    v_local := (now() + p_offset) at time zone 'Africa/Douala';
    update public.jobs j
    set start_date = v_local::date, start_time = v_local::time
    where j.id = p_job;
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  begin
    if p_kind = 'apply' then
      perform public.apply_to_job(p_job);
    elsif p_kind = 'select' then
      perform * from public.select_candidate(p_target);
    elsif p_kind = 'moderate' then
      perform public.moderate_job(p_job, 'approve', null, null);
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  select jsonb_build_object(
    'error', v_err,
    'status', j.status,
    'regime', j.publication_regime,
    'first_is_now', j.first_published_at = now(),
    'close_from_now_us',
      (extract(epoch from (j.applications_close_at - now())) * 1000000)::bigint,
    'start_minus_close_us',
      (extract(epoch from (public.job_start_instant(j.start_date, j.start_time)
                           - j.applications_close_at)) * 1000000)::bigint,
    'applications', (select count(*) from public.job_applications a where a.job_id = j.id),
    'missions', (select count(*) from public.missions m where m.job_id = j.id),
    'contracts', (select count(*) from public.contracts c where c.job_id = j.id))
  into v_ret
  from public.jobs j where j.id = p_job;
  return v_ret;
end;
$$`;

const SLOW_JOB = `
create or replace function public.proof_l11b_slow_job_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_sleep(1.5);
  return new;
end;
$$`;

function installCase() {
  execSql(CASE_FN);
  execSql(
    "revoke all on function public.proof_l11b_case(text, uuid, uuid, uuid, interval) from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_l11b_case(text, uuid, uuid, uuid, interval) to service_role",
  );
}
function dropProofObjects() {
  execSql("drop trigger if exists proof_l11b_slow_job_update on public.jobs");
  execSql("drop function if exists public.proof_l11b_slow_job_update()");
  execSql(
    "drop function if exists public.proof_l11b_case(text, uuid, uuid, uuid, interval)",
  );
  dropBarrier(execSql);
}

type CaseResult = {
  error: string | null;
  status: string | null;
  regime: string | null;
  first_is_now: boolean | null;
  close_from_now_us: number | null;
  start_minus_close_us: number | null;
  applications: number;
  missions: number;
  contracts: number;
};

async function runCase(
  kind: "apply" | "select" | "moderate",
  job: string,
  actor: string,
  offset: string,
  target: string | null = null,
): Promise<CaseResult> {
  const { data, error } = await serviceRpc.rpc("proof_l11b_case", {
    p_kind: kind,
    p_job: job,
    p_actor: actor,
    p_target: target,
    p_offset: offset,
  });
  if (error) throw new Error(`proof_l11b_case : ${error.message}`);
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
      niu: `M0${String(STAMP).slice(-9)}${name.length}D`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
      // Modification directe des offres actives (lot 7d) : plan Pro.
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
      last_name: "Échéance",
      date_of_birth: "1995-03-12",
      city: "Douala",
      address: "Akwa",
      latitude: 4.05,
      longitude: 9.7,
      cni_number: `CNI11B${firstName}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677007012",
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
      await serviceClient.from("audit_logs").delete().in("resource_id", jobIds);
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
      .filter((u) => u.user_metadata?.proofJobDeadlines === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
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

/** Date et heure de Douala (UTC+1) d'un instant. */
function doualaParts(ms: number): { date: string; time: string } {
  const iso = new Date(ms + HOUR).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// ─── Preuve ──────────────────────────────────────────────────────
async function main() {
  console.log("Preuve lot 11b — échéances de candidature et de sélection\n");
  await cleanStale();
  const ids: string[] = [];
  try {
    const mail = (k: string) => `proof-l11b-${k}-${STAMP}@easyjob.test`;
    const idA = await createAccount(mail("a"), "company");
    const idO1 = await createAccount(mail("ops1"), "admin_ops");
    const idO2 = await createAccount(mail("ops2"), "admin_ops");
    const cand = await Promise.all(
      ["c1", "c2", "c3", "c4", "c5", "c6"].map((k) =>
        createAccount(mail(k), "candidate"),
      ),
    );
    ids.push(idA, idO1, idO2, ...cand);
    const coA = await createCompany(idA, "Échéances SARL");
    const candProfiles = await Promise.all(
      cand.map((id, i) => createCandidate(id, `Cand${i + 1}`)),
    );
    const A = await realSession(idA, mail("a"));
    const O1 = await realSession(idO1, mail("ops1"));
    const O2 = await realSession(idO2, mail("ops2"));
    const [C1, C2, C3, C4, C5, C6] = await Promise.all(
      cand.map((id, i) => realSession(id, mail(`c${i + 1}`))),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    installCase();
    await installBarrier(execSql, serviceClient);

    const now = Date.now();
    /** Offre écrite par la clé service ; le trigger fixe le régime. */
    const seedJob = async (
      title: string,
      startMs: number,
      status: "active" | "pending_review",
      positions = 3,
    ) => {
      const { date, time } = doualaParts(startMs);
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          title,
          description: "Preuve des échéances du lot 11b.",
          address: "Boulevard de la Liberté",
          city: "Douala",
          start_date: date,
          start_time: time,
          end_time: "23:59",
          mission_pay_per_candidate: 2500,
          company_id: coA,
          status,
          positions_available: positions,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id as string;
    };
    /** Offre insérée « déjà publiée » (clé service) : horaire et échéance fournis. */
    const seedPublished = async (
      title: string,
      startMs: number,
      closeMs: number,
      regime: "normal" | "urgent" = "normal",
    ) => {
      const { date, time } = doualaParts(startMs);
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          title,
          description: "Preuve des échéances du lot 11b.",
          address: "Boulevard de la Liberté",
          city: "Douala",
          start_date: date,
          start_time: time,
          end_time: "23:59",
          mission_pay_per_candidate: 2500,
          company_id: coA,
          status: "active",
          positions_available: 3,
          first_published_at: new Date(now - 3 * 24 * HOUR).toISOString(),
          publication_regime: regime,
          applications_close_at: new Date(closeMs).toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id as string;
    };
    /** Données temporelles d'une offre (sans updated_at). */
    const temporal = async (id: string) =>
      JSON.stringify(
        (
          await serviceClient
            .from("jobs")
            .select(
              "start_date, end_date, start_time, end_time, first_published_at, publication_regime, applications_close_at",
            )
            .eq("id", id)
            .single()
        ).data,
      );
    const jobRow = async (id: string) =>
      (
        await serviceClient
          .from("jobs")
          .select(
            "status, publication_regime, first_published_at, applications_close_at, start_date, start_time, updated_at",
          )
          .eq("id", id)
          .single()
      ).data;
    const applyRoute = (s: Session, jobId: string) =>
      http("POST", `/api/jobs/${jobId}/apply`, s.cookie);
    type Selection = {
      mission_id?: string;
      contract_id?: string;
      already_selected?: boolean;
    };
    const selectRoute = async (applicationId: string) => {
      const r = await http(
        "POST",
        `/api/applications/${applicationId}/select`,
        A.cookie,
      );
      return { ...r, selection: (r.body.selection ?? {}) as Selection };
    };
    const applicationOf = async (jobId: string, candidateId: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("id, status")
          .eq("job_id", jobId)
          .eq("candidate_id", candidateId)
          .maybeSingle()
      ).data;
    const listIds = async (cookie: string | null) => {
      const r = await http("GET", "/api/jobs?limit=100", cookie);
      return ((r.body.jobs as { id: string }[] | undefined) ?? []).map(
        (j) => j.id,
      );
    };
    const availability = async (client: DB, id: string) =>
      (await client.rpc("job_availability", { p_job_id: id })).data;

    // ── Régimes déduits à la première publication (trigger) ───────
    const jobN = await seedJob(
      "Offre normale L11b",
      now + 5 * 24 * HOUR,
      "active",
    );
    const jobU = await seedJob("Offre urgente L11b", now + 10 * HOUR, "active");
    const rN = await jobRow(jobN);
    const rU = await jobRow(jobU);
    report(
      "R0 : première publication → régime normal à J+5 (échéance H−24), urgent à H+10 (échéance H−2) ; première publication enregistrée",
      rN?.publication_regime === "normal" &&
        rU?.publication_regime === "urgent" &&
        !!rN?.first_published_at &&
        !!rU?.first_published_at,
      { normal: rN?.publication_regime, urgent: rU?.publication_regime },
    );

    // ── N. Candidature, régime normal ─────────────────────────────
    const n1 = await runCase("apply", jobN, cand[0], "1 microsecond");
    const n2 = await runCase("apply", jobN, cand[1], "0");
    const n3 = await runCase("apply", jobN, cand[2], "-1 microsecond");
    report(
      "N1-N3 : candidature normale juste avant H−24 acceptée ; exactement H−24 et juste après refusées (recruitment_closed), sans effet",
      n1.error === null &&
        n1.applications === 1 &&
        n1.start_minus_close_us === 24 * 3600 * 1e6 &&
        n2.error === "recruitment_closed" &&
        n2.applications === 1 &&
        n3.error === "recruitment_closed" &&
        n3.applications === 1,
      { n1: n1.error, n2: n2.error, n3: n3.error, apps: n3.applications },
    );

    // ── U. Candidature, régime urgent ─────────────────────────────
    const u1 = await runCase("apply", jobU, cand[0], "1 microsecond");
    const u2 = await runCase("apply", jobU, cand[1], "0");
    const u3 = await runCase("apply", jobU, cand[2], "-1 microsecond");
    report(
      "U1-U3 : candidature urgente juste avant H−2 acceptée ; exactement H−2 et juste après refusées, sans effet",
      u1.error === null &&
        u1.applications === 1 &&
        u1.start_minus_close_us === 2 * 3600 * 1e6 &&
        u2.error === "recruitment_closed" &&
        u3.error === "recruitment_closed" &&
        u3.applications === 1,
      { u1: u1.error, u2: u2.error, u3: u3.error },
    );

    // ── Sélection aux mêmes instants ──────────────────────────────
    const jobSN = await seedJob(
      "Sélection normale L11b",
      now + 5 * 24 * HOUR,
      "active",
    );
    const jobSU = await seedJob(
      "Sélection urgente L11b",
      now + 10 * HOUR,
      "active",
    );
    for (const job of [jobSN, jobSU]) {
      for (const s of [C4, C5, C6]) {
        const r = await applyRoute(s, job);
        if (r.status !== 200) throw new Error(`candidature ${r.status}`);
      }
    }
    const appOf = async (job: string, i: number) =>
      (await applicationOf(job, candProfiles[i]))?.id ?? "";
    const sn1 = await runCase(
      "select",
      jobSN,
      idA,
      "1 microsecond",
      await appOf(jobSN, 3),
    );
    const sn2 = await runCase("select", jobSN, idA, "0", await appOf(jobSN, 4));
    const sn3 = await runCase(
      "select",
      jobSN,
      idA,
      "-1 microsecond",
      await appOf(jobSN, 5),
    );
    report(
      "N4-N6 : sélection normale juste avant H−24 (mission et contrat créés) ; exactement H−24 et juste après refusées, sans mission ni contrat",
      sn1.error === null &&
        sn1.missions === 1 &&
        sn1.contracts === 1 &&
        sn2.error === "recruitment_closed" &&
        sn3.error === "recruitment_closed" &&
        sn3.missions === 1 &&
        sn3.contracts === 1,
      {
        sn1: sn1.error,
        sn2: sn2.error,
        sn3: sn3.error,
        missions: sn3.missions,
      },
    );
    const su1 = await runCase(
      "select",
      jobSU,
      idA,
      "1 microsecond",
      await appOf(jobSU, 3),
    );
    const su2 = await runCase("select", jobSU, idA, "0", await appOf(jobSU, 4));
    const su3 = await runCase(
      "select",
      jobSU,
      idA,
      "-1 microsecond",
      await appOf(jobSU, 5),
    );
    report(
      "U4-U6 : sélection urgente juste avant H−2 acceptée ; exactement H−2 et juste après refusées, sans effet",
      su1.error === null &&
        su1.missions === 1 &&
        su2.error === "recruitment_closed" &&
        su3.error === "recruitment_closed" &&
        su3.missions === 1 &&
        su3.contracts === 1,
      { su1: su1.error, su2: su2.error, su3: su3.error },
    );

    // ── P. Limites de publication (moderate_job) ──────────────────
    const pending = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        seedJob(`Publication ${i} L11b`, now + 9 * 24 * HOUR, "pending_review"),
      ),
    );
    const p1 = await runCase(
      "moderate",
      pending[0],
      idO1,
      "24 hours 1 microsecond",
    );
    const p2 = await runCase("moderate", pending[1], idO1, "24 hours");
    const p3 = await runCase(
      "moderate",
      pending[2],
      idO1,
      "24 hours -1 microsecond",
    );
    const p4 = await runCase("moderate", pending[3], idO1, "4 hours");
    const p5 = await runCase(
      "moderate",
      pending[4],
      idO1,
      "4 hours -1 microsecond",
    );
    const p6 = await runCase("moderate", pending[5], idO1, "-1 hour");
    report(
      "P1 : approbation à H−24 − 1 µs du début (plus de 24 h) → régime normal, échéance H−24, première publication = instant de l'approbation",
      p1.error === null &&
        p1.status === "active" &&
        p1.regime === "normal" &&
        p1.first_is_now === true &&
        p1.close_from_now_us === 1,
      p1,
    );
    report(
      "P2 : approbation à exactement 24 h du début → refusée (job_start_too_close), offre toujours en attente, aucun régime",
      p2.error === "job_start_too_close" &&
        p2.status === "pending_review" &&
        p2.regime === null,
      p2,
    );
    report(
      "P3-P4 : approbation à moins de 24 h et à exactement 4 h du début → régime urgent, échéance H−2",
      p3.error === null &&
        p3.regime === "urgent" &&
        p3.start_minus_close_us === 2 * 3600 * 1e6 &&
        p4.error === null &&
        p4.regime === "urgent" &&
        p4.close_from_now_us === 2 * 3600 * 1e6,
      { p3: [p3.error, p3.regime], p4: [p4.error, p4.regime] },
    );
    report(
      "P5-P6 : approbation à moins de 4 h du début, puis début passé (RPC) → refusées, offres toujours en attente",
      p5.error === "job_start_too_close" &&
        p5.status === "pending_review" &&
        p6.error === "job_start_too_close" &&
        p6.status === "pending_review",
      { p5: p5.error, p6: p6.error },
    );
    const jobPast = await seedJob(
      "Début passé L11b",
      now + 9 * 24 * HOUR,
      "pending_review",
    );
    const yesterday = doualaParts(now - 24 * HOUR);
    await serviceClient
      .from("jobs")
      .update({ start_date: yesterday.date, start_time: yesterday.time })
      .eq("id", jobPast);
    const pastRow = await jobRow(jobPast);
    const pastRoute = await http(
      "POST",
      `/api/admin/jobs/${jobPast}/moderate`,
      O1.cookie,
      { action: "approve", seen_updated_at: pastRow?.updated_at },
    );
    const forcedActive = await serviceClient
      .from("jobs")
      .update({ status: "active" })
      .eq("id", jobPast);
    const pastAfter = await jobRow(jobPast);
    report(
      "P7 : début passé → approbation par la route refusée (409 job_start_too_close) ; même une écriture directe de la clé service ne publie pas (trigger)",
      pastRoute.status === 409 &&
        pastRoute.body.code === "job_start_too_close" &&
        forcedActive.error?.message === "job_start_too_close" &&
        pastAfter?.status === "pending_review" &&
        pastAfter?.first_published_at === null,
      { route: pastRoute.body.code, service: forcedActive.error?.message },
    );

    // ── L. Liste, lien direct, disponibilité ──────────────────────
    const jobOpen = await seedJob(
      "Offre ouverte L11b",
      now + 6 * 24 * HOUR,
      "active",
    );
    const listed = await listIds(C3.cookie);
    const listedAnon = await listIds(null);
    const page = await http("GET", `/jobs/${jobSN}`, C3.cookie);
    const pageOpen = await http("GET", `/jobs/${jobOpen}`, C3.cookie);
    report(
      "L1 : offre close absente de la liste (candidat, anonyme), offre ouverte présente ; disponibilité « closed » / « available »",
      !listed.includes(jobSN) &&
        !listedAnon.includes(jobSN) &&
        listed.includes(jobOpen) &&
        listedAnon.includes(jobOpen) &&
        (await availability(C3.client, jobSN)) === "closed" &&
        (await availability(anon, jobSN)) === "closed" &&
        (await availability(C3.client, jobOpen)) === "available",
      {
        closedListed: listed.includes(jobSN),
        openListed: listed.includes(jobOpen),
      },
    );
    report(
      "L2 : lien direct d'une offre close → page lisible, « candidatures closes » et « Voir les autres offres », sans bouton Postuler ; offre ouverte : Postuler et échéance affichée",
      page.status === 200 &&
        page.raw.includes('data-testid="job-closed-notice"') &&
        page.raw.includes('data-testid="job-browse-others"') &&
        !page.raw.includes('data-testid="job-apply"') &&
        pageOpen.raw.includes('data-testid="job-apply"') &&
        pageOpen.raw.includes('data-testid="job-closes-at"'),
      { closed: page.status, open: pageOpen.status },
    );
    // Offre déjà publiée dont le début est passé (fixture : publication
    // antérieure fournie par la clé service).
    const startedAt = now - HOUR;
    const sp = doualaParts(startedAt);
    const { data: started } = await serviceClient
      .from("jobs")
      .insert({
        title: "Offre commencée L11b",
        description: "Preuve des échéances du lot 11b.",
        address: "Boulevard de la Liberté",
        city: "Douala",
        start_date: sp.date,
        start_time: sp.time,
        end_time: "23:59",
        mission_pay_per_candidate: 2500,
        company_id: coA,
        status: "active",
        positions_available: 3,
        first_published_at: new Date(now - 4 * 24 * HOUR).toISOString(),
        publication_regime: "normal",
        applications_close_at: new Date(startedAt - 24 * HOUR).toISOString(),
      })
      .select("id")
      .single();
    const jobStarted = started?.id ?? "";
    const startedRoute = await applyRoute(C3, jobStarted);
    const startedRpc = await C2.client.rpc("apply_to_job", {
      p_job_id: jobStarted,
    });
    report(
      "L3 : offre dont le début est passé → candidature refusée par la route (409 recruitment_closed) et par la RPC directe, sans effet",
      startedRoute.status === 409 &&
        startedRoute.body.code === "recruitment_closed" &&
        startedRpc.error?.message === "recruitment_closed" &&
        (await applicationOf(jobStarted, candProfiles[2])) === null &&
        (await applicationOf(jobStarted, candProfiles[1])) === null,
      { route: startedRoute.body.code, rpc: startedRpc.error?.message },
    );

    // ── G. Badge « Urgente » d'une offre normale ─────────────────
    // Publiée en normal il y a trois jours : le début est désormais dans
    // 20 h, l'échéance normale (H−24) est passée depuis 4 h.
    const in20 = now + 20 * HOUR;
    const b20 = doualaParts(in20);
    const jobBadge = await seedPublished(
      "Badge normal L11b",
      in20,
      in20 - 24 * HOUR,
    );
    const badgeBefore = await jobRow(jobBadge);
    const badgeShown = isJobUrgent(
      {
        start_date: b20.date,
        start_time: b20.time,
        status: "active",
        positions_available: 3,
        positions_filled: 0,
      },
      Date.now(),
    );
    const badgeApply = await applyRoute(C3, jobBadge);
    const badgeAfter = await jobRow(jobBadge);
    report(
      "G1 : offre normale entrée dans les 24 h → badge « Urgente » affiché, mais candidature refusée (recruitment_closed) ; régime et échéance inchangés (aucune prolongation)",
      badgeShown &&
        badgeApply.body.code === "recruitment_closed" &&
        badgeAfter?.publication_regime === "normal" &&
        badgeAfter?.applications_close_at ===
          badgeBefore?.applications_close_at &&
        (await availability(C3.client, jobBadge)) === "closed",
      { badge: badgeShown, apply: badgeApply.body.code },
    );

    // ── V. Revalidation du dossier après clôture ──────────────────
    const snBefore = await jobRow(jobSN);
    const openBefore = await jobRow(jobOpen);
    await A.client
      .from("company_profiles")
      .update({ company_name: "Échéances Renommée SARL" })
      .eq("user_id", idA);
    const { data: reviewRow } = await serviceClient
      .from("company_profiles")
      .select("verification_status")
      .eq("id", coA)
      .single();
    await approveCompanyDossier(serviceClient, coA);
    const snAfter = await jobRow(jobSN);
    const openAfter = await jobRow(jobOpen);
    const reApply = await applyRoute(C3, jobSN);
    report(
      "V1 : dossier remis en revue puis revalidé → offre close toujours close (candidature refusée, disponibilité « closed », absente de la liste) ; régime, première publication et échéance inchangés",
      reviewRow?.verification_status === "pending" &&
        reApply.body.code === "recruitment_closed" &&
        (await availability(C3.client, jobSN)) === "closed" &&
        !(await listIds(C3.cookie)).includes(jobSN) &&
        JSON.stringify(snAfter) === JSON.stringify(snBefore),
      { review: reviewRow?.verification_status, apply: reApply.body.code },
    );
    report(
      "V2 : offre encore ouverte → de retour avec le même régime et la même échéance (le retour n'est pas une nouvelle publication)",
      openAfter?.publication_regime === openBefore?.publication_regime &&
        openAfter?.first_published_at === openBefore?.first_published_at &&
        openAfter?.applications_close_at ===
          openBefore?.applications_close_at &&
        (await availability(C3.client, jobOpen)) === "available",
      { regime: openAfter?.publication_regime },
    );

    // ── S. Relance après clôture, contrats et missions ────────────
    const app4 = await appOf(jobSN, 3);
    const { data: contractBefore } = await serviceClient
      .from("contracts")
      .select("id, contract_data, status")
      .eq("application_id", app4)
      .single();
    const { data: missionBefore } = await serviceClient
      .from("missions")
      .select("id, scheduled_date, scheduled_start_time, status")
      .eq("application_id", app4)
      .single();
    const replay = await selectRoute(app4);
    report(
      "S1 : relance d'une sélection réussie après clôture → 200, même mission et même contrat, aucun nouvel effet",
      replay.status === 200 &&
        replay.selection.already_selected === true &&
        replay.selection.mission_id === missionBefore?.id &&
        replay.selection.contract_id === contractBefore?.id,
      { status: replay.status, selection: replay.selection },
    );
    const contractView = await http(
      "GET",
      `/api/contracts/${contractBefore?.id}`,
      C4.cookie,
    );
    const termsHash = (
      contractView.body.contract as { terms_hash?: string } | undefined
    )?.terms_hash;
    const signed = await http(
      "POST",
      `/api/contracts/${contractBefore?.id}/sign`,
      C4.cookie,
      { terms_hash: termsHash, consent: true },
    );
    const { data: missionAfter } = await serviceClient
      .from("missions")
      .select("id, scheduled_date, scheduled_start_time, status")
      .eq("application_id", app4)
      .single();
    const { data: contractAfter } = await serviceClient
      .from("contracts")
      .select("contract_data")
      .eq("application_id", app4)
      .single();
    const app5 = await appOf(jobSN, 4);
    const ownRead = await C5.client
      .from("job_applications")
      .select("id, status")
      .eq("id", app5);
    const withdraw = await http(
      "DELETE",
      `/api/jobs/${jobSN}/apply`,
      C5.cookie,
    );
    report(
      "S2 : après clôture → contrat consultable et signable par le candidat, conditions figées et mission inchangées ; candidature en attente lisible et retirable",
      contractView.status === 200 &&
        signed.status === 200 &&
        JSON.stringify(contractAfter?.contract_data) ===
          JSON.stringify(contractBefore?.contract_data) &&
        JSON.stringify(missionAfter) === JSON.stringify(missionBefore) &&
        (ownRead.data ?? []).length === 1 &&
        withdraw.status === 200,
      {
        view: contractView.status,
        sign: signed.status,
        withdraw: withdraw.status,
      },
    );
    report(
      "S3 : aucune offre close n'a changé de statut (clôture du recrutement ≠ fin de mission)",
      (await jobRow(jobSN))?.status === "active" &&
        (await jobRow(jobSU))?.status === "active" &&
        (await jobRow(jobStarted))?.status === "active",
    );

    // ── F. Champs forgés et saisie ────────────────────────────────
    const in5d = doualaParts(now + 5 * 24 * HOUR);
    const body = {
      title: "Offre forgée L11b",
      description: "Preuve des échéances du lot 11b.",
      address: "Boulevard de la Liberté",
      city: "Douala",
      start_date: in5d.date,
      start_time: in5d.time,
      end_time: "23:59",
      mission_pay_per_candidate: 2500,
    };
    const forged: Record<string, unknown> = {};
    for (const [k, v] of [
      ["publication_regime", "urgent"],
      ["applications_close_at", "2099-01-01T00:00:00Z"],
      ["first_published_at", "2020-01-01T00:00:00Z"],
    ] as const) {
      const r = await A.client.rpc("create_job", {
        p_job: { ...body, [k]: v },
      });
      forged[k] = [r.error?.message, r.error?.details];
    }
    const forgedOk = Object.values(forged).every(
      (v) =>
        (v as string[])[0] === "invalid_job_data" &&
        (v as string[])[1] === "publication",
    );
    const forgedUpdate = await A.client.rpc("update_job", {
      p_job_id: jobOpen,
      p_job: { ...body, publication_regime: "urgent" },
    });
    const directUpdate = await A.client
      .from("jobs")
      .update({
        applications_close_at: "2099-01-01T00:00:00Z",
        publication_regime: "urgent",
      })
      .eq("id", jobSN)
      .select("id");
    const directInsert = await A.client
      .from("jobs")
      .insert({
        ...body,
        company_id: coA,
        status: "active",
        publication_regime: "urgent",
        first_published_at: new Date().toISOString(),
        applications_close_at: "2099-01-01T00:00:00Z",
      })
      .select("id");
    report(
      "F1 : régime, échéance ou première publication fournis par la session → create_job et update_job refusent (invalid_job_data), PostgREST direct refusé, offre inchangée",
      forgedOk &&
        forgedUpdate.error?.message === "invalid_job_data" &&
        !!directUpdate.error &&
        !!directInsert.error &&
        JSON.stringify(await jobRow(jobSN)) === JSON.stringify(snAfter),
      {
        forged,
        update: forgedUpdate.error?.message,
        direct: directUpdate.error?.code,
        insert: directInsert.error?.code,
      },
    );
    const lockedRegime = await serviceClient
      .from("jobs")
      .update({ publication_regime: "urgent" })
      .eq("id", jobSN);
    const lockedFirst = await serviceClient
      .from("jobs")
      .update({ first_published_at: new Date().toISOString() })
      .eq("id", jobSN);
    report(
      "F2 : régime et première publication figés même pour la clé service (publication_regime_locked)",
      lockedRegime.error?.message === "publication_regime_locked" &&
        lockedFirst.error?.message === "publication_regime_locked",
      {
        regime: lockedRegime.error?.message,
        first: lockedFirst.error?.message,
      },
    );
    const in3h = doualaParts(now + 3 * HOUR);
    const tooCloseRpc = await A.client.rpc("create_job", {
      p_job: { ...body, start_date: in3h.date, start_time: in3h.time },
    });
    const tooCloseRoute = await http("POST", "/api/jobs", A.cookie, {
      ...body,
      start_date: in3h.date,
      start_time: in3h.time,
    });
    report(
      "F3 : saisie d'une offre commençant dans 3 h → refusée (RPC et route : 409 job_start_too_close), aucune offre créée",
      tooCloseRpc.error?.message === "job_start_too_close" &&
        tooCloseRoute.status === 409 &&
        tooCloseRoute.body.code === "job_start_too_close",
      { rpc: tooCloseRpc.error?.message, route: tooCloseRoute.body.code },
    );
    // L'ancienne option manuelle `urgency` ne fait pas une publication urgente.
    const legacy = await A.client.rpc("create_job", {
      p_job: {
        ...body,
        title: "Ancienne option urgente L11b",
        urgency: "urgent",
      },
    });
    const legacyId = legacy.data?.id ?? "";
    const legacyMod = await http(
      "POST",
      `/api/admin/jobs/${legacyId}/moderate`,
      O1.cookie,
      { action: "approve", seen_updated_at: legacy.data?.updated_at },
    );
    const legacyRow = await jobRow(legacyId);
    report(
      "F4 : ancienne option `urgency: urgent` à J+5 → publiée en régime normal (échéance H−24) : seul l'horaire approuvé fixe le régime",
      !legacy.error &&
        legacyMod.status === 200 &&
        legacyRow?.publication_regime === "normal",
      { regime: legacyRow?.publication_regime },
    );

    // ── D. Dates et horaires après la première publication ────────
    type JobPayload = { [key: string]: Json | undefined };
    /** Contenu complet renvoyé pour une offre (comme le formulaire). */
    const contentOf = async (id: string, extra: JobPayload = {}) => {
      const { data } = await serviceClient
        .from("jobs")
        .select("title, start_date, end_date, start_time, end_time")
        .eq("id", id)
        .single();
      return {
        title: data?.title ?? "",
        description: "Preuve des échéances du lot 11b.",
        address: "Boulevard de la Liberté",
        city: "Douala",
        start_date: data?.start_date ?? "",
        end_date: data?.end_date ?? data?.start_date ?? "",
        start_time: data?.start_time ?? "",
        end_time: data?.end_time ?? "",
        mission_pay_per_candidate: 2500,
        ...extra,
      };
    };
    const updateRpc = (id: string, payload: JobPayload) =>
      A.client.rpc("update_job", { p_job_id: id, p_job: payload });
    const updateRoute = (id: string, payload: JobPayload) =>
      http("PATCH", `/api/jobs/${id}`, A.cookie, payload);
    const later = (date: string, days: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * HOUR)
        .toISOString()
        .slice(0, 10);

    // D1 — jamais publiée : dates et horaires modifiables.
    const jobDraft = await seedJob(
      "Offre jamais publiée L11b",
      now + 9 * 24 * HOUR,
      "pending_review",
    );
    const draftContent = await contentOf(jobDraft);
    const draftRpc = await updateRpc(jobDraft, {
      ...draftContent,
      start_date: later(draftContent.start_date, 1),
      end_date: later(draftContent.start_date, 1),
      start_time: "09:30",
    });
    const draftRoute = await updateRoute(jobDraft, {
      ...draftContent,
      start_date: later(draftContent.start_date, 2),
      end_date: later(draftContent.start_date, 2),
    });
    const draftRow = await jobRow(jobDraft);
    report(
      "D1 : offre jamais publiée → date et horaires modifiables (RPC puis route), toujours sans régime",
      !draftRpc.error &&
        draftRoute.status === 200 &&
        draftRow?.start_date === later(draftContent.start_date, 2) &&
        draftRow?.publication_regime === null,
      { rpc: draftRpc.error?.message, route: draftRoute.status },
    );

    // Offres publiées : normale et urgente, ouvertes et closes.
    const published = {
      "normale ouverte": await seedJob(
        "Normale ouverte L11b",
        now + 6 * 24 * HOUR,
        "active",
      ),
      "urgente ouverte": await seedJob(
        "Urgente ouverte L11b",
        now + 10 * HOUR,
        "active",
      ),
      "normale close": await seedPublished(
        "Normale close L11b",
        now + 20 * HOUR,
        now - 4 * HOUR,
      ),
      "urgente close": await seedPublished(
        "Urgente close L11b",
        now + HOUR,
        now - HOUR,
        "urgent",
      ),
    };
    const openN = published["normale ouverte"];
    const closedN = published["normale close"];
    const snapshot: Record<string, string> = {};
    for (const [k, id] of Object.entries(published)) {
      snapshot[k] = await temporal(id);
    }
    const unchanged = async () => {
      for (const [k, id] of Object.entries(published)) {
        if ((await temporal(id)) !== snapshot[k]) return false;
      }
      return true;
    };

    // D2 — changement de date ou d'horaire refusé par la RPC, partout.
    const moved: Record<string, unknown> = {};
    for (const [k, id] of Object.entries(published)) {
      const c = await contentOf(id);
      const date = await updateRpc(id, {
        ...c,
        start_date: later(c.start_date, 2),
        end_date: later(c.start_date, 2),
      });
      const hour = await updateRpc(id, { ...c, end_time: "22:00" });
      moved[k] = [date.error?.message, hour.error?.message];
    }
    report(
      "D2 : offre publiée (normale et urgente, ouverte et close) → date repoussée ou horaire changé refusés par la RPC (job_schedule_locked), données temporelles inchangées",
      Object.values(moved).every(
        (v) =>
          (v as string[])[0] === "job_schedule_locked" &&
          (v as string[])[1] === "job_schedule_locked",
      ) && (await unchanged()),
      moved,
    );

    // D3 — route et écriture privilégiée (clé service).
    const cN = await contentOf(openN);
    const routeMove = await updateRoute(openN, {
      ...cN,
      start_date: later(cN.start_date, 1),
      end_date: later(cN.start_date, 1),
    });
    const serviceDate = await serviceClient
      .from("jobs")
      .update({ start_date: later(cN.start_date, 1) })
      .eq("id", openN);
    const serviceTime = await serviceClient
      .from("jobs")
      .update({ end_time: "22:00" })
      .eq("id", closedN);
    const serviceClose = await serviceClient
      .from("jobs")
      .update({ applications_close_at: new Date(now + 9 * HOUR).toISOString() })
      .eq("id", closedN);
    const serviceFirst = await serviceClient
      .from("jobs")
      .update({ first_published_at: new Date().toISOString() })
      .eq("id", openN);
    report(
      "D3 : même refus par la route (409 job_schedule_locked) et pour la clé service (date, horaire : job_schedule_locked ; échéance, première publication : publication_regime_locked)",
      routeMove.status === 409 &&
        routeMove.body.code === "job_schedule_locked" &&
        serviceDate.error?.message === "job_schedule_locked" &&
        serviceTime.error?.message === "job_schedule_locked" &&
        serviceClose.error?.message === "publication_regime_locked" &&
        serviceFirst.error?.message === "publication_regime_locked" &&
        (await unchanged()),
      {
        route: routeMove.body.code,
        date: serviceDate.error?.message,
        time: serviceTime.error?.message,
        close: serviceClose.error?.message,
        first: serviceFirst.error?.message,
      },
    );

    // D4 — mêmes valeurs renvoyées avec une autre correction : acceptée.
    const fixes: Record<string, unknown> = {};
    for (const [k, id] of Object.entries(published)) {
      const c = await contentOf(id, { title: `${k} corrigée L11b` });
      const r =
        id === openN
          ? await updateRoute(id, c)
          : await updateRpc(id, c).then((x) => ({
              status: x.error ? 409 : 200,
              body: { code: x.error?.message },
            }));
      fixes[k] = [r.status, r.body.code ?? null, (await jobRow(id))?.status];
    }
    report(
      "D4 : mêmes dates et horaires renvoyés avec un titre corrigé (route pour l'une, RPC pour les autres, offres ouvertes et closes) → acceptés, offre repassée en modération, aucune donnée temporelle changée",
      Object.values(fixes).every(
        (v) =>
          (v as unknown[])[0] === 200 &&
          (v as unknown[])[2] === "pending_review",
      ) && (await unchanged()),
      fixes,
    );

    // D5 — revenue en attente de modération : toujours figée.
    const cPending = await contentOf(openN);
    const pendingMove = await updateRpc(openN, {
      ...cPending,
      start_time: "06:00",
    });
    report(
      "D5 : offre revenue en attente de modération après une autre correction → changement d'horaire toujours refusé",
      pendingMove.error?.message === "job_schedule_locked" &&
        (await unchanged()),
      { error: pendingMove.error?.message },
    );

    // D6 — nouvelle modération : rien de temporel ne change.
    const reapprovals: Record<string, number> = {};
    for (const [k, id] of Object.entries(published)) {
      const row = await jobRow(id);
      const r = await http(
        "POST",
        `/api/admin/jobs/${id}/moderate`,
        O1.cookie,
        { action: "approve", seen_updated_at: row?.updated_at },
      );
      reapprovals[k] = r.status;
    }
    report(
      "D6 : nouvelle approbation des versions corrigées → actives, dates, première publication, régime et échéance inchangés ; ouvertes « available », closes « closed »",
      Object.values(reapprovals).every((st) => st === 200) &&
        (await unchanged()) &&
        (await jobRow(openN))?.status === "active" &&
        (await availability(C3.client, openN)) === "available" &&
        (await availability(C3.client, closedN)) === "closed" &&
        (await availability(C3.client, published["urgente close"])) ===
          "closed",
      reapprovals,
    );

    // D7 — repousser une offre close avec des données liées.
    const jobLinked = await seedPublished(
      "Offre close liée L11b",
      now + 20 * HOUR,
      now - 4 * HOUR,
    );
    await serviceClient.from("job_applications").insert([
      { job_id: jobLinked, candidate_id: candProfiles[0], status: "pending" },
      { job_id: jobLinked, candidate_id: candProfiles[1], status: "pending" },
    ]);
    const linkedBefore = await temporal(jobLinked);
    const appsBefore = JSON.stringify(
      (
        await serviceClient
          .from("job_applications")
          .select("id, status")
          .eq("job_id", jobLinked)
          .order("id")
      ).data,
    );
    const cL = await contentOf(jobLinked);
    const pushLinked = await updateRoute(jobLinked, {
      ...cL,
      start_date: later(cL.start_date, 3),
      end_date: later(cL.start_date, 3),
    });
    const snTemporal = await temporal(jobSN);
    const cS = await contentOf(jobSN);
    const pushSelected = await updateRpc(jobSN, {
      ...cS,
      start_date: later(cS.start_date, 3),
      end_date: later(cS.start_date, 3),
    });
    const { data: contractNow } = await serviceClient
      .from("contracts")
      .select("contract_data")
      .eq("application_id", app4)
      .single();
    const appsAfter = JSON.stringify(
      (
        await serviceClient
          .from("job_applications")
          .select("id, status")
          .eq("job_id", jobLinked)
          .order("id")
      ).data,
    );
    report(
      "D7 : offre close repoussée → refusée (409 job_schedule_locked) ; statut, régime, échéance, horaires et candidatures inchangés ; offre avec candidat sélectionné : refus, conditions figées du contrat identiques",
      pushLinked.status === 409 &&
        pushLinked.body.code === "job_schedule_locked" &&
        (await temporal(jobLinked)) === linkedBefore &&
        (await jobRow(jobLinked))?.status === "active" &&
        appsAfter === appsBefore &&
        !!pushSelected.error &&
        JSON.stringify(contractNow?.contract_data) ===
          JSON.stringify(contractBefore?.contract_data) &&
        (await temporal(jobSN)) === snTemporal,
      {
        linked: pushLinked.body.code,
        selected: pushSelected.error?.message,
      },
    );

    // D8 — revalidation du dossier : aucun changement temporel.
    await A.client
      .from("company_profiles")
      .update({ company_name: "Échéances Seconde SARL" })
      .eq("user_id", idA);
    await approveCompanyDossier(serviceClient, coA);
    report(
      "D8 : dossier remis en revue puis revalidé → dates, première publication, régime et échéance des offres publiées inchangés",
      (await unchanged()) && (await temporal(jobLinked)) === linkedBefore,
    );

    // D9 — offre publiée avant le lot (sans historique fiable).
    const legacyStart = doualaParts(now + 5 * 24 * HOUR);
    const { data: legacyIns } = await serviceClient
      .from("jobs")
      .insert({
        title: "Offre antérieure L11b",
        description: "Preuve des échéances du lot 11b.",
        address: "Boulevard de la Liberté",
        city: "Douala",
        start_date: legacyStart.date,
        start_time: legacyStart.time,
        end_time: "23:59",
        mission_pay_per_candidate: 2500,
        company_id: coA,
        status: "active",
        positions_available: 3,
        legacy_publication: true,
      })
      .select("id")
      .single();
    const jobOld = legacyIns?.id ?? "";
    const oldBefore = await temporal(jobOld);
    const oldApply = await applyRoute(C3, jobOld);
    const cO = await contentOf(jobOld);
    const oldMove = await updateRpc(jobOld, {
      ...cO,
      start_date: later(cO.start_date, 1),
      end_date: later(cO.start_date, 1),
    });
    const oldFix = await updateRpc(jobOld, {
      ...cO,
      title: "Offre antérieure corrigée L11b",
    });
    const oldPending = await jobRow(jobOld);
    const oldMod = await http(
      "POST",
      `/api/admin/jobs/${jobOld}/moderate`,
      O1.cookie,
      { action: "approve", seen_updated_at: oldPending?.updated_at },
    );
    const oldFlag = await serviceClient
      .from("jobs")
      .update({ legacy_publication: false })
      .eq("id", jobOld);
    report(
      "D9 : offre publiée avant le lot → close (recruitment_closed), dates figées (job_schedule_locked) ; correction d'un autre champ puis nouvelle approbation → active mais toujours close, sans régime ni date inventée ; marqueur non modifiable, même en clé service",
      oldApply.body.code === "recruitment_closed" &&
        oldMove.error?.message === "job_schedule_locked" &&
        !oldFix.error &&
        oldPending?.status === "pending_review" &&
        oldMod.status === 200 &&
        (await jobRow(jobOld))?.status === "active" &&
        (await temporal(jobOld)) === oldBefore &&
        (await availability(C3.client, jobOld)) === "closed" &&
        oldFlag.error?.message === "publication_regime_locked",
      {
        apply: oldApply.body.code,
        move: oldMove.error?.message,
        moderation: oldMod.status,
        flag: oldFlag.error?.message,
      },
    );

    // ── R. Concurrence ────────────────────────────────────────────
    const jobC = await seedJob(
      "Double approbation L11b",
      now + 7 * 24 * HOUR,
      "pending_review",
    );
    const cRow = await jobRow(jobC);
    execSql(SLOW_JOB);
    execSql(`
      create trigger proof_l11b_slow_job_update before update on public.jobs
        for each row when (old.id = '${jobC}'::uuid)
        execute function public.proof_l11b_slow_job_update()`);
    const first = http("POST", `/api/admin/jobs/${jobC}/moderate`, O1.cookie, {
      action: "approve",
      seen_updated_at: cRow?.updated_at,
    });
    await waitSleeping(serviceClient);
    const second = http("POST", `/api/admin/jobs/${jobC}/moderate`, O2.cookie, {
      action: "approve",
      seen_updated_at: cRow?.updated_at,
    });
    const [r1, r2] = await Promise.all([first, second]);
    execSql("drop trigger if exists proof_l11b_slow_job_update on public.jobs");
    const { count: approvals } = await serviceClient
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("resource_id", jobC)
      .eq("action", "approve_job");
    const cAfter = await jobRow(jobC);
    report(
      "R1 : deux approbations simultanées (ordre imposé) → une seule publication, régime fixé une fois ; la seconde reçoit 409 (job_not_pending ou job_changed)",
      r1.status === 200 &&
        r2.status === 409 &&
        (r2.body.code === "job_not_pending" ||
          r2.body.code === "job_changed") &&
        approvals === 1 &&
        cAfter?.publication_regime === "normal",
      { first: r1.status, second: [r2.status, r2.body.code], approvals },
    );
    const before = await Promise.all([
      serviceClient
        .from("missions")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobSN),
      serviceClient
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobSN),
    ]);
    const replays = await Promise.all([1, 2, 3].map(() => selectRoute(app4)));
    const after = await Promise.all([
      serviceClient
        .from("missions")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobSN),
      serviceClient
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobSN),
    ]);
    report(
      "R2 : trois relances simultanées après clôture → même mission et même contrat, aucun doublon",
      replays.every(
        (r) =>
          r.status === 200 &&
          r.selection.mission_id === missionBefore?.id &&
          r.selection.contract_id === contractBefore?.id,
      ) &&
        before[0].count === after[0].count &&
        before[1].count === after[1].count,
      { statuses: replays.map((r) => r.status) },
    );
    const jobShut = await seedPublished(
      "Offre close concurrence L11b",
      now + 20 * HOUR,
      now - 4 * HOUR,
    );
    const concurrent = await Promise.all(
      [C1, C2, C3].map((s) => applyRoute(s, jobShut)),
    );
    const { count: openApps } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobShut);
    report(
      "R3 : candidatures simultanées sur une offre close → toutes refusées (recruitment_closed), aucune ligne créée",
      concurrent.every((r) => r.body.code === "recruitment_closed") &&
        openApps === 0,
      { codes: concurrent.map((r) => r.body.code), openApps },
    );
  } finally {
    dropProofObjects();
    await cleanAccounts(ids);
    console.log(
      "Nettoyage : offres, candidatures, missions, contrats, profils, comptes et fonctions de preuve supprimés.",
    );
  }
  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "échéances de recrutement conformes (lot 11b)" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve lot 11b (échéances) échouée :", err);
  process.exit(1);
});
