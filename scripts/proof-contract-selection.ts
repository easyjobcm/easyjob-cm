/**
 * Preuve lot 13 — contrat signé par l'entreprise au moment de la sélection.
 *
 * Méthode : fixtures en clé service (entreprises A et B, candidats C1 à C3,
 * offres publiées) ; tentatives en sessions RÉELLES (routes de l'application
 * avec cookies, RPC PostgREST avec le JWT) ; état relu en clé service.
 *
 *   P. Aperçu : contenu (candidat en prénom + initiale, journées, montant
 *      XAF, clauses courantes, empreinte), lecture seule (fermer l'aperçu ne
 *      laisse rien : candidature en attente, place libre), refus pour un
 *      tiers, un candidat, un anonyme.
 *   S. « Signer et sélectionner » : consentement exigé ; double clic
 *      (un seul engagement) ; réponse perdue (résultat d'origine) ; une
 *      transaction : sélection, mission, journées, codes, contrat, signature
 *      de l'entreprise sur l'empreinte présentée, notification.
 *   C. Conditions changées depuis l'aperçu (montant, clauses) : refus
 *      terms_mismatch, rien n'est écrit ; échéance franchie avant le clic :
 *      recruitment_closed, rien n'est écrit ; deux entreprises en
 *      concurrence sur un même candidat : une seule sélection, aucune
 *      signature laissée par l'autre.
 *   O. Ancien chemin : select_candidate n'existe plus ; route sans
 *      consentement refusée ; canal observé et noyau refusés en session.
 *   T. Candidat : « Signer mon contrat » dans ses tâches dès la sélection,
 *      mission commencée avant signature, tâche retirée après sa signature.
 *   V. Confidentialité : chaque partie ne voit que sa propre signature
 *      (lecture, signature, mission, candidatures) ; aucune notification à
 *      l'entreprise déjà signataire.
 *   F. PDF : contenu figé (accents, montants, toutes les journées), FR/EN,
 *      mention propre au lecteur ; accès par lien direct d'un tiers, d'un
 *      autre candidat, d'un anonyme refusé ; disponible après la mission.
 *   D. Journées au choix : un contrat distinct par journée sélectionnée.
 *   L. Reprise : contrat antérieur sans signature de l'entreprise conservé,
 *      jamais signé rétroactivement ; ancienne présélection retirable ;
 *      présélection refusée en session.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database, Json } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays, type FixtureDay } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { postSelectHttp, previewHttp } from "./lib/sign-and-select";
import { runSupabaseQuery } from "./lib/db-query";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L13-select-01!";
const PROOF_USER_METADATA = { proofContractSelection: true };
const PROOF_VERSION_PREFIX = "simple-proof-l13-";
const HOUR = 3600_000;

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };
type Session = { client: DB; cookie: string; token: string };

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
  return { client, cookie, token: data.session.access_token };
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

function execSql(sql: string) {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "contract-selection" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
  return r.stdout;
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
        ? `+2376992${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M13${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

const SECRETS = {
  lastName: "Mbarga",
  cniNumber: "CNI13000777",
  momoNumber: "+237677013013",
  address: "Akwa, immeuble bleu",
};

async function createCandidate(
  userId: string,
  firstName: string,
): Promise<string> {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: SECRETS.lastName,
      date_of_birth: "1997-02-11",
      city: "Douala",
      address: SECRETS.address,
      latitude: 4.0511,
      longitude: 9.7679,
      bio: "Candidat de preuve du lot 13.",
      cni_number: SECRETS.cniNumber,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: SECRETS.momoNumber,
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
  purgeProofJobs("contract-selection", { userIds: ids });
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
      .filter((u) => u.user_metadata?.proofContractSelection === true)
      .map((u) => u.id),
  );
  await serviceClient
    .from("contract_clause_versions")
    .delete()
    .like("id", `${PROOF_VERSION_PREFIX}%`);
}

// ─── HTTP ────────────────────────────────────────────────────────
type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Headers;
  bytes: Buffer;
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
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text, headers: res.headers, bytes };
}

// Texte d'un PDF produit par lib/contracts/pdf.ts (chaînes hexadécimales
// WinAnsi), pour vérifier son contenu.
const WIN_ANSI_BACK: Record<number, string> = {
  0x80: "€",
  0x85: "…",
  0x8c: "Œ",
  0x92: "’",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x9c: "œ",
};
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const lines: string[] = [];
  for (const m of raw.matchAll(/<([0-9a-f]*)> Tj/g)) {
    const codes = (m[1].match(/../g) ?? []).map((h) => parseInt(h, 16));
    lines.push(
      codes.map((b) => WIN_ANSI_BACK[b] ?? String.fromCharCode(b)).join(""),
    );
  }
  return lines.join("\n");
}

const longDate = (date: string, locale: "fr" | "en") =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const doualaDay = (days: number) =>
  new Date(Date.now() + HOUR + days * 24 * HOUR).toISOString().slice(0, 10);

const isHex64 = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

type Preview =
  Database["public"]["Functions"]["contract_selection_preview"]["Returns"][number];
type Selection = {
  application_id?: string;
  status?: string;
  mission_id?: string;
  contract_id?: string;
  already_selected?: boolean;
};

const CONTENT = {
  description: "Preuve du contrat signé à la sélection (lot 13).",
  address: "Boulevard de la Liberté",
  city: "Douala",
};

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();
  // Exécution interrompue : protection de publication réactivée (lot 10).
  execSql("alter table public.jobs enable trigger trg_job_publication_guard");

  const suffix = Date.now();
  const mail = (k: string) => `l13-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  const proofVersion = `${PROOF_VERSION_PREFIX}${suffix}`;

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const candUsers = await Promise.all(
      ["c1", "c2", "c3"].map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, ...candUsers);
    const coA = await createCompany(idA, "Restaurant Étoile");
    const coB = await createCompany(idB, "Hôtel Boréal");
    const [, , cand3] = await Promise.all([
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

    const job = async (
      company: string,
      title: string,
      days: FixtureDay[],
      extra: { pay?: number; positions?: number } = {},
      format: "full_period" | "per_day" = "full_period",
    ) =>
      (
        await insertJobWithDays(
          serviceClient,
          {
            ...CONTENT,
            title,
            company_id: company,
            mission_pay_per_candidate: extra.pay ?? 2500,
            positions_available: extra.positions ?? 2,
          },
          days,
          format,
        )
      ).jobId;
    const day = (date: string, start = "09:00", end = "17:00"): FixtureDay => ({
      date,
      start_time: start,
      end_time: end,
    });
    const apply = async (s: Session, jobId: string) => {
      const { data, error } = await s.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !data) throw new Error(`apply: ${error?.message}`);
      return data.id as string;
    };
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
          .from("jobs")
          .select("positions_filled")
          .eq("id", jobId)
          .single(),
      ]);
      return {
        missions: m.count ?? -1,
        contracts: c.count ?? -1,
        filled: a.data?.positions_filled ?? -1,
      };
    };
    const appStatus = async (applicationId: string) =>
      (
        await serviceClient
          .from("job_applications")
          .select("status")
          .eq("id", applicationId)
          .single()
      ).data?.status;
    const selectionNotifs = async (userId: string, applicationId: string) =>
      (
        await serviceClient
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("notification_type", "application_update")
          .eq("data->>application_id", applicationId)
      ).data?.length ?? -1;
    const contractRow = async (contractId: string) =>
      (
        await serviceClient
          .from("contracts")
          .select("*")
          .eq("id", contractId)
          .single()
      ).data!;
    const preview = async (s: Session | null, applicationId: string) => {
      const r = await previewHttp(APP_URL, applicationId, s?.cookie ?? null);
      return { ...r, preview: r.body.preview as Preview | undefined };
    };
    const signSelect = (
      s: Session | null,
      applicationId: string,
      body: unknown,
    ) =>
      postSelectHttp(APP_URL, applicationId, s?.cookie ?? null, body).then(
        (r) => ({ ...r, selection: (r.body.selection ?? {}) as Selection }),
      );

    // Offres : une date propre par engagement (lot 12 : 3 h entre deux).
    const fullDays = ["2099-09-01", "2099-09-02", "2099-09-04"];
    const jFull = await job(
      coA,
      "Équipe d'accueil événementiel",
      fullDays.map((d) => day(d)),
      { pay: 45000, positions: 2 },
    );
    const jPer = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Plonge à la journée",
        company_id: coA,
        // Résumé recalculé par la fixture (plus petit montant journalier).
        mission_pay_per_candidate: 12000,
      },
      [
        { ...day("2099-09-10", "08:00", "14:00"), pay: 12000, positions: 1 },
        { ...day("2099-09-11", "08:00", "14:00"), pay: 15000, positions: 1 },
      ],
      "per_day",
    );
    const jSimple = await job(coA, "Service du soir", [day("2099-09-20")]);
    const jDead = await job(coA, "Inventaire clos", [day("2099-09-25")]);
    const jRaceA = await job(coA, "Course A", [
      day("2099-10-01", "08:00", "12:00"),
    ]);
    const jRaceB = await job(coB, "Course B", [
      day("2099-10-01", "08:00", "12:00"),
    ]);
    const jLegacy = await job(coA, "Contrat antérieur", [day("2099-10-05")]);
    const jShort = await job(coA, "Présélection ancienne", [day("2099-10-08")]);

    // ── P. Aperçu ────────────────────────────────────────────────
    console.log("\n── P. Aperçu du contrat proposé ──");
    const app1 = await apply(C1, jFull);
    const beforeP = await counts(jFull);
    const p1 = await preview(A, app1);
    const pv1 = p1.preview;
    const t1 = (pv1?.terms ?? {}) as Record<string, unknown>;
    const days1 = (t1.days ?? []) as { date: string }[];
    report(
      "P1 aperçu : candidat (prénom + initiale), contrat formalisé de 3 journées, montant XAF, clauses courantes, empreinte",
      p1.status === 200 &&
        pv1?.candidate_name === "Aline M." &&
        pv1.company_name === "Restaurant Étoile" &&
        pv1.contract_template === "formal" &&
        days1.map((d) => d.date).join(",") === fullDays.join(",") &&
        t1.mission_pay_per_candidate === 45000 &&
        t1.currency === "XAF" &&
        t1.pay_basis === "per_mission" &&
        (t1.clauses as { version?: string } | undefined)?.version ===
          "formal-v3" &&
        isHex64(pv1.terms_hash) &&
        !p1.text.includes(SECRETS.lastName) &&
        !p1.text.includes(SECRETS.cniNumber) &&
        !p1.text.includes(SECRETS.momoNumber) &&
        !p1.text.includes(SECRETS.address),
      p1.status === 200
        ? { name: pv1?.candidate_name, template: pv1?.contract_template }
        : p1.body,
    );
    const afterP = await counts(jFull);
    report(
      "P2 fermer l'aperçu : candidature en attente, place libre, ni mission, ni contrat, ni notification",
      JSON.stringify(afterP) === JSON.stringify(beforeP) &&
        afterP.filled === 0 &&
        (await appStatus(app1)) === "pending" &&
        (await selectionNotifs(candUsers[0], app1)) === 0,
      afterP,
    );
    const [pB, pC, pAnon] = await Promise.all([
      preview(B, app1),
      preview(C1, app1),
      preview(null, app1),
    ]);
    report(
      "P3 aperçu par une entreprise tierce → 404, par le candidat → 403, anonyme → 401",
      pB.status === 404 &&
        pB.body.code === "application_not_found" &&
        pC.status === 403 &&
        pC.body.code === "not_a_company" &&
        pAnon.status === 401,
      [pB.status, pC.status, pAnon.status],
    );

    // ── S. Signer et sélectionner ────────────────────────────────
    console.log("\n── S. Signer et sélectionner ──");
    const hash1 = pv1?.terms_hash ?? "";
    const [noConsent, badHash, noBody] = await Promise.all([
      signSelect(A, app1, { terms_hash: hash1 }),
      signSelect(A, app1, { terms_hash: "abc", consent: true }),
      http("POST", `/api/applications/${app1}/select`, A.cookie),
    ]);
    report(
      "S1 sans consentement → 400 consent_required ; empreinte invalide ou corps absent → 400 ; rien n'est écrit",
      noConsent.status === 400 &&
        noConsent.body.code === "consent_required" &&
        badHash.status === 400 &&
        noBody.status === 400 &&
        JSON.stringify(await counts(jFull)) === JSON.stringify(beforeP),
      [noConsent.body.code, badHash.body.code, noBody.body.code],
    );

    const tBefore = Date.now();
    const [d1, d2] = await Promise.all([
      signSelect(A, app1, { terms_hash: hash1, consent: true }),
      signSelect(A, app1, { terms_hash: hash1, consent: true }),
    ]);
    const sel1 = d1.selection;
    const afterS = await counts(jFull);
    report(
      "S2 double clic : deux réponses 200, une seule sélection (already_selected sur l'autre), mêmes mission et contrat",
      d1.status === 200 &&
        d2.status === 200 &&
        [sel1.already_selected, d2.selection.already_selected].sort().join() ===
          "false,true" &&
        sel1.mission_id === d2.selection.mission_id &&
        sel1.contract_id === d2.selection.contract_id &&
        afterS.missions === 1 &&
        afterS.contracts === 1 &&
        afterS.filled === 1,
      { statuses: [d1.status, d2.status], afterS },
    );
    const contractId1 = sel1.contract_id ?? "";
    const missionId1 = sel1.mission_id ?? "";
    const k1 = await contractRow(contractId1);
    const { data: mdays } = await serviceClient
      .from("mission_days")
      .select("id, scheduled_date")
      .eq("mission_id", missionId1)
      .order("scheduled_date");
    const { count: codeCount } = await serviceClient
      .from("mission_completion_codes")
      .select("mission_day_id", { count: "exact", head: true })
      .eq("mission_id", missionId1);
    const proposalOk = execSql(
      `select public.contract_proposal_hash(c.application_id, c.job_id, c.candidate_id, c.company_id, c.contract_template, c.contract_data) = '${hash1}' as same
       from public.contracts c where c.id = '${contractId1}'`,
    );
    report(
      "S3 même transaction : candidature sélectionnée, 3 journées et 3 codes, contrat signé par l'entreprise sur l'empreinte présentée, candidat non signataire",
      (await appStatus(app1)) === "selected" &&
        (mdays ?? []).map((d) => d.scheduled_date).join(",") ===
          fullDays.join(",") &&
        codeCount === 3 &&
        k1.company_signed_by === idA &&
        k1.company_signed_at !== null &&
        Math.abs(new Date(k1.company_signed_at).getTime() - tBefore) < 60_000 &&
        k1.company_terms_hash === k1.terms_hash &&
        k1.status === "company_signed" &&
        k1.candidate_signed_at === null &&
        k1.contract_template === "formal" &&
        /"same"\s*:\s*true/.test(proposalOk),
      { status: k1.status, codes: codeCount },
    );
    report(
      "S4 une seule notification au candidat, qui l'invite à signer depuis ses tâches",
      (await selectionNotifs(candUsers[0], app1)) === 1,
    );
    const lost = await signSelect(A, app1, {
      terms_hash: hash1,
      consent: true,
    });
    const k1b = await contractRow(contractId1);
    report(
      "S5 réponse perdue : relance → résultat d'origine (already_selected), aucune nouvelle écriture, signature inchangée",
      lost.status === 200 &&
        lost.selection.already_selected === true &&
        lost.selection.contract_id === contractId1 &&
        k1b.company_signed_at === k1.company_signed_at &&
        JSON.stringify(await counts(jFull)) === JSON.stringify(afterS) &&
        (await selectionNotifs(candUsers[0], app1)) === 1,
      lost.selection,
    );

    // ── V. Confidentialité ───────────────────────────────────────
    console.log("\n── V. Confidentialité des signatures ──");
    const [vA, vC] = await Promise.all([
      http("GET", `/api/contracts/${contractId1}`, A.cookie),
      http("GET", `/api/contracts/${contractId1}`, C1.cookie),
    ]);
    const cA = vA.body.contract as Record<string, unknown> | undefined;
    const cC = vC.body.contract as Record<string, unknown> | undefined;
    const noSignatureDetail = (text: string) =>
      !text.includes("signed_at") &&
      !text.includes('"status"') &&
      !text.includes("_ip") &&
      !text.includes("signed_by") &&
      !text.includes("_terms_hash");
    report(
      "V1 lecture : l'entreprise voit « signé par vous », le candidat « à signer » ; aucun état, horodatage ni IP de l'autre partie",
      vA.status === 200 &&
        cA?.viewer_signed === true &&
        cA.can_sign === false &&
        cC?.viewer_signed === false &&
        cC.can_sign === true &&
        noSignatureDetail(vA.text) &&
        noSignatureDetail(vC.text),
      { company: cA?.viewer_signed, candidate: cC?.viewer_signed },
    );
    const [mA, apps] = await Promise.all([
      http("GET", `/api/missions/${missionId1}`, A.cookie),
      http("GET", `/api/jobs/${jFull}/applications`, A.cookie),
    ]);
    const appRow = (
      (apps.body.applications ?? []) as {
        application_id: string;
        contract_id?: string;
        contract_to_sign?: boolean;
      }[]
    ).find((a) => a.application_id === app1);
    report(
      "V2 mission et candidatures (entreprise) : seule sa propre signature est indiquée",
      mA.status === 200 &&
        (mA.body.mission as Record<string, unknown> | undefined)
          ?.contract_viewer_signed === true &&
        !mA.text.includes("contract_status") &&
        !mA.text.includes("candidate_signed") &&
        appRow?.contract_id === contractId1 &&
        appRow.contract_to_sign === false &&
        !apps.text.includes("candidate_signed"),
      { mission: mA.status, app: appRow?.contract_to_sign },
    );

    // ── T. Tâches du candidat ────────────────────────────────────
    console.log("\n── T. Tâches du candidat ──");
    const tasksOf = async () =>
      ((await C1.client.rpc("candidate_tasks")).data ?? []).find(
        (m) => m.mission_id === missionId1,
      );
    const task0 = await tasksOf();
    report(
      "T1 dès la sélection : la mission est dans les tâches avec « Signer mon contrat »",
      !!task0 &&
        task0.contract_id === contractId1 &&
        task0.candidate_signed === false,
      task0 ? { signed: task0.candidate_signed } : null,
    );
    // Première journée recalée sur aujourd'hui (clé service, jamais
    // commencée) : la mission peut commencer avant toute signature.
    const today = doualaDay(0);
    await serviceClient
      .from("mission_days")
      .update({
        scheduled_date: today,
        scheduled_start_time: "00:00",
        scheduled_end_time: "23:59",
      })
      .eq("id", mdays![0].id);
    const started = await http(
      "POST",
      `/api/missions/${missionId1}/start`,
      C1.cookie,
      { mission_day_id: mdays![0].id },
    );
    const task1 = await tasksOf();
    report(
      "T2 le candidat commence la mission avant de signer ; la signature reste demandée",
      started.status === 200 &&
        task1?.candidate_signed === false &&
        (await contractRow(contractId1)).candidate_signed_at === null,
      { start: started.status, code: started.body.code },
    );
    const companyNotifsBefore = (
      await serviceClient
        .from("notifications")
        .select("id")
        .eq("user_id", idA)
        .eq("data->>contract_id", contractId1)
    ).data?.length;
    const signC = await http(
      "POST",
      `/api/contracts/${contractId1}/sign`,
      C1.cookie,
      { terms_hash: k1.terms_hash, consent: true },
    );
    const task2 = await tasksOf();
    const k1c = await contractRow(contractId1);
    const companyNotifsAfter = (
      await serviceClient
        .from("notifications")
        .select("id")
        .eq("user_id", idA)
        .eq("data->>contract_id", contractId1)
    ).data?.length;
    report(
      "T3 après sa signature : tâche « Signer » retirée, contrat signé par les deux parties, réponse limitée à sa partie",
      signC.status === 200 &&
        Object.keys((signC.body.signature ?? {}) as object)
          .sort()
          .join(",") === "already_signed,contract_id,signed_party" &&
        task2?.candidate_signed === true &&
        k1c.status === "completed" &&
        k1c.company_signed_at === k1.company_signed_at,
      { sign: signC.status, status: k1c.status },
    );
    report(
      "T4 l'entreprise, déjà signataire, n'est pas notifiée de la signature du candidat",
      companyNotifsBefore === 0 && companyNotifsAfter === 0,
      [companyNotifsBefore, companyNotifsAfter],
    );

    // ── F. PDF ───────────────────────────────────────────────────
    console.log("\n── F. Contrat en PDF ──");
    const pdfUrl = (id: string, locale = "fr") =>
      `/api/contracts/${id}/pdf?locale=${locale}`;
    const [fC, fA, fEn] = await Promise.all([
      http("GET", pdfUrl(contractId1), C1.cookie),
      http("GET", pdfUrl(contractId1), A.cookie),
      http("GET", pdfUrl(contractId1, "en"), C1.cookie),
    ]);
    const txtC = pdfText(fC.bytes);
    const txtA = pdfText(fA.bytes);
    const txtEn = pdfText(fEn.bytes);
    const clausesFr = (
      (k1.contract_data as Record<string, Json>).clauses as {
        fr: { intro: string };
      }
    ).fr.intro;
    report(
      "F1 PDF du candidat : document PDF, titre accentué, les 3 journées datées, 45 000 F CFA, clauses figées, sa seule mention",
      fC.status === 200 &&
        fC.headers.get("content-type") === "application/pdf" &&
        (fC.headers.get("content-disposition") ?? "").startsWith(
          "attachment;",
        ) &&
        fC.bytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
        txtC.includes("Équipe d'accueil événementiel") &&
        fullDays.every((d) => txtC.includes(longDate(d, "fr"))) &&
        txtC.includes("45 000 F CFA") &&
        txtC.includes(clausesFr.slice(0, 40)) &&
        txtC.includes("Signé par vous") &&
        txtC.includes(`Aline ${SECRETS.lastName}`) &&
        !txtC.includes("Signé le") &&
        !txtC.includes("entreprise a signé"),
      {
        status: fC.status,
        days: fullDays.map((d) => txtC.includes(longDate(d, "fr"))),
      },
    );
    report(
      "F2 PDF de l'entreprise : candidat en prénom + initiale, aucune donnée sensible ; PDF anglais traduit",
      fA.status === 200 &&
        txtA.includes("Aline M.") &&
        !txtA.includes(SECRETS.lastName) &&
        !txtA.includes(SECRETS.cniNumber) &&
        !txtA.includes(SECRETS.momoNumber) &&
        fEn.status === 200 &&
        txtEn.includes("Signed by you") &&
        fullDays.every((d) => txtEn.includes(longDate(d, "en"))) &&
        txtEn.includes("45,000 CFA francs"),
      { company: fA.status, en: fEn.status },
    );
    const [fB, fC2, fAnon, fBad] = await Promise.all([
      http("GET", pdfUrl(contractId1), B.cookie),
      http("GET", pdfUrl(contractId1), C2.cookie),
      http("GET", pdfUrl(contractId1), null),
      http("GET", "/api/contracts/not-a-uuid/pdf", C1.cookie),
    ]);
    report(
      "F3 lien direct : entreprise tierce → 404, autre candidat → 404, anonyme → 401, identifiant invalide → 404, aucun PDF",
      fB.status === 404 &&
        fC2.status === 404 &&
        fAnon.status === 401 &&
        fBad.status === 404 &&
        [fB, fC2, fAnon, fBad].every(
          (r) => r.headers.get("content-type") !== "application/pdf",
        ),
      [fB.status, fC2.status, fAnon.status, fBad.status],
    );
    await serviceClient
      .from("missions")
      .update({ status: "completed" })
      .eq("id", missionId1);
    const [fAfterC, fAfterA] = await Promise.all([
      http("GET", pdfUrl(contractId1), C1.cookie),
      http("GET", pdfUrl(contractId1), A.cookie),
    ]);
    report(
      "F4 après la mission : les deux parties téléchargent toujours le contrat",
      fAfterC.status === 200 && fAfterA.status === 200,
      [fAfterC.status, fAfterA.status],
    );

    // ── D. Journées au choix : un contrat par journée ────────────
    console.log("\n── D. Journées au choix ──");
    const { data: perApps, error: perErr } = await C2.client.rpc(
      "apply_to_job_days",
      { p_job_id: jPer.jobId, p_day_ids: jPer.dayIds },
    );
    const perIds = ((perApps ?? []) as { id: string }[]).map((a) => a.id);
    const perSel = [];
    for (const id of perIds) {
      const pv = await preview(A, id);
      perSel.push(
        await signSelect(A, id, {
          terms_hash: pv.preview?.terms_hash,
          consent: true,
        }),
      );
    }
    const perContracts = await Promise.all(
      perSel.map((s) => contractRow(s.selection.contract_id ?? "")),
    );
    const perTerms = perContracts.map(
      (c) =>
        c.contract_data as {
          days?: { date: string }[];
          mission_pay_per_candidate?: number;
        },
    );
    report(
      "D1 deux journées choisies, deux sélections : deux contrats distincts, une journée et son montant chacun, signés par l'entreprise",
      !perErr &&
        perIds.length === 2 &&
        perSel.every((s) => s.status === 200) &&
        new Set(perContracts.map((c) => c.id)).size === 2 &&
        perTerms[0].days?.map((d) => d.date).join() === "2099-09-10" &&
        perTerms[1].days?.map((d) => d.date).join() === "2099-09-11" &&
        perTerms[0].mission_pay_per_candidate === 12000 &&
        perTerms[1].mission_pay_per_candidate === 15000 &&
        perContracts.every(
          (c) =>
            c.contract_template === "simple" &&
            c.company_signed_by === idA &&
            c.candidate_signed_at === null,
        ),
      { errors: perErr?.message, statuses: perSel.map((s) => s.status) },
    );
    const fPer = await http("GET", pdfUrl(perContracts[1].id), C2.cookie);
    const txtPer = pdfText(fPer.bytes);
    report(
      "D2 PDF d'une journée : sa date et son montant seulement",
      fPer.status === 200 &&
        txtPer.includes(longDate("2099-09-11", "fr")) &&
        !txtPer.includes(longDate("2099-09-10", "fr")) &&
        txtPer.includes("15 000 F CFA") &&
        txtPer.includes("Votre signature est attendue"),
      fPer.status,
    );

    // ── C. Conditions changées, échéance, concurrence ────────────
    console.log("\n── C. Conditions changées, échéance, concurrence ──");
    const appC = await apply(C3, jSimple);
    const pvOld = (await preview(A, appC)).preview;
    await serviceClient
      .from("jobs")
      .update({ mission_pay_per_candidate: 2600 })
      .eq("id", jSimple);
    const beforeC = await counts(jSimple);
    const changed = await signSelect(A, appC, {
      terms_hash: pvOld?.terms_hash,
      consent: true,
    });
    report(
      "C1 montant modifié après l'aperçu → 409 terms_mismatch ; ni signature, ni mission, ni contrat, ni notification",
      changed.status === 409 &&
        changed.body.code === "terms_mismatch" &&
        JSON.stringify(await counts(jSimple)) === JSON.stringify(beforeC) &&
        beforeC.contracts === 0 &&
        (await appStatus(appC)) === "pending" &&
        (await selectionNotifs(candUsers[2], appC)) === 0,
      changed.body,
    );
    const pvNew = (await preview(A, appC)).preview;
    const reSign = await signSelect(A, appC, {
      terms_hash: pvNew?.terms_hash,
      consent: true,
    });
    report(
      "C2 nouvel aperçu : nouvelle empreinte, nouveau montant, signature acceptée",
      pvNew?.terms_hash !== pvOld?.terms_hash &&
        (pvNew?.terms as Record<string, unknown> | undefined)
          ?.mission_pay_per_candidate === 2600 &&
        reSign.status === 200,
      reSign.status,
    );

    const appClause = await apply(C1, jSimple);
    const pvClause = (await preview(A, appClause)).preview;
    const { data: simpleV3 } = await serviceClient
      .from("contract_clause_versions")
      .select("body")
      .eq("id", "simple-v3")
      .single();
    const { error: insVersionErr } = await serviceClient
      .from("contract_clause_versions")
      .insert({
        id: proofVersion,
        contract_template: "simple",
        body: simpleV3!.body,
      });
    const clauseChanged = await signSelect(A, appClause, {
      terms_hash: pvClause?.terms_hash,
      consent: true,
    });
    const clauseContracts = (await counts(jSimple)).contracts;
    await serviceClient
      .from("contract_clause_versions")
      .delete()
      .eq("id", proofVersion);
    report(
      "C3 nouvelle version des clauses publiée après l'aperçu → 409 terms_mismatch, rien n'est écrit",
      !insVersionErr &&
        clauseChanged.status === 409 &&
        clauseChanged.body.code === "terms_mismatch" &&
        clauseContracts === 1 &&
        (await appStatus(appClause)) === "pending",
      { insert: insVersionErr?.message, status: clauseChanged.status },
    );

    const appDead = await apply(C3, jDead);
    const pvDead = (await preview(A, appDead)).preview;
    execSql(
      `do $$ begin
         alter table public.jobs disable trigger trg_job_publication_guard;
         update public.jobs set applications_close_at = now() - interval '1 second' where id = '${jDead}';
         alter table public.jobs enable trigger trg_job_publication_guard;
       end $$`,
    );
    const dead = await signSelect(A, appDead, {
      terms_hash: pvDead?.terms_hash,
      consent: true,
    });
    const deadCounts = await counts(jDead);
    report(
      "C4 échéance franchie entre l'aperçu et le clic → 409 recruitment_closed, aucune signature ni engagement",
      !!pvDead &&
        dead.status === 409 &&
        dead.body.code === "recruitment_closed" &&
        deadCounts.contracts === 0 &&
        deadCounts.missions === 0 &&
        (await appStatus(appDead)) === "pending",
      dead.body,
    );

    const raceA = await apply(C2, jRaceA);
    const raceB = await apply(C2, jRaceB);
    const [pvRA, pvRB] = await Promise.all([
      preview(A, raceA),
      preview(B, raceB),
    ]);
    const [rA, rB] = await Promise.all([
      signSelect(A, raceA, {
        terms_hash: pvRA.preview?.terms_hash,
        consent: true,
      }),
      signSelect(B, raceB, {
        terms_hash: pvRB.preview?.terms_hash,
        consent: true,
      }),
    ]);
    const winners = [rA, rB].filter((r) => r.status === 200);
    const losers = [rA, rB].filter((r) => r.status !== 200);
    const [cRA, cRB] = await Promise.all([counts(jRaceA), counts(jRaceB)]);
    report(
      "C5 deux entreprises sélectionnent le même candidat au même créneau : une seule réussit, l'autre candidate_schedule_conflict sans signature ni engagement",
      pvRA.status === 200 &&
        pvRB.status === 200 &&
        winners.length === 1 &&
        losers.length === 1 &&
        losers[0].body.code === "candidate_schedule_conflict" &&
        cRA.contracts + cRB.contracts === 1 &&
        cRA.missions + cRB.missions === 1 &&
        !losers[0].text.includes("Course"),
      { a: rA.status, b: rB.status, code: losers[0]?.body.code },
    );

    // ── O. Ancien chemin ─────────────────────────────────────────
    console.log("\n── O. Ancien chemin de sélection ──");
    const appO = await apply(C3, jShort);
    const oldRpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/select_candidate`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${A.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_application_id: appO }),
    });
    const { error: obsErr } = await A.client.rpc("sign_and_select_observed", {
      p_user_id: idA,
      p_application_id: appO,
      p_terms_hash: "0".repeat(64),
      p_observed_ip: "203.0.113.7",
    });
    const { error: coreErr } = await A.client.rpc(
      "contract_select_core" as never,
      {
        p_uid: idA,
        p_application_id: appO,
        p_terms_hash: "0".repeat(64),
        p_observed_ip: null,
      } as never,
    );
    const { error: anonErr } = await anon.rpc("sign_and_select", {
      p_application_id: appO,
      p_terms_hash: "0".repeat(64),
    });
    const { error: prepErr } = await A.client.rpc(
      "selection_prepare" as never,
      { p_uid: idA, p_application_id: appO } as never,
    );
    report(
      "O1 select_candidate supprimée (404) ; canal observé, noyau et préparation refusés en session, sign_and_select refusée à l'anonyme ; candidature intacte",
      oldRpc.status === 404 &&
        !!anonErr &&
        !!obsErr &&
        !!coreErr &&
        !!prepErr &&
        (await appStatus(appO)) === "pending" &&
        (await counts(jShort)).contracts === 0,
      {
        old: oldRpc.status,
        obs: obsErr?.code,
        core: coreErr?.code,
        prep: prepErr?.code,
      },
    );

    // ── L. Reprise ───────────────────────────────────────────────
    console.log("\n── L. Contrats existants et présélection ──");
    const { data: shortRows, error: shortErr } = await A.client
      .from("job_applications")
      .update({ status: "shortlisted" })
      .eq("id", appO)
      .select("id");
    report(
      "L1 présélection écrite en session → refusée, candidature toujours en attente",
      (!!shortErr || (shortRows ?? []).length === 0) &&
        (await appStatus(appO)) === "pending",
      shortErr?.message,
    );
    const appSh = await apply(C1, jShort);
    await serviceClient
      .from("job_applications")
      .update({ status: "shortlisted" })
      .eq("id", appSh);
    const pvSh = await preview(A, appSh);
    const { error: wErr } = await C1.client.rpc("withdraw_job_application", {
      p_job_id: jShort,
    });
    report(
      "L2 ancienne candidature présélectionnée : aperçu possible, retrait par le candidat accepté (historique conservé jusqu'au retrait)",
      pvSh.status === 200 && !wErr && (await appStatus(appSh)) === "withdrawn",
      { preview: pvSh.status, withdraw: wErr?.message },
    );

    // Contrat antérieur au lot : sélection, mission et contrat créés comme
    // avant (clé service), sans signature de l'entreprise.
    const appL = await apply(C3, jLegacy);
    const pvL = (await preview(A, appL)).preview!;
    const termsL = { ...(pvL.terms as { [key: string]: Json }) };
    delete termsL.clauses;
    const firstL = (termsL.days as { [key: string]: string }[])[0];
    await serviceClient
      .from("job_applications")
      .update({
        status: "selected",
        selected_at: new Date().toISOString(),
        selected_by: idA,
      })
      .eq("id", appL);
    const { data: mL } = await serviceClient
      .from("missions")
      .insert({
        job_id: jLegacy,
        candidate_id: cand3,
        application_id: appL,
        scheduled_date: firstL.date,
        scheduled_start_time: firstL.start_time,
        scheduled_end_time: firstL.end_time,
        contract_type: pvL.contract_template,
      })
      .select("id")
      .single();
    const { data: kL } = await serviceClient
      .from("contracts")
      .insert({
        application_id: appL,
        job_id: jLegacy,
        candidate_id: cand3,
        company_id: coA,
        contract_template: pvL.contract_template,
        contract_data: { ...termsL, mission_id: mL!.id },
      })
      .select("id, terms_hash")
      .single();
    const replayL = await signSelect(A, appL, {
      terms_hash: pvL.terms_hash,
      consent: true,
    });
    const kLAfter = await contractRow(kL!.id);
    const appsL = await http(
      "GET",
      `/api/jobs/${jLegacy}/applications`,
      A.cookie,
    );
    const rowL = (
      (appsL.body.applications ?? []) as {
        application_id: string;
        contract_to_sign?: boolean;
      }[]
    ).find((a) => a.application_id === appL);
    const vL = await http("GET", `/api/contracts/${kL!.id}`, A.cookie);
    report(
      "L3 contrat antérieur : « Signer et sélectionner » renvoie la sélection existante sans signer à la place de l'entreprise ; signature attendue indiquée",
      replayL.status === 200 &&
        replayL.selection.already_selected === true &&
        replayL.selection.contract_id === kL!.id &&
        kLAfter.company_signed_at === null &&
        kLAfter.status === "pending" &&
        kLAfter.terms_hash === kL!.terms_hash &&
        rowL?.contract_to_sign === true &&
        (vL.body.contract as Record<string, unknown> | undefined)?.can_sign ===
          true,
      { replay: replayL.status, company: kLAfter.company_signed_at },
    );
  } catch (error) {
    failCount += 1;
    console.error("❌ Erreur inattendue :", error);
  } finally {
    execSql("alter table public.jobs enable trigger trg_job_publication_guard");
    await serviceClient
      .from("contract_clause_versions")
      .delete()
      .eq("id", proofVersion);
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} réussies, ${failCount} en échec`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
