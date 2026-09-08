/**
 * Preuve E2E — fix RLS SELECT jobs (status 'published' -> 'active').
 *
 * Contexte : la seule policy SELECT jobs exposait `status = 'published'`
 * (ou les offres de sa propre entreprise), alors que tout l'app filtre sur
 * `status = 'active'` (GET /api/jobs, apply exige 'active', modération
 * approve -> 'active'). Conséquence : un candidat ne pouvait AUCUNE offre
 * active via RLS -> apply 404 "Job not found" = toute postulation en échec.
 *
 * Méthode (règle projet : JAMAIS psql superuser pour prouver la RLS) :
 *   1. Seed en service role : 1 entreprise (offre active + offre draft)
 *      + 1 candidat aux essentiels complets.
 *   2. Sessions RÉELLES : signInWithPassword(email) via @supabase/ssr
 *      (la même lib que l'app). Les lectures RLS (A, B, D) utilisent le
 *      JWT réel de la session — PostgREST résout auth.uid(), le RLS est
 *      réellement exercé côté base.
 *   3. Le POST /apply (C) passe par le serveur Next.js de dev avec le
 *      cookie de session @supabase/ssr, exactement comme l'app (comme
 *      la preuve T1).
 *   4. Attendus APRÈS le fix :
 *        A: le candidat lit l'offre active          (avant fix : vide/404)
 *        B: le candidat ne lit PAS l'offre draft    (fix sélectif, pas "tout")
 *        C: POST /apply sur l'active -> 200 + candidature créée
 *        D: l'entreprise lit SA propre offre draft  (branche OR intacte)
 *   5. Nettoyage complet des lignes de preuve.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const NEXT_APP_URL = "http://localhost:3000";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROOF_PASSWORD = "Proof-RLS-42!";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// ─── Sessions réelles via @supabase/ssr ─────────────────────────
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

/**
 * Se connecte avec la session de l'app (createServerClient + jar de
 * cookies en mémoire, le mécanisme de l'app) et renvoie :
 * - client : le createServerClient authentifié pour les lectures REST RLS
 *            (chacune envoie le JWT réel du cookie -> PostgREST résout
 *            auth.uid(), le RLS est réellement exercé) ;
 * - cookies : le jar complet à rejouer sur l'API Next.js (apply).
 */
async function signIn(
  email: string,
): Promise<{ client: DB; cookies: CookieEntry[] }> {
  const jar = makeCookieJar();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
    auth: { autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(
      `signInWithPassword(${email}) : ${error?.message ?? "pas de session"}`,
    );
  }
  const {
    data: { user: fromCookie },
  } = await client.auth.getUser();
  if (!fromCookie) throw new Error(`session non lisible (${email})`);
  return {
    client,
    cookies: [...jar.jar.entries()].map(([name, value]) => ({
      name,
      value,
    })),
  };
}

// ─── Asserts ────────────────────────────────────────────────────
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

// ─── Seed / cleanup ─────────────────────────────────────────────
interface RlsFixtures {
  companyAuthId: string;
  companyEmail: string;
  companyId: string;
  candidateAuthId: string;
  candidateEmail: string;
  candidateProfileId: string;
  activeJobId: string;
  draftJobId: string;
}

async function cleanPreviousProofs() {
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const marked = (page?.users ?? []).filter(
    (u) => u.user_metadata?.proofRls === true,
  );
  if (marked.length === 0) return;
  const ids = marked.map((u) => u.id);
  const { data: profiles } = await serviceClient
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const { data: companies } = await serviceClient
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const profileIds = (profiles ?? []).map((p) => p.id);
  const companyIds = (companies ?? []).map((c) => c.id);
  const jobIds = new Set<string>();
  if (profileIds.length > 0) {
    const { data: apps } = await serviceClient
      .from("job_applications")
      .select("job_id")
      .in("candidate_id", profileIds);
    for (const a of apps ?? []) jobIds.add(a.job_id);
  }
  if (companyIds.length > 0) {
    const { data: jobs } = await serviceClient
      .from("jobs")
      .select("id")
      .in("company_id", companyIds);
    for (const j of jobs ?? []) jobIds.add(j.id);
  }
  if (jobIds.size > 0) {
    await serviceClient
      .from("job_applications")
      .delete()
      .in("job_id", [...jobIds]);
    await serviceClient
      .from("jobs")
      .delete()
      .in("id", [...jobIds]);
  }
  if (profileIds.length > 0)
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .in("id", profileIds);
  if (companyIds.length > 0)
    await serviceClient.from("company_profiles").delete().in("id", companyIds);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log(`Nettoyage préalable : ${marked.length} compte(s) supprimés.`);
}

async function main() {
  console.log("── Preuve RLS SELECT jobs (status='active') ──\n");
  await cleanPreviousProofs();

  const suffix = Date.now();
  const companyEmail = `t-rls-co+${suffix}@proof.easyjob.cm`;
  const candidateEmail = `t-rls-ca+${suffix}@proof.easyjob.cm`;

  // ── Entreprise ────────────────────────────────────────────────
  const { data: createdCompanyUser, error: cuErr } =
    await serviceClient.auth.admin.createUser({
      email: companyEmail,
      password: PROOF_PASSWORD,
      email_confirm: true,
      user_metadata: { proofRls: true },
      app_metadata: { role: "company", phone_verified: true },
    });
  if (cuErr || !createdCompanyUser?.user)
    throw new Error(`company user: ${cuErr?.message}`);
  const companyAuthId = createdCompanyUser.user.id;
  const { error: cuRowErr } = await serviceClient.from("users").insert({
    id: companyAuthId,
    email: companyEmail,
    role: "company",
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (cuRowErr) throw new Error(`users (company): ${cuRowErr.message}`);
  const { data: company, error: cpErr } = await serviceClient
    .from("company_profiles")
    .insert({
      user_id: companyAuthId,
      company_name: "Entreprise de preuve RLS",
      city: "Douala",
      onboarding_status: "completed",
    })
    .select("id")
    .single();
  if (cpErr || !company) throw new Error(`company_profiles: ${cpErr.message}`);

  // ── Offres : 1 active + 1 draft ──────────────────────────────
  const baseJob = {
    company_id: company.id,
    category_id: null,
    description: "Offre de preuve RLS SELECT jobs.",
    job_type: "shift" as const,
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
    urgency: "normal" as const,
    published_at: new Date().toISOString(),
  };
  const { data: activeJob, error: ajErr } = await serviceClient
    .from("jobs")
    .insert({
      ...baseJob,
      id: crypto.randomUUID(),
      title: "Poste actif — preuve",
      status: "active",
    })
    .select("id, status")
    .single();
  if (ajErr || !activeJob) throw new Error(`job active: ${ajErr.message}`);
  const { data: draftJob, error: djErr } = await serviceClient
    .from("jobs")
    .insert({
      ...baseJob,
      id: crypto.randomUUID(),
      title: "Poste draft — preuve",
      status: "draft",
    })
    .select("id, status")
    .single();
  if (djErr || !draftJob) throw new Error(`job draft: ${djErr.message}`);

  // ── Candidat (essentiels complets) ────────────────────────────
  const { data: createdCandUser, error: cdErr } =
    await serviceClient.auth.admin.createUser({
      email: candidateEmail,
      password: PROOF_PASSWORD,
      email_confirm: true,
      user_metadata: { proofRls: true },
      app_metadata: { role: "candidate", phone_verified: true },
    });
  if (cdErr || !createdCandUser?.user)
    throw new Error(`candidate user: ${cdErr?.message}`);
  const candidateAuthId = createdCandUser.user.id;
  const { error: cdRowErr } = await serviceClient.from("users").insert({
    id: candidateAuthId,
    email: candidateEmail,
    role: "candidate",
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: "fr",
  });
  if (cdRowErr) throw new Error(`users (candidate): ${cdRowErr.message}`);
  const { data: candProfile, error: cpfErr } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: candidateAuthId,
      first_name: "Serge",
      last_name: "Talla",
      date_of_birth: "1996-06-10",
      city: "Douala",
      bio: "Candidat de preuve RLS — essentiels complets.",
      profile_photo_url: "photos/proof-rls.jpg",
      cni_front_url: "cni/rls-front.jpg",
      cni_back_url: "cni/rls-back.jpg",
      cni_selfie_url: "cni/rls-selfie.jpg",
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677000003",
      momo_verified: true,
      onboarding_status: "completed",
      onboarding_step: 6,
      profile_completion_pct: 100,
      sandbox_level: 1,
    })
    .select("id")
    .single();
  if (cpfErr || !candProfile)
    throw new Error(`candidate_profiles: ${cpfErr.message}`);

  const fx: RlsFixtures = {
    companyAuthId,
    companyEmail,
    companyId: company.id,
    candidateAuthId,
    candidateEmail,
    candidateProfileId: candProfile.id,
    activeJobId: activeJob.id,
    draftJobId: draftJob.id,
  };
  console.log(
    `Candidat=${fx.candidateEmail} / Entreprise=${fx.companyEmail}\n`,
  );

  const cand = await signIn(fx.candidateEmail);
  const comp = await signIn(fx.companyEmail);
  const candRls: DB = cand.client;
  const compRls: DB = comp.client;

  try {
    // A — le candidat lit l'offre ACTIVE via RLS (avant fix : vide).
    const aRes = await candRls
      .from("jobs")
      .select("id, status")
      .eq("id", fx.activeJobId)
      .maybeSingle();
    report(
      "A : le candidat lit l'offre active via RLS",
      aRes.error === null &&
        aRes.data?.id === fx.activeJobId &&
        aRes.data?.status === "active",
      { error: aRes.error?.message ?? null, row: aRes.data ?? null },
    );

    // B — le candidat ne lit PAS l'offre draft (fix sélectif :
    // 'active' uniquement, le draft reste masqué aux tiers).
    const bRes = await candRls
      .from("jobs")
      .select("id, status")
      .eq("id", fx.draftJobId)
      .maybeSingle();
    report(
      "B : le candidat ne lit PAS l'offre draft",
      bRes.error === null && bRes.data === null,
      { error: bRes.error?.message ?? null, row: bRes.data ?? null },
    );

    // C — POST /apply via le serveur Next.js avec le cookie de session
    // réelle (chemin app complet : gate T1 + RLS + creation candidature).
    // Avant le fix : 404 "Job not found" au fetch RLS de l'offre.
    const cookieHeader = cand.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const applyResp = await fetch(
      `${NEXT_APP_URL}/api/jobs/${fx.activeJobId}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      },
    ).catch((e) => {
      console.error("  fetch apply :", e);
      return null;
    });
    const applyBody = (await applyResp?.json().catch(() => ({}))) as {
      success?: boolean;
      application?: { id?: string; candidate_id?: string };
      error?: string;
      code?: string;
    };
    const { data: appsAfter } = await serviceClient
      .from("job_applications")
      .select("id, job_id, candidate_id")
      .eq("job_id", fx.activeJobId);
    report(
      "C : POST /apply -> 200 + candidature créée (plein flux débloqué)",
      applyResp?.status === 200 &&
        applyBody.success === true &&
        (appsAfter ?? []).length === 1,
      {
        status: applyResp?.status ?? "NO-RESPONSE",
        body: applyBody,
        applications: appsAfter ?? [],
      },
    );

    // D — l'entreprise lit SA propre offre draft (branche OR de la
    // policy intacte : une modification du fix ne doit pas casser le
    // cas "ses propres offres").
    const dRes = await compRls
      .from("jobs")
      .select("id, status")
      .eq("id", fx.draftJobId)
      .maybeSingle();
    report(
      "D : l'entreprise lit sa propre offre draft (branche OR intacte)",
      dRes.error === null && dRes.data?.id === fx.draftJobId,
      { error: dRes.error?.message ?? null, row: dRes.data ?? null },
    );

    console.log(
      `\n${passCount} ✅ / ${failCount} ❌ assertions — ${
        failCount === 0
          ? "RLS jobs corrigée (active lisible, draft masquée, apply 200)"
          : "ÉCHEC"
      }`,
    );
    if (failCount > 0) process.exitCode = 1;
  } finally {
    await serviceClient
      .from("job_applications")
      .delete()
      .in("job_id", [fx.activeJobId, fx.draftJobId]);
    await serviceClient
      .from("jobs")
      .delete()
      .in("id", [fx.activeJobId, fx.draftJobId]);
    await serviceClient
      .from("candidate_profiles")
      .delete()
      .eq("id", fx.candidateProfileId);
    await serviceClient
      .from("company_profiles")
      .delete()
      .eq("id", fx.companyId);
    await serviceClient
      .from("users")
      .delete()
      .in("id", [fx.companyAuthId, fx.candidateAuthId]);
    for (const id of [fx.companyAuthId, fx.candidateAuthId]) {
      const r = await serviceClient.auth.admin.deleteUser(id);
      if (r.error) console.warn("cleanup auth:", r.error.message);
    }
    console.log("Nettoyage : offres, candidatures et comptes supprimés.");
  }
}

main().catch((err) => {
  console.error("Preuve RLS échouée :", err);
  process.exit(1);
});
