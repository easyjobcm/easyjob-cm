/**
 * Preuve lot 17d-1 — clôture tracée d'une offre publiée sans engagement.
 *
 * Fixtures en clé service ; tentatives en sessions RÉELLES (routes avec
 * cookies, RPC avec le JWT) ; état relu en clé service.
 *
 *   S. Suppression : offre jamais publiée supprimée ; refusée après
 *      publication, après retour en modération et pour une offre historique
 *      (`legacy_publication`), par la route comme par la RPC.
 *   C. Clôture : candidatures en attente conservées (jamais refusées),
 *      notifications une fois par candidat, relance sans doublon, motif
 *      obligatoire, trace d'audit, lecture du détail réservée.
 *   V. Visibilité : offre retirée des offres ouvertes, lien direct
 *      « clôturée par l'entreprise », lisible par le candidat qui y a
 *      postulé, ni candidature ni sélection ensuite.
 *   E. Engagements : candidat sélectionné, mission, contrat → refus.
 *   D. Droits et chemins directs : autre entreprise, anonyme, candidat,
 *      compte suspendu ; écritures directes (offre, clôture, candidatures),
 *      clé service comprise pour la réouverture.
 *   P. Panne en cours de transaction : aucun effet partiel.
 *   R. Courses à ordre imposé : clôture/candidature et clôture/sélection,
 *      dans les deux ordres (scripts/lib/proof-barrier.ts).
 *   G. Dossier entreprise en revue : clôture possible ; revalidation sans
 *      réouverture.
 *   M. Plusieurs journées : clôture de l'offre entière, refusée si une
 *      journée a un engagement.
 *   T. Signaux : { d, r } vers les candidats, l'entreprise et le public.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { runSupabaseQuery } from "./lib/db-query";
import { approveCompanyDossier } from "./lib/verified-company";
import { insertJobWithDays, type FixtureDay } from "./lib/job-days-fixture";
import { appFetch } from "./lib/app-fetch";
import { signAndSelectRpc } from "./lib/sign-and-select";
import { dropBarrier, installBarrier, waitSleeping } from "./lib/proof-barrier";
import { purgeProofJobs } from "./lib/proof-purge";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const PROOF_PASSWORD = "Proof-L17d1-close-01!";
const PROOF_USER_METADATA = { proofJobClosure: true };
const REASON = "Besoin annulé par notre client final.";

const DB_URL = readLocalDbUrl();
function execSql(sql: string): string {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "job-closure" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
  return r.stdout;
}

const serviceClient: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});
const serviceRpc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

// Fonctions et triggers temporaires (pile de preuve, clé service seulement).
const TEMP = [
  ["proof_l17d1_slow_close", "public.jobs"],
  ["proof_l17d1_slow_apply", "public.job_applications"],
  ["proof_l17d1_slow_select", "public.job_applications"],
  ["proof_l17d1_fail_audit", "public.audit_logs"],
] as const;
function dropTemp() {
  for (const [name, table] of TEMP) {
    execSql(`drop trigger if exists ${name} on ${table}`);
    execSql(`drop function if exists public.${name}()`);
  }
  execSql(
    "drop function if exists public.proof_l17d1_messages(text, timestamptz)",
  );
}
function slowTrigger(
  name: (typeof TEMP)[number][0],
  table: string,
  timing: string,
  condition: string,
) {
  execSql(`
    create or replace function public.${name}() returns trigger
    language plpgsql as $$ begin
      if ${condition} then perform pg_sleep(1.5); end if;
      return new;
    end $$`);
  execSql(
    `create trigger ${name} ${timing} on ${table} for each row execute function public.${name}()`,
  );
}

// ─── Sessions réelles ─────────────────────────────────────────────
type CookieEntry = { name: string; value: string };
type Session = { client: DB; cookie: string; userId: string };

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
  return { client, cookie, userId: data.user.id };
}

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

async function createAccount(email: string, role: Role): Promise<string> {
  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: PROOF_USER_METADATA,
    app_metadata: { role, phone_verified: true },
  });
  if (error || !created.user) throw new Error(`user: ${error?.message}`);
  const id = created.user.id;
  const { error: rowErr } = await serviceClient.from("users").insert({
    id,
    email,
    phone:
      role === "candidate"
        ? `+2376997${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M17${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

async function createCandidate(userId: string, firstName: string) {
  const { data, error } = await serviceClient
    .from("candidate_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: "Ngono",
      date_of_birth: "1996-03-14",
      city: "Douala",
      address: "Bonamoussadi, rue privée",
      latitude: 4.09,
      longitude: 9.74,
      bio: "Candidat de preuve du lot 17d-1.",
      cni_number: `CNI17${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      cni_front_url: `${userId}/cni-front.jpg`,
      cni_back_url: `${userId}/cni-back.jpg`,
      cni_selfie_url: `${userId}/cni-selfie.jpg`,
      cni_verified: "verified",
      cni_expires_at: "2033-01-01",
      momo_provider: "mtn",
      momo_number: "+237677171717",
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
  purgeProofJobs("job-closure", { userIds: ids });
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
      await serviceClient.from("audit_logs").delete().in("resource_id", jobIds);
      await serviceClient.from("jobs").delete().in("id", jobIds);
    }
  }
  await serviceClient.from("audit_logs").delete().in("actor_id", ids);
  await serviceClient.from("notifications").delete().in("user_id", ids);
  await serviceClient.from("candidate_profiles").delete().in("user_id", ids);
  await serviceClient.from("company_profiles").delete().in("user_id", ids);
  await serviceClient.from("users").delete().in("id", ids);
  for (const id of ids) {
    await serviceClient.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function cleanStaleProofs() {
  dropTemp();
  dropBarrier(execSql);
  const { data: page } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  await cleanAccounts(
    (page?.users ?? [])
      .filter((u) => u.user_metadata?.proofJobClosure === true)
      .map((u) => u.id),
  );
}

type HttpResult = { status: number; body: Record<string, unknown> };
async function http(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: "manual",
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

const CONTENT = {
  description: "Preuve de la clôture des offres (lot 17d-1).",
  address: "Rue Njo-Njo",
  city: "Douala",
};

async function main() {
  await cleanStaleProofs();
  const suffix = Date.now();
  const mail = (k: string) => `l17d1-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  let temp = false;

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idS = await createAccount(mail("s"), "company");
    const candKeys = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"] as const;
    type CK = (typeof candKeys)[number];
    const candIds = await Promise.all(
      candKeys.map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, idS, ...candIds);
    const uid = Object.fromEntries(
      candKeys.map((k, i) => [k, candIds[i]]),
    ) as Record<CK, string>;
    const coA = await createCompany(idA, "Imprimerie Bassa");
    await createCompany(idB, "Société Tierce");
    const coS = await createCompany(idS, "Entreprise Suspendue");
    const prof = Object.fromEntries(
      await Promise.all(
        candKeys.map(async (k) => [
          k,
          await createCandidate(uid[k], k.toUpperCase()),
        ]),
      ),
    ) as Record<CK, string>;
    const sess = Object.fromEntries(
      await Promise.all(
        ["a", "b", "s", ...candKeys].map(async (k) => [
          k,
          await realSession(mail(k)),
        ]),
      ),
    ) as Record<string, Session>;
    const A = sess.a;
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let dayNo = 0;
    const nextDate = () => {
      dayNo += 1;
      return new Date(Date.UTC(2099, 2, 1) + dayNo * 86_400_000)
        .toISOString()
        .slice(0, 10);
    };
    const oneDay = (): FixtureDay[] => [
      { date: nextDate(), start_time: "08:00", end_time: "16:00" },
    ];
    const mkJob = async (
      title: string,
      opts: {
        company?: string;
        status?: Database["public"]["Enums"]["job_status"];
        days?: FixtureDay[];
        format?: "full_period" | "per_day";
        positions?: number;
      } = {},
    ) =>
      (
        await insertJobWithDays(
          serviceClient,
          {
            ...CONTENT,
            title,
            company_id: opts.company ?? coA,
            mission_pay_per_candidate: 8000,
            positions_available: opts.positions ?? 2,
            status: opts.status ?? "active",
          },
          opts.days ?? oneDay(),
          opts.format ?? "full_period",
        )
      ).jobId;
    const apply = async (k: CK, jobId: string) => {
      const { data, error } = await sess[k].client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !data) throw new Error(`apply ${k}: ${error?.message}`);
      return data.id;
    };
    const jobRow = async (jobId: string) =>
      (
        await serviceClient
          .from("jobs")
          .select("id, status, closed_at, first_published_at, updated_at")
          .eq("id", jobId)
          .maybeSingle()
      ).data;
    const appsOf = async (jobId: string) =>
      (
        (
          await serviceClient
            .from("job_applications")
            .select("id, candidate_id, status, updated_at")
            .eq("job_id", jobId)
            .order("id")
        ).data ?? []
      ).map((a) => ({ ...a }));
    const closuresOf = async (jobId: string) =>
      (await serviceClient.from("job_closures").select("*").eq("job_id", jobId))
        .data ?? [];
    const notifsOf = async (jobId: string) =>
      (
        await serviceClient
          .from("notifications")
          .select("user_id, notification_type, data")
          .eq("data->>job_id", jobId)
          .eq("data->>kind", "job_closed")
      ).data ?? [];
    const auditOf = async (jobId: string) =>
      (
        await serviceClient
          .from("audit_logs")
          .select("actor_id, action, metadata")
          .eq("resource_id", jobId)
          .eq("action", "close_job")
      ).data ?? [];
    const close = (s: Session | null, jobId: string, reason = REASON) =>
      http("POST", `/api/jobs/${jobId}/close`, s?.cookie ?? null, { reason });

    // ── S. Suppression ───────────────────────────────────────────
    console.log("\n── S. Suppression ──");
    const jDraft = await mkJob("Brouillon jamais publié", { status: "draft" });
    const s1 = await http("DELETE", `/api/jobs/${jDraft}`, A.cookie);
    const jNeverRpc = await mkJob("En attente jamais publiée", {
      status: "pending_review",
    });
    const { data: s1Rpc, error: s1RpcErr } = await A.client.rpc("delete_job", {
      p_job_id: jNeverRpc,
    });
    report(
      "S1 offre jamais publiée (brouillon par la route, en attente par la RPC) → supprimée",
      s1.status === 200 &&
        s1.body.deleted === jDraft &&
        !(await jobRow(jDraft)) &&
        !s1RpcErr &&
        s1Rpc === jNeverRpc &&
        !(await jobRow(jNeverRpc)),
      { route: s1.status, rpc: s1RpcErr?.message },
    );

    const jPub = await mkJob("Publiée sans engagement");
    await apply("c1", jPub);
    const pubBefore = JSON.stringify([await jobRow(jPub), await appsOf(jPub)]);
    const s2 = await http("DELETE", `/api/jobs/${jPub}`, A.cookie);
    const { error: s2Rpc } = await A.client.rpc("delete_job", {
      p_job_id: jPub,
    });
    report(
      "S2 offre publiée sans engagement → suppression refusée (route 409 job_published, RPC), offre et candidature intactes",
      s2.status === 409 &&
        s2.body.code === "job_published" &&
        s2Rpc?.message === "job_published" &&
        JSON.stringify([await jobRow(jPub), await appsOf(jPub)]) === pubBefore,
      { route: s2.body.code, rpc: s2Rpc?.message },
    );

    // Publiée puis revenue en modération (statut courant pending_review).
    const jBack = await mkJob("Publiée puis revenue en modération");
    await serviceClient
      .from("jobs")
      .update({ status: "pending_review" })
      .eq("id", jBack);
    const s3 = await http("DELETE", `/api/jobs/${jBack}`, A.cookie);
    const backRow = await jobRow(jBack);
    // Offre historique (lot 11b) : legacy_publication, sans date de première
    // publication, au statut en attente.
    const { data: legacy, error: legacyErr } = await serviceClient
      .from("jobs")
      .insert({
        ...CONTENT,
        title: "Offre historique",
        company_id: coA,
        mission_pay_per_candidate: 7000,
        positions_available: 1,
        start_date: nextDate(),
        start_time: "08:00",
        end_time: "12:00",
        status: "pending_review",
        legacy_publication: true,
      })
      .select("id")
      .single();
    if (legacyErr || !legacy) throw new Error(`legacy: ${legacyErr?.message}`);
    const s4 = await http("DELETE", `/api/jobs/${legacy.id}`, A.cookie);
    report(
      "S3 publiée puis revenue en modération (pending_review, première publication conservée) et offre historique (legacy_publication) → suppression refusée (job_published), offres conservées",
      backRow?.status === "pending_review" &&
        !!backRow.first_published_at &&
        s3.status === 409 &&
        s3.body.code === "job_published" &&
        s4.status === 409 &&
        s4.body.code === "job_published" &&
        !!(await jobRow(legacy.id)),
      { s3: s3.body.code, s4: s4.body.code },
    );

    // ── C. Clôture ──────────────────────────────────────────────
    console.log("\n── C. Clôture ──");
    const jClose = await mkJob("Mise sous pli (à clôturer)", { positions: 4 });
    await apply("c1", jClose);
    await apply("c2", jClose);
    const appW = await apply("c3", jClose);
    await sess.c3.client.rpc("withdraw_job_application", { p_job_id: jClose });
    // Ancienne présélection (lot 13 : traitée comme en attente).
    const { error: shortErr } = await serviceClient
      .from("job_applications")
      .insert({ job_id: jClose, candidate_id: prof.c4, status: "shortlisted" });
    if (shortErr) throw new Error(`shortlisted: ${shortErr.message}`);
    const appsBefore = await appsOf(jClose);
    const shortReason = await close(A, jClose, "court");
    const { error: rpcShort } = await A.client.rpc("close_job", {
      p_job_id: jClose,
      p_reason: "   court   ",
    });
    const longReason = await close(A, jClose, "x".repeat(501));
    report(
      "C0 motif obligatoire : vide ou trop court (route 400 closure_reason_required, RPC directe) et trop long (400) → rien n'est écrit",
      shortReason.status === 400 &&
        shortReason.body.code === "closure_reason_required" &&
        rpcShort?.message === "closure_reason_required" &&
        longReason.status === 400 &&
        longReason.body.code === "closure_reason_too_long" &&
        (await jobRow(jClose))?.status === "active" &&
        (await closuresOf(jClose)).length === 0,
      [shortReason.body.code, rpcShort?.message, longReason.body.code],
    );
    const since = new Date(Date.now() - 1000).toISOString();
    const c1 = await close(A, jClose);
    const closedRow = await jobRow(jClose);
    const appsAfter = await appsOf(jClose);
    const closures = await closuresOf(jClose);
    const notifs = await notifsOf(jClose);
    const audit = await auditOf(jClose);
    const notifiedUsers = notifs.map((n) => n.user_id).sort();
    report(
      "C1 clôture avec candidatures en cours : statut cancelled et closed_at, motif, auteur, statut précédent et compteurs enregistrés ensemble ; candidatures conservées telles quelles (en attente, présélection, retirée) ; audit unique",
      c1.status === 200 &&
        (c1.body.closure as { already_closed?: boolean })?.already_closed ===
          false &&
        (c1.body.closure as { notified_users?: number })?.notified_users ===
          3 &&
        closedRow?.status === "cancelled" &&
        !!closedRow.closed_at &&
        closures.length === 1 &&
        closures[0].reason === REASON &&
        closures[0].closed_by === idA &&
        closures[0].previous_status === "active" &&
        closures[0].open_applications === 3 &&
        JSON.stringify(appsAfter.map((a) => [a.id, a.status])) ===
          JSON.stringify(appsBefore.map((a) => [a.id, a.status])) &&
        appsAfter.find((a) => a.id === appW)?.status === "withdrawn" &&
        audit.length === 1 &&
        audit[0].actor_id === idA,
      { c1: c1.body, closures, audit: audit.length },
    );
    report(
      "C2 notifications : une seule par candidat en cours (en attente et présélection), aucune au candidat retiré ni à l'entreprise ; type « application_update », sans motif",
      notifs.length === 3 &&
        JSON.stringify(notifiedUsers) ===
          JSON.stringify([uid.c1, uid.c2, uid.c4].sort()) &&
        notifs.every(
          (n) =>
            n.notification_type === "application_update" &&
            !JSON.stringify(n).includes(REASON),
        ),
      notifs,
    );
    const c3 = await close(A, jClose);
    const c3b = await close(A, jClose, "Autre motif pour une relance.");
    report(
      "C3 relance après succès : même résultat (already_closed), ni nouvelle notification, ni audit, ni modification de la clôture",
      c3.status === 200 &&
        (c3.body.closure as { already_closed?: boolean })?.already_closed ===
          true &&
        (c3.body.closure as { closed_at?: string })?.closed_at ===
          (c1.body.closure as { closed_at?: string })?.closed_at &&
        c3b.status === 200 &&
        (await notifsOf(jClose)).length === 3 &&
        (await auditOf(jClose)).length === 1 &&
        JSON.stringify(await closuresOf(jClose)) === JSON.stringify(closures),
      { c3: c3.body, c3b: c3b.status },
    );
    const [ownClosure, cClosure, bClosure, anonClosure] = await Promise.all([
      A.client.from("job_closures").select("reason").eq("job_id", jClose),
      sess.c1.client.from("job_closures").select("reason").eq("job_id", jClose),
      sess.b.client.from("job_closures").select("reason").eq("job_id", jClose),
      anon.from("job_closures").select("reason").eq("job_id", jClose),
    ]);
    report(
      "C4 détail de la clôture (motif) : lisible par l'entreprise propriétaire, ni par le candidat, ni par une autre entreprise, ni par l'anonyme",
      ownClosure.data?.[0]?.reason === REASON &&
        (cClosure.data ?? []).length === 0 &&
        (bClosure.data ?? []).length === 0 &&
        (anonClosure.data ?? []).length === 0,
      [
        ownClosure.data?.length,
        cClosure.data?.length,
        bClosure.data?.length,
        anonClosure.data?.length ?? anonClosure.error?.code,
      ],
    );

    // ── V. Visibilité ────────────────────────────────────────────
    console.log("\n── V. Visibilité ──");
    const [readC1, readC5, readAnon, availC5, availAnon, listC5] =
      await Promise.all([
        sess.c1.client
          .from("jobs")
          .select("id, title, closed_at")
          .eq("id", jClose),
        sess.c5.client.from("jobs").select("id").eq("id", jClose),
        anon.from("jobs").select("id").eq("id", jClose),
        sess.c5.client.rpc("job_availability", { p_job_id: jClose }),
        anon.rpc("job_availability", { p_job_id: jClose }),
        sess.c5.client.from("jobs").select("id").eq("status", "active"),
      ]);
    const [applyC5, page] = await Promise.all([
      http("POST", `/api/jobs/${jClose}/apply`, sess.c5.cookie, {}),
      appFetch(`${APP_URL}/jobs/${jClose}`, {
        headers: { Cookie: sess.c1.cookie },
      }).then((r) => r.text()),
    ]);
    const pendingC1 = appsAfter.find((a) => a.candidate_id === prof.c1)!;
    const selectAfter = await signAndSelectRpc(A.client, pendingC1.id);
    const { error: rejectAfter } = await A.client
      .from("job_applications")
      .update({ status: "rejected" })
      .eq("id", pendingC1.id);
    report(
      "V1 offre clôturée : lisible par le candidat qui y a postulé (historique), invisible pour un nouveau candidat et l'anonyme, absente des offres ouvertes ; lien direct « closed_by_company » et page dédiée",
      readC1.data?.[0]?.closed_at === closedRow?.closed_at &&
        (readC5.data ?? []).length === 0 &&
        (readAnon.data ?? []).length === 0 &&
        availC5.data === "closed_by_company" &&
        availAnon.data === "closed_by_company" &&
        !(listC5.data ?? []).some((j) => j.id === jClose) &&
        page.includes("job-closed-by-company"),
      {
        c1: readC1.data?.length,
        c5: readC5.data?.length,
        avail: availC5.data,
        page: page.includes("job-closed-by-company"),
      },
    );
    // Retrait par le candidat : refusé aussi (candidature figée, historique).
    const withdrawAfter = await http(
      "DELETE",
      `/api/jobs/${jClose}/apply`,
      sess.c2.cookie,
    );
    const { error: withdrawRpc } = await sess.c2.client.rpc(
      "withdraw_job_application",
      { p_job_id: jClose },
    );
    report(
      "V2 après clôture : candidature refusée (lien direct, 400 job_not_available), sélection refusée, refus par l'entreprise refusé (job_closed), retrait par le candidat refusé (route 409 et RPC job_closed) ; candidatures figées",
      applyC5.status === 400 &&
        applyC5.body.code === "job_not_available" &&
        !!selectAfter.error &&
        /job_closed/.test(rejectAfter?.message ?? "") &&
        withdrawAfter.status === 409 &&
        withdrawAfter.body.code === "job_closed" &&
        /job_closed/.test(withdrawRpc?.message ?? "") &&
        (await appsOf(jClose)).find((a) => a.candidate_id === prof.c2)
          ?.status === "pending" &&
        (await appsOf(jClose)).find((a) => a.id === pendingC1.id)?.status ===
          "pending" &&
        !(await appsOf(jClose)).some((a) => a.candidate_id === prof.c5),
      {
        apply: applyC5.body.code,
        select: selectAfter.error?.message,
        reject: rejectAfter?.message,
        withdraw: withdrawAfter.body.code,
        withdrawRpc: withdrawRpc?.message,
      },
    );
    const myJobsC1 = await sess.c1.client
      .from("job_applications")
      .select("id, status, job:jobs(id, closed_at)")
      .eq("candidate_id", prof.c1)
      .eq("job_id", jClose);
    report(
      "V3 historique du candidat : sa candidature reste « pending » et l'offre jointe porte closed_at (affichée « Offre clôturée par l'entreprise », jamais un refus)",
      myJobsC1.data?.[0]?.status === "pending" &&
        !!(myJobsC1.data?.[0]?.job as { closed_at?: string } | null)?.closed_at,
      myJobsC1.data,
    );

    // ── E. Engagements ───────────────────────────────────────────
    console.log("\n── E. Engagements ──");
    const engaged = async (
      label: string,
      setup: (jobId: string) => Promise<void>,
    ) => {
      const jobId = await mkJob(label);
      await setup(jobId);
      const before = JSON.stringify([await jobRow(jobId), await appsOf(jobId)]);
      const viaRoute = await close(A, jobId);
      const { error: viaRpc } = await A.client.rpc("close_job", {
        p_job_id: jobId,
        p_reason: REASON,
      });
      const del = await http("DELETE", `/api/jobs/${jobId}`, A.cookie);
      const { data: actions } = await A.client.rpc("my_job_removal_actions");
      return (
        viaRoute.status === 409 &&
        viaRoute.body.code === "job_has_commitments" &&
        viaRpc?.message === "job_has_commitments" &&
        del.body.code === "job_has_commitments" &&
        (actions ?? []).find((a) => a.job_id === jobId)?.action === "support" &&
        JSON.stringify([await jobRow(jobId), await appsOf(jobId)]) === before &&
        (await closuresOf(jobId)).length === 0 &&
        (await notifsOf(jobId)).length === 0
      );
    };
    const eSel = await engaged("Engagement : sélectionné", async (jobId) => {
      const app = await apply("c6", jobId);
      await apply("c7", jobId);
      const sel = await signAndSelectRpc(A.client, app);
      if (sel.error) throw new Error(`select: ${sel.error.message}`);
    });
    const eMission = await engaged("Engagement : mission", async (jobId) => {
      const { error } = await serviceClient.from("missions").insert({
        job_id: jobId,
        candidate_id: prof.c6,
        scheduled_date: "2099-06-01",
        scheduled_start_time: "08:00",
        scheduled_end_time: "16:00",
      });
      if (error) throw new Error(`mission: ${error.message}`);
    });
    const eContract = await engaged("Engagement : contrat", async (jobId) => {
      const app = await apply("c6", jobId);
      await sess.c6.client.rpc("withdraw_job_application", {
        p_job_id: jobId,
      });
      const { error } = await serviceClient.from("contracts").insert({
        job_id: jobId,
        application_id: app,
        candidate_id: prof.c6,
        company_id: coA,
        contract_template: "simple",
      });
      if (error) throw new Error(`contract: ${error.message}`);
    });
    report(
      "E1 candidat sélectionné, mission seule, contrat sur une candidature retirée → clôture refusée (route et RPC 409 job_has_commitments) et suppression refusée ; écran : « contacter le support » ; rien n'est écrit",
      eSel && eMission && eContract,
      { eSel, eMission, eContract },
    );

    // ── D. Droits et chemins directs ─────────────────────────────
    console.log("\n── D. Droits ──");
    const jRights = await mkJob("Droits de clôture");
    await apply("c5", jRights);
    const rightsBefore = JSON.stringify(await jobRow(jRights));
    const dOther = await close(sess.b, jRights);
    const dAnonRoute = await close(null, jRights);
    const { error: dAnonRpc } = await anon.rpc("close_job", {
      p_job_id: jRights,
      p_reason: REASON,
    });
    const dCand = await close(sess.c5, jRights);
    await serviceClient
      .from("users")
      .update({ is_active: false })
      .eq("id", idS);
    const jSusp = await mkJob("Offre de l'entreprise suspendue", {
      company: coS,
    });
    const dSusp = await close(sess.s, jSusp);
    report(
      "D1 autre entreprise (404 job_not_found), anonyme (route 401, RPC refusée), candidat (403 not_a_company), compte entreprise suspendu (403 account_suspended) → refusés, rien n'est écrit",
      dOther.status === 404 &&
        dOther.body.code === "job_not_found" &&
        dAnonRoute.status === 401 &&
        !!dAnonRpc &&
        dCand.status === 403 &&
        dCand.body.code === "not_a_company" &&
        dSusp.status === 403 &&
        dSusp.body.code === "account_suspended" &&
        JSON.stringify(await jobRow(jRights)) === rightsBefore &&
        (await jobRow(jSusp))?.status === "active" &&
        (await closuresOf(jRights)).length === 0,
      [
        dOther.body.code,
        dAnonRoute.status,
        dAnonRpc?.message,
        dCand.body.code,
        dSusp.body.code,
      ],
    );
    const now = new Date().toISOString();
    const [dUpd, dDel, dIns, dInsClosure] = await Promise.all([
      A.client
        .from("jobs")
        .update({ status: "cancelled", closed_at: now })
        .eq("id", jRights)
        .select("id"),
      A.client.from("jobs").delete().eq("id", jPub).select("id"),
      sess.c5.client
        .from("job_applications")
        .insert({ job_id: jClose, candidate_id: prof.c5 })
        .select("id"),
      A.client
        .from("job_closures")
        .insert({
          job_id: jRights,
          company_id: coA,
          closed_by: idA,
          reason: REASON,
          previous_status: "active",
          open_applications: 0,
          notified_users: 0,
        })
        .select("job_id"),
    ]);
    // Clé service : une offre clôturée ne rouvre pas et ne reçoit plus de
    // candidature ; l'historique de clôture n'est pas réécrit.
    const { error: svcReopen } = await serviceClient
      .from("jobs")
      .update({ status: "active" })
      .eq("id", jClose);
    const { error: svcUnclose } = await serviceClient
      .from("jobs")
      .update({ closed_at: null })
      .eq("id", jClose);
    const { error: svcApply } = await serviceClient
      .from("job_applications")
      .insert({ job_id: jClose, candidate_id: prof.c6, status: "pending" });
    const { error: svcSelect } = await serviceClient
      .from("job_applications")
      .update({ status: "selected" })
      .eq("id", pendingC1.id);
    const { error: svcRewrite } = await serviceClient
      .from("job_closures")
      .update({ reason: "Motif réécrit après coup." })
      .eq("job_id", jClose);
    report(
      "D2 écritures directes en session refusées : clôture sans motif (UPDATE jobs), ancien chemin de suppression (DELETE jobs), candidature sur offre clôturée, ligne de clôture fabriquée",
      !!dUpd.error &&
        !!dDel.error &&
        !!dIns.error &&
        !!dInsClosure.error &&
        (await jobRow(jRights))?.status === "active" &&
        !!(await jobRow(jPub)),
      [
        dUpd.error?.code,
        dDel.error?.code,
        dIns.error?.code,
        dInsClosure.error?.code,
      ],
    );
    report(
      "D3 clé service : réouverture (statut ou closed_at), nouvelle candidature, sélection sur l'offre clôturée et réécriture du motif refusées",
      /job_closed/.test(svcReopen?.message ?? "") &&
        /job_closed/.test(svcUnclose?.message ?? "") &&
        /job_closed/.test(svcApply?.message ?? "") &&
        /job_closed/.test(svcSelect?.message ?? "") &&
        /append only/.test(svcRewrite?.message ?? "") &&
        (await jobRow(jClose))?.status === "cancelled",
      [
        svcReopen?.message,
        svcUnclose?.message,
        svcApply?.message,
        svcSelect?.message,
        svcRewrite?.message,
      ],
    );
    // ── H. Conservation de l'historique ─────────────────────────
    console.log("\n── H. Historique ──");
    const historyOf = async (jobId: string) =>
      JSON.stringify([
        await jobRow(jobId),
        await appsOf(jobId),
        await closuresOf(jobId),
        (await auditOf(jobId)).length,
        (await notifsOf(jobId)).length,
      ]);
    const closedHistory = await historyOf(jClose);
    const pubHistory = await historyOf(jPub);
    // Entreprise sans contrat (sa seule offre est publiée, sans engagement) :
    // seule la garde de l'historique peut refuser la cascade.
    const suspHistory = await historyOf(jSusp);
    const svcErr = async (
      p: PromiseLike<{ error: { message: string } | null }>,
    ) => (await p).error?.message ?? "";
    const [hJob, hApps, hClosure, hPub, hCompany, hCandidate] = [
      await svcErr(serviceClient.from("jobs").delete().eq("id", jClose)),
      await svcErr(
        serviceClient.from("job_applications").delete().eq("job_id", jClose),
      ),
      await svcErr(
        serviceClient.from("job_closures").delete().eq("job_id", jClose),
      ),
      await svcErr(serviceClient.from("jobs").delete().eq("id", jPub)),
      await svcErr(
        serviceClient.from("company_profiles").delete().eq("id", coS),
      ),
      await svcErr(
        serviceClient.from("candidate_profiles").delete().eq("id", prof.c1),
      ),
    ];
    report(
      "H1 clé service : suppression de l'offre clôturée, de ses candidatures, de sa clôture, d'une offre publiée sans clôture, et cascades (entreprise, profil candidat) → refusées (job_history_protected) ; offre, candidatures, clôture, audit et notifications intacts",
      [hJob, hApps, hClosure, hPub, hCompany, hCandidate].every((m) =>
        m.includes("job_history_protected"),
      ) &&
        (await historyOf(jClose)) === closedHistory &&
        (await historyOf(jPub)) === pubHistory &&
        (await historyOf(jSusp)) === suspHistory,
      { hJob, hApps, hClosure, hPub, hCompany, hCandidate },
    );
    const jSvcDraft = await mkJob("Brouillon supprimé en clé service", {
      status: "draft",
    });
    const { error: hDraftErr } = await serviceClient
      .from("jobs")
      .delete()
      .eq("id", jSvcDraft);
    report(
      "H2 offre jamais publiée : suppression toujours possible (clé service comme delete_job en S1)",
      !hDraftErr && !(await jobRow(jSvcDraft)),
      hDraftErr?.message,
    );
    const { data: actionsA } = await A.client.rpc("my_job_removal_actions");
    const actionOf = (id: string) =>
      (actionsA ?? []).find((a) => a.job_id === id)?.action;
    const notPublished = await mkJob("Brouillon : clôture refusée", {
      status: "draft",
    });
    const dDraftClose = await close(A, notPublished);
    report(
      "D4 actions proposées par la base : publiée → « close », revenue en modération → « close », clôturée → « closed » (motif lisible), brouillon → « delete » et sa clôture refusée (409 job_not_published)",
      actionOf(jPub) === "close" &&
        actionOf(jBack) === "close" &&
        actionOf(jClose) === "closed" &&
        (actionsA ?? []).find((a) => a.job_id === jClose)?.closure_reason ===
          REASON &&
        (await A.client.rpc("my_job_removal_actions")).data?.find(
          (a) => a.job_id === notPublished,
        )?.action === "delete" &&
        dDraftClose.status === 409 &&
        dDraftClose.body.code === "job_not_published",
      {
        pub: actionOf(jPub),
        back: actionOf(jBack),
        closed: actionOf(jClose),
        draft: dDraftClose.body.code,
      },
    );
    const backClose = await close(A, jBack);
    report(
      "D5 offre publiée puis revenue en modération → clôturable (statut précédent pending_review conservé)",
      backClose.status === 200 &&
        (await closuresOf(jBack))[0]?.previous_status === "pending_review" &&
        (await jobRow(jBack))?.status === "cancelled",
      backClose.body,
    );

    // ── P. Panne ────────────────────────────────────────────────
    console.log("\n── P. Panne ──");
    const jFail = await mkJob("Panne de clôture");
    await apply("c5", jFail);
    temp = true;
    execSql(`
      create or replace function public.proof_l17d1_fail_audit() returns trigger
      language plpgsql as $$ begin
        if new.resource_id = '${jFail}'::uuid and new.action = 'close_job' then
          raise exception 'proof_l17d1_forced_failure';
        end if;
        return new;
      end $$`);
    execSql(
      "create trigger proof_l17d1_fail_audit before insert on public.audit_logs for each row execute function public.proof_l17d1_fail_audit()",
    );
    const failBefore = JSON.stringify([
      await jobRow(jFail),
      await appsOf(jFail),
    ]);
    const pFail = await close(A, jFail);
    execSql(
      "drop trigger if exists proof_l17d1_fail_audit on public.audit_logs",
    );
    const failAfter = JSON.stringify([
      await jobRow(jFail),
      await appsOf(jFail),
    ]);
    const pRetry = await close(A, jFail);
    report(
      "P1 panne à l'écriture de la trace : 500 générique, aucun effet partiel (statut, closed_at, ligne de clôture, notifications) ; nouvel envoi ensuite → clôturée une fois",
      pFail.status === 500 &&
        !JSON.stringify(pFail.body).includes("proof_l17d1") &&
        failAfter === failBefore &&
        pRetry.status === 200 &&
        (await notifsOf(jFail)).length === 1 &&
        (await closuresOf(jFail)).length === 1,
      { fail: pFail.status, body: pFail.body, retry: pRetry.status },
    );

    // ── R. Courses à ordre imposé ────────────────────────────────
    console.log("\n── R. Courses ──");
    await installBarrier(execSql, serviceClient);
    // R1 : clôture engagée, puis candidature.
    const jR1 = await mkJob("Course clôture puis candidature");
    slowTrigger(
      "proof_l17d1_slow_close",
      "public.jobs",
      "before update",
      `new.id = '${jR1}'::uuid and new.closed_at is not null`,
    );
    const r1Close = close(A, jR1);
    await waitSleeping(serviceClient);
    const r1Apply = await http(
      "POST",
      `/api/jobs/${jR1}/apply`,
      sess.c6.cookie,
      {},
    );
    const r1CloseRes = await r1Close;
    execSql("drop trigger if exists proof_l17d1_slow_close on public.jobs");
    report(
      "R1 clôture engagée puis candidature : clôture réussie, candidature refusée (job_not_available), aucune candidature créée",
      r1CloseRes.status === 200 &&
        r1Apply.status === 400 &&
        r1Apply.body.code === "job_not_available" &&
        (await appsOf(jR1)).length === 0,
      { close: r1CloseRes.status, apply: r1Apply.body.code },
    );
    // R2 : candidature engagée, puis clôture.
    const jR2 = await mkJob("Course candidature puis clôture");
    slowTrigger(
      "proof_l17d1_slow_apply",
      "public.job_applications",
      "after insert",
      `new.job_id = '${jR2}'::uuid`,
    );
    const r2Apply = http("POST", `/api/jobs/${jR2}/apply`, sess.c6.cookie, {});
    await waitSleeping(serviceClient);
    const r2Close = await close(A, jR2);
    const r2ApplyRes = await r2Apply;
    execSql(
      "drop trigger if exists proof_l17d1_slow_apply on public.job_applications",
    );
    const r2Notifs = await notifsOf(jR2);
    report(
      "R2 candidature engagée puis clôture : la clôture attend, réussit et prévient aussi ce candidat (une notification) ; candidature conservée en attente",
      r2ApplyRes.status === 200 &&
        r2Close.status === 200 &&
        (r2Close.body.closure as { notified_users?: number })
          ?.notified_users === 1 &&
        r2Notifs.length === 1 &&
        r2Notifs[0].user_id === uid.c6 &&
        (await appsOf(jR2))[0]?.status === "pending",
      { apply: r2ApplyRes.status, close: r2Close.body },
    );
    // R3 : clôture engagée, puis sélection.
    const jR3 = await mkJob("Course clôture puis sélection");
    const appR3 = await apply("c7", jR3);
    slowTrigger(
      "proof_l17d1_slow_close",
      "public.jobs",
      "before update",
      `new.id = '${jR3}'::uuid and new.closed_at is not null`,
    );
    const r3Close = close(A, jR3);
    await waitSleeping(serviceClient);
    const r3Select = await signAndSelectRpc(A.client, appR3);
    const r3CloseRes = await r3Close;
    execSql("drop trigger if exists proof_l17d1_slow_close on public.jobs");
    const { count: r3Missions } = await serviceClient
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jR3);
    report(
      "R3 clôture engagée puis sélection : clôture réussie, sélection refusée (job_not_available), candidature en attente, aucune mission ni contrat",
      r3CloseRes.status === 200 &&
        r3Select.error?.message === "job_not_available" &&
        (await appsOf(jR3))[0]?.status === "pending" &&
        (r3Missions ?? 0) === 0,
      { close: r3CloseRes.status, select: r3Select.error?.message },
    );
    // R4 : sélection engagée, puis clôture.
    const jR4 = await mkJob("Course sélection puis clôture");
    const appR4 = await apply("c7", jR4);
    slowTrigger(
      "proof_l17d1_slow_select",
      "public.job_applications",
      "after update",
      `new.id = '${appR4}'::uuid and new.status = 'selected'`,
    );
    const r4Select = signAndSelectRpc(A.client, appR4);
    await waitSleeping(serviceClient);
    const r4Close = await close(A, jR4);
    const r4SelectRes = await r4Select;
    execSql(
      "drop trigger if exists proof_l17d1_slow_select on public.job_applications",
    );
    report(
      "R4 sélection engagée puis clôture : sélection réussie, clôture refusée (409 job_has_commitments), aucune ligne de clôture ni notification",
      !r4SelectRes.error &&
        r4Close.status === 409 &&
        r4Close.body.code === "job_has_commitments" &&
        (await jobRow(jR4))?.status === "active" &&
        (await closuresOf(jR4)).length === 0 &&
        (await notifsOf(jR4)).length === 0,
      { select: r4SelectRes.error?.message, close: r4Close.body.code },
    );
    dropTemp();
    dropBarrier(execSql);
    temp = false;

    // ── G. Dossier entreprise ───────────────────────────────────
    console.log("\n── G. Dossier entreprise ──");
    const jDossier = await mkJob("Clôture pendant la revue du dossier");
    await apply("c5", jDossier);
    await serviceClient
      .from("company_profiles")
      .update({ verification_status: "pending" })
      .eq("id", coA);
    const gClose = await close(A, jDossier);
    await approveCompanyDossier(serviceClient, coA);
    const { error: gPatchErr } = await A.client.rpc("update_job", {
      p_job_id: jDossier,
      p_job: { title: "Réouverture tentée par modification" },
    });
    const gPatch = { body: { code: gPatchErr?.message }, status: 409 };
    const [gRow, gAvail] = await Promise.all([
      jobRow(jDossier),
      sess.c5.client.rpc("job_availability", { p_job_id: jDossier }),
    ]);
    report(
      "G1 dossier en revue : clôture possible ; après revalidation du dossier, l'offre reste clôturée (statut, disponibilité), modification refusée (job_not_editable) : aucune réouverture silencieuse",
      gClose.status === 200 &&
        gRow?.status === "cancelled" &&
        !!gRow.closed_at &&
        gAvail.data === "closed_by_company" &&
        gPatch.status === 409 &&
        gPatch.body.code === "job_not_editable",
      { close: gClose.body.code ?? gClose.status, patch: gPatch.body.code },
    );

    // ── M. Plusieurs journées ───────────────────────────────────
    console.log("\n── M. Plusieurs journées ──");
    const perDays: FixtureDay[] = [1, 2, 3].map(() => ({
      date: nextDate(),
      start_time: "08:00",
      end_time: "14:00",
      pay: 6000,
      positions: 1,
    }));
    const { jobId: jPer, dayIds: perIds } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Journées au choix (clôture entière)",
        company_id: coA,
        mission_pay_per_candidate: 6000,
        positions_available: 3,
      },
      perDays,
      "per_day",
    );
    await sess.c5.client.rpc("apply_to_job_days", {
      p_job_id: jPer,
      p_day_ids: perIds.slice(0, 2),
    });
    const daysBefore = JSON.stringify(
      (
        await serviceClient
          .from("job_days")
          .select("id, day_date, applications_close_at, positions_filled")
          .eq("job_id", jPer)
          .order("day_date")
      ).data,
    );
    const mClose = await close(A, jPer);
    const daysAfter = JSON.stringify(
      (
        await serviceClient
          .from("job_days")
          .select("id, day_date, applications_close_at, positions_filled")
          .eq("job_id", jPer)
          .order("day_date")
      ).data,
    );
    const { error: mApply } = await sess.c6.client.rpc("apply_to_job_days", {
      p_job_id: jPer,
      p_day_ids: [perIds[2]],
    });
    report(
      "M1 journées au choix : clôture de l'offre entière, calendrier et échéances inchangés, deux candidatures par journée conservées, une seule notification au candidat, nouvelle candidature sur une journée refusée",
      mClose.status === 200 &&
        daysAfter === daysBefore &&
        (await appsOf(jPer)).filter((a) => a.status === "pending").length ===
          2 &&
        (await notifsOf(jPer)).length === 1 &&
        !!mApply,
      { close: mClose.body, apply: mApply?.message },
    );
    const { jobId: jPer2, dayIds: per2Ids } = await insertJobWithDays(
      serviceClient,
      {
        ...CONTENT,
        title: "Journées au choix (une journée engagée)",
        company_id: coA,
        mission_pay_per_candidate: 6000,
        positions_available: 2,
      },
      [1, 2].map(() => ({
        date: nextDate(),
        start_time: "08:00",
        end_time: "14:00",
        pay: 6000,
        positions: 1,
      })),
      "per_day",
    );
    await sess.c7.client.rpc("apply_to_job_days", {
      p_job_id: jPer2,
      p_day_ids: per2Ids,
    });
    const per2Apps = await appsOf(jPer2);
    const sel2 = await signAndSelectRpc(A.client, per2Apps[0].id);
    if (sel2.error) throw new Error(`select per2: ${sel2.error.message}`);
    const m2 = await close(A, jPer2);
    report(
      "M2 une journée engagée (sélection) → toute l'offre refusée (job_has_commitments), aucune clôture partielle de journées",
      m2.status === 409 &&
        m2.body.code === "job_has_commitments" &&
        (await jobRow(jPer2))?.status === "active" &&
        (await closuresOf(jPer2)).length === 0,
      m2.body,
    );

    // ── T. Signaux ──────────────────────────────────────────────
    execSql(`
      create or replace function public.proof_l17d1_messages(p_topic text, p_since timestamptz)
      returns jsonb language sql security definer set search_path = '' as $$
        select coalesce(jsonb_agg(m.payload order by m.inserted_at), '[]'::jsonb)
        from realtime.messages m where m.topic = p_topic and m.inserted_at >= p_since;
      $$`);
    execSql(
      "revoke all on function public.proof_l17d1_messages(text, timestamptz) from public, anon, authenticated",
    );
    execSql("notify pgrst, 'reload schema'");
    const messages = async (topic: string) => {
      const end = Date.now() + 15_000;
      for (;;) {
        const { data, error } = await serviceRpc.rpc("proof_l17d1_messages", {
          p_topic: topic,
          p_since: since,
        });
        if (!error) return (data ?? []) as Record<string, unknown>[];
        if (Date.now() > end) throw new Error(error.message);
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    const [mC1, mA, mPub] = await Promise.all([
      messages(`user:${uid.c1}`),
      messages(`user:${idA}`),
      messages("jobs:public"),
    ]);
    const hits = (list: Record<string, unknown>[]) =>
      list.filter((p) => p.d === "jobs" && p.r === jClose);
    report(
      "T1 signaux de la clôture : candidat ayant postulé, entreprise et canal public (domaine jobs, ressource) ; charge { d, r } seule, sans motif",
      hits(mC1).length >= 1 &&
        hits(mA).length >= 1 &&
        hits(mPub).length >= 1 &&
        [...hits(mC1), ...hits(mA), ...hits(mPub)].every((p) =>
          Object.keys(p).every((k) => ["d", "r", "id"].includes(k)),
        ),
      { c1: hits(mC1).length, a: hits(mA).length, pub: hits(mPub).length },
    );
  } catch (error) {
    failCount += 1;
    console.error("❌ Erreur inattendue :", error);
  } finally {
    if (temp) {
      try {
        dropTemp();
        dropBarrier(execSql);
      } catch {
        /* restes retirés au démarrage suivant */
      }
    }
    try {
      execSql(
        "drop function if exists public.proof_l17d1_messages(text, timestamptz)",
      );
    } catch {
      /* idem */
    }
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} réussies, ${failCount} en échec`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
