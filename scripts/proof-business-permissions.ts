/**
 * Preuve lot 2 (audit F-04, F-05, F-06, F-11, F-17) — colonnes et tables
 * porteuses de droits.
 *
 * Couvre :
 *  A. candidate_profiles : falsification des colonnes protégées refusée en
 *     INSERT et UPDATE ; édition ordinaire préservée ; complétude et état
 *     d'onboarding recalculés par la base (cohérence avec
 *     lib/utils/profile-completion.ts sur des cas de référence) ;
 *     écritures de confiance (service_role, RPC existantes) préservées.
 *  B. job_applications : création seulement via apply_to_job (refus pour
 *     chaque condition métier, sans ligne créée), insertion directe et
 *     auto-sélection refusées, isolement entre candidats, retrait contrôlé
 *     (withdrawn) et répété, recandidature refusée, candidatures
 *     concurrentes sans doublon, aucune place consommée, écritures
 *     entreprise légitimes préservées et écritures arbitraires refusées.
 *  C. subscriptions : aucune écriture en session (y compris admin), lecture
 *     propre préservée.
 *  D. otp_codes : aucun accès anon/authenticated, ni via cleanup_expired_otp.
 *  E. Route Next /api/jobs/[id]/apply (POST, DELETE) : réponses et données
 *     persistées sur CETTE pile (prouve que le serveur Next l'utilise).
 *  F. Données vérifiées (F-35) : identité, photos et statut d'une CNI
 *     vérifiée et déclaration MoMo non modifiables par PATCH direct ;
 *     déverrouillage atomique par demande admin ; réinitialisation MoMo et
 *     recalcul de users.is_verified ; corrections admin préservées.
 *  G. Complétude, critère CNI : photos avant approbation, CNI vérifiée puis
 *     photos purgées, transitions, seuil de 60 % via apply_to_job, table liée.
 *  H. Routes profil (identity, payment, documents) : chemins légitimes.
 *
 * Méthode : tentatives utilisateur par de VRAIES sessions (clé anon +
 * signInWithPassword, cookies @supabase/ssr pour la route). La clé service
 * ne sert qu'aux fixtures et aux relectures de l'état persisté.
 *
 * Exécution : pile locale dédiée et `next dev` connecté à cette pile —
 * procédure dans docs/testing/local-proofs.md.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import {
  computeCandidateCriteria,
  computeCompletion,
  type CandidateProfileForCompletion,
} from "@/lib/utils/profile-completion";
import { readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type Tables = Database["public"]["Tables"];
type ProfileRow = Tables["candidate_profiles"]["Row"];
type ProfileInsert = Tables["candidate_profiles"]["Insert"];
type UserRow = Tables["users"]["Row"];
type AppRow = Tables["job_applications"]["Row"];

const {
  supabaseUrl: API_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();

const PASSWORD = "Proof-Lot2-31!";
const TAG = `lot2-${Date.now()}`;
const NO_SESSION = { autoRefreshToken: false, persistSession: false };
const svc: DB = createClient(API_URL, SERVICE_KEY, { auth: NO_SESSION });

let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok && detail !== undefined) console.log("      ", detail);
}

// ─── Comptes et sessions ────────────────────────────────────────
const createdIds: string[] = [];
let phoneSeq = 10;
const nextPhone = () => `+2376920000${String(phoneSeq++).padStart(2, "0")}`;

type Account = { id: string; email: string };

async function makeAccount(
  label: string,
  role: UserRow["role"],
  extra: Partial<UserRow> = {},
): Promise<Account> {
  const email = `${label}.${TAG}@easyjob.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role, phone_verified: true },
  });
  if (error || !data.user)
    throw new Error(`createUser ${label}: ${error?.message}`);
  createdIds.push(data.user.id);
  const { error: rowErr } = await svc.from("users").insert({
    id: data.user.id,
    email,
    phone: nextPhone(),
    phone_verified: true,
    is_active: true,
    role,
    locale: "fr",
    ...extra,
  });
  if (rowErr) throw new Error(`users ${label}: ${rowErr.message}`);
  return { id: data.user.id, email };
}

async function sessionFor(email: string): Promise<DB> {
  const client: DB = createClient(API_URL, ANON_KEY, { auth: NO_SESSION });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const anon: DB = createClient(API_URL, ANON_KEY, { auth: NO_SESSION });

/** Données de profil donnant 70 % selon computeCandidateCriteria (avec ≥ 1 compétence). */
const COMPLETE_PROFILE: ProfileInsert = {
  user_id: "",
  first_name: "Preuve",
  last_name: "Lot2",
  date_of_birth: "1995-05-05",
  city: "Douala",
  profile_photo_url: "photos/preuve.jpg",
  bio: "Profil de preuve du lot deux.",
  max_travel_distance_km: 10,
  cni_verified: "verified",
  momo_provider: "mtn",
  momo_number: "+237670000000",
  momo_verified: false,
  onboarding_status: "completed",
  onboarding_step: 5,
  // Valeur cohérente avec les données : la base la recalcule après le lot.
  profile_completion_pct: 70,
  sandbox_level: 0,
};

async function makeCandidate(
  label: string,
  opts: {
    user?: Partial<UserRow>;
    profile?: Partial<ProfileInsert>;
    skills?: string[];
  } = {},
): Promise<Account & { profileId: string }> {
  const acc = await makeAccount(label, "candidate", {
    is_verified: true,
    ...opts.user,
  });
  const { data, error } = await svc
    .from("candidate_profiles")
    .insert({ ...COMPLETE_PROFILE, ...opts.profile, user_id: acc.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(`profile ${label}: ${error?.message}`);
  const skills = opts.skills ?? ["Service en salle", "Plonge"];
  if (skills.length > 0) {
    const { error: skErr } = await svc.from("candidate_skills").insert(
      skills.map((skill_name) => ({
        candidate_id: data.id,
        skill_name,
        skill_level: 3,
      })),
    );
    if (skErr) throw new Error(`skills ${label}: ${skErr.message}`);
  }
  return { ...acc, profileId: data.id };
}

async function readProfile(id: string): Promise<ProfileRow | null> {
  const { data } = await svc
    .from("candidate_profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function skillCount(profileId: string): Promise<number> {
  const { count } = await svc
    .from("candidate_skills")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", profileId);
  return count ?? 0;
}

async function expectedPct(profileId: string): Promise<number> {
  const row = await readProfile(profileId);
  return computeCompletion(
    computeCandidateCriteria(
      row as CandidateProfileForCompletion,
      await skillCount(profileId),
    ),
  );
}

async function applicationsFor(
  jobId: string,
  profileId: string,
): Promise<AppRow[]> {
  const { data } = await svc
    .from("job_applications")
    .select("*")
    .eq("job_id", jobId)
    .eq("candidate_id", profileId);
  return data ?? [];
}

// ─── Fixtures entreprise / offres ───────────────────────────────
let jobSeq = 0;
async function makeJob(
  companyId: string,
  extra: Partial<Tables["jobs"]["Insert"]> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await svc.from("jobs").insert({
    id,
    company_id: companyId,
    title: `Offre preuve lot 2 #${++jobSeq}`,
    description: "Offre de preuve du lot 2.",
    job_type: "shift",
    start_date: new Date(Date.now() + 864e5).toISOString().split("T")[0],
    start_time: "09:00",
    end_time: "13:00",
    hourly_rate: 1000,
    currency: "XAF",
    address: "Rue de la preuve",
    city: "Douala",
    quartier: "Akwa",
    positions_available: 2,
    positions_filled: 0,
    required_skills: [],
    urgency: "normal",
    status: "active",
    published_at: new Date().toISOString(),
    ...extra,
  });
  if (error) throw new Error(`job: ${error.message}`);
  return id;
}

async function makeCompany(label: string) {
  const acc = await makeAccount(label, "company", { is_verified: true });
  const { data, error } = await svc
    .from("company_profiles")
    .insert({
      user_id: acc.id,
      company_name: `Entreprise ${label}`,
      city: "Douala",
      onboarding_status: "completed",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company ${label}: ${error?.message}`);
  return { ...acc, companyId: data.id };
}

// ─── RPC ────────────────────────────────────────────────────────
type RpcResult = {
  data: AppRow | null;
  error: { message: string; details?: string } | null;
};
// Appels non typés : la preuve doit aussi tourner (contrôle négatif) sur une
// base où les RPC n'existent pas encore.
const callRpc = (client: DB, fn: string, args: Record<string, unknown>) =>
  (
    client.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<RpcResult>
  )(fn, args);
const applyRpc = (client: DB, jobId: string) =>
  callRpc(client, "apply_to_job", { p_job_id: jobId });
const withdrawRpc = (client: DB, jobId: string) =>
  callRpc(client, "withdraw_job_application", { p_job_id: jobId });

// ─── A. candidate_profiles ──────────────────────────────────────
async function proveProfiles() {
  console.log("\n── A. candidate_profiles (F-04) ──");

  const cand = await makeCandidate("a-cand", {
    profile: {
      no_show_count: 2,
      total_missions: 1,
      completed_missions: 1,
      reliability_score: 1.5,
    },
  });
  const s = await sessionFor(cand.email);
  const fresh = await makeAccount("a-fresh", "candidate");

  const attempts: [string, Partial<ProfileRow>][] = [
    ["sandbox_level → 3", { sandbox_level: 3 }],
    [
      "premium_until → +1 an",
      { premium_until: new Date(Date.now() + 365 * 864e5).toISOString() },
    ],
    ["driving_license_verified → true", { driving_license_verified: true }],
    [
      "driving_license_expires_at → 2099",
      { driving_license_expires_at: "2099-01-01" },
    ],
    ["profile_completion_pct → 100", { profile_completion_pct: 100 }],
    ["onboarding_status → rejected", { onboarding_status: "rejected" }],
    ["reliability_score → 5", { reliability_score: 5 }],
    ["completed_missions → 99", { completed_missions: 99 }],
    ["total_missions → 99", { total_missions: 99 }],
    ["no_show_count → 0", { no_show_count: 0 }],
    ["average_rating → 5", { average_rating: 5 }],
    ["is_sandbox → false", { is_sandbox: false }],
    ["sandbox_missions_completed → 10", { sandbox_missions_completed: 10 }],
    ["momo_verified → true", { momo_verified: true }],
    ["cni_expires_at → 2099", { cni_expires_at: "2099-01-01" }],
    ["user_id → autre compte", { user_id: fresh.id }],
  ];
  for (const [label, patch] of attempts) {
    const before = await readProfile(cand.profileId);
    const { data, error } = await s
      .from("candidate_profiles")
      .update(patch)
      .eq("id", cand.profileId)
      .select("id");
    const after = await readProfile(cand.profileId);
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    report(
      `A1 UPDATE candidat ${label} refusé, valeur inchangée`,
      unchanged && (error !== null || (data ?? []).length === 0),
      {
        error: error?.code,
        rows: data?.length,
      },
    );
  }

  // A2 — création falsifiée (compte candidat sans profil).
  const sf = await sessionFor(fresh.email);
  const forged: Partial<ProfileInsert>[] = [
    { sandbox_level: 3 },
    { premium_until: "2099-01-01T00:00:00Z" },
    { driving_license_verified: true },
    { profile_completion_pct: 100 },
    { onboarding_status: "completed" },
    { reliability_score: 5, completed_missions: 50 },
    { momo_verified: true },
    { cni_verified: "verified" },
  ];
  for (const extra of forged) {
    const { error } = await sf
      .from("candidate_profiles")
      .insert({ user_id: fresh.id, first_name: "Faux", ...extra });
    const { data: rows } = await svc
      .from("candidate_profiles")
      .select("id")
      .eq("user_id", fresh.id);
    report(
      `A2 INSERT candidat ${Object.keys(extra).join("+")} refusé, aucune ligne`,
      error !== null && (rows ?? []).length === 0,
      {
        error: error?.code,
        rows: rows?.length,
      },
    );
  }

  // A3 — création légitime (comme app/onboarding/candidate/page.tsx).
  const { data: created, error: createErr } = await sf
    .from("candidate_profiles")
    .insert({ user_id: fresh.id, onboarding_step: 1 })
    .select("id, onboarding_status, profile_completion_pct, sandbox_level")
    .single();
  if (!created) {
    report("A3 INSERT légitime (onboarding) accepté", false, createErr);
    return;
  }
  // max_travel_distance_km vaut 10 par défaut : le critère « disponibilité » compte déjà.
  report(
    "A3 INSERT légitime (onboarding) accepté : in_progress, complétude = TS (10 %)",
    !createErr &&
      created.onboarding_status === "in_progress" &&
      created.profile_completion_pct === (await expectedPct(created.id)) &&
      created.sandbox_level === 0,
    { createErr, created },
  );

  // A4 — édition ordinaire + recalcul de la complétude.
  const { error: editErr } = await sf
    .from("candidate_profiles")
    .update({
      first_name: "Awa",
      last_name: "Ngono",
      date_of_birth: "1998-02-02",
      city: "Yaoundé",
      bio: "Serveuse expérimentée et ponctuelle.",
      max_travel_distance_km: 15,
    })
    .eq("id", created.id);
  const afterEdit = await readProfile(created.id);
  report(
    "A4 édition ordinaire acceptée, complétude recalculée (= TS, 40 %)",
    !editErr &&
      afterEdit?.first_name === "Awa" &&
      afterEdit.profile_completion_pct === (await expectedPct(created.id)) &&
      afterEdit.profile_completion_pct === 40,
    { editErr, pct: afterEdit?.profile_completion_pct },
  );

  // A5 — compétences ajoutées en session : recalcul par la base.
  const { error: skErr } = await sf.from("candidate_skills").insert([
    {
      candidate_id: created.id,
      skill_name: "Service en salle",
      skill_level: 3,
    },
    { candidate_id: created.id, skill_name: "Accueil", skill_level: 3 },
  ]);
  const afterSkills = await readProfile(created.id);
  report(
    "A5 ajout de compétences : complétude recalculée (55 %)",
    !skErr && afterSkills?.profile_completion_pct === 55,
    {
      skErr,
      pct: afterSkills?.profile_completion_pct,
    },
  );

  // A6 — onboarding : étape finale refusée tant que MoMo manque, puis acceptée.
  await sf
    .from("candidate_profiles")
    .update({ onboarding_step: 5 })
    .eq("id", created.id);
  const early = await readProfile(created.id);
  report(
    "A6a fin d'onboarding sans MoMo : reste in_progress, étape ramenée à 4",
    early?.onboarding_status === "in_progress" && early.onboarding_step === 4,
    { status: early?.onboarding_status, step: early?.onboarding_step },
  );
  // MoMo passe par candidate_update_momo (seul chemin candidat, F-35).
  const { error: momoDeclErr } = await callRpc(sf, "candidate_update_momo", {
    p_provider: "orange",
    p_number: "+237690000001",
    p_account_name: null,
  });
  const { error: stepErr } = await sf
    .from("candidate_profiles")
    .update({ onboarding_step: 5 })
    .eq("id", created.id);
  const finishErr = momoDeclErr ?? stepErr;
  const done = await readProfile(created.id);
  report(
    "A6b fin d'onboarding complète : completed",
    !finishErr && done?.onboarding_status === "completed",
    {
      finishErr,
      status: done?.onboarding_status,
    },
  );
  await sf
    .from("candidate_profiles")
    .update({ onboarding_step: 1 })
    .eq("id", created.id);
  const stays = await readProfile(created.id);
  report(
    "A6c un profil completed ne régresse pas par écriture candidat",
    stays?.onboarding_status === "completed",
    stays?.onboarding_status,
  );

  // A7 — cohérence SQL / TS sur des cas de référence (écrits en service_role).
  const cases: [string, Partial<ProfileRow>, string[]][] = [
    [
      "vide",
      {
        first_name: null,
        last_name: null,
        date_of_birth: null,
        city: null,
        profile_photo_url: null,
        bio: null,
        max_travel_distance_km: null,
        momo_verified: false,
      },
      [],
    ],
    [
      "identité sans ville",
      {
        first_name: "A",
        last_name: "B",
        date_of_birth: "2000-01-01",
        city: "",
      },
      [],
    ],
    ["bio de 10 caractères après trim", { bio: "  abcdefghij  " }, []],
    ["bio de 11 caractères", { bio: "abcdefghijk" }, []],
    ["latitude nulle (0)", { latitude: 0, longitude: 9.7 }, []],
    ["coordonnées présentes", { latitude: 4.05, longitude: 9.7 }, []],
    [
      "CNI 2 photos sur 3",
      { cni_front_url: "f", cni_back_url: "b", cni_selfie_url: null },
      [],
    ],
    [
      "CNI complète",
      { cni_front_url: "f", cni_back_url: "b", cni_selfie_url: "s" },
      ["Accueil"],
    ],
    [
      "tout rempli",
      {
        first_name: "A",
        last_name: "B",
        date_of_birth: "2000-01-01",
        city: "Douala",
        profile_photo_url: "p",
        bio: "Bio suffisamment longue",
        max_travel_distance_km: 5,
        latitude: 4.05,
        longitude: 9.7,
        cni_front_url: "f",
        cni_back_url: "b",
        cni_selfie_url: "s",
      },
      ["Accueil", "Plonge"],
    ],
  ];
  const ref = await makeCandidate("a-ref", {
    skills: [],
    profile: { cni_verified: "pending" },
  });
  for (const [label, patch, skills] of cases) {
    await svc
      .from("candidate_skills")
      .delete()
      .eq("candidate_id", ref.profileId);
    await svc.from("candidate_profiles").update(patch).eq("id", ref.profileId);
    if (skills.length > 0)
      await svc.from("candidate_skills").insert(
        skills.map((skill_name) => ({
          candidate_id: ref.profileId,
          skill_name,
          skill_level: 3,
        })),
      );
    const row = await readProfile(ref.profileId);
    const expected = await expectedPct(ref.profileId);
    report(
      `A7 cohérence SQL/TS — ${label} (${expected} %)`,
      row?.profile_completion_pct === expected,
      {
        sql: row?.profile_completion_pct,
        ts: expected,
      },
    );
  }
  // momo_verified n'est écrit que par apply_momo_verification (GUC) : on
  // vérifie son poids via un profil inséré directement avec MoMo vérifié.
  const momo = await makeCandidate("a-momo", {
    skills: [],
    profile: { momo_verified: true },
  });
  const momoRow = await readProfile(momo.profileId);
  report(
    "A7 cohérence SQL/TS — MoMo vérifié",
    momoRow?.profile_completion_pct === (await expectedPct(momo.profileId)),
    {
      sql: momoRow?.profile_completion_pct,
      ts: await expectedPct(momo.profileId),
    },
  );

  // A8 — écritures de confiance préservées.
  const { error: adminErr } = await svc
    .from("candidate_profiles")
    .update({
      sandbox_level: 2,
      premium_until: "2099-01-01T00:00:00Z",
      driving_license_verified: true,
    })
    .eq("id", cand.profileId);
  const adminRow = await readProfile(cand.profileId);
  report(
    "A8 service_role (opération d'administration) peut écrire les colonnes protégées",
    !adminErr &&
      adminRow?.sandbox_level === 2 &&
      adminRow.driving_license_verified === true,
    adminErr,
  );
  const { error: momoRpcErr } = await callRpc(s, "candidate_update_momo", {
    p_provider: "mtn",
    p_number: "+237670000099",
    p_account_name: null,
  });
  const afterMomo = await readProfile(cand.profileId);
  report(
    "A9 RPC existante candidate_update_momo préservée (déclaration enregistrée)",
    !momoRpcErr && afterMomo?.momo_number === "+237670000099",
    momoRpcErr,
  );
}

// ─── B. job_applications ────────────────────────────────────────
async function proveApplications() {
  console.log("\n── B. job_applications (F-05, F-17) ──");
  const coA = await makeCompany("b-coA");
  const coB = await makeCompany("b-coB");
  const job = await makeJob(coA.companyId);
  const jobOther = await makeJob(coA.companyId);
  const jobDraft = await makeJob(coA.companyId, { status: "draft" });
  const jobFull = await makeJob(coA.companyId, {
    positions_available: 1,
    positions_filled: 1,
  });
  const jobSandbox = await makeJob(coA.companyId, {
    sandbox_level_required: 2,
  });
  const jobLicense = await makeJob(coA.companyId, {
    required_documents: ["driving_license"],
  });
  const jobCasier = await makeJob(coA.companyId, {
    required_documents: ["casier_judiciaire"],
  });
  const jobSkillDoc = await makeJob(coA.companyId);
  await svc.from("job_required_skill_documents").insert({
    job_id: jobSkillDoc,
    skill_name: "Électricité",
    document_type: "diplome",
  });

  const ok = await makeCandidate("b-ok");
  const other = await makeCandidate("b-other");
  const sOk = await sessionFor(ok.email);
  const sOther = await sessionFor(other.email);

  // B1 — insertion directe (y compris déjà « selected »).
  for (const status of ["pending", "selected"] as const) {
    const { error } = await sOk
      .from("job_applications")
      .insert({ job_id: job, candidate_id: ok.profileId, status });
    report(
      `B1 INSERT direct (${status}) refusé, aucune ligne`,
      error !== null && (await applicationsFor(job, ok.profileId)).length === 0,
      error?.code,
    );
  }

  // B2 — candidature valide via la RPC.
  const { data: app, error: applyErr } = await applyRpc(sOk, job);
  const persisted = await applicationsFor(job, ok.profileId);
  report(
    "B2 apply_to_job valide : 1 ligne pending persistée",
    !applyErr &&
      app?.status === "pending" &&
      persisted.length === 1 &&
      persisted[0].status === "pending" &&
      persisted[0].id === app?.id,
    { applyErr, persisted },
  );
  const { data: jobAfter } = await svc
    .from("jobs")
    .select("positions_filled")
    .eq("id", job)
    .single();
  report(
    "B2b la candidature ne consomme pas de place",
    jobAfter?.positions_filled === 0,
    jobAfter,
  );

  // B3 — refus métier, chacun sans ligne créée.
  const refusals: [string, Account & { profileId: string }, string, string][] =
    [];
  const suspended = await makeCandidate("b-suspended", {
    user: { is_active: false },
  });
  const unverified = await makeCandidate("b-unverified", {
    user: { is_verified: false },
  });
  const onboarding = await makeCandidate("b-onboarding", {
    profile: { onboarding_status: "in_progress", onboarding_step: 3 },
  });
  const incomplete = await makeCandidate("b-incomplete", {
    skills: [],
    profile: {
      profile_photo_url: null,
      bio: null,
      max_travel_distance_km: null,
      profile_completion_pct: 20,
    },
  });
  refusals.push(
    ["compte suspendu", suspended, job, "account_suspended"],
    ["profil non vérifié", unverified, job, "profile_not_verified"],
    ["onboarding non terminé", onboarding, job, "onboarding_incomplete"],
    ["complétude < 60 %", incomplete, job, "profile_incomplete"],
    ["offre non active (draft)", ok, jobDraft, "job_not_available"],
    ["offre inexistante", ok, crypto.randomUUID(), "job_not_found"],
    ["niveau Sandbox insuffisant", ok, jobSandbox, "sandbox_level_too_low"],
    ["offre complète", ok, jobFull, "no_positions"],
    ["permis requis absent", ok, jobLicense, "document_requirement"],
    ["casier judiciaire requis absent", ok, jobCasier, "document_requirement"],
    [
      "diplôme de compétence requis absent",
      ok,
      jobSkillDoc,
      "document_requirement",
    ],
  );
  for (const [label, who, jobId, code] of refusals) {
    const client = who === ok ? sOk : await sessionFor(who.email);
    const { error } = await applyRpc(client, jobId);
    const rows = await applicationsFor(jobId, who.profileId);
    report(
      `B3 refus — ${label} (${code}), aucune ligne`,
      error?.message === code && rows.length === 0,
      {
        error: error?.message,
        details: error?.details,
        rows: rows.length,
      },
    );
  }
  const { error: dupErr } = await applyRpc(sOk, job);
  report(
    "B3 refus — candidature en double (already_applied)",
    dupErr?.message === "already_applied" &&
      (await applicationsFor(job, ok.profileId)).length === 1,
    dupErr?.message,
  );

  // B4 — le candidat ne modifie pas sa candidature (auto-sélection, score, rattachement).
  const appId = persisted[0]?.id ?? "";
  const selfPatches: [string, Partial<AppRow>][] = [
    ["status → selected", { status: "selected", selected_by: ok.id }],
    ["match_score → 100", { match_score: 100 }],
    ["job_id → autre offre", { job_id: jobOther }],
    ["status → withdrawn (hors RPC)", { status: "withdrawn" }],
  ];
  for (const [label, patch] of selfPatches) {
    const before = await applicationsFor(job, ok.profileId);
    const { data, error } = await sOk
      .from("job_applications")
      .update(patch)
      .eq("id", appId)
      .select("id");
    const after = await applicationsFor(job, ok.profileId);
    report(
      `B4 UPDATE candidat ${label} refusé, inchangé`,
      JSON.stringify(before) === JSON.stringify(after) &&
        (error !== null || (data ?? []).length === 0),
      {
        error: error?.code,
        rows: data?.length,
      },
    );
  }
  const { error: delErr } = await sOk
    .from("job_applications")
    .delete()
    .eq("id", appId);
  report(
    "B4 DELETE direct refusé, ligne conservée",
    (await applicationsFor(job, ok.profileId)).length === 1,
    delErr?.code,
  );

  // B5 — isolement entre candidats.
  const { data: seen } = await sOther
    .from("job_applications")
    .select("id")
    .eq("id", appId);
  report(
    "B5 un autre candidat ne lit pas la candidature",
    (seen ?? []).length === 0,
    seen,
  );
  const { data: hijack } = await sOther
    .from("job_applications")
    .update({ status: "withdrawn" })
    .eq("id", appId)
    .select("id");
  const { error: wOtherErr } = await withdrawRpc(sOther, job);
  const stillPending =
    (await applicationsFor(job, ok.profileId))[0]?.status === "pending";
  report(
    "B5 un autre candidat ne peut ni modifier ni retirer la candidature",
    (hijack ?? []).length === 0 &&
      wOtherErr?.message === "application_not_found" &&
      stillPending,
    { hijack, wOtherErr: wOtherErr?.message },
  );

  // B6 — entreprise : écritures arbitraires refusées, sélection légitime préservée.
  const sCoA = await sessionFor(coA.email);
  const sCoB = await sessionFor(coB.email);
  const { error: coInsertErr } = await sCoA
    .from("job_applications")
    .insert({ job_id: job, candidate_id: other.profileId });
  report(
    "B6 INSERT entreprise refusé",
    coInsertErr !== null &&
      (await applicationsFor(job, other.profileId)).length === 0,
    coInsertErr?.code,
  );
  const coPatches: [string, Partial<AppRow>][] = [
    ["candidate_id → autre candidat", { candidate_id: other.profileId }],
    ["job_id → autre offre", { job_id: jobOther }],
    ["match_score → 99", { match_score: 99 }],
    ["status → withdrawn", { status: "withdrawn" }],
    [
      "selected_by → un autre compte",
      { status: "selected", selected_by: ok.id },
    ],
  ];
  for (const [label, patch] of coPatches) {
    const before = await applicationsFor(job, ok.profileId);
    const { data, error } = await sCoA
      .from("job_applications")
      .update(patch)
      .eq("id", appId)
      .select("id");
    const after = await applicationsFor(job, ok.profileId);
    report(
      `B6 UPDATE entreprise ${label} refusé, inchangé`,
      JSON.stringify(before) === JSON.stringify(after) &&
        (error !== null || (data ?? []).length === 0),
      {
        error: error?.code,
        rows: data?.length,
      },
    );
  }
  const { data: coBData } = await sCoB
    .from("job_applications")
    .update({ status: "rejected" })
    .eq("id", appId)
    .select("id");
  report(
    "B6 entreprise B ne modifie pas une candidature de A",
    (coBData ?? []).length === 0 &&
      (await applicationsFor(job, ok.profileId))[0]?.status === "pending",
    coBData,
  );

  // B7 — retrait contrôlé, répété, recandidature.
  const { data: w1, error: w1Err } = await withdrawRpc(sOk, job);
  const afterW = await applicationsFor(job, ok.profileId);
  report(
    "B7 retrait : statut withdrawn persisté",
    !w1Err && w1?.status === "withdrawn" && afterW[0]?.status === "withdrawn",
    { w1Err, afterW },
  );
  const { data: w2, error: w2Err } = await withdrawRpc(sOk, job);
  report(
    "B7 retrait répété : sans erreur, toujours withdrawn, une seule ligne",
    !w2Err &&
      w2?.status === "withdrawn" &&
      (await applicationsFor(job, ok.profileId)).length === 1,
    w2Err,
  );
  const { error: reErr } = await applyRpc(sOk, job);
  report(
    "B7 recandidature après retrait refusée (une seule candidature par offre)",
    reErr?.message === "already_applied" &&
      (await applicationsFor(job, ok.profileId))[0]?.status === "withdrawn",
    reErr?.message,
  );
  const { data: revive } = await sCoA
    .from("job_applications")
    .update({ status: "selected", selected_by: coA.id })
    .eq("id", appId)
    .select("id");
  report(
    "B7 l'entreprise ne peut pas sélectionner une candidature retirée",
    (await applicationsFor(job, ok.profileId))[0]?.status === "withdrawn",
    revive,
  );

  // B8 — sélection et rejet légitimes par l'entreprise (comportement actuel de app/company/jobs/[id]).
  const { data: app2 } = await applyRpc(sOther, job);
  const { error: selErr } = await sCoA
    .from("job_applications")
    .update({
      status: "selected",
      selected_at: new Date().toISOString(),
      selected_by: coA.id,
    })
    .eq("id", app2?.id ?? "");
  const sel = (await applicationsFor(job, other.profileId))[0];
  report(
    "B8 sélection légitime par l'entreprise préservée",
    !selErr && sel?.status === "selected" && sel.selected_by === coA.id,
    selErr,
  );
  const { error: backErr } = await sCoA
    .from("job_applications")
    .update({ status: "pending" })
    .eq("id", app2?.id ?? "");
  report(
    "B8 l'entreprise ne peut pas remettre une candidature en pending",
    backErr !== null &&
      (await applicationsFor(job, other.profileId))[0]?.status === "selected",
    backErr?.code,
  );
  const { error: rejErr } = await sCoA
    .from("job_applications")
    .update({
      status: "rejected",
      rejection_reason: "Profil ne correspondant pas",
    })
    .eq("id", app2?.id ?? "");
  report(
    "B8 rejet motivé par l'entreprise préservé",
    !rejErr &&
      (await applicationsFor(job, other.profileId))[0]?.status === "rejected",
    rejErr,
  );
  const { error: wSelErr } = await withdrawRpc(sOther, job);
  report(
    "B8 retrait impossible hors pending (application_not_withdrawable)",
    wSelErr?.message === "application_not_withdrawable",
    wSelErr?.message,
  );

  // B9 — candidatures concurrentes.
  const conc = await makeCandidate("b-conc");
  const sConc = await sessionFor(conc.email);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => applyRpc(sConc, jobOther)),
  );
  const successes = results.filter((r) => !r.error).length;
  const dupes = results.filter(
    (r) => r.error?.message === "already_applied",
  ).length;
  report(
    "B9 6 candidatures concurrentes : 1 succès, 5 already_applied, 1 ligne",
    successes === 1 &&
      dupes === 5 &&
      (await applicationsFor(jobOther, conc.profileId)).length === 1,
    {
      successes,
      errors: results.map((r) => r.error?.message),
    },
  );

  // B10 — anon.
  const { error: anonApply } = await applyRpc(anon, job);
  report(
    "B10 apply_to_job refusé à anon",
    anonApply !== null,
    anonApply?.message,
  );

  return { coA, ok, unverified, suspended, job, jobLicense };
}

// ─── C. subscriptions ───────────────────────────────────────────
async function proveSubscriptions() {
  console.log("\n── C. subscriptions (F-06) ──");
  const cand = await makeAccount("c-cand", "candidate");
  const company = await makeAccount("c-company", "company");
  const ops = await makeAccount("c-ops", "admin_ops");
  const support = await makeAccount("c-support", "admin_support");
  const sub = {
    plan: "premium",
    price: 0,
    started_at: new Date().toISOString(),
    expires_at: "2099-01-01T00:00:00Z",
    status: "active",
  };
  for (const [label, acc] of [
    ["candidat", cand],
    ["entreprise", company],
    ["admin_ops", ops],
    ["admin_support", support],
  ] as const) {
    const s = await sessionFor(acc.email);
    const { error } = await s
      .from("subscriptions")
      .insert({ ...sub, user_id: acc.id });
    const { error: upsertErr } = await s
      .from("subscriptions")
      .upsert({ ...sub, user_id: acc.id });
    const { count } = await svc
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", acc.id);
    report(
      `C1 auto-attribution d'abonnement (${label}) refusée (INSERT et UPSERT)`,
      error !== null && upsertErr !== null && count === 0,
      {
        error: error?.code,
        upsertErr: upsertErr?.code,
        count,
      },
    );
  }
  const { data: legit, error: svcErr } = await svc
    .from("subscriptions")
    .insert({ ...sub, plan: "starter", price: 15000, user_id: company.id })
    .select("id")
    .single();
  report(
    "C2 création par le serveur (service_role) préservée",
    !svcErr && !!legit,
    svcErr,
  );
  const sCo = await sessionFor(company.email);
  const { data: own } = await sCo
    .from("subscriptions")
    .select("id, plan")
    .eq("user_id", company.id);
  report(
    "C3 lecture de son propre abonnement préservée",
    (own ?? []).length === 1,
    own,
  );
  for (const [label, acc] of [
    ["propriétaire", company],
    ["admin_ops", ops],
  ] as const) {
    const s = await sessionFor(acc.email);
    const { data } = await s
      .from("subscriptions")
      .update({ plan: "business", price: 0 })
      .eq("id", legit?.id ?? "")
      .select("id");
    const { error: delErr } = await s
      .from("subscriptions")
      .delete()
      .eq("id", legit?.id ?? "");
    const { data: row } = await svc
      .from("subscriptions")
      .select("plan, price")
      .eq("id", legit?.id ?? "")
      .single();
    report(
      `C4 modification/suppression en session (${label}) refusée`,
      (data ?? []).length === 0 &&
        row?.plan === "starter" &&
        Number(row?.price) === 15000,
      {
        rows: data?.length,
        delErr: delErr?.code,
        row,
      },
    );
  }
}

// ─── D. otp_codes ───────────────────────────────────────────────
async function proveOtpCodes() {
  console.log("\n── D. otp_codes (F-11) ──");
  const { data: seeded } = await svc
    .from("otp_codes")
    .insert({
      phone: "+237699999999",
      code: "123456",
      expires_at: "2000-01-01T00:00:00Z",
    })
    .select("id")
    .single();
  const user = await makeAccount("d-user", "candidate");
  const sUser = await sessionFor(user.email);
  for (const [label, client] of [
    ["anon", anon],
    ["authenticated", sUser],
  ] as const) {
    const { data: read, error: readErr } = await client
      .from("otp_codes")
      .select("id, code");
    const { error: insErr } = await client.from("otp_codes").insert({
      phone: "+237600000000",
      code: "000000",
      expires_at: "2099-01-01T00:00:00Z",
    });
    await client
      .from("otp_codes")
      .update({ code: "999999" })
      .eq("id", seeded?.id ?? "");
    await client
      .from("otp_codes")
      .delete()
      .eq("id", seeded?.id ?? "");
    const { error: rpcErr } = await callRpc(client, "cleanup_expired_otp", {});
    const { data: row } = await svc
      .from("otp_codes")
      .select("code")
      .eq("id", seeded?.id ?? "")
      .maybeSingle();
    report(
      `D1 otp_codes inaccessible à ${label} (lecture, écriture, cleanup_expired_otp)`,
      readErr !== null &&
        (read ?? []).length === 0 &&
        insErr !== null &&
        rpcErr !== null &&
        row?.code === "123456",
      {
        readErr: readErr?.code,
        read: read?.length,
        insErr: insErr?.code,
        rpcErr: rpcErr?.message,
        row,
      },
    );
  }
  await svc
    .from("otp_codes")
    .delete()
    .eq("id", seeded?.id ?? "");
}

// ─── F. Données vérifiées : identité, CNI, MoMo (F-35) ──────────
/** CNI et MoMo vérifiés (photos CNI déjà purgées, comme après T8.4). */
const VERIFIED_PROFILE: Partial<ProfileInsert> = {
  cni_verified: "verified",
  momo_verified: true,
  momo_name_match: true,
  momo_verified_at: new Date().toISOString(),
  momo_account_name: "Preuve Lot2",
};

async function isVerified(userId: string): Promise<boolean | null> {
  const { data } = await svc
    .from("users")
    .select("is_verified")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_verified ?? null;
}

async function readRequest(id: string) {
  const { data } = await svc
    .from("profile_update_requests")
    .select("status, completed_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Demande de mise à jour créée par l'admin en session (policy existante). */
async function makeRequest(
  admin: DB,
  adminId: string,
  candidateId: string,
  fields: string[],
): Promise<string> {
  const { data, error } = await admin
    .from("profile_update_requests")
    .insert({
      candidate_id: candidateId,
      fields,
      status: "pending",
      reason: "Preuve lot 2",
      requested_by: adminId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`request: ${error?.message}`);
  return data.id;
}

async function auditCount(action: string, resourceId: string) {
  const { count } = await svc
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .eq("resource_id", resourceId);
  return count ?? 0;
}

async function proveVerificationLocks() {
  console.log("\n── F. Données vérifiées : identité, CNI, MoMo (F-35) ──");
  const ops = await makeAccount("f-ops", "admin_ops");
  const founder = await makeAccount("f-founder", "admin_founder");
  const so = await sessionFor(ops.email);

  const cand = await makeCandidate("f-cand", { profile: VERIFIED_PROFILE });
  const s = await sessionFor(cand.email);
  const attempts: [string, Partial<ProfileRow>][] = [
    ["prénom", { first_name: "Usurpe" }],
    ["nom", { last_name: "Usurpe" }],
    ["date de naissance", { date_of_birth: "1980-01-01" }],
    ["photo CNI", { cni_front_url: `${cand.id}/autre.jpg` }],
    ["statut CNI → pending seul", { cni_verified: "pending" }],
    [
      "statut CNI → pending + prénom",
      { cni_verified: "pending", first_name: "Usurpe" },
    ],
    ["motif de refus CNI", { cni_rejection_reason: "Motif forgé" }],
    ["numéro MoMo", { momo_number: "+237670000777" }],
    ["opérateur MoMo", { momo_provider: "orange" }],
    ["nom du compte MoMo", { momo_account_name: "Tiers" }],
  ];
  for (const [label, patch] of attempts) {
    const before = await readProfile(cand.profileId);
    const { data, error } = await s
      .from("candidate_profiles")
      .update(patch)
      .eq("id", cand.profileId)
      .select("id");
    const after = await readProfile(cand.profileId);
    report(
      `F1 PATCH direct ${label} sur données vérifiées refusé, valeurs et is_verified inchangés`,
      JSON.stringify(before) === JSON.stringify(after) &&
        (error !== null || (data ?? []).length === 0) &&
        (await isVerified(cand.id)) === true,
      { error: error?.message, rows: data?.length },
    );
  }

  // F2 — atomicité : une écriture refusée ne consomme pas la demande.
  const reqAtomic = await makeRequest(so, ops.id, cand.profileId, ["identity"]);
  const { error: mixedErr } = await s
    .from("candidate_profiles")
    .update({ first_name: "Awa", sandbox_level: 3 })
    .eq("id", cand.profileId);
  const afterMixed = await readProfile(cand.profileId);
  report(
    "F2 écriture refusée : demande toujours pending, CNI toujours vérifiée",
    mixedErr !== null &&
      (await readRequest(reqAtomic))?.status === "pending" &&
      afterMixed?.cni_verified === "verified" &&
      afterMixed.first_name === "Preuve",
    { mixedErr: mixedErr?.message, afterMixed: afterMixed?.cni_verified },
  );

  // F3 — demande admin « identity » : la modification passe, la CNI repasse
  // en revue, la demande est clôturée et is_verified retombe, en une écriture.
  const { error: unlockedErr } = await s
    .from("candidate_profiles")
    .update({ first_name: "Awa" })
    .eq("id", cand.profileId);
  const unlocked = await readProfile(cand.profileId);
  const reqAfter = await readRequest(reqAtomic);
  report(
    "F3 avec demande identity : modifié, CNI pending, demande done, is_verified false",
    !unlockedErr &&
      unlocked?.first_name === "Awa" &&
      unlocked.cni_verified === "pending" &&
      unlocked.cni_rejection_reason === null &&
      reqAfter?.status === "done" &&
      reqAfter.completed_at !== null &&
      (await isVerified(cand.id)) === false,
    { unlockedErr, cni: unlocked?.cni_verified, reqAfter },
  );
  report(
    "F3b MoMo vérifié conservé (aucune règle ne lie MoMo à l'identité), complétude = TS",
    unlocked?.momo_verified === true &&
      unlocked.profile_completion_pct === (await expectedPct(cand.profileId)),
    {
      momo: unlocked?.momo_verified,
      pct: unlocked?.profile_completion_pct,
    },
  );

  // F4 — une demande « cni_documents » ne déverrouille pas l'identité.
  const cand2 = await makeCandidate("f-cand2", { profile: VERIFIED_PROFILE });
  const s2 = await sessionFor(cand2.email);
  const reqDocs = await makeRequest(so, ops.id, cand2.profileId, [
    "cni_documents",
  ]);
  const { error: wrongGroupErr } = await s2
    .from("candidate_profiles")
    .update({ last_name: "Autre" })
    .eq("id", cand2.profileId);
  const afterWrong = await readProfile(cand2.profileId);
  report(
    "F4a demande cni_documents : identité refusée (field_locked), demande intacte",
    wrongGroupErr?.message === "field_locked" &&
      afterWrong?.last_name === "Lot2" &&
      afterWrong.cni_verified === "verified" &&
      (await readRequest(reqDocs))?.status === "pending",
    { wrongGroupErr: wrongGroupErr?.message, last: afterWrong?.last_name },
  );
  const { error: docErr } = await s2
    .from("candidate_profiles")
    .update({ cni_front_url: `${cand2.id}/nouveau.jpg` })
    .eq("id", cand2.profileId);
  const afterDoc = await readProfile(cand2.profileId);
  report(
    "F4b demande cni_documents : photo acceptée, CNI pending, demande done",
    !docErr &&
      afterDoc?.cni_front_url === `${cand2.id}/nouveau.jpg` &&
      afterDoc.cni_verified === "pending" &&
      (await readRequest(reqDocs))?.status === "done",
    { docErr, cni: afterDoc?.cni_verified },
  );

  // F5 — chemin MoMo légitime : la RPC réinitialise la vérification et
  // is_verified retombe dans la même transaction.
  const cand3 = await makeCandidate("f-cand3", { profile: VERIFIED_PROFILE });
  const s3 = await sessionFor(cand3.email);
  const { error: momoErr } = await callRpc(s3, "candidate_update_momo", {
    p_provider: "orange",
    p_number: "+237690000555",
    p_account_name: "Preuve Lot2",
  });
  const afterMomo = await readProfile(cand3.profileId);
  report(
    "F5 candidate_update_momo : numéro enregistré, vérification MoMo réinitialisée, is_verified false",
    !momoErr &&
      afterMomo?.momo_number === "+237690000555" &&
      afterMomo.momo_verified === false &&
      afterMomo.momo_name_match === false &&
      afterMomo.momo_verified_at === null &&
      (await isVerified(cand3.id)) === false &&
      afterMomo.profile_completion_pct === (await expectedPct(cand3.profileId)),
    { momoErr, afterMomo: afterMomo?.momo_verified },
  );

  // F6 — validation admin MoMo préservée (et is_verified recalculé).
  const { error: approveErr } = await callRpc(so, "apply_momo_verification", {
    p_profile_id: cand3.profileId,
    p_action: "approve",
    p_reject_reason: null,
  });
  const approved = await readProfile(cand3.profileId);
  report(
    "F6 apply_momo_verification (admin_ops) : MoMo vérifié, is_verified true, audit, complétude = TS",
    !approveErr &&
      approved?.momo_verified === true &&
      approved.momo_verified_by === ops.id &&
      (await isVerified(cand3.id)) === true &&
      (await auditCount("approve_momo", cand3.profileId)) === 1 &&
      approved.profile_completion_pct === (await expectedPct(cand3.profileId)),
    { approveErr, approved: approved?.momo_verified },
  );

  // F7 — correction d'identité par admin_founder préservée et tracée.
  const cand4 = await makeCandidate("f-cand4", { profile: VERIFIED_PROFILE });
  const sf = await sessionFor(founder.email);
  const { error: editErr } = await callRpc(
    sf,
    "admin_edit_candidate_identity",
    {
      p_user_id: cand4.id,
      p_first_name: "Corrige",
      p_last_name: "Lot2",
      p_date_of_birth: "1995-05-05",
    },
  );
  const edited = await readProfile(cand4.profileId);
  report(
    "F7 admin_edit_candidate_identity (admin_founder) : modifié, CNI pending, audit, is_verified false",
    !editErr &&
      edited?.first_name === "Corrige" &&
      edited.cni_verified === "pending" &&
      (await auditCount("admin_edit_identity", cand4.profileId)) === 1 &&
      (await isVerified(cand4.id)) === false,
    { editErr, edited: edited?.cni_verified },
  );

  // F8 — CNI non vérifiée : l'identité reste librement modifiable.
  const cand5 = await makeCandidate("f-cand5", {
    profile: { cni_verified: "pending" },
  });
  const s5 = await sessionFor(cand5.email);
  const { error: freeErr } = await s5
    .from("candidate_profiles")
    .update({ first_name: "Libre", date_of_birth: "1996-06-06" })
    .eq("id", cand5.profileId);
  const free = await readProfile(cand5.profileId);
  report(
    "F8 CNI pending : identité modifiable sans demande",
    !freeErr && free?.first_name === "Libre" && free.cni_verified === "pending",
    freeErr,
  );

  return { ops, founder, so };
}

// ─── G. Complétude : critère CNI ────────────────────────────────
async function cniCriterionDone(profileId: string): Promise<boolean> {
  const row = await readProfile(profileId);
  return (
    computeCandidateCriteria(
      row as CandidateProfileForCompletion,
      await skillCount(profileId),
    ).find((c) => c.key === "cni")?.done ?? false
  );
}

async function proveCniCompletion(
  ctx: Awaited<ReturnType<typeof proveVerificationLocks>>,
) {
  console.log("\n── G. Complétude : critère CNI ──");
  const sqlEqualsTs = async (id: string) =>
    (await readProfile(id))?.profile_completion_pct === (await expectedPct(id));

  // G1 — dossier soumis, avant approbation.
  const g = await makeCandidate("g-cand", {
    profile: {
      cni_verified: "pending",
      cni_front_url: "f",
      cni_back_url: "b",
      cni_selfie_url: "s",
    },
  });
  report(
    "G1 photos soumises, CNI pending : points CNI accordés, SQL = TS",
    (await cniCriterionDone(g.profileId)) && (await sqlEqualsTs(g.profileId)),
    await readProfile(g.profileId).then((r) => r?.profile_completion_pct),
  );

  // G2 — approbation par l'admin (RPC existante) puis purge des photos
  // (comme removeCniPhotos, en service_role) : les points restent.
  const { error: modErr } = await callRpc(ctx.so, "moderate_cni", {
    p_profile_id: g.profileId,
    p_action: "approve",
    p_reject_reason: null,
    p_expires_at: "2099-01-01",
  });
  const beforePurge = await readProfile(g.profileId);
  await svc
    .from("candidate_profiles")
    .update({ cni_front_url: null, cni_back_url: null, cni_selfie_url: null })
    .eq("id", g.profileId);
  const afterPurge = await readProfile(g.profileId);
  report(
    "G2 CNI vérifiée puis photos purgées : points conservés, SQL = TS",
    !modErr &&
      beforePurge?.cni_verified === "verified" &&
      afterPurge?.cni_front_url === null &&
      afterPurge.profile_completion_pct ===
        beforePurge.profile_completion_pct &&
      (await cniCriterionDone(g.profileId)) &&
      (await sqlEqualsTs(g.profileId)),
    {
      modErr,
      before: beforePurge?.profile_completion_pct,
      after: afterPurge?.profile_completion_pct,
    },
  );

  // G3 — CNI non vérifiée sans photos : aucun point.
  const g3 = await makeCandidate("g-cand3", {
    profile: { cni_verified: "pending" },
  });
  report(
    "G3 CNI pending sans photos : points CNI non accordés, SQL = TS",
    !(await cniCriterionDone(g3.profileId)) &&
      (await sqlEqualsTs(g3.profileId)),
    await readProfile(g3.profileId).then((r) => r?.profile_completion_pct),
  );

  // G4 — CNI refusée avec photos : critère documentaire existant conservé.
  const g4 = await makeCandidate("g-cand4", {
    profile: {
      cni_verified: "rejected",
      cni_front_url: "f",
      cni_back_url: "b",
      cni_selfie_url: "s",
    },
  });
  report(
    "G4 CNI rejected avec photos : critère documentaire conservé, SQL = TS",
    (await cniCriterionDone(g4.profileId)) && (await sqlEqualsTs(g4.profileId)),
    await readProfile(g4.profileId).then((r) => r?.profile_completion_pct),
  );

  // G5 — transition vérifiée → pending (identité modifiée sur demande) sans
  // photos : les points tombent.
  const sg = await sessionFor(g.email);
  await makeRequest(ctx.so, ctx.ops.id, g.profileId, ["identity"]);
  const pctVerified = (await readProfile(g.profileId))?.profile_completion_pct;
  const { error: g5Err } = await sg
    .from("candidate_profiles")
    .update({ last_name: "Renommee" })
    .eq("id", g.profileId);
  const g5 = await readProfile(g.profileId);
  report(
    "G5 vérifiée → pending sans photos : −15 points, SQL = TS",
    !g5Err &&
      g5?.cni_verified === "pending" &&
      g5.profile_completion_pct === (pctVerified ?? 0) - 15 &&
      (await sqlEqualsTs(g.profileId)),
    { g5Err, before: pctVerified, after: g5?.profile_completion_pct },
  );

  // G6 — seuil de 60 % appliqué par apply_to_job, CNI vérifiée sans photos.
  const company = await makeCompany("g-company");
  const job = await makeJob(company.companyId);
  const base: Partial<ProfileInsert> = {
    ...VERIFIED_PROFILE,
    profile_photo_url: null,
    bio: null,
  };
  const at55 = await makeCandidate("g-55", {
    profile: { ...base, max_travel_distance_km: null },
  });
  const at60 = await makeCandidate("g-60", {
    profile: { ...base, momo_verified: false },
  });
  const r55 = await applyRpc(await sessionFor(at55.email), job);
  report(
    "G6a 55 % (identité, CNI vérifiée, compétences, MoMo) : profile_incomplete, aucune ligne",
    (await readProfile(at55.profileId))?.profile_completion_pct === 55 &&
      r55.error?.message === "profile_incomplete" &&
      (await applicationsFor(job, at55.profileId)).length === 0,
    { pct: (await readProfile(at55.profileId))?.profile_completion_pct, r55 },
  );
  const r60 = await applyRpc(await sessionFor(at60.email), job);
  report(
    "G6b 60 % (identité, CNI vérifiée, compétences, rayon) : candidature créée",
    (await readProfile(at60.profileId))?.profile_completion_pct === 60 &&
      !r60.error &&
      (await applicationsFor(job, at60.profileId)).length === 1,
    { pct: (await readProfile(at60.profileId))?.profile_completion_pct, r60 },
  );

  // G7 — table liée : une compétence de plus ne réécrit pas un profil dont
  // la valeur ne change pas ; le retrait de toutes les compétences, si.
  const beforeSkill = await readProfile(at60.profileId);
  await svc.from("candidate_skills").insert({
    candidate_id: at60.profileId,
    skill_name: "Accueil",
    skill_level: 3,
  });
  const afterSkill = await readProfile(at60.profileId);
  report(
    "G7a compétence ajoutée sans effet sur la complétude : profil non réécrit",
    afterSkill?.updated_at === beforeSkill?.updated_at &&
      afterSkill?.profile_completion_pct === 60,
    { before: beforeSkill?.updated_at, after: afterSkill?.updated_at },
  );
  await svc
    .from("candidate_skills")
    .delete()
    .eq("candidate_id", at60.profileId);
  report(
    "G7b toutes les compétences retirées : complétude recalculée (45 %), SQL = TS",
    (await readProfile(at60.profileId))?.profile_completion_pct === 45 &&
      (await sqlEqualsTs(at60.profileId)),
    (await readProfile(at60.profileId))?.profile_completion_pct,
  );
}

// ─── E. Route Next /api/jobs/[id]/apply ─────────────────────────
async function sessionCookies(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(API_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (entries) =>
        entries.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name),
        ),
    },
    auth: { autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`cookies ${email}: ${error.message}`);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function callRoute(
  method: "POST" | "DELETE",
  jobId: string,
  cookie: string,
) {
  const res = await fetch(`${APP_URL}/api/jobs/${jobId}/apply`, {
    method,
    headers: { Cookie: cookie },
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null,
  };
}

async function proveRoute(ctx: Awaited<ReturnType<typeof proveApplications>>) {
  console.log(`\n── E. Route ${APP_URL}/api/jobs/[id]/apply ──`);
  const job = await makeJob(ctx.coA.companyId);
  const cand = await makeCandidate("e-cand");
  const cookie = await sessionCookies(cand.email);

  const r1 = await callRoute("POST", job, cookie);
  const rows1 = await applicationsFor(job, cand.profileId);
  report(
    "E1 POST valide → 200, ligne pending persistée sur CETTE pile",
    r1.status === 200 &&
      r1.body?.success === true &&
      rows1.length === 1 &&
      rows1[0].status === "pending",
    { r1, rows: rows1.length },
  );
  const r2 = await callRoute("POST", job, cookie);
  report(
    "E2 POST répété → 400, toujours une ligne",
    r2.status === 400 &&
      (await applicationsFor(job, cand.profileId)).length === 1,
    r2,
  );
  const r3 = await callRoute("DELETE", job, cookie);
  report(
    "E3 DELETE → 200, statut withdrawn persisté",
    r3.status === 200 &&
      (await applicationsFor(job, cand.profileId))[0]?.status === "withdrawn",
    r3,
  );
  const beforeRepeat = (await applicationsFor(job, cand.profileId))[0];
  const r4 = await callRoute("DELETE", job, cookie);
  const afterRepeat = (await applicationsFor(job, cand.profileId))[0];
  report(
    "E4 DELETE répété → 200, ligne withdrawn non réécrite",
    r4.status === 200 &&
      afterRepeat?.status === "withdrawn" &&
      afterRepeat.updated_at === beforeRepeat?.updated_at,
    { r4, beforeRepeat, afterRepeat },
  );
  const r5 = await callRoute("DELETE", crypto.randomUUID(), cookie);
  report(
    "E5 DELETE sans candidature → 404 (plus de faux succès)",
    r5.status === 404,
    r5,
  );

  const r6 = await callRoute(
    "POST",
    job,
    await sessionCookies(ctx.suspended.email),
  );
  report(
    "E6 POST compte suspendu → 403 account_suspended",
    r6.status === 403 && r6.body?.code === "account_suspended",
    r6,
  );
  const r7 = await callRoute(
    "POST",
    job,
    await sessionCookies(ctx.unverified.email),
  );
  report(
    "E7 POST profil non vérifié → 403 profile_not_verified + missing",
    r7.status === 403 &&
      r7.body?.code === "profile_not_verified" &&
      Array.isArray(r7.body?.missing),
    r7,
  );
  const r8 = await callRoute("POST", ctx.jobLicense, cookie);
  report(
    "E8 POST permis requis → 403 avec le message existant",
    r8.status === 403 &&
      r8.body?.error ===
        "Cette offre exige un permis de conduire valide pour postuler.",
    r8,
  );
  const r9 = await callRoute("POST", "pas-un-uuid", cookie);
  report("E9 POST identifiant invalide → 404", r9.status === 404, r9);
  const r10 = await fetch(`${APP_URL}/api/jobs/${job}/apply`, {
    method: "POST",
  });
  report("E10 POST sans session → 401", r10.status === 401, r10.status);
}

// ─── H. Routes profil (chemins applicatifs légitimes, F-35) ─────
async function callApp(
  method: "PUT" | "POST",
  path: string,
  cookie: string,
  body: Record<string, unknown> | FormData,
) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: isForm
      ? { Cookie: cookie }
      : { Cookie: cookie, "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null,
  };
}

/** En-tête PNG minimal : suffit à la détection par octets de la route. */
function pngForm(field: string): FormData {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = new FormData();
  form.append("field", field);
  form.append("file", new File([bytes], "cni.png", { type: "image/png" }));
  return form;
}

async function proveProfileRoutes(
  ctx: Awaited<ReturnType<typeof proveVerificationLocks>>,
) {
  console.log(`\n── H. Routes profil ${APP_URL} ──`);
  const opsCookie = await sessionCookies(ctx.ops.email);
  const identity = {
    first_name: "Preuve",
    last_name: "Renomme",
    date_of_birth: "1995-05-05",
    city: "Douala",
  };

  const cand = await makeCandidate("h-cand", { profile: VERIFIED_PROFILE });
  const cookie = await sessionCookies(cand.email);
  const h1 = await callApp("PUT", "/api/profile/identity", cookie, identity);
  report(
    "H1 PUT identity sur CNI vérifiée sans demande → 403 field_locked, inchangé",
    h1.status === 403 &&
      h1.body?.code === "field_locked" &&
      (await readProfile(cand.profileId))?.last_name === "Lot2",
    h1,
  );

  const h2req = await callApp(
    "POST",
    "/api/admin/profile-update-requests",
    opsCookie,
    {
      candidate_id: cand.profileId,
      fields: ["identity"],
      reason: "Preuve lot 2 : nom à corriger",
    },
  );
  const h2 = await callApp("PUT", "/api/profile/identity", cookie, identity);
  const afterH2 = await readProfile(cand.profileId);
  const { data: reqs } = await svc
    .from("profile_update_requests")
    .select("status")
    .eq("candidate_id", cand.profileId);
  report(
    "H2 demande admin (route) puis PUT identity → 200, CNI pending, demande done, is_verified false",
    h2req.status < 300 &&
      h2.status === 200 &&
      h2.body?.requiresReverification === true &&
      afterH2?.last_name === "Renomme" &&
      afterH2.cni_verified === "pending" &&
      (reqs ?? []).every((r) => r.status === "done") &&
      (await isVerified(cand.id)) === false,
    { h2req, h2, cni: afterH2?.cni_verified, reqs },
  );

  const candM = await makeCandidate("h-momo", { profile: VERIFIED_PROFILE });
  const cookieM = await sessionCookies(candM.email);
  const h3 = await callApp("PUT", "/api/profile/payment", cookieM, {
    momo_provider: "mtn",
    momo_number: "670000321",
  });
  const afterH3 = await readProfile(candM.profileId);
  report(
    "H3 PUT payment → 200, numéro enregistré, vérification MoMo réinitialisée, is_verified false",
    h3.status === 200 &&
      afterH3?.momo_number === "670000321" &&
      afterH3.momo_verified === false &&
      (await isVerified(candM.id)) === false,
    { h3, momo: afterH3?.momo_verified },
  );

  const candD = await makeCandidate("h-doc", { profile: VERIFIED_PROFILE });
  const cookieD = await sessionCookies(candD.email);
  const h4 = await callApp(
    "POST",
    "/api/profile/documents",
    cookieD,
    pngForm("cni_front_url"),
  );
  report(
    "H4a POST documents CNI vérifiée sans demande → 403 field_locked, inchangé",
    h4.status === 403 &&
      h4.body?.code === "field_locked" &&
      (await readProfile(candD.profileId))?.cni_front_url === null,
    h4,
  );
  const reqD = await makeRequest(ctx.so, ctx.ops.id, candD.profileId, [
    "cni_documents",
  ]);
  const h4b = await callApp(
    "POST",
    "/api/profile/documents",
    cookieD,
    pngForm("cni_front_url"),
  );
  const afterH4 = await readProfile(candD.profileId);
  report(
    "H4b avec demande cni_documents → 200, photo enregistrée, CNI pending, demande done",
    h4b.status === 200 &&
      !!afterH4?.cni_front_url?.startsWith(`${candD.id}/`) &&
      afterH4.cni_verified === "pending" &&
      (await readRequest(reqD))?.status === "done",
    { h4b, cni: afterH4?.cni_verified },
  );
  if (afterH4?.cni_front_url)
    await svc.storage
      .from("candidate-documents")
      .remove([afterH4.cni_front_url]);
}

async function main() {
  console.log(`Preuve lot 2 — ${API_URL}`);
  await proveProfiles();
  const ctx = await proveApplications();
  await proveSubscriptions();
  await proveOtpCodes();
  const locks = await proveVerificationLocks();
  await proveCniCompletion(locks);
  if (process.argv.includes("--skip-route")) {
    console.log("\n(sections E et H ignorées : --skip-route)");
  } else {
    await proveRoute(ctx);
    await proveProfileRoutes(locks);
  }
}

async function cleanup() {
  // job_applications.selected_by et profile_update_requests.requested_by
  // référencent users sans ON DELETE : sans cette étape, les comptes
  // entreprise et admin concernés ne peuvent pas être supprimés.
  if (createdIds.length > 0) {
    await svc.from("job_applications").delete().in("selected_by", createdIds);
    await svc
      .from("profile_update_requests")
      .delete()
      .in("requested_by", createdIds);
  }
  for (const id of createdIds) {
    await svc.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

main()
  .catch((err) => {
    failCount += 1;
    console.error("ERREUR", err);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${passCount} PASS / ${failCount} FAIL`);
    if (failCount > 0) process.exitCode = 1;
  });
