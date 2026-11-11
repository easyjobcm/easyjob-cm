/**
 * Preuve lot 11 — offres d'une entreprise qui perd la validation complète
 * de son dossier (décision produit du 2026-11-11).
 *
 * Données fictives, pile locale uniquement. Vraies sessions : entreprise A,
 * candidats C1 (a postulé), C2 (sélectionné : mission et contrat), C3
 * (nouveau candidat), C4 et C5 (courses), admin_ops O, client anonyme.
 *
 *   V. Entreprise validée : offre visible (liste, détail, lecture directe),
 *      candidature et sélection possibles.
 *   M. Remise en revue (A modifie sa raison sociale) : offre masquée aux
 *      nouveaux candidats et à l'anonyme (liste, route, page, lecture
 *      directe), candidature et sélection refusées sans effet ; statut de
 *      l'offre inchangé ; candidature existante lisible, retrait préservé ;
 *      relance d'une sélection réussie sans nouvel effet ; contrat signé,
 *      mission démarrée, code de fin et avis toujours possibles ; accès de
 *      l'entreprise et de l'admin conservés ; signaux Realtime { d, r }.
 *   R. Courses (ordre imposé par synchronisation explicite) : candidature
 *      puis remise en revue, remise en revue puis candidature, sélection
 *      puis remise en revue, remise en revue puis sélection.
 *   D. Dépendances entre contrôles : nom légal, raison sociale, numéro
 *      RCCM, attestation NIU, représentant ; NIU en lecture seule pour
 *      l'entreprise ; historique conservé ; décision sur une ancienne
 *      version refusée.
 *   B. Retour après validation : comportement actuel observé (retour
 *      automatique de l'offre encore active) ; la règle reste à décider.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L11-visibility-01!";
const PROOF_USER_METADATA = { proofDossierVisibility: true };
const STAMP = Date.now();

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

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
  await client.realtime.setAuth();
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
  const r = runSupabaseQuery(DB_URL, sql, {
    proof: "company-dossier-visibility",
  });
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
}

const SLOW = [
  "proof_l11v_slow_application_insert",
  "proof_l11v_slow_application_update",
  "proof_l11v_slow_company_update",
];
function dropSlowTriggers() {
  execSql(
    "drop trigger if exists proof_l11v_slow_application_insert on public.job_applications",
  );
  execSql(
    "drop trigger if exists proof_l11v_slow_application_update on public.job_applications",
  );
  execSql(
    "drop trigger if exists proof_l11v_slow_company_update on public.company_profiles",
  );
  for (const fn of SLOW) execSql(`drop function if exists public.${fn}()`);
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
      niu: `M0${String(STAMP).slice(-9)}${name.length}V`,
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
      last_name: "Visibilité",
      date_of_birth: "1995-03-12",
      city: "Douala",
      address: "Akwa",
      latitude: 4.05,
      longitude: 9.7,
      cni_number: `CNI11V${firstName}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677007011",
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
  dropSlowTriggers();
  dropBarrier(execSql);
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofDossierVisibility === true)
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
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, raw };
}

const douala = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(d);

type Listener = {
  events: Record<string, unknown>[];
  close: () => Promise<void>;
};
async function listen(client: DB, topic: string): Promise<Listener | null> {
  const events: Record<string, unknown>[] = [];
  const ch = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "*" }, (m) => {
      events.push((m.payload ?? {}) as Record<string, unknown>);
    });
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(true);
      } else if (status === "CHANNEL_ERROR") {
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
  if (!ok) {
    await client.removeChannel(ch);
    return null;
  }
  return { events, close: async () => void (await client.removeChannel(ch)) };
}
async function waitFor(check: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
}

// ─── Preuve ──────────────────────────────────────────────────────
async function main() {
  console.log("Preuve lot 11 — visibilité des offres selon le dossier\n");
  await cleanStale();
  const ids: string[] = [];
  const listeners: Listener[] = [];
  let slow = false;
  try {
    const mail = (k: string) => `proof-l11v-${k}-${STAMP}@easyjob.test`;
    const idA = await createAccount(mail("a"), "company");
    const idD = await createAccount(mail("d"), "company");
    const idO = await createAccount(mail("ops"), "admin_ops");
    const cand = await Promise.all(
      ["c1", "c2", "c3", "c4", "c5"].map((k) =>
        createAccount(mail(k), "candidate"),
      ),
    );
    ids.push(idA, idD, idO, ...cand);
    const coA = await createCompany(idA, "Hôtel Visible SARL");
    const coD = await createCompany(idD, "Dépendances SARL");
    const candProfiles = await Promise.all(
      cand.map((id, i) => createCandidate(id, `Cand${i + 1}`)),
    );
    const A = await realSession(idA, mail("a"));
    const D = await realSession(idD, mail("d"));
    const O = await realSession(idO, mail("ops"));
    const [C1, C2, C3, C4, C5] = await Promise.all(
      cand.map((id, i) => realSession(id, mail(`c${i + 1}`))),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const today = douala(new Date());

    const seedJob = async (
      title: string,
      positions = 3,
      startDate: string = today,
    ) => {
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          title,
          description: "Preuve de visibilité du lot 11.",
          address: "Boulevard de la Liberté",
          city: "Douala",
          start_date: startDate,
          start_time: "00:00",
          end_time: "23:59",
          mission_pay_per_candidate: 2000,
          company_id: coA,
          status: "active",
          positions_available: positions,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id as string;
    };
    const job1 = await seedJob("Réceptionniste visibilité L11");
    const TITLE = "Réceptionniste visibilité L11";

    const listIds = async (s: Session | null) => {
      const r = await http("GET", "/api/jobs?limit=100", s?.cookie ?? null);
      return ((r.body.jobs as { id: string }[] | undefined) ?? []).map(
        (j) => j.id,
      );
    };
    const directRead = async (client: DB) =>
      (
        (await client.from("jobs").select("id, title").eq("id", job1)).data ??
        []
      ).length;
    // `.then` envoie la requête tout de suite (les appels supabase-js sont
    // paresseux) : indispensable pour ordonner les courses.
    const apply = (s: Session, jobId: string) =>
      s.client.rpc("apply_to_job", { p_job_id: jobId }).then((r) => r);
    const select = (applicationId: string) =>
      http("POST", `/api/applications/${applicationId}/select`, A.cookie);
    const counts = async (jobId: string) => {
      const [m, c, a] = await Promise.all([
        serviceClient
          .from("missions")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId),
        serviceClient
          .from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId),
        serviceClient
          .from("job_applications")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId),
      ]);
      return { missions: m.count, contracts: c.count, applications: a.count };
    };
    const reReview = (name: string) =>
      A.client
        .from("company_profiles")
        .update({ company_name: name })
        .eq("user_id", idA)
        .then((r) => r);
    const statusOf = async () =>
      (
        await serviceClient
          .from("company_profiles")
          .select("verification_status")
          .eq("id", coA)
          .single()
      ).data?.verification_status;

    // ── V. Entreprise validée ───────────────────────────────────
    const v1Page = await http("GET", `/jobs/${job1}`, C3.cookie);
    report(
      "V1 : dossier valide → offre dans la liste (candidat et anonyme), détail 200, lecture directe, page de détail",
      (await listIds(C3)).includes(job1) &&
        (await listIds(null)).includes(job1) &&
        (await http("GET", `/api/jobs/${job1}`, C3.cookie)).status === 200 &&
        (await directRead(C3.client)) === 1 &&
        (await directRead(anon)) === 1 &&
        v1Page.status === 200 &&
        v1Page.raw.includes(TITLE) &&
        !v1Page.raw.includes('data-testid="job-unavailable"'),
      { page: v1Page.status },
    );
    const { data: app1 } = await apply(C1, job1);
    const { data: app2 } = await apply(C2, job1);
    const sel2 = await select(app2?.id ?? "");
    const selection2 = sel2.body.selection as
      | { mission_id: string; contract_id: string }
      | undefined;
    report(
      "V2 : candidatures possibles, sélection possible (mission et contrat créés)",
      !!app1 && !!app2 && sel2.status === 200 && !!selection2?.mission_id,
      { select: sel2.status },
    );

    // ── Préparation du retour après validation (section B) ──────
    // Offres qui deviendront inadmissibles pendant la revue, offre pleine,
    // offre datée d'hier, offre modifiée en attente de modération, et
    // conditions figées du contrat de C2.
    const jobCancel = await seedJob("Offre annulée pendant la revue L11");
    const jobExpired = await seedJob("Offre expirée pendant la revue L11");
    const jobFull = await seedJob("Offre complète L11", 1);
    const yesterday = douala(new Date(Date.now() - 86_400_000));
    const jobPast = await seedJob("Offre datée d'hier L11", 3, yesterday);
    const jobMod = await seedJob("Offre modifiée L11");
    const { data: appFull } = await apply(C5, jobFull);
    const selFull = await select(appFull?.id ?? "");
    // Modification directe d'une offre active : plan Pro (règle du lot 7d).
    await serviceClient
      .from("company_profiles")
      .update({ subscription_plan: "pro" })
      .eq("id", coA);
    const { error: modErr } = await A.client.rpc("update_job", {
      p_job_id: jobMod,
      p_job: {
        title: "Offre modifiée L11 (nouvelle version)",
        description: "Contenu modifié : nouvelle modération exigée.",
        address: "Boulevard de la Liberté",
        city: "Douala",
        start_date: today,
        start_time: "00:00",
        end_time: "23:59",
        mission_pay_per_candidate: 2000,
      },
    });
    const { data: modRow } = await serviceClient
      .from("jobs")
      .select("status, updated_at")
      .eq("id", jobMod)
      .single();
    const { data: contractBefore } = await serviceClient
      .from("contracts")
      .select("contract_data, contract_template, company_id, candidate_id")
      .eq("id", selection2?.contract_id ?? "")
      .single();
    report(
      "P0 : préparation → offre pleine (1 place prise), offre active modifiée renvoyée en modération (pending_review)",
      selFull.status === 200 && !modErr && modRow?.status === "pending_review",
      { full: selFull.status, mod: modErr?.message ?? modRow?.status },
    );

    // ── M. Remise en revue ──────────────────────────────────────
    const rtPublic = await listen(C3.client, "jobs:public");
    const rtC1 = await listen(C1.client, `user:${cand[0]}`);
    const rtA = await listen(A.client, `user:${idA}`);
    for (const l of [rtPublic, rtC1, rtA]) if (l) listeners.push(l);
    const before = await counts(job1);
    const { error: rrErr } = await reReview("Hôtel Visible Renommé SARL");
    const { data: jobRow } = await serviceClient
      .from("jobs")
      .select("status")
      .eq("id", job1)
      .single();
    report(
      "M0 : raison sociale modifiée par l'entreprise → dossier en revue ; statut métier de l'offre inchangé (active), rien supprimé",
      !rrErr && (await statusOf()) === "pending" && jobRow?.status === "active",
      { status: await statusOf(), job: jobRow?.status },
    );

    const m1Page = await http("GET", `/jobs/${job1}`, C3.cookie);
    const m1Avail = await C3.client.rpc("job_availability", {
      p_job_id: job1,
    });
    report(
      "M1 : nouveau candidat et anonyme → absente de la liste, détail 404, lecture directe vide, lien direct « indisponible » sans donnée",
      !(await listIds(C3)).includes(job1) &&
        !(await listIds(null)).includes(job1) &&
        (await http("GET", `/api/jobs/${job1}`, C3.cookie)).status === 404 &&
        (await http("GET", `/api/jobs/${job1}`, null)).status === 404 &&
        (await directRead(C3.client)) === 0 &&
        (await directRead(anon)) === 0 &&
        m1Avail.data === "unavailable" &&
        m1Page.raw.includes('data-testid="job-unavailable"') &&
        !m1Page.raw.includes(TITLE),
      { page: m1Page.status, availability: m1Avail.data },
    );

    const m2Rpc = await apply(C3, job1);
    const m2Route = await http("POST", `/api/jobs/${job1}/apply`, C4.cookie);
    report(
      "M2 : nouvelle candidature (RPC directe et route) → job_not_available, aucune ligne",
      m2Rpc.error?.message === "job_not_available" &&
        m2Route.status === 400 &&
        m2Route.body.code === "job_not_available" &&
        (await counts(job1)).applications === before.applications,
      { rpc: m2Rpc.error?.message, route: m2Route.body.code },
    );

    const m3Route = await select(app1?.id ?? "");
    const m3Rpc = await A.client.rpc("select_candidate", {
      p_application_id: app1?.id ?? "",
    });
    const { data: app1Row } = await serviceClient
      .from("job_applications")
      .select("status")
      .eq("id", app1?.id ?? "")
      .single();
    report(
      "M3 : nouvelle sélection (route et RPC directe) → company_not_verified, candidature toujours en attente, aucun engagement",
      m3Route.status === 403 &&
        m3Route.body.code === "company_not_verified" &&
        m3Rpc.error?.message === "company_not_verified" &&
        app1Row?.status === "pending" &&
        JSON.stringify(await counts(job1)) === JSON.stringify(before),
      { route: m3Route.body.code, rpc: m3Rpc.error?.message },
    );

    const reselect = await select(app2?.id ?? "");
    const reselection = reselect.body.selection as
      | { mission_id: string; contract_id: string; already_selected: boolean }
      | undefined;
    report(
      "M4 : relance d'une sélection déjà réussie → même mission, même contrat, aucun nouvel engagement",
      reselect.status === 200 &&
        reselection?.mission_id === selection2?.mission_id &&
        reselection?.contract_id === selection2?.contract_id &&
        JSON.stringify(await counts(job1)) === JSON.stringify(before),
      { status: reselect.status },
    );

    const { data: c1Job } = await C1.client
      .from("jobs")
      .select("id, title")
      .eq("id", job1);
    const { data: c1App } = await C1.client
      .from("job_applications")
      .select("id, status")
      .eq("job_id", job1);
    const c1Detail = await http("GET", `/api/jobs/${job1}`, C1.cookie);
    const c1Page = await http("GET", `/jobs/${job1}`, C1.cookie);
    report(
      "M5 : candidat ayant postulé → offre et candidature toujours lisibles, détail avec avis « plus de nouvelles candidatures »",
      (c1Job ?? []).length === 1 &&
        (c1App ?? []).length === 1 &&
        c1Detail.status === 200 &&
        c1Page.raw.includes(TITLE) &&
        c1Page.raw.includes('data-testid="job-unavailable-notice"'),
      { detail: c1Detail.status },
    );
    const { data: aJob } = await A.client
      .from("jobs")
      .select("id")
      .eq("id", job1);
    const { data: aApplicants, error: aApplicantsErr } = await A.client.rpc(
      "company_job_applicants",
      { p_job_id: job1 },
    );
    const { data: oJob } = await O.client
      .from("jobs")
      .select("id")
      .eq("id", job1);
    report(
      "M6 : entreprise propriétaire (offre, candidats) et admin gardent leur accès",
      (aJob ?? []).length === 1 &&
        !aApplicantsErr &&
        (aApplicants ?? []).length === 2 &&
        (oJob ?? []).length === 1,
      { applicants: aApplicants?.length },
    );

    // Engagements existants : signature, début, code, avis.
    const contractView = await http(
      "GET",
      `/api/contracts/${selection2?.contract_id}`,
      C2.cookie,
    );
    const termsHash = (
      contractView.body.contract as { terms_hash?: string } | undefined
    )?.terms_hash;
    const signed = await http(
      "POST",
      `/api/contracts/${selection2?.contract_id}/sign`,
      C2.cookie,
      { terms_hash: termsHash, consent: true },
    );
    const started = await http(
      "POST",
      `/api/missions/${selection2?.mission_id}/start`,
      C2.cookie,
    );
    const { data: codeRow } = await serviceClient
      .from("mission_completion_codes")
      .select("code")
      .eq("mission_id", selection2?.mission_id ?? "")
      .single();
    const completed = await http(
      "POST",
      `/api/missions/${selection2?.mission_id}/complete`,
      C2.cookie,
      { code: codeRow?.code },
    );
    const reviewed = await http(
      "POST",
      `/api/missions/${selection2?.mission_id}/review`,
      C2.cookie,
      { rating: 5, comment: "Mission de preuve" },
    );
    const companyReview = await http(
      "POST",
      `/api/missions/${selection2?.mission_id}/review`,
      A.cookie,
      { rating: 5 },
    );
    report(
      "M7 : engagement existant conservé → contrat consulté et signé, mission démarrée, code de fin accepté, avis des deux parties",
      contractView.status === 200 &&
        signed.status === 200 &&
        started.status === 200 &&
        completed.status === 200 &&
        reviewed.status === 200 &&
        companyReview.status === 200,
      {
        view: contractView.status,
        sign: signed.status,
        start: started.status,
        complete: completed.status,
        review: [reviewed.status, companyReview.status],
      },
    );
    const withdraw = await C1.client.rpc("withdraw_job_application", {
      p_job_id: job1,
    });
    const { data: c1After } = await serviceClient
      .from("job_applications")
      .select("status")
      .eq("id", app1?.id ?? "")
      .single();
    report(
      "M8 : retrait d'une candidature en attente → règles existantes (withdrawn), ligne conservée et lisible",
      !withdraw.error &&
        c1After?.status === "withdrawn" &&
        (await directRead(C1.client)) === 1,
      { error: withdraw.error?.message, status: c1After?.status },
    );
    const rtOk = await waitFor(
      () =>
        !!rtPublic?.events.some((p) => p.d === "jobs" && p.r === job1) &&
        !!rtC1?.events.some((p) => p.d === "jobs" && p.r === job1) &&
        !!rtA?.events.some((p) => p.d === "jobs"),
    );
    report(
      "M9 : signaux jobs:public, candidat ayant postulé et entreprise (domaine jobs), charge { d, r } seule",
      rtOk &&
        [rtPublic, rtC1, rtA]
          .flatMap((l) => l?.events ?? [])
          .every((p) =>
            Object.keys(p).every((k) => ["d", "r", "id"].includes(k)),
          ),
      {
        public: rtPublic?.events.length,
        c1: rtC1?.events.length,
        a: rtA?.events.length,
      },
    );

    // ── B. Retour après validation (décision du 2026-11-11) ─────
    // Pendant la revue : deux offres deviennent inadmissibles (statuts
    // posés hors parcours entreprise, comme le ferait un admin).
    await serviceClient
      .from("jobs")
      .update({ status: "cancelled" })
      .eq("id", jobCancel);
    await serviceClient
      .from("jobs")
      .update({ status: "expired" })
      .eq("id", jobExpired);
    const publicBefore = (rtPublic?.events ?? []).filter(
      (p) => p.r === job1,
    ).length;
    await approveCompanyDossier(serviceClient, coA);
    const rtBack = await waitFor(
      () =>
        (rtPublic?.events ?? []).filter((p) => p.r === job1).length >
        publicBefore,
    );
    const { data: app4b } = await apply(C4, job1);
    const sel4b = app4b ? await select(app4b.id) : null;
    report(
      "B1 : dossier revalidé → offre active inchangée de retour (liste, lien direct, lecture directe), signal jobs:public reçu sans rechargement, candidature et sélection de nouveau possibles",
      (await listIds(C3)).includes(job1) &&
        (await listIds(null)).includes(job1) &&
        (await directRead(C3.client)) === 1 &&
        (await C3.client.rpc("job_availability", { p_job_id: job1 })).data ===
          "available" &&
        rtBack &&
        !!app4b &&
        sel4b?.status === 200,
      { realtime: rtBack, select: sel4b?.status },
    );

    const readJob = async (client: DB, id: string) =>
      ((await client.from("jobs").select("id").eq("id", id)).data ?? []).length;
    const inadmissible: Record<string, unknown> = {};
    let b2ok = true;
    for (const [label, id] of [
      ["annulée", jobCancel],
      ["expirée", jobExpired],
    ] as const) {
      const r = {
        list: (await listIds(C3)).includes(id),
        read: await readJob(C3.client, id),
        anon: await readJob(anon, id),
        availability: (
          await C3.client.rpc("job_availability", { p_job_id: id })
        ).data,
        apply: (await apply(C3, id)).error?.message,
      };
      inadmissible[label] = r;
      b2ok &&=
        !r.list &&
        r.read === 0 &&
        r.anon === 0 &&
        r.availability === "not_found" &&
        r.apply === "job_not_available";
    }
    const fullApply = await apply(C3, jobFull);
    const { data: appFullRow } = await serviceClient
      .from("job_applications")
      .select("id")
      .eq("job_id", jobFull)
      .eq("candidate_id", candProfiles[2]);
    report(
      "B2 : offres devenues annulée ou expirée pendant la revue → toujours invisibles et fermées après revalidation ; offre pleine → candidature refusée (no_positions)",
      b2ok &&
        fullApply.error?.message === "no_positions" &&
        (appFullRow ?? []).length === 0,
      { ...inadmissible, full: fullApply.error?.message },
    );

    // Règle existante de date : seule la liste filtre start_date. Mesure
    // informative (aucune règle d'expiration en base, avant comme après
    // le lot 11) : rapportée, pas transformée en assertion.
    const pastInfo = {
      list: (await listIds(C3)).includes(jobPast),
      directRead: await readJob(C3.client, jobPast),
      availability: (
        await C3.client.rpc("job_availability", { p_job_id: jobPast })
      ).data,
      apply: (await apply(C3, jobPast)).error?.message ?? "acceptée",
    };
    report(
      "B3 : offre datée d'hier → absente de la liste après revalidation (règle de date existante)",
      !pastInfo.list,
      pastInfo,
    );
    console.log(
      `ℹ️  Offre active datée d'hier (règle existante, inchangée par le lot 11) : lien direct ${pastInfo.directRead === 1 ? "lisible" : "illisible"}, disponibilité « ${pastInfo.availability} », candidature ${pastInfo.apply}.`,
    );

    const modAfter = await serviceClient
      .from("jobs")
      .select("status, updated_at")
      .eq("id", jobMod)
      .single();
    const modApplyErr = (await apply(C3, jobMod)).error?.message;
    const staleModeration = await http(
      "POST",
      `/api/admin/jobs/${jobMod}/moderate`,
      O.cookie,
      { action: "approve", seen_updated_at: "2020-01-01T00:00:00.000Z" },
    );
    const modStill = await serviceClient
      .from("jobs")
      .select("status")
      .eq("id", jobMod)
      .single();
    report(
      "B4 : offre modifiée en attente de modération → reste non publique après revalidation (statut, lecture, disponibilité, candidature) ; approbation sur une version ancienne refusée (job_changed)",
      modAfter.data?.status === "pending_review" &&
        (await readJob(C3.client, jobMod)) === 0 &&
        !(await listIds(C3)).includes(jobMod) &&
        (await C3.client.rpc("job_availability", { p_job_id: jobMod })).data ===
          "not_found" &&
        modApplyErr === "job_not_available" &&
        staleModeration.status === 409 &&
        staleModeration.body.code === "job_changed" &&
        modStill.data?.status === "pending_review",
      { apply: modApplyErr, moderation: staleModeration.body.code },
    );
    const freshModeration = await http(
      "POST",
      `/api/admin/jobs/${jobMod}/moderate`,
      O.cookie,
      { action: "approve", seen_updated_at: modAfter.data?.updated_at },
    );
    report(
      "B5 : seule une nouvelle modération de la version modifiée la publie",
      freshModeration.status === 200 &&
        (await readJob(C3.client, jobMod)) === 1,
      { moderation: freshModeration.status },
    );

    const { data: contractAfter } = await serviceClient
      .from("contracts")
      .select("contract_data, contract_template, company_id, candidate_id")
      .eq("id", selection2?.contract_id ?? "")
      .single();
    const editSelected = await A.client.rpc("update_job", {
      p_job_id: job1,
      p_job: {
        title: "Réceptionniste visibilité L11 (modifiée)",
        description: "Tentative de modification après sélection.",
        address: "Autre adresse",
        city: "Douala",
        start_date: today,
        start_time: "00:00",
        end_time: "23:59",
        mission_pay_per_candidate: 9000,
      },
    });
    report(
      "B6 : conditions figées du contrat existant identiques après revue et revalidation ; modification de l'offre avec candidat sélectionné refusée (job_has_selected_candidates)",
      JSON.stringify(contractAfter) === JSON.stringify(contractBefore) &&
        editSelected.error?.message === "job_has_selected_candidates",
      { edit: editSelected.error?.message },
    );

    // Compte suspendu : la revalidation du dossier ne rétablit pas les
    // actions interdites par la suspension (règles existantes).
    const { data: app3 } = await apply(C3, job1);
    const suspend = await http("POST", "/api/admin/companies", O.cookie, {
      user_id: idA,
      action: "suspend",
    });
    await serviceClient
      .from("company_profiles")
      .update({ company_name: "Hôtel Visible Suspendu SARL" })
      .eq("id", coA);
    await approveCompanyDossier(serviceClient, coA);
    const suspSelect = await A.client.rpc("select_candidate", {
      p_application_id: app3?.id ?? "",
    });
    const suspCreate = await A.client.rpc("create_job", {
      p_job: {
        title: "Offre d'un compte suspendu",
        description: "Ne doit pas être créée.",
        address: "Boulevard de la Liberté",
        city: "Douala",
        start_date: today,
        start_time: "00:00",
        end_time: "23:59",
        mission_pay_per_candidate: 2000,
      },
    });
    const suspDossier = await statusOf();
    const suspVisible = (await listIds(C3)).includes(job1);
    report(
      "B7 : compte entreprise suspendu puis dossier revalidé → sélection et création d'offre toujours refusées (account_suspended)",
      suspend.status === 200 &&
        !!app3 &&
        suspDossier === "verified" &&
        suspSelect.error?.message === "account_suspended" &&
        suspCreate.error?.message === "account_suspended",
      {
        select: suspSelect.error?.message,
        create: suspCreate.error?.message,
      },
    );
    console.log(
      `ℹ️  Visibilité d'une offre d'un compte suspendu au dossier valide (règles de suspension inchangées) : ${suspVisible ? "visible" : "masquée"}.`,
    );
    const reactivate = await http("POST", "/api/admin/companies", O.cookie, {
      user_id: idA,
      action: "activate",
    });
    if (reactivate.status !== 200) throw new Error("réactivation de A");

    // ── R. Courses (ordre imposé) ───────────────────────────────
    slow = true;
    await installBarrier(execSql, serviceClient);
    const job2 = await seedJob("Plonge course L11", 5);

    // R1 : candidature engagée, puis remise en revue.
    execSql(`
      create or replace function public.proof_l11v_slow_application_insert() returns trigger
      language plpgsql as $$ begin
        if new.job_id = '${job2}'::uuid then perform pg_sleep(2); end if;
        return new;
      end $$`);
    execSql(`
      create trigger proof_l11v_slow_application_insert after insert on public.job_applications
        for each row execute function public.proof_l11v_slow_application_insert()`);
    const r1Apply = apply(C4, job2);
    await waitSleeping(serviceClient);
    const r1Review = reReview("Hôtel Course Un SARL");
    const [r1a, r1r] = await Promise.all([r1Apply, r1Review]);
    execSql(
      "drop trigger if exists proof_l11v_slow_application_insert on public.job_applications",
    );
    report(
      "R1 : candidature engagée avant la remise en revue → candidature conservée, puis dossier en revue",
      !r1a.error && !r1r.error && (await statusOf()) === "pending",
      { apply: r1a.error?.message, review: r1r.error?.message },
    );

    // R2 : remise en revue engagée, puis candidature.
    await approveCompanyDossier(serviceClient, coA);
    execSql(`
      create or replace function public.proof_l11v_slow_company_update() returns trigger
      language plpgsql as $$ begin
        if new.id = '${coA}'::uuid and new.verification_status = 'pending' then
          perform pg_sleep(2);
        end if;
        return null;
      end $$`);
    execSql(`
      create trigger proof_l11v_slow_company_update after update on public.company_profiles
        for each row execute function public.proof_l11v_slow_company_update()`);
    const r2Review = reReview("Hôtel Course Deux SARL");
    await waitSleeping(serviceClient);
    const r2Apply = apply(C5, job2);
    const [r2r, r2a] = await Promise.all([r2Review, r2Apply]);
    const { count: c5Apps } = await serviceClient
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job2)
      .eq("candidate_id", candProfiles[4]);
    report(
      "R2 : remise en revue engagée avant la candidature → candidature refusée (job_not_available) après le commit, aucune ligne",
      !r2r.error && r2a.error?.message === "job_not_available" && c5Apps === 0,
      { apply: r2a.error?.message },
    );

    // R3 : sélection engagée, puis remise en revue.
    await approveCompanyDossier(serviceClient, coA);
    const { data: app4 } = await serviceClient
      .from("job_applications")
      .select("id")
      .eq("job_id", job2)
      .eq("candidate_id", candProfiles[3])
      .single();
    execSql(`
      create or replace function public.proof_l11v_slow_application_update() returns trigger
      language plpgsql as $$ begin
        if new.id = '${app4?.id}'::uuid and new.status = 'selected' then
          perform pg_sleep(2);
        end if;
        return null;
      end $$`);
    execSql(`
      create trigger proof_l11v_slow_application_update after update on public.job_applications
        for each row execute function public.proof_l11v_slow_application_update()`);
    const r3Select = select(app4?.id ?? "");
    await waitSleeping(serviceClient);
    const r3Review = reReview("Hôtel Course Trois SARL");
    const [r3s, r3r] = await Promise.all([r3Select, r3Review]);
    const { count: r3Missions } = await serviceClient
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("application_id", app4?.id ?? "");
    report(
      "R3 : sélection engagée avant la remise en revue → mission et contrat conservés, puis dossier en revue",
      r3s.status === 200 &&
        !r3r.error &&
        r3Missions === 1 &&
        (await statusOf()) === "pending",
      { select: r3s.status, missions: r3Missions },
    );
    execSql(
      "drop trigger if exists proof_l11v_slow_application_update on public.job_applications",
    );

    // R4 : remise en revue engagée, puis sélection.
    await approveCompanyDossier(serviceClient, coA);
    const { data: app5 } = await apply(C3, job2);
    const r4Review = reReview("Hôtel Course Quatre SARL");
    await waitSleeping(serviceClient);
    const r4Select = select(app5?.id ?? "");
    const [r4r, r4s] = await Promise.all([r4Review, r4Select]);
    const { count: r4Missions } = await serviceClient
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("application_id", app5?.id ?? "");
    report(
      "R4 : remise en revue engagée avant la sélection → sélection refusée (company_not_verified) après le commit, aucun engagement",
      !!app5 &&
        !r4r.error &&
        r4s.status === 403 &&
        r4s.body.code === "company_not_verified" &&
        r4Missions === 0,
      { select: r4s.body.code, missions: r4Missions },
    );
    dropSlowTriggers();
    dropBarrier(execSql);
    slow = false;

    // ── D. Dépendances entre contrôles ──────────────────────────
    const revs = async () =>
      (
        await serviceClient
          .from("company_profiles")
          .select(
            "rccm_revision, niu_revision, representative_revision, verification_revision",
          )
          .eq("id", coD)
          .single()
      ).data!;
    const delta = async (change: () => PromiseLike<unknown>) => {
      const b = await revs();
      await change();
      const a = await revs();
      return [
        a.rccm_revision - b.rccm_revision,
        a.niu_revision - b.niu_revision,
        a.representative_revision - b.representative_revision,
      ].join(",");
    };
    const historyBefore = (
      await serviceClient
        .from("company_verification_checks")
        .select("id")
        .eq("company_id", coD)
    ).data?.length;
    const dView = await http(
      "GET",
      `/api/admin/companies/${coD}/verification`,
      O.cookie,
    );
    const seenRevision = (dView.body.dossier as { revision: number }).revision;
    const deps = {
      legalName: await delta(() =>
        serviceClient
          .from("company_profiles")
          .update({ legal_name: "Dépendances Société Anonyme" })
          .eq("id", coD),
      ),
      companyName: await delta(() =>
        D.client
          .from("company_profiles")
          .update({ company_name: "Dépendances Renommée SARL" })
          .eq("user_id", idD),
      ),
      rccmNumber: await delta(() =>
        D.client
          .from("company_profiles")
          .update({ rccm: "RC/DLA/2026/B/4242" })
          .eq("user_id", idD),
      ),
      niuDocument: await delta(() =>
        D.client
          .from("company_profiles")
          .update({ niu_document_path: `${idD}/niu-v2.pdf` })
          .eq("user_id", idD),
      ),
      representative: await delta(() =>
        D.client
          .from("company_profiles")
          .update({ representative_title: "Directeur général" })
          .eq("user_id", idD),
      ),
      neutral: await delta(() =>
        D.client
          .from("company_profiles")
          .update({ quartier: "Bonapriso" })
          .eq("user_id", idD),
      ),
    };
    report(
      "D1 : nom légal et raison sociale → RCCM, NIU et représentant invalidés ; numéro RCCM → RCCM et représentant ; attestation NIU → NIU ; représentant → représentant ; quartier → aucun",
      deps.legalName === "1,1,1" &&
        deps.companyName === "1,1,1" &&
        deps.rccmNumber === "1,0,1" &&
        deps.niuDocument === "0,1,0" &&
        deps.representative === "0,0,1" &&
        deps.neutral === "0,0,0",
      deps,
    );
    const { error: niuErr } = await D.client
      .from("company_profiles")
      .update({ niu: "M000000000000Q" })
      .eq("user_id", idD);
    const historyAfter = (
      await serviceClient
        .from("company_verification_checks")
        .select("id")
        .eq("company_id", coD)
    ).data?.length;
    // Dossier remis en revue : soumis à nouveau par la fixture, puis
    // décision sur la version lue avant les modifications.
    await serviceClient
      .from("company_profiles")
      .update({ verification_submitted_at: new Date().toISOString() })
      .eq("id", coD);
    const stale = await http(
      "POST",
      `/api/admin/companies/${coD}/checks`,
      O.cookie,
      {
        check: "rccm",
        decision: "approved",
        source: "official_registry",
        reference: "Consultation fictive",
        seen_revision: seenRevision,
        seen_check: null,
      },
    );
    const { data: dStatus } = await serviceClient
      .from("company_profiles")
      .select("verification_status")
      .eq("id", coD)
      .single();
    report(
      "D2 : NIU en lecture seule pour l'entreprise (42501), historique des contrôles conservé, dossier en revue, décision sur l'ancienne version refusée (company_changed)",
      niuErr?.code === "42501" &&
        historyAfter === historyBefore &&
        dStatus?.verification_status === "pending" &&
        stale.status === 409 &&
        stale.body.code === "company_changed",
      {
        niu: niuErr?.code,
        history: [historyBefore, historyAfter],
        stale: stale.body.code,
      },
    );
  } finally {
    for (const l of listeners) await l.close().catch(() => {});
    if (slow) {
      dropSlowTriggers();
      dropBarrier(execSql);
    }
    await cleanAccounts(ids);
    console.log(
      "Nettoyage : offres, candidatures, missions, contrats, profils et comptes supprimés.",
    );
  }
  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "visibilité des offres conforme (lot 11)" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve lot 11 (visibilité) échouée :", err);
  process.exit(1);
});
