/**
 * Preuve E2E lot 5 (F-14) — onboarding entreprise.
 *
 * Méthode :
 *   1. Seeds en service role : entreprises A et B (comme `finalizeSignup` :
 *      `users` + `company_profiles` avec NIU, non vérifiées), un candidat C,
 *      et une entreprise D sans `company_profiles`.
 *   2. Sessions RÉELLES : signInWithPassword via @supabase/ssr, cookies
 *      envoyés à `PUT /api/company/onboarding` de l'application locale.
 *   3. Assertions (état relu en service role) :
 *      A. Enregistrement valide + RCCM PDF → colonnes réelles écrites,
 *         onboarding terminé, fichier dans le bucket privé sous <uid>/.
 *      B. Aucune auto-validation : `users.is_verified`, `verification_status`,
 *         NIU et `niu_verified` inchangés.
 *      C. Reprise sans fichier : seule la valeur modifiée change, document
 *         conservé. Nouveau fichier : chemin remplacé, ancien objet supprimé.
 *      D. Valeurs invalides (site `javascript:`, ville hors liste, faux PDF)
 *         → 400 avec code, aucune écriture.
 *      E. Isolation : B ne peut ni modifier le profil de A, ni lire ou
 *         écrire dans son dossier de stockage ; son PUT ne touche que B.
 *      F. Candidat → 403 ; non connecté → 401 ; entreprise sans profil →
 *         404, sans fichier orphelin.
 *   4. Nettoyage : objets de stockage, profils, comptes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L5-company-31!";
const PROOF_USER_METADATA = { proofCompanyOnboarding: true };
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
      .filter((u) => u.user_metadata?.proofCompanyOnboarding === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes vers l'application ─────────────────────────────────
const VALID_FIELDS = {
  company_name: "Restaurant Preuve SARL",
  sector: "restaurant",
  company_size: "pme",
  website: "https://preuve.example.cm",
  description: "Restauration rapide à Akwa.",
  rccm: "RC/DLA/2026/B/0001",
  city: "Douala",
  quartier: "Akwa",
  address: "Rue Joss, immeuble 12",
};

function pdfFile(name: string): File {
  const bytes = new TextEncoder().encode("%PDF-1.4\n%preuve\n%%EOF\n");
  return new File([bytes], name, { type: "application/pdf" });
}

async function putOnboarding(
  cookie: string | null,
  fields: Record<string, string>,
  file?: File,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("rccm_document", file);
  const res = await fetch(`${APP_URL}/api/company/onboarding`, {
    method: "PUT",
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function readProfile(userId: string) {
  const { data, error } = await serviceClient
    .from("company_profiles")
    .select(
      `company_name, sector, company_size, website, description, rccm, city,
       quartier, address, documents_url, onboarding_status, niu,
       niu_verified, verification_status`,
    )
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`lecture profil : ${error?.message}`);
  return data;
}

async function objectExists(path: string): Promise<boolean> {
  const [folder, name] = path.split("/");
  const { data } = await serviceClient.storage
    .from(BUCKET)
    .list(folder, { search: name });
  return (data ?? []).some((o) => o.name === name);
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();

  const suffix = Date.now();
  const emails = {
    a: `l5-company-a+${suffix}@proof.easyjob.cm`,
    b: `l5-company-b+${suffix}@proof.easyjob.cm`,
    c: `l5-candidate-c+${suffix}@proof.easyjob.cm`,
    d: `l5-company-d+${suffix}@proof.easyjob.cm`,
  };
  const ids: string[] = [];

  try {
    const idA = await createAccount(emails.a, "company", "M000000000000A");
    ids.push(idA);
    const idB = await createAccount(emails.b, "company", "M000000000000B");
    ids.push(idB);
    const idC = await createAccount(emails.c, "candidate", null);
    ids.push(idC);
    const idD = await createAccount(emails.d, "company", null);
    ids.push(idD);

    const sessionA = await realSession(emails.a);
    const sessionB = await realSession(emails.b);
    const sessionC = await realSession(emails.c);
    const sessionD = await realSession(emails.d);

    // ── A. Enregistrement valide ─────────────────────────────────
    const first = await putOnboarding(
      sessionA.cookie,
      VALID_FIELDS,
      pdfFile("rccm.pdf"),
    );
    const savedA = await readProfile(idA);
    const firstPath = savedA.documents_url?.[0] ?? "";
    report(
      "A1 : PUT valide (session A) → 200",
      first.status === 200 && first.body.ok === true,
      first,
    );
    report(
      "A2 : colonnes réelles écrites et onboarding terminé",
      savedA.company_name === VALID_FIELDS.company_name &&
        savedA.sector === "restaurant" &&
        savedA.company_size === "pme" &&
        savedA.website === VALID_FIELDS.website &&
        savedA.rccm === VALID_FIELDS.rccm &&
        savedA.city === "Douala" &&
        savedA.quartier === "Akwa" &&
        savedA.address === VALID_FIELDS.address &&
        savedA.onboarding_status === "completed",
      savedA,
    );
    report(
      "A3 : RCCM dans le bucket privé, sous le dossier de A",
      firstPath.startsWith(`${idA}/rccm-`) &&
        firstPath.endsWith(".pdf") &&
        (await objectExists(firstPath)),
      { firstPath },
    );

    // ── B. Aucune auto-validation ────────────────────────────────
    const { data: userA } = await serviceClient
      .from("users")
      .select("is_verified")
      .eq("id", idA)
      .single();
    report(
      "B1 : users.is_verified reste false",
      userA?.is_verified === false,
      userA,
    );
    report(
      "B2 : vérification, NIU et niu_verified inchangés",
      savedA.verification_status === "pending" &&
        savedA.niu === "M000000000000A" &&
        savedA.niu_verified === false,
      {
        verification_status: savedA.verification_status,
        niu: savedA.niu,
        niu_verified: savedA.niu_verified,
      },
    );

    // ── C. Reprise ────────────────────────────────────────────────
    const resume = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      address: "Boulevard de la Liberté",
    });
    const resumed = await readProfile(idA);
    report(
      "C1 : reprise sans fichier → seule l'adresse change, document conservé",
      resume.status === 200 &&
        resumed.address === "Boulevard de la Liberté" &&
        resumed.rccm === VALID_FIELDS.rccm &&
        resumed.description === VALID_FIELDS.description &&
        resumed.documents_url?.[0] === firstPath,
      { status: resume.status, documents_url: resumed.documents_url },
    );
    const cleared = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      address: "Boulevard de la Liberté",
      description: "",
    });
    const afterClear = await readProfile(idA);
    report(
      'C2 : champ facultatif vidé volontairement → null (jamais "")',
      cleared.status === 200 && afterClear.description === null,
      { description: afterClear.description },
    );
    const replace = await putOnboarding(
      sessionA.cookie,
      { ...VALID_FIELDS, address: "Boulevard de la Liberté" },
      pdfFile("rccm-v2.pdf"),
    );
    const replaced = await readProfile(idA);
    const secondPath = replaced.documents_url?.[0] ?? "";
    report(
      "C3 : nouveau fichier → chemin remplacé, ancien objet supprimé",
      replace.status === 200 &&
        secondPath !== firstPath &&
        (await objectExists(secondPath)) &&
        !(await objectExists(firstPath)),
      { firstPath, secondPath },
    );

    // ── D. Valeurs invalides ──────────────────────────────────────
    const before = await readProfile(idA);
    const badSite = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      website: "javascript:alert(1)",
    });
    const badCity = await putOnboarding(sessionA.cookie, {
      ...VALID_FIELDS,
      city: "Paris",
    });
    const fakePdf = await putOnboarding(
      sessionA.cookie,
      VALID_FIELDS,
      new File([new TextEncoder().encode("<html>")], "x.pdf", {
        type: "application/pdf",
      }),
    );
    const after = await readProfile(idA);
    const codes = (r: { body: Record<string, unknown> }) =>
      (r.body.issues as { code: string }[] | undefined)?.map((i) => i.code);
    report(
      "D1 : site javascript: → 400 websiteInvalid",
      badSite.status === 400 && !!codes(badSite)?.includes("websiteInvalid"),
      badSite,
    );
    report(
      "D2 : ville hors liste → 400 cityRequired",
      badCity.status === 400 && !!codes(badCity)?.includes("cityRequired"),
      badCity,
    );
    report(
      "D3 : faux PDF (octets HTML) → 400 file_type",
      fakePdf.status === 400 && fakePdf.body.error === "file_type",
      fakePdf,
    );
    report(
      "D4 : aucune écriture après les refus",
      JSON.stringify(before) === JSON.stringify(after),
    );

    // ── E. Isolation entre entreprises ───────────────────────────
    const { data: directRows } = await sessionB.client
      .from("company_profiles")
      .update({ company_name: "Détournée par B" })
      .eq("user_id", idA)
      .select("id");
    const aAfterB = await readProfile(idA);
    report(
      "E1 : B ne modifie pas le profil de A (0 ligne, valeur intacte)",
      (directRows ?? []).length === 0 &&
        aAfterB.company_name === VALID_FIELDS.company_name,
      { rows: directRows?.length, company_name: aAfterB.company_name },
    );
    const { error: crossUpload } = await sessionB.client.storage
      .from(BUCKET)
      .upload(`${idA}/intrusion.pdf`, pdfFile("intrusion.pdf"), {
        contentType: "application/pdf",
      });
    report(
      "E2 : B ne peut pas déposer dans le dossier de A",
      !!crossUpload && !(await objectExists(`${idA}/intrusion.pdf`)),
      { error: crossUpload?.message },
    );
    const { data: crossRead } = await sessionB.client.storage
      .from(BUCKET)
      .download(secondPath);
    report("E3 : B ne peut pas lire le RCCM de A", !crossRead);
    const putB = await putOnboarding(sessionB.cookie, {
      ...VALID_FIELDS,
      company_name: "Logistique B",
      sector: "logistics",
    });
    const savedB = await readProfile(idB);
    const aAfterPutB = await readProfile(idA);
    report(
      "E4 : le PUT de B n'écrit que le profil de B",
      putB.status === 200 &&
        savedB.company_name === "Logistique B" &&
        aAfterPutB.company_name === VALID_FIELDS.company_name &&
        aAfterPutB.sector === "restaurant",
      { b: savedB.company_name, a: aAfterPutB.company_name },
    );

    // ── F. Rôles, session, profil absent ─────────────────────────
    const asCandidate = await putOnboarding(sessionC.cookie, VALID_FIELDS);
    report("F1 : candidat → 403", asCandidate.status === 403, asCandidate);
    const anonymous = await putOnboarding(null, VALID_FIELDS);
    report("F2 : non connecté → 401", anonymous.status === 401, anonymous);
    const noProfile = await putOnboarding(
      sessionD.cookie,
      VALID_FIELDS,
      pdfFile("rccm.pdf"),
    );
    const { data: orphan } = await serviceClient.storage.from(BUCKET).list(idD);
    report(
      "F3 : entreprise sans profil → 404 profile_not_found, sans fichier orphelin",
      noProfile.status === 404 &&
        noProfile.body.error === "profile_not_found" &&
        (orphan ?? []).length === 0,
      { status: noProfile.status, body: noProfile.body, orphans: orphan },
    );
  } finally {
    await cleanAccounts(ids);
    console.log("Nettoyage : objets, profils et comptes supprimés.");
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "onboarding entreprise conforme (lot 5)" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
