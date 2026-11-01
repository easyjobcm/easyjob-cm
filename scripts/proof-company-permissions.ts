/**
 * Preuve lot 5b (F-41) — droits d'écriture de `company_profiles`.
 *
 * Méthode :
 *   1. Seeds en service role : entreprises A et B (comme `finalizeSignup` :
 *      `users` + `company_profiles` avec NIU, non vérifiées), entreprise D
 *      sans profil, admins `admin_ops` (R) et `admin_support` (S).
 *   2. Tentatives en sessions RÉELLES (signInWithPassword) : PostgREST direct
 *      avec le JWT de l'entreprise, et routes de l'application avec ses
 *      cookies. La clé service ne sert qu'aux fixtures, aux validations de
 *      confiance et aux relectures.
 *   3. Assertions (état relu en service role, ligne entière comparée) :
 *      A. Auto-validation refusée (verification_status, niu_verified, NIU),
 *         sans écriture partielle ; POST /api/jobs reste refusé.
 *      B. Plan et avantages refusés (plan, palier, échéances, essai,
 *         statistiques, is_active).
 *      C. Création, UPSERT, suppression refusés : pas de recréation possible.
 *      D. Propriétaire, isolation, document hors dossier, anonyme refusés.
 *      E. Fonctions exposées : aucune ne permet le contournement (inspection
 *         du catalogue et appels réels).
 *      F. Parcours légitimes : édition directe d'un champ autorisé,
 *         onboarding complet, reprise, lecture du RCCM par son propriétaire.
 *      G. Administration : validation de confiance (service role) puis
 *         publication acceptée ; admin_ops suspend et réactive (trace
 *         audit_logs) ; admin_support refusé ; aucun admin n'écrit la table
 *         en session.
 *      H. Nouvelle revue : une entreprise vérifiée qui modifie son nom, son
 *         RCCM ou son document repasse en 'pending' et ne publie plus ; les
 *         autres champs n'y touchent pas ; un refus n'est pas levé par
 *         l'entreprise.
 *   4. Nettoyage : objets de stockage, offres, journaux, profils, comptes.
 *
 * Ne couvre pas F-09 : les autres chemins de création et de modération des
 * offres relèvent du lot 6.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type CompanyUpdate = Database["public"]["Tables"]["company_profiles"]["Update"];
type CompanyInsert = Database["public"]["Tables"]["company_profiles"]["Insert"];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L5b-company-01!";
const PROOF_USER_METADATA = { proofCompanyPermissions: true };
const BUCKET = "company-documents";

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };

async function realSession(
  email: string,
): Promise<{ client: DB; cookie: string }> {
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

// ─── SQL local en lecture (inspection du catalogue) ──────────────
function queryRows(sql: string): Record<string, unknown>[] {
  const tmp = path.join(
    os.tmpdir(),
    `proof-company-permissions-${Date.now()}.sql`,
  );
  fs.writeFileSync(tmp, sql, "utf-8");
  // Sans --output-format json, la CLI rend un tableau texte (cas de la CI).
  // Lancée depuis un agent IA, elle encadre le JSON : { boundary, rows }.
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
  const out = r.stdout ?? "";
  const starts = [out.indexOf("["), out.indexOf("{")].filter((i) => i >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = out.lastIndexOf(out[start] === "[" ? "]" : "}");
  if (r.status !== 0 || start < 0 || end < start) {
    throw new Error(`supabase db query : ${(r.stderr || out).slice(0, 300)}`);
  }
  const parsed = JSON.parse(out.slice(start, end + 1)) as
    | Record<string, unknown>[]
    | { rows: Record<string, unknown>[] };
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

// ─── Seed / cleanup ──────────────────────────────────────────────
type Role = Database["public"]["Enums"]["user_role"];

async function createAccount(
  email: string,
  role: Role,
  niu: string | null,
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
  if (niu) {
    const { error: profileErr } = await serviceClient
      .from("company_profiles")
      .insert({
        user_id: id,
        company_name: "Société de preuve",
        niu,
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
    await serviceClient.from("jobs").delete().in("company_id", companyIds);
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
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofCompanyPermissions === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes vers l'application ─────────────────────────────────
const VALID_FIELDS = {
  company_name: "Hôtel Preuve SARL",
  sector: "hotel",
  company_size: "pme",
  website: "https://hotel-preuve.example.cm",
  description: "Hôtel de preuve à Bonanjo.",
  rccm: "RC/DLA/2026/B/0105",
  city: "Douala",
  quartier: "Bonanjo",
  address: "Avenue de Gaulle, immeuble 3",
};

const JOB_BODY = {
  title: "Offre preuve L5b",
  description: "Description de preuve.",
  address: "Avenue de la Liberté",
  city: "Douala",
  start_date: "2099-01-15",
  start_time: "09:00",
  end_time: "17:00",
  hourly_rate: 5000,
};

function pdfFile(name: string): File {
  const bytes = new TextEncoder().encode("%PDF-1.4\n%preuve\n%%EOF\n");
  return new File([bytes], name, { type: "application/pdf" });
}

async function putOnboarding(
  cookie: string,
  fields: Record<string, string>,
  file?: File,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("rccm_document", file);
  const res = await fetch(`${APP_URL}/api/company/onboarding`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function postJson(
  url: string,
  cookie: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${APP_URL}${url}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function readProfile(userId: string) {
  const { data, error } = await serviceClient
    .from("company_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`lecture profil : ${error?.message}`);
  return data;
}

async function countProfiles(userId: string): Promise<number> {
  const { count } = await serviceClient
    .from("company_profiles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

/** Fixe des valeurs par la voie de confiance (validation admin actuelle). */
async function trustedUpdate(userId: string, values: CompanyUpdate) {
  const { error } = await serviceClient
    .from("company_profiles")
    .update(values)
    .eq("user_id", userId);
  if (error) throw new Error(`mise à jour de confiance : ${error.message}`);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();

  const suffix = Date.now();
  const emails = {
    a: `l5b-company-a+${suffix}@proof.easyjob.cm`,
    b: `l5b-company-b+${suffix}@proof.easyjob.cm`,
    d: `l5b-company-d+${suffix}@proof.easyjob.cm`,
    r: `l5b-admin-ops+${suffix}@proof.easyjob.cm`,
    s: `l5b-admin-support+${suffix}@proof.easyjob.cm`,
  };
  const ids: string[] = [];

  try {
    const idA = await createAccount(emails.a, "company", "M00000000005A");
    ids.push(idA);
    const idB = await createAccount(emails.b, "company", "M00000000005B");
    ids.push(idB);
    const idD = await createAccount(emails.d, "company", null);
    ids.push(idD);
    const idR = await createAccount(emails.r, "admin_ops", null);
    ids.push(idR);
    const idS = await createAccount(emails.s, "admin_support", null);
    ids.push(idS);

    const sessionA = await realSession(emails.a);
    const sessionB = await realSession(emails.b);
    const sessionD = await realSession(emails.d);
    const sessionR = await realSession(emails.r);
    const sessionS = await realSession(emails.s);
    const anonClient: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    /** Tentative directe en session : refus 42501 et ligne inchangée. */
    async function expectRefused(
      label: string,
      client: DB,
      targetUserId: string,
      values: CompanyUpdate,
    ) {
      const before = await readProfile(targetUserId);
      const { data, error } = await client
        .from("company_profiles")
        .update(values)
        .eq("user_id", targetUserId)
        .select("id");
      const after = await readProfile(targetUserId);
      report(
        label,
        error?.code === "42501" &&
          (data ?? []).length === 0 &&
          same(before, after),
        {
          code: error?.code,
          rows: data?.length,
          unchanged: same(before, after),
        },
      );
    }

    // ── A. Auto-validation ───────────────────────────────────────
    await expectRefused(
      "A1 : verification_status = verified → 42501, ligne inchangée",
      sessionA.client,
      idA,
      { verification_status: "verified" },
    );
    await expectRefused(
      "A2 : niu_verified = true → 42501, ligne inchangée",
      sessionA.client,
      idA,
      { niu_verified: true },
    );
    await expectRefused(
      "A3 : champ autorisé + verification_status → refus entier, sans écriture partielle",
      sessionA.client,
      idA,
      { description: "Écriture partielle", verification_status: "verified" },
    );
    await expectRefused("A4 : NIU modifié → 42501", sessionA.client, idA, {
      niu: "M99999999999Z",
    });
    await expectRefused(
      "A5 : motif de refus effacé ou écrit → 42501",
      sessionA.client,
      idA,
      { verification_rejection_reason: "auto" },
    );
    const jobAfterSelf = await postJson("/api/jobs", sessionA.cookie, JOB_BODY);
    report(
      "A6 : après les tentatives, POST /api/jobs → 403 « verified »",
      jobAfterSelf.status === 403 &&
        /verified/i.test(String(jobAfterSelf.body.error ?? "")),
      jobAfterSelf,
    );

    // ── B. Plan et avantages ─────────────────────────────────────
    const privileged: [string, CompanyUpdate][] = [
      ["subscription_plan = business", { subscription_plan: "business" }],
      ["subscription_tier = business", { subscription_tier: "business" }],
      [
        "subscription_expires_at prolongé",
        { subscription_expires_at: "2099-12-31T00:00:00Z" },
      ],
      ["trial_ends_at modifié", { trial_ends_at: "2099-12-31T00:00:00Z" }],
      ["trust_score = 9.99", { trust_score: 9.99 }],
      ["average_rating = 5", { average_rating: 5 }],
      [
        "late_cancellation_count = 0 (remise à zéro)",
        { late_cancellation_count: 0 },
      ],
      ["total_missions_posted modifié", { total_missions_posted: 500 }],
      ["is_active modifié", { is_active: false }],
      ["legal_name modifié", { legal_name: "Autre SA" }],
      ["contact_email modifié", { contact_email: "x@example.cm" }],
    ];
    for (const [label, values] of privileged) {
      await expectRefused(`B : ${label} → 42501`, sessionA.client, idA, values);
    }

    // ── C. Création, UPSERT, suppression ─────────────────────────
    const malicious: CompanyInsert = {
      user_id: idD,
      company_name: "Créée par D",
      verification_status: "verified",
      niu_verified: true,
      subscription_plan: "business",
    };
    const { error: insertErr } = await sessionD.client
      .from("company_profiles")
      .insert(malicious);
    report(
      "C1 : INSERT malveillant (vérifié, business) → 42501, aucune ligne",
      insertErr?.code === "42501" && (await countProfiles(idD)) === 0,
      { code: insertErr?.code },
    );
    const { error: plainInsertErr } = await sessionD.client
      .from("company_profiles")
      .insert({ user_id: idD, company_name: "Créée par D" });
    report(
      "C2 : INSERT ordinaire en session → 42501 (création réservée à l'inscription)",
      plainInsertErr?.code === "42501" && (await countProfiles(idD)) === 0,
      { code: plainInsertErr?.code },
    );
    const beforeUpsert = await readProfile(idA);
    const { error: upsertErr } = await sessionA.client
      .from("company_profiles")
      .upsert(
        { ...malicious, user_id: idA, niu: "M00000000005A" },
        { onConflict: "user_id" },
      );
    report(
      "C3 : UPSERT sur sa ligne avec valeurs privilégiées → 42501, ligne inchangée",
      upsertErr?.code === "42501" && same(beforeUpsert, await readProfile(idA)),
      { code: upsertErr?.code },
    );
    const { error: deleteErr } = await sessionA.client
      .from("company_profiles")
      .delete()
      .eq("user_id", idA);
    report(
      "C4 : DELETE de sa ligne → 42501, ligne conservée (pas de recréation possible)",
      deleteErr?.code === "42501" && (await countProfiles(idA)) === 1,
      { code: deleteErr?.code },
    );

    // ── D. Propriétaire, isolation, document, anonyme ────────────
    await expectRefused(
      "D1 : user_id réattribué à B → 42501",
      sessionA.client,
      idA,
      { user_id: idB },
    );
    await expectRefused(
      "D2 : B tente de valider A → 42501",
      sessionB.client,
      idA,
      { verification_status: "verified" },
    );
    const beforeCross = await readProfile(idA);
    const { data: crossRows, error: crossErr } = await sessionB.client
      .from("company_profiles")
      .update({ description: "Détournée par B" })
      .eq("user_id", idA)
      .select("id");
    report(
      "D3 : B modifie un champ autorisé de A → 0 ligne, A inchangée",
      !crossErr &&
        (crossRows ?? []).length === 0 &&
        same(beforeCross, await readProfile(idA)),
      { rows: crossRows?.length, error: crossErr?.code },
    );
    await expectRefused(
      "D4 : documents_url pointant vers le dossier de B → 42501",
      sessionA.client,
      idA,
      { documents_url: [`${idB}/rccm-de-b.pdf`] },
    );
    await expectRefused(
      "D5 : documents_url avec remontée de dossier → 42501",
      sessionA.client,
      idA,
      { documents_url: [`${idA}/../${idB}/rccm.pdf`] },
    );
    await expectRefused("D6 : client anonyme → 42501", anonClient, idA, {
      verification_status: "verified",
    });

    // ── E. Fonctions exposées ────────────────────────────────────
    const [catalog] = queryRows(`
      select
        has_table_privilege('authenticated', 'public.company_profiles', 'INSERT')
          or has_table_privilege('authenticated', 'public.company_profiles', 'DELETE')
          or has_table_privilege('anon', 'public.company_profiles', 'INSERT')
          or has_table_privilege('anon', 'public.company_profiles', 'UPDATE') as table_write,
        (select coalesce(string_agg(c.column_name, ',' order by c.column_name), '')
           from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'company_profiles'
            and has_column_privilege('authenticated', 'public.company_profiles',
                                     c.column_name, 'UPDATE')) as updatable,
        (select coalesce(string_agg(p.proname, ',' order by p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 or has_function_privilege('anon', p.oid, 'EXECUTE'))
            and (p.prosrc ilike '%company_profiles%'
                 or p.prosrc ~* 'execute\\s')) as exposed_writers,
        has_function_privilege('authenticated',
          'public.protect_company_profile_columns()', 'EXECUTE') as trigger_fn_exec,
        (select tgenabled from pg_trigger
          where tgname = 'trg_protect_company_profile_columns') as trigger_enabled
    `);
    report(
      "E1 : ni INSERT ni DELETE en session, UPDATE limité aux 12 colonnes de l'onboarding",
      catalog?.table_write === false &&
        catalog?.updatable ===
          "address,city,company_name,company_size,description,documents_url,onboarding_status,onboarding_step,quartier,rccm,sector,website",
      catalog,
    );
    report(
      "E2 : aucune fonction SECURITY DEFINER exposée n'écrit company_profiles ni n'exécute de SQL dynamique",
      catalog?.exposed_writers === "",
      catalog?.exposed_writers,
    );
    report(
      "E3 : trigger actif, fonction de protection non exécutable",
      catalog?.trigger_enabled === "O" && catalog?.trigger_fn_exec === false,
      catalog,
    );
    const beforeRpc = await readProfile(idA);
    const { error: rpcSuspendErr } = await sessionA.client.rpc(
      "admin_set_user_active",
      { p_user_id: idB, p_active: false },
    );
    const { error: rpcRecomputeErr } = await sessionA.client.rpc(
      "recompute_user_verification",
      { p_user_id: idA },
    );
    const { data: userB } = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", idB)
      .single();
    report(
      "E4 : RPC admin refusée à une entreprise ; aucune RPC ne modifie le profil",
      !!rpcSuspendErr &&
        userB?.is_active === true &&
        same(beforeRpc, await readProfile(idA)),
      {
        suspend: rpcSuspendErr?.message,
        recompute: rpcRecomputeErr?.message ?? "ok",
      },
    );

    // ── F. Parcours légitimes ────────────────────────────────────
    const { data: editRows, error: editErr } = await sessionA.client
      .from("company_profiles")
      .update({ description: "Édition directe autorisée" })
      .eq("user_id", idA)
      .select("id");
    const edited = await readProfile(idA);
    report(
      "F1 : édition directe d'un champ autorisé → 1 ligne, valeur persistée",
      !editErr &&
        (editRows ?? []).length === 1 &&
        edited.description === "Édition directe autorisée",
      { error: editErr?.code },
    );
    const onboarding = await putOnboarding(
      sessionA.cookie,
      VALID_FIELDS,
      pdfFile("rccm.pdf"),
    );
    const onboarded = await readProfile(idA);
    const firstPath = onboarded.documents_url?.[0] ?? "";
    report(
      "F2 : onboarding complet (PUT + RCCM) → 200, champs persistés, toujours en attente",
      onboarding.status === 200 &&
        onboarded.company_name === VALID_FIELDS.company_name &&
        onboarded.rccm === VALID_FIELDS.rccm &&
        onboarded.onboarding_status === "completed" &&
        firstPath.startsWith(`${idA}/rccm-`) &&
        onboarded.verification_status === "pending" &&
        onboarded.niu_verified === false &&
        onboarded.subscription_plan === "free",
      {
        status: onboarding.status,
        verification: onboarded.verification_status,
      },
    );
    const resume = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      quartier: "Akwa",
    });
    const resumed = await readProfile(idA);
    report(
      "F3 : reprise sans fichier → quartier modifié, document conservé",
      resume.status === 200 &&
        resumed.quartier === "Akwa" &&
        resumed.documents_url?.[0] === firstPath,
      { status: resume.status },
    );
    const { data: ownDoc } = await sessionA.client.storage
      .from(BUCKET)
      .download(firstPath);
    const { data: adminDoc } = await sessionR.client.storage
      .from(BUCKET)
      .download(firstPath);
    const { data: otherDoc } = await sessionB.client.storage
      .from(BUCKET)
      .download(firstPath);
    report(
      "F4 : RCCM lisible par son propriétaire et par l'admin, pas par B",
      !!ownDoc && !!adminDoc && !otherDoc,
    );

    // ── G. Administration ────────────────────────────────────────
    await expectRefused(
      "G1 : admin_ops en session ne valide pas directement (voie de confiance uniquement)",
      sessionR.client,
      idA,
      { verification_status: "verified" },
    );
    await trustedUpdate(idA, {
      verification_status: "verified",
      niu_verified: true,
    });
    const verified = await readProfile(idA);
    const jobVerified = await postJson("/api/jobs", sessionA.cookie, JOB_BODY);
    report(
      "G2 : validation de confiance (service role) → vérifiée, POST /api/jobs 201",
      verified.verification_status === "verified" &&
        verified.niu_verified === true &&
        jobVerified.status === 201,
      { status: jobVerified.status },
    );
    const suspendS = await postJson("/api/admin/companies", sessionS.cookie, {
      user_id: idA,
      action: "suspend",
    });
    const { data: afterS } = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", idA)
      .single();
    report(
      "G3 : admin_support → suspension refusée, compte actif",
      suspendS.status === 403 && afterS?.is_active === true,
      { status: suspendS.status },
    );
    const beforeSuspend = await readProfile(idA);
    const suspendR = await postJson("/api/admin/companies", sessionR.cookie, {
      user_id: idA,
      action: "suspend",
    });
    const { data: afterR } = await serviceClient
      .from("users")
      .select("is_active")
      .eq("id", idA)
      .single();
    const { data: auditRows } = await serviceClient
      .from("audit_logs")
      .select("action, actor_id")
      .eq("resource_id", idA)
      .eq("action", "suspend_user");
    report(
      "G4 : admin_ops suspend → 200, is_active = false, trace audit_logs, profil inchangé",
      suspendR.status === 200 &&
        afterR?.is_active === false &&
        (auditRows ?? []).some((r) => r.actor_id === idR) &&
        same(beforeSuspend, await readProfile(idA)),
      { status: suspendR.status, audit: auditRows?.length },
    );
    const activateR = await postJson("/api/admin/companies", sessionR.cookie, {
      user_id: idA,
      action: "activate",
    });
    report(
      "G5 : admin_ops réactive → 200",
      activateR.status === 200,
      activateR,
    );

    // ── H. Nouvelle revue d'une entreprise vérifiée ──────────────
    const unchanged = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      quartier: "Akwa",
      address: "Rue des Cocotiers",
    });
    const afterNeutral = await readProfile(idA);
    report(
      "H1 : vérifiée, adresse modifiée sans toucher nom/RCCM/document → reste vérifiée",
      unchanged.status === 200 &&
        afterNeutral.address === "Rue des Cocotiers" &&
        afterNeutral.verification_status === "verified",
      { verification: afterNeutral.verification_status },
    );
    await trustedUpdate(idA, { verification_rejection_reason: "ancien motif" });
    const renamed = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      company_name: "Hôtel Renommé SARL",
      quartier: "Akwa",
      address: "Rue des Cocotiers",
    });
    const afterRename = await readProfile(idA);
    const jobAfterRename = await postJson(
      "/api/jobs",
      sessionA.cookie,
      JOB_BODY,
    );
    report(
      "H2 : nom modifié → enregistré, repasse en attente, motif effacé, NIU vérifié conservé",
      renamed.status === 200 &&
        afterRename.company_name === "Hôtel Renommé SARL" &&
        afterRename.verification_status === "pending" &&
        afterRename.verification_rejection_reason === null &&
        afterRename.niu_verified === true,
      { verification: afterRename.verification_status },
    );
    report(
      "H3 : après la nouvelle revue, POST /api/jobs → 403",
      jobAfterRename.status === 403,
      { status: jobAfterRename.status },
    );
    await trustedUpdate(idA, { verification_status: "verified" });
    const replaced = await putOnboarding(
      sessionA.cookie,
      {
        ...VALID_FIELDS,
        company_name: "Hôtel Renommé SARL",
        quartier: "Akwa",
        address: "Rue des Cocotiers",
      },
      pdfFile("rccm-v2.pdf"),
    );
    const afterReplace = await readProfile(idA);
    report(
      "H4 : document RCCM remplacé → repasse en attente",
      replaced.status === 200 &&
        afterReplace.documents_url?.[0] !== firstPath &&
        afterReplace.verification_status === "pending",
      { verification: afterReplace.verification_status },
    );
    await trustedUpdate(idA, { verification_status: "verified" });
    const { error: rccmErr } = await sessionA.client
      .from("company_profiles")
      .update({ rccm: "RC/DLA/2026/B/9999" })
      .eq("user_id", idA);
    const afterRccm = await readProfile(idA);
    report(
      "H5 : RCCM modifié en appel direct → repasse en attente",
      !rccmErr &&
        afterRccm.rccm === "RC/DLA/2026/B/9999" &&
        afterRccm.verification_status === "pending",
      { verification: afterRccm.verification_status },
    );
    await trustedUpdate(idA, {
      verification_status: "rejected",
      verification_rejection_reason: "RCCM illisible",
    });
    const { error: rejectedEditErr } = await sessionA.client
      .from("company_profiles")
      .update({ company_name: "Hôtel Corrigé SARL" })
      .eq("user_id", idA);
    const afterRejected = await readProfile(idA);
    report(
      "H6 : entreprise refusée qui se corrige → reste refusée (seul l'admin lève le refus)",
      !rejectedEditErr &&
        afterRejected.company_name === "Hôtel Corrigé SARL" &&
        afterRejected.verification_status === "rejected" &&
        afterRejected.verification_rejection_reason === "RCCM illisible",
      { verification: afterRejected.verification_status },
    );
  } finally {
    await cleanAccounts(ids);
    console.log(
      "Nettoyage : objets, offres, journaux, profils et comptes supprimés.",
    );
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "droits entreprise conformes (lot 5b)" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve lot 5b échouée :", err);
  process.exit(1);
});
