/**
 * Preuve E2E T4 — page « Mes documents » (SRS §6.14.3).
 *
 * Méthode (même philosophie que les preuves T0-T3.1) :
 *   1. Seeds en service role : 1 candidat A avec 4 justificatifs de 4 états
 *      (pending / verified-en-validité / verified-EXPIRÉ / rejected avec
 *      motif) + 1 compétence liée + la catégorie permis ; un candidat B
 *      vierge (état vide).
 *   2. Sessions RÉELLES : signInWithPassword via @supabase/ssr (la même
 *      fonction que l'app).
 *   3. Assertions :
 *      A. GET /profile/documents (A) → 200 + tous les titres, les 4 statuts
 *         LABELS rendus — dont « expiré » alors que la DB dit `verified`
 *         (détection au vol, sans écriture DB) + motif de refus +
 *         compétences associées + catégorie permis.
 *      B. « Voir » : GET /api/profile/skill-documents/[id]/url (session
 *         réelle) → 200 + URL signée (query string, bucket privé) — pas de
 *         lien public ; aucune URL de fichier storage (signée ou absolue)
 *         dans le HTML (le `storage_path` brut peut figurer dans le payload
 *         RSC — c'est la donnée du candidat lui-même).
 *      C. RLS : tentative DELETE d'un doc `verified` depuis la session
 *         candidat → la ligne RESTE (RLS T0 : pas de DELETE si verified).
 *      D. État vide (B) : 200 + message vide dédié.
 *      E. Non connecté → redirect vers login.
 *   4. Nettoyage complet des lignes de preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;
type LicenseCat =
  | "moto"
  | "voiture"
  | "fourgon"
  | "camion"
  | "bus"
  | "tous_types";

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROOF_PASSWORD = "Proof-T4-77!";
const PROOF_USER_METADATA = { proofT4: true };
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ───────────────────────────
type CookieEntry = { name: string; value: string };

function makeCookieJar(): {
  jar: Map<string, string>;
  getAll(): CookieEntry[];
  setAll(entries: { name: string; value: string; options?: unknown }[]): void;
} {
  const jar = new Map<string, string>();
  return {
    jar,
    getAll() {
      return [...jar.entries()].map(([name, value]) => ({ name, value }));
    },
    setAll(entries: { name: string; value: string; options?: unknown }[]) {
      for (const { name, value } of entries) {
        if (value === "" || value === "0") jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

async function realClientFor(
  email: string,
): Promise<{ client: DB; cookies: CookieEntry[] }> {
  const jar = makeCookieJar();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
    auth: { autoRefreshToken: false },
  }) as DB;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${email}) : ${error?.message}`);
  }
  const {
    data: { user: fromCookie },
  } = await client.auth.getUser();
  if (!fromCookie) throw new Error("session illisible depuis le cookie");
  return { client, cookies: jar.getAll() };
}

function cookieHeader(entries: CookieEntry[]): string {
  return entries.map((c) => `${c.name}=${c.value}`).join("; ");
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
interface ProofUser {
  authUserId: string;
  profileId: string;
  email: string;
}

async function createTestCandidate(email: string): Promise<ProofUser> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role: "candidate", phone_verified: true },
  });
  if (error || !created.user) {
    throw new Error(`user creation failed: ${error?.message}`);
  }
  const authUserId = created.user.id;

  const { error: rowsErr } = await serviceClient.from("users").insert({
    id: authUserId,
    email,
    role: "candidate",
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  const { data: profile, error: profileErr } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: authUserId,
      first_name: "Docs",
      last_name: "T4",
      date_of_birth: "1996-03-03",
      city: "Douala",
      quartier: "Bonanjo",
      cni_verified: "pending",
      momo_verified: false,
      onboarding_step: 4,
      onboarding_status: "completed",
      profile_completion_pct: 60,
      sandbox_level: 0,
    })
    .select("id")
    .single();
  if (profileErr || !profile) {
    throw new Error(`profile insert: ${profileErr?.message}`);
  }
  return { authUserId, profileId: profile.id, email };
}

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x04, 0x01, 0x01, 0x00, 0x05, 0x23, 0x02, 0xd8, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/**
 * Seed d'un document avec UN VRAI fichier dans le Storage, sous le chemin
 * exigé par la RLS bucket (`<auth_uid>/<field>-<uuid>.<ext>` —
 * foldername[1] doit = auth.uid()). Sans cet objet réel, `createSignedUrl`
 * échoue « Object not found » → 500 sur GET /url (comportement attendu).
 */
async function seedDoc(
  authUid: string,
  profileId: string,
  doc: {
    document_type: string;
    title: string;
    status: string;
    expiresAt?: string;
    licenseCategory?: LicenseCat;
    rejectionReason?: string;
  },
): Promise<string> {
  const slug = doc.title.toLowerCase().replace(/\s+/g, "-");
  const objectPath = `${authUid}/proof-${slug}.png`;
  const { error: upErr } = await serviceClient.storage
    .from("candidate-documents")
    .upload(objectPath, pngBytes(), {
      contentType: "image/png",
      upsert: false,
    });
  if (upErr) throw new Error(`storage upload ${objectPath}: ${upErr.message}`);
  const { data, error } = await serviceClient
    .from("candidate_documents")
    .insert({
      candidate_id: profileId,
      document_type: doc.document_type,
      title: doc.title,
      issuing_organization: "Organisme Preuve T4",
      issued_at: "2023-06-01",
      expires_at: doc.expiresAt ?? null,
      status: doc.status,
      rejection_reason: doc.rejectionReason ?? null,
      license_category: doc.licenseCategory ?? null,
      storage_path: objectPath,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seed doc ${doc.title}: ${error?.message}`);
  }
  return data.id;
}

async function cleanCandidate(c: ProofUser): Promise<void> {
  // Fichiers Storage d'abord (RLS bucket — le service role passe).
  const { data: docs } = await serviceClient
    .from("candidate_documents")
    .select("storage_path")
    .eq("candidate_id", c.profileId);
  const paths = (docs ?? [])
    .map((d) => d.storage_path as string | null)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await serviceClient.storage.from("candidate-documents").remove(paths);
  }
  await serviceClient
    .from("candidate_skill_documents")
    .delete()
    .in(
      "candidate_skill_id",
      (
        await serviceClient
          .from("candidate_skills")
          .select("id")
          .eq("candidate_id", c.profileId)
      ).data?.map((s) => s.id as string) ?? [],
    );
  await serviceClient
    .from("candidate_skills")
    .delete()
    .eq("candidate_id", c.profileId);
  await serviceClient
    .from("candidate_documents")
    .delete()
    .eq("candidate_id", c.profileId);
  await serviceClient
    .from("candidate_profiles")
    .delete()
    .eq("user_id", c.authUserId);
  await serviceClient.from("users").delete().eq("id", c.authUserId);
  await serviceClient.auth.admin.deleteUser(c.authUserId).catch(() => {});
  const { data: notifs } = await serviceClient
    .from("notifications")
    .select("id")
    .eq("user_id", c.authUserId);
  if (notifs?.length) {
    await serviceClient
      .from("notifications")
      .delete()
      .in(
        "id",
        notifs.map((n) => n.id),
      );
  }
}

// ─── Scénario ────────────────────────────────────────────────────
async function main() {
  console.log("── Preuve T4 — page « Mes documents » (SRS §6.14.3) ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/profile/documents`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    serverUp = [200, 302, 307, 308, 401, 500].includes(probe.status);
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Le serveur dev n'est pas accessible sur ${APP_URL}. ` +
        "Preuve E2E ignorée (les tests unitaires tests/document-status.test.ts " +
        "couvrent la détection « expiré » au vol).",
    );
    return;
  }

  // Nettoyage des preuves T4 précédentes.
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT4 === true,
  );
  if (marked.length > 0) {
    const ids = marked.map((u) => u.id);
    const { data: profiles } = await serviceClient
      .from("candidate_profiles")
      .select("id")
      .in("user_id", ids);
    const pids = (profiles ?? []).map((p) => p.id as string);
    if (pids.length > 0) {
      const { data: skillIds } = await serviceClient
        .from("candidate_skills")
        .select("id")
        .in("candidate_id", pids);
      if (skillIds?.length) {
        await serviceClient
          .from("candidate_skill_documents")
          .delete()
          .in(
            "candidate_skill_id",
            skillIds.map((s) => s.id as string),
          );
      }
      await serviceClient
        .from("candidate_skills")
        .delete()
        .in("candidate_id", pids);
      await serviceClient
        .from("candidate_documents")
        .delete()
        .in("candidate_id", pids);
    }
    await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
    await serviceClient.from("users").delete().in("id", ids);
    for (const id of ids) {
      await serviceClient.auth.admin.deleteUser(id).catch(() => {});
    }
    const { data: notifs } = await serviceClient
      .from("notifications")
      .select("id")
      .in("user_id", ids);
    if (notifs?.length) {
      await serviceClient
        .from("notifications")
        .delete()
        .in(
          "id",
          notifs.map((n) => n.id),
        );
    }
    console.log(
      `Nettoyage préalable : ${marked.length} compte(s) de preuve supprimés.`,
    );
  }

  const suffix = Date.now();
  const candA = await createTestCandidate(
    `t4-proof-a+${suffix}@proof.easyjob.cm`,
  );
  const candB = await createTestCandidate(
    `t4-proof-b+${suffix}@proof.easyjob.cm`,
  );

  // ── Seeds du candidat A : 4 documents, 4 états distincts ──
  // (_docPending / _docVerifiedExpired : le contenu de la PAGE prouve les états ;
  //  seuls docVerified (C1 + lien skill) et docRejected (B1/B3) servent de cibles
  //  d'actions — les 2 autres gardent le préfixe `_` (rule no-unused-vars).
  const _docPending = await seedDoc(candA.authUserId, candA.profileId, {
    document_type: "cv",
    title: "CV Candidat T4",
    status: "pending",
  });
  const docVerified = await seedDoc(candA.authUserId, candA.profileId, {
    document_type: "diplome",
    title: "Diplome T4",
    status: "verified",
    expiresAt: localDate(120),
  });
  // verified MAIS expiré en DB → l'affichage doit dire « expiré » (au vol).
  const _docVerifiedExpired = await seedDoc(candA.authUserId, candA.profileId, {
    document_type: "permis_conduire",
    title: "Permis T4",
    status: "verified",
    expiresAt: localDate(-5),
    licenseCategory: "moto",
  });
  const docRejected = await seedDoc(candA.authUserId, candA.profileId, {
    document_type: "attestation_travail",
    title: "Attestation T4",
    status: "rejected",
    rejectionReason: "Document illisible ou tronqué",
  });
  // Compétence liée au diplôme (preuve « compétences associées »).
  const { data: skillRow, error: skillErr } = await serviceClient
    .from("candidate_skills")
    .insert({
      candidate_id: candA.profileId,
      skill_name: "Cuisine",
      skill_level: 3,
      verification_status: "verified",
    })
    .select("id")
    .single();
  if (skillErr || !skillRow) {
    throw new Error(`seed skill: ${skillErr?.message}`);
  }
  const { error: linkErr } = await serviceClient
    .from("candidate_skill_documents")
    .insert({
      candidate_skill_id: skillRow.id,
      candidate_document_id: docVerified,
    });
  if (linkErr) throw new Error(`seed link: ${linkErr.message}`);

  const { client: sessionA, cookies: cookiesA } = await realClientFor(
    candA.email,
  );
  const { client: _sessionB, cookies: cookiesB } = await realClientFor(
    candB.email,
  );

  try {
    // ── A. Page complète : statut effectif + expiré AU VOL ──────
    const resA = await fetch(`${APP_URL}/profile/documents`, {
      headers: { Cookie: cookieHeader(cookiesA), Accept: "text/html" },
      cache: "no-store",
    });
    const htmlA = await resA.text();
    report(
      "A1 : GET /profile/documents → 200 + titre « Mes documents »",
      resA.status === 200 && htmlA.includes("Mes documents"),
      { status: resA.status },
    );
    report(
      "A2 : les 4 documents sont listés (CV, diplôme, permis, attestation)",
      ["CV Candidat T4", "Diplome T4", "Permis T4", "Attestation T4"].every(
        (t) => htmlA.includes(t),
      ),
    );
    report(
      "A3 : statut verified-en-validité → « Vérifiée » ET verified-EXPIRÉ → « Justificatif expiré » (au vol, DB=verified)",
      htmlA.includes("Vérifiée") && htmlA.includes("Justificatif expiré"),
    );
    report(
      "A4 : statuts « Vérification en attente » (pending) + « Justificatif rejeté » + motif de refus visible",
      htmlA.includes("Vérification en attente") &&
        htmlA.includes("Justificatif rejeté") &&
        htmlA.includes("Document illisible ou tronqué"),
    );
    report(
      "A5 : compétences associées affichées (Cuisine) + catégorie permis (Moto) + dates/organisme",
      htmlA.includes("Compétences associées") &&
        htmlA.includes("Cuisine") &&
        htmlA.includes("Moto") &&
        htmlA.includes("Organisme Preuve T4"),
    );
    // NB : `storage_path` figure naturellement dans le payload RSC (données du
    // candidat lui-même) — l'exigence est qu'aucune URL de fichier (signée ou
    // pas) n'est rendue : le fichier n'est accessible qu'après l'appel GET /url.
    report(
      "A6 : aucune URL de fichier storage (signée ou absolue) dans le HTML initial (confidentialité §6.14)",
      !/storage\/v1\/object/.test(htmlA),
    );

    // ── B. « Voir » : URL signée de courte durée ─────────────────
    const resUrl = await fetch(
      `${APP_URL}/api/profile/skill-documents/${docRejected}/url`,
      { headers: { Cookie: cookieHeader(cookiesA) }, cache: "no-store" },
    );
    const urlBody = (await resUrl.json()) as { url?: string };
    const signed = typeof urlBody.url === "string" && urlBody.url.length > 40;
    const hasQueryToken =
      signed && /(\?|&)(token|signature|sig)=/.test(urlBody.url ?? "");
    report(
      "B1 : GET /url (session réelle) → 200 + URL signée (query token/signature, bucket privé)",
      resUrl.status === 200 && signed && hasQueryToken,
      {
        status: resUrl.status,
        urlPrefix: urlBody.url?.slice(0, 80),
      },
    );
    report(
      "B2 : la page propose les actions « Voir » et « Télécharger »",
      htmlA.includes("Voir") && htmlA.includes("Télécharger"),
    );
    // URL signée d'un doc AUTRUI (candB) → 404 (isolation par propriétaire).
    const resUrlForeign = await fetch(
      `${APP_URL}/api/profile/skill-documents/${docRejected}/url`,
      { headers: { Cookie: cookieHeader(cookiesB) }, cache: "no-store" },
    );
    report(
      "B3 : URL signée d'un doc d'UNE AUTRE personne → 404 (isolation propriétaire)",
      resUrlForeign.status === 404,
      { status: resUrlForeign.status },
    );

    // ── C. RLS : pas de DELETE côté candidat si `verified` ───────
    await sessionA.from("candidate_documents").delete().eq("id", docVerified);
    const { count: stillThere, error: countErr } = await serviceClient
      .from("candidate_documents")
      .select("id", { count: "exact", head: true })
      .eq("id", docVerified);
    report(
      "C1 : tentative DELETE doc `verified` depuis la session candidat → la ligne RESTE (RLS)",
      !countErr && (stillThere ?? 0) === 1,
      { stillThere },
    );

    // ── D. État vide (candidat B) ─────────────────────────────────
    const resB = await fetch(`${APP_URL}/profile/documents`, {
      headers: { Cookie: cookieHeader(cookiesB), Accept: "text/html" },
      cache: "no-store",
    });
    const htmlB = await resB.text();
    // NB : React SSR échappe l'apostrophe en `&#x27;` — matcher sans « l'instant ».
    report(
      "D : candidat sans document → 200 + état vide dédié",
      resB.status === 200 && htmlB.includes("Aucun document pour"),
      { status: resB.status },
    );

    // ── E. Non connecté → redirect login ─────────────────────────
    const resE = await fetch(`${APP_URL}/profile/documents`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    const eRedirect = resE.status >= 300 && resE.status < 400;
    const eNextRedirect =
      resE.status === 200 && (await resE.text()).includes("NEXT_REDIRECT");
    report(
      "E : non connecté → redirect login (3xx ou boundary NEXT_REDIRECT)",
      eRedirect || eNextRedirect,
      {
        status: resE.status,
        location: resE.headers.get("location"),
      },
    );
  } finally {
    await cleanCandidate(candA);
    await cleanCandidate(candB);
    console.log(
      "Nettoyage : skills, liens, documents, profils, comptes supprimés.",
    );
  }

  console.log(
    `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
      failCount === 0 ? "page « Mes documents » opérationnelle (T4)" : "ÉCHEC"
    }`,
  );
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Preuve E2E échouée :", err);
  process.exit(1);
});
