/**
 * Preuve lot 17d-4a — recrutement de remplacement après désistement.
 * Décisions : ANN-14 (principe, destinataires, confirmations, journées au
 * choix, `[UV]` 2026-11-20), ANN-20 (candidat désisté exclu, `[UV]`
 * 2026-11-25) ; ECH-01, ECH-02, ECH-06, ECH-07, ECH-09, CTR-02, MNT-01,
 * REP-04, DON-04.
 *
 * Fixtures en clé service ; candidatures, désistements, confirmations et
 * sélections par les vraies RPC et routes sous des sessions réelles ; état
 * relu en clé service. Instants exacts : fonctions temporaires
 * `proof_17d4_*` (pile de preuve) qui placent le début ou la fermeture à
 * now() + décalage puis appellent la vraie RPC dans la même transaction.
 *
 *   T. Seuils : ouverture à 4 h exactement (et 1 µs de moins : aucun
 *      cycle) ; journées au choix appréciées par journée ; fermeture à H−2
 *      exactement pour la confirmation et la sélection (1 µs avant : accepté).
 *   D. Destinataires (ANN-14) et dédoublonnage des avis ; visibilité.
 *   C. Consentement renouvelé : ancienne candidature inchangée, nouvelle
 *      ligne liée au cycle, consentement exigé, relances, retrait définitif.
 *   W. Candidat à l'origine du désistement exclu (ANN-20), autres journées
 *      inchangées.
 *   E. Éligibilité périmée à la sélection : CNI, suspension, conflit 3 h,
 *      dossier entreprise ; revalidation sans prolongation ni nouvel avis.
 *   K. Capacité : places réellement libérées, désistements multiples,
 *      période complète entièrement libérée, nouveau contrat.
 *   R. Concurrence : deux sélections pour la dernière place, confirmations
 *      et désistements simultanés.
 *   P. Panne : aucun effet partiel du désistement ; même identifiant de
 *      demande envoyé trois fois en même temps : résultat d'origine.
 *   N. Aucune autre origine : annulation par l'entreprise.
 *   A. Annulation par l'entreprise d'une date couverte par un cycle :
 *      neutralisation dans la même transaction (panne : rien n'est
 *      enregistré), journée indépendante et historique conservés, refus par
 *      lecture, routes et appel direct, période complète, aucune ouverture
 *      sur une date déjà annulée.
 *   R2–R3. Course annulation / sélection, dans les deux ordres effectifs
 *      (transaction tenue ouverte par une fonction de preuve).
 *   S. Entreprise non autorisée, comportement observé : dossier non valide,
 *      revalidation, compte suspendu, suspension levée.
 *   I. Désistement : demandes différentes simultanées ; identifiant
 *      réutilisé (conflit, relance).
 *   O. Date annulée par l'entreprise, échéance initiale encore ouverte
 *      (ANN-08) : candidature et sélection ordinaires refusées sans effet
 *      (route et appel direct), état lu, autre journée accessible, période
 *      complète, retrait ciblé par le support distinct d'une date annulée,
 *      concurrence avec la sélection (deux ordres) et avec la candidature.
 *   Q. Réputation de l'entreprise (REP-04, condition 3) : aucune unité tant
 *      qu'un cycle permet une sélection, limite exacte, recalcul programmé
 *      à la fermeture du cycle, remplaçant non réalisé.
 *   X. Droits : tables fermées, colonnes du cycle protégées.
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
import { signAndSelectHttp, signAndSelectRpc } from "./lib/sign-and-select";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF = "replacement-cycles";
const PROOF_PASSWORD = "Proof-L17d4-replace-01!";
const PROOF_USER_METADATA = { proofReplacementCycles: true };

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
const anonClient: DB = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SET_ACTOR = `
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);`;

const FUNCTIONS: Record<string, string> = {
  // Journées (offre et missions) placées à now() + décalage, puis
  // désistement sous l'identité du candidat, dans la même transaction.
  "proof_17d4_cancel(uuid, uuid, uuid[], uuid[], interval[])": `
create or replace function public.proof_17d4_cancel(
  p_actor uuid, p_request uuid, p_days uuid[], p_job_days uuid[], p_offsets interval[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text; i integer; v_n integer;
  v_diag jsonb := jsonb_build_array(cardinality(p_offsets));
begin
  alter table public.job_days disable trigger trg_protect_job_day_writes;
  alter table public.mission_days disable trigger trg_protect_mission_day_writes;
  for i in 1 .. coalesce(cardinality(p_offsets), 0) loop
    update public.job_days d set starts_at = now() + p_offsets[i],
      ends_at = now() + p_offsets[i] + interval '6 hours' where d.id = p_job_days[i];
    get diagnostics v_n = row_count;
    v_diag := v_diag || to_jsonb(v_n);
    update public.mission_days d set starts_at = now() + p_offsets[i],
      ends_at = now() + p_offsets[i] + interval '6 hours' where d.id = p_days[i];
    get diagnostics v_n = row_count;
    v_diag := v_diag || to_jsonb(v_n);
  end loop;
  alter table public.mission_days enable trigger trg_protect_mission_day_writes;
  -- La garde des journées recalcule le début depuis la date et l'heure à
  -- chaque écriture (compteur des places pendant le désistement) : elle
  -- reste suspendue jusqu'à la fin de l'appel, sur la pile de preuve.
  ${SET_ACTOR}
  begin
    select to_jsonb(x) into v_res from public.request_candidate_cancellation(
      p_request, p_days, 'other', null, 'provided') x;
  exception when others then v_err := sqlerrm;
  end;
  alter table public.job_days enable trigger trg_protect_job_day_writes;
  return jsonb_build_object('error', v_err, 'result', v_res,
    'diag', v_diag,
    'starts', (select jsonb_agg(d.starts_at - now()) from public.job_days d where d.id = any (p_job_days)),
    'cycles', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.replacement_cycles c
               where c.job_day_id = any (p_job_days)));
end $$`,
  // Fermeture du cycle à now() + décalage, puis confirmation (candidat) ou
  // « Signer et sélectionner » (entreprise) dans la même transaction.
  "proof_17d4_at(uuid, uuid, interval, text, uuid)": `
create or replace function public.proof_17d4_at(
  p_actor uuid, p_cycle uuid, p_delta interval, p_action text, p_application uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text; v_hash text;
begin
  alter table public.replacement_cycles disable trigger trg_protect_replacement_cycles;
  update public.replacement_cycles c set closes_at = now() + p_delta,
    starts_at = now() + p_delta + interval '2 hours',
    opened_at = now() + p_delta - interval '3 hours' where c.id = p_cycle;
  alter table public.replacement_cycles enable trigger trg_protect_replacement_cycles;
  ${SET_ACTOR}
  begin
    if p_action = 'shift' then
      v_res := null;
    elsif p_action = 'confirm' then
      select to_jsonb(x) into v_res from public.confirm_replacement_interest(p_cycle, true) x;
    else
      select p.terms_hash into v_hash from public.contract_selection_preview(p_application) p;
      select to_jsonb(x) into v_res from public.sign_and_select(p_application, coalesce(v_hash, '')) x;
    end if;
  exception when others then v_err := sqlerrm;
  end;
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  // Échéance initiale de recrutement passée (offre et journées).
  "proof_17d4_close_initial(uuid)": `
create or replace function public.proof_17d4_close_initial(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.jobs disable trigger trg_job_publication_guard;
  alter table public.job_days disable trigger trg_protect_job_day_writes;
  update public.jobs j set applications_close_at = now() - interval '1 minute' where j.id = p_job;
  update public.job_days d set applications_close_at = now() - interval '1 minute'
  where d.job_id = p_job and d.applications_close_at is not null;
  alter table public.job_days enable trigger trg_protect_job_day_writes;
  alter table public.jobs enable trigger trg_job_publication_guard;
end $$`,
  // Lecture des fermetures et des compteurs des cycles d'une offre.
  "proof_17d4_cycles(uuid)": `
create or replace function public.proof_17d4_cycles(p_job uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'job_day_id', c.job_day_id, 'starts_at', c.starts_at, 'closes_at', c.closes_at,
    'released', c.places_released, 'filled', c.places_filled,
    'cancelled', c.places_cancelled, 'cancelled_at', c.cancelled_at,
    'cancellation', c.company_cancellation_id,
    'remaining', public.replacement_cycle_remaining(c),
    'state', public.replacement_cycle_state(c, now()),
    'sources', (select count(*) from public.replacement_cycle_sources s where s.cycle_id = c.id),
    'events', (select jsonb_agg(e.kind order by e.created_at) from public.replacement_cycle_events e where e.cycle_id = c.id),
    'notices', (select jsonb_agg(jsonb_build_object('user', n.user_id, 'kind', n.kind)) from public.replacement_cycle_notices n where n.cycle_id = c.id)
  ) order by c.starts_at), '[]') from public.replacement_cycles c where c.job_id = p_job;
$$`,
  // Échéance de la CNI d'un profil vérifié (protections du profil levées le
  // temps de la seule écriture).
  "proof_17d4_cni(uuid, date)": `
create or replace function public.proof_17d4_cni(p_profile uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.candidate_profiles disable trigger trg_protect_verified_candidate_data;
  alter table public.candidate_profiles disable trigger trg_protect_cni_verification;
  alter table public.candidate_profiles disable trigger trg_protect_candidate_profile_columns;
  update public.candidate_profiles cp set cni_expires_at = p_date where cp.id = p_profile;
  alter table public.candidate_profiles enable trigger trg_protect_candidate_profile_columns;
  alter table public.candidate_profiles enable trigger trg_protect_cni_verification;
  alter table public.candidate_profiles enable trigger trg_protect_verified_candidate_data;
end $$`,
  // Annulation par l'entreprise, ou « Signer et sélectionner », sous
  // l'identité de l'acteur, puis attente dans la même transaction : la
  // transaction concurrente lancée pendant l'attente s'exécute après elle.
  "proof_17d4_company_cancel_hold(uuid, uuid, uuid, uuid[], double precision)": `
create or replace function public.proof_17d4_company_cancel_hold(
  p_actor uuid, p_request uuid, p_job uuid, p_days uuid[], p_sleep double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text;
begin
  ${SET_ACTOR}
  begin
    select to_jsonb(x) into v_res from public.request_company_cancellation(
      p_request, p_job, p_days, 'Événement annulé par le client final.', true) x;
  exception when others then v_err := sqlerrm;
  end;
  perform pg_sleep(p_sleep);
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  "proof_17d4_select_hold(uuid, uuid, double precision)": `
create or replace function public.proof_17d4_select_hold(
  p_actor uuid, p_application uuid, p_sleep double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_err text; v_hash text;
begin
  ${SET_ACTOR}
  begin
    select p.terms_hash into v_hash from public.contract_selection_preview(p_application) p;
    select to_jsonb(x) into v_res from public.sign_and_select(p_application, coalesce(v_hash, '')) x;
  exception when others then v_err := sqlerrm;
  end;
  perform pg_sleep(p_sleep);
  return jsonb_build_object('error', v_err, 'result', v_res);
end $$`,
  // Réputation (REP-04) : unités « offre » calculées à un instant donné.
  "proof_17d4_offers(uuid, timestamptz)": `
create or replace function public.proof_17d4_offers(p_company uuid, p_at timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(o)), '[]')
  from public.reputation_company_offers(p_company, p_at) o;
$$`,
  "proof_17d4_score(uuid)": `
create or replace function public.proof_17d4_score(p_company uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(x) from (
    select s.next_expiry_at, s.confirmed_count, s.experience_units
    from public.reputation_scores s
    where s.subject_type = 'company' and s.subject_id = p_company) x;
$$`,
  "proof_17d4_ts(timestamptz, integer)": `
create or replace function public.proof_17d4_ts(p_at timestamptz, p_us integer)
returns timestamptz language sql immutable set search_path = '' as $$
  select p_at + make_interval(secs => p_us / 1000000.0);
$$`,
  // Échéance programmée atteinte : fermeture du cycle et échéance du score
  // replacées 1 s avant maintenant, puis le balayage planifié.
  "proof_17d4_sweep_due(uuid, uuid)": `
create or replace function public.proof_17d4_sweep_due(p_company uuid, p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_close timestamptz := now() - interval '1 second';
begin
  alter table public.replacement_cycles disable trigger trg_protect_replacement_cycles;
  update public.replacement_cycles c set closes_at = v_close,
    starts_at = v_close + interval '2 hours', opened_at = v_close - interval '3 hours'
  where c.id = p_cycle;
  alter table public.replacement_cycles enable trigger trg_protect_replacement_cycles;
  update public.reputation_scores s set next_expiry_at = v_close
  where s.subject_type = 'company' and s.subject_id = p_company;
  perform public.reputation_expiry_sweep();
  return (select to_jsonb(x) from (
    select s.next_expiry_at, s.confirmed_count, s.experience_units
    from public.reputation_scores s
    where s.subject_type = 'company' and s.subject_id = p_company) x);
end $$`,
  "proof_17d4_listing(uuid)": `
create or replace function public.proof_17d4_listing(p_job uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('recruitment_open', public.recruitment_open(j),
    'replacement_open', public.replacement_open(j), 'listing_open', public.listing_open(j))
  from public.jobs j where j.id = p_job;
$$`,
};
const DROP_ALL = [
  ...Object.keys(FUNCTIONS).map((f) => `drop function if exists public.${f}`),
  "drop trigger if exists proof_17d4_fail_notice on public.replacement_cycle_notices",
  "drop function if exists public.proof_17d4_fail_notice()",
  "drop trigger if exists proof_17d4_fail_event on public.replacement_cycle_events",
  "drop function if exists public.proof_17d4_fail_event()",
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
        ? `+2376994${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M4D${String(Date.now()).slice(-9)}${name.length}`,
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
      last_name: "Ebanda",
      date_of_birth: "1997-03-02",
      city: "Douala",
      address: "Makepe, rue privée",
      latitude: 4.07,
      longitude: 9.75,
      bio: "Candidat de preuve du lot 17d-4a.",
      cni_number: `CNI4D${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677172173",
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
      .filter((u) => u.user_metadata?.proofReplacementCycles === true)
      .map((u) => u.id),
  );
}

type HttpResult = { status: number; body: Record<string, unknown> };
async function http(
  method: "GET" | "POST" | "DELETE",
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
  return { status: res.status, body };
}

type CycleView = {
  id: string;
  job_day_id: string | null;
  starts_at: string;
  closes_at: string;
  released: number;
  filled: number;
  cancelled: number;
  cancelled_at: string | null;
  cancellation: string | null;
  remaining: number;
  state: string;
  sources: number;
  events: string[] | null;
  notices: { user: string; kind: string }[] | null;
};
type Res = { error: string | null; result: Record<string, unknown> | null };

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17d4-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();
    const keys = [
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
    ] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const uidList = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, ...uidList);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, uidList[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Événements Akwa");
    const coB = await createCompany(idB, "Hôtel Bali");
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
        ["a", "b", ...keys].map(async (k) => [k, await realSession(mail(k))]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;

    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      return new Date(Date.UTC(2099, 2, 1) + dayNo * 86_400_000)
        .toISOString()
        .slice(0, 10);
    };
    const perDayJob = async (
      n: number,
      positions: number,
      title: string,
      company = coA,
    ) => {
      const days: FixtureDay[] = Array.from({ length: n }, () => ({
        date: nextDate(),
        start_time: "08:00",
        end_time: "14:00",
        pay: 15000,
        positions,
      }));
      return insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-4a.",
          address: "Rue Joss",
          city: "Douala",
          title,
          company_id: company,
          mission_pay_per_candidate: 15000,
          positions_available: n * positions,
        },
        days,
        "per_day",
      );
    };
    const applyDays = async (k: K, jobId: string, dayIds: string[]) => {
      const { data, error } = await sess[k].client.rpc("apply_to_job_days", {
        p_job_id: jobId,
        p_day_ids: dayIds,
      });
      if (error || !data) throw new Error(`apply ${k}: ${error?.message}`);
      return data.map((a) => a.id);
    };
    const select = async (appId: string, s: Session = A) => {
      const r = await signAndSelectRpc(s.client, appId);
      if (r.error) throw new Error(`select: ${r.error.message}`);
      return (r.data as { mission_id: string }[])[0].mission_id;
    };
    const missionDays = async (missionId: string) =>
      (
        await serviceClient
          .from("mission_days")
          .select("id, job_day_id")
          .eq("mission_id", missionId)
          .order("scheduled_date")
      ).data!;
    const cancel = (k: K, dayIds: string[], requestId = randomUUID()) =>
      sess[k].client.rpc("request_candidate_cancellation", {
        p_request_id: requestId,
        p_day_ids: dayIds,
        p_reason_code: "other",
        p_reason_text: "",
        p_evidence_choice: "provided",
      });
    const cycles = (jobId: string) =>
      proofRpc<CycleView[]>("proof_17d4_cycles", { p_job: jobId });
    const confirm = (k: K, cycleId: string, consent: unknown = true) =>
      http(
        "POST",
        `/api/replacement-cycles/${cycleId}/interest`,
        sess[k].cookie,
        {
          consent,
        },
      );
    const cycleApp = async (cycleId: string, k: K) =>
      (
        await serviceClient
          .from("job_applications")
          .select("*")
          .eq("replacement_cycle_id", cycleId)
          .eq("candidate_id", prof[k])
          .maybeSingle()
      ).data;
    const appRow = async (id: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("*")
          .eq("id", id)
          .single()
      ).data!;
    const notifs = async (userId: string, jobId?: string) =>
      (
        (
          await serviceClient
            .from("notifications")
            .select("title, body, data")
            .eq("user_id", userId)
        ).data ?? []
      ).filter((n) => {
        const d = n.data as { kind?: string; job_id?: string } | null;
        return (
          d?.kind === "replacement_cycle" && (!jobId || d.job_id === jobId)
        );
      });
    const jobFrozen = async (jobId: string) => {
      const { data } = await serviceClient
        .from("jobs")
        .select(
          "first_published_at, publication_regime, applications_close_at, start_date, start_time, end_time, days:job_days(day_date, start_time, end_time, applications_close_at, starts_at)",
        )
        .eq("id", jobId)
        .single();
      return JSON.stringify({
        ...data,
        days: [...(data?.days ?? [])].sort((a, b) =>
          a.day_date.localeCompare(b.day_date),
        ),
      });
    };

    // ── T. Seuils exacts ─────────────────────────────────────────
    {
      // T1 : 4 h exactement → cycle ; T2 : 4 h − 1 µs → aucun cycle.
      const job = await perDayJob(2, 1, "Seuil 4 h");
      const [app1, app2] = await applyDays("c1", job.jobId, job.dayIds);
      const m1 = await select(app1);
      const m2 = await select(app2);
      const d1 = (await missionDays(m1))[0];
      const d2 = (await missionDays(m2))[0];
      const r = await proofRpc<Res & { cycles: CycleView[] }>(
        "proof_17d4_cancel",
        {
          p_actor: uid.c1,
          p_request: randomUUID(),
          p_days: [d1.id, d2.id],
          p_job_days: [job.dayIds[0], job.dayIds[1]],
          p_offsets: ["4 hours", "3 hours 59 minutes 59.999999 seconds"],
        },
      );
      const opened = (r.cycles ?? []).map((c) => c.job_day_id);
      report(
        "T1 ouverture à 4 h exactement (limite incluse), fermeture à H−2",
        !r.error &&
          opened.length === 1 &&
          opened[0] === job.dayIds[0] &&
          Date.parse(r.cycles[0].starts_at) -
            Date.parse(r.cycles[0].closes_at) ===
            2 * 3_600_000,
        r,
      );
      report(
        "T2 journées au choix : seuil par journée (4 h − 1 µs : aucun cycle)",
        !opened.includes(job.dayIds[1]),
        opened,
      );
      const both = [await appRow(app1), await appRow(app2)];
      report(
        "T2b les deux journées sont libérées (désistement enregistré)",
        both.every((a) => a.status === "withdrawn"),
        both.map((a) => a.status),
      );
    }

    // ── D. Destinataires, dédoublonnage, visibilité ───────────────
    // Offre au choix, journée X à 2 places : c1 et c7 sélectionnés ; c2 en
    // attente, c3 refusé, c4 retiré, c5 CNI expirée, c6 engagé ailleurs.
    const jobD = await perDayJob(2, 2, "Hôtesses salon");
    const X = jobD.dayIds[0];
    const Y = jobD.dayIds[1];
    const [aC1] = await applyDays("c1", jobD.jobId, [X]);
    const [aC7] = await applyDays("c7", jobD.jobId, [X]);
    const [aC2] = await applyDays("c2", jobD.jobId, [X]);
    const [aC3] = await applyDays("c3", jobD.jobId, [X]);
    const [aC4] = await applyDays("c4", jobD.jobId, [X]);
    await applyDays("c5", jobD.jobId, [X]);
    await applyDays("c6", jobD.jobId, [X]);
    const mC1 = await select(aC1);
    await select(aC7);
    await A.client
      .from("job_applications")
      .update({ status: "rejected" })
      .eq("id", aC3);
    await http(
      "DELETE",
      `/api/jobs/${jobD.jobId}/apply?application=${aC4}`,
      sess.c4.cookie,
    );
    await proofRpc("proof_17d4_cni", {
      p_profile: prof.c5,
      p_date: "2020-01-01",
    });
    // c6 : engagement sélectionné au même créneau chez l'entreprise B.
    const xDate = (
      await serviceClient
        .from("job_days")
        .select("day_date")
        .eq("id", X)
        .single()
    ).data!.day_date;
    const jobOther = await insertJobWithDays(
      serviceClient,
      {
        description: "Preuve 17d-4a (B).",
        address: "Rue Bali",
        city: "Douala",
        title: "Accueil hôtel",
        company_id: coB,
        mission_pay_per_candidate: 12000,
        positions_available: 1,
      },
      [
        {
          date: xDate,
          start_time: "09:00",
          end_time: "12:00",
          pay: 12000,
          positions: 1,
        },
      ],
      "per_day",
    );
    const [aC6b] = await applyDays("c6", jobOther.jobId, jobOther.dayIds);
    await select(aC6b, sess.b);
    await proofRpc("proof_17d4_close_initial", { p_job: jobD.jobId });
    const before = await jobFrozen(jobD.jobId);
    const listBefore = await proofRpc<Record<string, boolean>>(
      "proof_17d4_listing",
      {
        p_job: jobD.jobId,
      },
    );

    const cancelD = await cancel(
      "c1",
      (await missionDays(mC1)).map((d) => d.id),
    );
    const [cD] = await cycles(jobD.jobId);
    const noticeUsers = new Set(
      (cD?.notices ?? []).map((n) => `${n.user}:${n.kind}`),
    );
    report(
      "D1 désistement enregistré → un cycle, une source, journal « opened » puis « alerts_sent »",
      !cancelD.error &&
        !!cD &&
        cD.job_day_id === X &&
        cD.sources === 1 &&
        cD.released === 1 &&
        JSON.stringify(cD.events) === JSON.stringify(["opened", "alerts_sent"]),
      { error: cancelD.error?.message, cD },
    );
    report(
      "D2 destinataires ANN-14 : en attente et refusé alertés ; retiré, désisté, déjà sélectionné, CNI expirée, engagé ailleurs : non",
      noticeUsers.has(`${uid.c2}:candidate_alert`) &&
        noticeUsers.has(`${uid.c3}:candidate_alert`) &&
        ![uid.c4, uid.c1, uid.c7, uid.c5, uid.c6].some((u) =>
          noticeUsers.has(`${u}:candidate_alert`),
        ) &&
        noticeUsers.has(`${idA}:company_opened`) &&
        (cD?.notices ?? []).length === 3,
      cD?.notices,
    );
    const n2 = await notifs(uid.c2);
    report(
      "D3 avis dans l'application créés dès l'ouverture (sans tâche planifiée), sans e-mail annoncé",
      n2.length === 1 &&
        (await notifs(idA, jobD.jobId)).length === 1 &&
        (await notifs(uid.c4)).length === 0 &&
        !/e-?mail/i.test(n2[0].body),
      n2,
    );
    const listAfter = await proofRpc<Record<string, boolean>>(
      "proof_17d4_listing",
      {
        p_job: jobD.jobId,
      },
    );
    const anonList = await http(
      "GET",
      `/api/jobs?search=${encodeURIComponent("Hôtesses salon")}`,
      null,
    );
    const listed = JSON.stringify(anonList.body).includes(jobD.jobId);
    report(
      "D4 visibilité : échéance initiale passée, l'offre réapparaît par le seul cycle (liste publique)",
      listBefore.listing_open === false &&
        listAfter.recruitment_open === false &&
        listAfter.replacement_open === true &&
        listed,
      { listBefore, listAfter, status: anonList.status, listed },
    );
    report(
      "D5 horaires, première publication, régime et échéance initiale inchangés",
      (await jobFrozen(jobD.jobId)) === before,
    );
    const anonCycles = await anonClient.rpc("job_replacement_cycles", {
      p_job_id: jobD.jobId,
    });
    report(
      "D6 visiteur : cycle lisible (journée, places, fermeture), sans donnée de candidat",
      !anonCycles.error &&
        anonCycles.data?.length === 1 &&
        anonCycles.data[0].places_open === 1 &&
        anonCycles.data[0].my_application_id === null &&
        anonCycles.data[0].my_blocker === null,
      anonCycles,
    );

    // ── C. Consentement renouvelé ────────────────────────────────
    {
      const oldC2 = JSON.stringify(await appRow(aC2));
      const selOld = await signAndSelectRpc(A.client, aC2);
      report(
        "C1 ancienne candidature en attente : aucune sélection hors cycle après l'échéance initiale",
        selOld.error?.message === "recruitment_closed",
        selOld.error?.message,
      );
      const noConsent = await confirm("c2", cD.id, false);
      const rpcNoConsent = await sess.c2.client.rpc(
        "confirm_replacement_interest",
        {
          p_cycle_id: cD.id,
          p_consent: false,
        },
      );
      report(
        "C2 consentement explicite exigé (route et base)",
        noConsent.status === 400 &&
          noConsent.body.code === "consent_required" &&
          rpcNoConsent.error?.message === "consent_required" &&
          !(await cycleApp(cD.id, "c2")),
        { noConsent, rpc: rpcNoConsent.error?.message },
      );
      const multi = await Promise.all(
        Array.from({ length: 5 }, () => confirm("c2", cD.id)),
      );
      const rowC2 = await cycleApp(cD.id, "c2");
      const { count: c2Rows } = await serviceClient
        .from("job_applications")
        .select("id", { count: "exact", head: true })
        .eq("replacement_cycle_id", cD.id)
        .eq("candidate_id", prof.c2);
      report(
        "C3 cinq confirmations simultanées → une seule ligne liée au cycle",
        multi.every((r) => r.status === 200) &&
          c2Rows === 1 &&
          multi.filter((r) => r.body.already_confirmed === false).length === 1,
        { statuses: multi.map((r) => r.status), c2Rows },
      );
      report(
        "C4 nouvelle candidature liée au cycle ; ancienne conservée à l'identique, jamais réactivée",
        rowC2?.status === "pending" &&
          rowC2.interest_origin === "pending" &&
          rowC2.previous_application_id === aC2 &&
          !!rowC2.interest_confirmed_at &&
          JSON.stringify(await appRow(aC2)) === oldC2,
        rowC2,
      );
      const c3 = await confirm("c3", cD.id);
      const c4 = await confirm("c4", cD.id);
      const c8 = await confirm("c8", cD.id);
      const rows = {
        c3: await cycleApp(cD.id, "c3"),
        c4: await cycleApp(cD.id, "c4"),
        c8: await cycleApp(cD.id, "c8"),
      };
      report(
        "C5 refusé, retiré (retour volontaire sans alerte) et nouveau candidat : confirmation propre au cycle",
        c3.status === 200 &&
          c4.status === 200 &&
          c8.status === 200 &&
          rows.c3?.interest_origin === "rejected" &&
          rows.c4?.interest_origin === "withdrawn" &&
          rows.c8?.interest_origin === "new" &&
          (await appRow(aC3)).status === "rejected" &&
          (await appRow(aC4)).status === "withdrawn",
        { c3: c3.body, c4: c4.body, c8: c8.body },
      );
      const w = await http(
        "DELETE",
        `/api/jobs/${jobD.jobId}/apply?application=${rows.c4!.id}`,
        sess.c4.cookie,
      );
      const again = await confirm("c4", cD.id);
      report(
        "C6 retrait de l'intérêt définitif pour ce cycle (aucune réactivation)",
        w.status === 200 &&
          again.status === 409 &&
          again.body.code === "interest_withdrawn",
        { w: w.status, again: again.body },
      );
      const blocked = await Promise.all([
        confirm("c5", cD.id),
        confirm("c6", cD.id),
      ]);
      report(
        "C7 confirmation refusée : CNI expirée, conflit d'horaires (marge de 3 h)",
        blocked[0].body.code === "cni_expired" &&
          blocked[1].body.code === "schedule_conflict",
        blocked.map((b) => b.body.code),
      );
      await proofRpc("proof_17d4_cni", {
        p_profile: prof.c5,
        p_date: "2033-01-01",
      });
    }

    // ── W. Candidat à l'origine du désistement (ANN-20) ──────────
    {
      const own = await confirm("c1", cD.id);
      const view = await sess.c1.client.rpc("job_replacement_cycles", {
        p_job_id: jobD.jobId,
      });
      const otherDay = await sess.c1.client.rpc("apply_to_job_days", {
        p_job_id: jobD.jobId,
        p_day_ids: [Y],
      });
      report(
        "W1 désisté : ni alerte ni confirmation pour la journée abandonnée",
        own.status === 403 &&
          own.body.code === "replacement_own_withdrawal" &&
          view.data?.[0]?.my_blocker === "replacement_own_withdrawal",
        { own: own.body, view: view.data },
      );
      report(
        "W2 ses autres possibilités restent inchangées (règles ordinaires, échéance initiale)",
        otherDay.error?.message === "job_days_unavailable",
        otherDay.error?.message,
      );
    }

    // ── E. Éligibilité périmée et autorisation de l'entreprise ───
    {
      const rowC2 = (await cycleApp(cD.id, "c2"))!;
      const rowC8 = (await cycleApp(cD.id, "c8"))!;
      await proofRpc("proof_17d4_cni", {
        p_profile: prof.c2,
        p_date: "2020-01-01",
      });
      const e1 = await signAndSelectRpc(A.client, rowC2.id);
      await proofRpc("proof_17d4_cni", {
        p_profile: prof.c2,
        p_date: "2033-01-01",
      });
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", uid.c2);
      const e2 = await signAndSelectRpc(A.client, rowC2.id);
      await serviceClient
        .from("users")
        .update({ is_active: true })
        .eq("id", uid.c2);
      report(
        "E1 CNI expirée puis compte suspendu après confirmation : sélection refusée, refus générique (DON-04)",
        e1.error?.message === "candidate_unavailable" &&
          e2.error?.message === "candidate_unavailable",
        [e1.error?.message, e2.error?.message],
      );
      const pre = await cycles(jobD.jobId);
      await serviceClient
        .from("company_profiles")
        .update({ verification_status: "pending" })
        .eq("id", coA);
      const e3 = await signAndSelectRpc(A.client, rowC8.id);
      const viewInvalid = await sess.c8.client.rpc("job_replacement_cycles", {
        p_job_id: jobD.jobId,
      });
      const confirmInvalid = await confirm("c9", cD.id);
      await approveCompanyDossier(serviceClient, coA);
      const post = await cycles(jobD.jobId);
      report(
        "E2 dossier entreprise non valide : sélection et confirmation refusées (règles existantes)",
        e3.error?.message === "company_not_verified" &&
          confirmInvalid.body.code === "job_not_available",
        {
          e3: e3.error?.message,
          confirm: confirmInvalid.body,
          view: viewInvalid.data?.[0]?.state,
        },
      );
      report(
        "E3 revalidation : ni prolongation de la fenêtre ni nouvel avis",
        post[0].closes_at === pre[0].closes_at &&
          (post[0].notices ?? []).length === (pre[0].notices ?? []).length &&
          post[0].state === "open",
        { pre: pre[0], post: post[0] },
      );
    }

    // ── T. Fermeture à H−2 exacte (confirmation et sélection) ────
    {
      const rowC3 = (await cycleApp(cD.id, "c3"))!;
      const atConfirm = await proofRpc<Res>("proof_17d4_at", {
        p_actor: uid.c9,
        p_cycle: cD.id,
        p_delta: "0 seconds",
        p_action: "confirm",
        p_application: null,
      });
      const atSelect = await proofRpc<Res>("proof_17d4_at", {
        p_actor: idA,
        p_cycle: cD.id,
        p_delta: "0 seconds",
        p_action: "select",
        p_application: rowC3.id,
      });
      report(
        "T3 à H−2 exactement : confirmation et sélection refusées (replacement_closed)",
        atConfirm.error === "replacement_closed" &&
          atSelect.error === "replacement_closed",
        { atConfirm, atSelect },
      );
      const before3 = await proofRpc<Res>("proof_17d4_at", {
        p_actor: idA,
        p_cycle: cD.id,
        p_delta: "0.000001 seconds",
        p_action: "select",
        p_application: rowC3.id,
      });
      report(
        "T4 1 µs avant H−2 : sélection acceptée dans le cycle",
        !before3.error,
        before3,
      );
      // Fenêtre replacée loin dans le futur pour la suite (voie de preuve).
      await proofRpc<Res>("proof_17d4_at", {
        p_actor: idA,
        p_cycle: cD.id,
        p_delta: "30 days",
        p_action: "shift",
        p_application: null,
      });
    }

    // ── K. Capacité, contrat ─────────────────────────────────────
    {
      const rowC3 = (await cycleApp(cD.id, "c3"))!;
      const rowC8 = (await cycleApp(cD.id, "c8"))!;
      const after = await cycles(jobD.jobId);
      const second = await signAndSelectRpc(A.client, rowC8.id);
      const contract = (
        await serviceClient
          .from("contracts")
          .select("contract_data, company_signed_at")
          .eq("application_id", rowC3.id)
          .single()
      ).data;
      const oldContract = (
        await serviceClient
          .from("contracts")
          .select("id")
          .eq("application_id", aC1)
          .maybeSingle()
      ).data;
      report(
        "K1 une seule place libérée : la seconde sélection est refusée (no_positions), cycle pourvu",
        after[0].filled === 1 &&
          after[0].state === "filled" &&
          second.error?.message === "no_positions",
        { after: after[0], second: second.error?.message },
      );
      report(
        "K2 nouveau contrat signé par l'entreprise, au montant de la journée ; contrat du désisté conservé",
        !!contract?.company_signed_at &&
          (contract.contract_data as { mission_pay_per_candidate?: number })
            .mission_pay_per_candidate === 15000 &&
          !!oldContract,
        contract,
      );
      // K3 : places jamais pourvues non rouvertes (3 places, 2 pourvues).
      const jobK = await perDayJob(1, 3, "Inventaire stock");
      const [k1] = await applyDays("c4", jobK.jobId, jobK.dayIds);
      const [k2] = await applyDays("c5", jobK.jobId, jobK.dayIds);
      const mk1 = await select(k1);
      const mk2 = await select(k2);
      await applyDays("c6", jobK.jobId, jobK.dayIds);
      const [k9] = await applyDays("c9", jobK.jobId, jobK.dayIds);
      await proofRpc("proof_17d4_close_initial", { p_job: jobK.jobId });
      await cancel(
        "c4",
        (await missionDays(mk1)).map((d) => d.id),
      );
      const [cK] = await cycles(jobK.jobId);
      const conf9 = await confirm("c9", cK.id);
      const conf2 = await confirm("c2", cK.id);
      const r9 = (await cycleApp(cK.id, "c9"))!;
      const r2 = (await cycleApp(cK.id, "c2"))!;
      // R1 : deux sélections simultanées pour la dernière place.
      const race = await Promise.all([
        signAndSelectRpc(A.client, r9.id),
        signAndSelectRpc(A.client, r2.id),
      ]);
      const ok = race.filter((r) => !r.error).length;
      const job = (
        await serviceClient
          .from("job_days")
          .select("positions_filled, positions_available")
          .eq("id", jobK.dayIds[0])
          .single()
      ).data!;
      report(
        "K3 places réellement libérées seulement : 3 places, 2 pourvues, 1 désistement → 1 place dans le cycle",
        cK.released === 1 && conf9.status === 200 && conf2.status === 200,
        { cK, k9 },
      );
      report(
        "R1 deux sélections simultanées pour la dernière place → une seule, l'autre no_positions",
        ok === 1 &&
          race.some((r) => r.error?.message === "no_positions") &&
          job.positions_filled === 2,
        { race: race.map((r) => r.error?.message ?? "ok"), job },
      );
      // K4 : désistements multiples → même cycle, places additionnées,
      // fermeture inchangée, aucun avis en double.
      const before4 = (await cycles(jobK.jobId))[0];
      await cancel(
        "c5",
        (await missionDays(mk2)).map((d) => d.id),
      );
      const after4 = (await cycles(jobK.jobId))[0];
      const all = await cycles(jobK.jobId);
      const noticeCount = (after4.notices ?? []).filter(
        (n) => n.user === uid.c6,
      ).length;
      report(
        "K4 second désistement : même cycle, une place de plus, fermeture inchangée, aucun avis répété",
        all.length === 1 &&
          after4.released === before4.released + 1 &&
          after4.closes_at === before4.closes_at &&
          after4.sources === 2 &&
          (after4.events ?? []).filter((e) => e === "opened").length === 1 &&
          (after4.events ?? []).includes("place_added") &&
          noticeCount <= 1 &&
          (await notifs(idA, jobK.jobId)).length === 1,
        { before4, after4 },
      );
    }

    // ── K5. Période complète entièrement libérée avant son début ─
    {
      const days: FixtureDay[] = [
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
      ];
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-4a (période).",
          address: "Rue Joss",
          city: "Douala",
          title: "Salon période",
          company_id: coA,
          mission_pay_per_candidate: 40000,
          positions_available: 1,
        },
        days,
        "full_period",
      );
      const { data: p1 } = await sess.c6.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      const { data: p2 } = await sess.c7.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      const mp = await select(p1!.id);
      await proofRpc("proof_17d4_close_initial", { p_job: jobId });
      await cancel(
        "c6",
        (await missionDays(mp)).map((d) => d.id),
      );
      const [cP] = await cycles(jobId);
      const cf = await confirm("c7", cP.id);
      const rowP = (await cycleApp(cP.id, "c7"))!;
      const mRep = await select(rowP.id);
      const repDays = await missionDays(mRep);
      const contract = (
        await serviceClient
          .from("contracts")
          .select("contract_data")
          .eq("application_id", rowP.id)
          .single()
      ).data!.contract_data as {
        mission_pay_per_candidate: number;
        day_count: number;
      };
      report(
        "K5 période complète libérée avant son début : cycle sur l'offre, contrat de toute la période au montant de l'offre",
        cP.job_day_id === null &&
          cf.status === 200 &&
          repDays.length === 2 &&
          contract.mission_pay_per_candidate === 40000 &&
          contract.day_count === 2 &&
          (await appRow(p2!.id)).status === "pending",
        { cP, contract },
      );
    }

    // ── P. Panne transactionnelle ────────────────────────────────
    {
      const job = await perDayJob(1, 1, "Panne avis");
      const [p1] = await applyDays("c8", job.jobId, job.dayIds);
      await applyDays("c9", job.jobId, job.dayIds);
      const mp = await select(p1);
      execSql(`create or replace function public.proof_17d4_fail_notice() returns trigger
        language plpgsql as $$ begin
          if new.user_id = '${uid.c9}' then raise exception 'proof_17d4_fail_notice'; end if;
          return new; end $$`);
      execSql(`create trigger proof_17d4_fail_notice before insert on public.replacement_cycle_notices
        for each row execute function public.proof_17d4_fail_notice()`);
      const req = randomUUID();
      const dayIds = (await missionDays(mp)).map((d) => d.id);
      const failed = await cancel("c8", dayIds, req);
      const state = {
        app: (await appRow(p1)).status,
        cycles: (await cycles(job.jobId)).length,
        cancellations: (
          await serviceClient
            .from("candidate_cancellations")
            .select("id")
            .eq("request_id", req)
        ).data?.length,
        notifs:
          (await notifs(uid.c9, job.jobId)).length +
          (await notifs(idA, job.jobId)).length,
      };
      execSql(
        "drop trigger if exists proof_17d4_fail_notice on public.replacement_cycle_notices",
      );
      execSql("drop function if exists public.proof_17d4_fail_notice()");
      report(
        "P1 panne pendant les avis : désistement, cycle et avis absents (aucun effet partiel)",
        !!failed.error &&
          state.app === "selected" &&
          state.cycles === 0 &&
          state.cancellations === 0 &&
          state.notifs === 0,
        { error: failed.error?.message, state },
      );
      const retry = await Promise.all(
        Array.from({ length: 3 }, () => cancel("c8", dayIds, req)),
      );
      // Même identifiant de demande : chaque envoi concurrent retrouve le
      // résultat d'origine (auparavant, lots 17b–17c : mission_not_active).
      const later = await cancel("c8", dayIds, req);
      const [cR] = await cycles(job.jobId);
      const { count: recorded } = await serviceClient
        .from("candidate_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("request_id", req);
      const rows = retry.map(
        (r) =>
          (
            r.data as
              | { cancellation_id: string; already_recorded: boolean }[]
              | null
          )?.[0],
      );
      report(
        "P2 relance (trois envois simultanés puis un envoi tardif de la même demande) : résultat d'origine pour chacun, un désistement, un cycle, une source, un avis par destinataire",
        retry.every((r) => !r.error) &&
          rows.filter((x) => x?.already_recorded === false).length === 1 &&
          new Set(rows.map((x) => x?.cancellation_id)).size === 1 &&
          cR?.released === 1 &&
          !later.error &&
          (later.data as { already_recorded: boolean }[] | null)?.[0]
            ?.already_recorded === true &&
          recorded === 1 &&
          !!cR &&
          cR.sources === 1 &&
          (cR.notices ?? []).filter((n) => n.user === uid.c9).length === 1 &&
          (await notifs(uid.c9, job.jobId)).length === 1,
        { retry: retry.map((r) => r.error?.message ?? "ok"), cR },
      );
    }

    // ── N. Aucune autre origine (annulation par l'entreprise) ────
    {
      const job = await perDayJob(1, 1, "Annulation entreprise");
      const [n1] = await applyDays("c2", job.jobId, job.dayIds);
      const mn = await select(n1);
      const dayIds = (await missionDays(mn)).map((d) => d.id);
      const { error } = await A.client.rpc("request_company_cancellation", {
        p_request_id: randomUUID(),
        p_job_id: job.jobId,
        p_day_ids: dayIds,
        p_reason: "Événement annulé par le client final.",
        p_acknowledge_late: true,
      });
      report(
        "N1 annulation par l'entreprise : aucun cycle de remplacement",
        !error && (await cycles(job.jobId)).length === 0,
        error?.message,
      );
    }

    // ── A. Annulation par l'entreprise d'une date couverte par un cycle ─
    const companyCancel = (
      jobId: string,
      dayIds: string[],
      requestId = randomUUID(),
    ) =>
      A.client.rpc("request_company_cancellation", {
        p_request_id: requestId,
        p_job_id: jobId,
        p_day_ids: dayIds,
        p_reason: "Événement annulé par le client final.",
        p_acknowledge_late: true,
      });
    const appOf = async (k: K, jobId: string, jobDayId: string | null) => {
      let q = serviceClient
        .from("job_applications")
        .select("*")
        .eq("job_id", jobId)
        .eq("candidate_id", prof[k])
        .is("replacement_cycle_id", null);
      q = jobDayId ? q.eq("job_day_id", jobDayId) : q.is("job_day_id", null);
      const { data, error } = await q.single();
      if (error || !data) throw new Error(`appOf ${k}: ${error?.message}`);
      return data;
    };
    const missionOf = async (applicationId: string) =>
      (
        await serviceClient
          .from("missions")
          .select("id, status")
          .eq("application_id", applicationId)
          .maybeSingle()
      ).data;
    const contractOf = async (applicationId: string) =>
      (
        await serviceClient
          .from("contracts")
          .select("id")
          .eq("application_id", applicationId)
          .maybeSingle()
      ).data;
    const appOfApply = async (k: K, jobId: string) => {
      const { data, error } = await sess[k].client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !data) throw new Error(`apply ${k}: ${error?.message}`);
      return (data as { id: string }).id;
    };
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    type CancelRow = { cancellation_id: string; already_recorded: boolean };
    {
      // Journées X2 et Y2 à 2 places : c1 et c2 sélectionnés sur les deux,
      // c3 et c4 en attente ; c1 se désiste des deux → deux cycles.
      const job = await perDayJob(2, 2, "Annulation date");
      const [X2, Y2] = job.dayIds;
      await applyDays("c1", job.jobId, [X2, Y2]);
      await applyDays("c2", job.jobId, [X2, Y2]);
      await applyDays("c3", job.jobId, [X2, Y2]);
      await applyDays("c4", job.jobId, [X2]);
      const m1x = await select((await appOf("c1", job.jobId, X2)).id);
      const m1y = await select((await appOf("c1", job.jobId, Y2)).id);
      const m2x = await select((await appOf("c2", job.jobId, X2)).id);
      await select((await appOf("c2", job.jobId, Y2)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
      const w = await cancel(
        "c1",
        [...(await missionDays(m1x)), ...(await missionDays(m1y))].map(
          (d) => d.id,
        ),
      );
      if (w.error) throw new Error(`A : désistement ${w.error.message}`);
      const opened = await cycles(job.jobId);
      const cX = opened.find((c) => c.job_day_id === X2)!;
      const cY = opened.find((c) => c.job_day_id === Y2)!;
      const conf3 = await confirm("c3", cX.id);
      const app3 = (await cycleApp(cX.id, "c3"))!;
      const c2xDays = (await missionDays(m2x)).map((d) => d.id);

      // A1 : panne pendant la neutralisation → rien n'est enregistré.
      execSql(`create or replace function public.proof_17d4_fail_event() returns trigger
        language plpgsql as $$ begin
          if new.kind = 'company_cancelled' then raise exception 'proof_17d4_fail_event'; end if;
          return new; end $$`);
      execSql(`create trigger proof_17d4_fail_event before insert on public.replacement_cycle_events
        for each row execute function public.proof_17d4_fail_event()`);
      const failReq = randomUUID();
      const failed = await companyCancel(job.jobId, c2xDays, failReq);
      execSql(
        "drop trigger if exists proof_17d4_fail_event on public.replacement_cycle_events",
      );
      execSql("drop function if exists public.proof_17d4_fail_event()");
      const afterFail = await cycles(job.jobId);
      const { count: failRows } = await serviceClient
        .from("company_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("request_id", failReq);
      const { count: failDays } = await serviceClient
        .from("company_cancellation_days")
        .select("mission_day_id", { count: "exact", head: true })
        .in("mission_day_id", c2xDays);
      report(
        "A1 panne pendant la neutralisation : ni annulation ni journée annulée, cycle inchangé (même transaction)",
        !!failed.error &&
          failRows === 0 &&
          failDays === 0 &&
          afterFail.find((c) => c.id === cX.id)?.state === "open" &&
          conf3.status === 200,
        { error: failed.error?.message, failRows, failDays },
      );

      // A2 : trois envois simultanés de la même annulation (date X2).
      const req = randomUUID();
      const sends = await Promise.all(
        Array.from({ length: 3 }, () => companyCancel(job.jobId, c2xDays, req)),
      );
      const rows = sends.map((r) => (r.data as CancelRow[] | null)?.[0]);
      const after = await cycles(job.jobId);
      const aX = after.find((c) => c.id === cX.id)!;
      const aY = after.find((c) => c.id === cY.id)!;
      report(
        "A2 date annulée : places non pourvues neutralisées et cycle fermé dans la transaction de l'annulation ; envois simultanés de la même demande : résultat d'origine, une seule neutralisation",
        sends.every((r) => !r.error) &&
          rows.filter((x) => x?.already_recorded === false).length === 1 &&
          new Set(rows.map((x) => x?.cancellation_id)).size === 1 &&
          aX.state === "cancelled" &&
          aX.remaining === 0 &&
          aX.cancelled === 1 &&
          aX.filled === 0 &&
          aX.cancellation === rows[0]?.cancellation_id &&
          (aX.events ?? []).filter((e) => e === "company_cancelled").length ===
            1,
        { sends: sends.map((r) => r.error?.message ?? "ok"), aX },
      );
      const c2y = await appOf("c2", job.jobId, Y2);
      const c2x = await appOf("c2", job.jobId, X2);
      report(
        "A3 journée indépendante (cycle Y2 ouvert), contrats, sources, journal, avis et confirmation conservés",
        aY.state === "open" &&
          aY.remaining === 1 &&
          aY.cancelled === 0 &&
          !(aY.events ?? []).includes("company_cancelled") &&
          c2y.status === "selected" &&
          c2x.status === "selected" &&
          !!(await contractOf(c2x.id)) &&
          !!(await contractOf((await appOf("c1", job.jobId, X2)).id)) &&
          aX.sources === 1 &&
          aY.sources === 1 &&
          (aX.events ?? []).includes("opened") &&
          (aX.notices ?? []).length === (cX.notices ?? []).length &&
          (await cycleApp(cX.id, "c3"))?.status === "pending",
        { aY, c2y: c2y.status, c2x: c2x.status },
      );

      // A4 : refus par lecture, par les routes et par appel direct.
      const view = await sess.c4.client.rpc("job_replacement_cycles", {
        p_job_id: job.jobId,
      });
      const vX = view.data?.find((c) => c.cycle_id === cX.id);
      const company = await A.client.rpc("company_replacement_cycles", {
        p_job_id: job.jobId,
      });
      const kX = company.data?.find((c) => c.cycle_id === cX.id);
      const httpConfirm = await confirm("c4", cX.id);
      const rpcConfirm = await sess.c4.client.rpc(
        "confirm_replacement_interest",
        { p_cycle_id: cX.id, p_consent: true },
      );
      const httpSelect = await signAndSelectHttp(APP_URL, app3.id, A.cookie);
      const rpcSelect = await signAndSelectRpc(A.client, app3.id);
      report(
        "A4 cycle annulé : lu fermé (candidat, entreprise) ; confirmation et sélection refusées par les routes et par appel direct (replacement_cancelled), aucun engagement",
        vX?.state === "cancelled" &&
          vX.places_open === 0 &&
          kX?.state === "cancelled" &&
          httpConfirm.status === 409 &&
          httpConfirm.body.code === "replacement_cancelled" &&
          rpcConfirm.error?.message === "replacement_cancelled" &&
          httpSelect.status === 409 &&
          httpSelect.body.code === "replacement_cancelled" &&
          rpcSelect.error?.message === "replacement_cancelled" &&
          (await appRow(app3.id)).status === "pending" &&
          !(await missionOf(app3.id)),
        {
          vX,
          kX: kX?.state,
          httpConfirm: httpConfirm.body,
          rpcConfirm: rpcConfirm.error?.message,
          httpSelect: httpSelect.body,
          rpcSelect: rpcSelect.error?.message,
        },
      );
    }

    // ── A5. Période complète : une date annulée ferme tout le cycle ─
    {
      const days: FixtureDay[] = [
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
      ];
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-4a (période annulée).",
          address: "Rue Joss",
          city: "Douala",
          title: "Période annulée",
          company_id: coA,
          mission_pay_per_candidate: 40000,
          positions_available: 2,
        },
        days,
        "full_period",
      );
      const q1 = await appOfApply("c1", jobId);
      const q2 = await appOfApply("c2", jobId);
      await appOfApply("c3", jobId);
      const mq1 = await select(q1);
      const mq2 = await select(q2);
      await proofRpc("proof_17d4_close_initial", { p_job: jobId });
      const w = await cancel(
        "c1",
        (await missionDays(mq1)).map((d) => d.id),
      );
      if (w.error) throw new Error(`A5 : désistement ${w.error.message}`);
      const [cP] = await cycles(jobId);
      const cf = await confirm("c3", cP.id);
      const d2 = (await missionDays(mq2))[1].id;
      const cc = await companyCancel(jobId, [d2]);
      const [p] = await cycles(jobId);
      const sel = await signAndSelectRpc(
        A.client,
        (await cycleApp(cP.id, "c3"))!.id,
      );
      const m2 = await missionOf(q2);
      report(
        "A5 période complète : une date annulée ferme tout le cycle (aucun remplacement partiel, 17d-4c), l'engagement restant est conservé",
        cf.status === 200 &&
          !cc.error &&
          p.state === "cancelled" &&
          p.cancelled === 1 &&
          sel.error?.message === "replacement_cancelled" &&
          m2?.status !== "cancelled" &&
          (await appRow(q2)).status === "selected",
        { cc: cc.error?.message, p, sel: sel.error?.message, m2 },
      );
    }

    // ── A6. Aucun cycle sur une date déjà annulée par l'entreprise ─
    {
      const job = await perDayJob(1, 2, "Date annulée puis désistement");
      const [V] = job.dayIds;
      await applyDays("c5", job.jobId, [V]);
      const m5 = await select((await appOf("c5", job.jobId, V)).id);
      const cc = await companyCancel(
        job.jobId,
        (await missionDays(m5)).map((d) => d.id),
      );
      // Recrutement initial encore ouvert : règles existantes (hors 17d-4a).
      const ap6 = await sess.c6.client.rpc("apply_to_job_days", {
        p_job_id: job.jobId,
        p_day_ids: [V],
      });
      const detail: Record<string, unknown> = {
        cc: cc.error?.message ?? "ok",
        apply: ap6.error?.message ?? "ok",
      };
      let ok = !cc.error;
      let reached = false;
      if (!ap6.error) {
        const a6 = (await appOf("c6", job.jobId, V)).id;
        const sel6 = await signAndSelectRpc(A.client, a6);
        detail.select = sel6.error?.message ?? "ok";
        if (!sel6.error) {
          const m6 = (sel6.data as { mission_id: string }[])[0].mission_id;
          await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
          const w6 = await cancel(
            "c6",
            (await missionDays(m6)).map((d) => d.id),
          );
          detail.withdraw = w6.error?.message ?? "ok";
          reached = true;
          ok = ok && !w6.error && (await appRow(a6)).status === "withdrawn";
        }
      }
      const cyc = await cycles(job.jobId);
      detail.cycles = cyc.length;
      detail.withdrawalReached = reached;
      report(
        "A6 désistement sur une date déjà annulée par l'entreprise : aucun cycle ouvert",
        ok && cyc.length === 0,
        detail,
      );
    }

    // ── R. Course entre annulation et sélection (ordre effectif) ──
    {
      const setup = async (title: string, sel: [K, K], pending: K) => {
        const job = await perDayJob(1, 2, title);
        const [Z] = job.dayIds;
        await applyDays(sel[0], job.jobId, [Z]);
        await applyDays(sel[1], job.jobId, [Z]);
        await applyDays(pending, job.jobId, [Z]);
        const mA = await select((await appOf(sel[0], job.jobId, Z)).id);
        const mB = await select((await appOf(sel[1], job.jobId, Z)).id);
        await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
        const w = await cancel(
          sel[0],
          (await missionDays(mA)).map((d) => d.id),
        );
        if (w.error) throw new Error(`${title} : ${w.error.message}`);
        const [c] = await cycles(job.jobId);
        const cf = await confirm(pending, c.id);
        if (cf.status !== 200) {
          throw new Error(`${title} : confirmation ${JSON.stringify(cf.body)}`);
        }
        return {
          job,
          app: (await cycleApp(c.id, pending))!,
          engagedDays: (await missionDays(mB)).map((d) => d.id),
        };
      };
      // R2 : l'annulation est validée la première.
      const s1 = await setup("Course annulation d'abord", ["c5", "c6"], "c7");
      const hold = proofRpc<Res>("proof_17d4_company_cancel_hold", {
        p_actor: idA,
        p_request: randomUUID(),
        p_job: s1.job.jobId,
        p_days: s1.engagedDays,
        p_sleep: 2.5,
      });
      await pause(800);
      const t0 = Date.now();
      const late = await signAndSelectRpc(A.client, s1.app.id);
      const waited = Date.now() - t0;
      const held = await hold;
      const [r2] = await cycles(s1.job.jobId);
      report(
        "R2 annulation validée avant la sélection : la sélection attend sa fin puis est refusée (replacement_cancelled), aucun engagement sur la place annulée",
        !held.error &&
          late.error?.message === "replacement_cancelled" &&
          waited > 500 &&
          r2.state === "cancelled" &&
          r2.filled === 0 &&
          r2.cancelled === 1 &&
          (await appRow(s1.app.id)).status === "pending" &&
          !(await missionOf(s1.app.id)),
        { held, late: late.error?.message, waited, r2 },
      );
      // R3 : la sélection est validée la première.
      const s2 = await setup("Course sélection d'abord", ["c8", "c9"], "c4");
      const holdSel = proofRpc<Res>("proof_17d4_select_hold", {
        p_actor: idA,
        p_application: s2.app.id,
        p_sleep: 2.5,
      });
      await pause(800);
      const t1 = Date.now();
      const lateCancel = await companyCancel(s2.job.jobId, s2.engagedDays);
      const waited2 = Date.now() - t1;
      const heldSel = await holdSel;
      const [r3] = await cycles(s2.job.jobId);
      const rep = await missionOf(s2.app.id);
      const repDays = rep ? (await missionDays(rep.id)).map((d) => d.id) : [];
      // Nouvel aperçu : la date entière comprend désormais le remplaçant.
      const again = await companyCancel(s2.job.jobId, [
        ...s2.engagedDays,
        ...repDays,
      ]);
      const [r3b] = await cycles(s2.job.jobId);
      const { count: repCancelled } = await serviceClient
        .from("company_cancellation_days")
        .select("mission_day_id", { count: "exact", head: true })
        .in("mission_day_id", repDays.length ? repDays : [randomUUID()]);
      report(
        "R3 sélection validée avant l'annulation : l'annulation attend sa fin puis est refusée (cancellation_preview_stale) ; relue, elle annule aussi le remplaçant, contrat conservé, aucune place neutralisée en trop",
        !heldSel.error &&
          lateCancel.error?.message === "cancellation_preview_stale" &&
          waited2 > 500 &&
          r3.state === "filled" &&
          r3.filled === 1 &&
          !r3.cancelled_at &&
          !again.error &&
          r3b.state === "cancelled" &&
          r3b.filled === 1 &&
          r3b.cancelled === 0 &&
          !!(await contractOf(s2.app.id)) &&
          repCancelled === 1,
        {
          heldSel,
          lateCancel: lateCancel.error?.message,
          waited2,
          r3,
          again: again.error?.message,
          r3b,
        },
      );
    }

    // ── S. Entreprise non autorisée : comportement observé ────────
    const anonSees = async (jobId: string) =>
      ((await anonClient.from("jobs").select("id").eq("id", jobId)).data ?? [])
        .length;
    const listing = (jobId: string) =>
      proofRpc<Record<string, boolean>>("proof_17d4_listing", {
        p_job: jobId,
      });
    {
      // S1 et S2 : dossier non valide à l'ouverture, puis revalidation.
      const job = await perDayJob(1, 1, "Dossier invalide");
      const [D] = job.dayIds;
      await applyDays("c7", job.jobId, [D]);
      await applyDays("c3", job.jobId, [D]);
      const m7 = await select((await appOf("c7", job.jobId, D)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
      await serviceClient
        .from("company_profiles")
        .update({ verification_status: "pending" })
        .eq("id", coA);
      let inv: Record<string, unknown> = {};
      let c: CycleView | undefined;
      try {
        const w = await cancel(
          "c7",
          (await missionDays(m7)).map((d) => d.id),
        );
        [c] = await cycles(job.jobId);
        const cf = await confirm("c3", c.id);
        inv = {
          withdraw: w.error?.message ?? "ok",
          anon: await anonSees(job.jobId),
          listing: (await listing(job.jobId)).listing_open,
          applicantView: (
            await sess.c3.client.rpc("job_replacement_cycles", {
              p_job_id: job.jobId,
            })
          ).data?.[0]?.state,
          confirm: cf.body.code ?? cf.status,
          notifCandidate: (await notifs(uid.c3, job.jobId)).length,
          notifCompany: (await notifs(idA, job.jobId)).length,
          events: c.events,
        };
      } finally {
        await approveCompanyDossier(serviceClient, coA);
      }
      report(
        "S1 dossier non valide à l'ouverture : offre invisible (sauf candidats déjà candidats), confirmation refusée, aucun avis (provisoire, ANN-22) ; sélection refusée (E2)",
        inv.withdraw === "ok" &&
          inv.anon === 0 &&
          inv.listing === false &&
          inv.applicantView === "unavailable" &&
          inv.confirm === "job_not_available" &&
          inv.notifCandidate === 0 &&
          inv.notifCompany === 0 &&
          ((inv.events as string[] | null) ?? []).includes("alerts_withheld"),
        inv,
      );
      const cf2 = await confirm("c3", c!.id);
      const row = await cycleApp(c!.id, "c3");
      const sel = row ? await signAndSelectRpc(A.client, row.id) : null;
      const [c2] = await cycles(job.jobId);
      const rev = {
        anon: await anonSees(job.jobId),
        confirm: cf2.status,
        select: sel?.error?.message ?? (sel ? "ok" : "none"),
        closesSame: c2.closes_at === c!.closes_at,
        notices: (c2.notices ?? []).length,
        notifCandidate: (await notifs(uid.c3, job.jobId)).length,
      };
      report(
        "S2 revalidation : visibilité et confirmation rétablies, sélection possible jusqu'à H−2, fenêtre inchangée, aucun avis envoyé après coup (provisoire, ANN-22)",
        rev.anon === 1 &&
          rev.confirm === 200 &&
          rev.select === "ok" &&
          rev.closesSame &&
          rev.notices === 0 &&
          rev.notifCandidate === 0,
        rev,
      );
    }
    {
      // S3 et S4 : compte de l'entreprise suspendu à l'ouverture, puis levé.
      const job = await perDayJob(1, 1, "Entreprise suspendue");
      const [D] = job.dayIds;
      await applyDays("c9", job.jobId, [D]);
      await applyDays("c2", job.jobId, [D]);
      const m9 = await select((await appOf("c9", job.jobId, D)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", idA);
      let sus: Record<string, unknown> = {};
      let c: CycleView | undefined;
      try {
        const w = await cancel(
          "c9",
          (await missionDays(m9)).map((d) => d.id),
        );
        [c] = await cycles(job.jobId);
        const cf = await confirm("c2", c.id);
        const row = await cycleApp(c.id, "c2");
        const sel = row ? await signAndSelectRpc(A.client, row.id) : null;
        sus = {
          withdraw: w.error?.message ?? "ok",
          anon: await anonSees(job.jobId),
          listing: (await listing(job.jobId)).listing_open,
          confirm: cf.status,
          select: sel?.error?.message ?? (sel ? "ok" : "none"),
          notifCandidate: (await notifs(uid.c2, job.jobId)).length,
          notifCompany: (await notifs(idA, job.jobId)).length,
          events: c.events,
        };
      } finally {
        await serviceClient
          .from("users")
          .update({ is_active: true })
          .eq("id", idA);
      }
      report(
        "S3 compte entreprise suspendu à l'ouverture : seule la sélection est refusée (account_suspended, règle existante) ; offre visible, confirmation acceptée, avis envoyés (aucune extension de la suspension)",
        sus.withdraw === "ok" &&
          sus.anon === 1 &&
          sus.listing === true &&
          sus.confirm === 200 &&
          sus.select === "account_suspended" &&
          sus.notifCandidate === 1 &&
          sus.notifCompany === 1 &&
          !((sus.events as string[] | null) ?? []).includes("alerts_withheld"),
        sus,
      );
      const row = await cycleApp(c!.id, "c2");
      const sel = row ? await signAndSelectRpc(A.client, row.id) : null;
      const [c2] = await cycles(job.jobId);
      const lifted = {
        select: sel?.error?.message ?? (sel ? "ok" : "none"),
        closesSame: c2.closes_at === c!.closes_at,
        notices: (c2.notices ?? []).length,
        noticesBefore: (c!.notices ?? []).length,
        notifCandidate: (await notifs(uid.c2, job.jobId)).length,
      };
      report(
        "S4 suspension levée : sélection possible jusqu'à H−2, fenêtre inchangée, aucun avis répété",
        lifted.select === "ok" &&
          lifted.closesSame &&
          lifted.notices === lifted.noticesBefore &&
          lifted.notifCandidate === 1,
        lifted,
      );
    }

    // ── I. Désistement : demandes différentes et identifiant réutilisé ─
    {
      const job = await perDayJob(1, 1, "Demandes distinctes");
      const [D] = job.dayIds;
      await applyDays("c1", job.jobId, [D]);
      await applyDays("c6", job.jobId, [D]);
      const m1 = await select((await appOf("c1", job.jobId, D)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
      const dayIds = (await missionDays(m1)).map((d) => d.id);
      const reqs = [randomUUID(), randomUUID(), randomUUID()];
      const sends = await Promise.all(reqs.map((r) => cancel("c1", dayIds, r)));
      const [c] = await cycles(job.jobId);
      const { count } = await serviceClient
        .from("candidate_cancellations")
        .select("id", { count: "exact", head: true })
        .in("request_id", reqs);
      report(
        "I1 trois demandes différentes simultanées sur la même mission : une enregistrée, deux refusées (mission_not_active), une place, une source, un avis par destinataire",
        sends.filter((r) => !r.error).length === 1 &&
          sends.filter((r) => r.error?.message === "mission_not_active")
            .length === 2 &&
          count === 1 &&
          c?.released === 1 &&
          c.sources === 1 &&
          (await notifs(uid.c6, job.jobId)).length === 1 &&
          (await notifs(idA, job.jobId)).length === 1,
        { sends: sends.map((r) => r.error?.message ?? "ok"), count, c },
      );
      const winner = reqs[sends.findIndex((r) => !r.error)];
      const conflict = await cancel("c1", [randomUUID()], winner);
      const replay = await cancel("c1", dayIds, winner);
      const [cAfter] = await cycles(job.jobId);
      report(
        "I2 identifiant déjà utilisé : autres journées → request_conflict ; mêmes journées → résultat d'origine, sans écriture",
        conflict.error?.message === "request_conflict" &&
          (replay.data as CancelRow[] | null)?.[0]?.already_recorded === true &&
          cAfter.released === 1 &&
          cAfter.sources === 1 &&
          (await notifs(uid.c6, job.jobId)).length === 1,
        { conflict: conflict.error?.message, replay: replay.data, cAfter },
      );
    }

    // ── O. Date annulée : recrutement ordinaire fermé (ANN-08) ───
    const applyHttp = (k: K, jobId: string, dayIds?: string[]) =>
      http(
        "POST",
        `/api/jobs/${jobId}/apply`,
        sess[k].cookie,
        dayIds ? { day_ids: dayIds } : {},
      );
    const appsCount = async (k: K, jobId: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId)
          .eq("candidate_id", prof[k])
      ).count ?? 0;
    const daysView = async (k: K, jobId: string) =>
      (
        await sess[k].client.rpc("job_days_for_candidate", {
          p_job_id: jobId,
        })
      ).data ?? [];
    {
      // O1 à O3 : journées au choix, échéance initiale encore ouverte.
      const job = await perDayJob(2, 2, "Date annulée, recrutement ouvert");
      const [X, Y] = job.dayIds;
      await applyDays("c1", job.jobId, [X]);
      await applyDays("c2", job.jobId, [X]);
      const m1 = await select((await appOf("c1", job.jobId, X)).id);
      const c2x = (await appOf("c2", job.jobId, X)).id;
      const cc = await companyCancel(
        job.jobId,
        (await missionDays(m1)).map((d) => d.id),
      );
      const before3 = await appsCount("c3", job.jobId);
      const httpX = await applyHttp("c3", job.jobId, [X]);
      const rpcXY = await sess.c3.client.rpc("apply_to_job_days", {
        p_job_id: job.jobId,
        p_day_ids: [X, Y],
      });
      const after3 = await appsCount("c3", job.jobId);
      const httpSel = await signAndSelectHttp(APP_URL, c2x, A.cookie);
      const rpcSel = await signAndSelectRpc(A.client, c2x);
      const blocked = (
        httpX.body as { days?: { id: string; reason: string }[] }
      ).days;
      report(
        "O1 échéance ouverte puis date annulée : candidature (route et appel direct, envoi atomique) et sélection ordinaires refusées (date_cancelled), sans effet",
        !cc.error &&
          httpX.status === 409 &&
          httpX.body.code === "job_days_unavailable" &&
          (blocked ?? []).some(
            (b) => b.id === X && b.reason === "date_cancelled",
          ) &&
          rpcXY.error?.message === "job_days_unavailable" &&
          before3 === 0 &&
          after3 === 0 &&
          httpSel.status === 409 &&
          httpSel.body.code === "date_cancelled" &&
          rpcSel.error?.message === "date_cancelled" &&
          (await appRow(c2x)).status === "pending" &&
          !(await missionOf(c2x)),
        {
          cc: cc.error?.message,
          httpX: httpX.body,
          rpcXY: rpcXY.error?.message,
          after3,
          httpSel: httpSel.body,
          rpcSel: rpcSel.error?.message,
        },
      );
      const view = await daysView("c3", job.jobId);
      const vX = view.find((d) => d.day_id === X);
      const vY = view.find((d) => d.day_id === Y);
      const company = await A.client.rpc("company_job_applicants", {
        p_job_id: job.jobId,
      });
      const kX = company.data?.find((a) => a.application_id === c2x);
      const listed = await http(
        "GET",
        `/api/jobs?search=${encodeURIComponent("recrutement ouvert")}`,
        null,
      );
      report(
        "O2 état lu : date annulée fermée (candidat, entreprise), autre journée ouverte, offre toujours listée",
        vX?.date_cancelled === true &&
          vX.recruitment_open === false &&
          vY?.date_cancelled === false &&
          vY.recruitment_open === true &&
          kX?.date_cancelled === true &&
          (await listing(job.jobId)).listing_open === true &&
          JSON.stringify(listed.body).includes(job.jobId),
        { vX, vY, kX: kX?.date_cancelled, listedStatus: listed.status },
      );
      const okY = await applyHttp("c3", job.jobId, [Y]);
      const c3y = (await appOf("c3", job.jobId, Y)).id;
      const selY = await signAndSelectRpc(A.client, c3y);
      const m1row = await missionOf((await appOf("c1", job.jobId, X)).id);
      report(
        "O3 autre journée accessible selon ses règles (candidature et sélection) ; engagement, contrat et historique de la date annulée conservés",
        okY.status === 200 &&
          !selY.error &&
          (await appOf("c1", job.jobId, X)).status === "selected" &&
          !!(await contractOf((await appOf("c1", job.jobId, X)).id)) &&
          !!m1row,
        { okY: okY.status, selY: selY.error?.message, m1row },
      );
    }
    {
      // O4 : période complète, échéance ouverte, une date annulée.
      const days: FixtureDay[] = [
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
        { date: nextDate(), start_time: "08:00", end_time: "14:00" },
      ];
      const { jobId } = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-4a (période, recrutement ouvert).",
          address: "Rue Joss",
          city: "Douala",
          title: "Période ouverte annulée",
          company_id: coA,
          mission_pay_per_candidate: 40000,
          positions_available: 3,
        },
        days,
        "full_period",
      );
      const p4 = await appOfApply("c4", jobId);
      const p5 = await appOfApply("c5", jobId);
      const m4 = await select(p4);
      const cc = await companyCancel(jobId, [(await missionDays(m4))[1].id]);
      const before6 = await appsCount("c6", jobId);
      const http6 = await applyHttp("c6", jobId);
      const rpc6 = await sess.c6.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      const sel5 = await signAndSelectRpc(A.client, p5);
      const avail = await anonClient.rpc("job_availability", {
        p_job_id: jobId,
      });
      report(
        "O4 période complète : une date annulée ferme candidature et sélection ordinaires (date_cancelled), offre lue « date annulée » et retirée de la liste ; engagement restant conservé",
        !cc.error &&
          http6.status === 409 &&
          http6.body.code === "date_cancelled" &&
          rpc6.error?.message === "date_cancelled" &&
          before6 === 0 &&
          (await appsCount("c6", jobId)) === 0 &&
          sel5.error?.message === "date_cancelled" &&
          !(await missionOf(p5)) &&
          avail.data === "date_cancelled" &&
          (await listing(jobId)).listing_open === false &&
          (await appRow(p4)).status === "selected" &&
          !!(await contractOf(p4)),
        {
          cc: cc.error?.message,
          http6: http6.body,
          rpc6: rpc6.error?.message,
          sel5: sel5.error?.message,
          avail: avail.data,
        },
      );
    }
    {
      // O5 : retrait ciblé accepté par le support ≠ date annulée.
      const idOps = await createAccount(mail("ops"), "admin_ops");
      ids.push(idOps);
      const ops = await realSession(mail("ops"));
      const job = await perDayJob(1, 3, "Retrait ciblé");
      const [Z] = job.dayIds;
      await applyDays("c7", job.jobId, [Z]);
      await applyDays("c8", job.jobId, [Z]);
      const m7 = await select((await appOf("c7", job.jobId, Z)).id);
      await select((await appOf("c8", job.jobId, Z)).id);
      const z7 = (await missionDays(m7)).map((d) => d.id);
      const rq = await A.client.rpc("request_targeted_removal", {
        p_request_id: randomUUID(),
        p_job_id: job.jobId,
        p_day_ids: z7,
        p_reason: "Retrait ciblé demandé pour la preuve 17d-4a.",
      });
      const rqId = (rq.data as { engagement_request_id: string }[] | null)?.[0]
        ?.engagement_request_id;
      const dec = rqId
        ? await ops.client.rpc("admin_decide_engagement_request", {
            p_id: rqId,
            p_decision: "accept",
            p_day_ids: z7,
            p_note: "Décision de preuve 17d-4a.",
          })
        : null;
      const viewZ = (await daysView("c9", job.jobId)).find(
        (d) => d.day_id === Z,
      );
      const ap9 = await applyHttp("c9", job.jobId, [Z]);
      const sel9 =
        ap9.status === 200
          ? await signAndSelectRpc(
              A.client,
              (await appOf("c9", job.jobId, Z)).id,
            )
          : null;
      report(
        "O5 retrait ciblé accepté par le support : la date n'est pas annulée, candidature et sélection d'autres candidats restent possibles",
        !rq.error &&
          !!dec &&
          !dec.error &&
          viewZ?.date_cancelled === false &&
          ap9.status === 200 &&
          !!sel9 &&
          !sel9.error,
        {
          rq: rq.error?.message,
          dec: dec?.error?.message,
          viewZ: viewZ?.date_cancelled,
          ap9: ap9.body,
          sel9: sel9?.error?.message,
        },
      );
    }
    {
      // O6 à O8 : concurrence avec le recrutement ordinaire (échéance ouverte).
      const setupO = async (title: string, engaged: K, pending: K) => {
        const job = await perDayJob(1, 3, title);
        const [Z] = job.dayIds;
        await applyDays(engaged, job.jobId, [Z]);
        await applyDays(pending, job.jobId, [Z]);
        const m = await select((await appOf(engaged, job.jobId, Z)).id);
        return {
          job,
          Z,
          pendingApp: (await appOf(pending, job.jobId, Z)).id,
          engagedDays: (await missionDays(m)).map((d) => d.id),
        };
      };
      // O6 : annulation validée d'abord → la sélection attend puis est refusée.
      const s1 = await setupO(
        "Course ordinaire annulation d'abord",
        "c1",
        "c2",
      );
      const hold = proofRpc<Res>("proof_17d4_company_cancel_hold", {
        p_actor: idA,
        p_request: randomUUID(),
        p_job: s1.job.jobId,
        p_days: s1.engagedDays,
        p_sleep: 2.5,
      });
      await pause(800);
      const t0 = Date.now();
      const late = await signAndSelectRpc(A.client, s1.pendingApp);
      const waited = Date.now() - t0;
      const held = await hold;
      report(
        "O6 annulation validée avant une sélection ordinaire : la sélection attend sa fin puis est refusée (date_cancelled), aucun engagement",
        !held.error &&
          late.error?.message === "date_cancelled" &&
          waited > 500 &&
          (await appRow(s1.pendingApp)).status === "pending" &&
          !(await missionOf(s1.pendingApp)),
        { held: held.error, late: late.error?.message, waited },
      );
      // O7 : sélection ordinaire validée d'abord → l'annulation attend, est
      // périmée ; relue, elle annule aussi le nouvel engagement (contrat conservé).
      const s2 = await setupO("Course ordinaire sélection d'abord", "c3", "c4");
      const holdSel = proofRpc<Res>("proof_17d4_select_hold", {
        p_actor: idA,
        p_application: s2.pendingApp,
        p_sleep: 2.5,
      });
      await pause(800);
      const t1 = Date.now();
      const lateCancel = await companyCancel(s2.job.jobId, s2.engagedDays);
      const waited2 = Date.now() - t1;
      const heldSel = await holdSel;
      const m4 = await missionOf(s2.pendingApp);
      const again = m4
        ? await companyCancel(s2.job.jobId, [
            ...s2.engagedDays,
            ...(await missionDays(m4.id)).map((d) => d.id),
          ])
        : null;
      report(
        "O7 sélection ordinaire validée avant l'annulation : l'annulation attend puis est refusée (cancellation_preview_stale) ; relue, elle annule aussi le nouvel engagement, contrat conservé",
        !heldSel.error &&
          lateCancel.error?.message === "cancellation_preview_stale" &&
          waited2 > 500 &&
          !!m4 &&
          !!again &&
          !again.error &&
          !!(await contractOf(s2.pendingApp)),
        {
          heldSel: heldSel.error,
          lateCancel: lateCancel.error?.message,
          waited2,
          again: again?.error?.message,
        },
      );
      // O8 : annulation validée d'abord → une candidature concurrente attend
      // (offre verrouillée en exclusif) puis est refusée.
      const s3 = await setupO(
        "Course candidature annulation d'abord",
        "c5",
        "c6",
      );
      const hold3 = proofRpc<Res>("proof_17d4_company_cancel_hold", {
        p_actor: idA,
        p_request: randomUUID(),
        p_job: s3.job.jobId,
        p_days: s3.engagedDays,
        p_sleep: 2.5,
      });
      await pause(800);
      const t2 = Date.now();
      const lateApply = await sess.c7.client.rpc("apply_to_job_days", {
        p_job_id: s3.job.jobId,
        p_day_ids: [s3.Z],
      });
      const waited3 = Date.now() - t2;
      const held3 = await hold3;
      report(
        "O8 annulation validée avant une candidature concurrente : la candidature attend sa fin puis est refusée (date_cancelled), rien n'est créé",
        !held3.error &&
          lateApply.error?.message === "job_days_unavailable" &&
          /date_cancelled/.test(lateApply.error?.details ?? "") &&
          waited3 > 500 &&
          (await appsCount("c7", s3.job.jobId)) === 0,
        {
          held3: held3.error,
          lateApply: lateApply.error?.message,
          details: lateApply.error?.details,
          waited3,
        },
      );
    }

    // ── Q. Réputation de l'entreprise (REP-04, condition 3) ──────
    // Unité « offre » : aucune unité tant qu'un cycle de remplacement permet
    // encore une sélection, même échéance initiale passée et engagements
    // restants réalisés ; recalcul programmé à la fermeture du cycle.
    {
      const idC = await createAccount(mail("cq"), "company");
      ids.push(idC);
      const coC = await createCompany(idC, "Traiteur Deido");
      const C = await realSession(mail("cq"));
      const offers = (at: string) =>
        proofRpc<{ offer_id: string; realized_at: string }[]>(
          "proof_17d4_offers",
          { p_company: coC, p_at: at },
        );
      const score = () =>
        proofRpc<{
          next_expiry_at: string | null;
          confirmed_count: number;
          experience_units: number;
        } | null>("proof_17d4_score", { p_company: coC });
      const shiftMicro = (iso: string, us: number) =>
        proofRpc<string>("proof_17d4_ts", { p_at: iso, p_us: us });
      const confirmDone = async (missionId: string) => {
        const at = new Date().toISOString();
        await serviceClient
          .from("missions")
          .update({ actual_start_time: at, status: "in_progress" })
          .eq("id", missionId);
        const { error: dErr } = await serviceClient
          .from("mission_days")
          .update({
            actual_start_time: at,
            actual_end_time: at,
            completion_source: "code",
          })
          .eq("mission_id", missionId);
        if (dErr) throw new Error(`journée réalisée : ${dErr.message}`);
        const { error: mErr } = await serviceClient
          .from("missions")
          .update({ actual_end_time: at, status: "completed" })
          .eq("id", missionId);
        if (mErr) throw new Error(`mission réalisée : ${mErr.message}`);
      };
      const selectC = async (appId: string) => {
        const r = await signAndSelectRpc(C.client, appId);
        if (r.error) throw new Error(`sélection C : ${r.error.message}`);
        return (r.data as { mission_id: string }[])[0].mission_id;
      };
      // Offre au choix : journée 1 réalisée par c1, journée 2 libérée par c2.
      const job = await perDayJob(2, 1, "Service traiteur", coC);
      const [D1, D2] = job.dayIds;
      await applyDays("c1", job.jobId, [D1]);
      await applyDays("c2", job.jobId, [D2]);
      await applyDays("c3", job.jobId, [D2]);
      const m1 = await selectC((await appOf("c1", job.jobId, D1)).id);
      const m2 = await selectC((await appOf("c2", job.jobId, D2)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job.jobId });
      await confirmDone(m1);
      execSql(`select public.refresh_reputation('company', '${coC}', 'job')`);
      const beforeCycle = await score();
      const w = await cancel(
        "c2",
        (await missionDays(m2)).map((d) => d.id),
      );
      if (w.error) throw new Error(`Q : désistement ${w.error.message}`);
      const [cQ] = await cycles(job.jobId);
      const nowOffers = await offers(new Date().toISOString());
      const afterCycle = await score();
      report(
        "Q1 échéance initiale passée, engagement restant réalisé, cycle de remplacement ouvert : aucune unité, recalcul programmé à la fermeture du cycle",
        cQ?.state === "open" &&
          beforeCycle?.confirmed_count === 0 &&
          !nowOffers.some((o) => o.offer_id === job.jobId) &&
          afterCycle?.confirmed_count === 0 &&
          afterCycle?.experience_units === 0 &&
          !!afterCycle?.next_expiry_at &&
          Date.parse(afterCycle.next_expiry_at) === Date.parse(cQ.closes_at),
        { cQ, beforeCycle, afterCycle, nowOffers },
      );
      const justBefore = await offers(await shiftMicro(cQ.closes_at, -1));
      const atClose = await offers(cQ.closes_at);
      const unit = atClose.find((o) => o.offer_id === job.jobId);
      report(
        "Q2 limite exacte : 1 µs avant la fermeture du cycle, aucune unité ; à la fermeture (sans remplaçant), unité datée de cette fermeture",
        !justBefore.some((o) => o.offer_id === job.jobId) &&
          !!unit &&
          Date.parse(unit.realized_at) === Date.parse(cQ.closes_at),
        { justBefore, atClose },
      );
      // Recalcul à l'échéance programmée : fermeture et échéance replacées
      // juste avant maintenant, puis balayage planifié (reputation_expiry_sweep).
      const swept = await proofRpc<{
        confirmed_count: number;
        experience_units: number;
        next_expiry_at: string | null;
      }>("proof_17d4_sweep_due", { p_company: coC, p_cycle: cQ.id });
      report(
        "Q3 balayage à l'échéance programmée : l'unité est acquise après la fermeture effective du cycle, une seule fois",
        swept.confirmed_count === 1 && swept.experience_units === 1,
        swept,
      );

      // Variante : remplaçant sélectionné dans le cycle, travail non réalisé.
      const job2 = await perDayJob(2, 1, "Service traiteur (remplaçant)", coC);
      const [E1, E2] = job2.dayIds;
      await applyDays("c4", job2.jobId, [E1]);
      await applyDays("c5", job2.jobId, [E2]);
      await applyDays("c6", job2.jobId, [E2]);
      const n1 = await selectC((await appOf("c4", job2.jobId, E1)).id);
      const n2 = await selectC((await appOf("c5", job2.jobId, E2)).id);
      await proofRpc("proof_17d4_close_initial", { p_job: job2.jobId });
      await confirmDone(n1);
      const w2 = await cancel(
        "c5",
        (await missionDays(n2)).map((d) => d.id),
      );
      if (w2.error) throw new Error(`Q4 : désistement ${w2.error.message}`);
      const [cR] = await cycles(job2.jobId);
      const cf = await confirm("c6", cR.id);
      await selectC((await cycleApp(cR.id, "c6"))!.id);
      const afterClose = await offers(await shiftMicro(cR.closes_at, 1));
      report(
        "Q4 remplaçant sélectionné dans le cycle : après la fermeture, aucune unité tant que son travail n'est pas réalisé (critères inchangés)",
        cf.status === 200 && !afterClose.some((o) => o.offer_id === job2.jobId),
        { cf: cf.status, afterClose },
      );
    }

    // ── X. Droits ────────────────────────────────────────────────
    {
      const sessRead = await sess.c2.client
        .from("replacement_cycles" as never)
        .select("*");
      const svcInsert = await serviceClient
        .from("replacement_cycles" as never)
        .insert({
          job_id: jobD.jobId,
          company_id: coA,
          starts_at: new Date(Date.now() + 9e8).toISOString(),
          closes_at: new Date(Date.now() + 9e8 - 7.2e6).toISOString(),
        } as never);
      const svcUpdate = await serviceClient
        .from("job_applications")
        .update({ replacement_cycle_id: cD.id } as never)
        .eq("id", aC2);
      const svcInsertApp = await serviceClient.from("job_applications").insert({
        job_id: jobD.jobId,
        job_day_id: X,
        candidate_id: prof.c9,
        status: "pending",
        replacement_cycle_id: cD.id,
        interest_confirmed_at: new Date().toISOString(),
        interest_origin: "new",
      } as never);
      const sessCycleUpdate = await sess.a.client
        .from("job_applications")
        .update({ interest_origin: "new" } as never)
        .eq("id", (await cycleApp(cD.id, "c8"))!.id);
      const cycleRows = await serviceClient
        .from("replacement_cycles" as never)
        .update({ closes_at: new Date().toISOString() } as never)
        .eq("id", cD.id);
      const companyB = await sess.b.client.rpc("company_replacement_cycles", {
        p_job_id: jobD.jobId,
      });
      report(
        "X1 tables du cycle fermées aux sessions et aux écritures de la clé service",
        !!sessRead.error && !!svcInsert.error && !!cycleRows.error,
        [
          sessRead.error?.message,
          svcInsert.error?.message,
          cycleRows.error?.message,
        ],
      );
      report(
        "X2 colonnes de confirmation jamais posées par la clé service ni par une session",
        !!svcUpdate.error && !!svcInsertApp.error && !!sessCycleUpdate.error,
        [
          svcUpdate.error?.message,
          svcInsertApp.error?.message,
          sessCycleUpdate.error?.message,
        ],
      );
      report(
        "X3 suivi des cycles réservé à l'entreprise propriétaire",
        companyB.error?.message === "job_not_found",
        companyB.error?.message,
      );
    }
  } finally {
    for (const sql of DROP_ALL) {
      try {
        execSql(sql);
      } catch {
        /* nettoyage au mieux */
      }
    }
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
