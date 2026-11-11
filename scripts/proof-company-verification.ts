/**
 * Preuve lot 11 — vérification du dossier entreprise par l'équipe EasyJob.
 *
 * Données fictives, pile locale uniquement. Les vérifications réelles auprès
 * de la DGI et du registre ou du greffe NE SONT PAS testées ici : la base
 * enregistre ce que l'admin déclare avoir constaté, avec source et
 * référence ; la preuve couvre les droits, l'état et les traces.
 *
 * Méthode :
 *   1. Fixtures en clé service : entreprise A (dossier revu), entreprise B
 *      (tiers), admin_ops O, admin_founder F, admin_support S, admin_ops X
 *      (suspendu après l'ouverture de sa session), entreprise L (ancien
 *      dossier « vérifié » pour la reprise).
 *   2. Toutes les tentatives passent par de VRAIES sessions : cookies
 *      @supabase/ssr vers les routes, ou JWT vers PostgREST et Storage. La
 *      clé service ne sert qu'aux fixtures, aux pannes provoquées, aux
 *      écritures hors parcours simulées (support) et aux relectures.
 *   3. Sections :
 *      A. Dépôt des quatre pièces, pièces manquantes, soumission.
 *      B. Consultation : trois grades, URL signées de vrais PDF multipages ;
 *         refus tiers, entreprise, anonyme, Storage et historique directs.
 *      C. Refus : auto-validation (RPC, table, historique, route), tiers,
 *         admin_support, admin suspendu (ancien jeton), saisies invalides.
 *      D. Contrôles partiels : approbation refusée avec le RCCM seul, le NIU
 *         « vérification impossible » ou refusé ; signaux Realtime.
 *      E. Correction demandée, motif, resoumission.
 *      F. Modification pendant la revue (versions et historique), contrôles
 *         concurrents.
 *      H/G. Panne dans la transaction, décisions finales simultanées.
 *      I. Approbation, création et publication d'une offre.
 *      J. Dossier invalidé après création de l'offre : modération, création
 *         et modification refusées ; offre active non modifiée ; statut forcé
 *         sans contrôles refusé ; NIU modifié par le support.
 *      K. Reprise des anciens dossiers (section 9 de la migration, rejouée
 *         telle quelle sur la pile de preuve).
 *   4. Nettoyage : objets, offres, contrôles, notifications, journaux,
 *      profils, comptes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";
import { runSupabaseQuery } from "./lib/db-query";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type CompanyRow = Database["public"]["Tables"]["company_profiles"]["Row"];
type Check = "rccm" | "niu" | "representative";

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L11-company-01!";
const PROOF_USER_METADATA = { proofCompanyVerification: true };
const BUCKET = "company-documents";
const STAMP = Date.now();

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles ────────────────────────────────────────────
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
  const r = runSupabaseQuery(DB_URL, sql, { proof: "company-verification" });
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
}

// ─── Vrai PDF multipage (pages de test, texte ASCII) ─────────────
function realPdf(title: string, pages: number): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalogue, 2 arbre des pages, 3 police ; puis page + contenu.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pages; i++) {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const text = `BT /F1 24 Tf 72 720 Td (${title} - page ${i + 1}/${pages}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] ` +
    `/Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(new TextEncoder().encode(out));
}

function pdfFile(name: string, title: string, pages = 3): File {
  return new File([realPdf(title, pages)], name, { type: "application/pdf" });
}

// ─── Fixtures ────────────────────────────────────────────────────
async function createAccount(
  email: string,
  role: Role,
  company?: { name: string; niu: string },
): Promise<string> {
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
    role,
    is_verified: false,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowErr) throw new Error(`users insert: ${rowErr.message}`);
  if (company) {
    // Comme finalizeSignup : nom et NIU saisis à l'inscription.
    const { error: profileErr } = await serviceClient
      .from("company_profiles")
      .insert({
        user_id: id,
        company_name: company.name,
        niu: company.niu,
        contact_email: email,
      });
    if (profileErr) throw new Error(`profile insert: ${profileErr.message}`);
  }
  return id;
}

async function cleanAccounts(ids: string[]) {
  if (ids.length === 0) return;
  for (const id of ids) {
    const { data: objects } = await serviceClient.storage
      .from(BUCKET)
      .list(id, { limit: 100 });
    if (objects?.length) {
      await serviceClient.storage
        .from(BUCKET)
        .remove(objects.map((o) => `${id}/${o.name}`));
    }
  }
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
      await serviceClient.from("audit_logs").delete().in("resource_id", jobIds);
    }
    await serviceClient.from("jobs").delete().in("company_id", companyIds);
    await serviceClient
      .from("audit_logs")
      .delete()
      .in("resource_id", companyIds);
    // Historique des contrôles : supprimé avec le profil (on delete cascade).
  }
  await serviceClient.from("audit_logs").delete().in("resource_id", ids);
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("company_profiles").delete().in("user_id", ids);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  // Panne provoquée d'une exécution interrompue.
  execSql(
    "drop trigger if exists proof_l11_fail_notification on public.notifications",
  );
  execSql("drop function if exists public.proof_l11_fail_notification()");
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofCompanyVerification === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
const FIELDS = {
  company_name: "Hôtel Revue SARL",
  sector: "hotel",
  company_size: "pme",
  website: "https://hotel-revue.example.cm",
  description: "Hôtel de preuve du lot 11 à Bonanjo.",
  rccm: "RC/DLA/2026/B/1111",
  city: "Douala",
  quartier: "Bonanjo",
  address: "Avenue de Gaulle, immeuble 11",
};
const REP = {
  representative_name: "Awa Preuve Fictive",
  representative_title: "Gérante",
  representative_authority: "listed_officer",
};

const JOB_BODY = {
  title: "Réceptionniste preuve L11",
  description: "Accueil des clients, preuve du lot 11.",
  address: "Avenue de Gaulle",
  city: "Douala",
  start_date: "2099-02-15",
  start_time: "08:00",
  end_time: "16:00",
  mission_pay_per_candidate: 6000,
};

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  raw: string;
};

async function toResult(res: Response): Promise<HttpResult> {
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, body: json, raw };
}

async function http(
  method: "GET" | "POST",
  url: string,
  cookie: string | null,
  body?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return toResult(
    await appFetch(`${APP_URL}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    }),
  );
}

type Files = Partial<
  Record<
    | "rccm_document"
    | "niu_document"
    | "representative_id_document"
    | "mandate_document",
    File
  >
>;

async function putOnboarding(
  cookie: string,
  fields: Record<string, string>,
  files: Files = {},
): Promise<HttpResult> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const [key, file] of Object.entries(files)) form.append(key, file);
  return toResult(
    await appFetch(`${APP_URL}/api/company/onboarding`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: form,
    }),
  );
}

async function readCompany(userId: string): Promise<CompanyRow> {
  const { data, error } = await serviceClient
    .from("company_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`readCompany: ${error?.message}`);
  return data;
}

/** Colonnes que la revue ne doit jamais toucher (hors niu_verified). */
async function protectedSnapshot(userId: string) {
  const c = await readCompany(userId);
  const { data: u } = await serviceClient
    .from("users")
    .select("role, is_active, is_verified")
    .eq("id", userId)
    .single();
  return JSON.stringify({
    niu: c.niu,
    subscription_plan: c.subscription_plan,
    subscription_tier: c.subscription_tier,
    subscription_expires_at: c.subscription_expires_at,
    trial_ends_at: c.trial_ends_at,
    trust_score: c.trust_score,
    average_rating: c.average_rating,
    total_missions_posted: c.total_missions_posted,
    late_cancellation_count: c.late_cancellation_count,
    is_active: c.is_active,
    user: u,
  });
}

async function checkRows(companyId: string) {
  const { data } = await serviceClient
    .from("company_verification_checks")
    .select("*")
    .eq("company_id", companyId)
    .order("decided_at", { ascending: true });
  return data ?? [];
}

async function decisionNotifications(userId: string) {
  const { data } = await serviceClient
    .from("notifications")
    .select("title, body, data")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []).filter(
    (n) =>
      (n.data as Record<string, unknown> | null)?.kind ===
      "company_verification",
  );
}

async function auditRows(resourceId: string) {
  const { data } = await serviceClient
    .from("audit_logs")
    .select("actor_id, actor_role, action, metadata")
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

const finalAudits = (rows: Awaited<ReturnType<typeof auditRows>>) =>
  rows.filter((r) =>
    ["approve_company_verification", "request_company_correction"].includes(
      r.action,
    ),
  );

type Mine = {
  status: string;
  missing: string[];
  rejection_reason: string | null;
  checks: Record<Check, { status: string; reason: string | null }>;
} | null;

async function myVerification(s: Session): Promise<Mine> {
  const { data } = await s.client.rpc("my_company_verification");
  return data as Mine;
}

// ─── Realtime ────────────────────────────────────────────────────
type Listener = {
  events: Record<string, unknown>[];
  close: () => Promise<void>;
};

async function listen(client: DB, topic: string): Promise<Listener | null> {
  const events: Record<string, unknown>[] = [];
  const ch = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "*" }, (message) => {
      events.push((message.payload ?? {}) as Record<string, unknown>);
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

async function waitFor(check: () => boolean, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
}

// ─── Preuve ──────────────────────────────────────────────────────
async function main() {
  console.log("Preuve lot 11 — vérification du dossier entreprise\n");
  await cleanStaleProofs();

  const ids: string[] = [];
  let failingTrigger = false;
  const listeners: Listener[] = [];
  const NIU_A = `M0${String(STAMP).slice(-11)}A`;
  const NIU_B = `M0${String(STAMP).slice(-11)}B`;
  const NIU_L = `M0${String(STAMP).slice(-11)}L`;
  try {
    const mail = (k: string) => `proof-l11-${k}-${STAMP}@easyjob.test`;
    const idA = await createAccount(mail("a"), "company", {
      name: "Hôtel Revue SARL",
      niu: NIU_A,
    });
    const idB = await createAccount(mail("b"), "company", {
      name: "Société Tierce",
      niu: NIU_B,
    });
    const idO = await createAccount(mail("ops"), "admin_ops");
    const idF = await createAccount(mail("founder"), "admin_founder");
    const idS = await createAccount(mail("support"), "admin_support");
    const idX = await createAccount(mail("ops-suspended"), "admin_ops");
    ids.push(idA, idB, idO, idF, idS, idX);

    const A = await realSession(idA, mail("a"));
    const B = await realSession(idB, mail("b"));
    const O = await realSession(idO, mail("ops"));
    const F = await realSession(idF, mail("founder"));
    const S = await realSession(idS, mail("support"));
    const X = await realSession(idX, mail("ops-suspended"));
    const companyA = (await readCompany(idA)).id;
    const snapshot0 = await protectedSnapshot(idA);
    const base = `/api/admin/companies/${companyA}`;
    const finalDecision = (s: Session | null, body: unknown) =>
      http("POST", `${base}/verification`, s?.cookie ?? null, body);
    const check = (s: Session | null, body: unknown) =>
      http("POST", `${base}/checks`, s?.cookie ?? null, body);
    type View = {
      revision: number;
      missing: string[];
      documents: Record<string, { present: boolean; kind: string }>;
      checks: Record<
        Check,
        { status: string; last_check_id: string | null; revision: number }
      >;
    };
    const dossierOf = async (s: Session) =>
      (await http("GET", `${base}/verification`, s.cookie)).body
        .dossier as View;
    /** Contrôle par la route avec la vue courante de l'admin. */
    const recordFresh = async (
      s: Session,
      c: Check,
      body: Record<string, unknown>,
    ) => {
      const d = await dossierOf(s);
      return check(s, {
        check: c,
        seen_revision: d.revision,
        seen_check: d.checks[c].last_check_id,
        ...body,
      });
    };
    const leaks = (text: string) =>
      [
        `${idA}/`,
        FIELDS.rccm,
        NIU_A,
        REP.representative_name,
        "token=",
        "DGI-REF-",
      ].filter((s) => text.includes(s));

    // ── A. Dépôt ─────────────────────────────────────────────────
    const a1 = await putOnboarding(A.cookie, FIELDS);
    const a1Mine = await myVerification(A);
    report(
      "A1 : onboarding sans pièce → enregistré, dossier_incomplete, pièces manquantes listées",
      a1.status === 200 &&
        (a1.body.verification as { code?: string })?.code ===
          "dossier_incomplete" &&
        JSON.stringify(a1Mine?.missing) ===
          JSON.stringify([
            "rccm_document",
            "niu_document",
            "representative_name",
            "representative_title",
            "representative_authority",
            "representative_id_document",
          ]),
      { body: a1.body, missing: a1Mine?.missing },
    );

    const a2 = await putOnboarding(
      A.cookie,
      { ...FIELDS, ...REP, representative_authority: "mandate" },
      {
        rccm_document: pdfFile("rccm.pdf", "RCCM fictif v1"),
        representative_id_document: pdfFile(
          "cni.pdf",
          "Piece identite fictive",
          2,
        ),
      },
    );
    report(
      "A2 : RCCM et pièce d'identité, habilitation par mandat sans mandat ni attestation NIU → toujours incomplet",
      a2.status === 200 &&
        (a2.body.verification as { code?: string })?.code ===
          "dossier_incomplete" &&
        (await readCompany(idA)).verification_submitted_at === null &&
        JSON.stringify((await myVerification(A))?.missing) ===
          JSON.stringify(["niu_document", "mandate_document"]),
      { body: a2.body },
    );

    const a3 = await putOnboarding(
      A.cookie,
      { ...FIELDS, ...REP },
      { niu_document: pdfFile("niu.pdf", "Attestation NIU fictive", 2) },
    );
    const a3Row = await readCompany(idA);
    const submitAudit = (await auditRows(companyA)).filter(
      (r) => r.action === "submit_company_verification",
    );
    report(
      "A3 : attestation NIU ajoutée, dirigeant mentionné au RCCM → submitted, file admin, trace sans donnée",
      a3.status === 200 &&
        (a3.body.verification as { outcome?: string })?.outcome ===
          "submitted" &&
        a3Row.verification_status === "pending" &&
        a3Row.verification_submitted_at !== null &&
        a3Row.niu_document_path?.startsWith(`${idA}/niu-`) === true &&
        a3Row.representative_id_document_path?.startsWith(`${idA}/rep-id-`) ===
          true &&
        submitAudit.length === 1 &&
        leaks(JSON.stringify(submitAudit)).length === 0,
      { body: a3.body, audits: submitAudit.length },
    );

    const list = await http("GET", "/api/admin/companies", O.cookie);
    const listed = (
      (list.body.companies as Record<string, unknown>[] | undefined) ?? []
    ).find((c) => c.company_id === companyA);
    report(
      "A4 : liste admin → À examiner, sans chemin",
      list.status === 200 &&
        listed?.review_state === "in_review" &&
        !list.raw.includes(`${idA}/`),
      { state: listed?.review_state },
    );

    // ── B. Consultation ──────────────────────────────────────────
    const b1 = await http("GET", `${base}/verification`, O.cookie);
    const b1d = b1.body.dossier as View | undefined;
    report(
      "B1 : fiche admin_ops → trois contrôles « à contrôler », pièces présentes, rien de manquant, aucun chemin",
      b1.status === 200 &&
        b1.body.can_decide === true &&
        (["rccm", "niu", "representative"] as Check[]).every(
          (c) => b1d?.checks[c].status === "pending",
        ) &&
        b1d?.documents.rccm.present === true &&
        b1d?.documents.niu.present === true &&
        b1d?.documents.representative_id.present === true &&
        b1d?.documents.mandate.present === false &&
        b1d?.missing.length === 0 &&
        !b1.raw.includes(`${idA}/`),
      { status: b1.status },
    );
    const b2 = await http("GET", `${base}/verification`, S.cookie);
    report(
      "B2 : fiche admin_support → lecture, aucune décision",
      b2.status === 200 && b2.body.can_decide === false,
      { status: b2.status },
    );

    const docResults: Record<string, { status: number; pages: number }> = {};
    for (const doc of ["rccm", "niu", "representative_id"]) {
      const r = await http("GET", `${base}/document-url?doc=${doc}`, O.cookie);
      let pages = 0;
      if (typeof r.body.url === "string") {
        const text = await (await fetch(r.body.url)).text();
        pages = Number(/\/Count (\d+)/.exec(text)?.[1] ?? 0);
      }
      docResults[doc] = { status: r.status, pages };
    }
    report(
      "B3 : URL signées (60 s) des trois pièces → vrais PDF multipages servis",
      docResults.rccm.status === 200 &&
        docResults.rccm.pages === 3 &&
        docResults.niu.pages === 2 &&
        docResults.representative_id.pages === 2,
      docResults,
    );
    const b4 = await http("GET", `${base}/document-url?doc=niu`, S.cookie);
    const b4m = await http("GET", `${base}/document-url?doc=mandate`, O.cookie);
    report(
      "B4 : admin_support consulte l'attestation NIU ; pièce absente (mandat) → 404",
      b4.status === 200 && b4m.status === 404,
      { support: b4.status, mandate: b4m.status },
    );

    const b5 = await Promise.all([
      http("GET", `${base}/document-url?doc=niu`, B.cookie),
      http("GET", `${base}/document-url?doc=representative_id`, A.cookie),
      http("GET", `${base}/verification`, B.cookie),
      http("GET", `${base}/document-url?doc=rccm`, null),
    ]);
    report(
      "B5 : entreprise tierce, entreprise elle-même (route admin), anonyme → 403/403/403/401, sans donnée",
      b5[0].status === 403 &&
        b5[1].status === 403 &&
        b5[2].status === 403 &&
        b5[3].status === 401 &&
        b5.every((r) => leaks(r.raw).length === 0),
      b5.map((r) => r.status),
    );
    const paths = [
      a3Row.documents_url?.[0] ?? "",
      a3Row.niu_document_path ?? "",
      a3Row.representative_id_document_path ?? "",
    ];
    let bStorage = 0;
    for (const p of paths) {
      const { data: s1 } = await B.client.storage
        .from(BUCKET)
        .createSignedUrl(p, 60);
      const { data: s2 } = await B.client.storage.from(BUCKET).download(p);
      if (s1?.signedUrl || s2) bStorage += 1;
    }
    const { data: b6Row } = await B.client
      .from("company_profiles")
      .select("id")
      .eq("id", companyA);
    const { error: b6ChecksB } = await B.client
      .from("company_verification_checks")
      .select("id");
    const { error: b6ChecksA } = await A.client
      .from("company_verification_checks")
      .select("reference_note");
    const { error: b6Fn } = await A.client.rpc(
      "company_verification_complete" as never,
      { p_company_id: companyA } as never,
    );
    report(
      "B6 : Storage direct refusé à l'entreprise tierce (3 pièces), profil invisible, historique illisible en session, fonction interne non exposée",
      bStorage === 0 &&
        (b6Row ?? []).length === 0 &&
        b6ChecksB?.code === "42501" &&
        b6ChecksA?.code === "42501" &&
        !!b6Fn,
      {
        storage: bStorage,
        rows: b6Row?.length,
        checks: [b6ChecksB?.code, b6ChecksA?.code],
        fn: b6Fn?.code,
      },
    );

    // ── C. Refus ─────────────────────────────────────────────────
    let view = await dossierOf(O);
    const rowBeforeC = JSON.stringify(await readCompany(idA));
    const noEffect = async () =>
      JSON.stringify(await readCompany(idA)) === rowBeforeC &&
      (await checkRows(companyA)).length === 0 &&
      (await decisionNotifications(idA)).length === 0 &&
      finalAudits(await auditRows(companyA)).length === 0 &&
      (await auditRows(companyA)).every(
        (r) => r.action !== "record_company_check",
      );
    const rpcCheck = (s: Session, extra: Record<string, unknown> = {}) =>
      s.client.rpc("admin_record_company_check", {
        p_company_id: companyA,
        p_check: "niu",
        p_decision: "approved",
        p_source: "dgi_online",
        p_reference: "DGI-REF-001",
        p_reason: "",
        p_seen_revision: view.revision,
        p_seen_check: null as unknown as string,
        ...extra,
      });
    const rpcFinal = (s: Session) =>
      s.client.rpc("admin_review_company", {
        p_company_id: companyA,
        p_action: "approve",
        p_reason: "",
        p_seen_revision: view.revision,
      });
    const okCheckBody = {
      check: "niu",
      decision: "approved",
      source: "dgi_online",
      reference: "DGI-REF-001",
      seen_revision: view.revision,
      seen_check: null,
    };

    const { error: c1Check } = await rpcCheck(A);
    const { error: c1Final } = await rpcFinal(A);
    const tableTries = await Promise.all(
      [
        { verification_status: "verified" as const },
        { niu_verified: true },
        { niu_revision: 99 },
        { verification_revision: 99 },
        { niu: "M000000000000Z" },
      ].map((v) =>
        A.client.from("company_profiles").update(v).eq("user_id", idA),
      ),
    );
    const { error: c1Insert } = await A.client
      .from("company_verification_checks")
      .insert({
        company_id: companyA,
        check_type: "niu",
        decision: "approved",
        check_revision: 1,
        dossier_revision: 1,
        source: "dgi_online",
        reference_note: "auto",
      });
    const c1Routes = await Promise.all([
      check(A, okCheckBody),
      finalDecision(A, { action: "approve", seen_revision: view.revision }),
    ]);
    report(
      "C1 : auto-validation (RPC contrôle et finale, colonnes protégées, NIU, historique, routes) → refusée, aucun effet",
      c1Check?.message === "forbidden" &&
        c1Final?.message === "forbidden" &&
        tableTries.every((r) => r.error?.code === "42501") &&
        c1Insert?.code === "42501" &&
        c1Routes.every((r) => r.status === 403) &&
        (await noEffect()),
      {
        rpc: [c1Check?.message, c1Final?.message],
        table: tableTries.map((r) => r.error?.code),
        insert: c1Insert?.code,
        routes: c1Routes.map((r) => r.status),
      },
    );

    const { error: c2Check } = await rpcCheck(B);
    const c2Route = await check(B, okCheckBody);
    report(
      "C2 : entreprise tierce → forbidden / 403, aucun effet",
      c2Check?.message === "forbidden" &&
        c2Route.status === 403 &&
        (await noEffect()),
      { rpc: c2Check?.message, route: c2Route.status },
    );

    const { error: c3Check } = await rpcCheck(S);
    const { error: c3Final } = await rpcFinal(S);
    const c3Routes = await Promise.all([
      check(S, okCheckBody),
      finalDecision(S, { action: "approve", seen_revision: view.revision }),
    ]);
    report(
      "C3 : admin_support → consulte mais ne contrôle ni ne décide (RPC et routes), aucun effet",
      c3Check?.message === "forbidden" &&
        c3Final?.message === "forbidden" &&
        c3Routes.every((r) => r.status === 403) &&
        (await noEffect()),
      {
        rpc: [c3Check?.message, c3Final?.message],
        routes: c3Routes.map((r) => r.status),
      },
    );

    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idX);
    const { error: c4Check } = await rpcCheck(X);
    const { error: c4Final } = await rpcFinal(X);
    const c4Routes = await Promise.all([
      check(X, okCheckBody),
      finalDecision(X, { action: "approve", seen_revision: view.revision }),
      http("GET", `${base}/verification`, X.cookie),
      http("GET", `${base}/document-url?doc=niu`, X.cookie),
    ]);
    const { data: c4Sign } = await X.client.storage
      .from(BUCKET)
      .createSignedUrl(paths[1], 60);
    report(
      "C4 : admin_ops suspendu, ancien jeton → contrôle, décision, fiche, URL et Storage refusés, aucun effet",
      c4Check?.message === "forbidden" &&
        c4Final?.message === "forbidden" &&
        c4Routes.every((r) => r.status === 403) &&
        !c4Sign?.signedUrl &&
        (await noEffect()),
      {
        rpc: [c4Check?.message, c4Final?.message],
        routes: c4Routes.map((r) => r.status),
      },
    );

    const c5 = await Promise.all([
      check(O, { ...okCheckBody, source: undefined }),
      check(O, { ...okCheckBody, source: "official_registry" }),
      check(O, { ...okCheckBody, decision: "rejected", reason: "court" }),
      check(O, {
        ...okCheckBody,
        decision: "unverifiable",
        source: undefined,
        reference: "",
      }),
      check(O, { ...okCheckBody, check: "kbis" }),
    ]);
    const { error: c5NoSource } = await rpcCheck(O, { p_source: "" });
    const { error: c5WrongSource } = await rpcCheck(O, {
      p_source: "rccm_extract",
    });
    const { error: c5NoRef } = await rpcCheck(O, { p_reference: "" });
    const { error: c5Stale } = await rpcCheck(O, {
      p_seen_revision: null as unknown as number,
    });
    report(
      "C5 : NIU sans source DGI, mauvaise source, refus sans motif, impossibilité sans note, contrôle inconnu, version absente → refusés (route et base), aucun effet",
      c5.map((r) => r.body.code).join(",") ===
        "source_required,source_required,reason_required,reference_required,invalid_check" &&
        c5NoSource?.message === "source_required" &&
        c5WrongSource?.message === "source_required" &&
        c5NoRef?.message === "reference_required" &&
        c5Stale?.message === "company_changed" &&
        (await noEffect()),
      {
        route: c5.map((r) => `${r.status}/${r.body.code}`),
        rpc: [
          c5NoSource?.message,
          c5WrongSource?.message,
          c5NoRef?.message,
          c5Stale?.message,
        ],
      },
    );

    // ── D. Contrôles partiels : jamais d'approbation ───────────
    const rtA = await listen(A.client, `user:${idA}`);
    const rtAdmin = await listen(O.client, "admin");
    if (rtA) listeners.push(rtA);
    if (rtAdmin) listeners.push(rtAdmin);

    const d1 = await recordFresh(O, "rccm", {
      decision: "approved",
      source: "official_registry",
      reference: "DGI-REF-RCCM consultation registre",
    });
    const d1Rows = await checkRows(companyA);
    const d1Audit = (await auditRows(companyA)).filter(
      (r) => r.action === "record_company_check",
    );
    view = await dossierOf(O);
    report(
      "D1 : contrôle RCCM validé → historique (auteur, date, source, référence), trace sans référence",
      d1.status === 200 &&
        d1Rows.length === 1 &&
        d1Rows[0].decided_by === idO &&
        d1Rows[0].decided_by_role === "admin_ops" &&
        d1Rows[0].source === "official_registry" &&
        d1Rows[0].reference_note === "DGI-REF-RCCM consultation registre" &&
        d1Audit.length === 1 &&
        leaks(JSON.stringify(d1Audit)).length === 0 &&
        view.checks.rccm.status === "approved",
      { status: d1.status, rows: d1Rows.length },
    );
    const d2 = await finalDecision(O, {
      action: "approve",
      seen_revision: view.revision,
    });
    report(
      "D2 : RCCM seul validé → approbation refusée (checks_incomplete), aucun effet",
      d2.status === 409 &&
        d2.body.code === "checks_incomplete" &&
        (await readCompany(idA)).verification_status === "pending" &&
        finalAudits(await auditRows(companyA)).length === 0 &&
        (await decisionNotifications(idA)).length === 0,
      d2.body,
    );

    const d3 = await recordFresh(O, "niu", {
      decision: "unverifiable",
      source: "dgi_online",
      reference: "Service DGI indisponible le 11/11",
    });
    await recordFresh(O, "representative", {
      decision: "approved",
      source: "rccm_extract",
      reference: "Gérante mentionnée à l'extrait RCCM",
    });
    view = await dossierOf(O);
    const d3Final = await finalDecision(O, {
      action: "approve",
      seen_revision: view.revision,
    });
    const d3Mine = await myVerification(A);
    const d3Row = await readCompany(idA);
    report(
      "D3 : NIU « vérification impossible » + représentant validé → dossier en attente, approbation refusée ; l'entreprise voit le NIU « en attente »",
      d3.status === 200 &&
        d3Final.status === 409 &&
        d3Final.body.code === "checks_incomplete" &&
        d3Row.verification_status === "pending" &&
        d3Row.niu_verified === false &&
        d3Mine?.checks.niu.status === "pending" &&
        d3Mine?.checks.representative.status === "approved",
      { final: d3Final.body, mine: d3Mine?.checks },
    );

    const niuReason =
      "L'attestation NIU ne correspond pas à la raison sociale.";
    const d4 = await recordFresh(O, "niu", {
      decision: "rejected",
      reason: niuReason,
    });
    view = await dossierOf(O);
    const d4Final = await finalDecision(O, {
      action: "approve",
      seen_revision: view.revision,
    });
    const d4Mine = await myVerification(A);
    const d4MineRaw = JSON.stringify(d4Mine);
    report(
      "D4 : NIU refusé → approbation refusée ; l'entreprise lit le motif, jamais la note interne ni l'auteur",
      d4.status === 200 &&
        d4Final.body.code === "checks_incomplete" &&
        d4Mine?.checks.niu.status === "rejected" &&
        d4Mine?.checks.niu.reason === niuReason &&
        !d4MineRaw.includes("DGI-REF") &&
        !d4MineRaw.includes("Service DGI indisponible") &&
        !d4MineRaw.includes(idO),
      d4Mine?.checks,
    );
    const rtOk =
      !!rtA &&
      !!rtAdmin &&
      (await waitFor(
        () =>
          rtA.events.some((p) => p.d === "profile" && p.r === companyA) &&
          rtAdmin.events.some((p) => p.d === "profile"),
      ));
    report(
      "D5 : chaque contrôle signale user:<A> et admin (domaine profile), charge { d, r } seule, sans donnée",
      rtOk &&
        [...(rtA?.events ?? []), ...(rtAdmin?.events ?? [])].every(
          (p) =>
            Object.keys(p).every((k) => ["d", "r", "id"].includes(k)) &&
            leaks(JSON.stringify(p)).length === 0,
        ),
      { a: rtA?.events.length, admin: rtAdmin?.events.length },
    );

    // ── E. Correction demandée et resoumission ─────────────────
    const reason =
      "Merci d'envoyer l'attestation NIU au nom exact de la société.";
    const e1 = await finalDecision(O, {
      action: "request_correction",
      reason,
      seen_revision: view.revision,
    });
    const e1Row = await readCompany(idA);
    const e1Notifs = await decisionNotifications(idA);
    const e1Audits = finalAudits(await auditRows(companyA));
    report(
      "E1 : correction demandée → rejected, motif, notification et trace (sans motif ni donnée) dans la même décision",
      e1.status === 200 &&
        e1Row.verification_status === "rejected" &&
        e1Row.verification_rejection_reason === reason &&
        e1Notifs.length === 1 &&
        (e1Notifs[0].body ?? "").includes(reason) &&
        e1Audits.length === 1 &&
        e1Audits[0].actor_id === idO &&
        !JSON.stringify(e1Audits).includes(reason) &&
        leaks(JSON.stringify(e1Audits) + JSON.stringify(e1Notifs)).length === 0,
      { status: e1.status, notifs: e1Notifs.length, audits: e1Audits.length },
    );
    const e2 = await Promise.all([
      finalDecision(O, {
        action: "request_correction",
        reason,
        seen_revision: view.revision,
      }),
      finalDecision(F, { action: "approve", seen_revision: view.revision }),
    ]);
    const e2Job = await http("POST", "/api/jobs", A.cookie, JOB_BODY);
    report(
      "E2 : seconde décision → 409 company_not_pending sans effet ; publication refusée",
      e2.every(
        (r) => r.status === 409 && r.body.code === "company_not_pending",
      ) &&
        (await decisionNotifications(idA)).length === 1 &&
        finalAudits(await auditRows(companyA)).length === 1 &&
        e2Job.status === 403 &&
        e2Job.body.code === "company_not_verified",
      { decisions: e2.map((r) => r.body.code), job: e2Job.status },
    );
    const e3 = await putOnboarding(A.cookie, { ...FIELDS, ...REP });
    const e3Rpc = await A.client.rpc("submit_company_verification");
    report(
      "E3 : envoi sans modifier un élément contrôlé → nothing_changed, reste en correction",
      (e3.body.verification as { code?: string })?.code === "nothing_changed" &&
        e3Rpc.error?.message === "nothing_changed" &&
        (await readCompany(idA)).verification_status === "rejected",
      e3.body,
    );
    const before4 = await readCompany(idA);
    const e4 = await putOnboarding(
      A.cookie,
      { ...FIELDS, ...REP },
      { niu_document: pdfFile("niu.pdf", "Attestation NIU fictive v2", 2) },
    );
    const e4Row = await readCompany(idA);
    const { data: oldNiu } = await serviceClient.storage
      .from(BUCKET)
      .download(before4.niu_document_path ?? "");
    const e4Mine = await myVerification(A);
    report(
      "E4 : attestation NIU remplacée puis envoi → resubmitted ; seul le NIU repasse « en attente », RCCM et représentant restent validés ; ancien fichier supprimé",
      (e4.body.verification as { outcome?: string })?.outcome ===
        "resubmitted" &&
        e4Row.verification_status === "pending" &&
        e4Row.niu_revision === before4.niu_revision + 1 &&
        e4Row.rccm_revision === before4.rccm_revision &&
        e4Row.representative_revision === before4.representative_revision &&
        e4Mine?.checks.niu.status === "pending" &&
        e4Mine?.checks.rccm.status === "approved" &&
        e4Mine?.checks.representative.status === "approved" &&
        !oldNiu,
      { body: e4.body, checks: e4Mine?.checks },
    );

    // ── F. Modification pendant la revue, concurrence ───────────
    view = await dossierOf(O); // l'admin ouvre la fiche
    const historyBefore = (await checkRows(companyA)).length;
    const before5 = await readCompany(idA);
    await putOnboarding(
      A.cookie,
      { ...FIELDS, ...REP },
      { rccm_document: pdfFile("rccm.pdf", "RCCM fictif v2") },
    );
    const f1Row = await readCompany(idA);
    const f1Stale = await check(O, {
      check: "niu",
      decision: "approved",
      source: "dgi_online",
      reference: "DGI-REF-002",
      seen_revision: view.revision,
      seen_check: view.checks.niu.last_check_id,
    });
    const f1Doc = await http("GET", `${base}/document-url?doc=rccm`, O.cookie);
    const f1Rows = await checkRows(companyA);
    const f1Mine = await myVerification(A);
    report(
      "F1 : document RCCM remplacé pendant la revue → RCCM et représentant invalidés (versions +1), décision sur l'ancienne version refusée (company_changed), historique conservé",
      f1Row.rccm_revision === before5.rccm_revision + 1 &&
        f1Row.representative_revision === before5.representative_revision + 1 &&
        f1Row.niu_revision === before5.niu_revision &&
        f1Row.verification_revision > view.revision &&
        f1Stale.status === 409 &&
        f1Stale.body.code === "company_changed" &&
        f1Rows.length === historyBefore &&
        f1Rows.some(
          (r) =>
            r.check_type === "rccm" &&
            r.decision === "approved" &&
            r.check_revision === before5.rccm_revision,
        ) &&
        f1Mine?.checks.rccm.status === "pending" &&
        f1Mine?.checks.representative.status === "pending" &&
        f1Doc.body.revision === f1Row.verification_revision,
      { stale: f1Stale.body, history: f1Rows.length },
    );

    view = await dossierOf(O);
    const f2 = await Promise.all(
      [O, O, F].map((s) =>
        check(s, {
          check: "niu",
          decision: "approved",
          source: "dgi_online",
          reference: "DGI-REF-003",
          seen_revision: view.revision,
          seen_check: view.checks.niu.last_check_id,
        }),
      ),
    );
    const f2Niu = (await checkRows(companyA)).filter(
      (r) => r.check_type === "niu" && r.reference_note === "DGI-REF-003",
    );
    report(
      "F2 : trois enregistrements simultanés du même contrôle (double clic, deux admins) → un seul retenu, les autres 409 check_changed ; NIU certifié",
      f2.filter((r) => r.status === 200).length === 1 &&
        f2
          .filter((r) => r.status !== 200)
          .every((r) => r.body.code === "check_changed") &&
        f2Niu.length === 1 &&
        (await readCompany(idA)).niu_verified === true,
      f2.map((r) => `${r.status}/${r.body.code ?? r.body.decision}`),
    );
    await recordFresh(O, "rccm", {
      decision: "approved",
      source: "court_registry",
      reference: "Greffe TPI Douala, extrait du 11/11",
    });
    await recordFresh(F, "representative", {
      decision: "approved",
      source: "rccm_extract",
      reference: "Gérante mentionnée à l'extrait du 11/11",
    });
    view = await dossierOf(O);
    report(
      "F3 : trois contrôles validés sur la version courante (RCCM par le greffe, représentant par admin_founder)",
      (["rccm", "niu", "representative"] as Check[]).every(
        (c) => view.checks[c].status === "approved",
      ),
      Object.fromEntries(
        Object.entries(view.checks).map(([k, v]) => [k, v.status]),
      ),
    );

    // ── H. Panne provoquée dans la transaction finale ───────────
    failingTrigger = true;
    execSql(`
      create or replace function public.proof_l11_fail_notification() returns trigger
      language plpgsql as $$ begin
        if new.user_id = '${idA}'::uuid
           and new.data->>'kind' = 'company_verification' then
          raise exception 'proof_l11_forced_failure';
        end if;
        return new;
      end $$
    `);
    execSql(`
      create trigger proof_l11_fail_notification before insert on public.notifications
        for each row execute function public.proof_l11_fail_notification()
    `);
    const h1Before = JSON.stringify(await readCompany(idA));
    const h1 = await finalDecision(O, {
      action: "approve",
      seen_revision: view.revision,
    });
    execSql(
      "drop trigger if exists proof_l11_fail_notification on public.notifications",
    );
    execSql("drop function if exists public.proof_l11_fail_notification()");
    failingTrigger = false;
    report(
      "H1 : échec en milieu de transaction → 500 générique, dossier inchangé, aucune trace ni notification",
      h1.status === 500 &&
        JSON.stringify(await readCompany(idA)) === h1Before &&
        finalAudits(await auditRows(companyA)).length === 1 &&
        (await decisionNotifications(idA)).length === 1 &&
        leaks(h1.raw).length === 0,
      { status: h1.status },
    );

    // ── G. Décisions finales simultanées ───────────────────────
    const g1 = await Promise.all([
      finalDecision(O, { action: "approve", seen_revision: view.revision }),
      finalDecision(O, { action: "approve", seen_revision: view.revision }),
      finalDecision(F, { action: "approve", seen_revision: view.revision }),
      finalDecision(F, {
        action: "request_correction",
        reason: "Décision concurrente qui doit échouer.",
        seen_revision: view.revision,
      }),
    ]);
    const winner = g1.find((r) => r.status === 200)?.body.status;
    report(
      "G1 : quatre décisions finales simultanées → une seule effective, une notification, une trace",
      g1.filter((r) => r.status === 200).length === 1 &&
        g1
          .filter((r) => r.status !== 200)
          .every(
            (r) => r.status === 409 && r.body.code === "company_not_pending",
          ) &&
        (await readCompany(idA)).verification_status === winner &&
        finalAudits(await auditRows(companyA)).length === 2 &&
        (await decisionNotifications(idA)).length === 2,
      g1.map((r) => `${r.status}/${r.body.code ?? r.body.status}`),
    );
    if (winner === "rejected") {
      // La suite part d'un dossier vérifié : nouvelle version puis contrôle.
      await putOnboarding(
        A.cookie,
        { ...FIELDS, ...REP },
        { niu_document: pdfFile("niu.pdf", "Attestation NIU fictive v3", 2) },
      );
      await recordFresh(O, "niu", {
        decision: "approved",
        source: "dgi_online",
        reference: "DGI-REF-004",
      });
      view = await dossierOf(O);
      const again = await finalDecision(O, {
        action: "approve",
        seen_revision: view.revision,
      });
      if (again.status !== 200) throw new Error(`approbation : ${again.raw}`);
    }

    // ── I. Approbation, création et publication ─────────────────
    const i1Row = await readCompany(idA);
    const approveNotif = (await decisionNotifications(idA)).find(
      (n) => (n.data as Record<string, unknown>).decision === "approve",
    );
    report(
      "I1 : dossier vérifié → notification « Dossier vérifié par EasyJob », NIU certifié par son contrôle, plan, réputation et compte inchangés",
      i1Row.verification_status === "verified" &&
        i1Row.niu_verified === true &&
        (await protectedSnapshot(idA)) === snapshot0 &&
        approveNotif?.title === "Dossier vérifié par EasyJob",
      { status: i1Row.verification_status, title: approveNotif?.title },
    );
    const i2 = await http("POST", "/api/jobs", A.cookie, JOB_BODY);
    const { data: jobs1 } = await serviceClient
      .from("jobs")
      .select("id, status")
      .eq("company_id", companyA);
    const job1 = jobs1?.[0];
    const i3 = job1
      ? await http("POST", `/api/admin/jobs/${job1.id}/moderate`, O.cookie, {
          action: "approve",
        })
      : null;
    const { data: job1After } = await serviceClient
      .from("jobs")
      .select("status")
      .eq("id", job1?.id ?? "")
      .single();
    report(
      "I2 : création d'une offre (POST /api/jobs, 201) puis publication par la modération",
      i2.status === 201 &&
        (jobs1 ?? []).length === 1 &&
        i3?.status === 200 &&
        job1After?.status === "active",
      { create: i2.status, moderate: i3?.status, status: job1After?.status },
    );

    // ── J. Dossier invalidé après création de l'offre ──────────
    const j0 = await http("POST", "/api/jobs", A.cookie, {
      ...JOB_BODY,
      title: "Second poste preuve L11",
    });
    const { data: job2 } = await serviceClient
      .from("jobs")
      .select("id")
      .eq("company_id", companyA)
      .eq("status", "pending_review")
      .single();
    await putOnboarding(
      A.cookie,
      { ...FIELDS, ...REP },
      {
        representative_id_document: pdfFile(
          "cni.pdf",
          "Piece identite fictive v2",
          2,
        ),
      },
    );
    const j1Row = await readCompany(idA);
    const jobAuditBefore = (await auditRows(job2?.id ?? "")).length;
    const j1 = await http(
      "POST",
      `/api/admin/jobs/${job2?.id}/moderate`,
      O.cookie,
      { action: "approve" },
    );
    const { data: job2After } = await serviceClient
      .from("jobs")
      .select("status")
      .eq("id", job2?.id ?? "")
      .single();
    const { data: job1Still } = await serviceClient
      .from("jobs")
      .select("status")
      .eq("id", job1?.id ?? "")
      .single();
    report(
      "J1 : pièce du représentant remplacée après création → dossier en revue ; approbation de l'offre en attente refusée (company_not_eligible), sans trace ; l'offre déjà active n'est pas modifiée",
      j0.status === 201 &&
        j1Row.verification_status === "pending" &&
        j1Row.verification_submitted_at !== null &&
        j1.status === 409 &&
        j1.body.code === "company_not_eligible" &&
        job2After?.status === "pending_review" &&
        (await auditRows(job2?.id ?? "")).length === jobAuditBefore &&
        job1Still?.status === "active",
      { moderate: j1.body, job2: job2After?.status, job1: job1Still?.status },
    );
    const j2Create = await A.client.rpc("create_job", {
      p_job: { ...JOB_BODY, title: "Contournement direct" },
    });
    const j2Update = await A.client.rpc("update_job", {
      p_job_id: job2?.id ?? "",
      p_job: { ...JOB_BODY, title: "Modification directe" },
    });
    const j2Route = await http("POST", "/api/jobs", A.cookie, JOB_BODY);
    report(
      "J2 : création et modification d'offre par RPC directe et par route → company_not_verified",
      j2Create.error?.message === "company_not_verified" &&
        j2Update.error?.message === "company_not_verified" &&
        j2Route.status === 403,
      {
        create: j2Create.error?.message,
        update: j2Update.error?.message,
        route: j2Route.status,
      },
    );

    // Statut forcé hors parcours (clé service) sans contrôle valide de la
    // pièce d'identité remplacée : la base refuse quand même la publication.
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "verified" })
      .eq("id", companyA);
    const j3 = await A.client.rpc("create_job", {
      p_job: { ...JOB_BODY, title: "Statut forcé" },
    });
    const j3Mod = await http(
      "POST",
      `/api/admin/jobs/${job2?.id}/moderate`,
      O.cookie,
      { action: "approve" },
    );
    report(
      "J3 : statut « verified » forcé sans contrôle valide du représentant → création et approbation d'offre refusées en base",
      j3.error?.message === "company_not_verified" &&
        j3Mod.body.code === "company_not_eligible",
      { create: j3.error?.message, moderate: j3Mod.body.code },
    );
    // NIU corrigé par le support (clé service) : la version suit aussi.
    const before6 = await readCompany(idA);
    await serviceClient
      .from("company_profiles")
      .update({ niu: `M0${String(STAMP).slice(-11)}C` })
      .eq("id", companyA);
    const j4Row = await readCompany(idA);
    report(
      "J4 : NIU modifié hors session (support) → version NIU +1, NIU décertifié, dossier remis en revue",
      j4Row.niu_revision === before6.niu_revision + 1 &&
        j4Row.niu_verified === false &&
        j4Row.verification_status === "pending",
      { niu_revision: j4Row.niu_revision, status: j4Row.verification_status },
    );

    // ── K. Reprise des anciens dossiers ─────────────────────────
    const idL = await createAccount(mail("legacy"), "company", {
      name: "Ancienne Société SARL",
      niu: NIU_L,
    });
    ids.push(idL);
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "verified", niu_verified: true })
      .eq("user_id", idL);
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20261111120000_company_verification_review.sql",
      ),
      "utf8",
    );
    // Section 9 rejouée telle quelle : sur la pile de preuve, seules les
    // fixtures de cette preuve existent à ce moment (preuves séquentielles).
    const reprise = migration.slice(
      migration.indexOf("-- ── 9. Reprise"),
      migration.indexOf("-- ── 10."),
    );
    // Une instruction par appel (la CLI n'en exécute qu'une à la fois).
    const statements = reprise
      .split(/;\s*\n/)
      .map((part) =>
        part
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((part) => part.length > 0);
    for (const statement of statements) execSql(statement);
    const lRow = await readCompany(idL);
    const lAudit = (await auditRows(lRow.id)).filter(
      (r) => r.action === "legacy_company_verification_reset",
    );
    const lSession = await realSession(idL, mail("legacy"));
    const lJob = await lSession.client.rpc("create_job", {
      p_job: { ...JOB_BODY, title: "Ancien dossier" },
    });
    const lMine = await myVerification(lSession);
    report(
      "K1 : reprise → ancien dossier « vérifié » remis en attente non soumis, NIU décertifié, état précédent tracé, pièces manquantes listées, publication refusée",
      lRow.verification_status === "pending" &&
        lRow.verification_submitted_at === null &&
        lRow.niu_verified === false &&
        lAudit.length === 1 &&
        (lAudit[0].metadata as Record<string, unknown>).previous_status ===
          "verified" &&
        (lAudit[0].metadata as Record<string, unknown>)
          .previous_niu_verified === true &&
        (lMine?.missing.length ?? 0) > 0 &&
        lJob.error?.message === "company_not_verified",
      { status: lRow.verification_status, audit: lAudit.length },
    );
  } finally {
    for (const l of listeners) await l.close().catch(() => {});
    if (failingTrigger) {
      execSql(
        "drop trigger if exists proof_l11_fail_notification on public.notifications",
      );
      execSql("drop function if exists public.proof_l11_fail_notification()");
    }
    await cleanAccounts(ids);
    console.log(
      "Nettoyage : objets, offres, contrôles, notifications, journaux, profils et comptes supprimés.",
    );
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0
        ? "vérification du dossier entreprise conforme (lot 11)"
        : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve lot 11 échouée :", err);
  process.exit(1);
});
