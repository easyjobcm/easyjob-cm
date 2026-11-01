/**
 * Preuve E2E T1 — gate des champs essentiels à la postulation (SRS §6.6).
 *
 * Méthode (même philosophie que la preuve RLS de T0) :
 *   1. Seeder en service role une entreprise, une offre et deux candidats
 *      à forte complétude : A = essentiels complets, B = CNI pending + MoMo
 *      non vérifié + identité partielle (la complétude isole le gate des
 *      essentiels du seuil de 60 %). `users.is_verified` n'est pas posé par
 *      la fixture : il est dérivé de l'état par recompute_user_verification.
 *   2. Se connecter en session RÉELLE : signInWithPassword(email) via
 *      @supabase/ssr createServerClient (la même fonction que l'app).
 *      L'app s'authentifie par e-mail + mot de passe (phone logins désactivés).
 *   3. POST /api/jobs/[id]/apply sur l'application locale (NEXT_APP_URL)
 *      avec le cookie de session. L'app lit la base en RLS, comme en prod.
 *   4. Attendus : A -> 200 (candidature créée) ;
 *                 B -> 403 { code: "profile_not_verified",
 *                            missing: ["identity","cni","momo"] } sans candidature.
 *      Depuis T8.3, le gate porte sur `users.is_verified` (RPC apply_to_job)
 *      et la route y joint la liste des essentiels manquants.
 *   5. Nettoyage complet des lignes de preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type CandidateProfileInsert =
  Database["public"]["Tables"]["candidate_profiles"]["Insert"];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: NEXT_APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-T1-42!";

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Session réelle via @supabase/ssr ───────────────────────────
// Jar de cookies en mémoire : la lib @supabase/ssr y écrit elle-même le
// cookie d'auth (base64url + chunking), on rejoue l'ensemble sur la requête
// réelle — aucune re-codage manuel de la session.
function makeCookieJar(): {
  jar: Map<string, string>;
  getAll(): { name: string; value: string }[];
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

type CookieEntry = { name: string; value: string };

async function getRealSessionCookies(
  email: string,
): Promise<CookieEntry[] | null> {
  const jar = makeCookieJar();
  const appClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: jar.getAll,
      setAll: jar.setAll,
    },
    auth: { autoRefreshToken: false },
  });

  const { data, error } = await appClient.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    console.error(
      `  signInWithPassword(${email}) error:`,
      error?.message ?? "no session",
    );
    return null;
  }
  const {
    data: { user: fromCookie },
  } = await appClient.auth.getUser();
  if (!fromCookie) {
    console.error("  (session non lisible depuis le cookie — diagnostic)");
    return null;
  }
  return [...jar.jar.entries()].map(([name, value]) => ({ name, value }));
}

// ─── Asserts ────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`,
  );
}

// ─── Seed / cleanup ─────────────────────────────────────────────
interface ProofCandidate {
  authUserId: string;
  email: string;
  profileId: string;
}

async function createTestCandidate(
  email: string,
  phone: string,
  withEssentials: boolean,
): Promise<ProofCandidate> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: { proofT1: true },
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
    phone,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`users insert: ${rowsErr.message}`);

  const profileRow: CandidateProfileInsert = withEssentials
    ? {
        user_id: authUserId,
        first_name: "Serge",
        last_name: "Talla",
        date_of_birth: "1996-06-10",
        city: "Douala",
        quartier: "Akwa",
        address: "Rue Mvog",
        latitude: 4.05,
        longitude: 9.77,
        max_travel_distance_km: 10,
        bio: "Candidat de preuve T1 — essentiels complets.",
        profile_photo_url: "photos/proof-ok.jpg",
        cni_front_url: "cni/ok-front.jpg",
        cni_back_url: "cni/ok-back.jpg",
        cni_selfie_url: "cni/ok-selfie.jpg",
        cni_verified: "verified",
        cni_expires_at: "2032-01-01",
        momo_provider: "mtn",
        momo_number: "+237677000001",
        momo_verified: true,
        onboarding_status: "completed",
        onboarding_step: 6,
        profile_completion_pct: 100,
        sandbox_level: 1,
      }
    : {
        // "Complétude" 100 % mais AUCUN essentiel : identité partielle
        // (pas de nom / date de naissance), CNI uploadée mais en attente,
        // Mobile Money non vérifié → le gate doit bloquer malgré le 100 %.
        user_id: authUserId,
        first_name: "Remy",
        last_name: null,
        date_of_birth: null,
        city: "Douala",
        quartier: "Akwa",
        address: "Rue Mvog",
        latitude: 4.05,
        longitude: 9.77,
        max_travel_distance_km: 10,
        bio: "Candidat de preuve T1 — gate essentiels : rien n'est vérifié.",
        profile_photo_url: "photos/proof-missing.jpg",
        cni_front_url: "cni/miss-front.jpg",
        cni_back_url: "cni/miss-back.jpg",
        cni_selfie_url: "cni/miss-selfie.jpg",
        cni_verified: "pending",
        cni_expires_at: null,
        momo_provider: "mtn",
        momo_number: "+237677000002",
        momo_verified: false,
        onboarding_status: "completed",
        onboarding_step: 6,
        profile_completion_pct: 100,
        sandbox_level: 1,
      };
  const { data: profile, error: profileErr } = await serviceClient
    .from("candidate_profiles")
    .insert(profileRow)
    .select("id")
    .single();
  if (profileErr || !profile) {
    throw new Error(`profile insert: ${profileErr?.message}`);
  }

  const { error: skillsErr } = await serviceClient
    .from("candidate_skills")
    .insert([
      { candidate_id: profile.id, skill_name: "Nettoyage", skill_level: 4 },
      { candidate_id: profile.id, skill_name: "Caisse", skill_level: 4 },
    ]);
  if (skillsErr) throw new Error(`skills insert: ${skillsErr.message}`);

  const { error: recomputeErr } = await serviceClient.rpc(
    "recompute_user_verification",
    { p_user_id: authUserId },
  );
  if (recomputeErr) throw new Error(`recompute: ${recomputeErr.message}`);

  return { authUserId, email, profileId: profile.id };
}

async function createTestCompany(
  email: string,
): Promise<{ authUserId: string; companyId: string }> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: { proofT1: true },
    app_metadata: { role: "company", phone_verified: true },
  });
  if (error || !created.user) {
    throw new Error(`company user creation failed: ${error?.message}`);
  }
  const authUserId = created.user.id;
  const { error: rowsErr } = await serviceClient.from("users").insert({
    id: authUserId,
    email,
    role: "company",
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (rowsErr) throw new Error(`company users insert: ${rowsErr.message}`);
  const { data: company, error: companyErr } = await serviceClient
    .from("company_profiles")
    .insert({
      user_id: authUserId,
      company_name: "Entreprise de preuve T1",
      city: "Douala",
      onboarding_status: "completed",
    })
    .select("id")
    .single();
  if (companyErr || !company) {
    throw new Error(`company insert: ${companyErr?.message}`);
  }
  return { authUserId, companyId: company.id };
}

function cookieHeader(entries: CookieEntry[]): string {
  return entries.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function postApply(
  cookies: CookieEntry[],
  jobId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${NEXT_APP_URL}/api/jobs/${jobId}/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookies),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// Nettoie les éventuels restes d'exécutions précédentes (comptes marqués
// proofT1) — idempotence si le script a échoué avant son propre cleanup.
async function cleanPreviousProofs() {
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofT1 === true,
  );
  if (marked.length === 0) return;
  const ids = marked.map((u) => u.id);
  const { data: profiles } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const profileIds = (profiles ?? []).map((p) => p.id);
  if (profileIds.length > 0) {
    const { data: apps } = await serviceClient
      .from("job_applications")
      .select("job_id")
      .in("candidate_id", profileIds);
    const jobIds = [...new Set((apps ?? []).map((a) => a.job_id))];
    if (jobIds.length > 0)
      await serviceClient
        .from("job_applications")
        .delete()
        .in("job_id", jobIds);
    await serviceClient
      .from("candidate_skills")
      .delete()
      .in("candidate_id", profileIds);
    await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  }
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  if (companyIds.length > 0) {
    await serviceClient.from("jobs").delete().in("company_id", companyIds);
    await serviceClient.from("company_profiles").delete().in("id", companyIds);
  }
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log(
    `Nettoyage préalable : ${marked.length} compte(s) de preuve supprimés.`,
  );
}

// ─── Scénario ───────────────────────────────────────────────────
async function main() {
  console.log("── Preuve gate essentiels (SRS §6.6) ──\n");

  await cleanPreviousProofs();

  const company = await createTestCompany(
    `t1-proof-co+${Date.now()}@proof.easyjob.cm`,
  );

  const { data: category } = await serviceClient
    .from("job_categories")
    .select("id")
    .limit(1)
    .single();

  const jobId = crypto.randomUUID();
  const { error: jobErr } = await serviceClient.from("jobs").insert({
    id: jobId,
    company_id: company.companyId,
    category_id: category?.id ?? null,
    title: "Poste de preuve T1 — gate essentiels",
    description:
      "Offre temporaire de validation E2E (supprimée après la preuve).",
    job_type: "shift",
    start_date: new Date(Date.now() + 864e5).toISOString().split("T")[0],
    start_time: "09:00",
    end_time: "13:00",
    hourly_rate: 1000,
    currency: "XAF",
    address: "Rue de la preuve",
    city: "Douala",
    quartier: "Akwa",
    latitude: 4.05,
    longitude: 9.77,
    positions_available: 10,
    positions_filled: 0,
    required_skills: [],
    status: "active",
    urgency: "normal",
    published_at: new Date().toISOString(),
  });
  if (jobErr) throw new Error(`job insert: ${jobErr.message}`);

  const emailA = `t1-proof-a+${Date.now()}@proof.easyjob.cm`;
  const emailB = `t1-proof-b+${Date.now()}@proof.easyjob.cm`;

  const phoneSuffix = String(Date.now()).slice(-7);
  const candA = await createTestCandidate(emailA, `+2376${phoneSuffix}1`, true);
  const candB = await createTestCandidate(
    emailB,
    `+2376${phoneSuffix}2`,
    false,
  );
  const { data: verified } = await serviceClient
    .from("users")
    .select("id, is_verified")
    .in("id", [candA.authUserId, candB.authUserId]);
  const isVerified = (id: string) =>
    verified?.find((u) => u.id === id)?.is_verified;
  report(
    "Fixture : is_verified dérivé de l'état (A vérifié, B non vérifié)",
    isVerified(candA.authUserId) === true &&
      isVerified(candB.authUserId) === false,
    verified,
  );
  console.log(
    `Candidats : A=${candA.email} (essentiels complets) / B=${candB.email} (3 essentiels manquants)\n`,
  );

  const cookiesA = await getRealSessionCookies(candA.email);
  const cookiesB = await getRealSessionCookies(candB.email);
  if (!cookiesA || !cookiesB) {
    throw new Error(
      "signInWithPassword a échoué pour au moins un compte de preuve.",
    );
  }

  try {
    // ── Cas A — essentiels complets, 100 % ──────────────────────
    // Le gate essentiels ne doit PAS bloquer A, et la candidature aboutit
    // (l'incohérence de lecture des offres actives a été corrigée, voir
    // proof-jobs-rls-select).
    const resA = await postApply(cookiesA, jobId);
    const aBlockedByEssentials =
      resA.status === 403 && resA.body.code === "profile_not_verified";
    report(
      "A : passe le gate essentiels (pas de 403 profile_not_verified)",
      !aBlockedByEssentials,
      { status: resA.status, body: resA.body },
    );
    const { data: aApps } = await serviceClient
      .from("job_applications")
      .select("id, status")
      .eq("job_id", jobId)
      .eq("candidate_id", candA.profileId);
    report(
      "A : candidature créée (200) et persistée en 'pending'",
      resA.status === 200 &&
        (aApps ?? []).length === 1 &&
        aApps?.[0]?.status === "pending",
      { status: resA.status, jobApps: aApps ?? [] },
    );

    // ── Cas B — 100 % mais essentiels incomplets ────────────────
    // Bloqué AU gate, avant le fetch de l'offre : 403 structuré.
    const resB = await postApply(cookiesB, jobId);
    const missingB = resB.body.missing as unknown;
    const bOk =
      resB.status === 403 &&
      resB.body.code === "profile_not_verified" &&
      Array.isArray(missingB) &&
      JSON.stringify([...(missingB as string[])].sort()) ===
        JSON.stringify(["cni", "identity", "momo"]);
    report("B : bloqué 403 profile_not_verified + essentiels manquants", bOk, {
      status: resB.status,
      body: resB.body,
    });
    report(
      "B : bloqué AVANT le fetch de l'offre (pas de 'Job not found')",
      resB.body.error !== "Job not found" && resB.status === 403,
      { status: resB.status, body: resB.body },
    );

    // Cas B — aucune candidature ne doit avoir été créée.
    const { data: bApps } = await serviceClient
      .from("job_applications")
      .select("id, candidate_id")
      .eq("job_id", jobId)
      .eq("candidate_id", candB.profileId);
    report("B : aucune job_applications créée", (bApps ?? []).length === 0, {
      jobApps: bApps ?? [],
    });

    console.log(
      `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
        failCount === 0
          ? "gate essentiels opérationnel (blocage serveur avant lecture d'offre)"
          : "ÉCHEC"
      }`,
    );
  } finally {
    // ── Nettoyage systématique ──
    await serviceClient.from("job_applications").delete().eq("job_id", jobId);
    await serviceClient.from("jobs").delete().eq("id", jobId);
    await serviceClient
      .from("company_profiles")
      .delete()
      .eq("id", company.companyId);
    await serviceClient
      .from("candidate_skills")
      .delete()
      .in("candidate_id", [candA.profileId, candB.profileId]);
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .in("user_id", [candA.authUserId, candB.authUserId]);
    await serviceClient
      .from("users")
      .delete()
      .in("id", [candA.authUserId, candB.authUserId, company.authUserId]);
    for (const id of [candA.authUserId, candB.authUserId, company.authUserId]) {
      const res = await serviceClient.auth.admin.deleteUser(id);
      if (res.error) console.warn("cleanup auth:", res.error.message);
    }
    console.log(
      "Nettoyage : offres, candidatures et comptes de preuve supprimés.",
    );
  }
}

main()
  .then(() => {
    if (failCount > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error("Preuve E2E échouée :", err);
    process.exit(1);
  });
