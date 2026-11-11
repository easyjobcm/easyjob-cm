/**
 * Preuve lot 9c — réputation EasyJob en étoiles (candidats et entreprises).
 *
 * Méthode :
 *   1. Fixtures en service role. Les missions « d'historique » sont posées
 *      directement (offre, sélection, mission, code consommé) ; les missions
 *      observées passent par les vraies routes (candidature, sélection,
 *      début, code de fin, évaluation).
 *   2. Tentatives en sessions RÉELLES (cookies @supabase/ssr vers
 *      l'application, JWT vers PostgREST, WebSocket Realtime). La clé
 *      service ne sert qu'aux fixtures, aux décisions « de confiance »
 *      (approbation d'un document, manquement confirmé simulé, tâche
 *      planifiée) et aux relectures.
 *   3. Assertions :
 *      N. 8 → 10 missions confirmées : ½ étoile gagnée à la 10e, une seule
 *         notification et une seule variation ; rien à la 9e.
 *      T. Deux onglets, reconnexion : une variation n'est acquittée qu'une fois.
 *      O. Offre à deux candidats : comptée une fois, quand tout est résolu.
 *      R. Avis : gain, baisse, motifs exigés côté serveur, plafonds à chaque
 *         événement, avis brut jamais exposé.
 *      C. Contestation : support puis décision ops, audit, recalcul
 *         déterministe (événement ancien), notification.
 *      P. Tiers : étoiles seules (RPC, vue, API, PostgREST, Realtime).
 *      L. Permis expiré avec et sans autre justificatif, échéance sans
 *         visite (tâche planifiée idempotente, utilisateur déconnecté),
 *         renouvellement en attente puis approuvé, diplôme sans échéance.
 *      I. CNI : rappels J−30, J−7 et à l'expiration (dédupliqués, privés),
 *         sans effet sur la complétude ni la réputation. Lot 9d : toute
 *         nouvelle candidature exige une CNI en cours de validité (route et
 *         RPC, offre avec ou sans document), limite exacte (valide à
 *         00:00:00 UTC du jour d'échéance, expirée juste après) ;
 *         renouvellement par le parcours produit (photos déverrouillées,
 *         étoiles conservées), refus maintenu en attente, complément
 *         demandé, approbation avec une date valide ; tâches et point
 *         rouge (CNI, justificatif mémorisé après un refus).
 *      V. Mauvais avis (FR et EN) : ½ étoile perdue avec deux motifs et un
 *         commentaire identifiable, texte exact reçu, ni commentaire ni
 *         auteur côté utilisateur, avis complet pour l'admin, notification
 *         unique après reconnexion, relances après perte de réponse.
 *      B. Manquements (producteur futur simulé) : la base applique une
 *         décision confirmée sans aucun seuil de délai ni de remplissage
 *         (conditions à arbitrer), intégrité des faits, plancher, correction
 *         du support, trois décisions entreprise en 90 jours → un retrait.
 *      E. Profil entreprise (critères de computeCompanyCriteria), abonnement
 *         sans effet, écritures et fonctions internes fermées.
 *   4. Nettoyage : comptes marqués proofReputation9c.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import {
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { approveCompanyDossier } from "./lib/verified-company";
import { appFetch } from "./lib/app-fetch";
import {
  parseActionTasks,
  pendingActionCount,
  type MissionTaskState,
} from "@/lib/tasks/candidate-tasks";
import { runSupabaseQuery } from "./lib/db-query";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L9c-stars-01!";
const PROOF_USER_METADATA = { proofReputation9c: true };

const service: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

function execSql(sql: string) {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "reputation" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
}

// ─── Sessions ────────────────────────────────────────────────────
type Session = { client: DB; cookie: string };

async function realSession(email: string): Promise<Session> {
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
  const cookie = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  return { client, cookie };
}

async function rtClient(email: string): Promise<DB> {
  const client: DB = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (error) throw new Error(`signIn rt(${email}) : ${error.message}`);
  await client.realtime.setAuth();
  return client;
}

type Heard = { events: Record<string, unknown>[]; close: () => Promise<void> };

async function listen(
  client: DB,
  topic: string,
): Promise<{ ok: true; h: Heard } | { ok: false; error: string }> {
  const events: Record<string, unknown>[] = [];
  const ch = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "*" }, (m) => {
      events.push((m.payload ?? {}) as Record<string, unknown>);
    });
  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      void client.removeChannel(ch);
      resolve({ ok: false, error: "timeout" });
    }, 10_000);
    ch.subscribe((status, err) => {
      if (settled) return;
      if (status === "SUBSCRIBED") {
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: true,
          h: {
            events,
            close: async () => void (await client.removeChannel(ch)),
          },
        });
      } else if (status === "CHANNEL_ERROR") {
        settled = true;
        clearTimeout(timer);
        void client.removeChannel(ch);
        resolve({ ok: false, error: err?.message ?? "channel_error" });
      }
    });
  });
}

async function waitFor(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

// ─── Asserts ─────────────────────────────────────────────────────
let passCount = 0;
/** Statut I5 (candidature avec CNI expirée), rappelé en synthèse. */
let observedExpiredCniApply: number | null = null;
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

// ─── Fixtures ────────────────────────────────────────────────────
async function createAccount(
  email: string,
  role: Role,
  locale: "fr" | "en" = "fr",
): Promise<string> {
  const { data: created, error } = await service.auth.admin.createUser({
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
  const { error: rowErr } = await service.from("users").insert({
    id,
    email,
    phone:
      role === "candidate"
        ? `+2376995${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
        : null,
    role,
    is_verified: role === "candidate",
    phone_verified: true,
    is_active: true,
    locale,
  });
  if (rowErr) throw new Error(`users insert: ${rowErr.message}`);
  return id;
}

async function createCompany(
  userId: string,
  name: string,
  complete = true,
): Promise<string> {
  const { data, error } = await service
    .from("company_profiles")
    .insert({
      user_id: userId,
      company_name: name,
      city: "Douala",
      address: complete ? "Rue de la preuve" : null,
      sector: "Hôtellerie",
      description: "Entreprise de preuve du lot 9c, profil détaillé.",
      logo_url: complete ? `${userId}/logo.png` : null,
      niu: complete ? `M9C${String(Date.now()).slice(-9)}${name.length}` : null,
      contact_name: complete ? "Contact Preuve" : null,
      contact_phone: complete ? "+237699009009" : null,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
      onboarding_status: "completed",
      verification_status: "verified",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  // Lot 11 : offre visible et ouverte aux candidatures seulement si le
  // dossier de l'entreprise est complet et contrôlé (fixture fictive). Profil
  // incomplet : non touché (le critère « RCCM ou NIU » compte dans les étoiles).
  if (complete) await approveCompanyDossier(service, data.id);
  return data.id;
}

async function createCandidate(userId: string, firstName: string) {
  const { data, error } = await service
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: "Étoile",
      date_of_birth: "1996-04-20",
      city: "Douala",
      address: "Ndokoti",
      latitude: 4.0611,
      longitude: 9.7429,
      bio: "Candidat de preuve du lot 9c.",
      profile_photo_url: `${userId}/photo.jpg`,
      max_travel_distance_km: 15,
      cni_number: `CNI9C${firstName}`,
      cni_verified: "verified",
      cni_expires_at: "2032-01-01",
      momo_provider: "mtn",
      momo_number: "+237677009009",
      momo_verified: true,
      onboarding_status: "completed",
      onboarding_step: 6,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`candidate insert: ${error?.message}`);
  const { error: skillErr } = await service
    .from("candidate_skills")
    .insert({ candidate_id: data.id, skill_name: "Service" });
  if (skillErr) throw new Error(`skill insert: ${skillErr.message}`);
  return data.id;
}

async function cleanAccounts(ids: string[]) {
  if (ids.length === 0) return;
  const { data: companies } = await service
    .from("company_profiles")
    .select("id")
    .in("user_id", ids);
  const companyIds = (companies ?? []).map((c) => c.id);
  const { data: cands } = await service
    .from("candidate_profiles")
    .select("id")
    .in("user_id", ids);
  const candIds = (cands ?? []).map((c) => c.id);
  if (companyIds.length > 0) {
    const { data: jobs } = await service
      .from("jobs")
      .select("id")
      .in("company_id", companyIds);
    const jobIds = (jobs ?? []).map((j) => j.id);
    for (let i = 0; i < jobIds.length; i += 100) {
      const chunk = jobIds.slice(i, i + 100);
      await service.from("contracts").delete().in("job_id", chunk);
      await service.from("missions").delete().in("job_id", chunk);
      await service.from("job_applications").delete().in("job_id", chunk);
      await service.from("jobs").delete().in("id", chunk);
    }
  }
  if (candIds.length > 0) {
    await service.from("missions").delete().in("candidate_id", candIds);
    await service
      .from("candidate_documents")
      .delete()
      .in("candidate_id", candIds);
  }
  await service.from("candidate_profiles").delete().in("user_id", ids);
  await service.from("notifications").delete().in("user_id", ids);
  await service.from("company_profiles").delete().in("user_id", ids);
  await service.from("audit_logs").delete().in("actor_id", ids);
  await service.from("users").delete().in("id", ids);
  for (const id of ids) {
    await service.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  const { data: page } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofReputation9c === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
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
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

const douala = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(d);

type Score = Database["public"]["Tables"]["reputation_scores"]["Row"];

async function score(
  type: "candidate" | "company",
  id: string,
): Promise<Score> {
  const { data, error } = await service
    .from("reputation_scores")
    .select("*")
    .eq("subject_type", type)
    .eq("subject_id", id)
    .single();
  if (error || !data) throw new Error(`score ${type} ${id}: ${error?.message}`);
  return data;
}

async function changesOf(userId: string) {
  return (
    (
      await service
        .from("reputation_changes")
        .select("*")
        .eq("user_id", userId)
        .order("created_at")
    ).data ?? []
  );
}

async function reputationNotifications(userId: string) {
  const { data } = await service
    .from("notifications")
    .select("id, title, body, data, created_at")
    .eq("user_id", userId)
    .order("created_at");
  return (data ?? []).filter(
    (n) => (n.data as { kind?: string } | null)?.kind === "reputation",
  );
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();
  // Exécution précédente interrompue (base coupée, délai dépassé) : son
  // `finally` n'a pas pu s'exécuter. Restes retirés et protections
  // réactivées AVANT toute assertion (lot 10).
  execSql(
    "alter table public.candidate_documents enable trigger trg_reputation_candidate_documents",
  );
  const suffix = Date.now();
  const mail = (k: string) => `l9c-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  const closers: (() => Promise<void>)[] = [];

  try {
    // Entreprises : A (parcours réels), F (historique), B (tierce), G (profil).
    const uA = await createAccount(mail("a"), "company");
    const uF = await createAccount(mail("f"), "company");
    const uB = await createAccount(mail("b"), "company");
    const uG = await createAccount(mail("g"), "company", "en");
    const uK = await createAccount(mail("k"), "candidate");
    const uR = await createAccount(mail("r"), "candidate");
    const uL = await createAccount(mail("l"), "candidate");
    const uM1 = await createAccount(mail("m1"), "candidate");
    const uM2 = await createAccount(mail("m2"), "candidate");
    const uSup = await createAccount(mail("sup"), "admin_support");
    const uOps = await createAccount(mail("ops"), "admin_ops");
    ids.push(uA, uF, uB, uG, uK, uR, uL, uM1, uM2, uSup, uOps);

    const coA = await createCompany(uA, "Restaurant A");
    const coF = await createCompany(uF, "Historique F");
    await createCompany(uB, "Hôtel B");
    const coG = await createCompany(uG, "Profil G", false);
    const cK = await createCandidate(uK, "Kevin");
    const cR = await createCandidate(uR, "Rita");
    const cL = await createCandidate(uL, "Lea");
    const cM1 = await createCandidate(uM1, "Max");
    await createCandidate(uM2, "Mia");

    const [A, F, B, K, R, M1, M2, Sup, Ops] = await Promise.all(
      ["a", "f", "b", "k", "r", "m1", "m2", "sup", "ops"].map((k) =>
        realSession(mail(k)),
      ),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const today = douala(new Date());

    let jobSeq = 0;
    async function seedJob(
      company: string,
      opts: { status?: "active" | "filled"; positions?: number } = {},
    ): Promise<string> {
      jobSeq += 1;
      const { data, error } = await service
        .from("jobs")
        .insert({
          title: `Mission preuve L9c ${jobSeq}`,
          description: "Preuve du lot 9c.",
          address: "Boulevard de la Liberté",
          city: "Douala",
          start_date: today,
          start_time: "00:00",
          end_time: "23:59",
          mission_pay_per_candidate: 2000,
          company_id: company,
          status: opts.status ?? "active",
          positions_available: opts.positions ?? 1,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id;
    }

    /** Historique : mission sélectionnée, commencée, code consommé. */
    async function seedMission(
      company: string,
      candidate: string,
      confirmed: boolean,
    ): Promise<string> {
      const jobId = await seedJob(company, { status: "filled" });
      const { data: app, error: appErr } = await service
        .from("job_applications")
        .insert({ job_id: jobId, candidate_id: candidate, status: "selected" })
        .select("id")
        .single();
      if (appErr || !app) throw new Error(`app seed: ${appErr?.message}`);
      const { data: m, error: mErr } = await service
        .from("missions")
        .insert({
          job_id: jobId,
          candidate_id: candidate,
          application_id: app.id,
          scheduled_date: today,
          scheduled_start_time: "00:00",
          scheduled_end_time: "23:59",
          status: "confirmed",
          contract_type: "simple",
        })
        .select("id")
        .single();
      if (mErr || !m) throw new Error(`mission seed: ${mErr?.message}`);
      if (!confirmed) return m.id;
      const at = new Date().toISOString();
      await service
        .from("missions")
        .update({ actual_start_time: at, status: "in_progress" })
        .eq("id", m.id);
      await service
        .from("mission_completion_codes")
        .update({ consumed_at: at })
        .eq("mission_id", m.id);
      const { error: endErr } = await service
        .from("missions")
        .update({ actual_end_time: at, status: "completed" })
        .eq("id", m.id);
      if (endErr) throw new Error(`mission end: ${endErr.message}`);
      return m.id;
    }

    /** Parcours réel : candidature, sélection, début, code de fin. */
    async function applyAndSelect(
      cand: Session,
      company: Session,
      jobId: string,
    ): Promise<string> {
      const { data: app, error } = await cand.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !app) throw new Error(`apply: ${error?.message}`);
      const sel = await http(
        "POST",
        `/api/applications/${app.id}/select`,
        company.cookie,
      );
      const missionId = (
        sel.body.selection as { mission_id?: string } | undefined
      )?.mission_id;
      if (sel.status !== 200 || !missionId) {
        throw new Error(`select: HTTP ${sel.status} ${sel.text.slice(0, 200)}`);
      }
      return missionId;
    }
    async function confirmByCode(cand: Session, missionId: string) {
      const st = await http(
        "POST",
        `/api/missions/${missionId}/start`,
        cand.cookie,
      );
      if (st.status !== 200)
        throw new Error(`start: ${st.status} ${st.text.slice(0, 200)}`);
      const code = (
        await service
          .from("mission_completion_codes")
          .select("code")
          .eq("mission_id", missionId)
          .single()
      ).data!.code;
      const done = await http(
        "POST",
        `/api/missions/${missionId}/complete`,
        cand.cookie,
        {
          code,
        },
      );
      if (done.status !== 200) {
        throw new Error(`complete: ${done.status} ${done.text.slice(0, 200)}`);
      }
    }
    const review = (
      s: Session | null,
      missionId: string,
      body: Record<string, unknown>,
    ) =>
      http(
        "POST",
        `/api/missions/${missionId}/review`,
        s?.cookie ?? null,
        body,
      );

    // ══ N. 8 → 10 missions confirmées ═══════════════════════════════
    for (let i = 0; i < 8; i++) await seedMission(coF, cK, true);
    const k8 = await score("candidate", cK);
    const k8Changes = (await changesOf(uK)).length;
    const k8Notifs = (await reputationNotifications(uK)).length;
    const meK = await http("GET", "/api/reputation", K.cookie);
    const repK = meK.body.reputation as {
      stars: number;
      experience: { units: number };
    } | null;
    report(
      "N1 8 missions confirmées par code : 8 unités, ½ étoile d'expérience, 1½ au total (profil 1) ; lecture privée identique",
      k8.experience_units === 8 &&
        Number(k8.experience_stars) === 0.5 &&
        Number(k8.stars) === 1.5 &&
        meK.status === 200 &&
        Number(repK?.stars) === 1.5 &&
        repK?.experience.units === 8,
      { units: k8.experience_units, stars: k8.stars, api: repK?.stars },
    );

    const job9 = await seedJob(coA);
    const m9 = await applyAndSelect(K, A, job9);
    await confirmByCode(K, m9);
    const k9 = await score("candidate", cK);
    report(
      "N2 9e mission (routes réelles) : 9 unités, aucune variation ni notification de réputation",
      k9.experience_units === 9 &&
        Number(k9.stars) === 1.5 &&
        (await changesOf(uK)).length === k8Changes &&
        (await reputationNotifications(uK)).length === k8Notifs,
      { units: k9.experience_units },
    );

    const job10 = await seedJob(coA);
    const m10 = await applyAndSelect(K, A, job10);
    await confirmByCode(K, m10);
    const k10 = await score("candidate", cK);
    const kChanges = (await changesOf(uK)).slice(k8Changes);
    const kNotifs = (await reputationNotifications(uK)).slice(k8Notifs);
    const kProfile = (
      await service
        .from("candidate_profiles")
        .select("completed_missions")
        .eq("id", cK)
        .single()
    ).data;
    report(
      "N3 10e mission : 1 étoile d'expérience, 2 étoiles au total ; une variation (gain, cause mission) et une notification durable liées",
      k10.experience_units === 10 &&
        Number(k10.stars) === 2 &&
        kChanges.length === 1 &&
        kChanges[0].direction === "gain" &&
        kChanges[0].cause === "mission" &&
        Number(kChanges[0].from_stars) === 1.5 &&
        Number(kChanges[0].to_stars) === 2 &&
        kNotifs.length === 1 &&
        kNotifs[0].id === kChanges[0].notification_id &&
        kNotifs[0].title === "Félicitations : 2 étoiles",
      { changes: kChanges.length, notifs: kNotifs.map((n) => n.title) },
    );
    report(
      "N4 completed_missions réparé depuis les missions confirmées par code (10)",
      kProfile?.completed_missions === 10,
      kProfile,
    );

    // ══ T. Deux onglets, reconnexion ════════════════════════════════
    const changeId = kChanges[0]?.id;
    const tabA = await realSession(mail("k"));
    const tabB = await realSession(mail("k"));
    const [ackA, ackB] = await Promise.all([
      http("POST", "/api/reputation/acknowledge", tabA.cookie, {
        ids: [changeId],
      }),
      http("POST", "/api/reputation/acknowledge", tabB.cookie, {
        ids: [changeId],
      }),
    ]);
    const gotA = (ackA.body.acknowledged as string[] | undefined) ?? [];
    const gotB = (ackB.body.acknowledged as string[] | undefined) ?? [];
    report(
      "T1 deux onglets acquittent la même variation en même temps : un seul l'obtient (une seule animation)",
      ackA.status === 200 &&
        ackB.status === 200 &&
        gotA.length + gotB.length === 1,
      { a: gotA.length, b: gotB.length },
    );
    const again = await http("POST", "/api/reputation/acknowledge", K.cookie, {
      ids: [changeId],
    });
    const afterAck = await http("GET", "/api/reputation", K.cookie);
    report(
      "T2 reconnexion : variation déjà acquittée, ni renvoyée ni rejouée",
      ((again.body.acknowledged as string[]) ?? []).length === 0 &&
        !(
          (afterAck.body.reputation as { pending_changes: { id: string }[] })
            .pending_changes ?? []
        ).some((c) => c.id === changeId),
    );
    const foreignAck = await http(
      "POST",
      "/api/reputation/acknowledge",
      R.cookie,
      {
        ids: [changeId],
      },
    );
    report(
      "T3 un autre compte ne peut pas acquitter la variation (aucun effet)",
      ((foreignAck.body.acknowledged as string[]) ?? []).length === 0,
    );

    // ══ O. Offre à plusieurs candidats comptée une fois ═════════════
    const aBefore = await score("company", coA);
    const jobPair = await seedJob(coA, { positions: 2 });
    const mp1 = await applyAndSelect(M1, A, jobPair);
    const mp2 = await applyAndSelect(M2, A, jobPair);
    await confirmByCode(M1, mp1);
    const aMid = await score("company", coA);
    await confirmByCode(M2, mp2);
    const aAfter = await score("company", coA);
    report(
      "O1 offre à 2 places : non comptée tant qu'une sélection n'est pas résolue, puis +1 unité (pas +2)",
      aMid.experience_units === aBefore.experience_units &&
        aAfter.experience_units === aBefore.experience_units + 1 &&
        aAfter.confirmed_count === aBefore.confirmed_count + 1,
      {
        before: aBefore.experience_units,
        mid: aMid.experience_units,
        after: aAfter.experience_units,
      },
    );

    // ══ R. Avis ═════════════════════════════════════════════════════
    const rMissions: string[] = [];
    for (let i = 0; i < 21; i++)
      rMissions.push(await seedMission(coF, cR, true));
    const r0 = await score("candidate", cR);
    report(
      "R0 plafond d'expérience : 21 missions confirmées → solde 20, 2 étoiles ; total 3",
      r0.experience_units === 20 &&
        r0.confirmed_count === 21 &&
        Number(r0.stars) === 3,
      { units: r0.experience_units, stars: r0.stars },
    );

    // Écoute Realtime du candidat évalué pendant les avis.
    const rtR = await rtClient(mail("r"));
    const heardR = await listen(rtR, `user:${uR}`);
    if (heardR.ok) closers.push(heardR.h.close);
    const rtB = await rtClient(mail("b"));
    const spyB = await listen(rtB, `user:${uR}`);
    if (spyB.ok) closers.push(spyB.h.close);
    report(
      "P1 Realtime : une entreprise tierce ne peut pas rejoindre le canal du candidat",
      heardR.ok && !spyB.ok,
      { own: heardR.ok, third: spyB.ok ? "joined" : spyB.error },
    );

    const rChanges0 = (await changesOf(uR)).length;
    for (let i = 0; i < 5; i++) {
      const res = await review(F, rMissions[i], { rating: 5 });
      if (res.status !== 200)
        throw new Error(`review: ${res.status} ${res.text}`);
    }
    const r1 = await score("candidate", cR);
    const rGain = (await changesOf(uR)).slice(rChanges0);
    report(
      "R1 cinq avis de 5 (route entreprise) : ½ étoile d'avis, 3½ ; une variation gain cause review",
      r1.review_units === 5 &&
        Number(r1.stars) === 3.5 &&
        rGain.length === 1 &&
        rGain[0].cause === "review" &&
        rGain[0].direction === "gain",
      { units: r1.review_units, stars: r1.stars, changes: rGain.length },
    );
    if (heardR.ok) {
      const got = await waitFor(() =>
        heardR.h.events.some((e) => e.d === "reputation" && e.r === cR),
      );
      const keysOk = heardR.h.events.every((e) =>
        // « id » : identifiant technique du message ajouté par Realtime.
        Object.keys(e).every((k) => k === "d" || k === "r" || k === "id"),
      );
      report(
        "P2 Realtime : signal { d: reputation, r: profil } reçu par le titulaire, sans autre champ (ni note, ni motif, ni commentaire)",
        got && keysOk,
        { events: heardR.h.events.slice(-3) },
      );
    }

    const noReason = await review(F, rMissions[5], { rating: 1 });
    const rpcNoReason = await F.client.rpc("submit_mission_review", {
      p_mission_id: rMissions[5],
      p_rating: 1,
    });
    const wrongSide = await review(F, rMissions[5], {
      rating: 1,
      reasons: ["unsafe"],
    });
    const highWithReason = await review(F, rMissions[5], {
      rating: 5,
      reasons: ["late"],
    });
    report(
      "R2 note < 3 sans motif refusée (route 400 et RPC directe), motif de l'autre partie refusé par la base, motif sur une note de 5 refusé",
      noReason.status === 400 &&
        noReason.body.code === "reasons_required" &&
        rpcNoReason.error?.message === "reasons_required" &&
        wrongSide.status === 400 &&
        wrongSide.body.code === "reasons_invalid" &&
        highWithReason.status === 400,
      {
        route: noReason.body.code,
        rpc: rpcNoReason.error?.message,
        side: wrongSide.body.code,
        high: highWithReason.status,
      },
    );

    const PRIVATE_COMMENT = "Commentaire privé preuve 9c";
    const bad = await review(F, rMissions[5], {
      rating: 1,
      reasons: ["late", "poor_quality"],
      comment: PRIVATE_COMMENT,
    });
    const badReviewId = (bad.body.review as { review_id?: string } | undefined)
      ?.review_id;
    const r2 = await score("candidate", cR);
    const rLoss = (await changesOf(uR)).slice(rChanges0 + 1);
    const rLossNotif = (await reputationNotifications(uR)).at(-1);
    report(
      "R3 avis de 1 avec motifs : −5 (solde 0), 3 étoiles ; variation loss avec les seuls motifs",
      bad.status === 200 &&
        r2.review_units === 0 &&
        Number(r2.stars) === 3 &&
        rLoss.length === 1 &&
        rLoss[0].direction === "loss" &&
        JSON.stringify((rLoss[0].details as { reasons?: string[] }).reasons) ===
          JSON.stringify(["late", "poor_quality"]) &&
        !JSON.stringify(rLoss[0].details).includes(PRIVATE_COMMENT),
      { units: r2.review_units, details: rLoss[0]?.details },
    );
    report(
      "R4 notification de baisse : résume les motifs (« retard, travail non conforme »), sans commentaire ni auteur",
      !!rLossNotif &&
        rLossNotif.body.includes("retard, travail non conforme") &&
        !rLossNotif.body.includes(PRIVATE_COMMENT) &&
        !rLossNotif.body.includes("Historique F") &&
        !JSON.stringify(rLossNotif.data).includes(PRIVATE_COMMENT),
      { body: rLossNotif?.body },
    );
    const bodyResponse = JSON.stringify(bad.body);
    report(
      "R5 réponse de la route d'évaluation : ni motifs ni commentaire",
      !bodyResponse.includes(PRIVATE_COMMENT) &&
        !bodyResponse.includes("poor_quality"),
    );

    // Plafond à chaque événement : 11 avis positifs (historique), 1 neutre,
    // puis un avis de 2 par la route : 10 − 5 = 5 (et non 11 − 5 = 6).
    for (let i = 6; i < 17; i++) {
      const { error } = await service.from("reviews").insert({
        mission_id: rMissions[i],
        reviewer_type: "company",
        reviewer_id: coF,
        reviewed_type: "candidate",
        reviewed_id: cR,
        overall_rating: 4,
        origin: "mission_flow",
      });
      if (error) throw new Error(`review seed: ${error.message}`);
    }
    const r3 = await score("candidate", cR);
    await review(F, rMissions[17], { rating: 3 });
    const r4 = await score("candidate", cR);
    const bad2 = await review(F, rMissions[18], {
      rating: 2,
      reasons: ["behavior"],
    });
    const bad2Id = (bad2.body.review as { review_id?: string } | undefined)
      ?.review_id;
    const r5 = await score("candidate", cR);
    report(
      "R6 plafond des avis appliqué à chaque événement : 11 avis positifs → 10 (1 étoile), un 3 neutre, puis un 2 → 5 (½)",
      r3.review_units === 10 &&
        Number(r3.review_stars) === 1 &&
        r4.review_units === 10 &&
        r5.review_units === 5 &&
        Number(r5.review_stars) === 0.5,
      {
        afterPositives: r3.review_units,
        neutral: r4.review_units,
        after: r5.review_units,
      },
    );

    // ══ P. Tiers : étoiles seules ═══════════════════════════════════
    const jobR = await seedJob(coA, { positions: 3 });
    const { error: applyR } = await R.client.rpc("apply_to_job", {
      p_job_id: jobR,
    });
    const { data: applicants, error: applicantsErr } = await A.client.rpc(
      "company_job_applicants",
      { p_job_id: jobR },
    );
    const rowR = (applicants ?? [])[0] as Record<string, unknown> | undefined;
    const allowedKeys = [
      "application_id",
      "status",
      "match_score",
      "distance_km",
      "rejection_reason",
      "created_at",
      "first_name",
      "last_initial",
      "has_photo",
      "reputation_stars",
      "skills",
    ];
    report(
      "P3 candidats vus par l'entreprise : étoiles seules (ni moyenne, ni nombre d'avis, ni missions, ni motifs, ni commentaire)",
      !applyR &&
        !applicantsErr &&
        !!rowR &&
        Object.keys(rowR).sort().join() === [...allowedKeys].sort().join() &&
        Number(rowR.reputation_stars) === Number(r5.stars) &&
        !JSON.stringify(applicants).includes(PRIVATE_COMMENT),
      { keys: rowR ? Object.keys(rowR) : null, stars: rowR?.reputation_stars },
    );

    const detail = await http("GET", `/api/jobs/${jobR}`, R.cookie);
    const company = (
      detail.body.job as { company?: Record<string, unknown> } | undefined
    )?.company;
    const aScore = await score("company", coA);
    report(
      "P4 détail d'offre (candidat) : étoiles de l'entreprise seules, sans moyenne",
      detail.status === 200 &&
        !!company &&
        Number(company.reputation_stars) === Number(aScore.stars) &&
        !("average_rating" in company),
      { company },
    );

    const directReads = await Promise.all([
      anon.from("reviews").select("id").limit(1),
      B.client.from("reviews").select("id").limit(1),
      K.client.from("reviews").select("id").limit(1),
      F.client.from("reviews").select("id").limit(1),
      anon.from("company_public_profiles").select("average_rating").limit(1),
      A.client
        .from("candidate_profiles")
        .select("average_rating, review_count")
        .eq("id", cR),
      A.client.from("reputation_scores").select("*").eq("subject_id", cR),
      A.client.from("reputation_changes").select("*").eq("subject_id", cR),
      anon.from("reputation_scores").select("*").limit(1),
    ]);
    const [
      rvAnon,
      rvB,
      rvK,
      rvAuthor,
      viewAvg,
      candRead,
      scoresRead,
      changesRead,
      anonScores,
    ] = directReads;
    report(
      "P5 lecture directe Supabase fermée : avis (anonyme, tiers, autre candidat, auteur), moyenne de la vue, profil et réputation d'un tiers",
      !!rvAnon.error &&
        !!rvB.error &&
        !!rvK.error &&
        !!rvAuthor.error &&
        !!viewAvg.error &&
        (candRead.data ?? []).length === 0 &&
        (scoresRead.data ?? []).length === 0 &&
        (changesRead.data ?? []).length === 0 &&
        (!!anonScores.error || (anonScores.data ?? []).length === 0),
      {
        reviews: [
          rvAnon.error?.code,
          rvB.error?.code,
          rvK.error?.code,
          rvAuthor.error?.code,
        ],
        view: viewAvg.error?.code,
      },
    );
    const own = await R.client
      .from("reputation_scores")
      .select("stars")
      .eq("subject_id", cR);
    report(
      "P6 le titulaire lit sa propre projection",
      (own.data ?? []).length === 1,
    );

    const missionView = await http(
      "GET",
      `/api/missions/${rMissions[5]}`,
      R.cookie,
    );
    const companyMissions = await http(
      "GET",
      `/api/jobs/${jobR}/missions`,
      A.cookie,
    );
    report(
      "P7 réponses de mission (candidat évalué, entreprise) : ni commentaire ni motifs",
      missionView.status === 200 &&
        !missionView.text.includes(PRIVATE_COMMENT) &&
        !missionView.text.includes("poor_quality") &&
        !companyMissions.text.includes(PRIVATE_COMMENT),
      { mission: missionView.status, company: companyMissions.status },
    );

    // ══ C. Contestation ═════════════════════════════════════════════
    const adminUrl = `/api/admin/reputation/candidate/${cR}`;
    const thirdAdmin = await http("GET", adminUrl, B.cookie);
    const candAdmin = await http("GET", adminUrl, R.cookie);
    const supView = await http("GET", adminUrl, Sup.cookie);
    const supReviews =
      (supView.body.reviews as {
        id: string;
        comment: string | null;
        reasons: string[];
        author: { name: string | null };
        mission: { job_title: string | null } | null;
        impact: { admissible: boolean; applied: number } | null;
      }[]) ?? [];
    const badView = supReviews.find((r) => r.id === badReviewId);
    report(
      "C1 fiche admin (admin_support) : avis complet (auteur, mission, motifs, commentaire, impact) ; tiers et candidat refusés",
      thirdAdmin.status === 403 &&
        candAdmin.status === 403 &&
        supView.status === 200 &&
        badView?.comment === PRIVATE_COMMENT &&
        badView.author.name === "Historique F" &&
        !!badView.mission?.job_title &&
        JSON.stringify(badView.reasons) ===
          JSON.stringify(["late", "poor_quality"]) &&
        badView.impact?.admissible === true &&
        badView.impact.applied === -5,
      {
        third: thirdAdmin.status,
        cand: candAdmin.status,
        impact: badView?.impact,
      },
    );

    const open = await http("POST", adminUrl, Sup.cookie, {
      action: "open",
      review_id: badReviewId,
      note: "Contestation reçue par courriel le 09/11 : retard justifié.",
    });
    const supResolve = await http("POST", adminUrl, Sup.cookie, {
      action: "resolve",
      review_id: badReviewId,
      outcome: "upheld",
      note: "Tentative du support",
    });
    const directContest = await R.client.from("disputes").insert({
      mission_id: rMissions[5],
      opened_by: uR,
      type: "review_contest",
      description: "Contestation directe",
      review_id: badReviewId,
    });
    const { data: dispute } = await service
      .from("disputes")
      .select("*")
      .eq("review_id", badReviewId!)
      .single();
    const ownContest = await R.client
      .from("disputes")
      .select("id")
      .eq("review_id", badReviewId!);
    const reviewerContest = await F.client
      .from("disputes")
      .select("id")
      .eq("review_id", badReviewId!);
    report(
      "C2 contestation rattachée par le support (litige review_contest, ouvert au nom du candidat) ; décision refusée à admin_support ; insertion directe refusée ; visible du candidat, pas de l'auteur",
      open.status === 200 &&
        supResolve.status === 403 &&
        !!directContest.error &&
        dispute?.type === "review_contest" &&
        dispute.opened_by === uR &&
        dispute.status === "open" &&
        (ownContest.data ?? []).length === 1 &&
        (reviewerContest.data ?? []).length === 0,
      {
        open: open.status,
        sup: supResolve.status,
        direct: directContest.error?.code,
      },
    );

    const rBeforeContest = await score("candidate", cR);
    const rChangesBefore = (await changesOf(uR)).length;
    const decide = await http("POST", adminUrl, Ops.cookie, {
      action: "resolve",
      review_id: badReviewId,
      outcome: "upheld",
      note: "Retard justifié par le candidat.",
    });
    const rAfterOld = await score("candidate", cR);
    report(
      "C3 événement ancien invalidé (ops) : recalcul déterministe par rejeu — solde 5 inchangé (un ajout naïf de +5 donnerait 10), aucune variation",
      decide.status === 200 &&
        rAfterOld.review_units === 5 &&
        rBeforeContest.review_units === 5 &&
        (await changesOf(uR)).length === rChangesBefore,
      { before: rBeforeContest.review_units, after: rAfterOld.review_units },
    );
    const reDecide = await http("POST", adminUrl, Ops.cookie, {
      action: "resolve",
      review_id: badReviewId,
      outcome: "rejected",
      note: "Second avis",
    });
    const { data: audits } = await service
      .from("audit_logs")
      .select("action, actor_id, metadata")
      .eq("resource_id", badReviewId!)
      .order("created_at");
    report(
      "C4 décision définitive (second essai 409) et tracée : ouverture par le support, décision par ops, étoiles avant et après",
      reDecide.status === 409 &&
        (audits ?? []).length === 2 &&
        audits![0].action === "open_review_contest" &&
        audits![0].actor_id === uSup &&
        audits![1].action === "resolve_review_contest" &&
        audits![1].actor_id === uOps &&
        (audits![1].metadata as { outcome?: string }).outcome === "upheld",
      { audits: audits?.map((a) => a.action) },
    );

    await http("POST", adminUrl, Sup.cookie, {
      action: "open",
      review_id: bad2Id,
      note: "Contestation reçue au téléphone.",
    });
    await http("POST", adminUrl, Ops.cookie, {
      action: "resolve",
      review_id: bad2Id,
      outcome: "upheld",
      note: "Comportement non établi.",
    });
    const rAfter = await score("candidate", cR);
    const rContestChange = (await changesOf(uR)).at(-1);
    const { data: contestNotifs } = await service
      .from("notifications")
      .select("title, data")
      .eq("user_id", uR)
      .order("created_at");
    const decisions = (contestNotifs ?? []).filter(
      (n) => (n.data as { kind?: string }).kind === "review_contest",
    );
    report(
      "C5 avis récent invalidé : solde 10, 1 étoile d'avis, +½ (gain cause contest) ; le candidat est notifié de chaque décision",
      rAfter.review_units === 10 &&
        Number(rAfter.stars) === Number(rAfterOld.stars) + 0.5 &&
        rContestChange?.cause === "contest" &&
        rContestChange.direction === "gain" &&
        decisions.length === 2,
      {
        units: rAfter.review_units,
        cause: rContestChange?.cause,
        decisions: decisions.length,
      },
    );

    // ══ L. Permis, échéance, renouvellement ═════════════════════════
    const future = douala(new Date(Date.now() + 10 * 86_400_000));
    const docL1 = (
      await service
        .from("candidate_documents")
        .insert({
          candidate_id: cL,
          document_type: "permis_conduire",
          title: "Permis B preuve",
          license_category: "voiture",
          expires_at: future,
          status: "verified",
          storage_path: `${uL}/permis-1.pdf`,
        })
        .select("id")
        .single()
    ).data!.id;
    const diploma = (
      await service
        .from("candidate_documents")
        .insert({
          candidate_id: cL,
          document_type: "diplome",
          title: "Diplôme hôtellerie",
          status: "verified",
          storage_path: `${uL}/diplome.pdf`,
        })
        .select("id")
        .single()
    ).data!.id;
    const attestation = (
      await service
        .from("candidate_documents")
        .insert({
          candidate_id: cL,
          document_type: "attestation_travail",
          title: "Attestation service",
          status: "verified",
          expires_at: future,
          storage_path: `${uL}/attestation.pdf`,
        })
        .select("id")
        .single()
    ).data!.id;
    const driving = (
      await service
        .from("candidate_skills")
        .insert({ candidate_id: cL, skill_name: "Conduite voiture" })
        .select("id")
        .single()
    ).data!.id;
    const serviceSkill = (
      await service
        .from("candidate_skills")
        .select("id")
        .eq("candidate_id", cL)
        .eq("skill_name", "Service")
        .single()
    ).data!.id;
    await service.from("candidate_skill_documents").insert([
      { candidate_skill_id: driving, candidate_document_id: docL1 },
      { candidate_skill_id: serviceSkill, candidate_document_id: diploma },
      { candidate_skill_id: serviceSkill, candidate_document_id: attestation },
    ]);
    const l0 = await score("candidate", cL);
    report(
      "L1 deux compétences vérifiées (permis valide ; diplôme sans échéance + attestation : comptée une fois) → 1 étoile",
      l0.skill_count === 2 &&
        Number(l0.skill_stars) === 1 &&
        !!l0.next_expiry_at,
      { skills: l0.skill_count, next: l0.next_expiry_at },
    );

    // Rappel J−30 : permis et attestation à J+10, un seul envoi chacun.
    await service.rpc("reputation_expiry_sweep");
    await service.rpc("reputation_expiry_sweep");
    const { data: remind } = await service
      .from("notifications")
      .select("body, data")
      .eq("user_id", uL)
      .eq("notification_type", "document_status");
    const stage30 = (remind ?? []).filter(
      (n) => (n.data as { stage?: string }).stage === "30d",
    );
    report(
      "L1b rappel J−30 des justificatifs approuvés : un par document, sans doublon après une seconde exécution",
      stage30.length === 2 &&
        stage30.some((n) => n.body.includes("Permis B preuve")),
      { bodies: stage30.map((n) => n.body) },
    );

    // L postule chez A pour que l'entreprise lise ses étoiles.
    const Ls = await realSession(mail("l"));
    const jobL = await seedJob(coA, { positions: 3 });
    await Ls.client.rpc("apply_to_job", { p_job_id: jobL });
    await Ls.client.auth.signOut();

    // Le temps passe : l'échéance du permis et de l'attestation est
    // atteinte sans aucun recalcul (trigger de réputation des documents
    // suspendu le temps de reculer la date, réactivé dans tous les cas),
    // utilisateur déconnecté.
    const yesterday = douala(new Date(Date.now() - 86_400_000));
    execSql(
      "alter table public.candidate_documents disable trigger trg_reputation_candidate_documents",
    );
    try {
      const { error } = await service
        .from("candidate_documents")
        .update({ expires_at: yesterday })
        .in("id", [docL1, attestation]);
      if (error) throw new Error(`expiry backdate: ${error.message}`);
      // Projection calculée quand le permis était encore valide : son
      // échéance mémorisée est celle du document (00:00 UTC du jour).
      const { error: nextErr } = await service
        .from("reputation_scores")
        .update({ next_expiry_at: `${yesterday}T00:00:00Z` })
        .eq("subject_type", "candidate")
        .eq("subject_id", cL);
      if (nextErr) throw new Error(`next expiry: ${nextErr.message}`);
    } finally {
      execSql(
        "alter table public.candidate_documents enable trigger trg_reputation_candidate_documents",
      );
    }
    const lStored = await score("candidate", cL);
    const { data: lApplicants } = await A.client.rpc("company_job_applicants", {
      p_job_id: jobL,
    });
    report(
      "L2 à l'échéance, avant la tâche planifiée et sans visite : l'entreprise lit déjà le score corrigé (projection encore ancienne)",
      Number(lStored.stars) === Number(l0.stars) &&
        Number(lApplicants?.[0]?.reputation_stars) === Number(l0.stars) - 0.5,
      { stored: lStored.stars, read: lApplicants?.[0]?.reputation_stars },
    );

    const lNotifs0 = (await reputationNotifications(uL)).length;
    const sweep1 = await service.rpc("reputation_expiry_sweep");
    const lAfter = await score("candidate", cL);
    const lChange = (await changesOf(uL)).at(-1);
    const lNotif = (await reputationNotifications(uL)).at(-1);
    report(
      "L3 permis expiré, aucun autre permis valide : la compétence de conduite ne compte plus (l'attestation, expirée aussi, ne la remplacerait pas) ; diplôme sans échéance conservé",
      !sweep1.error &&
        lAfter.skill_count === 1 &&
        Number(lAfter.stars) === Number(l0.stars) - 0.5,
      { error: sweep1.error?.message, skills: lAfter.skill_count },
    );
    report(
      "L4 tâche planifiée : variation loss cause document_expired et notification persistante proposant le renouvellement",
      lChange?.cause === "document_expired" &&
        lChange.direction === "loss" &&
        (await reputationNotifications(uL)).length === lNotifs0 + 1 &&
        !!lNotif &&
        lNotif.body.includes("Permis B preuve") &&
        lNotif.body.includes("Renouvelez") &&
        (lNotif.data as { href?: string }).href === "/profile/skills",
      { body: lNotif?.body, details: lChange?.details },
    );
    const sweep2 = await service.rpc("reputation_expiry_sweep");
    const { data: allLNotifs } = await service
      .from("notifications")
      .select("id, data")
      .eq("user_id", uL);
    const expiredDocNotifs = (allLNotifs ?? []).filter(
      (n) => (n.data as { stage?: string }).stage === "expired",
    );
    report(
      "L5 tâche relancée : idempotente (aucune variation ni notification de plus, pas de second avis « justificatif expiré »)",
      !sweep2.error &&
        (await reputationNotifications(uL)).length === lNotifs0 + 1 &&
        (await changesOf(uL)).at(-1)?.id === lChange?.id &&
        expiredDocNotifs.length === 0,
      { expiredDoc: expiredDocNotifs.length },
    );

    const Lback = await realSession(mail("l"));
    const lMe = await http("GET", "/api/reputation", Lback.cookie);
    const lPending = (
      lMe.body.reputation as {
        pending_changes: { id: string; cause: string }[];
      }
    ).pending_changes;
    report(
      "L6 reconnexion après la baisse : variation en attente d'animation, avec la cause",
      lPending.some(
        (c) => c.id === lChange?.id && c.cause === "document_expired",
      ),
      { pending: lPending.map((c) => c.cause) },
    );

    // Attestation valide liée à la compétence de conduite : sans permis
    // valide, la compétence reste exclue.
    const attestation2 = (
      await service
        .from("candidate_documents")
        .insert({
          candidate_id: cL,
          document_type: "attestation_formation",
          title: "Formation conduite",
          status: "verified",
          storage_path: `${uL}/formation.pdf`,
        })
        .select("id")
        .single()
    ).data!.id;
    await service.from("candidate_skill_documents").insert({
      candidate_skill_id: driving,
      candidate_document_id: attestation2,
    });
    const lAtt = await score("candidate", cL);
    const renewal = (
      await service
        .from("candidate_documents")
        .insert({
          candidate_id: cL,
          document_type: "permis_conduire",
          title: "Permis B renouvelé",
          license_category: "voiture",
          expires_at: "2031-06-30",
          status: "pending",
          storage_path: `${uL}/permis-2.pdf`,
        })
        .select("id")
        .single()
    ).data!.id;
    await service
      .from("candidate_skill_documents")
      .insert({ candidate_skill_id: driving, candidate_document_id: renewal });
    const lPendingRenewal = await score("candidate", cL);
    const lChangesBefore = (await changesOf(uL)).length;
    await service
      .from("candidate_documents")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("id", renewal);
    const lRenewed = await score("candidate", cL);
    const lRenewChange = (await changesOf(uL)).at(-1);
    report(
      "L7 permis expiré + attestation valide : non compté (règle du permis) ; renouvellement en attente : non compté",
      lAtt.skill_count === 1 && lPendingRenewal.skill_count === 1,
      { attestation: lAtt.skill_count, pending: lPendingRenewal.skill_count },
    );
    report(
      "L8 renouvellement approuvé (autre permis valide) : compétence de nouveau comptée, gain notifié (cause skill)",
      lRenewed.skill_count === 2 &&
        Number(lRenewed.stars) === Number(l0.stars) &&
        (await changesOf(uL)).length === lChangesBefore + 1 &&
        lRenewChange?.cause === "skill" &&
        lRenewChange.direction === "gain",
      { skills: lRenewed.skill_count, cause: lRenewChange?.cause },
    );

    // ══ I. Échéance de la CNI ═══════════════════════════════════════
    // Dates posées à la création (trigger protect_cni_verification : la
    // date n'est modifiable qu'en easyjob.system_update, comme moderate_cni).
    const cniCandidate = async (
      key: string,
      expires: string | null,
      status: "verified" | "pending" | "rejected" = "verified",
    ) => {
      const uid = await createAccount(mail(key), "candidate");
      ids.push(uid);
      const { data, error } = await service
        .from("candidate_profiles")
        .insert({
          user_id: uid,
          first_name: `Cni${key}`,
          last_name: "Étoile",
          date_of_birth: "1996-04-20",
          city: "Douala",
          address: "Ndokoti",
          latitude: 4.0611,
          longitude: 9.7429,
          bio: "Candidat de preuve du lot 9c.",
          profile_photo_url: `${uid}/photo.jpg`,
          max_travel_distance_km: 15,
          cni_number: `CNI9C${key}`,
          cni_verified: status,
          cni_expires_at: expires,
          ...(status === "verified"
            ? {}
            : {
                cni_front_url: `${uid}/f.png`,
                cni_back_url: `${uid}/b.png`,
                cni_selfie_url: `${uid}/s.png`,
              }),
          momo_provider: "mtn",
          momo_number: "+237677009009",
          momo_verified: true,
          onboarding_status: "completed",
          onboarding_step: 6,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`cni candidate: ${error?.message}`);
      await service
        .from("candidate_skills")
        .insert({ candidate_id: data.id, skill_name: "Service" });
      return { uid, pid: data.id };
    };
    const day = (n: number) => douala(new Date(Date.now() + n * 86_400_000));
    const i30 = await cniCandidate("i30", day(10));
    const i7 = await cniCandidate("i7", day(5));
    const ix = await cniCandidate("ix", day(-1));
    const cniNotifs = async (uid: string) =>
      (
        (
          await service
            .from("notifications")
            .select("title, body, data")
            .eq("user_id", uid)
            .eq("notification_type", "document_status")
        ).data ?? []
      ).filter((n) => (n.data as { document?: string }).document === "cni");
    const repBefore = await Promise.all(
      [i30, i7, ix].map((c) => score("candidate", c.pid)),
    );
    await service.rpc("reputation_expiry_sweep");
    await service.rpc("reputation_expiry_sweep");
    const [n30, n7, nx] = await Promise.all(
      [i30, i7, ix].map((c) => cniNotifs(c.uid)),
    );
    const stage = (l: { data: unknown }[]) =>
      l.map((n) => (n.data as { stage?: string }).stage);
    report(
      "I1 CNI : rappel J−30, J−7 et à l'expiration, un seul chacun après deux passages, au seul titulaire",
      JSON.stringify(stage(n30)) === '["30d"]' &&
        JSON.stringify(stage(n7)) === '["7d"]' &&
        JSON.stringify(stage(nx)) === '["expired"]' &&
        nx[0].body ===
          "Votre CNI a expiré. Soumettez votre nouvelle CNI depuis votre profil." &&
        (nx[0].data as { href?: string }).href === "/profile/candidate/edit",
      { j30: stage(n30), j7: stage(n7), expired: stage(nx), body: nx[0]?.body },
    );
    const { data: foreignCni } = await service
      .from("notifications")
      .select("user_id, data")
      .in("user_id", [uK, uR, uL, uA, uF]);
    report(
      "I2 aucun rappel CNI chez les autres comptes de la preuve (CNI à 2032)",
      !(foreignCni ?? []).some(
        (n) => (n.data as { document?: string }).document === "cni",
      ),
    );

    const repAfter = await Promise.all(
      [i30, i7, ix].map((c) => score("candidate", c.pid)),
    );
    const completion = (
      await service
        .from("candidate_profiles")
        .select("id, profile_completion_pct")
        .in("id", [i30.pid, ix.pid])
    ).data;
    const { data: cniChanges } = await service
      .from("reputation_changes")
      .select("id")
      .in("user_id", [i30.uid, i7.uid, ix.uid])
      .neq("cause", "profile");
    report(
      "I3 CNI expirée sans effet sur la complétude (100 %, critère « CNI vérifiée ») ni sur la réputation (mêmes étoiles qu'une CNI valide, aucune unité de compétence, aucune variation)",
      (completion ?? []).every((c) => c.profile_completion_pct === 100) &&
        Number(repAfter[2].stars) === Number(repAfter[0].stars) &&
        repAfter.every(
          (r, i) =>
            Number(r.stars) === Number(repBefore[i].stars) &&
            r.skill_count === 0 &&
            r.next_expiry_at === null,
        ) &&
        (cniChanges ?? []).length === 0,
      {
        completion: completion?.map((c) => c.profile_completion_pct),
        stars: repAfter.map((r) => r.stars),
        skills: repAfter.map((r) => r.skill_count),
      },
    );

    const IX = await realSession(mail("ix"));
    const jobPlain = await seedJob(coA, { positions: 3 });
    const jobCni = await seedJob(coA, { positions: 3 });
    const jobDoc = await seedJob(coA, { positions: 3 });
    await service
      .from("jobs")
      .update({ required_documents: ["cni"] })
      .eq("id", jobCni);
    await service
      .from("jobs")
      .update({ required_documents: ["casier_judiciaire"] })
      .eq("id", jobDoc);
    const appsOf = async (job: string, pid: string) =>
      (
        await service
          .from("job_applications")
          .select("id")
          .eq("job_id", job)
          .eq("candidate_id", pid)
      ).data?.length ?? -1;
    /** Appel direct de la RPC en session (PostgREST, JWT du candidat). */
    const rpcApply = async (s: Session, job: string) => {
      const r = await s.client.rpc("apply_to_job", { p_job_id: job });
      let state: unknown = null;
      try {
        state = (JSON.parse(r.error?.details ?? "null") as { state?: unknown })
          ?.state;
      } catch {
        state = null;
      }
      return { status: r.status, message: r.error?.message ?? null, state };
    };
    /** Tâches lues par la route, comme l'onglet Tâches et son point. */
    const tasksOf = async (cookie: string) => {
      const r = await http("GET", "/api/tasks", cookie);
      const body = r.body as {
        missions?: MissionTaskState[];
        actions?: unknown;
      };
      const actions = parseActionTasks(body.actions);
      return {
        status: r.status,
        actions,
        cni: actions.find((a) => a.key === "cni") ?? null,
        // Le point rouge de la barre d'onglets compte ces mêmes données
        // (pendingActionCount, lot 9d), demandes de mise à jour en plus.
        pending: pendingActionCount(
          { missions: body.missions ?? [], actions, updateRequests: [] },
          Date.now(),
        ),
      };
    };
    const uploadCni = async (cookie: string) => {
      const statuses: number[] = [];
      for (const field of ["cni_front_url", "cni_back_url", "cni_selfie_url"]) {
        const bytes = new Uint8Array(64);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const form = new FormData();
        form.append("field", field);
        form.append(
          "file",
          new File([bytes], "cni.png", { type: "image/png" }),
        );
        const res = await appFetch(`${APP_URL}/api/profile/documents`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: form,
        });
        statuses.push(res.status);
      }
      return statuses;
    };
    const cniRow = async (pid: string) =>
      (
        await service
          .from("candidate_profiles")
          .select(
            "cni_verified, cni_expires_at, cni_front_url, profile_completion_pct",
          )
          .eq("id", pid)
          .single()
      ).data;

    // Décision produit du lot 9d : une CNI expirée refuse toute nouvelle
    // candidature, avant les justificatifs exigés par l'offre.
    const applyCni = await http("POST", `/api/jobs/${jobCni}/apply`, IX.cookie);
    report(
      "I4 CNI expirée, offre qui exige la CNI : 403 cni_expired (état expired) avant les justificatifs, aucune ligne",
      applyCni.status === 403 &&
        applyCni.body.code === "cni_expired" &&
        applyCni.body.state === "expired" &&
        (await appsOf(jobCni, ix.pid)) === 0,
      applyCni.body,
    );
    const applyPlain = await http(
      "POST",
      `/api/jobs/${jobPlain}/apply`,
      IX.cookie,
    );
    const rpcPlain = await rpcApply(IX, jobPlain);
    report(
      "I5 CNI expirée, offre SANS document requis : refus par la route (403 cni_expired, état expired) et par appel direct à la RPC (HTTP 403, cni_expired), aucune candidature",
      applyPlain.status === 403 &&
        applyPlain.body.code === "cni_expired" &&
        applyPlain.body.state === "expired" &&
        rpcPlain.status === 403 &&
        rpcPlain.message === "cni_expired" &&
        rpcPlain.state === "expired" &&
        (await appsOf(jobPlain, ix.pid)) === 0,
      { route: applyPlain.body, rpc: rpcPlain },
    );
    observedExpiredCniApply = applyPlain.status;

    // Tâches : CNI à renouveler, et un justificatif mémorisé pour une offre
    // (RPC appelée par la route après un refus documentaire).
    const { data: ixBlocker } = await IX.client.rpc(
      "record_application_blocker",
      { p_job_id: jobDoc },
    );
    const t0 = await tasksOf(IX.cookie);
    const t0doc = t0.actions.find(
      (a) => a.key === "document:casier_judiciaire:",
    );
    report(
      "I7 tâches : CNI expirée (action « renouveler », échéance), justificatif exigé par l'offre (offre listée) ; 2 actions en attente → point rouge",
      t0.status === 200 &&
        t0.cni?.kind === "cni" &&
        t0.cni.state === "expired" &&
        t0.cni.action_required &&
        t0.cni.expires_at === day(-1) &&
        (ixBlocker as { state?: string } | null)?.state === "missing" &&
        t0doc?.kind === "document" &&
        t0doc.action_required &&
        t0doc.jobs.some((j) => j.id === jobDoc) &&
        t0.pending === 2,
      { cni: t0.cni, doc: t0doc, pending: t0.pending },
    );

    // Renouvellement par le parcours produit : photos d'une CNI vérifiée
    // expirée déverrouillées (identité toujours verrouillée), étoiles et
    // complétude conservées.
    const repBeforeRenewal = await score("candidate", ix.pid);
    const changesBeforeRenewal = (await changesOf(ix.uid)).length;
    const heardIx = await listen(await rtClient(mail("ix")), `user:${ix.uid}`);
    if (heardIx.ok) closers.push(heardIx.h.close);
    // Avant l'envoi : l'identité d'une CNI vérifiée (même expirée) reste
    // verrouillée en base, sans demande admin.
    const identityLocked = await IX.client
      .from("candidate_profiles")
      .update({ first_name: "Autre" })
      .eq("id", ix.pid);
    const uploads = await uploadCni(IX.cookie);
    const afterUpload = await cniRow(ix.pid);
    const t1 = await tasksOf(IX.cookie);
    const heardProfile =
      heardIx.ok &&
      (await waitFor(() =>
        heardIx.h.events.some((e) => (e as { d?: string }).d === "profile"),
      ));
    report(
      "I8 renouvellement : 3 photos acceptées (CNI expirée déverrouillée), identité toujours verrouillée, CNI en attente, date d'échéance inchangée, complétude et étoiles conservées, signal Realtime « profile »",
      uploads.every((s) => s === 200) &&
        identityLocked.error?.message === "field_locked" &&
        afterUpload?.cni_verified === "pending" &&
        afterUpload.cni_expires_at === day(-1) &&
        afterUpload.profile_completion_pct === 100 &&
        Number((await score("candidate", ix.pid)).stars) ===
          Number(repBeforeRenewal.stars) &&
        (await changesOf(ix.uid)).length === changesBeforeRenewal &&
        heardProfile,
      { uploads, identity: identityLocked.error?.message, row: afterUpload },
    );
    const renewPlain = await http(
      "POST",
      `/api/jobs/${jobPlain}/apply`,
      IX.cookie,
    );
    const renewRpc = await rpcApply(IX, jobPlain);
    report(
      "I9 renouvellement en attente : refus maintenu (route et RPC, état renewal_pending) ; la tâche CNI reste visible en suivi sans compter comme action, le justificatif garde le point allumé",
      renewPlain.status === 403 &&
        renewPlain.body.state === "renewal_pending" &&
        renewRpc.message === "cni_expired" &&
        renewRpc.state === "renewal_pending" &&
        (await appsOf(jobPlain, ix.pid)) === 0 &&
        t1.cni?.state === "renewal_pending" &&
        !t1.cni.action_required &&
        t1.pending === 1,
      {
        route: renewPlain.body,
        rpc: renewRpc,
        cni: t1.cni,
        pending: t1.pending,
      },
    );

    // Complément demandé : refus de la nouvelle pièce par un admin_ops.
    const OPS = await realSession(mail("ops"));
    const rejectRenewal = await http("POST", "/api/admin/cni", OPS.cookie, {
      profile_id: ix.pid,
      action: "reject",
      rejection_reason: "Photo du verso illisible",
    });
    const t2 = await tasksOf(IX.cookie);
    const rejectedApply = await http(
      "POST",
      `/api/jobs/${jobPlain}/apply`,
      IX.cookie,
    );
    report(
      "I10 complément demandé (renouvellement refusé) : la tâche CNI redevient une action avec le motif ; refus renewal_rejected",
      rejectRenewal.status === 200 &&
        t2.cni?.state === "renewal_rejected" &&
        t2.cni.action_required &&
        t2.cni.reason === "Photo du verso illisible" &&
        t2.pending === 2 &&
        rejectedApply.status === 403 &&
        rejectedApply.body.state === "renewal_rejected",
      { cni: t2.cni, pending: t2.pending, apply: rejectedApply.body },
    );

    // Nouvelle pièce, puis approbation : sans date (défaut 1996 + 10 ans,
    // passé) ou avec une date passée, refusée ; avec la date de la pièce,
    // acceptée et l'accès reprend.
    const reUploads = await uploadCni(IX.cookie);
    const approveNoDate = await http("POST", "/api/admin/cni", OPS.cookie, {
      profile_id: ix.pid,
      action: "approve",
    });
    const approve = await http("POST", "/api/admin/cni", OPS.cookie, {
      profile_id: ix.pid,
      action: "approve",
      expires_at: day(400),
    });
    const t3 = await tasksOf(IX.cookie);
    const approvedRow = await cniRow(ix.pid);
    report(
      "I11 approbation : refusée sans date valide (400 expiry_invalid), acceptée avec la date de la nouvelle pièce ; plus de tâche CNI, le justificatif restant garde le point",
      reUploads.every((s) => s === 200) &&
        approveNoDate.status === 400 &&
        approveNoDate.body.code === "expiry_invalid" &&
        approve.status === 200 &&
        approvedRow?.cni_verified === "verified" &&
        approvedRow.cni_expires_at === day(400) &&
        approvedRow.profile_completion_pct === 100 &&
        t3.cni === null &&
        t3.pending === 1,
      {
        noDate: approveNoDate.body.code,
        approve: approve.status,
        row: approvedRow,
        pending: t3.pending,
      },
    );

    // Renouvellement approuvé : une seule ligne de suivi, date mise à jour,
    // rappels remis à zéro, aucun nouvel avis tant que la date est lointaine.
    await service.rpc("reputation_expiry_sweep");
    const { data: ixRow } = await service
      .from("document_expirations")
      .select("expires_at, notified_30d, notified_7d, notified_expired")
      .eq("candidate_id", ix.pid)
      .eq("document_type", "cni");
    const reApply = await http("POST", `/api/jobs/${jobCni}/apply`, IX.cookie);
    const rePlain = await http(
      "POST",
      `/api/jobs/${jobPlain}/apply`,
      IX.cookie,
    );
    report(
      "I6 CNI renouvelée : une seule ligne de suivi, date mise à jour, rappels remis à zéro sans nouvel avis ; candidatures acceptées (offre qui exige la CNI et offre sans document), étoiles conservées",
      (ixRow ?? []).length === 1 &&
        ixRow![0].expires_at === day(400) &&
        !ixRow![0].notified_30d &&
        !ixRow![0].notified_expired &&
        (await cniNotifs(ix.uid)).length === 1 &&
        reApply.status === 200 &&
        rePlain.status === 200 &&
        Number((await score("candidate", ix.pid)).stars) ===
          Number(repBeforeRenewal.stars),
      { row: ixRow, apply: [reApply.status, rePlain.status] },
    );

    // Justificatif : déposé (en attente) → suivi, plus d'action, point
    // éteint ; approuvé → candidature acceptée, tâche effacée.
    const { data: casier } = await service
      .from("candidate_documents")
      .insert({
        candidate_id: ix.pid,
        document_type: "casier_judiciaire",
        title: "Casier judiciaire",
        storage_path: `${ix.uid}/casier.pdf`,
        status: "pending",
      })
      .select("id")
      .single();
    const t4 = await tasksOf(IX.cookie);
    const t4doc = t4.actions.find(
      (a) => a.key === "document:casier_judiciaire:",
    );
    await service
      .from("candidate_documents")
      .update({ status: "verified" })
      .eq("id", casier!.id);
    const docApply = await http("POST", `/api/jobs/${jobDoc}/apply`, IX.cookie);
    const t5 = await tasksOf(IX.cookie);
    const { data: leftBlockers } = await service
      .from("candidate_application_blockers")
      .select("job_id")
      .eq("candidate_id", ix.pid);
    report(
      "I12 justificatif déposé : tâche en suivi, aucune action, point éteint ; approuvé : candidature acceptée, tâche et mémorisation effacées",
      t4doc?.state === "pending" &&
        !t4doc.action_required &&
        t4.pending === 0 &&
        docApply.status === 200 &&
        t5.actions.length === 0 &&
        (leftBlockers ?? []).length === 0,
      { doc: t4doc, pending: t4.pending, apply: docApply.status },
    );

    // Limite exacte : valide jusqu'à 00:00:00 UTC du jour d'échéance inclus,
    // expirée juste après. Fonction de
    // la base évaluée aux deux instants qui encadrent la limite, puis
    // candidatures réelles avec une échéance aujourd'hui (UTC) et demain.
    const utcDay = (n: number) =>
      new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    execSql(
      `do $$
       declare p public.candidate_profiles;
       begin
         select * into p from public.candidate_profiles where id = '${ix.pid}';
         p.cni_verified := 'verified';
         p.cni_expires_at := date '2030-03-15';
         if public.candidate_cni_state(p, timestamptz '2030-03-15 00:00:00+00') <> 'valid'
            or public.candidate_cni_state(p, timestamptz '2030-03-15 00:00:00.000001+00') <> 'expired'
            or public.candidate_cni_state(p, timestamptz '2030-03-14 23:59:59+00') <> 'valid' then
           raise exception 'cni boundary';
         end if;
       end $$;`,
    );
    const ie0 = await cniCandidate("ie0", utcDay(0));
    const ie1 = await cniCandidate("ie1", utcDay(1));
    const IE0 = await realSession(mail("ie0"));
    const IE1 = await realSession(mail("ie1"));
    const jobEdge = await seedJob(coA, { positions: 3 });
    const edge0 = await http("POST", `/api/jobs/${jobEdge}/apply`, IE0.cookie);
    const edge1 = await http("POST", `/api/jobs/${jobEdge}/apply`, IE1.cookie);
    report(
      "I13 limite exacte (pg_cron non exécuté) : valide jusqu'à 00:00:00 UTC du jour d'échéance, expirée la microseconde suivante ; échéance aujourd'hui → 403 cni_expired, demain → candidature acceptée",
      edge0.status === 403 &&
        edge0.body.code === "cni_expired" &&
        edge1.status === 200 &&
        (await appsOf(jobEdge, ie0.pid)) === 0 &&
        (await appsOf(jobEdge, ie1.pid)) === 1,
      { today: [edge0.status, edge0.body.code], tomorrow: edge1.status },
    );

    // Refus documentaire par la route : l'offre est mémorisée pour la
    // tâche ; la table n'est ni lisible ni modifiable en session.
    const jobDoc2 = await seedJob(coA, { positions: 3 });
    await service
      .from("jobs")
      .update({ required_documents: ["casier_judiciaire"] })
      .eq("id", jobDoc2);
    const docRefused = await http(
      "POST",
      `/api/jobs/${jobDoc2}/apply`,
      IE1.cookie,
    );
    const t6 = await tasksOf(IE1.cookie);
    const readOwn = await IE1.client
      .from("candidate_application_blockers")
      .select("job_id");
    const writeOwn = await IE1.client
      .from("candidate_application_blockers")
      .insert({ candidate_id: ie1.pid, job_id: jobDoc2 });
    report(
      "I14 refus documentaire par la route : tâche « justificatif » avec l'offre, retrouvée par une nouvelle lecture (reconnexion) ; mémorisation fermée en session",
      docRefused.status === 403 &&
        docRefused.body.code === "document_requirement" &&
        t6.actions.some(
          (a) =>
            a.kind === "document" &&
            a.action_required &&
            a.jobs.some((j) => j.id === jobDoc2),
        ) &&
        (await tasksOf((await realSession(mail("ie1"))).cookie)).pending ===
          1 &&
        !!readOwn.error &&
        !!writeOwn.error,
      {
        refusal: docRefused.body.code,
        tasks: t6.actions.map((a) => a.key),
        read: readOwn.error?.code,
        write: writeOwn.error?.code,
      },
    );

    // Comptage avant déploiement : la requête documentée (AUDIT §27,
    // PLAN_ACTION) doit désigner exactement les profils que la candidature
    // refuse pour ce motif (cni_expired), y compris l'échéance du jour, et
    // aucun profil sans date.
    const COUNT_PREDICATE =
      "cni_expires_at is not null and cni_expires_at::timestamp at time zone 'UTC' < now()";
    const cases: [
      string,
      string | null,
      "verified" | "pending" | "rejected",
    ][] = [
      ["ca", utcDay(-1), "verified"],
      ["cb", utcDay(0), "verified"],
      ["cc", utcDay(1), "verified"],
      ["cd", null, "verified"],
      ["ce", utcDay(-1), "pending"],
      ["cf", utcDay(-1), "rejected"],
      ["cg", null, "pending"],
      ["ch", utcDay(30), "pending"],
    ];
    const jobCount = await seedJob(coA, { positions: 10 });
    const outcomes: { key: string; pid: string; code: string }[] = [];
    for (const [key, expires, status] of cases) {
      const c = await cniCandidate(key, expires, status);
      const S = await realSession(mail(key));
      const r = await http("POST", `/api/jobs/${jobCount}/apply`, S.cookie);
      outcomes.push({
        key,
        pid: c.pid,
        code: r.status === 200 ? "ok" : String(r.body.code),
      });
    }
    const refused = outcomes.filter((o) => o.code === "cni_expired");
    let countMatches = true;
    try {
      execSql(
        `do $$
         declare v_counted uuid[]; v_expected uuid[] := array[${
           refused.map((o) => `'${o.pid}'::uuid`).join(", ") || "null::uuid"
         }]::uuid[];
         begin
           select coalesce(array_agg(cp.id order by cp.id), '{}') into v_counted
           from public.candidate_profiles cp
           where cp.id in (${outcomes.map((o) => `'${o.pid}'`).join(", ")})
             and ${COUNT_PREDICATE};
           if v_counted is distinct from (select coalesce(array_agg(x order by x), '{}')
                                          from unnest(v_expected) x where x is not null) then
             raise exception 'count mismatch';
           end if;
           -- Même ensemble que la fonction lue par apply_to_job.
           if exists (select 1 from public.candidate_profiles cp
                      where cp.id in (${outcomes.map((o) => `'${o.pid}'`).join(", ")})
                        and (${COUNT_PREDICATE}) is distinct from
                            (public.candidate_cni_state(cp, now())
                               in ('expired', 'renewal_pending', 'renewal_rejected'))) then
             raise exception 'state mismatch';
           end if;
           if position('candidate_cni_state(v_profile, now())' in
                       pg_get_functiondef('public.apply_to_job(uuid)'::regprocedure)) = 0 then
             raise exception 'apply_to_job predicate';
           end if;
         end $$;`,
      );
    } catch (e) {
      countMatches = false;
      console.error((e as Error).message);
    }
    report(
      "I15 comptage avant déploiement : la requête (échéance non nulle et passée, UTC) désigne exactement les profils refusés cni_expired — échue hier ou aujourd'hui (vérifiée, renouvellement en attente ou refusé) — et aucun profil valide, sans date ou en première vérification ; même ensemble que candidate_cni_state, lue par apply_to_job",
      countMatches &&
        JSON.stringify(refused.map((o) => o.key).sort()) ===
          JSON.stringify(["ca", "cb", "ce", "cf"]) &&
        outcomes.find((o) => o.key === "cc")?.code === "ok" &&
        outcomes.find((o) => o.key === "cd")?.code === "ok" &&
        outcomes.find((o) => o.key === "cg")?.code === "profile_not_verified" &&
        outcomes.find((o) => o.key === "ch")?.code === "profile_not_verified",
      outcomes.map((o) => `${o.key}:${o.code}`),
    );

    // ══ V. Mauvais avis : texte reçu, confidentialité, reconnexion ═══
    const expected = {
      fr: {
        title: "Réputation : 1,5 étoile",
        body: "Votre réputation EasyJob passe à 1,5 étoile après un avis : retard, travail non conforme.",
      },
      en: {
        title: "Reputation: 1.5 stars",
        body: "Your EasyJob reputation drops to 1.5 stars after a review: late arrival, work not up to standard.",
      },
    } as const;
    for (const locale of ["fr", "en"] as const) {
      const key = `v${locale}`;
      const uV = await createAccount(mail(key), "candidate", locale);
      ids.push(uV);
      const cV = await createCandidate(uV, `Val${locale}`);
      const vMissions: string[] = [];
      for (let i = 0; i < 6; i++) {
        vMissions.push(await seedMission(coF, cV, true));
      }
      for (let i = 0; i < 5; i++) {
        const ok = await review(F, vMissions[i], { rating: 5 });
        if (ok.status !== 200) throw new Error(`review V: ${ok.status}`);
      }
      const v0 = await score("candidate", cV);
      // Le candidat se déconnecte avant l'avis.
      const before = await realSession(mail(key));
      await before.client.auth.signOut();
      const changesBefore = (await changesOf(uV)).length;
      const notifsBefore = (await reputationNotifications(uV)).length;

      const COMMENT = `Commentaire libre V9c ${locale} ${suffix}`;
      const payload = {
        rating: 1,
        reasons: ["late", "poor_quality"],
        comment: COMMENT,
      };
      // Perte de réponse : deux envois simultanés, puis une relance.
      const [s1, s2] = await Promise.all([
        review(F, vMissions[5], payload),
        review(F, vMissions[5], payload),
      ]);
      const s3 = await review(F, vMissions[5], payload);
      const rid = (r: HttpResult) =>
        (r.body.review as { review_id?: string } | undefined)?.review_id;
      const already = [s1, s2, s3].map(
        (r) =>
          (r.body.review as { already_reviewed?: boolean } | undefined)
            ?.already_reviewed,
      );
      const { data: vReviews } = await service
        .from("reviews")
        .select("id")
        .eq("mission_id", vMissions[5])
        .eq("reviewer_type", "company");
      const v1 = await score("candidate", cV);
      const vChanges = (await changesOf(uV)).slice(changesBefore);
      const vNotifs = (await reputationNotifications(uV)).slice(notifsBefore);
      report(
        `V1 [${locale}] relances après perte de réponse : même avis (un seul en base, une seule fois « nouveau »), impact −5 compté une fois (5 → 0), ½ étoile perdue, une variation et une notification`,
        [s1, s2, s3].every((r) => r.status === 200) &&
          rid(s1) === rid(s2) &&
          rid(s2) === rid(s3) &&
          already.filter((a) => a === false).length === 1 &&
          (vReviews ?? []).length === 1 &&
          v0.review_units === 5 &&
          v1.review_units === 0 &&
          Number(v1.stars) === Number(v0.stars) - 0.5 &&
          vChanges.length === 1 &&
          vChanges[0].direction === "loss" &&
          vNotifs.length === 1,
        {
          statuses: [s1.status, s2.status, s3.status],
          already,
          units: [v0.review_units, v1.review_units],
          stars: [v0.stars, v1.stars],
        },
      );
      report(
        `V2 [${locale}] texte reçu exact : « ${expected[locale].body} »`,
        vNotifs[0]?.title === expected[locale].title &&
          vNotifs[0]?.body === expected[locale].body,
        { title: vNotifs[0]?.title, body: vNotifs[0]?.body },
      );

      // Reconnexion : la notification est là, une seule fois.
      const back = await realSession(mail(key));
      const other = await realSession(mail(key));
      const list = await http("GET", "/api/notifications", back.cookie);
      const me = await http("GET", "/api/reputation", back.cookie);
      const listed = (
        (list.body.notifications as {
          data?: { kind?: string; change_id?: string };
        }[]) ?? []
      ).filter(
        (n) =>
          n.data?.kind === "reputation" && n.data.change_id === vChanges[0]?.id,
      );
      const pendingV = (
        (me.body.reputation as { pending_changes: { id: string }[] })
          ?.pending_changes ?? []
      ).filter((c) => c.id === vChanges[0]?.id);
      const leaks = [COMMENT, "Historique F", coF, uF, rid(s1) ?? "-"];
      const leaked = leaks.filter(
        (x) => list.text.includes(x) || me.text.includes(x),
      );
      report(
        `V3 [${locale}] après reconnexion : une seule notification et une seule variation en attente ; ni commentaire, ni auteur, ni identifiant de l'avis dans les réponses`,
        list.status === 200 &&
          me.status === 200 &&
          listed.length === 1 &&
          pendingV.length === 1 &&
          leaked.length === 0,
        { listed: listed.length, pending: pendingV.length, leaked },
      );
      const [ackA, ackB] = await Promise.all([
        http("POST", "/api/reputation/acknowledge", back.cookie, {
          ids: [vChanges[0].id],
        }),
        http("POST", "/api/reputation/acknowledge", other.cookie, {
          ids: [vChanges[0].id],
        }),
      ]);
      const acked =
        ((ackA.body.acknowledged as string[]) ?? []).length +
        ((ackB.body.acknowledged as string[]) ?? []).length;
      const meAfter = await http("GET", "/api/reputation", back.cookie);
      report(
        `V4 [${locale}] animation acquittée par un seul onglet, plus en attente ensuite`,
        acked === 1 &&
          !(
            (meAfter.body.reputation as { pending_changes: { id: string }[] })
              ?.pending_changes ?? []
          ).some((c) => c.id === vChanges[0].id),
        { acked },
      );

      const vAdminUrl = `/api/admin/reputation/candidate/${cV}`;
      const [opsView, supView, thirdView] = await Promise.all([
        http("GET", vAdminUrl, Ops.cookie),
        http("GET", vAdminUrl, Sup.cookie),
        http("GET", vAdminUrl, B.cookie),
      ]);
      const full = (
        (opsView.body.reviews as {
          id: string;
          comment: string | null;
          reasons: string[];
          author: { name: string | null };
          mission: { id: string } | null;
          impact: { applied: number; nominal: number } | null;
        }[]) ?? []
      ).find((r) => r.id === rid(s1));
      report(
        `V5 [${locale}] avis complet visible des admins habilités (ops et support : commentaire, auteur, mission, motifs, impact −5) ; refusé à un tiers`,
        opsView.status === 200 &&
          supView.status === 200 &&
          supView.text.includes(COMMENT) &&
          thirdView.status === 403 &&
          full?.comment === COMMENT &&
          full.author.name === "Historique F" &&
          full.mission?.id === vMissions[5] &&
          JSON.stringify(full.reasons) ===
            JSON.stringify(["late", "poor_quality"]) &&
          full.impact?.applied === -5,
        { ops: opsView.status, sup: supView.status, third: thirdView.status },
      );
    }

    // ══ B. Manquements : la base APPLIQUE une décision confirmée ═════
    // Les conditions pour la prononcer (délai 24 h / 12 h, offre
    // partiellement pourvue) sont à arbitrer et ne sont pas encodées :
    // aucun seuil ne doit déclencher ni écarter une sanction.
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const openMissionK = await seedMission(coF, cK, false);
    const subjects = [cK, cR, cL, cM1, coA, coF];
    const { data: inferred } = await service
      .from("reputation_incidents")
      .select("id")
      .in("subject_id", subjects);
    report(
      "B0 aucune sanction inférée : missions sans code saisi, avis négatifs, contestations et échéances n'ont créé aucun manquement",
      (inferred ?? []).length === 0,
      { incidents: (inferred ?? []).length },
    );

    const noShowConfirmed = await service.from("reputation_incidents").insert({
      subject_type: "candidate",
      subject_id: cK,
      kind: "candidate_no_show",
      source: "support_decision",
      mission_id: m10,
      scheduled_start_at: iso(now - 3_600_000),
      occurred_at: iso(now - 3_600_000),
    });
    const otherMission = await service.from("reputation_incidents").insert({
      subject_type: "candidate",
      subject_id: cK,
      kind: "candidate_late_cancellation",
      source: "support_decision",
      mission_id: rMissions[0],
      scheduled_start_at: iso(now + 3_600_000),
      occurred_at: iso(now),
    });
    const otherJob = await service.from("reputation_incidents").insert({
      subject_type: "company",
      subject_id: coF,
      kind: "company_late_cancellation",
      source: "support_decision",
      job_id: jobR,
      scheduled_start_at: iso(now + 3_600_000),
      occurred_at: iso(now),
    });
    report(
      "B1 intégrité des faits seulement : absence sur une mission confirmée par code, mission d'un autre candidat, offre d'une autre entreprise refusées",
      noShowConfirmed.error?.message === "incident_conflicts_with_completion" &&
        otherMission.error?.message === "incident_mission_mismatch" &&
        otherJob.error?.message === "incident_job_mismatch",
      [
        noShowConfirmed.error?.message,
        otherMission.error?.message,
        otherJob.error?.message,
      ],
    );

    // Décision confirmée pour une annulation faite 30 h avant le début :
    // au-delà du seuil provisoire de 24 h, elle s'applique quand même.
    const kBeforeBreach = await score("candidate", cK);
    const { data: breach, error: breachErr } = await service
      .from("reputation_incidents")
      .insert({
        subject_type: "candidate",
        subject_id: cK,
        kind: "candidate_late_cancellation",
        source: "support_decision",
        mission_id: openMissionK,
        scheduled_start_at: iso(now + 30 * 3_600_000),
        occurred_at: iso(now),
      })
      .select("id")
      .single();
    const kBreach = await score("candidate", cK);
    const kBreachChange = (await changesOf(uK)).at(-1);
    report(
      "B2 décision confirmée appliquée sans seuil (annulation 30 h avant le début) : −5 unités (10 → 5), ½ étoile perdue, notification cause breach",
      !breachErr &&
        kBreach.experience_units === kBeforeBreach.experience_units - 5 &&
        Number(kBreach.stars) === Number(kBeforeBreach.stars) - 0.5 &&
        kBreachChange?.cause === "breach",
      {
        error: breachErr?.message,
        before: kBeforeBreach.experience_units,
        after: kBreach.experience_units,
      },
    );
    await service
      .from("reputation_incidents")
      .update({
        voided_at: iso(Date.now()),
        void_reason: "Correction du support",
      })
      .eq("id", breach!.id);
    const kVoided = await score("candidate", cK);
    report(
      "B3 correction du support (annulation de la décision) : solde et étoiles rétablis par rejeu",
      kVoided.experience_units === kBeforeBreach.experience_units &&
        Number(kVoided.stars) === Number(kBeforeBreach.stars),
      { units: kVoided.experience_units },
    );

    const m1Before = await score("candidate", cM1);
    const m1Open = await seedMission(coF, cM1, false);
    // Constat postérieur à la mission confirmée (rejeu chronologique).
    const noShowAt = Date.now();
    const { error: m1Err } = await service.from("reputation_incidents").insert({
      subject_type: "candidate",
      subject_id: cM1,
      kind: "candidate_no_show",
      source: "support_decision",
      mission_id: m1Open,
      scheduled_start_at: iso(noShowAt - 60_000),
      occurred_at: iso(noShowAt),
    });
    if (m1Err) throw new Error(`no-show: ${m1Err.message}`);
    const m1After = await score("candidate", cM1);
    report(
      "B4 plancher : 1 unité puis une décision → 0 (jamais négatif)",
      m1Before.experience_units === 1 && m1After.experience_units === 0,
      { before: m1Before.experience_units, after: m1After.experience_units },
    );

    // Entreprise : décisions sur une offre sans sélection (partiellement
    // ou pas pourvue) et 13 h avant le début (au-delà du seuil provisoire
    // de 12 h) comptent comme les autres ; seul le regroupement par trois
    // en 90 jours, règle d'application, s'applique.
    const f0 = await score("company", coF);
    const { data: fJobs } = await service
      .from("jobs")
      .select("id")
      .eq("company_id", coF)
      .limit(3);
    const noSelJob = await seedJob(coF);
    const companyIncident = (job: string, startInH: number, atMs: number) =>
      service.from("reputation_incidents").insert({
        subject_type: "company",
        subject_id: coF,
        kind: "company_late_cancellation",
        source: "support_decision",
        job_id: job,
        scheduled_start_at: iso(atMs + startInH * 3_600_000),
        occurred_at: iso(atMs),
      });
    const c1 = await companyIncident(fJobs![0].id, 2, now - 80 * 86_400_000);
    const c2 = await companyIncident(fJobs![1].id, 2, now - 40 * 86_400_000);
    const f2 = await score("company", coF);
    const c3 = await companyIncident(noSelJob, 2, now);
    const f3 = await score("company", coF);
    const c4 = await companyIncident(fJobs![2].id, 13, now + 1000);
    const c5 = await companyIncident(noSelJob, 48, now + 2000);
    const f5 = await score("company", coF);
    const c6 = await companyIncident(fJobs![0].id, 2, now + 3000);
    const f6 = await score("company", coF);
    report(
      "B5 entreprise : aucune décision écartée (offre sans sélection, 13 h ou 48 h avant le début) ; 2 décisions → rien, la 3e en 90 jours → un seul retrait de 5 ; puis 2 → rien, la 3e → second retrait",
      [c1, c2, c3, c4, c5, c6].every((c) => !c.error) &&
        f0.experience_units === 20 &&
        f2.experience_units === 20 &&
        f3.experience_units === 15 &&
        f5.experience_units === 15 &&
        f6.experience_units === 10 &&
        f6.breach_count === 2,
      {
        errors: [c1, c2, c3, c4, c5, c6].map((c) => c.error?.message ?? "ok"),
        units: [
          f0.experience_units,
          f2.experience_units,
          f3.experience_units,
          f5.experience_units,
          f6.experience_units,
        ],
      },
    );

    // ══ E. Profil entreprise, abonnement, écritures ═════════════════
    const g0 = await score("company", coG);
    const gRow = (
      await service.from("company_profiles").select("*").eq("id", coG).single()
    ).data!;
    const jsPct = computeCompletion(computeCompanyCriteria(gRow));
    await service
      .from("company_profiles")
      .update({ address: "Akwa", logo_url: `${uG}/logo.png` })
      .eq("id", coG);
    const g1 = await score("company", coG);
    const g1Row = (
      await service.from("company_profiles").select("*").eq("id", coG).single()
    ).data!;
    const gNotif = (await reputationNotifications(uG)).at(-1);
    report(
      "E1 complétude entreprise identique à computeCompanyCriteria (40 % → 0 ; 70 % → ½, gain notifié en anglais)",
      g0.profile_pct === jsPct &&
        g0.profile_pct === 40 &&
        Number(g0.profile_stars) === 0 &&
        g1.profile_pct === computeCompletion(computeCompanyCriteria(g1Row)) &&
        Number(g1.profile_stars) === 0.5 &&
        gNotif?.title === "Congratulations: 0.5 stars",
      {
        sql: [g0.profile_pct, g1.profile_pct],
        js: jsPct,
        title: gNotif?.title,
      },
    );

    const rBeforePremium = await score("candidate", cR);
    await service
      .from("users")
      .update({ role: "candidate_premium" })
      .eq("id", uR);
    await service
      .from("candidate_profiles")
      .update({ premium_until: iso(Date.now() + 30 * 86_400_000) })
      .eq("id", cR);
    const rPremium = (
      await service.rpc("compute_reputation", {
        p_subject_type: "candidate",
        p_subject_id: cR,
      })
    ).data?.[0];
    report(
      "E2 le premium ne change pas le score",
      Number(rPremium?.stars) === Number(rBeforePremium.stars),
      { before: rBeforePremium.stars, premium: rPremium?.stars },
    );

    const writes = await Promise.all([
      R.client
        .from("reputation_scores")
        .update({ stars: 5 })
        .eq("subject_id", cR)
        .select(),
      R.client.from("reputation_changes").insert({
        subject_type: "candidate",
        subject_id: cR,
        user_id: uR,
        from_stars: 0,
        to_stars: 5,
        direction: "gain",
        cause: "forged",
      }),
      R.client.from("reputation_incidents").select("*"),
      R.client.rpc("compute_reputation", {
        p_subject_type: "candidate",
        p_subject_id: cR,
      }),
      R.client.rpc("reputation_expiry_sweep"),
      R.client.rpc("admin_reputation_review_impacts", {
        p_subject_type: "candidate",
        p_subject_id: cR,
      }),
      R.client.rpc("admin_resolve_review_contest", {
        p_review_id: bad2Id!,
        p_outcome: "rejected",
        p_note: "forgé",
      }),
    ]);
    const rFinal = await score("candidate", cR);
    report(
      "E3 aucune écriture de session sur la projection, l'historique ou les manquements ; fonctions internes et décisions admin fermées",
      (writes[0].data ?? []).length === 0 &&
        !!writes[1].error &&
        !!writes[2].error &&
        !!writes[3].error &&
        !!writes[4].error &&
        !!writes[5].error &&
        writes[6].error?.message === "forbidden" &&
        Number(rFinal.stars) !== 5,
      writes.map((w) => w.error?.code ?? "ok"),
    );
  } finally {
    for (const close of closers) await close().catch(() => {});
    await cleanAccounts(ids);
  }

  if (observedExpiredCniApply !== null) {
    console.log(
      `I5 : CNI expirée, offre sans document exigé → HTTP ${observedExpiredCniApply} (attendu 403 depuis le lot 9d)`,
    );
  }
  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
