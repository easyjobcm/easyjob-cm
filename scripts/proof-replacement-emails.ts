/**
 * Preuve lot 17d-4b — e-mails du recrutement de remplacement.
 * Décisions : ANN-14 (destinataires), ANN-20, ANN-21 et ANN-22 (`[UV]`
 * 2026-11-26), DON-04, DON-06.
 *
 * Aucun envoi externe : l'envoi passe par le vrai module serveur
 * (`dispatchReplacementEmails`, vraies RPC `replacement_email_claim` et
 * `replacement_email_record` en clé service) avec le fournisseur SIMULÉ
 * (`fakeTransport`, en mémoire). L'application servie reste en mode
 * `disabled` : ses routes ne contactent aucun fournisseur.
 *
 *   P. Préférence : activation explicite (texte versionné), adresse
 *      confirmée exigée, rôle candidat, historique, écritures fermées.
 *   Q. Intention : destinataires d'ANN-14 seulement, jamais l'entreprise ;
 *      aucun consentement rétroactif ; relance du désistement sans doublon.
 *   F. Panne de mise en file : désistement, cycle et avis conservés ;
 *      échec tracé ; intention reprise par le balayage, une fois.
 *   D. Envoi simulé : accepté, clé stable, paramètres effacés, aucun renvoi.
 *   U. Issue incertaine : réponse perdue reprise avec la même clé (un seul
 *      envoi) ; bail expiré ; fenêtre d'idempotence dépassée → inconnu ;
 *      bail périmé ignoré.
 *   R. Concurrence : deux passages simultanés, chaque ligne envoyée une fois.
 *   C. Fermeture et pertinence : cycle fermé, pourvu, intérêt confirmé, date
 *      annulée, destinataire inéligible ; le lien ne crée rien et relit la
 *      disponibilité.
 *   W. Retrait du consentement : messages non transmis annulés, aucune
 *      reprise rétroactive ; tentative déjà en cours enregistrée telle quelle.
 *   A. ANN-22 : dossier non valide puis revalidé ; suspension pendant la
 *      file ; fermeture pendant la suspension.
 *   E. Événements du fournisseur : signature (route), doublons, désordre,
 *      corrélation par étiquette, rebond, ouverture ignorée, inconnus.
 *   T. Conservation : 90 jours.
 *   X. Droits : tables fermées, fonctions réservées, aucune adresse stockée.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "@/lib/database.types";
import { readEmailConfig } from "@/lib/email/config";
import {
  dispatchReplacementEmails,
  supabaseOutboxStore,
} from "@/lib/email/dispatcher";
import {
  fakeTransport,
  type EmailTransport,
  type FakeStep,
  type SendOutcome,
} from "@/lib/email/transport";
import { REPLACEMENT_EMAIL_CONSENT_VERSION } from "@/lib/validations/email-preference";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays, type FixtureDay } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectRpc } from "./lib/sign-and-select";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type Outbox = Database["public"]["Tables"]["replacement_email_outbox"]["Row"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF = "replacement-emails";
const PROOF_PASSWORD = "Proof-L17d4b-email-01!";
const PROOF_USER_METADATA = { proofReplacementEmails: true };
// Secrets de la pile de preuve (docs/testing/local-proofs.md, étape 3) :
// valeurs factices, jamais utilisées ailleurs.
const PROOF_WEBHOOK_SECRET =
  "whsec_ZWFzeWpvYi1wcm9vZi0xN2Q0Yi13ZWJob29rLXNlY3JldA==";
const PROOF_DISPATCH_SECRET = "proof-17d4b-dispatch-secret-0123456789abcdef";

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
const anonClient: DB = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FUNCTIONS: Record<string, string> = {
  // Champs temporels d'une ligne de file (simulation du temps).
  "proof_17d4b_outbox_set(uuid, jsonb)": `
create or replace function public.proof_17d4b_outbox_set(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.replacement_email_outbox o set
    next_attempt_at = coalesce((p->>'next_attempt_at')::timestamptz, o.next_attempt_at),
    first_attempt_at = coalesce((p->>'first_attempt_at')::timestamptz, o.first_attempt_at),
    lease_until = coalesce((p->>'lease_until')::timestamptz, o.lease_until),
    created_at = coalesce((p->>'created_at')::timestamptz, o.created_at)
  where o.id = p_id;
end $$`,
  "proof_17d4b_now_plus(interval)": `
create or replace function public.proof_17d4b_now_plus(p interval)
returns timestamptz language sql stable set search_path = '' as $$ select now() + p $$`,
  // Fermeture du cycle à now() + décalage (garde levée le temps de l'écriture).
  "proof_17d4b_close_cycle(uuid, interval)": `
create or replace function public.proof_17d4b_close_cycle(p_cycle uuid, p_delta interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.replacement_cycles disable trigger trg_protect_replacement_cycles;
  update public.replacement_cycles c set closes_at = now() + p_delta,
    starts_at = now() + p_delta + interval '2 hours',
    opened_at = least(c.opened_at, now() + p_delta - interval '3 hours') where c.id = p_cycle;
  alter table public.replacement_cycles enable trigger trg_protect_replacement_cycles;
end $$`,
  "proof_17d4b_email_confirmed(uuid, boolean)": `
create or replace function public.proof_17d4b_email_confirmed(p_user uuid, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update auth.users set email_confirmed_at = case when p_ok then now() end where id = p_user;
end $$`,
  "proof_17d4b_cni(uuid, date)": `
create or replace function public.proof_17d4b_cni(p_profile uuid, p_date date)
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
  "proof_17d4b_event_age(text, interval)": `
create or replace function public.proof_17d4b_event_age(p_event text, p_age interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.replacement_email_provider_events e set received_at = now() - p_age where e.event_id = p_event;
end $$`,
  "proof_17d4b_cycle(uuid)": `
create or replace function public.proof_17d4b_cycle(p_job uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'state', public.replacement_cycle_state(c, now()),
    'closes_at', c.closes_at,
    'events', (select jsonb_agg(e.kind order by e.created_at) from public.replacement_cycle_events e where e.cycle_id = c.id),
    'notices', (select coalesce(jsonb_agg(jsonb_build_object('user', n.user_id, 'kind', n.kind, 'intent', n.email_intent)), '[]')
                from public.replacement_cycle_notices n where n.cycle_id = c.id))
  from public.replacement_cycles c where c.job_id = p_job;
$$`,
  // Âge d'une intention (garde des avis levée le temps de l'écriture).
  "proof_17d4b_notice_age(uuid, interval)": `
create or replace function public.proof_17d4b_notice_age(p_cycle uuid, p_age interval)
returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.replacement_cycle_notices disable trigger trg_protect_replacement_cycle_notices;
  update public.replacement_cycle_notices n set created_at = now() - p_age where n.cycle_id = p_cycle;
  alter table public.replacement_cycle_notices enable trigger trg_protect_replacement_cycle_notices;
end $$`,
  "proof_17d4b_cron()": `
create or replace function public.proof_17d4b_cron()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'command', j.command)), '[]')
  from cron.job j where j.jobname = 'replacement-email-sweep';
$$`,
  "proof_17d4b_events(text[])": `
create or replace function public.proof_17d4b_events(p_ids text[])
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.replacement_email_provider_events e where e.event_id = any (p_ids);
$$`,
  "proof_17d4b_columns()": `
create or replace function public.proof_17d4b_columns()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_agg(column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name in ('replacement_email_outbox', 'replacement_email_provider_events');
$$`,
};
const FAIL_TRIGGER = [
  `create or replace function public.proof_17d4b_fail_outbox() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'proof_outbox_down'; end $$`,
  `create trigger proof_17d4b_fail_outbox before insert on public.replacement_email_outbox
  for each row execute function public.proof_17d4b_fail_outbox()`,
];
const DROP_ALL = [
  ...Object.keys(FUNCTIONS).map((f) => `drop function if exists public.${f}`),
  "drop trigger if exists proof_17d4b_fail_outbox on public.replacement_email_outbox",
  "drop function if exists public.proof_17d4b_fail_outbox()",
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
  const rpc = serviceClient.rpc.bind(serviceClient) as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  for (;;) {
    const { data, error } = await rpc(fn, args);
    if (!error) return data as T;
    if (Date.now() > end || !/schema cache|function/i.test(error.message)) {
      throw new Error(`${fn}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

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
      niu: `M4E${String(Date.now()).slice(-9)}${name.length}`,
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
      date_of_birth: "1996-05-04",
      city: "Douala",
      address: "Bonamoussadi, rue privée",
      latitude: 4.07,
      longitude: 9.75,
      bio: "Candidat de preuve du lot 17d-4b.",
      cni_number: `CNI4E${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677172174",
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
      .filter((u) => u.user_metadata?.proofReplacementEmails === true)
      .map((u) => u.id),
  );
}

type HttpResult = { status: number; body: Record<string, unknown> };
async function http(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  cookie: string | null,
  json?: unknown,
  extra: Record<string, string> = {},
  rawBody?: string,
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...extra };
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined || rawBody !== undefined)
    headers["Content-Type"] = "application/json";
  const res = await appFetch(`${APP_URL}${url}`, {
    method,
    headers,
    body: rawBody ?? (json !== undefined ? JSON.stringify(json) : undefined),
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

function signWebhook(
  id: string,
  body: string,
  ts = Math.floor(Date.now() / 1000),
) {
  const key = Buffer.from(PROOF_WEBHOOK_SECRET.slice(6), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(ts),
    "svix-signature": `v1,${sig}`,
  };
}

type CycleView = {
  id: string;
  state: string;
  closes_at: string;
  events: string[] | null;
  notices: { user: string; kind: string; intent: boolean }[];
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17d4b-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  const fakeConfig = readEmailConfig({
    EMAIL_TRANSPORT: "fake",
    NEXT_PUBLIC_APP_URL: APP_URL,
  });
  const store = supabaseOutboxStore(serviceClient);
  // Magasin instrumenté : action entre la revendication et le contrôle
  // final (fermeture du cycle pendant le passage).
  const storeWith = (afterClaim: () => Promise<void>) => ({
    ...store,
    claim: async (n: number) => {
      const rows = await store.claim(n);
      await afterClaim();
      return rows;
    },
  });
  // Transport instrumenté : action après le contrôle final, avant ou
  // après l'appel simulé.
  const transportWith = (
    inner: EmailTransport,
    hooks: {
      before?: () => Promise<void>;
      after?: (o: SendOutcome) => Promise<void>;
    },
  ): EmailTransport => ({
    name: "fake",
    async send(m, k) {
      await hooks.before?.();
      const o = await inner.send(m, k);
      await hooks.after?.(o);
      return o;
    },
  });
  const DIGEST = "a".repeat(64);
  const dispatch = (steps: FakeStep[] = [], fake = fakeTransport(steps)) =>
    dispatchReplacementEmails({
      config: fakeConfig,
      store,
      transport: fake,
    }).then((summary) => ({ summary, fake }));

  try {
    installFunctions();
    const keys = [
      "s1",
      "s2",
      "s3",
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
    ] as const;
    type K = (typeof keys)[number];
    const idA = await createAccount(mail("a"), "company");
    const uidList = await Promise.all(
      keys.map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, ...uidList);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, uidList[i]]),
    ) as Record<K, string>;
    const coA = await createCompany(idA, "Traiteur Bonapriso");
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
        ["a", ...keys].map(async (k) => [k, await realSession(mail(k))]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;

    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      return new Date(Date.UTC(2099, 5, 1) + dayNo * 86_400_000)
        .toISOString()
        .slice(0, 10);
    };
    let selector = 0;
    const SELECTORS: K[] = ["s1", "s2", "s3"];

    const outboxOf = async (cycleId: string) =>
      ((
        await serviceClient
          .from("replacement_email_outbox")
          .select("*")
          .eq("cycle_id", cycleId)
      ).data ?? []) as Outbox[];
    const rowOf = async (cycleId: string, k: K) =>
      (await outboxOf(cycleId)).find((o) => o.user_id === uid[k]);
    const cycleOf = (jobId: string) =>
      proofRpc<CycleView>("proof_17d4b_cycle", { p_job: jobId });
    const sweep = async () => {
      const { data, error } = await serviceClient.rpc(
        "replacement_email_sweep",
      );
      if (error) throw new Error(`sweep: ${error.message}`);
      return data as Record<string, number>;
    };
    const setRow = (id: string, p: Record<string, string>) =>
      proofRpc("proof_17d4b_outbox_set", { p_id: id, p });
    const due = (id: string) =>
      setRow(id, {
        next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      });
    const notifCount = async (userId: string, jobId: string) =>
      (
        (
          await serviceClient
            .from("notifications")
            .select("data")
            .eq("user_id", userId)
        ).data ?? []
      ).filter((n) => {
        const d = n.data as { kind?: string; job_id?: string } | null;
        return d?.kind === "replacement_cycle" && d.job_id === jobId;
      }).length;
    const pref = (k: K | "a", body: unknown) =>
      http("PUT", "/api/me/replacement-email-alerts", sess[k].cookie, body);
    const optIn = (k: K) =>
      pref(k, {
        enabled: true,
        consentVersion: REPLACEMENT_EMAIL_CONSENT_VERSION,
      });
    const optOut = (k: K) => pref(k, { enabled: false });
    const confirm = (k: K, cycleId: string) =>
      http(
        "POST",
        `/api/replacement-cycles/${cycleId}/interest`,
        sess[k].cookie,
        {
          consent: true,
        },
      );

    /**
     * Offre d'une journée et d'une place : un candidat « s » sélectionné
     * puis désisté ouvre le cycle ; les destinataires ont postulé.
     */
    const openCycle = async (
      title: string,
      recipients: K[],
      prepare?: (apps: Record<string, string>, jobId: string) => Promise<void>,
      beforeCancel?: () => Promise<void>,
      keeper = false,
    ) => {
      const positions = keeper ? 2 : 1;
      const days: FixtureDay[] = [
        {
          date: nextDate(),
          start_time: "08:00",
          end_time: "14:00",
          pay: 15000,
          positions,
        },
      ];
      const job = await insertJobWithDays(
        serviceClient,
        {
          description: "Preuve 17d-4b.",
          address: "Rue Joss",
          city: "Douala",
          title,
          company_id: coA,
          mission_pay_per_candidate: 15000,
          positions_available: positions,
        },
        days,
        "per_day",
      );
      const [dayId] = job.dayIds;
      const s = SELECTORS[selector++ % SELECTORS.length];
      // Second engagement maintenu (annulation de la date par l'entreprise).
      const kept = keeper ? SELECTORS[selector++ % SELECTORS.length] : null;
      const apps: Record<string, string> = {};
      for (const k of [s, ...(kept ? [kept] : []), ...recipients]) {
        const { data, error } = await sess[k].client.rpc("apply_to_job_days", {
          p_job_id: job.jobId,
          p_day_ids: [dayId],
        });
        if (error || !data) throw new Error(`apply ${k}: ${error?.message}`);
        apps[k] = data[0].id;
      }
      const sel = await signAndSelectRpc(A.client, apps[s]);
      if (sel.error) throw new Error(`select: ${sel.error.message}`);
      const missionId = (sel.data as { mission_id: string }[])[0].mission_id;
      let keptDays: string[] = [];
      if (kept) {
        const k2 = await signAndSelectRpc(A.client, apps[kept]);
        if (k2.error) throw new Error(`select keeper: ${k2.error.message}`);
        const keptMission = (k2.data as { mission_id: string }[])[0].mission_id;
        keptDays = (
          await serviceClient
            .from("mission_days")
            .select("id")
            .eq("mission_id", keptMission)
        ).data!.map((d) => d.id);
      }
      if (prepare) await prepare(apps, job.jobId);
      if (beforeCancel) await beforeCancel();
      const mDays = (
        await serviceClient
          .from("mission_days")
          .select("id")
          .eq("mission_id", missionId)
      ).data!;
      const requestId = randomUUID();
      const cancel = () =>
        sess[s].client.rpc("request_candidate_cancellation", {
          p_request_id: requestId,
          p_day_ids: mDays.map((d) => d.id),
          p_reason_code: "other",
          p_reason_text: "",
          p_evidence_choice: "provided",
        });
      const w = await cancel();
      const cycle = await cycleOf(job.jobId);
      return {
        jobId: job.jobId,
        dayId,
        apps,
        cycle,
        cancelError: w.error?.message ?? null,
        cancel,
        s,
        keptDays,
      };
    };

    // ── P. Préférence ─────────────────────────────────────────────
    {
      const get = await http(
        "GET",
        "/api/me/replacement-email-alerts",
        sess.r1.cookie,
      );
      const company = await http(
        "GET",
        "/api/me/replacement-email-alerts",
        A.cookie,
      );
      const anon = await http("GET", "/api/me/replacement-email-alerts", null);
      report(
        "P1 lecture : désactivée par défaut, adresse confirmée, envoi non annoncé ; entreprise et anonyme refusés",
        get.status === 200 &&
          get.body.enabled === false &&
          get.body.emailConfirmed === true &&
          get.body.deliveryActive === false &&
          company.status === 403 &&
          anon.status === 401,
        { get: get.body, company: company.status, anon: anon.status },
      );
      const noText = await pref("r1", { enabled: true });
      const wrong = await pref("r1", { enabled: true, consentVersion: "v0" });
      const direct = await sess.r1.client.rpc("set_replacement_email_alerts", {
        p_enabled: true,
        p_consent_version: "v0",
      });
      const companySet = await pref("a", {
        enabled: true,
        consentVersion: REPLACEMENT_EMAIL_CONSENT_VERSION,
      });
      report(
        "P2 activation sans texte accepté refusée (route et appel direct) ; entreprise refusée",
        noText.status === 400 &&
          wrong.status === 400 &&
          direct.error?.message === "consent_required" &&
          companySet.status === 403,
        {
          noText: noText.body,
          wrong: wrong.status,
          direct: direct.error?.message,
          companySet: companySet.status,
        },
      );
      const on = await optIn("r1");
      const again = await optIn("r1");
      const { count } = await serviceClient
        .from("replacement_email_preference_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid.r1);
      report(
        "P3 activation explicite enregistrée et historisée une fois (relance sans effet)",
        on.status === 200 &&
          on.body.enabled === true &&
          on.body.changed === true &&
          again.body.changed === false &&
          count === 1,
        { on: on.body, again: again.body, count },
      );
      await proofRpc("proof_17d4b_email_confirmed", {
        p_user: uid.r6,
        p_ok: false,
      });
      const noMail = await optIn("r6");
      const view = await http(
        "GET",
        "/api/me/replacement-email-alerts",
        sess.r6.cookie,
      );
      await proofRpc("proof_17d4b_email_confirmed", {
        p_user: uid.r6,
        p_ok: true,
      });
      report(
        "P4 adresse non confirmée : activation refusée (email_missing)",
        noMail.status === 409 &&
          noMail.body.code === "email_missing" &&
          view.body.emailConfirmed === false,
        { noMail: noMail.body, view: view.body },
      );
      const sessWrite = await sess.r2.client
        .from("replacement_email_preferences" as never)
        .insert({ user_id: uid.r2, enabled: true } as never);
      const svcWrite = await serviceClient
        .from("replacement_email_preferences")
        .insert({
          user_id: uid.r2,
          enabled: true,
          enabled_at: new Date().toISOString(),
          consent_version: "x",
        });
      report(
        "P5 préférence jamais écrite directement (session, clé service)",
        Boolean(sessWrite.error) && Boolean(svcWrite.error),
        { session: sessWrite.error?.code, service: svcWrite.error?.code },
      );
      for (const k of ["r2", "r4", "r5", "r6"] as K[]) {
        const r = await optIn(k);
        if (r.status !== 200) throw new Error(`optIn ${k}: ${r.status}`);
      }
    }

    // ── Q. Intention (ANN-14) et D. envoi simulé ──────────────────
    const Q = await openCycle(
      "Intention",
      ["r1", "r2", "r3", "r4"],
      async (apps, jobId) => {
        await A.client
          .from("job_applications")
          .update({ status: "rejected" })
          .eq("id", apps.r2);
        const del = await http(
          "DELETE",
          `/api/jobs/${jobId}/apply?application=${apps.r4}`,
          sess.r4.cookie,
        );
        if (del.status !== 200) throw new Error(`withdraw r4: ${del.status}`);
      },
    );
    {
      const rows = await outboxOf(Q.cycle.id);
      const users = rows.map((r) => r.user_id).sort();
      const intent = Object.fromEntries(
        Q.cycle.notices.map((n) => [n.user, n.intent]),
      );
      report(
        "Q1 file : candidats d'ANN-14 ayant activé l'e-mail (en attente, refusé) ; ni l'entreprise, ni le candidat sans préférence, ni la candidature retirée, ni le désisté",
        Q.cancelError === null &&
          JSON.stringify(users) === JSON.stringify([uid.r1, uid.r2].sort()) &&
          rows.every((r) => r.status === "pending" && r.attempts === 0) &&
          intent[uid.r1] === true &&
          intent[uid.r2] === true &&
          intent[uid.r3] === false &&
          intent[idA] === false &&
          !(uid.r4 in intent) &&
          (await notifCount(uid.r3, Q.jobId)) === 1 &&
          (await notifCount(idA, Q.jobId)) === 1,
        { users: rows.length, intent: Object.values(intent) },
      );
      await optIn("r3");
      await sweep();
      const after = await outboxOf(Q.cycle.id);
      report(
        "Q2 aucun consentement rétroactif : activation après l'avis, aucune ligne pour ce cycle",
        after.length === 2 && !after.some((r) => r.user_id === uid.r3),
        { rows: after.length },
      );
      const replay = await Q.cancel();
      const again = await outboxOf(Q.cycle.id);
      report(
        "Q3 relance du même désistement : aucune ligne ni avis en double",
        !replay.error &&
          again.length === 2 &&
          (await notifCount(uid.r1, Q.jobId)) === 1,
        { error: replay.error?.message, rows: again.length },
      );

      const { summary, fake } = await dispatch();
      const sent = await outboxOf(Q.cycle.id);
      report(
        "D1 envoi simulé : deux messages acceptés, clé stable, identifiant du fournisseur, paramètres de rendu effacés",
        summary.accepted >= 2 &&
          sent.every(
            (r) =>
              r.status === "accepted" &&
              r.attempts === 1 &&
              r.render === null &&
              fake.deliveries.some(
                (d) =>
                  d.key === `replacement-alert/${r.id}` &&
                  d.providerId === r.provider_message_id,
              ),
          ),
        { summary, rows: sent.map((r) => [r.status, r.attempts]) },
      );
      const second = await dispatch();
      report(
        "D2 nouveau passage : aucun renvoi d'un message accepté",
        second.fake.calls === 0 && second.summary.claimed === 0,
        second.summary,
      );
    }

    // ── F. Panne de la mise en file ───────────────────────────────
    {
      for (const sql of FAIL_TRIGGER) execSql(sql);
      let F: Awaited<ReturnType<typeof openCycle>>;
      try {
        F = await openCycle("Panne file", ["r1"]);
      } finally {
        execSql(
          "drop trigger if exists proof_17d4b_fail_outbox on public.replacement_email_outbox",
        );
      }
      // Sans cycle (désistement annulé par la panne), F1 et F2 échouent.
      const fc = F.cycle as CycleView | null;
      const rows = fc ? await outboxOf(fc.id) : [];
      report(
        "F1 file en panne : désistement enregistré, cycle ouvert, avis émis, intention conservée, échec tracé",
        F.cancelError === null &&
          fc !== null &&
          fc.state === "open" &&
          (await notifCount(uid.r1, F.jobId)) === 1 &&
          fc.notices.some((n) => n.user === uid.r1 && n.intent) &&
          rows.length === 0 &&
          (fc.events ?? []).includes("email_enqueue_failed"),
        {
          cancel: F.cancelError,
          cycle: Boolean(fc),
          rows: rows.length,
          events: fc?.events,
        },
      );
      await sweep();
      await sweep();
      const rec = fc ? await outboxOf(fc.id) : [];
      const c2 = fc ? await cycleOf(F.jobId) : null;
      report(
        "F2 balayage : intention reprise une fois (aucune perte silencieuse, aucun doublon)",
        rec.length === 1 &&
          rec[0].user_id === uid.r1 &&
          (c2?.events ?? []).filter((e) => e === "email_enqueue_recovered")
            .length === 1,
        { rows: rec.length, events: c2?.events },
      );
      await dispatch();
    }

    // ── U. Issue incertaine ───────────────────────────────────────
    {
      const U = await openCycle("Réponse perdue", ["r5"]);
      const lost = await dispatch(["accept_lost"]);
      const r1 = (await rowOf(U.cycle.id, "r5"))!;
      report(
        "U1 réponse perdue : en attente, issue incertaine notée, reprise différée",
        lost.summary.uncertain === 1 &&
          r1.status === "pending" &&
          r1.uncertain_since !== null &&
          r1.attempts === 1 &&
          r1.render !== null &&
          new Date(r1.next_attempt_at).getTime() > Date.now(),
        { status: r1.status, code: r1.status_code },
      );
      await due(r1.id);
      const retry = await dispatch([], lost.fake);
      const r2 = (await rowOf(U.cycle.id, "r5"))!;
      report(
        "U2 reprise avec la même clé : acceptée, un seul envoi chez le fournisseur, même identifiant",
        retry.summary.accepted === 1 &&
          r2.status === "accepted" &&
          lost.fake.deliveries.filter(
            (d) => d.key === `replacement-alert/${r1.id}`,
          ).length === 1 &&
          r2.provider_message_id === lost.fake.deliveries[0].providerId,
        { status: r2.status, deliveries: lost.fake.deliveries.length },
      );

      const U2 = await openCycle("Bail expiré", ["r6"]);
      const claim = await serviceClient.rpc("replacement_email_claim", {
        p_limit: 5,
        p_lease_seconds: 60,
      });
      const first = (claim.data ?? []).find((c) => c.to_email === mail("r6"));
      const row = (await rowOf(U2.cycle.id, "r6"))!;
      // Arrêt entre la revendication et l'appel : aucun appel n'a eu lieu.
      await setRow(row.id, {
        lease_until: new Date(Date.now() - 1000).toISOString(),
      });
      await sweep();
      const noCall = (await rowOf(U2.cycle.id, "r6"))!;
      await due(row.id);
      const again = await serviceClient.rpc("replacement_email_claim", {
        p_limit: 5,
        p_lease_seconds: 60,
      });
      const mine = (again.data ?? []).find((c) => c.to_email === mail("r6"));
      const gate = await serviceClient.rpc("replacement_email_presend", {
        p_outbox_id: row.id,
        p_lease_token: mine!.lease_token,
        p_payload_digest: DIGEST,
      });
      // Arrêt pendant l'appel (après le contrôle final) : issue incertaine.
      await setRow(row.id, {
        lease_until: new Date(Date.now() - 1000).toISOString(),
      });
      await sweep();
      const expired = (await rowOf(U2.cycle.id, "r6"))!;
      report(
        "U3 bail expiré : sans appel, rien d'incertain ni de compté ; pendant un appel, issue incertaine reprise plus tard avec la même clé",
        Boolean(first) &&
          noCall.status === "pending" &&
          noCall.uncertain_since === null &&
          noCall.attempts === 0 &&
          gate.data === "ok" &&
          mine!.idempotency_key === `replacement-alert/${row.id}` &&
          expired.status === "pending" &&
          expired.uncertain_since !== null &&
          expired.attempts === 1 &&
          expired.lease_until === null &&
          expired.status_code === "lease_expired",
        {
          noCall: [noCall.uncertain_since, noCall.attempts],
          gate: gate.data ?? gate.error?.message,
          status: expired.status,
          code: expired.status_code,
        },
      );
      const stale = await serviceClient.rpc("replacement_email_record", {
        p_outbox_id: row.id,
        p_lease_token: randomUUID(),
        p_outcome: "uncertain",
        p_code: "timeout",
      });
      report(
        "U4 issue d'un bail périmé ignorée (aucune écriture)",
        stale.data === "stale_lease",
        stale.data ?? stale.error?.message,
      );
      const oldFirst = await proofRpc<string>("proof_17d4b_now_plus", {
        p: "-23:00:01",
      });
      await setRow(row.id, {
        first_attempt_at: oldFirst,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      });
      const window = await dispatch();
      const unknown = (await rowOf(U2.cycle.id, "r6"))!;
      report(
        "U5 fenêtre d'idempotence dépassée (23 h, marge sur 24 h) : état « inconnu », aucune relance aveugle",
        window.fake.calls === 0 &&
          unknown.status === "unknown" &&
          unknown.status_code === "idempotency_window_elapsed" &&
          unknown.render === null,
        { calls: window.fake.calls, status: unknown.status },
      );
      const late = await serviceClient.rpc("replacement_email_record", {
        p_outbox_id: row.id,
        p_lease_token: mine!.lease_token,
        p_outcome: "accepted",
        p_provider_id: "late-proof-id",
      });
      const fact = (await rowOf(U2.cycle.id, "r6"))!;
      report(
        "U6 acceptation tardive avérée : enregistrée comme fait (inconnu → accepté)",
        late.data === "applied" &&
          fact.status === "accepted" &&
          fact.provider_message_id === "late-proof-id",
        { r: late.data, status: fact.status },
      );
    }

    // ── U7–U9. Reprise : même clé et même contenu, sinon refus ─────
    {
      // U7 : langue changée entre deux tentatives → paramètres figés.
      const L = await openCycle("Langue figée", ["r4"]);
      const lost = await dispatch(["accept_lost"]);
      const l1 = (await rowOf(L.cycle.id, "r4"))!;
      await serviceClient
        .from("users")
        .update({ locale: "en" })
        .eq("id", uid.r4);
      await due(l1.id);
      const retry = await dispatch([], lost.fake);
      await serviceClient
        .from("users")
        .update({ locale: "fr" })
        .eq("id", uid.r4);
      const l2 = (await rowOf(L.cycle.id, "r4"))!;
      const sent = lost.fake.deliveries.filter(
        (d) => d.key === `replacement-alert/${l1.id}`,
      );
      report(
        "U7 langue du candidat changée après une issue incertaine : reprise avec la même clé et le même contenu (paramètres figés), un seul envoi",
        retry.summary.accepted === 1 &&
          l2.status === "accepted" &&
          sent.length === 1 &&
          /^Une place/.test(sent[0].subject) &&
          l2.payload_digest === null,
        { status: l2.status, subjects: sent.map((d) => d.subject) },
      );

      // U8 : adresse changée entre deux tentatives → reprise refusée.
      const M = await openCycle("Adresse changée", ["r4"]);
      const lost2 = await dispatch(["accept_lost"]);
      const m1 = (await rowOf(M.cycle.id, "r4"))!;
      const original = mail("r4");
      await serviceClient.auth.admin.updateUserById(uid.r4, {
        email: mail("r4-new"),
        email_confirm: true,
      });
      await due(m1.id);
      let refused: Awaited<ReturnType<typeof dispatch>>;
      try {
        refused = await dispatch([], lost2.fake);
      } finally {
        await serviceClient.auth.admin.updateUserById(uid.r4, {
          email: original,
          email_confirm: true,
        });
      }
      const m2 = (await rowOf(M.cycle.id, "r4"))!;
      report(
        "U8 adresse changée après une issue incertaine : reprise incohérente refusée sans appel ni nouvelle clé (état inconnu, payload_changed)",
        refused.summary.payloadChanged === 1 &&
          lost2.fake.calls === 1 &&
          m2.status === "unknown" &&
          m2.status_code === "payload_changed" &&
          m2.payload_digest === null &&
          m2.attempts === 1,
        { summary: refused.summary, status: m2.status, code: m2.status_code },
      );

      // U9 : modèle ou configuration changés (URL de l'application) → refus.
      const N = await openCycle("Configuration changée", ["r4"]);
      const lost3 = await dispatch(["accept_lost"]);
      const n1 = (await rowOf(N.cycle.id, "r4"))!;
      await due(n1.id);
      const other = await dispatchReplacementEmails({
        config: { ...fakeConfig, appUrl: "http://autre.localhost:3100" },
        store,
        transport: lost3.fake,
      });
      const n2 = (await rowOf(N.cycle.id, "r4"))!;
      report(
        "U9 contenu du modèle changé après une issue incertaine : reprise refusée sans appel (payload_changed)",
        other.payloadChanged === 1 &&
          lost3.fake.calls === 1 &&
          n2.status === "unknown" &&
          n2.status_code === "payload_changed",
        { summary: other, status: n2.status },
      );
    }

    // ── R. Concurrence ────────────────────────────────────────────
    let rRows: Outbox[] = [];
    {
      const R = await openCycle("Concurrence", [
        "r1",
        "r2",
        "r3",
        "r4",
        "r5",
        "r6",
      ]);
      const before = await outboxOf(R.cycle.id);
      const fa = fakeTransport();
      const fb = fakeTransport();
      const [a, b] = await Promise.all([
        dispatchReplacementEmails({ config: fakeConfig, store, transport: fa }),
        dispatchReplacementEmails({ config: fakeConfig, store, transport: fb }),
      ]);
      rRows = await outboxOf(R.cycle.id);
      const keysA = new Set(fa.deliveries.map((d) => d.key));
      const overlap = fb.deliveries.filter((d) => keysA.has(d.key)).length;
      report(
        "R1 deux passages simultanés : chaque ligne revendiquée et envoyée une seule fois",
        before.length === 6 &&
          overlap === 0 &&
          fa.deliveries.length + fb.deliveries.length === 6 &&
          a.claimed + b.claimed === 6 &&
          rRows.every((r) => r.status === "accepted" && r.attempts === 1),
        { before: before.length, a: a.claimed, b: b.claimed, overlap },
      );
    }

    // ── C. Fermeture et pertinence ────────────────────────────────
    {
      const C1 = await openCycle("Cycle fermé", ["r1"]);
      await proofRpc("proof_17d4b_close_cycle", {
        p_cycle: C1.cycle.id,
        p_delta: "-1 second",
      });
      await sweep();
      const after = await dispatch();
      const c1 = (await rowOf(C1.cycle.id, "r1"))!;
      report(
        "C1 cycle fermé : aucune nouvelle tentative, annulé avant envoi (cycle_closed)",
        after.fake.calls === 0 &&
          c1.status === "cancelled" &&
          c1.status_code === "cycle_closed" &&
          c1.attempts === 0,
        { status: c1.status, code: c1.status_code },
      );
      const before = (
        await serviceClient
          .from("job_applications")
          .select("id", { count: "exact", head: true })
          .eq("job_id", C1.jobId)
      ).count;
      const page = await appFetch(`${APP_URL}/jobs/${C1.jobId}`, {
        headers: { Cookie: sess.r1.cookie },
        redirect: "manual",
      });
      await page.text();
      const afterCount = (
        await serviceClient
          .from("job_applications")
          .select("id", { count: "exact", head: true })
          .eq("job_id", C1.jobId)
      ).count;
      const view = await sess.r1.client.rpc("job_replacement_cycles", {
        p_job_id: C1.jobId,
      });
      const late = await confirm("r1", C1.cycle.id);
      report(
        "C2 lien d'un message arrivé après la fermeture : l'offre s'ouvre, ne crée rien, relit l'état (fermé) ; confirmation refusée",
        page.status === 200 &&
          before === afterCount &&
          view.data?.[0]?.state === "closed" &&
          late.status === 409 &&
          late.body.code === "replacement_closed",
        {
          page: page.status,
          before,
          afterCount,
          state: view.data?.[0]?.state,
          late: late.body.code,
        },
      );

      const C3 = await openCycle("Place pourvue", ["r1", "r2"]);
      const cf = await confirm("r2", C3.cycle.id);
      const app = (
        await serviceClient
          .from("job_applications")
          .select("id")
          .eq("replacement_cycle_id", C3.cycle.id)
          .eq("candidate_id", prof.r2)
          .single()
      ).data!;
      const sel = await signAndSelectRpc(A.client, app.id);
      const filled = await dispatch();
      const c3a = (await rowOf(C3.cycle.id, "r1"))!;
      const c3b = (await rowOf(C3.cycle.id, "r2"))!;
      report(
        "C3 place pourvue avant l'envoi : rien n'est envoyé (cycle_filled)",
        cf.status === 200 &&
          !sel.error &&
          filled.fake.calls === 0 &&
          c3a.status === "cancelled" &&
          c3a.status_code === "cycle_filled" &&
          c3b.status === "cancelled",
        { a: c3a.status_code, b: c3b.status_code, sel: sel.error?.message },
      );

      const C4 = await openCycle("Intérêt confirmé", ["r1"]);
      await confirm("r1", C4.cycle.id);
      const conf = await dispatch();
      const c4 = (await rowOf(C4.cycle.id, "r1"))!;
      report(
        "C4 intérêt déjà confirmé dans l'application : e-mail sans objet, annulé (already_confirmed)",
        conf.fake.calls === 0 &&
          c4.status === "cancelled" &&
          c4.status_code === "already_confirmed",
        { code: c4.status_code },
      );

      const C5 = await openCycle(
        "Date annulée",
        ["r1"],
        undefined,
        undefined,
        true,
      );
      const cc = await A.client.rpc("request_company_cancellation", {
        p_request_id: randomUUID(),
        p_job_id: C5.jobId,
        p_day_ids: C5.keptDays,
        p_reason: "Événement annulé par le client final.",
        p_acknowledge_late: true,
      });
      await sweep();
      const dc = await dispatch();
      const c5 = (await rowOf(C5.cycle.id, "r1"))!;
      report(
        "C5 date annulée par l'entreprise : annulé avant envoi (date_cancelled)",
        !cc.error &&
          dc.fake.calls === 0 &&
          c5.status === "cancelled" &&
          c5.status_code === "date_cancelled",
        { cc: cc.error?.message, code: c5.status_code },
      );

      const C6 = await openCycle("Inéligible", ["r4"]);
      await proofRpc("proof_17d4b_cni", {
        p_profile: prof.r4,
        p_date: "2020-01-01",
      });
      const inel = await dispatch();
      await proofRpc("proof_17d4b_cni", {
        p_profile: prof.r4,
        p_date: "2033-01-01",
      });
      const c6 = (await rowOf(C6.cycle.id, "r4"))!;
      report(
        "C6 destinataire devenu inéligible (CNI expirée) : annulé avant envoi, sans motif détaillé",
        inel.fake.calls === 0 &&
          c6.status === "cancelled" &&
          c6.status_code === "recipient_ineligible",
        { code: c6.status_code },
      );
    }

    // ── C7–C8. Fermeture : contrôle final et course résiduelle ────
    {
      const C7 = await openCycle("Fermeture pendant le passage", ["r1"]);
      const fake7 = fakeTransport();
      const s7 = await dispatchReplacementEmails({
        config: fakeConfig,
        store: storeWith(() =>
          proofRpc("proof_17d4b_close_cycle", {
            p_cycle: C7.cycle.id,
            p_delta: "-1 second",
          }),
        ),
        transport: fake7,
      });
      const c7 = (await rowOf(C7.cycle.id, "r1"))!;
      report(
        "C7 cycle fermé entre la revendication et l'appel : contrôle final au plus près de l'appel, aucun appel (cycle_closed)",
        s7.claimed >= 1 &&
          fake7.calls === 0 &&
          c7.status === "cancelled" &&
          c7.status_code === "cycle_closed" &&
          c7.attempts === 0,
        { summary: s7, status: c7.status, code: c7.status_code },
      );

      const C8 = await openCycle("Course résiduelle", ["r1"]);
      const fake8 = fakeTransport();
      await dispatchReplacementEmails({
        config: fakeConfig,
        store,
        transport: transportWith(fake8, {
          before: () =>
            proofRpc("proof_17d4b_close_cycle", {
              p_cycle: C8.cycle.id,
              p_delta: "-1 second",
            }),
        }),
      });
      const c8 = (await rowOf(C8.cycle.id, "r1"))!;
      const late8 = await confirm("r1", C8.cycle.id);
      const view8 = await sess.r1.client.rpc("job_replacement_cycles", {
        p_job_id: C8.jobId,
      });
      report(
        "C8 course résiduelle : cycle fermé pendant l'appel déjà autorisé → message accepté après la fermeture (tracé) ; le lien relit l'état (fermé) et la confirmation est refusée",
        fake8.deliveries.length === 1 &&
          c8.status === "accepted" &&
          view8.data?.[0]?.state === "closed" &&
          late8.status === 409 &&
          late8.body.code === "replacement_closed",
        {
          status: c8.status,
          state: view8.data?.[0]?.state,
          late: late8.body.code,
        },
      );
    }

    // ── W. Retrait du consentement ────────────────────────────────
    {
      const W = await openCycle("Retrait", ["r1"]);
      const off = await optOut("r1");
      const w1 = (await rowOf(W.cycle.id, "r1"))!;
      const none = await dispatch();
      report(
        "W1 désactivation : message pas encore transmis annulé (opted_out), rien n'est envoyé",
        off.status === 200 &&
          off.body.enabled === false &&
          w1.status === "cancelled" &&
          w1.status_code === "opted_out" &&
          none.fake.calls === 0,
        { off: off.body, code: w1.status_code },
      );
      await optIn("r1");
      await sweep();
      const w2 = await outboxOf(W.cycle.id);
      const W2 = await openCycle("Après réactivation", ["r1"]);
      report(
        "W2 réactivation : aucun message rétroactif ; les cycles suivants sont concernés",
        w2.length === 1 &&
          w2[0].status === "cancelled" &&
          (await outboxOf(W2.cycle.id)).length === 1,
        { old: w2.map((r) => r.status) },
      );
      await dispatch();

      const W3 = await openCycle("Retrait pendant l'envoi", ["r2"]);
      const claim = await serviceClient.rpc("replacement_email_claim", {
        p_limit: 5,
        p_lease_seconds: 120,
      });
      const lease = (claim.data ?? []).find((c) => c.to_email === mail("r2"))!;
      const w3gate = await serviceClient.rpc("replacement_email_presend", {
        p_outbox_id: lease.outbox_id,
        p_lease_token: lease.lease_token,
        p_payload_digest: DIGEST,
      });
      await optOut("r2");
      const mid = (await rowOf(W3.cycle.id, "r2"))!;
      await serviceClient.rpc("replacement_email_record", {
        p_outbox_id: lease.outbox_id,
        p_lease_token: lease.lease_token,
        p_outcome: "accepted",
        p_provider_id: "proof-inflight-1",
      });
      const done = (await rowOf(W3.cycle.id, "r2"))!;
      report(
        "W3 retrait pendant une tentative en cours : la tentative n'est pas niée, son issue est enregistrée",
        w3gate.data === "ok" &&
          mid.status === "pending" &&
          mid.in_flight &&
          done.status === "accepted",
        { gate: w3gate.data, mid: mid.status, done: done.status },
      );
      await optIn("r2");
    }

    // ── A. ANN-22 ─────────────────────────────────────────────────
    {
      let A1: Awaited<ReturnType<typeof openCycle>> | undefined;
      let withheld: Record<string, unknown> = {};
      try {
        A1 = await openCycle(
          "Dossier invalide",
          ["r1"],
          undefined,
          async () => {
            await serviceClient
              .from("company_profiles")
              .update({ verification_status: "pending" })
              .eq("id", coA);
          },
        );
        await sweep();
        withheld = {
          cancel: A1.cancelError,
          notices: A1.cycle.notices.length,
          rows: (await outboxOf(A1.cycle.id)).length,
          inApp: await notifCount(uid.r1, A1.jobId),
          events: A1.cycle.events,
        };
      } finally {
        await approveCompanyDossier(serviceClient, coA);
      }
      report(
        "A1 dossier non valide à l'ouverture : aucun avis ni e-mail (ANN-22), désistement enregistré",
        withheld.cancel === null &&
          withheld.notices === 0 &&
          withheld.rows === 0 &&
          withheld.inApp === 0 &&
          ((withheld.events as string[] | null) ?? []).includes(
            "alerts_withheld",
          ),
        withheld,
      );
      await sweep();
      await sweep();
      const resumed = await cycleOf(A1!.jobId);
      const rows = await outboxOf(A1!.cycle.id);
      const sent = await dispatch();
      report(
        "A2 revalidation : avis et e-mail encore pertinents, une fois (deux balayages), fenêtre inchangée",
        rows.length === 1 &&
          (await notifCount(uid.r1, A1!.jobId)) === 1 &&
          resumed.notices.filter((n) => n.kind === "candidate_alert").length ===
            1 &&
          resumed.closes_at === A1!.cycle.closes_at &&
          sent.summary.accepted === 1,
        { rows: rows.length, events: resumed.events },
      );

      const A3 = await openCycle("Suspension pendant la file", ["r1"]);
      let deferred: Outbox | undefined;
      let calls = -1;
      try {
        await serviceClient
          .from("users")
          .update({ is_active: false })
          .eq("id", idA);
        const d = await dispatch();
        calls = d.fake.calls;
        deferred = await rowOf(A3.cycle.id, "r1");
      } finally {
        await serviceClient
          .from("users")
          .update({ is_active: true })
          .eq("id", idA);
      }
      report(
        "A3 compte suspendu avant l'envoi : message retenu (aucune tentative comptée), en attente du rétablissement",
        calls === 0 &&
          deferred?.status === "pending" &&
          deferred.attempts === 0 &&
          deferred.status_code === "company_unavailable",
        { calls, status: deferred?.status, code: deferred?.status_code },
      );
      await due(deferred!.id);
      const back = await dispatch();
      const a3 = (await rowOf(A3.cycle.id, "r1"))!;
      report(
        "A4 suspension levée : message envoyé une fois",
        back.summary.accepted === 1 &&
          a3.status === "accepted" &&
          a3.attempts === 1,
        { status: a3.status },
      );

      const A5 = await openCycle("Fermeture pendant la suspension", ["r1"]);
      try {
        await serviceClient
          .from("users")
          .update({ is_active: false })
          .eq("id", idA);
        await dispatch();
        await proofRpc("proof_17d4b_close_cycle", {
          p_cycle: A5.cycle.id,
          p_delta: "-1 second",
        });
        await sweep();
      } finally {
        await serviceClient
          .from("users")
          .update({ is_active: true })
          .eq("id", idA);
      }
      await sweep();
      const a5 = (await rowOf(A5.cycle.id, "r1"))!;
      const after = await dispatch();
      report(
        "A5 cycle fermé pendant la suspension : aucune prolongation, rien n'est envoyé au rétablissement",
        a5.status === "cancelled" &&
          a5.status_code === "cycle_closed" &&
          after.fake.calls === 0,
        { status: a5.status, code: a5.status_code },
      );
    }

    // ── E. Événements du fournisseur ──────────────────────────────
    {
      const [q1, q2] = (await outboxOf(Q.cycle.id)).sort((a, b) =>
        a.user_id.localeCompare(b.user_id),
      );
      const ev = (
        id: string,
        type: string,
        at: string,
        providerId: string | null,
        outboxId: string | null,
      ) =>
        serviceClient.rpc("replacement_email_provider_event", {
          p_event_id: id,
          p_type: type,
          p_occurred_at: at,
          p_provider_id: providerId ?? undefined,
          p_outbox_id: outboxId ?? undefined,
        });
      const t = (min: number) =>
        new Date(Date.now() + min * 60_000).toISOString();
      const e1 = await ev(
        `msg_${suffix}_1`,
        "email.delivered",
        t(1),
        q1.provider_message_id,
        q1.id,
      );
      const e1b = await ev(
        `msg_${suffix}_1`,
        "email.delivered",
        t(1),
        q1.provider_message_id,
        q1.id,
      );
      const s1 = (await outboxOf(Q.cycle.id)).find((r) => r.id === q1.id)!;
      report(
        "E1 livré : appliqué ; même événement reçu deux fois traité une fois",
        e1.data === "applied" &&
          e1b.data === "duplicate" &&
          s1.status === "delivered" &&
          s1.delivered_at !== null,
        { e1: e1.data, e1b: e1b.data, status: s1.status },
      );
      const e2a = await ev(
        `msg_${suffix}_2`,
        "email.delivered",
        t(3),
        q2.provider_message_id,
        q2.id,
      );
      const e2b = await ev(
        `msg_${suffix}_3`,
        "email.sent",
        t(2),
        q2.provider_message_id,
        q2.id,
      );
      const e5 = await ev(
        `msg_${suffix}_4`,
        "email.opened",
        t(4),
        q2.provider_message_id,
        q2.id,
      );
      const s2 = (await outboxOf(Q.cycle.id)).find((r) => r.id === q2.id)!;
      report(
        "E2 désordre : « livré » reçu avant « accepté » ; aucun retour en arrière ; ouverture ignorée (lecture jamais déduite)",
        e2a.data === "applied" &&
          e2b.data === "ignored_stale" &&
          e5.data === "ignored_type" &&
          s2.status === "delivered",
        { e2a: e2a.data, e2b: e2b.data, e5: e5.data, status: s2.status },
      );
      const [b1] = rRows;
      const e4a = await ev(
        `msg_${suffix}_5`,
        "email.bounced",
        t(5),
        b1.provider_message_id,
        b1.id,
      );
      const e4b = await ev(
        `msg_${suffix}_6`,
        "email.delivered",
        t(4),
        b1.provider_message_id,
        b1.id,
      );
      const s4 = (
        await serviceClient
          .from("replacement_email_outbox")
          .select("*")
          .eq("id", b1.id)
          .single()
      ).data!;
      report(
        "E3 rebond après acceptation : échec (bounced) ; « livré » plus ancien reçu ensuite ignoré",
        e4a.data === "applied" &&
          e4b.data === "ignored_stale" &&
          s4.status === "failed" &&
          s4.status_code === "bounced",
        { a: e4a.data, b: e4b.data, status: s4.status },
      );
      // Corrélation par l'étiquette seule (réponse perdue) : ligne en attente.
      const T = await openCycle("Étiquette", ["r5"]);
      await dispatch(["accept_lost"]);
      const pend = (await rowOf(T.cycle.id, "r5"))!;
      const e6 = await ev(
        `msg_${suffix}_7`,
        "email.sent",
        t(1),
        "tag-only-proof",
        pend.id,
      );
      const s6 = (await rowOf(T.cycle.id, "r5"))!;
      const e7 = await ev(
        `msg_${suffix}_8`,
        "email.delivered",
        t(2),
        "autre-identifiant",
        pend.id,
      );
      const e8 = await ev(
        `msg_${suffix}_9`,
        "email.delivered",
        t(2),
        "inconnu-proof",
        null,
      );
      const e9 = await ev("id invalide !", "email.delivered", t(2), null, null);
      const parasites4 = await proofRpc<number>("proof_17d4b_events", {
        p_ids: [`msg_${suffix}_8`, `msg_${suffix}_9`],
      });
      report(
        "E4 réponse perdue puis événement (étiquette et identifiant libre) : lié et accepté ; identifiant contradictoire, message sans étiquette ignorés sans ligne ; identifiant invalide refusé",
        e6.data === "applied" &&
          s6.status === "accepted" &&
          s6.provider_message_id === "tag-only-proof" &&
          e7.data === "ignored_mismatch" &&
          e8.data === "ignored_unmatched" &&
          parasites4 === 0 &&
          e9.error?.message === "invalid_event",
        {
          e6: e6.data,
          e7: e7.data,
          e8: e8.data,
          parasites4,
          e9: e9.error?.message,
        },
      );

      // E8 : événement reçu avant l'enregistrement de la réponse HTTP.
      const H = await openCycle("Événement en avance", ["r6"]);
      const fakeH = fakeTransport();
      let early: string | null = null;
      await dispatchReplacementEmails({
        config: fakeConfig,
        store,
        transport: transportWith(fakeH, {
          after: async (o) => {
            const hRow = (await rowOf(H.cycle.id, "r6"))!;
            const r = await ev(
              `msg_${suffix}_early`,
              "email.delivered",
              t(1),
              o.kind === "accepted" ? o.providerId : null,
              hRow.id,
            );
            early = (r.data as string | null) ?? r.error?.message ?? null;
          },
        }),
      });
      const h = (await rowOf(H.cycle.id, "r6"))!;
      report(
        "E8 webhook reçu avant la réponse HTTP : lié à l'envoi en vol, livré ; la réponse enregistrée ensuite ne fait pas reculer l'état",
        early === "applied" &&
          h.status === "delivered" &&
          h.provider_message_id === fakeH.deliveries[0]?.providerId &&
          !h.in_flight &&
          h.lease_until === null,
        { early, status: h.status },
      );

      // E9 : étiquette d'une ligne jamais tentée ; E10 : identifiant d'une
      // autre alerte ; aucun ne modifie une alerte ni n'écrit une ligne.
      const neverTried = (
        await serviceClient
          .from("replacement_email_outbox")
          .select("*")
          .eq("status", "cancelled")
          .eq("attempts", 0)
          .limit(1)
          .single()
      ).data!;
      const e10 = await ev(
        `msg_${suffix}_never`,
        "email.sent",
        t(1),
        "jamais-tente",
        neverTried.id,
      );
      const uRow = (
        await serviceClient
          .from("replacement_email_outbox")
          .select("*")
          .eq("status", "unknown")
          .is("provider_message_id", null)
          .gt("attempts", 0)
          .limit(1)
          .single()
      ).data!;
      const e11 = await ev(
        `msg_${suffix}_cross`,
        "email.delivered",
        t(1),
        q1.provider_message_id,
        uRow.id,
      );
      const after9 = (
        await serviceClient
          .from("replacement_email_outbox")
          .select("id, status, provider_message_id")
          .in("id", [neverTried.id, uRow.id])
      ).data!;
      const parasites9 = await proofRpc<number>("proof_17d4b_events", {
        p_ids: [`msg_${suffix}_never`, `msg_${suffix}_cross`],
      });
      report(
        "E9 étiquette d'une alerte jamais tentée, identifiant d'une autre alerte : ignorés, aucune alerte modifiée, aucune ligne écrite",
        e10.data === "ignored_unmatched" &&
          e11.data === "ignored_mismatch" &&
          parasites9 === 0 &&
          after9.every(
            (r) =>
              r.provider_message_id === null &&
              (r.id === neverTried.id
                ? r.status === "cancelled"
                : r.status === "unknown"),
          ),
        { e10: e10.data, e11: e11.data, parasites9, after9 },
      );

      // Route : signature vérifiée sur le corps brut, puis dédoublonnage.
      const body = JSON.stringify({
        type: "email.delivered",
        created_at: t(6),
        data: {
          email_id: s6.provider_message_id,
          tags: { outbox_id: pend.id, kind: "replacement_alert" },
        },
      });
      const evId = `msg_${suffix}_route`;
      const unsigned = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        {},
        body,
      );
      const tampered = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        signWebhook(evId, body),
        body.replace("email.delivered", "email.bounced"),
      );
      const stale = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        signWebhook(evId, body, Math.floor(Date.now() / 1000) - 3600),
        body,
      );
      const ok = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        signWebhook(evId, body),
        body,
      );
      const dup = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        signWebhook(evId, body),
        body,
      );
      const s7 = (await rowOf(T.cycle.id, "r5"))!;
      report(
        "E5 route : sans signature, corps modifié ou horodatage ancien refusés (401) ; événement signé appliqué ; renvoi dédoublonné",
        unsigned.status === 401 &&
          tampered.status === 401 &&
          stale.status === 401 &&
          ok.status === 200 &&
          ok.body.effect === "applied" &&
          dup.status === 200 &&
          dup.body.effect === "duplicate" &&
          s7.status === "delivered",
        {
          unsigned: unsigned.status,
          tampered: tampered.status,
          stale: stale.status,
          ok: ok.body,
          dup: dup.body,
          hint:
            ok.status === 404
              ? "RESEND_WEBHOOK_SECRET de preuve absent du serveur"
              : undefined,
        },
      );

      // Compte Resend partagé avec le SMTP de Supabase Auth : événement
      // authentique d'un e-mail d'authentification (sans étiquette).
      const foreignId = `msg_${suffix}_auth`;
      const foreignBody = JSON.stringify({
        type: "email.delivered",
        created_at: t(7),
        data: { email_id: "auth-mail-proof-1" },
      });
      const foreign = await http(
        "POST",
        "/api/webhooks/resend",
        null,
        undefined,
        signWebhook(foreignId, foreignBody),
        foreignBody,
      );
      const foreignRows = (
        await serviceClient
          .from("replacement_email_provider_events")
          .select("event_id")
          .eq("event_id", foreignId)
      ).data!;
      report(
        "E7 événement d'un e-mail d'authentification (même compte, sans étiquette) : accusé sans aucune écriture",
        foreign.status === 200 &&
          foreign.body.effect === "ignored_foreign" &&
          foreignRows.length === 0,
        {
          status: foreign.status,
          body: foreign.body,
          rows: foreignRows.length,
        },
      );

      const noAuth = await http("POST", "/api/internal/email-outbox", null);
      const authed = await http(
        "POST",
        "/api/internal/email-outbox",
        null,
        undefined,
        {
          Authorization: `Bearer ${PROOF_DISPATCH_SECRET}`,
        },
      );
      const dispatchBody = authed.body.dispatch as
        | Record<string, unknown>
        | undefined;
      report(
        "E6 route interne d'envoi : secret exigé ; serveur de preuve en mode désactivé (aucune revendication, aucun envoi)",
        noAuth.status === 401 &&
          authed.status === 200 &&
          dispatchBody?.mode === "disabled" &&
          dispatchBody?.claimed === 0,
        {
          noAuth: noAuth.status,
          authed: authed.status,
          dispatch: dispatchBody,
        },
      );
    }

    // ── T. Conservation (90 jours) ────────────────────────────────
    {
      const [old, recent] = rRows.slice(1, 3);
      // Une ligne et son intention naissent dans la même transaction : elles
      // vieillissent ensemble (une ligne vieillie seule serait un état
      // impossible, que la reprise recréerait à juste titre).
      await proofRpc("proof_17d4b_notice_age", {
        p_cycle: old.cycle_id,
        p_age: "91 days",
      });
      await setRow(old.id, {
        created_at: await proofRpc<string>("proof_17d4b_now_plus", {
          p: "-91 days",
        }),
      });
      await setRow(recent.id, {
        created_at: await proofRpc<string>("proof_17d4b_now_plus", {
          p: "-89 days",
        }),
      });
      await proofRpc("proof_17d4b_event_age", {
        p_event: `msg_${suffix}_1`,
        p_age: "91 days",
      });
      await sweep();
      const left = (
        await serviceClient
          .from("replacement_email_outbox")
          .select("id")
          .in("id", [old.id, recent.id])
      ).data!.map((r) => r.id);
      const evLeft = (
        await serviceClient
          .from("replacement_email_provider_events")
          .select("event_id")
          .eq("event_id", `msg_${suffix}_1`)
      ).data!;
      report(
        "T1 conservation : lignes d'envoi et événements effacés après 90 jours, plus récents conservés",
        left.length === 1 && left[0] === recent.id && evLeft.length === 0,
        { left: left.length, events: evLeft.length },
      );
    }

    // ── T2–T4. Purge à 90 jours : aucune recréation, webhook tardif sans effet ─
    {
      const P = await openCycle("Purge", ["r1"]);
      await dispatch();
      const p1 = (await rowOf(P.cycle.id, "r1"))!;
      const ago = await proofRpc<string>("proof_17d4b_now_plus", {
        p: "-91 days",
      });
      // Ligne et intention du même âge (créées dans la même transaction).
      await setRow(p1.id, { created_at: ago });
      await proofRpc("proof_17d4b_notice_age", {
        p_cycle: P.cycle.id,
        p_age: "91 days",
      });
      await sweep();
      await sweep();
      const afterPurge = await outboxOf(P.cycle.id);
      const cP = await cycleOf(P.jobId);
      const nothing = await dispatch();
      const lateEv = await serviceClient.rpc(
        "replacement_email_provider_event",
        {
          p_event_id: `msg_${suffix}_late`,
          p_type: "email.delivered",
          p_occurred_at: new Date().toISOString(),
          p_provider_id: p1.provider_message_id ?? undefined,
          p_outbox_id: p1.id,
        },
      );
      const lateRows = await proofRpc<number>("proof_17d4b_events", {
        p_ids: [`msg_${suffix}_late`],
      });
      // Balayages répétés après le webhook tardif.
      await sweep();
      await sweep();
      const afterLate = await outboxOf(P.cycle.id);
      report(
        "T2 envoi purgé (90 jours) avec un cycle encore ouvert et une intention conservée : aucune ligne recréée, aucun envoi ; webhook tardif ignoré sans écriture ni envoi",
        p1.status === "accepted" &&
          cP.state === "open" &&
          cP.notices.some((n) => n.user === uid.r1 && n.intent) &&
          afterPurge.length === 0 &&
          nothing.fake.calls === 0 &&
          lateEv.data === "ignored_unmatched" &&
          lateRows === 0 &&
          afterLate.length === 0,
        {
          purged: afterPurge.length,
          calls: nothing.fake.calls,
          sentSubjects: nothing.fake.deliveries.map((d) => d.subject),
          late: lateEv.data,
          lateRows,
        },
      );

      // T3 : ligne en attente d'un cycle encore ouvert, créée il y a plus de
      // 90 jours (avec son intention) : effacée sans être envoyée ni recréée.
      const K = await openCycle("Ancienne en attente", ["r2"]);
      const k1 = (await rowOf(K.cycle.id, "r2"))!;
      await setRow(k1.id, {
        created_at: ago,
        next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await proofRpc("proof_17d4b_notice_age", {
        p_cycle: K.cycle.id,
        p_age: "91 days",
      });
      await sweep();
      await sweep();
      await sweep();
      const kNone = await dispatch();
      const lateK = await serviceClient.rpc(
        "replacement_email_provider_event",
        {
          p_event_id: `msg_${suffix}_lateK`,
          p_type: "email.sent",
          p_occurred_at: new Date().toISOString(),
          p_provider_id: "proof-late-k",
          p_outbox_id: k1.id,
        },
      );
      await sweep();
      const kAfter = await outboxOf(K.cycle.id);
      const cK = await cycleOf(K.jobId);
      const lateKRows = await proofRpc<number>("proof_17d4b_events", {
        p_ids: [`msg_${suffix}_lateK`],
      });
      report(
        "T3 ligne en attente d'un cycle encore ouvert, créée il y a plus de 90 jours : effacée à 90 jours (aucune prolongation), jamais envoyée ni recréée par les balayages répétés ; webhook tardif ignoré sans écriture",
        cK.state === "open" &&
          kAfter.length === 0 &&
          kNone.fake.calls === 0 &&
          lateK.data === "ignored_unmatched" &&
          lateKRows === 0,
        {
          state: cK.state,
          rows: kAfter.length,
          calls: kNone.fake.calls,
          late: lateK.data,
          lateKRows,
        },
      );

      // T4 : encadrement de la limite de 90 jours (une minute avant : gardée ;
      // une seconde après : effacée).
      const B = await openCycle("Limite 90 jours", ["r4", "r6"]);
      const [bIn, bOut] = await Promise.all([
        rowOf(B.cycle.id, "r4"),
        rowOf(B.cycle.id, "r6"),
      ]);
      await setRow(bIn!.id, {
        created_at: await proofRpc<string>("proof_17d4b_now_plus", {
          p: "-89 days -23 hours -59 minutes",
        }),
        next_attempt_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await setRow(bOut!.id, {
        created_at: await proofRpc<string>("proof_17d4b_now_plus", {
          p: "-90 days -1 second",
        }),
        next_attempt_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await sweep();
      const bLeft = (await outboxOf(B.cycle.id)).map((r) => r.user_id);
      report(
        "T4 limite des 90 jours depuis la création de la ligne : 89 j 23 h 59 min gardée, 90 j et 1 s effacée",
        bLeft.length === 1 && bLeft[0] === uid.r4,
        { left: bLeft.length },
      );
      await proofRpc("proof_17d4b_close_cycle", {
        p_cycle: B.cycle.id,
        p_delta: "-1 second",
      });
      await sweep();
    }

    // ── X. Droits ─────────────────────────────────────────────────
    {
      const tables = [
        "replacement_email_outbox",
        "replacement_email_preferences",
        "replacement_email_preference_events",
        "replacement_email_provider_events",
      ];
      const reads = await Promise.all(
        tables.flatMap((t) => [
          anonClient
            .from(t as never)
            .select("*")
            .limit(1),
          sess.r1.client
            .from(t as never)
            .select("*")
            .limit(1),
        ]),
      );
      const svcInsert = await serviceClient
        .from("replacement_email_outbox")
        .insert({ cycle_id: randomUUID(), user_id: uid.r1 });
      const svcUpdate = await serviceClient
        .from("replacement_email_outbox")
        .update({ status: "delivered" })
        .eq("user_id", uid.r1);
      report(
        "X1 tables fermées aux sessions (lecture) et aux écritures de la clé service",
        reads.every((r) => Boolean(r.error) || (r.data ?? []).length === 0) &&
          Boolean(svcInsert.error) &&
          Boolean(svcUpdate.error),
        {
          reads: reads.map((r) => r.error?.code ?? (r.data ?? []).length),
          ins: svcInsert.error?.code,
          upd: svcUpdate.error?.code,
        },
      );
      const sessionCalls = await Promise.all([
        sess.r1.client.rpc("replacement_email_claim", {
          p_limit: 5,
          p_lease_seconds: 60,
        }),
        sess.r1.client.rpc("replacement_email_record", {
          p_outbox_id: randomUUID(),
          p_lease_token: randomUUID(),
          p_outcome: "accepted",
          p_provider_id: "x",
        }),
        sess.r1.client.rpc("replacement_email_provider_event", {
          p_event_id: "x",
          p_type: "email.delivered",
          p_occurred_at: new Date().toISOString(),
        }),
        sess.r1.client.rpc("replacement_email_sweep"),
        anonClient.rpc("set_replacement_email_alerts", {
          p_enabled: true,
          p_consent_version: REPLACEMENT_EMAIL_CONSENT_VERSION,
        }),
      ]);
      const internal = await (
        serviceClient.rpc as unknown as (
          f: string,
          a: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>
      )("replacement_email_address", { p_user_id: uid.r1 });
      report(
        "X2 revendication, issue, événements et balayage réservés à la clé service ; lecture d'adresse interne à la base",
        sessionCalls.every((r) => Boolean(r.error)) && Boolean(internal.error),
        sessionCalls.map((r) => r.error?.code),
      );
      const cols = await proofRpc<string[]>("proof_17d4b_columns", {});
      report(
        "X3 aucune adresse, aucun objet ni corps stockés dans la file ou les événements",
        !cols.some((c) => /mail|address|subject|body|html|text|phone/i.test(c)),
        cols,
      );
    }
    {
      const jobs = await proofRpc<
        { name: string; schedule: string; command: string }[]
      >("proof_17d4b_cron", {});
      report(
        "X4 balayage SQL planifié par la migration (pg_cron, chaque minute) ; il n'appelle que replacement_email_sweep",
        jobs.length === 1 &&
          jobs[0].schedule === "* * * * *" &&
          /replacement_email_sweep\(\)/.test(jobs[0].command) &&
          !/http|net\./i.test(jobs[0].command),
        jobs,
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

  console.log(`\n${passCount} réussis, ${failCount} en échec`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
