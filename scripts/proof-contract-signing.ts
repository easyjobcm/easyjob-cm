/**
 * Preuve lot 7b (F-07 partie contrat) — signature contrôlée des contrats.
 *
 * Méthode :
 *   1. Fixtures en service role : entreprises A (offres) et B (tierce),
 *      candidats C1 à C4. Les candidatures passent par apply_to_job et la
 *      sélection par la route du lot 7a (POST /api/applications/[id]/select)
 *      en session entreprise : les contrats sont ceux du parcours réel.
 *   2. Tentatives en sessions RÉELLES : routes de l'application avec les
 *      cookies, PostgREST et RPC directs avec le JWT. La clé service ne sert
 *      qu'aux fixtures, aux tentatives « de confiance », à la reprise
 *      simulée d'un contrat ancien et aux relectures.
 *   3. Assertions (état relu en service role) :
 *      L. Lecture : conditions figées, nom de l'entreprise, nom du candidat
 *         masqué pour l'entreprise, aucune donnée sensible, colonnes
 *         sensibles illisibles, tiers et anonyme refusés, offre modifiée
 *         après sélection sans effet.
 *      M. Forfait par candidat (lot 7c-bis) : offre 8 h-12 h à 10 000 F CFA
 *         pour 3 places, trois sélections, chaque contrat porte 10 000 XAF
 *         « par mission » ; quatrième candidature refusée ; l'empreinte couvre
 *         montant, devise et forfait.
 *      S. Signatures : candidat puis entreprise, horodatages serveur,
 *         signataires, empreintes ; relance qui retrouve l'horodatage
 *         d'origine ; notifications de l'autre partie ; mission inchangée.
 *      R. Refus : UPDATE direct du statut, des conditions ou d'une
 *         signature ; empreinte périmée ; consentement absent ; contrat
 *         tiers ; anonyme ; écriture de confiance qui modifie les conditions,
 *         remplace une signature ou forge le statut.
 *      D. Concurrence : cinq soumissions simultanées, deux signatures
 *         simultanées des deux parties.
 *      I. Provenance de l'IP : en-têtes forgés sur la route, paramètre IP en
 *         RPC directe, canal de la route réservé au rôle service.
 *      CL. Texte accepté : clauses FR/EN figées, nouvelle version publiée
 *         après la signature du candidat, l'entreprise signe la version du
 *         candidat, empreinte d'une autre version refusée, relance.
 *      H. Contrat ancien (signature sans empreinte, statut incohérent,
 *         signé sans clauses figées, type non reconnu) : signalé, signature
 *         refusée, rien n'est déduit ni attribué.
 *      La reprise elle-même (migration appliquée sur des contrats du lot 7a)
 *      se vérifie hors de cette preuve : AUDIT.md §19.
 *   4. Nettoyage : notifications, contrats, missions, candidatures, offres,
 *      profils, comptes.
 *
 * Signature : consentement électronique (SRS §6.7, §11.8), sans image ;
 * aucun fichier n'est déposé.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database, Json } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { appFetch } from "./lib/app-fetch";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L7b-sign-01!";
const PROOF_USER_METADATA = { proofContractSigning: true };
/** Version courante des clauses simples (lot 7c-bis : forfait par mission). */
const CURRENT_SIMPLE = "simple-v2";
const CURRENT_FORMAL = "formal-v2";
const PROOF_VERSION_PREFIX = "simple-proof-l7b-";
const PROOF_VERSION = `${PROOF_VERSION_PREFIX}${Date.now()}`;

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

// ─── SQL local (reprise simulée, pile dédiée) ────────────────────
function execSql(sql: string) {
  const tmp = path.join(
    os.tmpdir(),
    `proof-contract-signing-${Date.now()}.sql`,
  );
  fs.writeFileSync(tmp, sql, "utf-8");
  const command = "pnpm exec supabase db query --output-format json";
  const isWin = process.platform === "win32";
  const args = isWin
    ? ["/d", "/s", "/c", `${command} --db-url ${DB_URL} -f ${tmp}`]
    : ["-c", `${command} --db-url '${DB_URL}' -f '${tmp}'`];
  const r = spawnSync(isWin ? "cmd.exe" : "sh", args, {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stdout || r.stderr || "").slice(0, 300)}`,
    );
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
        ? `+2376991${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M7B${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  return data.id;
}

const SECRETS = {
  lastName: "Ndongmo",
  cniNumber: "CNI7B000123",
  momoNumber: "+237677007002",
  address: "Carrefour Ndokoti, porte verte",
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
      date_of_birth: "1996-04-20",
      city: "Douala",
      address: SECRETS.address,
      latitude: 4.0611,
      longitude: 9.7429,
      bio: "Candidat de preuve du lot 7b.",
      cni_number: SECRETS.cniNumber,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
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
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const { data: candidates } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  const candidateIds = (candidates ?? []).map((c) => c.id);
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
  if (candidateIds.length > 0) {
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .in("id", candidateIds);
  }
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
      .filter((u) => u.user_metadata?.proofContractSigning === true)
      .map((u) => u.id),
  );
  await cleanProofVersions();
}

/** Versions de clauses publiées par la preuve (après leurs contrats). */
async function cleanProofVersions() {
  await serviceClient
    .from("contract_clause_versions")
    .delete()
    .like("id", `${PROOF_VERSION_PREFIX}%`);
}

// ─── Requêtes ────────────────────────────────────────────────────
const JOB_BODY = {
  title: "Serveur preuve L7b",
  description: "Service en salle, preuve du lot 7b.",
  address: "Rue de la preuve",
  city: "Douala",
  start_date: "2099-03-10",
  start_time: "09:00",
  end_time: "17:00",
  mission_pay_per_candidate: 1500,
};

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
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const send = () =>
    appFetch(`${APP_URL}${url}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      redirect: "manual",
    });
  const res = await send();
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

type ContractView =
  Database["public"]["Functions"]["get_contract"]["Returns"][number];
type Signature =
  Database["public"]["Functions"]["sign_contract"]["Returns"][number];

const isHex64 = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();

  const suffix = Date.now();
  const mail = (k: string) => `l7b-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  let legacyTriggerOff = false;

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const candidateUsers = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, ...candidateUsers);
    const [idC1, idC2, idC3] = candidateUsers;

    const coA = await createCompany(idA, "Restaurant A");
    await createCompany(idB, "Hôtel B");
    await Promise.all([
      createCandidate(candidateUsers[0], "Aline"),
      createCandidate(candidateUsers[1], "Boris"),
      createCandidate(candidateUsers[2], "Carine"),
      createCandidate(candidateUsers[3], "Didier"),
    ]);

    const A = await realSession(mail("a"));
    const B = await realSession(mail("b"));
    const C = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => realSession(mail(k))),
    );
    const [C1, C2, C3, C4] = C;
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    async function seedJob(title: string, endDate?: string): Promise<string> {
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          ...JOB_BODY,
          title,
          end_date: endDate ?? null,
          company_id: coA,
          status: "active",
          positions_available: 4,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id;
    }

    /** Contrat créé par le parcours du lot 7a (candidature puis sélection). */
    async function contractFor(candidate: Session, jobId: string) {
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
        | { contract_id?: string; mission_id?: string }
        | undefined;
      if (sel.status !== 200 || !selection?.contract_id) {
        throw new Error(`select: HTTP ${sel.status} ${sel.text.slice(0, 200)}`);
      }
      return {
        applicationId: app.id as string,
        contractId: selection.contract_id,
        missionId: selection.mission_id ?? null,
      };
    }

    async function row(contractId: string) {
      const { data } = await serviceClient
        .from("contracts")
        .select("*")
        .eq("id", contractId)
        .single();
      return data!;
    }

    /** Notifications de signature (la sélection, lot 7a, en a une autre). */
    async function notificationsFor(contractId: string) {
      const { data } = await serviceClient
        .from("notifications")
        .select("user_id, notification_type, data")
        .eq("notification_type", "mission_update")
        .eq("data->>contract_id", contractId);
      return data ?? [];
    }

    const view = (session: Session | null, contractId: string) =>
      http("GET", `/api/contracts/${contractId}`, session?.cookie ?? null);
    const sign = (
      session: Session | null,
      contractId: string,
      body: unknown,
      headers?: Record<string, string>,
    ) =>
      http(
        "POST",
        `/api/contracts/${contractId}/sign`,
        session?.cookie ?? null,
        body,
        headers,
      );

    const job1 = await seedJob("Serveur preuve L7b");
    const job2 = await seedJob("Plonge preuve L7b");
    const job3 = await seedJob("Accueil preuve L7b");
    const job4 = await seedJob("Caisse preuve L7b");
    const job5 = await seedJob("Vestiaire preuve L7b");
    const job6 = await seedJob("Bar preuve L7b");
    const job7 = await seedJob("Cuisine preuve L7b");
    const job8 = await seedJob("Livraison preuve L7b");
    // Trois jours : contrat formalisé (lot 7a, SRS §6.7).
    const job9 = await seedJob("Inventaire preuve L7b", "2099-03-12");
    const job10 = await seedJob("Réserve preuve L7b");

    const k1 = await contractFor(C1, job1);
    const k2 = await contractFor(C2, job2);
    const k3 = await contractFor(C3, job3);
    const k4 = await contractFor(C4, job4);

    // ── L. Lecture ───────────────────────────────────────────────
    const before = await row(k1.contractId);
    const g1 = await view(C1, k1.contractId);
    const v1 = g1.body.contract as ContractView | undefined;
    const terms1 = (v1?.terms ?? {}) as Record<string, unknown>;
    report(
      "L1 candidat : conditions figées, entreprise, état pending, signable",
      g1.status === 200 &&
        v1?.viewer_party === "candidate" &&
        v1.status === "pending" &&
        v1.can_sign === true &&
        v1.needs_review === false &&
        v1.company_name === "Restaurant A" &&
        v1.candidate_name === `Aline ${SECRETS.lastName}` &&
        terms1.job_title === "Serveur preuve L7b" &&
        terms1.mission_pay_per_candidate === 1500 &&
        terms1.currency === "XAF" &&
        terms1.pay_basis === "per_mission" &&
        !("hourly_rate" in terms1) &&
        terms1.start_date === "2099-03-10" &&
        v1.mission_id === k1.missionId &&
        isHex64(v1.terms_hash) &&
        (terms1.clauses as Record<string, unknown> | undefined)?.version ===
          CURRENT_SIMPLE &&
        v1.terms_hash === before.terms_hash,
      g1.status === 200
        ? {
            party: v1?.viewer_party,
            status: v1?.status,
            company: v1?.company_name,
          }
        : g1.text.slice(0, 200),
    );

    const g2 = await view(A, k1.contractId);
    const v2 = g2.body.contract as ContractView | undefined;
    report(
      "L2 entreprise : même contrat, candidat en prénom + initiale, aucune donnée sensible",
      g2.status === 200 &&
        v2?.viewer_party === "company" &&
        v2.terms_hash === v1?.terms_hash &&
        v2.candidate_name === "Aline N." &&
        !g2.text.includes(SECRETS.lastName) &&
        !g2.text.includes(SECRETS.cniNumber) &&
        !g2.text.includes(SECRETS.momoNumber) &&
        !g2.text.includes(SECRETS.address) &&
        !g2.text.includes("_ip") &&
        !g2.text.includes("signed_by"),
      { status: g2.status, name: v2?.candidate_name },
    );

    const [gB, gC2, gAnon, gBad] = await Promise.all([
      view(B, k1.contractId),
      view(C2, k1.contractId),
      view(null, k1.contractId),
      view(C1, "not-a-uuid"),
    ]);
    report(
      "L3 entreprise tierce, autre candidat → 404 ; anonyme → 401 ; id invalide → 404",
      gB.status === 404 &&
        gC2.status === 404 &&
        gAnon.status === 401 &&
        gBad.status === 404,
      [gB.status, gC2.status, gAnon.status, gBad.status],
    );

    const { error: rpcB } = await B.client.rpc("get_contract", {
      p_contract_id: k1.contractId,
    });
    const { error: rpcAnon } = await anon.rpc("get_contract", {
      p_contract_id: k1.contractId,
    });
    report(
      "L4 RPC directe : tiers → contract_not_found, anonyme refusé",
      rpcB?.message === "contract_not_found" && !!rpcAnon,
      [rpcB?.message, rpcAnon?.code],
    );

    const { error: starErr } = await C1.client
      .from("contracts")
      .select("*")
      .eq("id", k1.contractId);
    const { error: ipErr } = await A.client
      .from("contracts")
      .select("id, candidate_ip")
      .eq("id", k1.contractId);
    const { error: sigUrlErr } = await A.client
      .from("contracts")
      .select("id, candidate_signature_url, candidate_signed_by")
      .eq("id", k1.contractId);
    const { data: okCols, error: okErr } = await A.client
      .from("contracts")
      .select("id, application_id, status, terms_hash, candidate_signed_at")
      .eq("job_id", job1);
    const { data: bCols } = await B.client
      .from("contracts")
      .select("id")
      .eq("id", k1.contractId);
    report(
      "L5 SELECT direct : colonnes sensibles refusées, colonnes d'état lisibles par la partie, invisibles pour un tiers",
      !!starErr &&
        !!ipErr &&
        !!sigUrlErr &&
        !okErr &&
        okCols?.length === 1 &&
        okCols[0].id === k1.contractId &&
        (bCols ?? []).length === 0,
      {
        star: starErr?.code,
        ip: ipErr?.code,
        sig: sigUrlErr?.code,
        ok: okErr?.message,
        third: bCols?.length,
      },
    );

    // L'offre change après la sélection : le contrat garde ses conditions.
    await serviceClient
      .from("jobs")
      .update({
        title: "Titre modifié après sélection",
        mission_pay_per_candidate: 9999,
      })
      .eq("id", job1);
    const g6 = await view(C1, k1.contractId);
    const v6 = g6.body.contract as ContractView | undefined;
    const t6 = (v6?.terms ?? {}) as Record<string, unknown>;
    report(
      "L6 offre modifiée après sélection : conditions et empreinte du contrat inchangées",
      g6.status === 200 &&
        t6.job_title === "Serveur preuve L7b" &&
        t6.mission_pay_per_candidate === 1500 &&
        v6?.terms_hash === before.terms_hash,
      { title: t6.job_title, pay: t6.mission_pay_per_candidate },
    );

    // ── M. Forfait par candidat (lot 7c-bis) ─────────────────────
    // Inventaire 8 h-12 h, 3 places, 10 000 F CFA : chaque contrat porte
    // 10 000 XAF, jamais multiplié par la durée ni par le nombre de places.
    const { data: invJob, error: invErr } = await serviceClient
      .from("jobs")
      .insert({
        ...JOB_BODY,
        title: "Inventaire preuve L7c-bis",
        start_time: "08:00",
        end_time: "12:00",
        mission_pay_per_candidate: 10000,
        positions_available: 3,
        company_id: coA,
        status: "active",
      })
      .select("id")
      .single();
    if (invErr || !invJob) throw new Error(`job seed: ${invErr?.message}`);
    const invContracts = [];
    for (const cand of [C1, C2, C3]) {
      invContracts.push(await contractFor(cand, invJob.id));
    }
    const invViews = await Promise.all(
      invContracts.map((k, i) => view([C1, C2, C3][i], k.contractId)),
    );
    const invTerms = invViews.map(
      (g) =>
        ((g.body.contract as ContractView | undefined)?.terms ?? {}) as Record<
          string,
          unknown
        >,
    );
    const { data: invRow } = await serviceClient
      .from("jobs")
      .select("positions_filled, mission_pay_per_candidate")
      .eq("id", invJob.id)
      .single();
    report(
      "M1 3 places à 10 000 F CFA, 3 sélections : chaque candidat lit 10 000 XAF forfaitaires dans son contrat, horaires 08:00-12:00 conservés",
      invViews.every((g) => g.status === 200) &&
        invTerms.every(
          (t) =>
            t.mission_pay_per_candidate === 10000 &&
            t.currency === "XAF" &&
            t.pay_basis === "per_mission" &&
            t.start_time === "08:00:00" &&
            t.end_time === "12:00:00" &&
            !("hourly_rate" in t),
        ) &&
        new Set(invContracts.map((k) => k.contractId)).size === 3 &&
        invRow?.positions_filled === 3 &&
        invRow.mission_pay_per_candidate === 10000,
      invTerms.map((t) => [
        t.mission_pay_per_candidate,
        t.currency,
        t.pay_basis,
      ]),
    );

    // Offre pleine : la candidature est déjà refusée (apply_to_job), et une
    // sélection d'une candidature antérieure le serait (select_candidate).
    const { data: invApp4, error: invApp4Err } = await C4.client.rpc(
      "apply_to_job",
      { p_job_id: invJob.id },
    );
    const { data: invContractRows } = await serviceClient
      .from("contracts")
      .select("id")
      .eq("job_id", invJob.id);
    report(
      "M2 offre pleine (3/3) : quatrième candidature refusée (no_positions), toujours 3 contrats",
      !invApp4 &&
        invApp4Err?.message === "no_positions" &&
        (invContractRows ?? []).length === 3,
      invApp4Err?.message,
    );

    // L'empreinte (contract_terms_hash) porte sur le montant, la devise et
    // la nature forfaitaire : une valeur différente donne une autre empreinte.
    const coverage = execSql(
      `select (c.terms_hash = public.contract_terms_hash(c)
         and public.contract_terms_hash(jsonb_populate_record(c, jsonb_build_object('contract_data', c.contract_data || '{"mission_pay_per_candidate": 20000}'::jsonb))) <> c.terms_hash
         and public.contract_terms_hash(jsonb_populate_record(c, jsonb_build_object('contract_data', c.contract_data || '{"currency": "EUR"}'::jsonb))) <> c.terms_hash
         and public.contract_terms_hash(jsonb_populate_record(c, jsonb_build_object('contract_data', c.contract_data || '{"pay_basis": "per_hour"}'::jsonb))) <> c.terms_hash) as covered
       from public.contracts c where c.id = '${invContracts[0].contractId}'`,
    );
    const invSign = await sign(C1, invContracts[0].contractId, {
      terms_hash: (invViews[0].body.contract as ContractView | undefined)
        ?.terms_hash,
      consent: true,
    });
    const invSigned = await row(invContracts[0].contractId);
    report(
      "M3 empreinte : couvre montant, devise et forfait ; la signature du candidat porte sur ces conditions",
      /"covered"\s*:\s*true/.test(coverage) &&
        invSign.status === 200 &&
        invSigned.candidate_terms_hash === invSigned.terms_hash &&
        (invSigned.contract_data as Record<string, unknown>)
          ?.mission_pay_per_candidate === 10000,
      { coverage: coverage.slice(0, 120), sign: invSign.status },
    );

    // ── R. Refus avant signature ─────────────────────────────────
    const { data: upd1, error: updErr1 } = await C1.client
      .from("contracts")
      .update({
        status: "completed",
        candidate_signed_at: new Date().toISOString(),
        company_signed_at: new Date().toISOString(),
      })
      .eq("id", k1.contractId)
      .select("id");
    const { data: upd2, error: updErr2 } = await A.client
      .from("contracts")
      .update({
        contract_data: { job_title: "Forgé", mission_pay_per_candidate: 1 },
      })
      .eq("id", k1.contractId)
      .select("id");
    const { data: upd3, error: updErr3 } = await C1.client
      .from("contracts")
      .update({ candidate_id: before.candidate_id })
      .eq("id", k1.contractId)
      .select("id");
    const afterR = await row(k1.contractId);
    report(
      "R1 UPDATE direct (statut, signatures, conditions, parties) refusé, ligne inchangée",
      (!!updErr1 || (upd1 ?? []).length === 0) &&
        (!!updErr2 || (upd2 ?? []).length === 0) &&
        (!!updErr3 || (upd3 ?? []).length === 0) &&
        afterR.status === "pending" &&
        afterR.candidate_signed_at === null &&
        afterR.company_signed_at === null &&
        JSON.stringify(afterR.contract_data) ===
          JSON.stringify(before.contract_data) &&
        afterR.updated_at === before.updated_at,
      [updErr1?.code, updErr2?.code, updErr3?.code],
    );

    const { error: insErr } = await C1.client.from("contracts").insert({
      application_id: k1.applicationId,
      job_id: job1,
      candidate_id: before.candidate_id,
      company_id: coA,
      contract_template: "simple",
    });
    const { error: delErr } = await A.client
      .from("contracts")
      .delete()
      .eq("id", k1.contractId);
    report(
      "R2 INSERT et DELETE directs refusés",
      !!insErr && !!delErr && (await row(k1.contractId)).id === k1.contractId,
      [insErr?.code, delErr?.code],
    );

    const staleHash = "0".repeat(64);
    const [rStale, rNoConsent, rBadHash, rB, rC2, rAnon] = await Promise.all([
      sign(C1, k1.contractId, { terms_hash: staleHash, consent: true }),
      sign(C1, k1.contractId, { terms_hash: before.terms_hash }),
      sign(C1, k1.contractId, { terms_hash: "abc", consent: true }),
      sign(B, k1.contractId, { terms_hash: before.terms_hash, consent: true }),
      sign(C2, k1.contractId, { terms_hash: before.terms_hash, consent: true }),
      sign(null, k1.contractId, {
        terms_hash: before.terms_hash,
        consent: true,
      }),
    ]);
    const { error: rpcThird } = await B.client.rpc("sign_contract", {
      p_contract_id: k1.contractId,
      p_terms_hash: before.terms_hash!,
    });
    const { error: rpcAnonSign } = await anon.rpc("sign_contract", {
      p_contract_id: k1.contractId,
      p_terms_hash: before.terms_hash!,
    });
    const afterR3 = await row(k1.contractId);
    report(
      "R3 empreinte périmée → 409 terms_mismatch ; sans consentement → 400 ; empreinte invalide → 400",
      rStale.status === 409 &&
        rStale.body.code === "terms_mismatch" &&
        rNoConsent.status === 400 &&
        rNoConsent.body.code === "consent_required" &&
        rBadHash.status === 400,
      [rStale.status, rStale.body.code, rNoConsent.body.code, rBadHash.status],
    );
    report(
      "R4 contrat tiers (entreprise B, autre candidat) → 404 ; anonyme → 401 ; RPC directe refusée",
      rB.status === 404 &&
        rC2.status === 404 &&
        rAnon.status === 401 &&
        rpcThird?.message === "contract_not_found" &&
        !!rpcAnonSign &&
        afterR3.candidate_signed_at === null &&
        afterR3.company_signed_at === null &&
        afterR3.status === "pending",
      [
        rB.status,
        rC2.status,
        rAnon.status,
        rpcThird?.message,
        rpcAnonSign?.code,
      ],
    );

    // ── S. Signature du candidat, puis de l'entreprise ───────────
    const tBefore = Date.now();
    const s1 = await sign(C1, k1.contractId, {
      terms_hash: before.terms_hash,
      consent: true,
    });
    const sig1 = s1.body.signature as Signature | undefined;
    const r1 = await row(k1.contractId);
    const n1 = await notificationsFor(k1.contractId);
    report(
      "S1 première signature (candidat) : candidate_signed, horodatage serveur, signataire et empreinte enregistrés",
      s1.status === 200 &&
        sig1?.signed_party === "candidate" &&
        sig1.already_signed === false &&
        sig1.status === "candidate_signed" &&
        r1.status === "candidate_signed" &&
        r1.candidate_signed_at !== null &&
        Math.abs(new Date(r1.candidate_signed_at).getTime() - tBefore) <
          60_000 &&
        r1.candidate_signed_by === idC1 &&
        r1.candidate_terms_hash === r1.terms_hash &&
        r1.company_signed_at === null &&
        r1.company_signed_by === null &&
        r1.candidate_signature_url === null,
      {
        status: r1.status,
        party: sig1?.signed_party,
        ip: r1.candidate_ip === null ? null : "présente",
      },
    );
    report(
      "S2 notification « Contrat à signer » à l'entreprise uniquement",
      n1.length === 1 &&
        n1[0].user_id === idA &&
        n1[0].notification_type === "mission_update",
      n1.map((n) => n.user_id === idA),
    );

    // Relances : double clic et réponse perdue.
    const s1b = await sign(C1, k1.contractId, {
      terms_hash: before.terms_hash,
      consent: true,
    });
    const { data: rpcAgain } = await C1.client.rpc("sign_contract", {
      p_contract_id: k1.contractId,
      p_terms_hash: staleHash,
    });
    const r1b = await row(k1.contractId);
    const sig1b = s1b.body.signature as Signature | undefined;
    report(
      "S3 relance : signature d'origine renvoyée (already_signed), horodatage inchangé, aucune notification de plus",
      s1b.status === 200 &&
        sig1b?.already_signed === true &&
        sig1b.candidate_signed_at === sig1?.candidate_signed_at &&
        rpcAgain?.[0]?.already_signed === true &&
        r1b.candidate_signed_at === r1.candidate_signed_at &&
        r1b.updated_at === r1.updated_at &&
        r1b.company_signed_at === null &&
        (await notificationsFor(k1.contractId)).length === 1,
      { first: sig1?.candidate_signed_at, again: sig1b?.candidate_signed_at },
    );

    // Le candidat ne peut pas signer pour l'entreprise : aucune entrée ne
    // désigne la partie, et l'écriture directe reste fermée.
    const { data: forge, error: forgeErr } = await C1.client
      .from("contracts")
      .update({
        company_signed_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", k1.contractId)
      .select("id");
    const r1c = await row(k1.contractId);
    report(
      "S4 le candidat ne peut ni signer pour l'entreprise ni forger 'completed'",
      (!!forgeErr || (forge ?? []).length === 0) &&
        r1c.company_signed_at === null &&
        r1c.status === "candidate_signed",
      forgeErr?.code,
    );

    const g7 = await view(A, k1.contractId);
    const v7 = g7.body.contract as ContractView | undefined;
    report(
      "S5 l'entreprise retrouve la signature du candidat et peut signer",
      g7.status === 200 &&
        v7?.candidate_signed_at === r1.candidate_signed_at &&
        v7.company_signed_at === null &&
        v7.status === "candidate_signed" &&
        v7.can_sign === true,
      { status: v7?.status },
    );

    const s2 = await sign(A, k1.contractId, {
      terms_hash: v7?.terms_hash,
      consent: true,
    });
    const sig2 = s2.body.signature as Signature | undefined;
    const r2 = await row(k1.contractId);
    const n2 = await notificationsFor(k1.contractId);
    report(
      "S6 seconde signature (entreprise) : completed, deux horodatages, signataires et empreintes",
      s2.status === 200 &&
        sig2?.signed_party === "company" &&
        sig2.status === "completed" &&
        r2.status === "completed" &&
        r2.candidate_signed_at === r1.candidate_signed_at &&
        r2.candidate_signed_by === idC1 &&
        r2.company_signed_by === idA &&
        r2.company_signed_at !== null &&
        new Date(r2.company_signed_at).getTime() >=
          new Date(r1.candidate_signed_at!).getTime() &&
        r2.company_terms_hash === r2.terms_hash &&
        r2.candidate_terms_hash === r2.terms_hash &&
        JSON.stringify(r2.contract_data) ===
          JSON.stringify(before.contract_data),
      { status: r2.status },
    );
    report(
      "S7 notification de double signature au candidat",
      n2.length === 2 &&
        n2.some(
          (n) =>
            n.user_id === idC1 &&
            (n.data as Record<string, unknown>)?.contract_status ===
              "completed",
        ),
      n2.length,
    );

    const [gC1end, gAend] = await Promise.all([
      view(C1, k1.contractId),
      view(A, k1.contractId),
    ]);
    const e1 = gC1end.body.contract as ContractView | undefined;
    const e2 = gAend.body.contract as ContractView | undefined;
    report(
      "S8 relecture par les deux parties : même état, mêmes horodatages, plus rien à signer",
      e1?.status === "completed" &&
        e2?.status === "completed" &&
        e1.candidate_signed_at === e2.candidate_signed_at &&
        e1.company_signed_at === e2.company_signed_at &&
        e1.terms_hash === e2.terms_hash &&
        e1.can_sign === false &&
        e2.can_sign === false,
      [e1?.status, e2?.status],
    );

    const [again1, again2] = await Promise.all([
      sign(C1, k1.contractId, { terms_hash: before.terms_hash, consent: true }),
      sign(A, k1.contractId, { terms_hash: before.terms_hash, consent: true }),
    ]);
    const r2b = await row(k1.contractId);
    report(
      "S9 après double signature : relances sans effet, horodatages d'origine",
      (again1.body.signature as Signature | undefined)?.already_signed ===
        true &&
        (again2.body.signature as Signature | undefined)?.already_signed ===
          true &&
        r2b.candidate_signed_at === r2.candidate_signed_at &&
        r2b.company_signed_at === r2.company_signed_at &&
        r2b.updated_at === r2.updated_at,
    );

    const { data: mission1 } = await serviceClient
      .from("missions")
      .select("status, actual_start_time, payment_status")
      .eq("id", k1.missionId!)
      .single();
    const { data: app1 } = await serviceClient
      .from("job_applications")
      .select("status")
      .eq("id", k1.applicationId)
      .single();
    report(
      "S10 signature distincte de la mission : mission et candidature inchangées",
      mission1?.status === "pending" &&
        mission1.actual_start_time === null &&
        app1?.status === "selected",
      { mission: mission1?.status, application: app1?.status },
    );

    // ── R. Écritures de confiance (clé service) ──────────────────
    const trusted = [
      await serviceClient
        .from("contracts")
        .update({ contract_data: { job_title: "Réécrit" } })
        .eq("id", k1.contractId)
        .select("id"),
      await serviceClient
        .from("contracts")
        .update({ candidate_signed_at: null, status: "company_signed" })
        .eq("id", k1.contractId)
        .select("id"),
      await serviceClient
        .from("contracts")
        .update({ candidate_signed_at: "2020-01-01T00:00:00Z" })
        .eq("id", k1.contractId)
        .select("id"),
      await serviceClient
        .from("contracts")
        .update({ status: "pending" })
        .eq("id", k1.contractId)
        .select("id"),
      await serviceClient
        .from("contracts")
        .update({ terms_hash: staleHash })
        .eq("id", k1.contractId)
        .select("id"),
    ];
    const r2c = await row(k1.contractId);
    report(
      "R5 même en clé service : conditions, empreinte et signatures immuables, 'completed' définitif",
      trusted.every((r) => !!r.error) &&
        r2c.status === "completed" &&
        r2c.candidate_signed_at === r2.candidate_signed_at &&
        r2c.terms_hash === r2.terms_hash &&
        JSON.stringify(r2c.contract_data) ===
          JSON.stringify(before.contract_data),
      trusted.map((r) => r.error?.message ?? "accepté"),
    );

    const { error: forgeTrusted } = await serviceClient
      .from("contracts")
      .update({ status: "completed" })
      .eq("id", k2.contractId)
      .select("id");
    const { error: halfTrusted } = await serviceClient
      .from("contracts")
      .update({ candidate_signed_at: new Date().toISOString() })
      .eq("id", k2.contractId)
      .select("id");
    report(
      "R6 clé service : statut sans signatures ou signature incomplète refusés",
      !!forgeTrusted &&
        !!halfTrusted &&
        (await row(k2.contractId)).status === "pending",
      [forgeTrusted?.message, halfTrusted?.message],
    );

    // ── D. Concurrence ───────────────────────────────────────────
    const h2 = (await row(k2.contractId)).terms_hash;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        sign(C2, k2.contractId, { terms_hash: h2, consent: true }),
      ),
    );
    const r3 = await row(k2.contractId);
    const firsts = burst.filter(
      (b) =>
        (b.body.signature as Signature | undefined)?.already_signed === false,
    );
    const stamps = new Set(
      burst.map(
        (b) => (b.body.signature as Signature | undefined)?.candidate_signed_at,
      ),
    );
    report(
      "D1 cinq soumissions simultanées : une seule écriture, même horodatage partout, une notification",
      burst.every((b) => b.status === 200) &&
        firsts.length === 1 &&
        stamps.size === 1 &&
        stamps.has(r3.candidate_signed_at!) &&
        r3.status === "candidate_signed" &&
        (await notificationsFor(k2.contractId)).length === 1,
      { statuses: burst.map((b) => b.status), firsts: firsts.length },
    );

    const h3 = (await row(k3.contractId)).terms_hash!;
    const [dC, dA] = await Promise.all([
      C3.client.rpc("sign_contract", {
        p_contract_id: k3.contractId,
        p_terms_hash: h3,
      }),
      A.client.rpc("sign_contract", {
        p_contract_id: k3.contractId,
        p_terms_hash: h3,
      }),
    ]);
    const r4 = await row(k3.contractId);
    const statuses = [dC.data?.[0]?.status, dA.data?.[0]?.status].sort();
    report(
      "D2 deux signatures simultanées des deux parties (RPC directe) : completed, les deux conservées, IP absente",
      !dC.error &&
        !dA.error &&
        r4.status === "completed" &&
        r4.candidate_signed_by === idC3 &&
        r4.company_signed_by === idA &&
        r4.candidate_ip === null &&
        r4.company_ip === null &&
        statuses.includes("completed") &&
        (statuses.includes("candidate_signed") ||
          statuses.includes("company_signed")) &&
        (await notificationsFor(k3.contractId)).length === 2,
      {
        statuses,
        final: r4.status,
        errors: [dC.error?.message, dA.error?.message],
      },
    );

    // ── I. Provenance de l'IP ────────────────────────────────────
    const k5 = await contractFor(C1, job5);
    const h5 = (await row(k5.contractId)).terms_hash!;
    const forged = await sign(
      C1,
      k5.contractId,
      {
        terms_hash: h5,
        consent: true,
        ip: "203.0.113.9",
        client_ip: "203.0.113.9",
        user_id: idA,
      },
      {
        "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "203.0.113.9",
        "x-vercel-forwarded-for": "203.0.113.9",
      },
    );
    const r5 = await row(k5.contractId);
    report(
      "I1 route avec en-têtes IP forgés (hors Vercel) et champs ip/user_id dans le corps : signature du candidat de la session, IP absente",
      forged.status === 200 &&
        (forged.body.signature as Signature | undefined)?.signed_party ===
          "candidate" &&
        r5.candidate_signed_by === idC1 &&
        r5.candidate_ip === null &&
        r5.company_signed_at === null,
      { status: forged.status, ip: r5.candidate_ip },
    );

    const { error: ipParamErr } = await A.client.rpc("sign_contract", {
      p_contract_id: k5.contractId,
      p_terms_hash: h5,
      p_client_ip: "203.0.113.9",
    } as never);
    const { error: obsA } = await A.client.rpc("sign_contract_observed", {
      p_user_id: idA,
      p_contract_id: k5.contractId,
      p_terms_hash: h5,
      p_observed_ip: "203.0.113.9",
    });
    const { error: obsAnon } = await anon.rpc("sign_contract_observed", {
      p_user_id: idA,
      p_contract_id: k5.contractId,
      p_terms_hash: h5,
      p_observed_ip: "203.0.113.9",
    });
    const { error: coreErr } = await A.client.rpc(
      "contract_sign_core" as never,
      {
        p_uid: idA,
        p_contract_id: k5.contractId,
        p_terms_hash: h5,
        p_observed_ip: "203.0.113.9",
      } as never,
    );
    const r5b = await row(k5.contractId);
    report(
      "I2 RPC en session : paramètre IP inexistant, canal observé et noyau refusés, rien n'est écrit",
      !!ipParamErr &&
        !!obsA &&
        !!obsAnon &&
        !!coreErr &&
        r5b.company_signed_at === null &&
        r5b.updated_at === r5.updated_at,
      [ipParamErr?.code, obsA?.code, obsAnon?.code, coreErr?.code],
    );

    const { data: directA, error: directAErr } = await A.client.rpc(
      "sign_contract",
      { p_contract_id: k5.contractId, p_terms_hash: h5 },
    );
    const r5c = await row(k5.contractId);
    report(
      "I3 signature directe en session : identité de la session, IP absente",
      !directAErr &&
        directA?.[0]?.status === "completed" &&
        r5c.company_signed_by === idA &&
        r5c.company_ip === null,
      directAErr?.message,
    );

    // Canal de la route (clé service) : seul à enregistrer une IP observée.
    const k6 = await contractFor(C2, job6);
    const h6 = (await row(k6.contractId)).terms_hash!;
    const { error: obsThird } = await serviceClient.rpc(
      "sign_contract_observed",
      {
        p_user_id: idB,
        p_contract_id: k6.contractId,
        p_terms_hash: h6,
        p_observed_ip: "198.51.100.4",
      },
    );
    const { error: obsCand } = await serviceClient.rpc(
      "sign_contract_observed",
      {
        p_user_id: idC2,
        p_contract_id: k6.contractId,
        p_terms_hash: h6,
        p_observed_ip: "198.51.100.4",
      },
    );
    const { error: obsComp } = await serviceClient.rpc(
      "sign_contract_observed",
      {
        p_user_id: idA,
        p_contract_id: k6.contractId,
        p_terms_hash: h6,
        p_observed_ip: "pas-une-ip",
      },
    );
    const r6 = await row(k6.contractId);
    report(
      "I4 canal de la route : utilisateur non partie refusé, IP valide enregistrée, valeur invalide ignorée",
      obsThird?.message === "contract_not_found" &&
        !obsCand &&
        !obsComp &&
        r6.candidate_signed_by === idC2 &&
        r6.candidate_ip === "198.51.100.4" &&
        r6.company_signed_by === idA &&
        r6.company_ip === null &&
        r6.status === "completed",
      {
        third: obsThird?.message,
        errors: [obsCand?.message, obsComp?.message],
      },
    );

    // ── CL. Texte accepté (clauses figées) ───────────────────────
    const { data: v1Row } = await serviceClient
      .from("contract_clause_versions")
      .select("id, body")
      .eq("id", CURRENT_SIMPLE)
      .single();
    const kc = await contractFor(C3, job7);
    const gc1 = await view(C3, kc.contractId);
    const vc1 = gc1.body.contract as ContractView | undefined;
    const clauses1 = (vc1?.terms as Record<string, unknown> | undefined)
      ?.clauses as Record<string, unknown> | undefined;
    const body1 = (v1Row?.body ?? {}) as Record<string, unknown>;
    report(
      "CL1 nouveau contrat : clauses FR/EN et phrase de consentement de la version courante figées dans le contrat",
      clauses1?.version === CURRENT_SIMPLE &&
        JSON.stringify(clauses1.fr) === JSON.stringify(body1.fr) &&
        JSON.stringify(clauses1.en) === JSON.stringify(body1.en) &&
        typeof (clauses1.fr as Record<string, unknown>)?.consent === "string" &&
        typeof (clauses1.en as Record<string, unknown>)?.consent === "string",
      clauses1?.version,
    );

    const hc = vc1!.terms_hash;
    const sc1 = await sign(C3, kc.contractId, {
      terms_hash: hc,
      consent: true,
    });
    const rc1 = await row(kc.contractId);
    report(
      `CL2 le candidat signe la version ${CURRENT_SIMPLE}`,
      sc1.status === 200 &&
        rc1.status === "candidate_signed" &&
        rc1.candidate_terms_hash === hc,
      sc1.status,
    );

    // Les clauses courantes de l'application évoluent (nouvelle version).
    const evolved = JSON.parse(JSON.stringify(body1)) as {
      fr: { [key: string]: Json };
      en: { [key: string]: Json };
    };
    evolved.fr.intro = "Texte modifié après la signature du candidat (preuve).";
    evolved.en.intro = "Text changed after the candidate signed (proof).";
    const { error: insVersionErr } = await serviceClient
      .from("contract_clause_versions")
      .insert({
        id: PROOF_VERSION,
        contract_template: "simple",
        body: evolved,
      });
    report(
      "CL3 nouvelle version des clauses publiée",
      !insVersionErr,
      insVersionErr?.message,
    );

    const gc2 = await view(A, kc.contractId);
    const vc2 = gc2.body.contract as ContractView | undefined;
    const clauses2 = (vc2?.terms as Record<string, unknown> | undefined)
      ?.clauses as Record<string, unknown> | undefined;
    report(
      `CL4 l'entreprise relit la version signée par le candidat (${CURRENT_SIMPLE}), même empreinte`,
      clauses2?.version === CURRENT_SIMPLE &&
        JSON.stringify(clauses2.fr) === JSON.stringify(body1.fr) &&
        vc2?.terms_hash === hc &&
        vc2.can_sign === true,
      clauses2?.version,
    );

    const kn = await contractFor(C4, job8);
    const gn = await view(C4, kn.contractId);
    const vn = gn.body.contract as ContractView | undefined;
    const clausesN = (vn?.terms as Record<string, unknown> | undefined)
      ?.clauses as Record<string, unknown> | undefined;
    report(
      "CL5 un contrat créé ensuite reçoit la nouvelle version, empreinte différente",
      clausesN?.version === PROOF_VERSION &&
        (clausesN.fr as Record<string, unknown>)?.intro === evolved.fr.intro &&
        !!vn &&
        vn.terms_hash !== hc,
      clausesN?.version,
    );

    const [staleA, staleC] = await Promise.all([
      sign(A, kc.contractId, { terms_hash: vn!.terms_hash, consent: true }),
      sign(C4, kn.contractId, { terms_hash: hc, consent: true }),
    ]);
    report(
      "CL6 empreinte d'une autre version refusée (409 terms_mismatch), rien n'est écrit",
      staleA.status === 409 &&
        staleA.body.code === "terms_mismatch" &&
        staleC.status === 409 &&
        staleC.body.code === "terms_mismatch" &&
        (await row(kc.contractId)).company_signed_at === null &&
        (await row(kn.contractId)).candidate_signed_at === null,
      [staleA.body.code, staleC.body.code],
    );

    const replay = await sign(C3, kc.contractId, {
      terms_hash: hc,
      consent: true,
    });
    report(
      "CL7 relance du candidat après l'évolution : signature d'origine, horodatage inchangé",
      (replay.body.signature as Signature | undefined)?.already_signed ===
        true &&
        (replay.body.signature as Signature | undefined)
          ?.candidate_signed_at === rc1.candidate_signed_at &&
        (await row(kc.contractId)).updated_at === rc1.updated_at,
    );

    const sc2 = await sign(A, kc.contractId, {
      terms_hash: vc2?.terms_hash,
      consent: true,
    });
    const rc2 = await row(kc.contractId);
    const rcClauses = (rc2.contract_data as Record<string, unknown>)
      ?.clauses as Record<string, unknown> | undefined;
    report(
      `CL8 l'entreprise signe la version du candidat : completed, mêmes empreintes, clauses ${CURRENT_SIMPLE}`,
      sc2.status === 200 &&
        rc2.status === "completed" &&
        rc2.company_terms_hash === hc &&
        rc2.candidate_terms_hash === hc &&
        rcClauses?.version === CURRENT_SIMPLE,
      rc2.status,
    );

    const { error: updVersionErr } = await serviceClient
      .from("contract_clause_versions")
      .update({ body: evolved })
      .eq("id", CURRENT_SIMPLE)
      .select("id");
    const { error: delV1Err } = await serviceClient
      .from("contract_clause_versions")
      .delete()
      .eq("id", CURRENT_SIMPLE)
      .select("id");
    const { error: delProofErr } = await serviceClient
      .from("contract_clause_versions")
      .delete()
      .eq("id", PROOF_VERSION)
      .select("id");
    const { data: sessionVersions, error: sessionVersionsErr } = await A.client
      .from("contract_clause_versions" as never)
      .select("id");
    report(
      "CL9 versions immuables (même en clé service), non supprimables tant qu'un contrat les cite, illisibles en session",
      !!updVersionErr &&
        !!delV1Err &&
        !!delProofErr &&
        (!!sessionVersionsErr ||
          ((sessionVersions as unknown[] | null) ?? []).length === 0),
      [updVersionErr?.message, delV1Err?.message, delProofErr?.message],
    );

    // ── H. Contrat ancien (signature sans empreinte) ─────────────
    // Simulation d'une ligne écrite avant ce lot : trigger désactivé le
    // temps d'une écriture, sur la pile dédiée uniquement.
    legacyTriggerOff = true;
    // La CLI n'exécute qu'une instruction par appel.
    execSql(
      "alter table public.contracts disable trigger trg_protect_contract_writes",
    );
    execSql(
      `update public.contracts set candidate_signed_at = '2026-01-01T10:00:00Z', status = 'completed' where id = '${k4.contractId}'`,
    );
    execSql(
      "alter table public.contracts enable trigger trg_protect_contract_writes",
    );
    legacyTriggerOff = false;
    const legacyBefore = await row(k4.contractId);
    const gL = await view(A, k4.contractId);
    const vL = gL.body.contract as ContractView | undefined;
    const sL = await sign(A, k4.contractId, {
      terms_hash: legacyBefore.terms_hash,
      consent: true,
    });
    const sLc = await sign(C4, k4.contractId, {
      terms_hash: legacyBefore.terms_hash,
      consent: true,
    });
    const legacyAfter = await row(k4.contractId);
    report(
      "H1 contrat ancien incohérent : signalé, seconde signature refusée (409), rien n'est déduit",
      vL?.needs_review === true &&
        vL.can_sign === false &&
        sL.status === 409 &&
        sL.body.code === "contract_needs_review" &&
        (sLc.body.signature as Signature | undefined)?.already_signed ===
          true &&
        legacyAfter.company_signed_at === null &&
        legacyAfter.candidate_terms_hash === null &&
        legacyAfter.updated_at === legacyBefore.updated_at,
      { review: vL?.needs_review, sign: sL.status, code: sL.body.code },
    );

    const { data: trig } = await serviceClient
      .from("contracts")
      .update({ contract_data: { job_title: "après réactivation" } })
      .eq("id", k4.contractId)
      .select("id");
    report(
      "H2 protection rétablie après la simulation",
      (trig ?? []).length === 0,
    );

    // ── H3. Contrat signé avant que les clauses ne soient figées ──
    // kn : clauses retirées, empreinte recalculée, signature du candidat
    // portant cette empreinte (état d'un contrat signé avant ce lot).
    legacyTriggerOff = true;
    execSql(
      "alter table public.contracts disable trigger trg_protect_contract_writes",
    );
    execSql(
      `update public.contracts c set contract_data = c.contract_data - 'clauses' where id = '${kn.contractId}'`,
    );
    execSql(
      `update public.contracts c set terms_hash = public.contract_terms_hash(c) where id = '${kn.contractId}'`,
    );
    execSql(
      `update public.contracts c set candidate_signed_at = '2026-01-02T10:00:00Z', candidate_signed_by = '${candidateUsers[3]}', candidate_terms_hash = c.terms_hash, status = 'candidate_signed' where id = '${kn.contractId}'`,
    );
    execSql(
      "alter table public.contracts enable trigger trg_protect_contract_writes",
    );
    legacyTriggerOff = false;
    const oldBefore = await row(kn.contractId);
    const gO = await view(A, kn.contractId);
    const vO = gO.body.contract as ContractView | undefined;
    const sO = await sign(A, kn.contractId, {
      terms_hash: oldBefore.terms_hash,
      consent: true,
    });
    const sOc = await sign(C4, kn.contractId, {
      terms_hash: oldBefore.terms_hash,
      consent: true,
    });
    const oldAfter = await row(kn.contractId);
    report(
      "H3 contrat signé sans clauses figées : preuve conservée, aucun texte attribué, signalé, seconde signature refusée",
      vO?.needs_review === true &&
        vO.can_sign === false &&
        (vO.terms as Record<string, unknown>)?.clauses === undefined &&
        sO.status === 409 &&
        sO.body.code === "contract_needs_review" &&
        (sOc.body.signature as Signature | undefined)?.already_signed ===
          true &&
        oldAfter.candidate_signed_at === oldBefore.candidate_signed_at &&
        oldAfter.candidate_terms_hash === oldBefore.candidate_terms_hash &&
        oldAfter.company_signed_at === null &&
        (oldAfter.contract_data as Record<string, unknown>)?.clauses ===
          undefined &&
        oldAfter.updated_at === oldBefore.updated_at,
      { review: vO?.needs_review, sign: sO.status, code: sO.body.code },
    );

    // ── CL10. Contrat formalisé : clauses formal courantes, jamais simple ──
    const kf = await contractFor(C1, job9);
    const { data: formalRow } = await serviceClient
      .from("contract_clause_versions")
      .select("body")
      .eq("id", CURRENT_FORMAL)
      .single();
    const formalBody = (formalRow?.body ?? {}) as Record<string, unknown>;
    const gf = await view(C1, kf.contractId);
    const vf = gf.body.contract as ContractView | undefined;
    const clausesF = (vf?.terms as Record<string, unknown> | undefined)
      ?.clauses as Record<string, unknown> | undefined;
    const rf = await row(kf.contractId);
    const sf = await sign(C1, kf.contractId, {
      terms_hash: vf?.terms_hash,
      consent: true,
    });
    report(
      `CL10 contrat formalisé (3 jours) : type formal, clauses ${CURRENT_FORMAL} (texte FR/EN renvoyé par get_contract), empreinte cohérente, signable`,
      vf?.contract_template === "formal" &&
        clausesF?.version === CURRENT_FORMAL &&
        JSON.stringify(clausesF.fr) === JSON.stringify(formalBody.fr) &&
        JSON.stringify(clausesF.en) === JSON.stringify(formalBody.en) &&
        vf.terms_hash === rf.terms_hash &&
        vf.needs_review === false &&
        sf.status === 200 &&
        (await row(kf.contractId)).candidate_terms_hash === rf.terms_hash,
      { template: vf?.contract_template, version: clausesF?.version },
    );

    // ── H4. Type ancien non reconnu : signalé, aucune clause par défaut ──
    const ka = await contractFor(C2, job10);
    legacyTriggerOff = true;
    execSql(
      "alter table public.contracts disable trigger trg_protect_contract_writes",
    );
    execSql(
      `update public.contracts c set contract_template = 'standard', contract_data = c.contract_data - 'clauses' where id = '${ka.contractId}'`,
    );
    execSql(
      `update public.contracts c set terms_hash = public.contract_terms_hash(c) where id = '${ka.contractId}'`,
    );
    execSql(
      "alter table public.contracts enable trigger trg_protect_contract_writes",
    );
    legacyTriggerOff = false;
    const ambBefore = await row(ka.contractId);
    const gAmb = await view(C2, ka.contractId);
    const vAmb = gAmb.body.contract as ContractView | undefined;
    const sAmb = await sign(C2, ka.contractId, {
      terms_hash: ambBefore.terms_hash,
      consent: true,
    });
    const ambAfter = await row(ka.contractId);
    report(
      "H4 type ancien non reconnu ('standard') sans clauses : signalé, aucune clause par défaut, signature refusée",
      vAmb?.contract_template === "standard" &&
        vAmb.needs_review === true &&
        vAmb.can_sign === false &&
        (vAmb.terms as Record<string, unknown>)?.clauses === undefined &&
        sAmb.status === 409 &&
        sAmb.body.code === "contract_needs_review" &&
        ambAfter.candidate_signed_at === null &&
        (ambAfter.contract_data as Record<string, unknown>)?.clauses ===
          undefined,
      { review: vAmb?.needs_review, sign: sAmb.status, code: sAmb.body.code },
    );
  } finally {
    if (legacyTriggerOff) {
      try {
        execSql(
          "alter table public.contracts enable trigger trg_protect_contract_writes",
        );
      } catch (e) {
        console.error("Réactivation du trigger :", (e as Error).message);
      }
    }
    await cleanAccounts(ids);
    await cleanProofVersions();
  }

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
