/**
 * Preuve — plan entreprise effectif Free/Premium et gestion administrative
 * tracée (ABO-07, ABO-08, ABO-11 ; docs/product/DECISIONS.md).
 *
 * Fixtures en clé service (entreprises vérifiées, admins ops, fondateur,
 * support, ops suspendu) ; tentatives en sessions RÉELLES (routes avec
 * cookies, RPC avec le JWT) ; état relu en clé service. Reprise des anciens
 * plans : fixtures LOCALES sur une connexion directe (supabase db query),
 * dans une transaction toujours annulée.
 *
 *   P. Plan effectif : règle unique (plan premium ET fin future), Free à
 *      l'échéance exacte, 1 µs avant Premium ; rôle company_premium seul
 *      sans effet ; my_account_state sans lecture de subscriptions.
 *   W. Écritures refusées : entreprise (plan, fin, début, historique,
 *      choix de reprise), tiers, admin_support (lecture seule), ops
 *      suspendu (ancien jeton), anonyme ; historique en ajout seul, clé
 *      service comprise.
 *   G. Activation, prolongation, arrêt par la route (ops, fondateur) :
 *      état, historique, audit, notification sans donnée sensible, aucune
 *      ligne de paiement ; contrôles de période, de motif et d'état lu.
 *   I. Idempotence et concurrence : cinq relances simultanées, deux agents
 *      simultanés, clé réutilisée pour d'autres paramètres.
 *   E. Modification directe d'une offre active (ABO-08) : Premium accepté
 *      (nouvelle modération), Free refusé, échéance exacte, rôle seul
 *      refusé ; autres protections intactes (place pourvue, calendrier
 *      figé, compte suspendu, autre entreprise).
 *   T. Reprise des anciens plans : garde de la migration (texte réel du
 *      fichier) et fonction de reprise : refus sans choix à jour, avec
 *      diagnostic et sans effet ; choix explicite (auteur, motif, fin) ;
 *      choix devenu caduc ; panne en cours de reprise sans effet partiel ;
 *      reprise appliquée (historique, audit, notification) ; relance sans
 *      effet ; aucune conversion implicite.
 *   R. Signaux temps réel réduits à {d, r, id} (entreprise, admin).
 *   A. Fiche admin de l'entreprise : garde commune, admin suspendu refusé.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
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
const PROOF_PASSWORD = "Proof-ABO07-premium-01!";
const PROOF_USER_METADATA = { proofCompanyPremium: true };
const DAY = 86_400_000;

const DB_URL = readLocalDbUrl();
function runSql(sql: string) {
  return runSupabaseQuery(DB_URL, sql, { proof: "company-premium" });
}
function execSql(sql: string): string {
  const r = runSql(sql);
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 400)}`);
  }
  return r.stdout;
}
function queryRows(sql: string): Record<string, unknown>[] {
  const out = execSql(sql);
  const starts = [out.indexOf("["), out.indexOf("{")].filter((i) => i >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = out.lastIndexOf(out[start] === "[" ? "]" : "}");
  if (start < 0 || end < start)
    throw new Error(`sortie : ${out.slice(0, 300)}`);
  const parsed = JSON.parse(out.slice(start, end + 1)) as
    | Record<string, unknown>[]
    | { rows: Record<string, unknown>[] };
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
// Fonctions de preuve temporaires : absentes des types générés.
const serviceRpc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Fonctions temporaires (pile de preuve) ───────────────────────
// État du compte à l'instant exact : fin placée à now() + décalage.
const STATE_FN = `
create or replace function public.proof_abo07_state(p_company uuid, p_user uuid, p_offset interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pile de preuve seulement : fin placée à l'instant voulu, hors du
  -- parcours d'attribution (la garde d'écriture exige cet indicateur).
  perform set_config('easyjob.company_plan_write', 'on', true);
  update public.company_profiles cp
  set subscription_plan = 'premium', subscription_expires_at = now() + p_offset,
      premium_started_at = now() - interval '1 day'
  where cp.id = p_company;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  return jsonb_build_object('state', public.my_account_state());
end;
$$`;

// Modification d'une offre active à l'instant exact de l'échéance.
const EDIT_FN = `
create or replace function public.proof_abo07_edit(
  p_company uuid, p_user uuid, p_job uuid, p_offset interval, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_status text;
begin
  -- Pile de preuve seulement (voir proof_abo07_state).
  perform set_config('easyjob.company_plan_write', 'on', true);
  update public.company_profiles cp
  set subscription_plan = 'premium', subscription_expires_at = now() + p_offset
  where cp.id = p_company;
  perform set_config('easyjob.company_plan_write', 'off', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    perform public.update_job(p_job, p_payload);
  exception when others then
    v_err := sqlerrm;
  end;
  select j.status::text into v_status from public.jobs j where j.id = p_job;
  return jsonb_build_object('error', v_err, 'status', v_status);
end;
$$`;

const MESSAGES_FN = `
create or replace function public.proof_abo07_messages(p_topic text, p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
  from realtime.messages m
  where m.topic = p_topic and m.inserted_at >= p_since;
$$`;

// Écriture brute du plan (pile de preuve seulement, indicateur de la garde
// posé) : remise à zéro d'une fixture et contraintes derrière la garde.
// Renvoie le SQLSTATE de l'erreur, ou « ok ».
const RAW_FN = `
create or replace function public.proof_abo07_raw(
  p_company uuid, p_plan text, p_expires timestamptz, p_started timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('easyjob.company_plan_write', 'on', true);
  update public.company_profiles cp
  set subscription_plan = p_plan, subscription_expires_at = p_expires,
      premium_started_at = p_started
  where cp.id = p_company;
  perform set_config('easyjob.company_plan_write', 'off', true);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$`;

// Reprise des anciens plans : scénario complet dans un bloc toujours
// annulé (aucune trace sur la pile). Appelée en connexion directe
// (session_user postgres : voie de maintenance).
const TRANSITION_FN = `
create or replace function public.proof_abo07_transition(
  p_x uuid, p_y uuid, p_z uuid, p_w uuid, p_ops uuid, p_support uuid)
returns jsonb
language plpgsql
set search_path = ''
as $proof$
declare
  r jsonb := '{}'::jsonb;
  v_detail text;
  v_until timestamptz := date_trunc('second', now()) + interval '30 days';
  v_x_exp timestamptz := date_trunc('second', now()) + interval '60 days';
  v_z_exp timestamptz := date_trunc('second', now()) - interval '5 days';
  v_req_x uuid := gen_random_uuid();
  v_last_y uuid;
  v_n integer;
  v_try text;
begin
  begin
    -- État d'avant la transition, simulé sur la pile de preuve : anciennes
    -- valeurs posées hors parcours (indicateur de la garde d'écriture).
    perform set_config('easyjob.company_plan_write', 'on', true);
    alter table public.company_profiles drop constraint company_profiles_plan_free_premium_chk;
    alter table public.company_profiles drop constraint company_profiles_premium_end_chk;
    update public.company_profiles set subscription_plan = 'pro', subscription_expires_at = v_x_exp where id = p_x;
    update public.company_profiles set subscription_plan = 'business', subscription_expires_at = null where id = p_y;
    update public.company_profiles set subscription_plan = 'starter', subscription_expires_at = v_z_exp where id = p_z;

    -- T1 : aucun choix → refus, diagnostic, aucun effet.
    begin
      perform public.company_plan_transition_apply();
      r := r || jsonb_build_object('t1_error', null);
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      r := r || jsonb_build_object('t1_error', sqlerrm, 't1_detail', v_detail);
    end;
    r := r || jsonb_build_object(
      't1_plans', (select jsonb_object_agg(cp.id, cp.subscription_plan) from public.company_profiles cp where cp.id in (p_x, p_y, p_z)),
      't1_grants', (select count(*) from public.company_premium_grants g where g.company_id in (p_x, p_y, p_z)),
      't1_report', (select jsonb_agg(jsonb_build_object('id', x.company_id, 'ready', x.ready, 'legacy', x.legacy_plan))
                    from public.company_plan_transition_report() x where x.company_id in (p_x, p_y, p_z)));

    -- V : choix refusés (aucune ligne écrite).
    v_try := '';
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'free', null, 'Choix sans auteur désigné.', null);
    exception when others then v_try := v_try || 'a:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'free', null, 'Choix attribué au support.', p_support);
    exception when others then v_try := v_try || 'b:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'premium', null, 'Premium sans date de fin.', p_ops);
    exception when others then v_try := v_try || 'c:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'free', v_until, 'Free avec une date de fin.', p_ops);
    exception when others then v_try := v_try || 'd:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'premium', now() - interval '1 day', 'Premium déjà échu au choix.', p_ops);
    exception when others then v_try := v_try || 'e:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'free', null, 'court', p_ops);
    exception when others then v_try := v_try || 'f:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_x, 'pro', null, 'Ancien plan comme cible.', p_ops);
    exception when others then v_try := v_try || 'g:' || sqlerrm || ';'; end;
    begin perform public.company_plan_requalify(gen_random_uuid(), p_w, 'free', null, 'Compte déjà sur Free.', p_ops);
    exception when others then v_try := v_try || 'h:' || sqlerrm || ';'; end;
    r := r || jsonb_build_object('v_errors', v_try,
      'v_rows', (select count(*) from public.company_plan_requalifications q where q.company_id in (p_x, p_w)));

    -- C : choix explicites ; relance ; clé réutilisée.
    perform public.company_plan_requalify(v_req_x, p_x, 'premium', v_until, 'Compte de test repris en Premium.', p_ops);
    r := r || jsonb_build_object('c_relaunch',
      (select q.already_applied from public.company_plan_requalify(v_req_x, p_x, 'premium', v_until, 'Compte de test repris en Premium.', p_ops) q));
    begin
      perform public.company_plan_requalify(v_req_x, p_x, 'free', null, 'Même clé, autre choix.', p_ops);
      r := r || jsonb_build_object('c_conflict', null);
    exception when others then
      r := r || jsonb_build_object('c_conflict', sqlerrm);
    end;
    perform public.company_plan_requalify(gen_random_uuid(), p_y, 'free', null, 'Compte de test repris en Free.', p_ops);
    -- Plusieurs choix dans la même transaction (created_at identiques) : le
    -- dernier enregistré fait foi.
    for v_n in 1..5 loop
      select q.requalification_id into v_last_y
      from public.company_plan_requalify(gen_random_uuid(), p_y, 'free', null,
             'Choix Y n°' || v_n || ', le plus récent l''emporte.', p_ops) q;
    end loop;
    r := r || jsonb_build_object('c_last_y_ok',
      (select x.requalification_id = v_last_y from public.company_plan_transition_report() x where x.company_id = p_y));
    r := r || jsonb_build_object(
      'c_rows_x', (select count(*) from public.company_plan_requalifications q where q.company_id = p_x),
      'c_row_x', (select jsonb_build_object('legacy', q.legacy_plan, 'legacy_exp', q.legacy_expires_at = v_x_exp,
                    'by', q.decided_by = p_ops, 'role', q.decided_by_role, 'via', q.recorded_via)
                  from public.company_plan_requalifications q where q.company_id = p_x),
      'c_audit', (select count(*) from public.audit_logs a where a.action = 'company_plan_requalification_recorded'
                    and a.metadata ->> 'company_id' in (p_x::text, p_y::text)),
      'c_plans', (select jsonb_object_agg(cp.id, cp.subscription_plan) from public.company_profiles cp where cp.id in (p_x, p_y)));

    -- T2 : Z sans choix → refus ; le diagnostic ne cite que Z.
    begin
      perform public.company_plan_transition_apply();
      r := r || jsonb_build_object('t2_error', null);
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      r := r || jsonb_build_object('t2_error', sqlerrm, 't2_detail', v_detail);
    end;

    -- T3 : choix devenu caduc (ancienne échéance changée depuis le choix).
    perform public.company_plan_requalify(gen_random_uuid(), p_z, 'free', null, 'Compte de test repris en Free.', p_ops);
    perform set_config('easyjob.company_plan_write', 'on', true);
    update public.company_profiles set subscription_expires_at = v_z_exp - interval '1 day' where id = p_z;
    r := r || jsonb_build_object('t3_ready_z',
      (select x.ready from public.company_plan_transition_report() x where x.company_id = p_z));
    begin
      perform public.company_plan_transition_apply();
      r := r || jsonb_build_object('t3_error', null);
    exception when others then
      r := r || jsonb_build_object('t3_error', sqlerrm);
    end;
    perform public.company_plan_requalify(gen_random_uuid(), p_z, 'free', null, 'Choix renouvelé après changement.', p_ops);

    -- T4 : panne pendant la reprise → aucun effet partiel.
    begin
      execute format($f$create function public.proof_abo07_boom() returns trigger language plpgsql as $b$
        begin if new.company_id = %L then raise exception 'proof_boom'; end if; return new; end $b$$f$, p_y);
      execute 'create trigger proof_abo07_boom before insert on public.company_premium_grants for each row execute function public.proof_abo07_boom()';
      begin
        perform public.company_plan_transition_apply();
        r := r || jsonb_build_object('t4_error', null);
      exception when others then
        r := r || jsonb_build_object('t4_error', sqlerrm);
      end;
      r := r || jsonb_build_object(
        't4_plans', (select jsonb_object_agg(cp.id, cp.subscription_plan) from public.company_profiles cp where cp.id in (p_x, p_y, p_z)),
        't4_grants', (select count(*) from public.company_premium_grants g where g.company_id in (p_x, p_y, p_z)),
        't4_notifs', (select count(*) from public.notifications n where n.data ->> 'kind' = 'company_premium'
                       and n.user_id in (select cp.user_id from public.company_profiles cp where cp.id in (p_x, p_y, p_z))));
      raise exception 'proof_undo_t4';
    exception when others then
      if sqlerrm <> 'proof_undo_t4' then raise; end if;
    end;

    -- T5 : reprise appliquée.
    begin
      v_n := public.company_plan_transition_apply();
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      raise exception 't5: % | % | %', sqlerrm, v_detail,
        (select jsonb_agg(to_jsonb(x)) from public.company_plan_transition_report() x);
    end;
    r := r || jsonb_build_object(
      't5_count', v_n,
      't5_rows', (select jsonb_object_agg(cp.id, jsonb_build_object(
                    'plan', cp.subscription_plan,
                    'until_ok', case when cp.id = p_x then cp.subscription_expires_at = v_until
                                     else cp.subscription_expires_at is null end,
                    'started', cp.premium_started_at is not null))
                  from public.company_profiles cp where cp.id in (p_x, p_y, p_z)),
      't5_grants', (select jsonb_object_agg(g.company_id, jsonb_build_object(
                      'op', g.operation, 'source', g.source, 'result', g.resulting_plan,
                      'legacy', g.legacy_plan,
                      'legacy_exp_ok', case when g.company_id = p_x then g.legacy_expires_at = v_x_exp
                                            when g.company_id = p_y then g.legacy_expires_at is null
                                            else g.legacy_expires_at = v_z_exp - interval '1 day' end,
                      'actor_ok', g.actor_id = p_ops, 'reason', g.reason))
                    from public.company_premium_grants g where g.company_id in (p_x, p_y, p_z)),
      't5_audit', (select count(*) from public.audit_logs a where a.action = 'company_plan_requalified'
                     and a.resource_id in (p_x, p_y, p_z)),
      't5_notifs', (select count(*) from public.notifications n where n.data ->> 'kind' = 'company_premium'
                      and n.data ->> 'operation' = 'requalify'
                      and n.user_id in (select cp.user_id from public.company_profiles cp where cp.id in (p_x, p_y, p_z))),
      't5_notif_bodies', (select jsonb_agg(n.body) from public.notifications n where n.data ->> 'kind' = 'company_premium'
                      and n.user_id in (select cp.user_id from public.company_profiles cp where cp.id in (p_x, p_y, p_z))),
      't5_legacy_left', (select count(*) from public.company_profiles cp where cp.subscription_plan in ('starter', 'pro', 'business')),
      't5_again', public.company_plan_transition_apply());
    begin
      perform public.company_plan_requalify(gen_random_uuid(), p_x, 'free', null, 'Après la reprise : refusé.', p_ops);
      r := r || jsonb_build_object('t5_after', null);
    exception when others then
      r := r || jsonb_build_object('t5_after', sqlerrm);
    end;

    -- T6 : historique en ajout seul (propriétaire compris).
    begin
      update public.company_plan_requalifications set reason = 'Motif réécrit après coup.' where company_id = p_x;
      r := r || jsonb_build_object('t6_requal', null);
    exception when others then
      r := r || jsonb_build_object('t6_requal', sqlerrm);
    end;
    begin
      update public.company_premium_grants set reason = 'Motif réécrit après coup.' where company_id = p_x;
      r := r || jsonb_build_object('t6_grant', null);
    exception when others then
      r := r || jsonb_build_object('t6_grant', sqlerrm);
    end;

    raise exception 'proof_undo_all';
  exception when others then
    if sqlerrm <> 'proof_undo_all' then raise; end if;
  end;
  return r;
end;
$proof$`;

const DROP_ALL = [
  "drop function if exists public.proof_abo07_state(uuid, uuid, interval)",
  "drop function if exists public.proof_abo07_edit(uuid, uuid, uuid, interval, jsonb)",
  "drop function if exists public.proof_abo07_messages(text, timestamptz)",
  "drop function if exists public.proof_abo07_raw(uuid, text, timestamptz, timestamptz)",
  "drop function if exists public.proof_abo07_transition(uuid, uuid, uuid, uuid, uuid, uuid)",
  "drop trigger if exists proof_abo07_boom on public.company_premium_grants",
  "drop function if exists public.proof_abo07_boom()",
];

function installFunctions() {
  for (const sql of DROP_ALL) execSql(sql);
  execSql(STATE_FN);
  execSql(EDIT_FN);
  execSql(MESSAGES_FN);
  execSql(RAW_FN);
  execSql(TRANSITION_FN);
  for (const fn of [
    "proof_abo07_state(uuid, uuid, interval)",
    "proof_abo07_edit(uuid, uuid, uuid, interval, jsonb)",
    "proof_abo07_messages(text, timestamptz)",
    "proof_abo07_raw(uuid, text, timestamptz, timestamptz)",
  ]) {
    execSql(
      `revoke all on function public.${fn} from public, anon, authenticated`,
    );
    execSql(`grant execute on function public.${fn} to service_role`);
  }
  // Connexion directe seulement (aucune session, aucune clé service).
  execSql(
    "revoke all on function public.proof_abo07_transition(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role",
  );
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
    phone: null,
    role,
    is_verified: false,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowErr) throw new Error(`users insert: ${rowErr.message}`);
  return id;
}

let niuSeq = 0;
async function createCompany(userId: string, name: string): Promise<string> {
  niuSeq += 1;
  const { data, error } = await serviceClient
    .from("company_profiles")
    .insert({
      user_id: userId,
      company_name: name,
      city: "Douala",
      address: "Rue de la preuve",
      onboarding_status: "completed",
      verification_status: "verified",
      niu: `M07${String(Date.now()).slice(-8)}${niuSeq}P`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

async function cleanAccounts(ids: string[]) {
  if (ids.length === 0) return;
  purgeProofJobs("company-premium", { userIds: ids });
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  if (companyIds.length > 0) {
    // Historique en ajout seul : retiré avec les comptes de preuve.
    await serviceClient
      .from("company_premium_grants")
      .delete()
      .in("company_id", companyIds);
  }
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
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
      .filter((u) => u.user_metadata?.proofCompanyPremium === true)
      .map((u) => u.id),
  );
}

type HttpResult = { status: number; body: Record<string, unknown> };
async function http(
  method: "GET" | "POST" | "PATCH",
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

/** Forme d'un signal : domaine, ressource et identifiant du message. */
const SIGNAL_KEYS = new Set(["d", "r", "id"]);

const JOB_BASE = {
  title: "Serveur preuve ABO-08",
  description: "Service en salle, preuve du plan entreprise.",
  address: "Rue de la preuve",
  city: "Douala",
  start_time: "09:00",
  end_time: "17:00",
  mission_pay_per_candidate: 1500,
};
let jobSeq = 0;
/** Offre active (fixture de confiance). `published` : calendrier figé. */
async function seedActiveJob(
  companyId: string,
  published = false,
): Promise<{ id: string; date: string }> {
  jobSeq += 1;
  const date = new Date(Date.now() + (10 + jobSeq) * DAY)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await serviceClient
    .from("jobs")
    .insert({
      ...JOB_BASE,
      start_date: date,
      end_date: date,
      company_id: companyId,
      status: "active",
      positions_available: 1,
      ...(published
        ? {
            first_published_at: new Date().toISOString(),
            publication_regime: "normal",
            applications_close_at: new Date(Date.now() + 5 * DAY).toISOString(),
          }
        : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job seed: ${error?.message}`);
  return { id: data.id, date };
}
const editBody = (date: string, title = "Serveur preuve ABO-08 corrigé") => ({
  ...JOB_BASE,
  title,
  start_date: date,
  end_date: date,
  positions_available: 1,
});

/** Bloc de garde réel de la migration de transition (texte du fichier). */
function migrationGuard(): string {
  const file = path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20261125130000_company_premium_plan.sql",
  );
  const sql = fs.readFileSync(file, "utf8");
  const start = sql.indexOf("do $$");
  const end = sql.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error("garde de migration introuvable");
  return sql.slice(start, end + 3);
}

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `abo07-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    installFunctions();

    const keys = ["a", "b", "t", "x", "y", "z", "w"] as const;
    const companyUsers = await Promise.all(
      keys.map((k) => createAccount(mail(k), "company")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idFnd = await createAccount(mail("fnd"), "admin_founder");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOff = await createAccount(mail("off"), "admin_ops");
    ids.push(...companyUsers, idOps, idFnd, idSup, idOff);
    const uid = Object.fromEntries(
      keys.map((k, i) => [k, companyUsers[i]]),
    ) as Record<(typeof keys)[number], string>;
    const co = Object.fromEntries(
      await Promise.all(
        keys.map(async (k) => [
          k,
          await createCompany(uid[k], `Entreprise ${k.toUpperCase()}`),
        ]),
      ),
    ) as Record<(typeof keys)[number], string>;

    const [A, B, T, OPS, FND, SUP, OFF] = await Promise.all(
      ["a", "b", "t", "ops", "fnd", "sup", "off"].map((k) =>
        realSession(mail(k)),
      ),
    );
    // Ops suspendu APRÈS l'ouverture de sa session (ancien jeton).
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOff);
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const route = (companyId: string) =>
      `/api/admin/companies/${companyId}/premium`;
    const companyOf = async (companyId: string) =>
      (
        await serviceClient
          .from("company_profiles")
          .select(
            "subscription_plan, subscription_expires_at, premium_started_at",
          )
          .eq("id", companyId)
          .single()
      ).data!;
    const grantsOf = async (companyId: string) =>
      (
        await serviceClient
          .from("company_premium_grants")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
      ).count ?? 0;
    const notifsOf = async (userId: string) => {
      const { data } = await serviceClient
        .from("notifications")
        .select("body, title, data")
        .eq("user_id", userId)
        .eq("notification_type", "system");
      return (data ?? []).filter(
        (n) => (n.data as { kind?: string } | null)?.kind === "company_premium",
      );
    };
    const auditsOf = async (companyId: string) => {
      const { data } = await serviceClient
        .from("audit_logs")
        .select("metadata, action")
        .like("action", "company_premium_%");
      return (data ?? []).filter(
        (a) =>
          (a.metadata as { company_id?: string })?.company_id === companyId,
      ).length;
    };
    const accountState = async (s: Session) =>
      (await s.client.rpc("my_account_state")).data as {
        company?: {
          plan: string;
          effective_plan: string;
          expires_at: string | null;
          premium_started_at?: string | null;
          renews: boolean | null;
        } | null;
      } | null;
    const iso = (ms: number) => new Date(ms).toISOString();
    const action = (
      operation: "activate" | "extend" | "stop",
      endsAt: string | null,
      expected: string | null,
      reason = "Attribution de preuve ABO-07.",
      requestId: string = randomUUID(),
    ) => ({
      request_id: requestId,
      operation,
      ends_at: endsAt,
      expected_until: expected,
      reason,
    });

    // ── P. Plan effectif ───────────────────────────────────────────
    {
      const s0 = await accountState(A);
      report(
        "P1 Free par défaut : plan stocké free, effectif free, aucune fin, renouvellement inconnu (renews = null)",
        s0?.company?.plan === "free" &&
          s0.company.effective_plan === "free" &&
          s0.company.expires_at === null &&
          s0.company.renews === null,
        s0?.company,
      );
      const atEnd = await proofRpc<{
        state: {
          company: {
            effective_plan: string;
            premium_started_at: string | null;
          };
        };
      }>("proof_abo07_state", {
        p_company: co.w,
        p_user: uid.w,
        p_offset: "0 seconds",
      });
      const before = await proofRpc<{
        state: {
          company: {
            effective_plan: string;
            premium_started_at: string | null;
          };
        };
      }>("proof_abo07_state", {
        p_company: co.w,
        p_user: uid.w,
        p_offset: "1 microsecond",
      });
      report(
        "P2 échéance exacte : Free à l'instant même (début masqué), Premium 1 µs avant",
        atEnd.state.company.effective_plan === "free" &&
          atEnd.state.company.premium_started_at === null &&
          before.state.company.effective_plan === "premium" &&
          before.state.company.premium_started_at !== null,
        { atEnd: atEnd.state.company, before: before.state.company },
      );
      await proofRpc("proof_abo07_raw", {
        p_company: co.w,
        p_plan: "free",
        p_expires: null,
        p_started: null,
      });
      // Rôle company_premium seul + ligne subscriptions active : sans effet.
      await serviceClient
        .from("users")
        .update({ role: "company_premium" })
        .eq("id", uid.b);
      await serviceClient.from("subscriptions").insert({
        user_id: uid.b,
        plan: "business",
        price: 25000,
        started_at: new Date().toISOString(),
        expires_at: iso(Date.now() + 30 * DAY),
        auto_renew: true,
        status: "active",
      });
      const sRole = await accountState(B);
      report(
        "P3 rôle company_premium seul et ligne subscriptions active (business, renouvellement) : plan effectif Free, renews null (ABO-11)",
        sRole?.company?.effective_plan === "free" &&
          sRole.company.renews === null,
        sRole?.company,
      );
      // Valeur ancienne en clé service : refusée d'abord par la garde ;
      // derrière la garde (indicateur posé), refusée par les contraintes.
      const { error: legacyErr } = await serviceClient
        .from("company_profiles")
        .update({ subscription_plan: "pro" })
        .eq("id", co.w);
      const legacyRaw = await proofRpc<string>("proof_abo07_raw", {
        p_company: co.w,
        p_plan: "pro",
        p_expires: null,
        p_started: null,
      });
      const noEndRaw = await proofRpc<string>("proof_abo07_raw", {
        p_company: co.w,
        p_plan: "premium",
        p_expires: null,
        p_started: null,
      });
      report(
        "P4 ancienne valeur en clé service → refus de la garde (42501) ; derrière la garde, starter/pro/business et Premium sans fin refusés par les contraintes (23514)",
        legacyErr?.code === "42501" &&
          /company_plan_untracked_write/.test(legacyErr.message) &&
          legacyRaw === "23514" &&
          noEndRaw === "23514" &&
          (await companyOf(co.w)).subscription_plan === "free",
        { legacy: legacyErr?.message, legacyRaw, noEndRaw },
      );
    }

    // ── W. Écritures refusées ──────────────────────────────────────
    {
      const before = JSON.stringify(await companyOf(co.a));
      const writes = await Promise.all([
        A.client
          .from("company_profiles")
          .update({
            subscription_plan: "premium",
            subscription_expires_at: iso(Date.now() + DAY),
          })
          .eq("id", co.a),
        A.client
          .from("company_profiles")
          .update({ subscription_expires_at: iso(Date.now() + DAY) })
          .eq("id", co.a),
        A.client
          .from("company_profiles")
          .update({ premium_started_at: iso(Date.now()) })
          .eq("id", co.a),
        A.client.from("company_premium_grants").insert({
          request_id: randomUUID(),
          company_id: co.a,
          operation: "activate",
          resulting_plan: "premium",
          ends_at: iso(Date.now() + DAY),
          reason: "Auto-attribution refusée.",
          source: "admin_grant",
          actor_id: uid.a,
          actor_role: "company",
        }),
      ]);
      const reads = await Promise.all([
        A.client.from("company_premium_grants").select("id"),
        A.client.from("company_plan_requalifications").select("id"),
      ]);
      report(
        "W1 entreprise : plan, fin, début et historique non modifiables ; historique et choix de reprise illisibles",
        writes.every((w) => w.error !== null) &&
          reads.every((r) => r.error !== null || (r.data ?? []).length === 0) &&
          JSON.stringify(await companyOf(co.a)) === before,
        writes.map((w) => w.error?.code),
      );
      const rpcs = await Promise.all([
        A.client.rpc("admin_manage_company_premium", {
          p_request_id: randomUUID(),
          p_company_id: co.a,
          p_operation: "activate",
          p_ends_at: iso(Date.now() + DAY),
          p_expected_until: null as unknown as string,
          p_reason: "Auto-attribution refusée.",
        }),
        A.client.rpc("admin_company_premium", { p_company_id: co.a }),
        A.client.rpc("company_plan_requalify", {
          p_request_id: randomUUID(),
          p_company_id: co.a,
          p_target: "free",
          p_premium_until: null as unknown as string,
          p_reason: "Choix par l'entreprise.",
        }),
        A.client.rpc("company_plan_transition_report"),
      ]);
      report(
        "W2 entreprise : RPC d'attribution, de lecture admin, de choix et de diagnostic refusées",
        rpcs.every((r) => /forbidden/.test(r.error?.message ?? "")),
        rpcs.map((r) => r.error?.message),
      );
      const [supPost, supGet, offPost, offGet, anonPost, tPost] =
        await Promise.all([
          http(
            "POST",
            route(co.a),
            SUP.cookie,
            action("activate", iso(Date.now() + DAY), null),
          ),
          http("GET", route(co.a), SUP.cookie),
          http(
            "POST",
            route(co.a),
            OFF.cookie,
            action("activate", iso(Date.now() + DAY), null),
          ),
          http("GET", route(co.a), OFF.cookie),
          http(
            "POST",
            route(co.a),
            null,
            action("activate", iso(Date.now() + DAY), null),
          ),
          http(
            "POST",
            route(co.a),
            T.cookie,
            action("activate", iso(Date.now() + DAY), null),
          ),
        ]);
      const offRpc = await OFF.client.rpc("admin_manage_company_premium", {
        p_request_id: randomUUID(),
        p_company_id: co.a,
        p_operation: "activate",
        p_ends_at: iso(Date.now() + DAY),
        p_expected_until: null as unknown as string,
        p_reason: "Ops suspendu avec un ancien jeton.",
      });
      const anonRpc = await anon.rpc("admin_manage_company_premium", {
        p_request_id: randomUUID(),
        p_company_id: co.a,
        p_operation: "activate",
        p_ends_at: iso(Date.now() + DAY),
        p_expected_until: null as unknown as string,
        p_reason: "Anonyme : refusé.",
      });
      report(
        "W3 support : lecture 200, écriture 403 ; ops suspendu (ancien jeton) : lecture et écriture 403, RPC refusée ; tiers 403 ; anonyme 401, RPC refusée",
        supGet.status === 200 &&
          supPost.status === 403 &&
          supPost.body.code === "forbidden" &&
          offPost.status === 403 &&
          offGet.status === 403 &&
          /forbidden/.test(offRpc.error?.message ?? "") &&
          tPost.status === 403 &&
          anonPost.status === 401 &&
          anonRpc.error !== null &&
          (await grantsOf(co.a)) === 0 &&
          JSON.stringify(await companyOf(co.a)) === before,
        {
          supPost: supPost.status,
          supGet: supGet.status,
          offPost: offPost.status,
          offGet: offGet.status,
          tPost: tPost.status,
          anonPost: anonPost.status,
          offRpc: offRpc.error?.message,
        },
      );
    }

    // ── G. Activation, prolongation, arrêt ─────────────────────────
    let premiumUntil = "";
    {
      const t0 = new Date(Date.now() - 2000).toISOString();
      const end1 = iso(Date.now() + 20 * DAY);
      const g1 = await http(
        "POST",
        route(co.a),
        OPS.cookie,
        action("activate", end1, null),
      );
      const c1 = await companyOf(co.a);
      const s1 = await accountState(A);
      const n1 = await notifsOf(uid.a);
      const payments = await serviceClient
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("company_id", co.a);
      premiumUntil = c1.subscription_expires_at ?? "";
      report(
        "G1 activation par admin_ops (route) : plan premium, fin choisie, début posé ; historique, audit et notification uniques ; aucune ligne de paiement ; my_account_state Premium",
        g1.status === 200 &&
          c1.subscription_plan === "premium" &&
          Date.parse(c1.subscription_expires_at ?? "") === Date.parse(end1) &&
          c1.premium_started_at !== null &&
          (await grantsOf(co.a)) === 1 &&
          (await auditsOf(co.a)) === 1 &&
          n1.length === 1 &&
          (payments.count ?? 0) === 0 &&
          s1?.company?.effective_plan === "premium",
        { g1, c1, notifs: n1.length, payments: payments.count },
      );
      report(
        "G2 notification : dans l'application, sans motif, sans adresse d'agent ni donnée de paiement",
        n1.length === 1 &&
          !/preuve ABO-07|@proof|admin_ops|FCFA|Mobile Money/i.test(
            `${n1[0].title} ${n1[0].body}`,
          ) &&
          /Aucun paiement/.test(n1[0].body ?? ""),
        n1[0],
      );
      const rMsgs = await proofRpc<Record<string, unknown>[]>(
        "proof_abo07_messages",
        {
          p_topic: `user:${uid.a}`,
          p_since: t0,
        },
      );
      const aMsgs = await proofRpc<Record<string, unknown>[]>(
        "proof_abo07_messages",
        {
          p_topic: "admin",
          p_since: t0,
        },
      );
      const clean = (m: Record<string, unknown>[]) =>
        m.every((p) => Object.keys(p).every((k) => SIGNAL_KEYS.has(k)));
      report(
        "R1 signaux : « subscription » vers l'entreprise et l'admin, réduits à {d, r, id}",
        rMsgs.some((p) => p.d === "subscription") &&
          aMsgs.some((p) => p.d === "subscription") &&
          clean(rMsgs) &&
          clean(aMsgs),
        { user: rMsgs.slice(0, 4), admin: aMsgs.slice(0, 4) },
      );

      const already = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("activate", iso(Date.now() + 40 * DAY), premiumUntil),
      );
      const notLater = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("extend", premiumUntil, premiumUntil),
      );
      const stale = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("extend", iso(Date.now() + 50 * DAY), iso(Date.now() + 9 * DAY)),
      );
      const shortReason = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("extend", iso(Date.now() + 50 * DAY), premiumUntil, "court"),
      );
      const y10k = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("extend", "+010000-01-01T00:00:00Z", premiumUntil),
      );
      report(
        "G3 refus : déjà actif 409, fin non postérieure 400, état lu périmé 409, motif court 400, borne du 10000-01-01 400 ; rien n'est écrit",
        already.status === 409 &&
          already.body.code === "premium_already_active" &&
          notLater.status === 400 &&
          notLater.body.code === "period_invalid" &&
          stale.status === 409 &&
          stale.body.code === "premium_state_changed" &&
          shortReason.status === 400 &&
          shortReason.body.code === "reason_invalid" &&
          y10k.status === 400 &&
          (await grantsOf(co.a)) === 1,
        {
          already: already.body.code,
          notLater: notLater.body.code,
          stale: stale.body.code,
          shortReason: shortReason.body.code,
          y10k: y10k.body.code,
        },
      );

      const end2 = iso(Date.now() + 60 * DAY);
      const g4 = await http(
        "POST",
        route(co.a),
        FND.cookie,
        action("extend", end2, premiumUntil),
      );
      const c4 = await companyOf(co.a);
      report(
        "G4 prolongation par admin_founder : nouvelle fin, début conservé, deuxième ligne d'historique",
        g4.status === 200 &&
          Date.parse(c4.subscription_expires_at ?? "") === Date.parse(end2) &&
          c4.premium_started_at === c1.premium_started_at &&
          (await grantsOf(co.a)) === 2,
        { g4, c4 },
      );
      premiumUntil = c4.subscription_expires_at ?? "";

      const read = await http("GET", route(co.a), SUP.cookie);
      const hist =
        (
          read.body.premium as {
            history?: { operation: string; source: string; reason: string }[];
          }
        )?.history ?? [];
      report(
        "G5 lecture admin (support) : plan Premium, historique complet (activation, prolongation), source admin_grant",
        read.status === 200 &&
          (read.body.premium as { plan?: string })?.plan === "premium" &&
          hist.length === 2 &&
          hist.every((h) => h.source === "admin_grant") &&
          hist
            .map((h) => h.operation)
            .sort()
            .join(",") === "activate,extend",
        hist,
      );
    }

    // ── E. Modification directe d'une offre active (ABO-08) ────────
    {
      // A est Premium (G4).
      const j1 = await seedActiveJob(co.a);
      const e1 = await http(
        "PATCH",
        `/api/jobs/${j1.id}`,
        A.cookie,
        editBody(j1.date),
      );
      report(
        "E1 Premium : offre active sans candidat modifiée → nouvelle modération (pending_review)",
        e1.status === 200 &&
          (e1.body.job as { status?: string })?.status === "pending_review",
        { status: e1.status, code: e1.body.code },
      );
      // B : rôle company_premium mais plan Free.
      const j2 = await seedActiveJob(co.b);
      const e2 = await http(
        "PATCH",
        `/api/jobs/${j2.id}`,
        B.cookie,
        editBody(j2.date),
      );
      const j2After = (
        await serviceClient
          .from("jobs")
          .select("status, title")
          .eq("id", j2.id)
          .single()
      ).data;
      report(
        "E2 Free (rôle company_premium seul) : 403 job_locked_plan, offre inchangée et publiée",
        e2.status === 403 &&
          e2.body.code === "job_locked_plan" &&
          j2After?.status === "active" &&
          j2After.title === JOB_BASE.title,
        { e2, j2After },
      );
      // Échéance exacte (fonction temporaire, même transaction).
      const j3 = await seedActiveJob(co.w);
      const j4 = await seedActiveJob(co.w);
      const payload = editBody(j3.date);
      const atEnd = await proofRpc<{ error: string | null; status: string }>(
        "proof_abo07_edit",
        {
          p_company: co.w,
          p_user: uid.w,
          p_job: j3.id,
          p_offset: "0 seconds",
          p_payload: payload,
        },
      );
      const justBefore = await proofRpc<{
        error: string | null;
        status: string;
      }>("proof_abo07_edit", {
        p_company: co.w,
        p_user: uid.w,
        p_job: j4.id,
        p_offset: "1 microsecond",
        p_payload: editBody(j4.date),
      });
      report(
        "E3 échéance exacte : refus job_locked_plan à l'instant même, modification 1 µs avant",
        atEnd.error === "job_locked_plan" &&
          atEnd.status === "active" &&
          justBefore.error === null &&
          justBefore.status === "pending_review",
        { atEnd, justBefore },
      );
      await proofRpc("proof_abo07_raw", {
        p_company: co.w,
        p_plan: "free",
        p_expires: null,
        p_started: null,
      });
      // Calendrier figé après publication (Premium).
      const j5 = await seedActiveJob(co.a, true);
      const other = new Date(Date.parse(j5.date) + DAY)
        .toISOString()
        .slice(0, 10);
      const e5 = await http(
        "PATCH",
        `/api/jobs/${j5.id}`,
        A.cookie,
        editBody(other),
      );
      // Autre entreprise.
      const e6 = await http(
        "PATCH",
        `/api/jobs/${j5.id}`,
        T.cookie,
        editBody(j5.date),
      );
      report(
        "E4 Premium : date changée après publication → job_schedule_locked ; offre d'une autre entreprise → refus",
        e5.status >= 400 &&
          e5.body.code === "job_schedule_locked" &&
          e6.status >= 400 &&
          e6.status !== 200,
        { e5: e5.body.code, e6: { status: e6.status, code: e6.body.code } },
      );
      // Place pourvue (Premium).
      const candUser = await createAccount(mail("cand"), "candidate");
      ids.push(candUser);
      await serviceClient
        .from("users")
        .update({
          is_verified: true,
          phone: `+2376997${String(suffix).slice(-5)}`,
        })
        .eq("id", candUser);
      const { data: cand } = await serviceClient
        .from("candidate_profiles")
        .insert({
          user_id: candUser,
          first_name: "Paul",
          last_name: "Ngono",
          date_of_birth: "1996-05-14",
          city: "Douala",
          address: "Bonamoussadi",
          cni_number: `CNI07${String(suffix).slice(-6)}`,
          cni_front_url: `${candUser}/f.jpg`,
          cni_back_url: `${candUser}/b.jpg`,
          cni_selfie_url: `${candUser}/s.jpg`,
          cni_verified: "verified",
          cni_expires_at: "2033-01-01",
          momo_provider: "mtn",
          momo_number: "+237677070707",
          momo_verified: true,
          onboarding_status: "completed",
          onboarding_step: 6,
          profile_completion_pct: 100,
        })
        .select("id")
        .single();
      const j7 = await seedActiveJob(co.a, true);
      const { data: app } = await serviceClient
        .from("job_applications")
        .insert({
          job_id: j7.id,
          candidate_id: cand?.id ?? "",
          status: "pending",
        })
        .select("id")
        .single();
      await signAndSelectRpc(A.client, app?.id ?? "");
      const e7 = await http(
        "PATCH",
        `/api/jobs/${j7.id}`,
        A.cookie,
        editBody(j7.date),
      );
      report(
        "E5 Premium avec candidat sélectionné → 409 job_has_selected_candidates",
        e7.status === 409 && e7.body.code === "job_has_selected_candidates",
        e7,
      );
      // Compte suspendu (Premium).
      const j8 = await seedActiveJob(co.a);
      await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", uid.a);
      const e8 = await http(
        "PATCH",
        `/api/jobs/${j8.id}`,
        A.cookie,
        editBody(j8.date),
      );
      await serviceClient
        .from("users")
        .update({ is_active: true })
        .eq("id", uid.a);
      report(
        "E6 Premium, compte suspendu → refus account_suspended, offre inchangée",
        e8.status === 403 &&
          e8.body.code === "account_suspended" &&
          (
            await serviceClient
              .from("jobs")
              .select("status")
              .eq("id", j8.id)
              .single()
          ).data?.status === "active",
        e8,
      );
    }

    // ── I. Idempotence et concurrence ─────────────────────────────
    {
      const end = iso(Date.now() + 15 * DAY);
      const same = action(
        "activate",
        end,
        null,
        "Relances simultanées de preuve.",
      );
      const runs = await Promise.all(
        Array.from({ length: 5 }, () =>
          http("POST", route(co.t), OPS.cookie, same),
        ),
      );
      const applied = runs.filter(
        (r) =>
          (r.body.result as { already_applied?: boolean })?.already_applied ===
          false,
      ).length;
      report(
        "I1 cinq relances simultanées du même envoi : une seule opération, une ligne, un audit, une notification",
        runs.every((r) => r.status === 200) &&
          applied === 1 &&
          (await grantsOf(co.t)) === 1 &&
          (await auditsOf(co.t)) === 1 &&
          (await notifsOf(uid.t)).length === 1,
        runs.map((r) => [r.status, r.body.code]),
      );
      const conflict = await http("POST", route(co.t), OPS.cookie, {
        ...same,
        ends_at: iso(Date.now() + 16 * DAY),
      });
      report(
        "I2 même clé pour une autre fin → 409 request_conflict",
        conflict.status === 409 && conflict.body.code === "request_conflict",
        conflict,
      );
      const cur = (await companyOf(co.t)).subscription_expires_at;
      const [x1, x2] = await Promise.all([
        http(
          "POST",
          route(co.t),
          OPS.cookie,
          action("extend", iso(Date.now() + 30 * DAY), cur),
        ),
        http(
          "POST",
          route(co.t),
          FND.cookie,
          action("extend", iso(Date.now() + 31 * DAY), cur),
        ),
      ]);
      const codes = [x1, x2].map((r) => r.body.code ?? r.status);
      report(
        "I3 deux agents simultanés sur le même état lu : un seul aboutit, l'autre premium_state_changed",
        [x1, x2].filter((r) => r.status === 200).length === 1 &&
          codes.includes("premium_state_changed") &&
          (await grantsOf(co.t)) === 2,
        codes,
      );
    }

    // ── G6. Arrêt ─────────────────────────────────────────────────
    {
      const before = await companyOf(co.a);
      const g6 = await http(
        "POST",
        route(co.a),
        OPS.cookie,
        action("stop", null, before.subscription_expires_at),
      );
      const after = await companyOf(co.a);
      const s6 = await accountState(A);
      const j9 = await seedActiveJob(co.a);
      const e9 = await http(
        "PATCH",
        `/api/jobs/${j9.id}`,
        A.cookie,
        editBody(j9.date),
      );
      report(
        "G6 arrêt : plan free, fin à l'instant de l'arrêt, début effacé ; Free relu ; modification directe refusée ensuite",
        g6.status === 200 &&
          after.subscription_plan === "free" &&
          after.premium_started_at === null &&
          Date.parse(after.subscription_expires_at ?? "") <= Date.now() &&
          s6?.company?.effective_plan === "free" &&
          e9.status === 403 &&
          e9.body.code === "job_locked_plan" &&
          (await grantsOf(co.a)) === 3,
        { g6, after, e9: e9.body.code },
      );
      const again = await http(
        "POST",
        route(co.a),
        OPS.cookie,
        action("stop", null, after.subscription_expires_at),
      );
      report(
        "G7 arrêt d'un compte Free → 409 premium_not_active",
        again.status === 409 && again.body.code === "premium_not_active",
        again,
      );
      const reasonsBefore = JSON.stringify(
        (
          await serviceClient
            .from("company_premium_grants")
            .select("id, reason")
            .eq("company_id", co.a)
            .order("id")
        ).data,
      );
      const { error: upd } = await serviceClient
        .from("company_premium_grants")
        .update({ reason: "Motif réécrit en clé service." })
        .eq("company_id", co.a);
      const reasonsAfter = JSON.stringify(
        (
          await serviceClient
            .from("company_premium_grants")
            .select("id, reason")
            .eq("company_id", co.a)
            .order("id")
        ).data,
      );
      // Refus par les privilèges (aucun UPDATE accordé à service_role) ; le
      // déclencheur d'ajout seul le refuserait aussi (propriétaire compris, T9).
      report(
        "G8 historique en ajout seul, clé service comprise : modification refusée (42501), motifs inchangés",
        upd?.code === "42501" &&
          /permission denied|append-only/.test(upd.message) &&
          reasonsBefore === reasonsAfter,
        upd?.message,
      );
    }

    // ── S. Écritures directes du plan fermées (clé service, SQL direct) ──
    {
      const snapshot = async (companyId: string, userId: string) =>
        JSON.stringify({
          c: await companyOf(companyId),
          g: await grantsOf(companyId),
          a: await auditsOf(companyId),
          n: (await notifsOf(userId)).length,
        });
      const beforeA = await snapshot(co.a, uid.a);
      const beforeT = await snapshot(co.t, uid.t);
      const cT = await companyOf(co.t);
      const refusals = await Promise.all([
        serviceClient
          .from("company_profiles")
          .update({
            subscription_plan: "premium",
            subscription_expires_at: iso(Date.now() + 90 * DAY),
          })
          .eq("id", co.a),
        serviceClient
          .from("company_profiles")
          .update({ subscription_expires_at: iso(Date.now() + 100 * DAY) })
          .eq("id", co.t),
        serviceClient
          .from("company_profiles")
          .update({ premium_started_at: iso(Date.now() - 50 * DAY) })
          .eq("id", co.t),
        serviceClient
          .from("company_profiles")
          .update({ subscription_plan: "free" })
          .eq("id", co.t),
      ]);
      report(
        "S1 clé service : activation, prolongation, début et arrêt écrits directement → 42501 company_plan_untracked_write ; état, historique, audit et notifications inchangés",
        cT.subscription_plan === "premium" &&
          refusals.every(
            (r) =>
              r.error?.code === "42501" &&
              /company_plan_untracked_write/.test(r.error.message),
          ) &&
          (await snapshot(co.a, uid.a)) === beforeA &&
          (await snapshot(co.t, uid.t)) === beforeT,
        refusals.map((r) => r.error?.message),
      );
      // Création d'un profil : Free seulement hors parcours.
      const idN = await createAccount(mail("n"), "company");
      ids.push(idN);
      const premiumInsert = await serviceClient
        .from("company_profiles")
        .insert({
          user_id: idN,
          company_name: "Entreprise N",
          subscription_plan: "premium",
          subscription_expires_at: iso(Date.now() + 30 * DAY),
        });
      const freeInsert = await serviceClient
        .from("company_profiles")
        .insert({ user_id: idN, company_name: "Entreprise N" })
        .select("subscription_plan, subscription_expires_at")
        .single();
      report(
        "S2 clé service : création d'un profil déjà Premium refusée ; création par défaut (Free, sans fin) acceptée",
        premiumInsert.error?.code === "42501" &&
          /company_plan_untracked_write/.test(premiumInsert.error.message) &&
          !freeInsert.error &&
          freeInsert.data?.subscription_plan === "free" &&
          freeInsert.data.subscription_expires_at === null,
        {
          premium: premiumInsert.error?.message,
          free: freeInsert.error?.message,
        },
      );
      // SQL direct (postgres) sans le parcours : refusé aussi.
      const direct = runSql(
        `update public.company_profiles set subscription_plan = 'free', subscription_expires_at = now() where id = '${co.t}'`,
      );
      report(
        "S3 SQL direct (connexion postgres, hors parcours) : refusé, état inchangé",
        direct.status !== 0 &&
          /company_plan_untracked_write/.test(direct.out) &&
          (await snapshot(co.t, uid.t)) === beforeT,
        direct.out.slice(0, 200),
      );
      // Parcours autorisé, après ces refus : intact.
      const ext = await http(
        "POST",
        route(co.t),
        FND.cookie,
        action(
          "extend",
          iso(Date.now() + 120 * DAY),
          cT.subscription_expires_at,
        ),
      );
      const after = JSON.parse(await snapshot(co.t, uid.t)) as {
        c: { subscription_expires_at: string | null };
        g: number;
        a: number;
        n: number;
      };
      const was = JSON.parse(beforeT) as typeof after;
      report(
        "S4 parcours autorisé après les refus : prolongation par le fondateur → nouvelle fin, une ligne d'historique, un audit et une notification de plus",
        ext.status === 200 &&
          Date.parse(after.c.subscription_expires_at ?? "") >
            Date.now() + 100 * DAY &&
          after.g === was.g + 1 &&
          after.a === was.a + 1 &&
          after.n === was.n + 1,
        { ext: ext.status, was, after },
      );
    }

    // ── S5–S6. Contournement de l'indicateur de transaction ──────────
    {
      const cat = queryRows(`select
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    where p.prosrc like '%easyjob.company_plan_write%' and p.proname not like 'proof_abo07_%') as flag_fns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     regexp_matches(p.prosrc, 'set_config\\(\\s*([^,]+),', 'g') m
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.proname not like 'proof_abo07_%'
      and m[1] !~ '^''[a-z_.]+''$') as dynamic_set_config,
  (select count(*) from pg_db_role_setting s
    where array_to_string(s.setconfig, ',') like '%company_plan_write%') as role_settings,
  (select coalesce(string_agg(p.proname || ':' || r.rolname, ',' order by p.proname, r.rolname), '')
     from pg_proc p cross join (values ('anon'), ('service_role')) r(rolname)
    where p.proname in ('company_plan_transition_apply', 'guard_company_plan_writes',
                        'company_plan_maintenance', 'protect_company_premium_grants',
                        'protect_company_plan_requalifications', 'admin_manage_company_premium',
                        'admin_company_premium', 'company_plan_requalify', 'company_plan_transition_report')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')) as exec_leaks,
  has_table_privilege('service_role', 'public.company_premium_grants', 'INSERT')
    or has_table_privilege('service_role', 'public.company_premium_grants', 'UPDATE')
    or has_table_privilege('service_role', 'public.company_plan_requalifications', 'INSERT')
    or has_table_privilege('service_role', 'public.company_plan_requalifications', 'UPDATE') as svc_table_write`)[0];
      report(
        "S5 catalogue : seules admin_manage_company_premium, company_plan_transition_apply (qui le posent) et la garde (qui le lit) citent l'indicateur ; aucun set_config à nom dynamique ; aucun réglage de rôle ; aucune exécution par anon ni service_role des fonctions internes et d'écriture ; aucune écriture de la clé service dans l'historique ni les choix",
        cat?.flag_fns ===
          "admin_manage_company_premium,company_plan_transition_apply,guard_company_plan_writes" &&
          Number(cat.dynamic_set_config) === 0 &&
          Number(cat.role_settings) === 0 &&
          cat.exec_leaks === "" &&
          cat.svc_table_write === false,
        cat,
      );

      const before = await companyOf(co.t);
      const grantsBefore = await grantsOf(co.t);
      const h = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      };
      const raw = async (
        p: string,
        body: unknown,
        extra: Record<string, string> = {},
        method = "POST",
      ) => {
        const r = await fetch(`${SUPABASE_URL}${p}`, {
          method,
          headers: { ...h, ...extra },
          body: JSON.stringify(body),
        });
        return { status: r.status, text: (await r.text()).slice(0, 160) };
      };
      const tries = {
        setConfig: await raw("/rest/v1/rpc/set_config", {
          setting_name: "easyjob.company_plan_write",
          new_value: "on",
          is_local: false,
        }),
        pgCatalog: await raw(
          "/rest/v1/rpc/set_config",
          {
            setting_name: "easyjob.company_plan_write",
            new_value: "on",
            is_local: false,
          },
          { "Content-Profile": "pg_catalog" },
        ),
        header: await raw(
          `/rest/v1/company_profiles?id=eq.${co.t}`,
          { subscription_plan: "free" },
          { "x-easyjob-company-plan-write": "on", Prefer: "return=minimal" },
          "PATCH",
        ),
        apply: await raw("/rest/v1/rpc/company_plan_transition_apply", {}),
        manage: await raw("/rest/v1/rpc/admin_manage_company_premium", {
          p_request_id: randomUUID(),
          p_company_id: co.t,
          p_operation: "stop",
          p_ends_at: null,
          p_expected_until: before.subscription_expires_at,
          p_reason: "Contournement en clé service.",
        }),
        requalify: await raw("/rest/v1/rpc/company_plan_requalify", {
          p_request_id: randomUUID(),
          p_company_id: co.t,
          p_target: "free",
          p_premium_until: null,
          p_reason: "Choix au nom d'un admin inventé.",
          p_decided_by: idOps,
        }),
        grantRow: await raw("/rest/v1/company_premium_grants", {
          request_id: randomUUID(),
          company_id: co.t,
          operation: "stop",
          resulting_plan: "free",
          ends_at: iso(Date.now()),
          reason: "Ligne d'historique forgée.",
          source: "admin_grant",
          actor_id: idOps,
          actor_role: "admin_ops",
        }),
      };
      report(
        "S6 clé service : set_config introuvable (404), schéma pg_catalog refusé (406), en-tête sans effet (42501 de la garde), reprise, attribution et choix de reprise non exécutables, ligne d'historique forgée refusée ; plan et historique inchangés",
        tries.setConfig.status === 404 &&
          tries.pgCatalog.status === 406 &&
          tries.header.status === 403 &&
          /company_plan_untracked_write/.test(tries.header.text) &&
          [tries.apply, tries.manage, tries.requalify, tries.grantRow].every(
            (t) => t.status === 401 || t.status === 403,
          ) &&
          JSON.stringify(await companyOf(co.t)) === JSON.stringify(before) &&
          (await grantsOf(co.t)) === grantsBefore,
        tries,
      );
    }

    // ── T. Reprise des anciens plans ───────────────────────────────
    {
      // T0 : garde réelle de la migration (texte du fichier). La CLI exécute
      // une seule commande (instruction préparée) et n'affiche que le
      // message : un seul bloc « do », toujours annulé, prépare les comptes
      // anciens, exécute la garde, puis relance son issue ET son diagnostic.
      const guard = migrationGuard().replace(/;\s*$/, "");
      const guardRun = (choices: string) =>
        runSql(`do $outer$
declare v_msg text; v_detail text;
begin
  begin
    perform set_config('easyjob.company_plan_write', 'on', true);
    alter table public.company_profiles drop constraint company_profiles_plan_free_premium_chk;
    alter table public.company_profiles drop constraint company_profiles_premium_end_chk;
    update public.company_profiles set subscription_plan = 'pro' where id = '${co.x}';
    update public.company_profiles set subscription_plan = 'business', subscription_expires_at = now() + interval '3 days' where id = '${co.y}';
    ${choices}
    begin
      execute $guard$${guard}$guard$;
      v_msg := 'GUARD_PASSED';
      v_detail := '';
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      v_msg := sqlerrm;
    end;
    raise exception 'proof_undo';
  exception when others then
    if sqlerrm <> 'proof_undo' then raise; end if;
  end;
  raise exception 'GUARD:% | %', v_msg, v_detail;
end
$outer$`);
      const blocked = guardRun("");
      const afterBlocked = await Promise.all([
        companyOf(co.x),
        companyOf(co.y),
      ]);
      report(
        "T0 garde de la migration (texte du fichier) : comptes anciens sans choix → arrêt company_plan_transition_blocked, nombre, valeurs et identifiants cités ; aucun effet",
        /GUARD:company_plan_transition_blocked/.test(blocked.out) &&
          blocked.out.includes(co.x) &&
          blocked.out.includes(co.y) &&
          /2 compte/.test(blocked.out) &&
          /business/.test(blocked.out) &&
          afterBlocked.every((c) => c.subscription_plan === "free"),
        { out: blocked.out.slice(0, 500), afterBlocked },
      );
      const allowed =
        guardRun(`perform public.company_plan_requalify(gen_random_uuid(), '${co.x}', 'free', null, 'Compte de test repris en Free.', '${idOps}');
    perform public.company_plan_requalify(gen_random_uuid(), '${co.y}', 'premium', now() + interval '30 days', 'Compte de test repris en Premium.', '${idOps}');`);
      const leftoverT0 = queryRows(
        `select count(*)::int as n from public.company_plan_requalifications where company_id in ('${co.x}', '${co.y}')`,
      );
      report(
        "T0b même garde avec un choix explicite à jour par compte → la migration continue (GUARD_PASSED) ; essai annulé",
        /GUARD:GUARD_PASSED/.test(allowed.out) &&
          Number(leftoverT0[0]?.n) === 0,
        { out: allowed.out.slice(0, 300), leftoverT0 },
      );

      const rows = queryRows(
        `select public.proof_abo07_transition('${co.x}', '${co.y}', '${co.z}', '${co.w}', '${idOps}', '${idSup}') as r`,
      );
      const r = (rows[0]?.r ?? {}) as Record<string, unknown>;
      const plans1 = r.t1_plans as Record<string, string>;
      report(
        "T1 reprise sans choix : refus company_plan_transition_blocked, trois comptes cités ; anciennes valeurs intactes, aucun historique ; diagnostic « non prêt » pour chacun",
        r.t1_error === "company_plan_transition_blocked" &&
          [co.x, co.y, co.z].every((id) =>
            String(r.t1_detail ?? "").includes(id),
          ) &&
          plans1?.[co.x] === "pro" &&
          plans1?.[co.y] === "business" &&
          plans1?.[co.z] === "starter" &&
          r.t1_grants === 0 &&
          ((r.t1_report as { ready: boolean }[]) ?? []).length === 3 &&
          ((r.t1_report as { ready: boolean }[]) ?? []).every((x) => !x.ready),
        { error: r.t1_error, detail: r.t1_detail, plans1, report: r.t1_report },
      );
      report(
        "T2 choix refusés : auteur absent ou support (decided_by_invalid), Premium sans fin, Free avec fin, fin passée (period_invalid), motif court (reason_invalid), ancien plan comme cible (target_invalid), compte non ancien (company_not_legacy) ; aucune ligne",
        r.v_errors ===
          "a:decided_by_invalid;b:decided_by_invalid;c:period_invalid;d:period_invalid;e:period_invalid;f:reason_invalid;g:target_invalid;h:company_not_legacy;" &&
          r.v_rows === 0,
        { errors: r.v_errors, rows: r.v_rows },
      );
      const cx = r.c_row_x as Record<string, unknown>;
      const cPlans = r.c_plans as Record<string, string>;
      report(
        "T3 choix explicite : ancienne valeur et échéance recopiées, auteur ops désigné, voie de maintenance tracée ; relance sans doublon ; même clé pour un autre choix refusée ; plusieurs choix dans une transaction : le dernier fait foi ; plan inchangé avant la reprise",
        r.c_relaunch === true &&
          r.c_conflict === "request_conflict" &&
          r.c_rows_x === 1 &&
          cx?.legacy === "pro" &&
          cx?.legacy_exp === true &&
          cx?.by === true &&
          cx?.role === "admin_ops" &&
          cx?.via === "database_maintenance" &&
          r.c_audit === 7 &&
          r.c_last_y_ok === true &&
          cPlans?.[co.x] === "pro" &&
          cPlans?.[co.y] === "business",
        {
          relaunch: r.c_relaunch,
          conflict: r.c_conflict,
          cx,
          audit: r.c_audit,
          cPlans,
        },
      );
      report(
        "T4 un compte encore sans choix : refus ; le diagnostic ne cite que lui",
        r.t2_error === "company_plan_transition_blocked" &&
          String(r.t2_detail ?? "").includes(co.z) &&
          !String(r.t2_detail ?? "").includes(co.x) &&
          !String(r.t2_detail ?? "").includes(co.y),
        { error: r.t2_error, detail: r.t2_detail },
      );
      report(
        "T5 choix devenu caduc (ancienne échéance changée après le choix) : compte non prêt, reprise refusée",
        r.t3_ready_z === false &&
          r.t3_error === "company_plan_transition_blocked",
        { ready: r.t3_ready_z, error: r.t3_error },
      );
      const plans4 = r.t4_plans as Record<string, string>;
      report(
        "T6 panne pendant la reprise (écriture d'historique refusée pour un compte) : aucun effet partiel (anciennes valeurs, aucun historique, aucune notification)",
        r.t4_error === "proof_boom" &&
          plans4?.[co.x] === "pro" &&
          plans4?.[co.y] === "business" &&
          plans4?.[co.z] === "starter" &&
          r.t4_grants === 0 &&
          r.t4_notifs === 0,
        { error: r.t4_error, plans4, grants: r.t4_grants, notifs: r.t4_notifs },
      );
      const rows5 = r.t5_rows as Record<
        string,
        { plan: string; until_ok: boolean; started: boolean }
      >;
      const grants5 = r.t5_grants as Record<string, Record<string, unknown>>;
      report(
        "T7 reprise appliquée : X Premium jusqu'à la fin choisie, Y et Z Free sans fin ; historique « requalify » par compte (ancienne valeur, ancienne échéance, auteur, motif) ; trois audits, trois notifications ; plus aucune ancienne valeur",
        r.t5_count === 3 &&
          rows5?.[co.x]?.plan === "premium" &&
          rows5[co.x].until_ok &&
          rows5[co.x].started &&
          rows5?.[co.y]?.plan === "free" &&
          rows5[co.y].until_ok &&
          !rows5[co.y].started &&
          rows5?.[co.z]?.plan === "free" &&
          rows5[co.z].until_ok &&
          [co.x, co.y, co.z].every(
            (id) =>
              grants5?.[id]?.op === "requalify" &&
              grants5[id].source === "requalification" &&
              grants5[id].legacy_exp_ok === true &&
              grants5[id].actor_ok === true,
          ) &&
          grants5?.[co.x]?.legacy === "pro" &&
          grants5?.[co.x]?.result === "premium" &&
          grants5?.[co.y]?.legacy === "business" &&
          grants5?.[co.y]?.result === "free" &&
          grants5?.[co.z]?.legacy === "starter" &&
          grants5?.[co.x]?.reason === "Compte de test repris en Premium." &&
          grants5?.[co.y]?.reason ===
            "Choix Y n°5, le plus récent l'emporte." &&
          r.t5_audit === 3 &&
          r.t5_notifs === 3 &&
          r.t5_legacy_left === 0,
        {
          count: r.t5_count,
          rows5,
          grants5,
          audit: r.t5_audit,
          notifs: r.t5_notifs,
        },
      );
      const bodies = (r.t5_notif_bodies as string[]) ?? [];
      report(
        "T8 notifications de reprise sans motif ni donnée sensible ; relance de la reprise sans effet ; plus aucun choix possible après la reprise",
        bodies.length === 3 &&
          bodies.every((b) => !/Compte de test|@proof|admin_ops/.test(b)) &&
          r.t5_again === 0 &&
          r.t5_after === "company_not_legacy",
        { bodies, again: r.t5_again, after: r.t5_after },
      );
      report(
        "T9 choix et historique en ajout seul (propriétaire compris)",
        /append-only/.test(String(r.t6_requal ?? "")) &&
          /append-only/.test(String(r.t6_grant ?? "")),
        { requal: r.t6_requal, grant: r.t6_grant },
      );
      const constraints = queryRows(
        "select count(*)::int as n from pg_constraint where conname in ('company_profiles_plan_free_premium_chk', 'company_profiles_premium_end_chk')",
      );
      const afterAll = await Promise.all([
        companyOf(co.x),
        companyOf(co.y),
        companyOf(co.z),
      ]);
      const leftover = queryRows(
        `select count(*)::int as n from public.company_plan_requalifications where company_id in ('${co.x}', '${co.y}', '${co.z}')`,
      );
      report(
        "T10 scénario annulé : contraintes rétablies, fixtures revenues à Free, aucun choix restant",
        Number(constraints[0]?.n) === 2 &&
          afterAll.every((c) => c.subscription_plan === "free") &&
          Number(leftover[0]?.n) === 0,
        { constraints, afterAll, leftover },
      );
    }

    // ── A. Fiche admin de l'entreprise ─────────────────────────────
    {
      const page = async (s: Session) => {
        const res = await appFetch(`${APP_URL}/admin/companies/${co.a}`, {
          headers: { Cookie: s.cookie },
          redirect: "manual",
        });
        const html = await res.text();
        return {
          status: res.status,
          redirected:
            (res.status >= 300 && res.status < 400) ||
            html.includes("NEXT_REDIRECT"),
        };
      };
      const [off, ops, sup] = await Promise.all([
        page(OFF),
        page(OPS),
        page(SUP),
      ]);
      report(
        "A1 fiche admin de l'entreprise : ops suspendu (ancien jeton) redirigé ; ops et support actifs admis",
        off.redirected &&
          !ops.redirected &&
          ops.status === 200 &&
          !sup.redirected &&
          sup.status === 200,
        { off, ops, sup },
      );
    }
  } finally {
    try {
      for (const sql of DROP_ALL) execSql(sql);
    } finally {
      await serviceClient.from("subscriptions").delete().in("user_id", ids);
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
