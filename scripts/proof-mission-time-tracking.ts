/**
 * Preuve lot 7c (F-07 partie missions, F-10 partie suivi, F-30) — début de
 * mission, confirmation par code de fin et évaluations.
 *
 * Méthode :
 *   1. Fixtures en service role : entreprises A (offres) et B (tierce),
 *      candidats C1 à C3. Les candidatures passent par apply_to_job et la
 *      sélection par la route du lot 7a : missions, contrats et codes réels.
 *   2. Tentatives en sessions RÉELLES : routes de l'application avec les
 *      cookies, PostgREST et RPC directs avec le JWT. La clé service ne sert
 *      qu'aux fixtures, à la lecture des codes pour les tests, aux tentatives
 *      « de confiance » et aux relectures.
 *   3. Assertions (état relu en service role) :
 *      S. Sélection : deux candidats d'une même offre, deux codes à six
 *         chiffres distincts, relance sans changement, code visible par
 *         l'entreprise propriétaire seulement.
 *      E. Exposition : aucun code dans les réponses brutes candidat, les
 *         notifications ni en lecture directe.
 *      D. Début : trop tôt, ordre, relance, double clic, sans GPS.
 *      C. Code : code de l'autre candidat refusé, réessai, tentatives
 *         limitées (séquentielles et concurrentes), double clic, perte de
 *         réponse, contrat non signé, le second candidat reste non confirmé.
 *      R. Évaluations : obligatoire côté candidat (reprise avant notation,
 *         tâche de signature retrouvée), facultative côté entreprise, une
 *         seule par sens, étoiles du bon profil, tiers refusés.
 *      K. Contrat déjà signé : plus aucune tâche après la note.
 *      X. Tiers et écritures directes ; validation des heures supprimée.
 *      L. Mission sans code (antérieure, non reprise) : refus explicite.
 *   4. Nettoyage : notifications, avis, codes, événements, contrats,
 *      missions, candidatures, offres, profils, comptes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type TaskRow =
  Database["public"]["Functions"]["candidate_tasks"]["Returns"][number];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L7c-code-01!";
const PROOF_USER_METADATA = { proofMissionTracking: true };

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };
type Session = { client: DB; cookie: string };

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
  return { client, cookie };
}

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
      niu: `M7C${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  return data.id;
}

async function createCandidate(userId: string, firstName: string) {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: "Tâche",
      date_of_birth: "1996-04-20",
      city: "Douala",
      address: "Ndokoti",
      latitude: 4.0611,
      longitude: 9.7429,
      cni_number: `CNI7C${firstName}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677007004",
      momo_verified: true,
      onboarding_status: "completed",
      onboarding_step: 6,
      profile_completion_pct: 100,
      sandbox_level: 1,
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
      // Codes, événements et avis suivent la mission (ON DELETE CASCADE).
      await serviceClient.from("missions").delete().in("job_id", jobIds);
      await serviceClient
        .from("job_applications")
        .delete()
        .in("job_id", jobIds);
      await serviceClient.from("jobs").delete().in("id", jobIds);
    }
  }
  await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
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
      .filter((u) => u.user_metadata?.proofMissionTracking === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
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
  const send = () =>
    fetch(`${APP_URL}${url}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      redirect: "manual",
    });
  const res = await send().catch((error: { cause?: { code?: string } }) => {
    if (error?.cause?.code !== "ECONNRESET") throw error;
    return send();
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

const douala = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(d);

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();

  const suffix = Date.now();
  const mail = (k: string) => `l7c-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const candUsers = await Promise.all(
      ["c1", "c2", "c3"].map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, ...candUsers);
    const coA = await createCompany(idA, "Restaurant A");
    await createCompany(idB, "Hôtel B");
    const [cand1, cand2] = await Promise.all([
      createCandidate(candUsers[0], "Aline"),
      createCandidate(candUsers[1], "Boris"),
      createCandidate(candUsers[2], "Carine"),
    ]);

    const A = await realSession(mail("a"));
    const B = await realSession(mail("b"));
    const [C1, C2, C3] = await Promise.all(
      ["c1", "c2", "c3"].map((k) => realSession(mail(k))),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const today = douala(new Date());
    const tomorrow = douala(new Date(Date.now() + 86_400_000));

    async function seedJob(
      title: string,
      opts: { date?: string; start?: string; positions?: number } = {},
    ): Promise<string> {
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          title,
          description: "Preuve du lot 7c.",
          address: "Boulevard de la Liberté",
          city: "Douala",
          start_date: opts.date ?? today,
          start_time: opts.start ?? "00:00",
          end_time: "23:59",
          hourly_rate: 1500,
          company_id: coA,
          status: "active",
          positions_available: opts.positions ?? 1,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id;
    }

    /** Mission, contrat et code créés par le parcours du lot 7a. */
    async function missionFor(candidate: Session, jobId: string) {
      const { data: app, error } = await candidate.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !app) throw new Error(`apply: ${error?.message}`);
      const sel = await http(
        "POST",
        `/api/applications/${app.id}/select`,
        A.cookie,
      );
      const selection = sel.body.selection as
        | { mission_id?: string; contract_id?: string }
        | undefined;
      if (sel.status !== 200 || !selection?.mission_id) {
        throw new Error(`select: HTTP ${sel.status} ${sel.text.slice(0, 200)}`);
      }
      return {
        jobId,
        applicationId: app.id as string,
        missionId: selection.mission_id,
        contractId: selection.contract_id as string,
      };
    }

    const mission = async (id: string) =>
      (await serviceClient.from("missions").select("*").eq("id", id).single())
        .data!;
    const codeRow = async (id: string) =>
      (
        await serviceClient
          .from("mission_completion_codes")
          .select("*")
          .eq("mission_id", id)
          .maybeSingle()
      ).data;
    const events = async (id: string) =>
      (
        await serviceClient
          .from("mission_check_ins")
          .select("*")
          .eq("mission_id", id)
          .order("created_at")
      ).data ?? [];
    const reviews = async (id: string) =>
      (
        await serviceClient
          .from("reviews")
          .select("*")
          .eq("mission_id", id)
          .order("created_at")
      ).data ?? [];

    const start = (s: Session | null, id: string) =>
      http("POST", `/api/missions/${id}/start`, s?.cookie ?? null);
    const complete = (s: Session | null, id: string, code: string) =>
      http("POST", `/api/missions/${id}/complete`, s?.cookie ?? null, {
        code,
      });
    const review = (
      s: Session | null,
      id: string,
      rating: number,
      comment?: string,
    ) =>
      http("POST", `/api/missions/${id}/review`, s?.cookie ?? null, {
        rating,
        comment,
      });
    const tasksOf = async (s: Session) => {
      const r = await http("GET", "/api/tasks", s.cookie);
      return {
        ...r,
        missions: (r.body.missions as TaskRow[] | undefined) ?? [],
      };
    };

    // ── S. Sélection : deux candidats, deux codes ────────────────
    const jobPair = await seedJob("Service à deux preuve L7c", {
      positions: 2,
    });
    const m1 = await missionFor(C1, jobPair);
    const m2 = await missionFor(C2, jobPair);
    const code1 = (await codeRow(m1.missionId))!.code;
    const code2 = (await codeRow(m2.missionId))!.code;
    report(
      "S1 deux candidats d'une même offre : un code à six chiffres chacun, distincts, générés à la sélection",
      /^[0-9]{6}$/.test(code1) && /^[0-9]{6}$/.test(code2) && code1 !== code2,
      { distinct: code1 !== code2 },
    );

    const reselect = await http(
      "POST",
      `/api/applications/${m1.applicationId}/select`,
      A.cookie,
    );
    report(
      "S2 relance de la sélection : même mission, même code",
      reselect.status === 200 &&
        (reselect.body.selection as { mission_id?: string })?.mission_id ===
          m1.missionId &&
        (await codeRow(m1.missionId))?.code === code1 &&
        !reselect.text.includes(code1),
    );

    const listA = await http("GET", `/api/jobs/${jobPair}/missions`, A.cookie);
    const rowsA =
      (listA.body.missions as
        | { application_id: string; completion_code: string | null }[]
        | undefined) ?? [];
    const byApp = new Map(rowsA.map((r) => [r.application_id, r]));
    const listB = await http("GET", `/api/jobs/${jobPair}/missions`, B.cookie);
    const { error: rpcB } = await B.client.rpc("company_job_missions", {
      p_job_id: jobPair,
    });
    report(
      "S3 l'entreprise propriétaire lit chaque code en regard du bon candidat ; entreprise tierce refusée",
      listA.status === 200 &&
        byApp.get(m1.applicationId)?.completion_code === code1 &&
        byApp.get(m2.applicationId)?.completion_code === code2 &&
        listB.status === 404 &&
        !listB.text.includes(code1) &&
        rpcB?.message === "job_not_found",
      { status: listA.status, third: listB.status },
    );

    // ── E. Exposition du code ────────────────────────────────────
    const [rawTasks, rawMission, rawMissionA, rpcMission] = await Promise.all([
      http("GET", "/api/tasks", C1.cookie),
      http("GET", `/api/missions/${m1.missionId}`, C1.cookie),
      http("GET", `/api/missions/${m1.missionId}`, A.cookie),
      C1.client.rpc("get_mission", { p_mission_id: m1.missionId }),
    ]);
    const { data: rpcTasks } = await C1.client.rpc("candidate_tasks");
    const [codesC1, codesA, codesAnon] = await Promise.all([
      C1.client.from("mission_completion_codes" as never).select("*"),
      A.client.from("mission_completion_codes" as never).select("*"),
      anon.from("mission_completion_codes" as never).select("*"),
    ]);
    const leaked = [
      rawTasks.text,
      rawMission.text,
      rawMissionA.text,
      JSON.stringify(rpcMission.data),
      JSON.stringify(rpcTasks),
    ].some((t) => t.includes(code1) || t.includes(code2));
    report(
      "E1 aucun code dans les réponses brutes candidat (tâches, mission, RPC) ni dans la lecture générique de la mission ; table des codes illisible en session",
      rawTasks.status === 200 &&
        rawMission.status === 200 &&
        !leaked &&
        !!codesC1.error &&
        !!codesA.error &&
        !!codesAnon.error,
      [codesC1.error?.code, codesA.error?.code, codesAnon.error?.code],
    );

    // ── D. Début de mission ──────────────────────────────────────
    const t1 = (await tasksOf(C1)).missions.find(
      (m) => m.mission_id === m1.missionId,
    );
    report(
      "D1 tâches du candidat : contrat à signer, début disponible (H−15 passé), heure du serveur",
      !!t1 &&
        t1.candidate_signed === false &&
        !!t1.contract_id &&
        new Date(t1.start_available_at).getTime() <=
          new Date(t1.server_now).getTime() &&
        t1.started_at === null,
      t1 && { signed: t1.candidate_signed, started: t1.started_at },
    );

    const mEarly = await missionFor(
      C1,
      await seedJob("Demain preuve L7c", { date: tomorrow, start: "09:00" }),
    );
    const early = await start(C1, mEarly.missionId);
    report(
      "D2 début avant H−15 min → 409 too_early avec l'heure d'ouverture, rien n'est écrit",
      early.status === 409 &&
        early.body.code === "too_early" &&
        typeof early.body.available_at === "string" &&
        (await mission(mEarly.missionId)).actual_start_time === null,
      early.body,
    );

    const tooSoon = await complete(C1, m1.missionId, code1);
    report(
      "D3 code avant le début → 409 not_started ; code non consommé, aucune tentative comptée",
      tooSoon.status === 409 &&
        tooSoon.body.code === "not_started" &&
        (await codeRow(m1.missionId))?.consumed_at === null &&
        (await codeRow(m1.missionId))?.failed_attempts === 0,
      tooSoon.body.code,
    );

    const s1 = await start(C1, m1.missionId);
    const mm1 = await mission(m1.missionId);
    const s1b = await start(C1, m1.missionId);
    const ev1 = await events(m1.missionId);
    report(
      "D4 début enregistré par la base (in_progress) sans position ; relance : même heure, un seul événement",
      s1.status === 200 &&
        mm1.status === "in_progress" &&
        !!mm1.actual_start_time &&
        (s1b.body.start as { already_started?: boolean; started_at?: string })
          ?.already_started === true &&
        (s1b.body.start as { started_at?: string })?.started_at ===
          mm1.actual_start_time &&
        ev1.length === 1 &&
        ev1[0].latitude === null &&
        ev1[0].longitude === null,
      { status: mm1.status, events: ev1.length },
    );

    const burst = await Promise.all(
      Array.from({ length: 5 }, () => start(C2, m2.missionId)),
    );
    const mm2 = await mission(m2.missionId);
    report(
      "D5 double clic : cinq débuts simultanés du second candidat, une écriture, même heure",
      burst.every((r) => r.status === 200) &&
        burst.filter(
          (r) =>
            (r.body.start as { already_started?: boolean })?.already_started ===
            false,
        ).length === 1 &&
        new Set(
          burst.map(
            (r) => (r.body.start as { started_at?: string }).started_at,
          ),
        ).size === 1 &&
        (await events(m2.missionId)).length === 1 &&
        mm2.status === "in_progress",
      burst.map((r) => r.status),
    );

    // ── C. Confirmation par code ─────────────────────────────────
    const other = await complete(C1, m1.missionId, code2);
    report(
      "C1 le code de l'autre candidat est refusé (422), le candidat peut réessayer",
      other.status === 422 &&
        other.body.code === "invalid_code" &&
        other.body.remaining_attempts === 4 &&
        !other.text.includes(code1) &&
        (await mission(m1.missionId)).actual_end_time === null,
      other.body,
    );

    const t0 = Date.now();
    const done = await Promise.all(
      Array.from({ length: 5 }, () => complete(C1, m1.missionId, code1)),
    );
    const mm1b = await mission(m1.missionId);
    const c1row = await codeRow(m1.missionId);
    const firsts = done.filter(
      (r) =>
        (r.body.completion as { already_completed?: boolean })
          ?.already_completed === false,
    );
    report(
      "C2 bon code, double clic (cinq envois) : une réalisation, code consommé dans la même transaction, une heure",
      done.every((r) => r.status === 200) &&
        firsts.length === 1 &&
        mm1b.status === "completed" &&
        !!mm1b.actual_end_time &&
        Math.abs(new Date(mm1b.actual_end_time).getTime() - t0) < 120_000 &&
        c1row?.consumed_at !== null &&
        new Set(
          done.map(
            (r) =>
              (r.body.completion as { completed_at?: string }).completed_at,
          ),
        ).size === 1 &&
        (await events(m1.missionId)).length === 2 &&
        done.every((r) => !r.text.includes(code1)),
      done.map((r) => r.status),
    );

    const lost = await complete(C1, m1.missionId, "000000");
    report(
      "C3 réponse perdue : un nouvel envoi retrouve la réalisation d'origine sans écriture ni tentative",
      lost.status === 200 &&
        (lost.body.completion as { already_completed?: boolean })
          ?.already_completed === true &&
        (lost.body.completion as { completed_at?: string })?.completed_at ===
          mm1b.actual_end_time &&
        (await codeRow(m1.missionId))?.consumed_at === c1row?.consumed_at &&
        (await mission(m1.missionId)).updated_at === mm1b.updated_at,
    );

    const { data: contract1 } = await serviceClient
      .from("contracts")
      .select("status, candidate_signed_at")
      .eq("id", m1.contractId)
      .single();
    const listAfter = await http(
      "GET",
      `/api/jobs/${jobPair}/missions`,
      A.cookie,
    );
    const afterRows =
      (listAfter.body.missions as
        | {
            application_id: string;
            completion_code: string | null;
            code_used: boolean;
            completed_at: string | null;
          }[]
        | undefined) ?? [];
    const r1 = afterRows.find((r) => r.application_id === m1.applicationId);
    const r2 = afterRows.find((r) => r.application_id === m2.applicationId);
    report(
      "C4 réalisée sans GPS ni contrat signé ; l'entreprise voit « code utilisé », le code du second reste affiché",
      contract1?.status === "pending" &&
        contract1.candidate_signed_at === null &&
        r1?.code_used === true &&
        r1.completion_code === null &&
        !!r1.completed_at &&
        r2?.completion_code === code2 &&
        r2.completed_at === null &&
        (await events(m1.missionId)).every((e) => e.latitude === null),
      { r1: r1?.code_used, r2: r2?.completed_at },
    );

    // Tentatives répétées (second candidat, qui ne reçoit pas son code).
    const wrong = code2 === "111111" ? "222222" : "111111";
    const parallel = await Promise.all(
      Array.from({ length: 8 }, () => complete(C2, m2.missionId, wrong)),
    );
    const c2row = await codeRow(m2.missionId);
    const invalidCount = parallel.filter((r) => r.status === 422).length;
    const lockedCount = parallel.filter((r) => r.status === 429).length;
    report(
      "C5 huit erreurs simultanées : au plus quatre « incorrect », puis blocage (429) compté en base",
      invalidCount === 4 &&
        lockedCount === 4 &&
        !!c2row?.locked_until &&
        new Date(c2row.locked_until).getTime() > Date.now(),
      { invalidCount, lockedCount },
    );

    const blocked = await complete(C2, m2.missionId, code2);
    const { data: directLocked } = await C2.client.rpc(
      "submit_completion_code",
      { p_mission_id: m2.missionId, p_code: code2 },
    );
    report(
      "C6 pendant le blocage, même le bon code est refusé (route et appel direct) ; le second reste sans confirmation",
      blocked.status === 429 &&
        typeof blocked.body.locked_until === "string" &&
        directLocked?.[0]?.result === "locked" &&
        (await mission(m2.missionId)).actual_end_time === null &&
        (await codeRow(m2.missionId))?.consumed_at === null,
      blocked.body.code,
    );

    const badFormat = await complete(C2, m2.missionId, "12ab");
    report(
      "C7 code mal formé → 400 sans appel à la base",
      badFormat.status === 400 && badFormat.body.code === "code_format",
    );

    // ── R. Évaluations ───────────────────────────────────────────
    const earlyReview = await review(C2, m2.missionId, 5);
    report(
      "R1 notation avant réalisation refusée (409 mission_not_completed)",
      earlyReview.status === 409 &&
        earlyReview.body.code === "mission_not_completed",
      earlyReview.body.code,
    );

    const resume = (await tasksOf(C1)).missions.find(
      (m) => m.mission_id === m1.missionId,
    );
    report(
      "R2 reprise avant notation (nouvelle session de lecture) : mission confirmée, tâche « Noter l'entreprise » à faire",
      !!resume?.completed_at && resume.candidate_reviewed === false,
      resume && { completed: !!resume.completed_at },
    );

    const { data: companyBefore } = await serviceClient
      .from("company_profiles")
      .select("average_rating")
      .eq("id", coA)
      .single();
    const rv = await review(C1, m1.missionId, 5, "Accueil parfait");
    const rvAgain = await review(C1, m1.missionId, 1);
    const revs1 = await reviews(m1.missionId);
    const { data: companyAfter } = await serviceClient
      .from("company_profiles")
      .select("average_rating")
      .eq("id", coA)
      .single();
    report(
      "R3 le candidat note l'entreprise : une seule évaluation (relance → la même), étoiles de l'entreprise mises à jour une fois",
      rv.status === 200 &&
        (
          rvAgain.body.review as {
            already_reviewed?: boolean;
            overall_rating?: number;
          }
        )?.already_reviewed === true &&
        (rvAgain.body.review as { overall_rating?: number })?.overall_rating ===
          5 &&
        revs1.length === 1 &&
        revs1[0].reviewer_type === "candidate" &&
        revs1[0].reviewed_type === "company" &&
        revs1[0].reviewed_id === coA &&
        revs1[0].reviewer_id === cand1 &&
        revs1[0].origin === "mission_flow" &&
        Number(companyBefore?.average_rating) === 0 &&
        Number(companyAfter?.average_rating) === 5,
      { reviews: revs1.length, stars: companyAfter?.average_rating },
    );

    const afterReview = (await tasksOf(C1)).missions.find(
      (m) => m.mission_id === m1.missionId,
    );
    report(
      "R4 après la note, la tâche de signature reste (contrat non signé)",
      !!afterReview &&
        afterReview.candidate_reviewed === true &&
        afterReview.candidate_signed === false,
    );

    const cr = await review(A, m1.missionId, 4, "Ponctuelle");
    const revs1b = await reviews(m1.missionId);
    const { data: stars } = await serviceClient
      .from("candidate_profiles")
      .select("id, average_rating")
      .in("id", [cand1, cand2]);
    const starOf = new Map(
      (stars ?? []).map((s) => [s.id, Number(s.average_rating)]),
    );
    report(
      "R5 l'entreprise note le candidat (facultatif) : étoiles du bon candidat seulement",
      cr.status === 200 &&
        revs1b.length === 2 &&
        revs1b.some(
          (r) =>
            r.reviewer_type === "company" &&
            r.reviewed_id === cand1 &&
            r.reviewer_id === coA,
        ) &&
        starOf.get(cand1) === 4 &&
        starOf.get(cand2) === 0,
      Object.fromEntries(starOf),
    );

    const [rB, rC2, rAnon, rBad] = await Promise.all([
      review(B, m1.missionId, 1),
      review(C2, m1.missionId, 1),
      review(null, m1.missionId, 1),
      review(C1, m1.missionId, 6),
    ]);
    const forged = [
      await C1.client.from("reviews").insert({
        mission_id: m1.missionId,
        reviewer_type: "candidate",
        reviewer_id: cand1,
        reviewed_type: "company",
        reviewed_id: coA,
        overall_rating: 1,
      }),
      await A.client.from("reviews").insert({
        mission_id: m1.missionId,
        reviewer_type: "company",
        reviewer_id: coA,
        reviewed_type: "candidate",
        reviewed_id: cand2,
        overall_rating: 1,
      }),
      await C1.client
        .from("reviews")
        .update({ overall_rating: 1 })
        .eq("mission_id", m1.missionId)
        .select("id"),
    ];
    report(
      "R6 tiers, autre candidat, anonyme refusés ; note hors bornes 400 ; INSERT/UPDATE directs (y compris vers un autre profil) refusés",
      rB.status === 404 &&
        rC2.status === 404 &&
        rAnon.status === 401 &&
        rBad.status === 400 &&
        forged.every(
          (r) => !!r.error || ((r.data as unknown[] | null) ?? []).length === 0,
        ) &&
        (await reviews(m1.missionId)).length === 2,
      forged.map((r) => r.error?.code ?? "accepté"),
    );

    // ── K. Contrat déjà signé ────────────────────────────────────
    const m3 = await missionFor(C3, await seedJob("Signé preuve L7c"));
    const contractView = await http(
      "GET",
      `/api/contracts/${m3.contractId}`,
      C3.cookie,
    );
    const termsHash = (contractView.body.contract as { terms_hash?: string })
      ?.terms_hash;
    const signed = await http(
      "POST",
      `/api/contracts/${m3.contractId}/sign`,
      C3.cookie,
      { terms_hash: termsHash, consent: true },
    );
    await start(C3, m3.missionId);
    const code3 = (await codeRow(m3.missionId))!.code;
    const done3 = await complete(C3, m3.missionId, code3);
    const beforeNote = (await tasksOf(C3)).missions.find(
      (m) => m.mission_id === m3.missionId,
    );
    await review(C3, m3.missionId, 4);
    const afterNote = (await tasksOf(C3)).missions.find(
      (m) => m.mission_id === m3.missionId,
    );
    report(
      "K1 contrat déjà signé : seule la note reste après le code, puis plus aucune tâche",
      signed.status === 200 &&
        done3.status === 200 &&
        beforeNote?.candidate_signed === true &&
        beforeNote.candidate_reviewed === false &&
        afterNote === undefined,
      { signed: signed.status, done: done3.status },
    );

    // ── X. Tiers, écritures directes, validation supprimée ───────
    const [xStart, xComplete, xCompanyStart, xAnon] = await Promise.all([
      start(C2, mEarly.missionId),
      complete(C2, m3.missionId, code3),
      start(A, m2.missionId),
      start(null, m2.missionId),
    ]);
    report(
      "X1 mission d'un autre candidat : début et code refusés (404) ; entreprise 404 ; anonyme 401",
      xStart.status === 404 &&
        xComplete.status === 404 &&
        xCompanyStart.status === 404 &&
        xAnon.status === 401,
      [xStart.status, xComplete.status, xCompanyStart.status, xAnon.status],
    );

    const m2before = await mission(m2.missionId);
    const writes = [
      await C2.client
        .from("missions")
        .update({
          status: "completed",
          actual_end_time: new Date().toISOString(),
        })
        .eq("id", m2.missionId)
        .select("id"),
      await A.client
        .from("missions")
        .update({
          payment_status: "paid",
          platform_fee: 0,
          validated_at: new Date().toISOString(),
        })
        .eq("id", m2.missionId)
        .select("id"),
      await C2.client.from("mission_check_ins").insert({
        mission_id: m2.missionId,
        check_in_type: "departure",
      }),
      await C2.client
        .from("mission_completion_codes" as never)
        .update({ failed_attempts: 0, locked_until: null } as never)
        .eq("mission_id", m2.missionId)
        .select("mission_id"),
    ];
    const m2after = await mission(m2.missionId);
    report(
      "X2 écritures directes refusées : fin, statut, paiement, frais, validation, événements, compteur de tentatives",
      writes.every(
        (r) => !!r.error || ((r.data as unknown[] | null) ?? []).length === 0,
      ) &&
        m2after.updated_at === m2before.updated_at &&
        m2after.actual_end_time === null &&
        (await codeRow(m2.missionId))?.locked_until !== null,
      writes.map((r) => r.error?.code ?? "accepté"),
    );

    const trusted = [
      await serviceClient
        .from("mission_completion_codes")
        .update({ code: "123456" })
        .eq("mission_id", m2.missionId)
        .select("mission_id"),
      await serviceClient
        .from("mission_completion_codes")
        .update({ consumed_at: null })
        .eq("mission_id", m1.missionId)
        .select("mission_id"),
      await serviceClient
        .from("missions")
        .update({ actual_end_time: null })
        .eq("id", m1.missionId)
        .select("id"),
      await serviceClient
        .from("reviews")
        .update({ overall_rating: 1 })
        .eq("mission_id", m1.missionId)
        .select("id"),
    ];
    report(
      "X3 même en clé service : code, consommation, réalisation et évaluations immuables",
      trusted.every((r) => !!r.error),
      trusted.map((r) => r.error?.message ?? "accepté"),
    );

    const { error: oldRpc } = await A.client.rpc(
      "validate_mission_hours" as never,
      { p_mission_id: m1.missionId } as never,
    );
    const oldRoute = await http(
      "POST",
      `/api/missions/${m1.missionId}/validate`,
      A.cookie,
    );
    report(
      "X4 validation des heures par l'entreprise supprimée (RPC et route absentes)",
      !!oldRpc && oldRoute.status === 404,
      [oldRpc?.code, oldRoute.status],
    );

    // ── E2. Notifications sans code ──────────────────────────────
    const { data: notes } = await serviceClient
      .from("notifications")
      .select("title, body, data")
      .in("user_id", ids);
    const notesText = JSON.stringify(notes ?? []);
    report(
      "E2 notifications (sélection, début, réalisation) sans aucun code",
      (notes ?? []).length >= 4 &&
        ![code1, code2, code3].some((c) => notesText.includes(c)),
      (notes ?? []).length,
    );

    // ── L. Mission sans code (antérieure, non reprise) ───────────
    const mL = await missionFor(C2, await seedJob("Ancienne preuve L7c"));
    await serviceClient
      .from("mission_completion_codes")
      .delete()
      .eq("mission_id", mL.missionId);
    await start(C2, mL.missionId);
    const legacy = await complete(C2, mL.missionId, "123456");
    const legacyList = await http(
      "GET",
      `/api/jobs/${mL.jobId}/missions`,
      A.cookie,
    );
    const legacyRow = ((legacyList.body.missions as
      | { completion_code: string | null; code_used: boolean }[]
      | undefined) ?? [])[0];
    report(
      "L1 mission sans code : refus explicite (409 code_unavailable), aucune réalisation ni remise déduite",
      legacy.status === 409 &&
        legacy.body.code === "code_unavailable" &&
        (await mission(mL.missionId)).actual_end_time === null &&
        legacyRow?.completion_code === null &&
        legacyRow.code_used === false,
      legacy.body.code,
    );
  } finally {
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
