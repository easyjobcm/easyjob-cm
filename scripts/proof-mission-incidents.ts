/**
 * Preuve lot 14 — incidents de mission par journée.
 *
 * Fixtures en clé service (entreprises A et B, candidats C1 à C3, admins
 * ops, support et ops suspendu ; offre de trois journées et offre d'une
 * journée, sélections par « Signer et sélectionner ») ; tentatives en
 * sessions RÉELLES (routes avec cookies, RPC et Storage avec le JWT) ;
 * état relu en clé service. Journées recalées en clé service avant tout
 * début (lundi passé, mercredi aujourd'hui, vendredi futur).
 *
 *   J. Règle par journée : lundi confirmé par code → absence et « code non
 *      remis » refusés ce jour-là, retard accepté ; mercredi signalé absent ;
 *      vendredi toujours prévu (aucune écriture sur la journée, la mission,
 *      le contrat, la réputation, aucun manquement).
 *   D. Double envoi (simultané et relance) : même signalement, une ligne,
 *      une déclaration, une notification.
 *   V. Code non remis : versions contradictoires, justificatif privé,
 *      journée non confirmée ; dossier complet pour le support.
 *   A. Accès : tiers, autre candidat, anonyme ; tables, bucket et RPC de
 *      service fermés en session ; parties sans pièce ; support (lecture),
 *      ops (décision), admin suspendu refusé.
 *   S. Décision motivée : tracée, notifiée, sans conséquence ; relance.
 *   R. Course confirmation par code / absence : jamais une absence ouverte
 *      sur une journée confirmée.
 *   H. Table historique `disputes` (lot 14b) : aucune création, modification
 *      ni suppression en session (tiers, partie, anonyme, admin en appel
 *      direct), ni usurpation de l'auteur, ni rattachement à une autre
 *      mission ; lectures autorisées inchangées ; privilèges effectifs.
 *      Le chemin légitime (admin_open_review_contest) est prouvé par
 *      `reputation` C2.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectHttp } from "./lib/sign-and-select";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L14-incidents-01!";
const PROOF_USER_METADATA = { proofMissionIncidents: true };
const BUCKET = "incident-evidence";
const HOUR = 3600_000;
// En-tête PNG suivi d'octets quelconques : type réel lu par la route.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "mission-incidents" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
  return r.stdout;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

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
      niu: `M14${String(Date.now()).slice(-9)}${name.length}`,
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
      last_name: "Essomba",
      date_of_birth: "1996-08-14",
      city: "Douala",
      address: "Deido, rue privée",
      latitude: 4.06,
      longitude: 9.71,
      bio: "Candidat de preuve du lot 14.",
      cni_number: "CNI14000141",
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677141414",
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
    const { data: incidents } = await serviceClient
      .from("mission_incidents")
      .select("id")
      .in("company_id", companyIds);
    for (const { id } of incidents ?? []) {
      const { data: objects } = await serviceClient.storage
        .from(BUCKET)
        .list(id);
      if (objects?.length) {
        await serviceClient.storage
          .from(BUCKET)
          .remove(objects.map((o) => `${id}/${o.name}`));
      }
    }
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
      .filter((u) => u.user_metadata?.proofMissionIncidents === true)
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

const doualaDay = (days: number) =>
  new Date(Date.now() + HOUR + days * 24 * HOUR).toISOString().slice(0, 10);

type Incident = {
  incident_id: string;
  mission_day_id: string;
  kind: string;
  status: string;
  reported_by_party: string;
  statements: { party: string; body: string }[];
  evidence_counts: { candidate: number; company: number };
  outcome: string | null;
};

const CONTENT = {
  description: "Preuve des incidents de mission (lot 14).",
  address: "Boulevard de la Liberté",
  city: "Douala",
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l14-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  const incidentIds: string[] = [];

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const [idC1, idC2, idC3] = await Promise.all(
      ["c1", "c2", "c3"].map((k) => createAccount(mail(k), "candidate")),
    );
    const idOps = await createAccount(mail("ops"), "admin_ops");
    const idSup = await createAccount(mail("sup"), "admin_support");
    const idOpsOff = await createAccount(mail("opsoff"), "admin_ops");
    ids.push(idA, idB, idC1, idC2, idC3, idOps, idSup, idOpsOff);
    const coA = await createCompany(idA, "Restaurant Lumière");
    await createCompany(idB, "Hôtel Tiers");
    const cand1 = await createCandidate(idC1, "Aline");
    const cand2 = await createCandidate(idC2, "Boris");
    await createCandidate(idC3, "Carine");

    const [A, B, C1, C2, C3, OPS, SUP, OFF] = await Promise.all(
      ["a", "b", "c1", "c2", "c3", "ops", "sup", "opsoff"].map((k) =>
        realSession(mail(k)),
      ),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idOpsOff);

    // Offre de trois journées (futures à la publication), C1 sélectionné.
    const { jobId: jobWeek } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Plonge de la semaine",
        company_id: coA,
        mission_pay_per_candidate: 30000,
        positions_available: 2,
      },
      [
        { date: "2099-12-07", start_time: "08:00", end_time: "16:00" },
        { date: "2099-12-09", start_time: "08:00", end_time: "16:00" },
        { date: "2099-12-11", start_time: "08:00", end_time: "16:00" },
      ],
    );
    const { data: app1 } = await C1.client.rpc("apply_to_job", {
      p_job_id: jobWeek,
    });
    const sel1 = await signAndSelectHttp(APP_URL, app1!.id, A.cookie);
    const missionId = (sel1.body.selection as { mission_id: string })
      .mission_id;
    const { data: mdays } = await serviceClient
      .from("mission_days")
      .select("id, scheduled_date")
      .eq("mission_id", missionId)
      .order("scheduled_date");
    const [mon, wed, fri] = mdays!;
    // Lundi passé, mercredi aujourd'hui, vendredi futur (jamais commencés).
    for (const [d, date, start, end] of [
      [mon, doualaDay(-2), "00:00", "23:00"],
      [wed, doualaDay(0), "00:00", "23:59"],
      [fri, doualaDay(2), "08:00", "16:00"],
    ] as const) {
      const { error } = await serviceClient
        .from("mission_days")
        .update({
          scheduled_date: date,
          scheduled_start_time: start,
          scheduled_end_time: end,
        })
        .eq("id", d.id);
      if (error) throw new Error(`day shift: ${error.message}`);
    }
    const codeOf = async (dayId: string) =>
      (
        await serviceClient
          .from("mission_completion_codes")
          .select("code")
          .eq("mission_day_id", dayId)
          .single()
      ).data!.code;

    // Lundi : début puis code accepté.
    const s1 = await C1.client.rpc("start_mission", {
      p_mission_id: missionId,
      p_mission_day_id: mon.id,
    });
    const c1 = await C1.client.rpc("submit_completion_code", {
      p_mission_id: missionId,
      p_code: await codeOf(mon.id),
      p_mission_day_id: mon.id,
    });
    if (s1.error || c1.data?.[0]?.result !== "completed") {
      throw new Error(`lundi: ${s1.error?.message ?? c1.error?.message}`);
    }

    const reportUrl = `/api/missions/${missionId}/incidents`;
    const reportAs = (
      s: Session | null,
      dayId: string,
      kind: string,
      statement: string,
      late?: number,
    ) =>
      http("POST", reportUrl, s?.cookie ?? null, {
        mission_day_id: dayId,
        kind,
        statement,
        ...(late ? { late_minutes: late } : {}),
      });
    const snapshot = async () => {
      const [{ data: days }, { data: mission }, { data: contract }, rep, inc] =
        await Promise.all([
          serviceClient
            .from("mission_days")
            .select("id, actual_start_time, actual_end_time, scheduled_date")
            .eq("mission_id", missionId)
            .order("scheduled_date"),
          serviceClient
            .from("missions")
            .select("status, actual_end_time")
            .eq("id", missionId)
            .single(),
          serviceClient
            .from("contracts")
            .select("terms_hash, status")
            .eq("application_id", app1!.id)
            .single(),
          serviceClient
            .from("reputation_scores")
            .select("subject_type, stars, experience_units")
            .in("subject_id", [cand1, coA]),
          serviceClient
            .from("reputation_incidents")
            .select("id", { count: "exact", head: true })
            .in("subject_id", [cand1, coA]),
        ]);
      return JSON.stringify({
        days,
        mission,
        contract,
        rep: (rep.data ?? []).sort((a, b) =>
          a.subject_type.localeCompare(b.subject_type),
        ),
        incidents: inc.count,
      });
    };
    const before = await snapshot();

    // ── J. Règle par journée ─────────────────────────────────────
    console.log("\n── J. Règle par journée ──");
    const [monAbsA, monAbsC, monCode, monLate] = await Promise.all([
      reportAs(A, mon.id, "absence", "Absent lundi selon nous."),
      reportAs(C1, mon.id, "absence", "Je n'étais pas là lundi."),
      reportAs(C1, mon.id, "code_not_received", "Code non reçu lundi."),
      reportAs(A, mon.id, "late", "Arrivé avec 40 minutes de retard.", 40),
    ]);
    report(
      "J1 lundi confirmé par code : absence (entreprise, candidat) et code non remis refusés ce jour-là ; retard suivi de travail accepté",
      monAbsA.status === 409 &&
        monAbsA.body.code === "day_already_confirmed" &&
        monAbsC.body.code === "day_already_confirmed" &&
        monCode.body.code === "day_already_confirmed" &&
        monLate.status === 200,
      [monAbsA.body.code, monAbsC.body.code, monCode.body.code, monLate.status],
    );
    const wedAbs = await reportAs(
      A,
      wed.id,
      "absence",
      "Le candidat ne s'est pas présenté mercredi.",
    );
    const wedId = (wedAbs.body.incident as { incident_id: string })
      ?.incident_id;
    if (wedId) incidentIds.push(wedId);
    const friAbsA = await reportAs(
      A,
      fri.id,
      "absence",
      "Absent vendredi (déclaré trop tôt).",
    );
    const friWarn = await reportAs(
      C1,
      fri.id,
      "absence",
      "Je préviens : je ne pourrai pas venir vendredi.",
    );
    const after = await snapshot();
    report(
      "J2 code accepté lundi n'empêche pas l'absence de mercredi (signalée par l'entreprise)",
      wedAbs.status === 200 &&
        (wedAbs.body.incident as { status?: string })?.status === "open",
      wedAbs.body,
    );
    report(
      "J3 vendredi : l'entreprise ne peut constater une absence avant le début (day_not_started) ; le candidat peut prévenir ; vendredi reste prévu",
      friAbsA.status === 409 &&
        friAbsA.body.code === "day_not_started" &&
        friWarn.status === 200,
      [friAbsA.body.code, friWarn.status],
    );
    report(
      "J4 aucune conséquence : journées, mission, contrat, réputation et manquements inchangés",
      after === before,
      after === before ? undefined : { before, after },
    );

    // ── D. Double envoi ──────────────────────────────────────────
    console.log("\n── D. Double envoi ──");
    const notifCount = async (userId: string, incident: string) =>
      (
        await serviceClient
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("data->>incident_id", incident)
      ).data?.length ?? -1;
    const [dup1, dup2] = await Promise.all([
      reportAs(
        C1,
        wed.id,
        "code_not_received",
        "J'ai travaillé mercredi, pas de code.",
      ),
      reportAs(
        C1,
        wed.id,
        "code_not_received",
        "J'ai travaillé mercredi, pas de code.",
      ),
    ]);
    const dupIds = [dup1, dup2].map(
      (r) => (r.body.incident as { incident_id?: string })?.incident_id,
    );
    const codeId = dupIds[0] ?? "";
    incidentIds.push(codeId);
    const again = await reportAs(
      C1,
      wed.id,
      "code_not_received",
      "Autre texte, même signalement.",
    );
    const { count: rows } = await serviceClient
      .from("mission_incidents")
      .select("id", { count: "exact", head: true })
      .eq("mission_day_id", wed.id)
      .eq("kind", "code_not_received");
    const { count: stCount } = await serviceClient
      .from("mission_incident_statements")
      .select("id", { count: "exact", head: true })
      .eq("incident_id", codeId);
    report(
      "D1 double envoi simultané puis relance : même signalement (already_reported), une ligne, une déclaration, une notification à l'entreprise",
      dup1.status === 200 &&
        dup2.status === 200 &&
        dupIds[0] === dupIds[1] &&
        [dup1, dup2]
          .map(
            (r) =>
              (r.body.incident as { already_reported?: boolean })
                ?.already_reported,
          )
          .sort()
          .join() === "false,true" &&
        (again.body.incident as { incident_id?: string })?.incident_id ===
          codeId &&
        (again.body.incident as { already_reported?: boolean })
          ?.already_reported === true &&
        rows === 1 &&
        stCount === 1 &&
        (await notifCount(idA, codeId)) === 1,
      { rows, stCount },
    );

    // ── V. Code non remis : versions et pièce ────────────────────
    console.log("\n── V. Code non remis : versions contradictoires ──");
    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "preuve.png");
    const up = await http(
      "POST",
      `/api/incidents/${codeId}/evidence`,
      C1.cookie,
      undefined,
      form,
    );
    const badForm = new FormData();
    badForm.append(
      "file",
      new Blob([new TextEncoder().encode("<script>")], { type: "image/png" }),
      "x.png",
    );
    const bad = await http(
      "POST",
      `/api/incidents/${codeId}/evidence`,
      C1.cookie,
      undefined,
      badForm,
    );
    const stmt = (s: Session | null, id: string, statement: string) =>
      http("POST", `/api/incidents/${id}/statements`, s?.cookie ?? null, {
        statement,
      });
    const vA = await stmt(
      A,
      codeId,
      "Le candidat est parti avant la fin, pas de code dû.",
    );
    const [vDup1, vDup2] = await Promise.all([
      stmt(C1, codeId, "Je suis resté jusqu'à 16 h, le chef m'a vu."),
      stmt(C1, codeId, "Je suis resté jusqu'à 16 h, le chef m'a vu."),
    ]);
    const { data: wedRow } = await serviceClient
      .from("mission_days")
      .select("actual_end_time")
      .eq("id", wed.id)
      .single();
    const { data: codeRow } = await serviceClient
      .from("mission_incidents")
      .select("status")
      .eq("id", codeId)
      .single();
    report(
      "V1 justificatif accepté (type lu dans les octets), faux PNG refusé ; versions contradictoires des deux parties ; même déclaration envoyée deux fois enregistrée une fois",
      up.status === 200 &&
        bad.status === 400 &&
        vA.status === 200 &&
        vDup1.status === 200 &&
        vDup2.status === 200 &&
        codeRow?.status === "answered" &&
        (await serviceClient
          .from("mission_incident_statements")
          .select("id", { count: "exact", head: true })
          .eq("incident_id", codeId)
          .then((r) => r.count)) === 3,
      { up: up.status, bad: bad.status, status: codeRow?.status },
    );
    report(
      "V2 code non remis : la journée de mercredi reste non confirmée",
      wedRow?.actual_end_time === null,
    );

    const [readC1, readA] = await Promise.all([
      http("GET", reportUrl, C1.cookie),
      http("GET", reportUrl, A.cookie),
    ]);
    const listC1 = (readC1.body.incidents ?? []) as Incident[];
    const codeForA = ((readA.body.incidents ?? []) as Incident[]).find(
      (i) => i.incident_id === codeId,
    );
    report(
      "V3 les deux parties lisent le même dossier : faits, versions, nombre de pièces ; ni pièce, ni chemin, ni auteur",
      readC1.status === 200 &&
        readA.status === 200 &&
        listC1.length === 4 &&
        codeForA?.statements.length === 3 &&
        codeForA.evidence_counts.candidate === 1 &&
        !readA.text.includes(codeId + "/") &&
        !readA.text.includes("storage_path") &&
        !readA.text.includes(idC1) &&
        !readA.text.includes("Essomba"),
      { c1: listC1.length, counts: codeForA?.evidence_counts },
    );

    // ── A. Accès ─────────────────────────────────────────────────
    console.log("\n── A. Accès et confidentialité ──");
    const [readB, readC2, readAnon, stB, reportB] = await Promise.all([
      http("GET", reportUrl, B.cookie),
      http("GET", reportUrl, C2.cookie),
      http("GET", reportUrl, null),
      stmt(B, codeId, "Je suis une entreprise tierce."),
      reportAs(C3, wed.id, "late", "Tiers qui tente un signalement."),
    ]);
    report(
      "A1 entreprise tierce, autre candidat : 404 ; anonyme : 401 ; déclaration et signalement d'un tiers refusés",
      readB.status === 404 &&
        readC2.status === 404 &&
        readAnon.status === 401 &&
        stB.status === 404 &&
        reportB.status === 404,
      [
        readB.status,
        readC2.status,
        readAnon.status,
        stB.status,
        reportB.status,
      ],
    );
    const anonRpc = await anon.rpc("report_mission_incident", {
      p_mission_id: missionId,
      p_mission_day_id: wed.id,
      p_kind: "late",
      p_statement: "Anonyme qui tente un signalement.",
    });
    report(
      "A1b RPC de signalement refusée à l'anonyme",
      !!anonRpc.error,
      anonRpc.error?.code,
    );
    const { data: evRow } = await serviceClient
      .from("mission_incident_evidence")
      .select("id, storage_path")
      .eq("incident_id", codeId)
      .single();
    const [dlC1, dlA, listA, tblSel, tblIns, recRpc] = await Promise.all([
      C1.client.storage.from(BUCKET).download(evRow!.storage_path),
      A.client.storage.from(BUCKET).download(evRow!.storage_path),
      A.client.storage.from(BUCKET).list(codeId),
      C1.client.from("mission_incidents").select("id").eq("id", codeId),
      A.client.from("mission_incident_statements").insert({
        incident_id: codeId,
        party: "company",
        body: "Écriture directe interdite.",
      }),
      C1.client.rpc("record_incident_evidence", {
        p_user_id: idC1,
        p_incident_id: codeId,
        p_path: `${codeId}/forge.png`,
        p_mime: "image/png",
        p_size: 10,
      }),
    ]);
    report(
      "A2 pièces privées : téléchargement par les parties refusé, bucket illisible ; tables et RPC de service fermées en session",
      !!dlC1.error &&
        !!dlA.error &&
        (listA.data ?? []).length === 0 &&
        (!!tblSel.error || (tblSel.data ?? []).length === 0) &&
        !!tblIns.error &&
        !!recRpc.error,
      [
        dlC1.error?.message,
        tblSel.error?.code,
        tblIns.error?.code,
        recRpc.error?.code,
      ],
    );
    const evUrl = `/api/admin/incidents/${codeId}/evidence/${evRow!.id}`;
    const [evSup, evC1, evOff, detSup, detOff, listOff] = await Promise.all([
      http("GET", evUrl, SUP.cookie),
      http("GET", evUrl, C1.cookie),
      http("GET", evUrl, OFF.cookie),
      http("GET", `/api/admin/incidents/${codeId}`, SUP.cookie),
      http("GET", `/api/admin/incidents/${codeId}`, OFF.cookie),
      http("GET", "/api/admin/incidents", OFF.cookie),
    ]);
    const signed = evSup.body.url as string | undefined;
    const fileOk = signed
      ? Buffer.from(await (await fetch(signed)).arrayBuffer()).equals(
          Buffer.from(PNG),
        )
      : false;
    const det = detSup.body.incident as
      | {
          statements: unknown[];
          evidence: unknown[];
          day: { confirmed_at: string | null };
          other_days: { confirmed_at: string | null }[];
          can_decide: boolean;
        }
      | undefined;
    report(
      "A3 support habilité : dossier complet (versions, pièces, journée et autres journées) et pièce ouverte par URL signée ; partie et admin suspendu refusés",
      evSup.status === 200 &&
        fileOk &&
        evC1.status === 403 &&
        evOff.status === 403 &&
        detSup.status === 200 &&
        det?.statements.length === 3 &&
        det.evidence.length === 1 &&
        det.day.confirmed_at === null &&
        det.other_days.some((d) => d.confirmed_at !== null) &&
        det.can_decide === false &&
        detOff.status === 403 &&
        listOff.status === 403,
      [evSup.status, fileOk, evC1.status, evOff.status, detOff.status],
    );

    // ── S. Décision motivée ──────────────────────────────────────
    console.log("\n── S. Décision du support ──");
    const decide = (s: Session, outcome: string, note: string) =>
      http("POST", `/api/admin/incidents/${codeId}`, s.cookie, {
        outcome,
        note,
      });
    const note = "Témoignage du chef de salle et photo cohérents.";
    const [dSup, dOff, dNoNote] = await Promise.all([
      decide(SUP, "established", note),
      decide(OFF, "established", note),
      decide(OPS, "established", "court"),
    ]);
    const beforeDecision = await snapshot();
    const dOps = await decide(OPS, "established", note);
    const dAgain = await decide(OPS, "established", note);
    const dOther = await decide(OPS, "not_established", note);
    const afterDecision = await snapshot();
    const { data: audit } = await serviceClient
      .from("audit_logs")
      .select("actor_id, action, metadata")
      .eq("resource_id", codeId);
    report(
      "S1 décision réservée à ops actif et motivée : support et suspendu refusés (403), motif trop court refusé",
      dSup.status === 403 &&
        dOff.status === 403 &&
        dNoNote.status === 400 &&
        dNoNote.body.code === "note_invalid",
      [dSup.status, dOff.status, dNoNote.body.code],
    );
    report(
      "S2 décision enregistrée et tracée (audit), relance identique sans effet, décision contraire refusée",
      dOps.status === 200 &&
        (dAgain.body.decision as { already_decided?: boolean })
          ?.already_decided === true &&
        dOther.status === 409 &&
        dOther.body.code === "incident_already_decided" &&
        (audit ?? []).length === 1 &&
        audit![0].actor_id === idOps &&
        audit![0].action === "decide_mission_incident",
      { audit: audit?.length, other: dOther.body.code },
    );
    report(
      "S3 aucune conséquence de la décision : journée de mercredi non confirmée, mission, contrat, réputation et manquements inchangés ; parties notifiées",
      afterDecision === beforeDecision &&
        (await notifCount(idC1, codeId)) >= 1 &&
        (await notifCount(idA, codeId)) >= 2,
      afterDecision === beforeDecision
        ? undefined
        : { beforeDecision, afterDecision },
    );
    // Reconnexion : chacun retrouve le même état.
    const [C1b, Ab] = await Promise.all([
      realSession(mail("c1")),
      realSession(mail("a")),
    ]);
    const [r1, r2] = await Promise.all([
      http("GET", reportUrl, C1b.cookie),
      http("GET", reportUrl, Ab.cookie),
    ]);
    const decided = (r: HttpResult) =>
      ((r.body.incidents ?? []) as Incident[]).find(
        (i) => i.incident_id === codeId,
      );
    report(
      "S4 après reconnexion, candidat et entreprise lisent la même décision",
      decided(r1)?.outcome === "established" &&
        decided(r2)?.outcome === "established" &&
        decided(r1)?.status === "decided" &&
        JSON.stringify(decided(r1)?.statements) ===
          JSON.stringify(decided(r2)?.statements),
    );

    // Absence ouverte puis journée confirmée : le signalement est clos.
    await C1.client.rpc("start_mission", {
      p_mission_id: missionId,
      p_mission_day_id: wed.id,
    });
    await C1.client.rpc("submit_completion_code", {
      p_mission_id: missionId,
      p_code: await codeOf(wed.id),
      p_mission_day_id: wed.id,
    });
    const { data: wedAbsRow } = await serviceClient
      .from("mission_incidents")
      .select("status, closed_reason")
      .eq("id", wedId!)
      .single();
    const { data: codeAfter } = await serviceClient
      .from("mission_incidents")
      .select("status")
      .eq("id", codeId)
      .single();
    const lateNow = await stmt(A, wedId!, "Complément après la clôture.");
    report(
      "S5 mercredi confirmé ensuite par code : l'absence ouverte est close (journée confirmée), la décision déjà prise reste, plus aucune déclaration",
      wedAbsRow?.status === "closed" &&
        wedAbsRow.closed_reason === "day_confirmed" &&
        codeAfter?.status === "decided" &&
        lateNow.status === 409 &&
        lateNow.body.code === "incident_closed",
      wedAbsRow,
    );

    // ── R. Course code / absence ─────────────────────────────────
    console.log("\n── R. Course confirmation par code et absence ──");
    const { jobId: jobDay } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Service du jour",
        company_id: coA,
        mission_pay_per_candidate: 8000,
        positions_available: 1,
      },
      [{ date: "2099-12-20", start_time: "08:00", end_time: "16:00" }],
    );
    const { data: app2 } = await C2.client.rpc("apply_to_job", {
      p_job_id: jobDay,
    });
    const sel2 = await signAndSelectHttp(APP_URL, app2!.id, A.cookie);
    const mission2 = (sel2.body.selection as { mission_id: string }).mission_id;
    const { data: day2 } = await serviceClient
      .from("mission_days")
      .select("id")
      .eq("mission_id", mission2)
      .single();
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: doualaDay(0),
        scheduled_start_time: "00:00",
        scheduled_end_time: "23:59",
      })
      .eq("id", day2!.id);
    await C2.client.rpc("start_mission", {
      p_mission_id: mission2,
      p_mission_day_id: day2!.id,
    });
    const code2 = await codeOf(day2!.id);
    const [raceCode, raceAbs] = await Promise.all([
      C2.client.rpc("submit_completion_code", {
        p_mission_id: mission2,
        p_code: code2,
        p_mission_day_id: day2!.id,
      }),
      http("POST", `/api/missions/${mission2}/incidents`, A.cookie, {
        mission_day_id: day2!.id,
        kind: "absence",
        statement: "Absent selon l'entreprise (course).",
      }),
    ]);
    const { data: raceDay } = await serviceClient
      .from("mission_days")
      .select("actual_end_time")
      .eq("id", day2!.id)
      .single();
    const { data: raceInc } = await serviceClient
      .from("mission_incidents")
      .select("status, closed_reason")
      .eq("mission_day_id", day2!.id)
      .eq("kind", "absence");
    const consistent =
      raceDay?.actual_end_time !== null &&
      (raceAbs.status === 409
        ? raceAbs.body.code === "day_already_confirmed" &&
          (raceInc ?? []).length === 0
        : raceAbs.status === 200 &&
          raceInc?.[0]?.status === "closed" &&
          raceInc[0].closed_reason === "day_confirmed");
    report(
      "R1 course code / absence : code accepté, et soit absence refusée (journée confirmée), soit absence enregistrée avant puis close ; jamais une absence ouverte sur une journée confirmée",
      raceCode.data?.[0]?.result === "completed" && consistent,
      {
        code: raceCode.data?.[0]?.result,
        absence: raceAbs.status,
        incident: raceInc,
      },
    );

    // ── H. Table historique disputes (lot 14b) ───────────────────
    console.log("\n── H. Contestations historiques (disputes) ──");
    const disputesOf = async () =>
      (
        await serviceClient
          .from("disputes")
          .select("id, mission_id, opened_by, status, resolution, description")
          .in("mission_id", [missionId, mission2])
          .order("created_at")
      ).data ?? [];
    // Ligne historique (antérieure, créée en clé service) sur la mission de C1.
    const { data: legacy, error: legacyErr } = await serviceClient
      .from("disputes")
      .insert({
        mission_id: missionId,
        opened_by: idC1,
        type: "absence",
        description: "Litige historique de la preuve 14b.",
      })
      .select("id")
      .single();
    if (legacyErr || !legacy)
      throw new Error(`legacy dispute: ${legacyErr?.message}`);
    const beforeH = JSON.stringify(await disputesOf());
    const attempt = (client: DB, row: Record<string, unknown>) =>
      client
        .from("disputes")
        .insert({
          mission_id: missionId,
          type: "absence",
          description: "Tentative de création directe.",
          ...row,
        } as Database["public"]["Tables"]["disputes"]["Insert"])
        .select("id");
    const [hThird, hSpoof, hParty, hAnon, hAdmin] = await Promise.all([
      attempt(C3.client, { opened_by: idC3 }),
      attempt(C3.client, { opened_by: idC1 }),
      attempt(C1.client, { opened_by: idC1 }),
      attempt(anon, { opened_by: idC1 }),
      attempt(SUP.client, { opened_by: idC1 }),
    ]);
    const afterInsert = JSON.stringify(await disputesOf());
    report(
      "H1 création directe refusée : tiers (pour lui-même ou au nom de la partie), partie elle-même, anonyme, support ; aucune ligne créée",
      [hThird, hSpoof, hParty, hAnon, hAdmin].every(
        (r) => !!r.error && (r.data ?? []).length === 0,
      ) && afterInsert === beforeH,
      {
        attempts: [hThird, hSpoof, hParty, hAnon, hAdmin].map(
          (r) => r.error?.code ?? "créée",
        ),
        // Relecture en base des lignes créées par ces tentatives.
        created: (await disputesOf())
          .filter((d) => d.id !== legacy.id)
          .map((d) => ({
            opened_by:
              d.opened_by === idC3
                ? "tiers C3"
                : d.opened_by === idC1
                  ? "candidat C1"
                  : d.opened_by,
            mission:
              d.mission_id === missionId ? "mission de C1" : d.mission_id,
          })),
      },
    );
    const change = (client: DB, values: Record<string, unknown>) =>
      client
        .from("disputes")
        .update(values as Database["public"]["Tables"]["disputes"]["Update"])
        .eq("id", legacy.id)
        .select("id");
    const [uMove, uOwner, uSupMove, uSupResolve, hDelParty, hDelSup] =
      await Promise.all([
        change(C1.client, { mission_id: mission2 }),
        change(C1.client, { opened_by: idC3, description: "Réécrit" }),
        change(SUP.client, { mission_id: mission2 }),
        change(SUP.client, { status: "resolved", resolution: "Clos hors RPC" }),
        C1.client.from("disputes").delete().eq("id", legacy.id).select("id"),
        SUP.client.from("disputes").delete().eq("id", legacy.id).select("id"),
      ]);
    const afterWrites = JSON.stringify(await disputesOf());
    report(
      "H2 ligne existante : ni rattachement à une autre mission, ni changement d'auteur, ni décision hors RPC, ni suppression (partie, support) ; ligne inchangée",
      [uMove, uOwner, uSupMove, uSupResolve, hDelParty, hDelSup].every(
        (r) => !!r.error || (r.data ?? []).length === 0,
      ) && afterWrites === beforeH,
      [uMove, uOwner, uSupMove, uSupResolve, hDelParty, hDelSup].map(
        (r) => r.error?.code ?? (r.data ?? []).length,
      ),
    );
    const [rC1, rA, rC3, rAnon] = await Promise.all([
      C1.client.from("disputes").select("id").eq("id", legacy.id),
      A.client.from("disputes").select("id").eq("id", legacy.id),
      C3.client.from("disputes").select("id").eq("id", legacy.id),
      anon.from("disputes").select("id").eq("id", legacy.id),
    ]);
    report(
      "H3 lectures : historique conservé et lisible par les parties de la mission, invisible pour un tiers et pour l'anonyme",
      (rC1.data ?? []).length === 1 &&
        (rA.data ?? []).length === 1 &&
        (rC3.data ?? []).length === 0 &&
        (rAnon.data ?? []).length === 0,
      [
        rC1.data?.length,
        rA.data?.length,
        rC3.data?.length,
        rAnon.data?.length ?? rAnon.error?.code,
      ],
    );
    const privileges = execSql(
      `select r.rolname as role, p.priv,
              has_table_privilege(r.rolname, 'public.disputes', p.priv) as granted
       from (values ('anon'), ('authenticated')) r(rolname)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
       order by 1, 2`,
    );
    // Une ligne par objet JSON de la CLI ; ordre des clés indifférent.
    const granted = [...privileges.matchAll(/\{[^{}]*\}/g)]
      .map((m) => m[0])
      .filter((o) => /"granted"\s*:\s*true/.test(o))
      .map(
        (o) =>
          `${/"role"\s*:\s*"(\w+)"/.exec(o)?.[1]}:${/"priv"\s*:\s*"(\w+)"/.exec(o)?.[1]}`,
      )
      .sort();
    const policies = execSql(
      "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'disputes' order by 1",
    );
    report(
      "H4 privilèges effectifs : seul SELECT reste à authenticated ; aucune politique d'écriture",
      granted.join(",") === "authenticated:SELECT" &&
        !/"cmd"\s*:\s*"(INSERT|UPDATE|DELETE|ALL)"/.test(policies),
      { granted, policies: policies.replace(/\s+/g, " ").slice(0, 200) },
    );
    void cand2;
  } catch (error) {
    failCount += 1;
    console.error("❌ Erreur inattendue :", error);
  } finally {
    await serviceClient
      .from("audit_logs")
      .delete()
      .in("resource_id", incidentIds)
      .then(
        () => undefined,
        () => undefined,
      );
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} réussies, ${failCount} en échec`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
