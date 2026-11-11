/**
 * Preuve lot 7d — signaux Realtime de l'application.
 *
 * Méthode :
 *   1. Fixtures en service role : admins A (admin_ops) et D (rétrogradé),
 *      entreprises E (propriétaire) et T (tierce), candidats K1, K2 et K3
 *      (tiers). Chaque compte ouvre une VRAIE session (mot de passe, clé
 *      anon) : cookies @supabase/ssr pour les routes de l'application, et
 *      client supabase-js connecté à Realtime (WebSocket) pour les canaux.
 *   2. Les changements passent par les routes et RPC réelles (création,
 *      modération, candidature, sélection, signature, début, code, avis,
 *      suspension), ou par la clé service pour les écritures serveur sans
 *      écran (abonnements, vérifications).
 *   3. Assertions :
 *      Z. Autorisation des canaux : propre canal, canal d'un tiers, sans
 *         session, admin, offres publiques ; impossibilité d'émettre ;
 *         postgres_changes fermé sur missions et job_applications.
 *      B. Comptes et droits : suspension (signal, refus d'une sélection
 *         avec l'ancienne session), réactivation, changement de grade,
 *         perte du rôle admin.
 *      C. Abonnements : activation vue par deux onglets, échéance sans
 *         écriture SQL (droit retiré, action périmée refusée), annulation
 *         en fin de période, premium candidat.
 *      P. Profils et vérifications (toutes les tables du profil).
 *      J. Offres et candidatures : création, modération, publication,
 *         modification, retrait, suppression, candidature, retrait,
 *         présélection, refus, sélection ; tiers sans signal.
 *      M. Missions, contrats et évaluations ; montant lu dans le contrat.
 *      N. Notifications : création et lecture entre deux onglets.
 *      R. Reconnexion : la relecture récupère une suppression manquée.
 *      S. Changement de compte sur un même client : plus aucun signal du
 *         premier compte.
 *      X. Confidentialité : chaque message reçu ne contient que {d, r, id}
 *         et aucune valeur sensible (code de fin, IP, CNI, MoMo, email).
 *   4. Nettoyage : comptes, profils, offres, missions, contrats, avis,
 *      abonnements et notifications de la preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalProofEnv } from "./lib/local-supabase";
import { approveCompanyDossier } from "./lib/verified-company";
import { appFetch } from "./lib/app-fetch";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L7d-realtime-01!";
const PROOF_USER_METADATA = { proofRealtime: true };

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Asserts ─────────────────────────────────────────────────────
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Sessions réelles ────────────────────────────────────────────
type Party = {
  id: string;
  email: string;
  cookie: string;
  /** Client supabase-js de la session : Realtime et RPC. */
  rt: DB;
};

async function cookieSession(email: string): Promise<string> {
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
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error) throw new Error(`signIn(${email}) : ${error.message}`);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function rtClient(email?: string): Promise<DB> {
  const client: DB = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (email) {
    const { error } = await client.auth.signInWithPassword({
      email,
      password: PROOF_PASSWORD,
    });
    if (error) throw new Error(`signIn rt(${email}) : ${error.message}`);
  }
  await client.realtime.setAuth();
  return client;
}

async function party(id: string, email: string): Promise<Party> {
  return {
    id,
    email,
    cookie: await cookieSession(email),
    rt: await rtClient(email),
  };
}

// ─── Canaux ──────────────────────────────────────────────────────
type Received = { payload: Record<string, unknown>; at: number };
type Listener = {
  topic: string;
  events: Received[];
  statuses: string[];
  close: () => Promise<void>;
};
/** Tous les messages bruts reçus pendant la preuve (contrôle X). */
const RAW: string[] = [];

async function listen(
  client: DB,
  topic: string,
): Promise<{ ok: true; l: Listener } | { ok: false; error: string }> {
  const events: Received[] = [];
  const statuses: string[] = [];
  const ch = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "*" }, (message) => {
      RAW.push(JSON.stringify(message));
      events.push({
        payload: (message.payload ?? {}) as Record<string, unknown>,
        at: Date.now(),
      });
    });
  const l: Listener = {
    topic,
    events,
    statuses,
    close: async () => {
      await client.removeChannel(ch);
    },
  };
  return await new Promise((resolve) => {
    // Le rappel de subscribe() reste actif : seule la première issue décide
    // ; une erreur ultérieure (coupure) laisse realtime-js rejoindre.
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      void client.removeChannel(ch);
      resolve({ ok: false, error: "timeout" });
    }, 10_000);
    ch.subscribe((status, err) => {
      statuses.push(status);
      if (settled) return;
      if (status === "SUBSCRIBED") {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, l });
      } else if (status === "CHANNEL_ERROR") {
        settled = true;
        clearTimeout(timer);
        void client.removeChannel(ch);
        resolve({ ok: false, error: err?.message ?? "channel_error" });
      }
    });
  });
}

async function mustListen(client: DB, topic: string): Promise<Listener> {
  const r = await listen(client, topic);
  if (!r.ok) throw new Error(`abonnement ${topic} : ${r.error}`);
  return r.l;
}

const mark = (l: Listener) => l.events.length;
const since = (l: Listener, from: number) => l.events.slice(from);
const hasSignal = (l: Listener, from: number, d: string, r?: string | null) =>
  since(l, from).some(
    (e) => e.payload.d === d && (r === undefined || e.payload.r === r),
  );

async function waitSignal(
  l: Listener,
  from: number,
  d: string,
  r?: string | null,
  timeoutMs = 6000,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (hasSignal(l, from, d, r)) return true;
    await sleep(50);
  }
  return hasSignal(l, from, d, r);
}

// ─── Requêtes ────────────────────────────────────────────────────
type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  text: string;
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
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

// ─── Fixtures ────────────────────────────────────────────────────
async function createAccount(email: string, role: Role): Promise<string> {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role, phone_verified: true },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  const { error: rowErr } = await serviceClient.from("users").insert({
    id,
    email,
    phone: role.startsWith("candidate")
      ? `+2376995${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
      : null,
    role,
    is_verified: role.startsWith("candidate"),
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
      niu: `M7D${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  // Lot 11 : dossier complet et contrôlé, sinon create_job refuse.
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

const MOMO = "+237677007111";
async function createCandidate(userId: string, firstName: string) {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: "Direct",
      date_of_birth: "1996-04-20",
      city: "Douala",
      address: "Ndokoti",
      latitude: 4.0611,
      longitude: 9.7429,
      cni_number: `CNI7D${firstName}${String(Date.now()).slice(-5)}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: MOMO,
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
  const { data: cands } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const candIds = (cands ?? []).map((c) => c.id);
  if (candIds.length > 0) {
    await serviceClient
      .from("candidate_documents")
      .delete()
      .in("candidate_id", candIds);
    await serviceClient
      .from("candidate_skills")
      .delete()
      .in("candidate_id", candIds);
    await serviceClient
      .from("candidate_availability")
      .delete()
      .in("candidate_id", candIds);
    await serviceClient
      .from("profile_update_requests")
      .delete()
      .in("candidate_id", candIds);
  }
  await serviceClient.from("subscriptions").delete().in("user_id", ids);
  await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("company_profiles").delete().in("user_id", ids);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofRealtime === true)
      .map((u) => u.id),
  );
}

const douala = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(d);

type AccountStateLite = {
  role: string | null;
  is_active: boolean;
  is_admin: boolean;
  server_now: string;
  company?: {
    plan: string;
    effective_plan: string;
    renews: boolean | null;
  } | null;
  candidate?: { premium: boolean } | null;
};
async function accountState(p: Party): Promise<AccountStateLite | null> {
  const { data, error } = await p.rt.rpc("my_account_state");
  if (error) return null;
  return data as unknown as AccountStateLite;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l7d-${k}+${suffix}@proof.easyjob.cm`;
  const created: string[] = [];
  const listeners: Listener[] = [];
  const clients: DB[] = [];
  const track = (l: Listener) => {
    listeners.push(l);
    return l;
  };

  try {
    // ── Fixtures ────────────────────────────────────────────────
    const idA = await createAccount(mail("admin"), "admin_ops");
    const idD = await createAccount(mail("demoted"), "admin_ops");
    const idE = await createAccount(mail("company"), "company");
    const idT = await createAccount(mail("third-company"), "company");
    const idK1 = await createAccount(mail("k1"), "candidate");
    const idK2 = await createAccount(mail("k2"), "candidate");
    const idK3 = await createAccount(mail("k3"), "candidate");
    created.push(idA, idD, idE, idT, idK1, idK2, idK3);
    const coE = await createCompany(idE, "Realtime SARL");
    const coT = await createCompany(idT, "Tierce SARL");
    const cK1 = await createCandidate(idK1, "Awa");
    await createCandidate(idK2, "Brice");
    const cK3 = await createCandidate(idK3, "Carine");
    void coT;
    void cK3;

    const A = await party(idA, mail("admin"));
    const D = await party(idD, mail("demoted"));
    const E = await party(idE, mail("company"));
    const T = await party(idT, mail("third-company"));
    const K1 = await party(idK1, mail("k1"));
    const K2 = await party(idK2, mail("k2"));
    const K3 = await party(idK3, mail("k3"));
    // Deuxième onglet de l'entreprise et de K1 (sessions distinctes).
    const E2rt = await rtClient(mail("company"));
    const K1b = await rtClient(mail("k1"));
    clients.push(A.rt, D.rt, E.rt, T.rt, K1.rt, K2.rt, K3.rt, E2rt, K1b);

    // ── Z. Autorisation des canaux ──────────────────────────────
    console.log("\n── Z. Autorisation des canaux ──");
    track(await mustListen(A.rt, `user:${idA}`));
    const lAdm = track(await mustListen(A.rt, "admin"));
    const lD = track(await mustListen(D.rt, `user:${idD}`));
    const lDAdm = track(await mustListen(D.rt, "admin"));
    const lE = track(await mustListen(E.rt, `user:${idE}`));
    const lE2 = track(await mustListen(E2rt, `user:${idE}`));
    const lT = track(await mustListen(T.rt, `user:${idT}`));
    const lK1 = track(await mustListen(K1.rt, `user:${idK1}`));
    const lK1b = track(await mustListen(K1b, `user:${idK1}`));
    const lK2 = track(await mustListen(K2.rt, `user:${idK2}`));
    const lK3 = track(await mustListen(K3.rt, `user:${idK3}`));
    const lPubK1 = track(await mustListen(K1.rt, "jobs:public"));
    const lPubK3 = track(await mustListen(K3.rt, "jobs:public"));
    report(
      "Z1 : chaque session rejoint son canal user:<uid>, l'admin le canal admin",
      true,
    );

    const spy = await rtClient(mail("k3"));
    clients.push(spy);
    const z2 = await listen(spy, `user:${idE}`);
    report(
      "Z2 : un candidat connaissant l'identifiant d'une entreprise ne rejoint pas son canal",
      !z2.ok && /permission|Unauthorized/i.test(z2.error),
      z2.ok ? "joined" : z2.error,
    );
    const anon = await rtClient();
    clients.push(anon);
    const z3 = await listen(anon, `user:${idK1}`);
    const z3b = await listen(anon, "jobs:public");
    report(
      "Z3 : sans session, ni canal personnel ni canal des offres",
      !z3.ok && !z3b.ok,
      { user: z3.ok || z3.error, pub: z3b.ok || z3b.error },
    );
    const spy2 = await rtClient(mail("k2"));
    clients.push(spy2);
    const z4 = await listen(spy2, "admin");
    report(
      "Z4 : un candidat ne rejoint pas le canal admin",
      !z4.ok,
      z4.ok || z4.error,
    );

    // Émission impossible : canal public homonyme, RPC interne, realtime.send.
    const forger = await rtClient(mail("k3"));
    clients.push(forger);
    const pubFake = forger.channel(`user:${idK1}`, {
      config: { private: false },
    });
    await new Promise<void>((res) =>
      pubFake.subscribe(
        (s) => (s === "SUBSCRIBED" || s === "CHANNEL_ERROR") && res(),
      ),
    );
    const before = mark(lK1);
    await pubFake.send({
      type: "broadcast",
      event: "sync",
      payload: { d: "account", r: null },
    });
    const { error: rpcErr } = await K3.rt.rpc("rt_send", {
      p_topic: `user:${idK1}`,
      p_domain: "account",
      p_resource: null as unknown as string,
    });
    const { error: sendErr } = await K3.rt.schema("realtime" as never).rpc(
      "send" as never,
      {
        payload: { d: "account" },
        event: "sync",
        topic: `user:${idK1}`,
        private: true,
      } as never,
    );
    await sleep(1500);
    report(
      "Z5 : un tiers ne peut émettre sur le canal d'un autre (canal public homonyme, rt_send, realtime.send)",
      since(lK1, before).length === 0 && !!rpcErr && !!sendErr,
      {
        received: since(lK1, before).length,
        rpc: rpcErr?.message,
        send: sendErr?.message,
      },
    );
    await forger.removeChannel(pubFake);

    // postgres_changes : missions et job_applications ne sont plus publiées.
    const pgEvents: unknown[] = [];
    const pgCh = K1.rt
      .channel("pg-probe")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_applications" },
        (p) => pgEvents.push(p),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "missions" },
        (p) => pgEvents.push(p),
      );
    await new Promise<void>((res) =>
      pgCh.subscribe(
        (s) => (s === "SUBSCRIBED" || s === "CHANNEL_ERROR") && res(),
      ),
    );

    // ── J. Offres et candidatures ───────────────────────────────
    console.log("\n── J. Offres et candidatures ──");
    const today = douala(new Date());
    let m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const createRes = await http("POST", "/api/jobs", E.cookie, {
      title: "Inventaire temps réel",
      job_type: "shift",
      description: "Preuve du lot 7d.",
      start_date: today,
      end_date: today,
      start_time: "00:00",
      end_time: "23:59",
      positions_available: 2,
      mission_pay_per_candidate: 10000,
      city: "Douala",
      address: "Rue de la preuve",
      required_skills: [],
      urgency: "normal",
    });
    const jobId = ((createRes.body.job ?? {}) as { id?: string }).id ?? "";
    report(
      "J1 : création par la route → entreprise (jobs, id) et file admin ; rien sur le canal public (offre en attente)",
      createRes.status === 201 || createRes.status === 200
        ? (await waitSignal(lE, m.e, "jobs", jobId)) &&
            (await waitSignal(lAdm, m.adm, "jobs")) &&
            !hasSignal(lPubK1, m.pub, "jobs", jobId)
        : false,
      { status: createRes.status, code: createRes.body.code },
    );
    report(
      "J2 : le canal admin ne porte jamais d'identifiant",
      since(lAdm, m.adm).every((e) => e.payload.r === null),
    );

    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const mPub3 = mark(lPubK3);
    const approve = await http(
      "POST",
      `/api/admin/jobs/${jobId}/moderate`,
      A.cookie,
      {
        action: "approve",
      },
    );
    report(
      "J3 : approbation → canal public (id de l'offre) vu par les candidats, entreprise et admin",
      approve.status === 200 &&
        (await waitSignal(lPubK1, m.pub, "jobs", jobId)) &&
        (await waitSignal(lPubK3, mPub3, "jobs", jobId)) &&
        (await waitSignal(lE, m.e, "jobs", jobId)) &&
        (await waitSignal(lAdm, m.adm, "jobs")),
      { status: approve.status, code: approve.body.code },
    );
    const listAfterApprove = await http(
      "GET",
      "/api/jobs?limit=100",
      K1.cookie,
    );
    report(
      "J4 : relecture autorisée → l'offre figure dans la liste du candidat",
      ((listAfterApprove.body.jobs ?? []) as { id: string }[]).some(
        (j) => j.id === jobId,
      ),
    );

    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    let mT = mark(lT);
    const { data: app1, error: applyErr } = await K1.rt.rpc("apply_to_job", {
      p_job_id: jobId,
    });
    report(
      "J5 : candidature → candidat et entreprise (applications, id), admin ; entreprise tierce rien",
      !applyErr &&
        !!app1 &&
        (await waitSignal(lK1, m.k1, "applications", app1.id)) &&
        (await waitSignal(lE, m.e, "applications", app1.id)) &&
        (await waitSignal(lAdm, m.adm, "applications")) &&
        since(lT, mT).length === 0,
      applyErr?.message,
    );
    const { data: app2 } = await K2.rt.rpc("apply_to_job", { p_job_id: jobId });

    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const { data: shortlisted, error: slErr } = await E.rt
      .from("job_applications")
      .update({ status: "shortlisted" })
      .eq("id", app1!.id)
      .select("id");
    report(
      "J6 : présélection par l'entreprise → signal au candidat",
      !slErr &&
        shortlisted?.length === 1 &&
        (await waitSignal(lK1, m.k1, "applications", app1!.id)),
      slErr?.message,
    );

    let mK2 = mark(lK2);
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const { error: wErr } = await K2.rt.rpc("withdraw_job_application", {
      p_job_id: jobId,
    });
    report(
      "J7 : retrait de candidature → entreprise et candidat",
      !wErr &&
        (await waitSignal(lE, m.e, "applications", app2!.id)) &&
        (await waitSignal(lK2, mK2, "applications", app2!.id)),
      wErr?.message,
    );

    // Une seconde candidature de K2 sur une autre offre, refusée.
    const { data: jobR } = await serviceClient
      .from("jobs")
      .insert({
        title: "Refus temps réel",
        description: "Preuve du lot 7d.",
        address: "Rue de la preuve",
        city: "Douala",
        start_date: today,
        start_time: "00:00",
        end_time: "23:59",
        mission_pay_per_candidate: 5000,
        company_id: coE,
        status: "active",
        positions_available: 1,
      })
      .select("id")
      .single();
    const { data: appR } = await K2.rt.rpc("apply_to_job", {
      p_job_id: jobR!.id,
    });
    mK2 = mark(lK2);
    const { data: rejected } = await E.rt
      .from("job_applications")
      .update({ status: "rejected", rejection_reason: "Profil" })
      .eq("id", appR!.id)
      .select("id");
    report(
      "J8 : refus par l'entreprise → signal au candidat",
      rejected?.length === 1 &&
        (await waitSignal(lK2, mK2, "applications", appR!.id)),
    );

    // Sélection de K1 par la route.
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const mE2 = mark(lE2);
    const sel = await http(
      "POST",
      `/api/applications/${app1!.id}/select`,
      E.cookie,
    );
    const selection = (sel.body.selection ?? {}) as {
      mission_id?: string;
      contract_id?: string;
    };
    const missionId = selection.mission_id ?? "";
    const contractId = selection.contract_id ?? "";
    report(
      "J9 : sélection → candidat (candidature, mission, contrat, notification), entreprise dans ses deux onglets, compteur public",
      sel.status === 200 &&
        (await waitSignal(lK1, m.k1, "applications", app1!.id)) &&
        (await waitSignal(lK1, m.k1, "missions", missionId)) &&
        (await waitSignal(lK1, m.k1, "contracts", contractId)) &&
        (await waitSignal(lK1, m.k1, "notifications")) &&
        (await waitSignal(lE, m.e, "missions", missionId)) &&
        (await waitSignal(lE2, mE2, "contracts", contractId)) &&
        (await waitSignal(lPubK1, m.pub, "jobs", jobId)),
      { status: sel.status, code: sel.body.code },
    );
    report(
      "J10 : une transaction n'émet qu'un signal par canal, domaine et ressource",
      since(lK1, m.k1).filter(
        (e) => e.payload.d === "missions" && e.payload.r === missionId,
      ).length === 1,
      since(lK1, m.k1).map((e) => `${e.payload.d}`),
    );
    await sleep(500);
    report(
      "Z6 : postgres_changes sur missions et job_applications : aucun événement (tables retirées de la publication)",
      pgEvents.length === 0,
      pgEvents.length,
    );
    await K1.rt.removeChannel(pgCh);

    // ── M. Missions, contrats et évaluations ────────────────────
    console.log("\n── M. Missions, contrats et évaluations ──");
    const view = await http("GET", `/api/contracts/${contractId}`, K1.cookie);
    const termsHash = (view.body.contract as { terms_hash?: string })
      ?.terms_hash;
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const signK = await http(
      "POST",
      `/api/contracts/${contractId}/sign`,
      K1.cookie,
      {
        terms_hash: termsHash,
        consent: true,
      },
    );
    report(
      "M1 : signature du candidat → l'entreprise reçoit (contracts, id)",
      signK.status === 200 &&
        (await waitSignal(lE, m.e, "contracts", contractId)),
      { status: signK.status, code: signK.body.code },
    );
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const signE = await http(
      "POST",
      `/api/contracts/${contractId}/sign`,
      E.cookie,
      {
        terms_hash: termsHash,
        consent: true,
      },
    );
    report(
      "M2 : signature de l'entreprise → le candidat reçoit (contracts, id)",
      signE.status === 200 &&
        (await waitSignal(lK1, m.k1, "contracts", contractId)),
      { status: signE.status, code: signE.body.code },
    );
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    mT = mark(lT);
    const start = await http(
      "POST",
      `/api/missions/${missionId}/start`,
      K1.cookie,
    );
    report(
      "M3 : début de mission → l'entreprise reçoit (missions, id) ; tiers rien",
      start.status === 200 &&
        (await waitSignal(lE, m.e, "missions", missionId)) &&
        since(lT, mT).length === 0,
      { status: start.status, code: start.body.code },
    );
    const { data: codeRow } = await serviceClient
      .from("mission_completion_codes")
      .select("code")
      .eq("mission_id", missionId)
      .single();
    const completionCode = codeRow?.code ?? "";
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const done = await http(
      "POST",
      `/api/missions/${missionId}/complete`,
      K1.cookie,
      {
        code: completionCode,
      },
    );
    report(
      "M4 : confirmation par code → l'entreprise reçoit (missions, id) ; le code n'est dans aucun message",
      done.status === 200 &&
        (await waitSignal(lE, m.e, "missions", missionId)) &&
        !RAW.some((r) => r.includes(completionCode)),
      { status: done.status, code: done.body.code },
    );
    m = { e: mark(lE), adm: mark(lAdm), pub: mark(lPubK1), k1: mark(lK1) };
    const rev = await http(
      "POST",
      `/api/missions/${missionId}/review`,
      K1.cookie,
      {
        rating: 5,
        comment: "Très bien",
      },
    );
    report(
      "M5 : note de l'entreprise → l'entreprise reçoit (missions) et son profil (étoiles)",
      rev.status === 200 &&
        (await waitSignal(lE, m.e, "missions", missionId)) &&
        (await waitSignal(lE, m.e, "profile", coE)),
      { status: rev.status, code: rev.body.code },
    );
    const missionView = await http(
      "GET",
      `/api/missions/${missionId}`,
      K1.cookie,
    );
    const mv = (missionView.body.mission ?? {}) as {
      mission_pay_per_candidate?: number;
    };
    report(
      "M6 : relecture après signal : montant de la mission lu dans le contrat (10 000 XAF)",
      mv.mission_pay_per_candidate === 10000,
      mv,
    );

    // ── N. Notifications entre deux onglets ─────────────────────
    console.log("\n── N. Notifications ──");
    const { data: notif } = await serviceClient
      .from("notifications")
      .select("id")
      .eq("user_id", idK1)
      .eq("is_read", false)
      .limit(1)
      .single();
    const mA1 = mark(lK1);
    const mB1 = mark(lK1b);
    const read = await http("PATCH", "/api/notifications", K1.cookie, {
      id: notif?.id,
    });
    report(
      "N1 : lecture d'une notification dans un onglet → l'autre onglet du même compte reçoit (notifications)",
      read.status === 200 &&
        (await waitSignal(lK1b, mB1, "notifications")) &&
        (await waitSignal(lK1, mA1, "notifications")),
      read.status,
    );
    const unread = await http(
      "GET",
      "/api/notifications/unread-count",
      K1.cookie,
    );
    report(
      "N2 : relecture du compteur après le signal",
      typeof unread.body.count === "number",
      unread.body,
    );

    // ── P. Profils et vérifications ─────────────────────────────
    console.log("\n── P. Profils et vérifications ──");
    const profileWrites: [
      string,
      () => PromiseLike<{ error: { message: string } | null }>,
    ][] = [
      [
        "candidate_profiles (progression)",
        () =>
          serviceClient
            .from("candidate_profiles")
            .update({ onboarding_step: 6, bio: "Profil relu." })
            .eq("id", cK1),
      ],
      [
        "candidate_skills",
        () =>
          serviceClient.from("candidate_skills").insert({
            candidate_id: cK1,
            skill_name: "Inventaire",
            skill_level: 3,
          }),
      ],
      [
        "candidate_documents (permis)",
        () =>
          serviceClient.from("candidate_documents").insert({
            candidate_id: cK1,
            document_type: "permis_conduire",
            title: "Permis",
            storage_path: `${idK1}/permis.pdf`,
            expires_at: "2030-01-01",
            license_category: "voiture",
          }),
      ],
      [
        "candidate_availability",
        () =>
          serviceClient.from("candidate_availability").insert({
            candidate_id: cK1,
            day_of_week: 1,
            start_time: "08:00",
            end_time: "12:00",
          }),
      ],
      [
        "profile_update_requests",
        () =>
          serviceClient.from("profile_update_requests").insert({
            candidate_id: cK1,
            fields: ["identity"],
            reason: "Preuve 7d",
            requested_by: idA,
          }),
      ],
    ];
    for (const [label, write] of profileWrites) {
      const mk1 = mark(lK1);
      const mAd = mark(lAdm);
      const mK3 = mark(lK3);
      const { error } = await write();
      report(
        `P : ${label} → candidat (profile) et admin ; autre candidat rien`,
        !error &&
          (await waitSignal(lK1, mk1, "profile")) &&
          (await waitSignal(lAdm, mAd, "profile")) &&
          since(lK3, mK3).length === 0,
        error?.message,
      );
    }
    let mE = mark(lE);
    let mAd = mark(lAdm);
    const { error: vErr } = await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coE);
    report(
      "P6 : vérification entreprise retirée → entreprise (profile) et admin",
      !vErr &&
        (await waitSignal(lE, mE, "profile", coE)) &&
        (await waitSignal(lAdm, mAd, "profile")),
      vErr?.message,
    );
    const stateUnverified = await accountState(E);
    const createUnverified = await http("POST", "/api/jobs", E.cookie, {
      title: "Refusée",
      job_type: "shift",
      description: "Preuve du lot 7d.",
      start_date: today,
      end_date: today,
      start_time: "08:00",
      end_time: "12:00",
      positions_available: 1,
      mission_pay_per_candidate: 1000,
      city: "Douala",
      address: "Rue",
      required_skills: [],
      urgency: "normal",
    });
    report(
      "P7 : relecture → my_account_state « pending » et publication refusée (company_not_verified)",
      !!stateUnverified?.company &&
        (stateUnverified.company as { verification_status?: string })
          .verification_status === "pending" &&
        createUnverified.status === 403 &&
        createUnverified.body.code === "company_not_verified",
      { status: createUnverified.status, code: createUnverified.body.code },
    );
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "verified" })
      .eq("id", coE);

    // ── C. Abonnements ──────────────────────────────────────────
    console.log("\n── C. Abonnements ──");
    mE = mark(lE);
    const mE2b = mark(lE2);
    mAd = mark(lAdm);
    const expiresAt = new Date(Date.now() + 15_000).toISOString();
    await serviceClient
      .from("company_profiles")
      .update({ subscription_plan: "pro", subscription_expires_at: expiresAt })
      .eq("id", coE);
    const { error: subErr } = await serviceClient.from("subscriptions").insert({
      user_id: idE,
      plan: "pro",
      price: 12000,
      started_at: new Date().toISOString(),
      expires_at: expiresAt,
      auto_renew: false,
      status: "active",
    });
    report(
      "C1 : activation du plan Pro → les deux onglets de l'entreprise et l'admin reçoivent (subscription)",
      !subErr &&
        (await waitSignal(lE, mE, "subscription")) &&
        (await waitSignal(lE2, mE2b, "subscription")) &&
        (await waitSignal(lAdm, mAd, "subscription")),
      subErr?.message,
    );
    const st1 = await accountState(E);
    report(
      "C2 : relecture → plan effectif Pro, annulation en fin de période (renews = false), heure serveur fournie",
      st1?.company?.effective_plan === "pro" &&
        st1.company.renews === false &&
        !!st1.server_now,
      st1?.company,
    );
    // Deux offres actives sans sélection : modification directe Pro.
    const mkActive = async (title: string) =>
      (
        await serviceClient
          .from("jobs")
          .insert({
            title,
            description: "Preuve du lot 7d.",
            address: "Rue de la preuve",
            city: "Douala",
            start_date: today,
            start_time: "00:00",
            end_time: "23:59",
            mission_pay_per_candidate: 3000,
            company_id: coE,
            status: "active",
            positions_available: 1,
          })
          .select("id")
          .single()
      ).data!.id;
    const jobEditOk = await mkActive("Modifiable Pro");
    const jobEditLate = await mkActive("Modifiable après échéance");
    const editBody = {
      title: "Modifiée en Pro",
      job_type: "shift",
      description: "Preuve du lot 7d.",
      start_date: today,
      end_date: today,
      start_time: "00:00",
      end_time: "23:59",
      positions_available: 1,
      mission_pay_per_candidate: 3000,
      city: "Douala",
      address: "Rue de la preuve",
      required_skills: [],
      urgency: "normal",
    };
    const mPubEdit = mark(lPubK1);
    const edited = await http(
      "PATCH",
      `/api/jobs/${jobEditOk}`,
      E.cookie,
      editBody,
    );
    report(
      "C3 : plan Pro en cours → modification directe d'une offre active acceptée ; l'offre quitte la liste publique (signal public)",
      edited.status === 200 &&
        (edited.body.job as { status?: string })?.status === "pending_review" &&
        (await waitSignal(lPubK1, mPubEdit, "jobs", jobEditOk)),
      { status: edited.status, code: edited.body.code },
    );
    const listAfterEdit = await http("GET", "/api/jobs?limit=100", K1.cookie);
    report(
      "J11 : relecture → l'offre repassée en modération n'est plus dans la liste du candidat",
      !((listAfterEdit.body.jobs ?? []) as { id: string }[]).some(
        (j) => j.id === jobEditOk,
      ),
    );
    const wait = Date.parse(expiresAt) - Date.now() + 500;
    if (wait > 0) await sleep(wait);
    const st2 = await accountState(E);
    const { data: stored } = await serviceClient
      .from("company_profiles")
      .select("subscription_plan, updated_at")
      .eq("id", coE)
      .single();
    report(
      "C4 : échéance atteinte sans écriture SQL → plan effectif « free », plan stocké inchangé",
      st2?.company?.effective_plan === "free" &&
        stored?.subscription_plan === "pro",
      {
        effective: st2?.company?.effective_plan,
        stored: stored?.subscription_plan,
      },
    );
    const lateEdit = await http("PATCH", `/api/jobs/${jobEditLate}`, E.cookie, {
      ...editBody,
      title: "Trop tard",
    });
    report(
      "C5 : action soumise depuis l'écran périmé après l'échéance → refusée (job_locked_plan)",
      lateEdit.status === 403 && lateEdit.body.code === "job_locked_plan",
      { status: lateEdit.status, code: lateEdit.body.code },
    );
    const mK1s = mark(lK1);
    const mK1bs = mark(lK1b);
    await serviceClient
      .from("users")
      .update({ role: "candidate_premium" })
      .eq("id", idK1);
    await serviceClient
      .from("candidate_profiles")
      .update({ premium_until: new Date(Date.now() + 4_000).toISOString() })
      .eq("id", cK1);
    report(
      "C6 : premium candidat activé → ses deux onglets reçoivent (subscription)",
      (await waitSignal(lK1, mK1s, "subscription")) &&
        (await waitSignal(lK1b, mK1bs, "subscription")),
    );
    const p1 = await accountState(K1);
    await sleep(4_500);
    const p2 = await accountState(K1);
    report(
      "C7 : premium effectif puis échu sans écriture SQL",
      p1?.candidate?.premium === true && p2?.candidate?.premium === false,
      { before: p1?.candidate, after: p2?.candidate },
    );
    await serviceClient
      .from("users")
      .update({ role: "candidate" })
      .eq("id", idK1);

    // Suppression d'une offre active : retrait public.
    const jobDel = await mkActive("À supprimer");
    const mPubDel = mark(lPubK3);
    const del = await http("DELETE", `/api/jobs/${jobDel}`, E.cookie);
    report(
      "J12 : suppression d'une offre active → canal public (id), entreprise",
      del.status === 200 && (await waitSignal(lPubK3, mPubDel, "jobs", jobDel)),
      { status: del.status, code: del.body.code },
    );

    // ── B. Comptes et droits ────────────────────────────────────
    console.log("\n── B. Comptes et droits ──");
    // Candidature en attente pour la sélection « périmée ».
    const jobStale = await mkActive("Sélection périmée");
    const { data: appStale } = await K2.rt.rpc("apply_to_job", {
      p_job_id: jobStale,
    });
    mE = mark(lE);
    mAd = mark(lAdm);
    const suspend = await http("POST", "/api/admin/companies", A.cookie, {
      user_id: idE,
      action: "suspend",
    });
    // Sélection envoyée immédiatement avec l'ancienne session (avant tout
    // traitement du signal par le client).
    const staleSelect = await http(
      "POST",
      `/api/applications/${appStale!.id}/select`,
      E.cookie,
    );
    report(
      "B1 : sélection tentée avec l'ancienne session juste après la suspension → refusée (account_suspended)",
      suspend.status === 200 &&
        staleSelect.status === 403 &&
        staleSelect.body.code === "account_suspended",
      {
        suspend: suspend.status,
        select: staleSelect.status,
        code: staleSelect.body.code,
      },
    );
    report(
      "B2 : suspension → l'entreprise reçoit (account) et (notifications) ; l'admin (account)",
      (await waitSignal(lE, mE, "account", idE)) &&
        (await waitSignal(lE, mE, "notifications")) &&
        (await waitSignal(lAdm, mAd, "account")),
    );
    const stSusp = await accountState(E);
    const pubSusp = await listen(E.rt, "jobs:public");
    report(
      "B3 : relecture → compte inactif ; le canal des offres est refusé, le canal personnel reste ouvert",
      stSusp?.is_active === false &&
        !pubSusp.ok &&
        lE.statuses.at(-1) === "SUBSCRIBED",
      { active: stSusp?.is_active, pub: pubSusp.ok || pubSusp.error },
    );
    const { data: appStaleRow } = await serviceClient
      .from("job_applications")
      .select("status")
      .eq("id", appStale!.id)
      .single();
    report(
      "B4 : la candidature reste en attente",
      appStaleRow?.status === "pending",
      appStaleRow,
    );
    mE = mark(lE);
    const reactivate = await http("POST", "/api/admin/companies", A.cookie, {
      user_id: idE,
      action: "activate",
    });
    report(
      "B5 : réactivation → l'entreprise reçoit (account)",
      reactivate.status === 200 && (await waitSignal(lE, mE, "account", idE)),
    );

    // Admin suspendu (lot 10, AUDIT.md §28) : le signal privé de suspension
    // arrive sur user:<uid>, le canal admin n'est plus accordé ; la
    // réactivation le rend. Session et socket d'origine conservées.
    const mSus = mark(lD);
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idD);
    const stSus = await accountState(D);
    const susAdmin = await listen(D.rt, "admin");
    if (susAdmin.ok) await susAdmin.l.close();
    report(
      "B5b : admin suspendu → (account) reçu sur son canal privé, relecture is_active = false, nouveau canal admin refusé",
      (await waitSignal(lD, mSus, "account", idD)) &&
        stSus?.is_active === false &&
        !susAdmin.ok,
      { is_active: stSus?.is_active, join: susAdmin.ok || susAdmin.error },
    );
    const mRe = mark(lD);
    await serviceClient.from("users").update({ is_active: true }).eq("id", idD);
    const stRe = await accountState(D);
    const reJoin = await listen(D.rt, "admin");
    if (reJoin.ok) await reJoin.l.close();
    report(
      "B5c : réactivation de l'admin → (account) reçu, is_active = true, canal admin de nouveau accordé",
      (await waitSignal(lD, mRe, "account", idD)) &&
        stRe?.is_active === true &&
        reJoin.ok,
      { is_active: stRe?.is_active, join: reJoin.ok || reJoin.error },
    );

    // Grade puis rôle admin.
    let mDl = mark(lD);
    await serviceClient
      .from("users")
      .update({ role: "admin_support" })
      .eq("id", idD);
    const stD1 = await accountState(D);
    report(
      "B6 : changement de grade (admin_ops → admin_support) → l'admin reçoit (account) ; relecture du grade",
      (await waitSignal(lD, mDl, "account", idD)) &&
        stD1?.role === "admin_support",
      stD1?.role,
    );
    const suspendBySupport = await http(
      "POST",
      "/api/admin/companies",
      D.cookie,
      {
        user_id: idE,
        action: "suspend",
      },
    );
    report(
      "B7 : action admin périmée (suspension par l'ancien grade) → refusée",
      suspendBySupport.status === 403 || suspendBySupport.status === 401,
      { status: suspendBySupport.status, code: suspendBySupport.body.code },
    );
    mDl = mark(lD);
    await serviceClient
      .from("users")
      .update({ role: "candidate" })
      .eq("id", idD);
    const stD2 = await accountState(D);
    const reAdmin = await listen(D.rt, "admin");
    report(
      "B8 : perte du rôle admin → (account) reçu, relecture is_admin = false, nouveau canal admin refusé",
      (await waitSignal(lD, mDl, "account", idD)) &&
        stD2?.is_admin === false &&
        !reAdmin.ok,
      { is_admin: stD2?.is_admin, join: reAdmin.ok || reAdmin.error },
    );
    // Canal admin déjà ouvert (client qui ignorerait le signal) : mesure.
    const mDAdm = mark(lDAdm);
    const mAAdm = mark(lAdm);
    await serviceClient
      .from("company_profiles")
      .update({ description: "Après rétrogradation" })
      .eq("id", coT);
    const activeAdminGot = await waitSignal(lAdm, mAAdm, "profile");
    await sleep(800);
    const leaked = since(lDAdm, mDAdm);
    report(
      "B9 : canal admin resté ouvert après rétrogradation (client qui ignorerait le signal) : l'admin actif reçoit le signal ; l'ancien canal, au plus un domaine sans identifiant",
      activeAdminGot &&
        leaked.every(
          (e) =>
            Object.keys(e.payload).every((k) => ["d", "r", "id"].includes(k)) &&
            e.payload.r === null,
        ),
      { activeAdminGot, demotedReceived: leaked.map((e) => e.payload.d) },
    );

    // ── R. Reconnexion ──────────────────────────────────────────
    console.log("\n── R. Reconnexion ──");
    const jobRec = await mkActive("Reconnexion");
    const { data: appRec } = await K3.rt.rpc("apply_to_job", {
      p_job_id: jobRec,
    });
    const beforeCut = await http(
      "GET",
      `/api/jobs/${jobRec}/applications`,
      E.cookie,
    );
    const hadIt = (
      (beforeCut.body.applications ?? []) as { application_id: string }[]
    ).some((a) => a.application_id === appRec!.id);
    const joinsBefore = lE.statuses.filter((s) => s === "SUBSCRIBED").length;
    const mCut = mark(lE);
    // Perte de réseau simulée : fermeture brutale du WebSocket (pas de
    // disconnect() volontaire), realtime-js reprogramme la connexion.
    (
      E.rt.realtime as unknown as {
        socketAdapter: { socket: { conn: { close: () => void } | null } };
      }
    ).socketAdapter.socket.conn?.close();
    await K3.rt.rpc("withdraw_job_application", { p_job_id: jobRec });
    await serviceClient.from("job_applications").delete().eq("id", appRec!.id);
    const rejoinEnd = Date.now() + 20_000;
    while (
      lE.statuses.filter((s) => s === "SUBSCRIBED").length <= joinsBefore &&
      Date.now() < rejoinEnd
    ) {
      await sleep(100);
    }
    const rejoined =
      lE.statuses.filter((s) => s === "SUBSCRIBED").length > joinsBefore;
    const deliveredAfterCut = since(lE, mCut).length;
    const afterCut = await http(
      "GET",
      `/api/jobs/${jobRec}/applications`,
      E.cookie,
    );
    report(
      "R1 : coupure réseau → canal rejoint automatiquement (nouveau SUBSCRIBED, déclencheur de la relecture) ; la relecture ne contient plus la candidature supprimée",
      hadIt &&
        rejoined &&
        !(
          (afterCut.body.applications ?? []) as { application_id: string }[]
        ).some((a) => a.application_id === appRec!.id),
      { hadIt, rejoined, deliveredAfterCut, statuses: lE.statuses },
    );
    const mAfter = mark(lE);
    await serviceClient.from("notifications").insert({
      user_id: idE,
      notification_type: "system",
      title: "Après reprise",
      body: "x",
    });
    report(
      "R2 : après la reprise, les signaux arrivent de nouveau",
      await waitSignal(lE, mAfter, "notifications"),
    );

    // ── S. Changement de compte sur le même client ──────────────
    console.log("\n── S. Changement de compte ──");
    const shared = await rtClient(mail("k2"));
    clients.push(shared);
    const lShared = await mustListen(shared, `user:${idK2}`);
    await shared.removeChannel(
      shared.getChannels().find((c) => c.topic === `realtime:user:${idK2}`)!,
    );
    await shared.auth.signOut();
    await shared.auth.signInWithPassword({
      email: mail("k3"),
      password: PROOF_PASSWORD,
    });
    await shared.realtime.setAuth();
    const lSharedK3 = await mustListen(shared, `user:${idK3}`);
    const mS2 = mark(lShared);
    const mS3 = mark(lSharedK3);
    await serviceClient.from("notifications").insert([
      {
        user_id: idK2,
        notification_type: "system",
        title: "Pour K2",
        body: "privé",
      },
      {
        user_id: idK3,
        notification_type: "system",
        title: "Pour K3",
        body: "privé",
      },
    ]);
    const k3Got = await waitSignal(lSharedK3, mS3, "notifications");
    await sleep(800);
    const reK2 = await listen(shared, `user:${idK2}`);
    report(
      "S1 : après déconnexion de K2 et connexion de K3 sur le même client : signaux de K3 seulement, canal de K2 refusé",
      k3Got && since(lShared, mS2).length === 0 && !reK2.ok,
      {
        k3Got,
        k2After: since(lShared, mS2).length,
        rejoinK2: reK2.ok || reK2.error,
      },
    );

    // ── X. Confidentialité des messages reçus ───────────────────
    console.log("\n── X. Confidentialité ──");
    const allPayloads = listeners.flatMap((l) =>
      l.events.map((e) => e.payload),
    );
    const badKeys = allPayloads.filter(
      (p) => !Object.keys(p).every((k) => ["d", "r", "id"].includes(k)),
    );
    report(
      `X1 : ${allPayloads.length} messages reçus, tous de la forme {d, r, id}`,
      allPayloads.length > 30 && badKeys.length === 0,
      badKeys.slice(0, 3),
    );
    const { data: ips } = await serviceClient
      .from("contracts")
      .select("candidate_ip, company_ip")
      .eq("id", contractId)
      .single();
    const secrets = [
      completionCode,
      MOMO,
      ips?.candidate_ip ?? "",
      ips?.company_ip ?? "",
      `${idK1}/cni-front.jpg`,
      "cni-selfie",
      mail("k1"),
      "Pour K2",
      "Très bien",
    ].filter((s) => s.length >= 6);
    const leaks = secrets.filter((s) => RAW.some((r) => r.includes(s)));
    report(
      "X2 : aucun message brut ne contient code de fin, MoMo, IP de signature, chemin CNI, email, titre ou texte privé",
      leaks.length === 0 && completionCode.length === 6,
      leaks,
    );
  } finally {
    for (const l of listeners) await l.close().catch(() => {});
    for (const c of clients) {
      await c.removeAllChannels().catch(() => {});
      c.realtime.disconnect();
    }
    await cleanAccounts(created);
  }

  console.log(`\n${passCount} PASS / ${failCount} FAIL`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
