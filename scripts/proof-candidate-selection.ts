/**
 * Preuve lot 7a (F-10 partie sélection, F-16) — sélection atomique et
 * visibilité des candidats.
 *
 * Méthode :
 *   1. Fixtures en service role : entreprises A et B (vérifiées), candidats
 *      éligibles C1 à C4 (C1 avec photo, téléphone, CNI, MoMo, adresse),
 *      offres actives, candidatures. Les candidatures sont créées par
 *      apply_to_job en session candidat.
 *   2. Tentatives en sessions RÉELLES : routes de l'application avec les
 *      cookies, PostgREST et RPC directs avec le JWT. La clé service ne sert
 *      qu'aux fixtures, aux pannes provoquées et aux relectures.
 *   3. Assertions (état relu en service role) :
 *      S. Sélection : mission, contrat et notification créés, place consommée ;
 *         relance et double clic sans doublon ; dernière place disputée ;
 *         offre complète ; panne provoquée sans effet partiel ; format du
 *         contrat selon la durée.
 *      R. Refus : sélection directe, remise en cause d'une sélection,
 *         écriture directe de missions et contrats, autre entreprise,
 *         candidat, anonyme, candidature retirée ou refusée, offre non
 *         publiée, sélection antérieure sans mission ; présélection et refus
 *         légitimes préservés.
 *      C. Concurrence avec le retrait et la suppression de l'offre, ordres
 *         forcés par un ralentissement temporaire.
 *      F. F-16 : profils entreprise, profils candidats, liste des
 *         candidatures (colonnes et absence de données sensibles), vitrine
 *         publique des entreprises.
 *   4. Nettoyage : objets de stockage, contrats, missions, candidatures,
 *      offres, notifications, profils, comptes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import { approveCompanyDossier } from "./lib/verified-company";
import { appFetch } from "./lib/app-fetch";
import { runSupabaseQuery } from "./lib/db-query";

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

// Pile locale uniquement (refus de toute cible distante) — voir
// docs/testing/local-proofs.md.
const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
  appUrl: APP_URL,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L7a-select-01!";
const PROOF_USER_METADATA = { proofCandidateSelection: true };
const BUCKET = "candidate-documents";

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

// ─── SQL local (pannes et ralentissements provoqués, pile dédiée) ─
// La CLI n'exécute qu'une instruction par appel.
function execSql(sql: string) {
  const r = runSupabaseQuery(DB_URL, sql, { proof: "candidate-selection" });
  if (r.status !== 0) {
    throw new Error(`supabase db query : ${r.out.slice(0, 300)}`);
  }
}

const TEMP_TRIGGERS: [string, string, string][] = [
  ["proof_l7a_fail_notification", "public.notifications", "proof_l7a_fail()"],
  ["proof_l7a_slow_application", "public.job_applications", "proof_l7a_slow()"],
  ["proof_l7a_slow_job_delete", "public.jobs", "proof_l7a_slow_delete()"],
];
function dropTempTriggers() {
  for (const [trigger, table, fn] of TEMP_TRIGGERS) {
    execSql(`drop trigger if exists ${trigger} on ${table}`);
    execSql(`drop function if exists public.${fn}`);
  }
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
        ? `+2376990${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`
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
      niu: `M7A${String(Date.now()).slice(-9)}${name.length}`,
      contact_email: `contact-${userId.slice(0, 8)}@proof.easyjob.cm`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company insert: ${error?.message}`);
  // Lot 11 : dossier complet et contrôlé, sinon create_job refuse.
  await approveCompanyDossier(serviceClient, data.id);
  return data.id;
}

const SECRETS = {
  lastName: "Ndongmo",
  cniNumber: "CNI7A000123",
  momoNumber: "+237677007001",
  address: "Carrefour Ndokoti, porte bleue",
};

async function createCandidate(
  userId: string,
  firstName: string,
  withPhoto: boolean,
): Promise<string> {
  const photo = withPhoto ? `${userId}/profile_photo_url-proof.png` : null;
  if (photo) {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const { error } = await serviceClient.storage
      .from(BUCKET)
      .upload(photo, png, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`photo upload: ${error.message}`);
  }
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
      bio: "Candidat de preuve du lot 7a.",
      profile_photo_url: photo,
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
      .filter((u) => u.user_metadata?.proofCandidateSelection === true)
      .map((u) => u.id),
  );
}

// ─── Requêtes ────────────────────────────────────────────────────
const JOB_BODY = {
  title: "Serveur preuve L7a",
  description: "Service en salle, preuve du lot 7a.",
  address: "Rue de la preuve",
  city: "Douala",
  start_date: "2099-02-10",
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
  method: "GET" | "POST" | "DELETE",
  url: string,
  cookie: string | null,
): Promise<HttpResult> {
  const send = () =>
    appFetch(`${APP_URL}${url}`, {
      method,
      headers: cookie ? { Cookie: cookie } : {},
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  await cleanStaleProofs();
  // Exécution précédente interrompue (base coupée, délai dépassé) : son
  // `finally` n'a pas pu s'exécuter. Restes retirés et protections
  // réactivées AVANT toute assertion (lot 10).
  dropTempTriggers();

  const suffix = Date.now();
  const mail = (k: string) => `l7a-${k}+${suffix}@proof.easyjob.cm`;
  const ids: string[] = [];
  let tempTriggers = false;

  try {
    const idA = await createAccount(mail("a"), "company");
    const idB = await createAccount(mail("b"), "company");
    const idZ = await createAccount(mail("z"), "company");
    const candidateUsers = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => createAccount(mail(k), "candidate")),
    );
    ids.push(idA, idB, idZ, ...candidateUsers);
    const [idC1, idC2, idC3, idC4] = candidateUsers;

    const coA = await createCompany(idA, "Restaurant A");
    const coB = await createCompany(idB, "Hôtel B");
    await createCompany(idZ, "Société Z sans offre");
    const candIds = await Promise.all([
      createCandidate(idC1, "Aline", true),
      createCandidate(idC2, "Boris", false),
      createCandidate(idC3, "Carine", false),
      createCandidate(idC4, "Didier", false),
    ]);
    const [cand1, cand2] = candIds;

    const A = await realSession(mail("a"));
    const B = await realSession(mail("b"));
    const Z = await realSession(mail("z"));
    const C = await Promise.all(
      ["c1", "c2", "c3", "c4"].map((k) => realSession(mail(k))),
    );
    const anon: DB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    async function seedJob(
      companyId: string,
      extra: Partial<JobInsert> = {},
    ): Promise<string> {
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          ...JOB_BODY,
          company_id: companyId,
          status: "active",
          ...extra,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`job seed: ${error?.message}`);
      return data.id;
    }

    /** Candidature réelle (apply_to_job en session candidat). */
    async function apply(candidate: Session, jobId: string): Promise<string> {
      const { data, error } = await candidate.client.rpc("apply_to_job", {
        p_job_id: jobId,
      });
      if (error || !data) throw new Error(`apply: ${error?.message}`);
      return data.id;
    }

    const select = (session: Session, applicationId: string) =>
      http("POST", `/api/applications/${applicationId}/select`, session.cookie);

    async function state(applicationId: string) {
      const [{ data: app }, { data: missions }, { data: contracts }, notif] =
        await Promise.all([
          serviceClient
            .from("job_applications")
            .select("status, selected_by, job_id")
            .eq("id", applicationId)
            .maybeSingle(),
          serviceClient
            .from("missions")
            .select(
              "id, status, job_id, candidate_id, contract_type, scheduled_date",
            )
            .eq("application_id", applicationId),
          serviceClient
            .from("contracts")
            .select(
              "id, status, company_id, candidate_id, contract_template, contract_data",
            )
            .eq("application_id", applicationId),
          serviceClient
            .from("notifications")
            .select("user_id, notification_type, data")
            .eq("data->>application_id", applicationId),
        ]);
      return {
        app,
        missions: missions ?? [],
        contracts: contracts ?? [],
        notifications: notif.data ?? [],
      };
    }

    async function filled(jobId: string) {
      const { data } = await serviceClient
        .from("jobs")
        .select("positions_filled")
        .eq("id", jobId)
        .maybeSingle();
      return data?.positions_filled ?? null;
    }

    // ── S. Sélection ─────────────────────────────────────────────
    const jMain = await seedJob(coA, { positions_available: 2 });
    const app1 = await apply(C[0], jMain);
    const app2 = await apply(C[1], jMain);
    const app3 = await apply(C[2], jMain);

    const s1 = await select(A, app1);
    const st1 = await state(app1);
    const sel1 = s1.body.selection as Record<string, unknown> | undefined;
    report(
      "S1 : sélection → candidature selected, une mission et un contrat pending liés aux parties",
      s1.status === 200 &&
        sel1?.already_selected === false &&
        st1.app?.status === "selected" &&
        st1.app.selected_by === idA &&
        st1.missions.length === 1 &&
        st1.missions[0].status === "pending" &&
        st1.missions[0].job_id === jMain &&
        st1.missions[0].candidate_id === cand1 &&
        st1.missions[0].scheduled_date === JOB_BODY.start_date &&
        st1.missions[0].contract_type === "simple" &&
        st1.contracts.length === 1 &&
        st1.contracts[0].status === "pending" &&
        st1.contracts[0].company_id === coA &&
        st1.contracts[0].candidate_id === cand1 &&
        st1.contracts[0].contract_template === "simple" &&
        (st1.contracts[0].contract_data as Record<string, unknown> | null)
          ?.job_title === JOB_BODY.title &&
        sel1?.mission_id === st1.missions[0].id &&
        sel1?.contract_id === st1.contracts[0].id,
      {
        status: s1.status,
        missions: st1.missions.length,
        contracts: st1.contracts.length,
      },
    );
    report(
      "S2 : une notification au candidat, une place consommée",
      st1.notifications.length === 1 &&
        st1.notifications[0].user_id === idC1 &&
        st1.notifications[0].notification_type === "application_update" &&
        (await filled(jMain)) === 1,
      { notifications: st1.notifications.length, filled: await filled(jMain) },
    );

    const s3 = await select(A, app1);
    const st3 = await state(app1);
    const sel3 = s3.body.selection as Record<string, unknown> | undefined;
    report(
      "S3 : relance (réponse perdue) → mêmes liens, already_selected, aucun doublon ni incrément",
      s3.status === 200 &&
        sel3?.already_selected === true &&
        sel3.mission_id === sel1?.mission_id &&
        sel3.contract_id === sel1?.contract_id &&
        st3.missions.length === 1 &&
        st3.contracts.length === 1 &&
        st3.notifications.length === 1 &&
        (await filled(jMain)) === 1,
      { status: s3.status, already: sel3?.already_selected },
    );

    const double = await Promise.all([select(A, app2), select(A, app2)]);
    const st4 = await state(app2);
    report(
      "S4 : double clic simultané → deux 200, une mission, un contrat, une notification, une place",
      double.every((r) => r.status === 200) &&
        st4.missions.length === 1 &&
        st4.contracts.length === 1 &&
        st4.notifications.length === 1 &&
        (await filled(jMain)) === 2,
      double.map((r) => [
        r.status,
        (r.body.selection as { already_selected?: boolean })?.already_selected,
      ]),
    );

    const s5 = await select(A, app3);
    const st5 = await state(app3);
    report(
      "S5 : offre complète → 409 no_positions, rien créé",
      s5.status === 409 &&
        s5.body.code === "no_positions" &&
        st5.app?.status === "pending" &&
        st5.missions.length === 0 &&
        st5.contracts.length === 0 &&
        st5.notifications.length === 0 &&
        (await filled(jMain)) === 2,
      s5.body,
    );

    const jRace = await seedJob(coA, { positions_available: 1 });
    const r1 = await apply(C[0], jRace);
    const r2 = await apply(C[1], jRace);
    const race = await Promise.all([select(A, r1), select(A, r2)]);
    const [stR1, stR2] = await Promise.all([state(r1), state(r2)]);
    const winners = race.filter((r) => r.status === 200).length;
    const losers = race.filter(
      (r) => r.status === 409 && r.body.code === "no_positions",
    ).length;
    report(
      "S6 : deux candidatures pour la dernière place → une sélection, une mission, un contrat, une notification",
      winners === 1 &&
        losers === 1 &&
        stR1.missions.length + stR2.missions.length === 1 &&
        stR1.contracts.length + stR2.contracts.length === 1 &&
        stR1.notifications.length + stR2.notifications.length === 1 &&
        [stR1.app?.status, stR2.app?.status].sort().join() ===
          "pending,selected" &&
        (await filled(jRace)) === 1,
      race.map((r) => [r.status, r.body.code ?? "ok"]),
    );

    // Panne provoquée à l'écriture de la notification.
    const jFail = await seedJob(coA);
    const appFail = await apply(C[3], jFail);
    tempTriggers = true;
    execSql(`
      create or replace function public.proof_l7a_fail() returns trigger
      language plpgsql as $$ begin
        if new.data->>'application_id' = '${appFail}' then
          raise exception 'proof_l7a_forced_failure';
        end if;
        return new;
      end $$
    `);
    execSql(`
      create trigger proof_l7a_fail_notification before insert on public.notifications
        for each row execute function public.proof_l7a_fail()
    `);
    const s7 = await select(A, appFail);
    const st7 = await state(appFail);
    report(
      "S7 : échec provoqué en fin de transaction → 500, candidature en attente, ni mission, ni contrat, ni place",
      s7.status === 500 &&
        st7.app?.status === "pending" &&
        st7.missions.length === 0 &&
        st7.contracts.length === 0 &&
        (await filled(jFail)) === 0,
      { status: s7.status, app: st7.app?.status },
    );
    dropTempTriggers();
    const s7b = await select(A, appFail);
    report(
      "S8 : après la panne, la même sélection réussit une seule fois",
      s7b.status === 200 &&
        (await state(appFail)).missions.length === 1 &&
        (await filled(jFail)) === 1,
      s7b.status,
    );

    const jLong = await seedJob(coA, { end_date: "2099-02-13" });
    const appLong = await apply(C[0], jLong);
    await select(A, appLong);
    const stLong = await state(appLong);
    report(
      "S9 : mission de 3 jours ou plus → contrat formalisé (SRS §6.7)",
      stLong.missions[0]?.contract_type === "formal" &&
        stLong.contracts[0]?.contract_template === "formal",
      stLong.contracts[0]?.contract_template,
    );

    // ── R. Refus ─────────────────────────────────────────────────
    const jR = await seedJob(coA, { positions_available: 5 });
    const appR = await apply(C[1], jR);

    async function expectAppUpdateRefused(
      label: string,
      client: DB,
      applicationId: string,
      values: Database["public"]["Tables"]["job_applications"]["Update"],
    ) {
      const before = await state(applicationId);
      const filledBefore = await filled(before.app?.job_id ?? "");
      const { data, error } = await client
        .from("job_applications")
        .update(values)
        .eq("id", applicationId)
        .select("id");
      const after = await state(applicationId);
      report(
        label,
        !!error &&
          (data ?? []).length === 0 &&
          JSON.stringify(before) === JSON.stringify(after) &&
          (await filled(after.app?.job_id ?? "")) === filledBefore,
        { code: error?.code, message: error?.message?.slice(0, 60) },
      );
    }

    await expectAppUpdateRefused(
      "R1 : passage direct à selected → refusé, ni mission ni place",
      A.client,
      appR,
      {
        status: "selected",
        selected_by: idA,
        selected_at: new Date().toISOString(),
      },
    );
    await expectAppUpdateRefused(
      "R2 : selected_at / selected_by écrits seuls → refusé",
      A.client,
      appR,
      { selected_at: new Date().toISOString() },
    );
    await expectAppUpdateRefused(
      "R3 : candidature sélectionnée remise en refus → refusé, place, mission et contrat conservés",
      A.client,
      app1,
      { status: "rejected", rejection_reason: "Libérer la place" },
    );
    await expectAppUpdateRefused(
      "R4 : candidature sélectionnée remise en présélection → refusé",
      A.client,
      app1,
      { status: "shortlisted" },
    );

    const { error: insMissionErr } = await A.client.from("missions").insert({
      job_id: jR,
      candidate_id: cand2,
      application_id: appR,
      scheduled_date: JOB_BODY.start_date,
      scheduled_start_time: JOB_BODY.start_time,
      scheduled_end_time: JOB_BODY.end_time,
    });
    const { error: insContractErr } = await A.client.from("contracts").insert({
      job_id: jR,
      application_id: appR,
      candidate_id: cand2,
      company_id: coA,
      contract_template: "simple",
    });
    const { data: delMission, error: delMissionErr } = await A.client
      .from("missions")
      .delete()
      .eq("application_id", app1)
      .select("id");
    report(
      "R5 : INSERT direct de mission ou de contrat, suppression d'une mission → refusés",
      !!insMissionErr &&
        !!insContractErr &&
        (!!delMissionErr || (delMission ?? []).length === 0) &&
        (await state(appR)).missions.length === 0 &&
        (await state(app1)).missions.length === 1,
      {
        mission: insMissionErr?.code,
        contract: insContractErr?.code,
        delete: delMissionErr?.code ?? delMission?.length,
      },
    );

    const r6 = await select(B, appR);
    const { error: r7Err } = await C[1].client.rpc("select_candidate", {
      p_application_id: appR,
    });
    const { error: r8Err } = await anon.rpc("select_candidate", {
      p_application_id: appR,
    });
    const stR = await state(appR);
    report(
      "R6-R8 : autre entreprise (404), candidat (RPC) et anonyme → refusés, rien créé",
      r6.status === 404 &&
        r6.body.code === "application_not_found" &&
        r7Err?.message === "not_a_company" &&
        !!r8Err &&
        stR.app?.status === "pending" &&
        stR.missions.length === 0,
      { b: r6.status, candidate: r7Err?.message, anon: r8Err?.message },
    );

    const appW = await apply(C[2], jR);
    await C[2].client.rpc("withdraw_job_application", { p_job_id: jR });
    const r9 = await select(A, appW);
    report(
      "R9 : candidature retirée → 409 application_not_selectable",
      r9.status === 409 &&
        r9.body.code === "application_not_selectable" &&
        (await state(appW)).missions.length === 0,
      r9.body,
    );

    const appS = await apply(C[3], jR);
    const { data: shortRows, error: shortErr } = await A.client
      .from("job_applications")
      .update({ status: "shortlisted" })
      .eq("id", appS)
      .select("status");
    const { data: rejRows, error: rejErr } = await A.client
      .from("job_applications")
      .update({ status: "rejected", rejection_reason: "Profil incomplet" })
      .eq("id", appS)
      .select("status");
    const r10 = await select(A, appS);
    report(
      "R10 : présélection puis refus légitimes préservés ; candidature refusée non sélectionnable",
      !shortErr &&
        shortRows?.[0]?.status === "shortlisted" &&
        !rejErr &&
        rejRows?.[0]?.status === "rejected" &&
        r10.status === 409 &&
        r10.body.code === "application_not_selectable",
      {
        short: shortErr?.message,
        reject: rejErr?.message,
        select: r10.body.code,
      },
    );

    const jShort = await seedJob(coA);
    const appSh = await apply(C[0], jShort);
    await A.client
      .from("job_applications")
      .update({ status: "shortlisted" })
      .eq("id", appSh);
    const r11 = await select(A, appSh);
    report(
      "R11 : candidature présélectionnée → sélectionnable",
      r11.status === 200 && (await state(appSh)).missions.length === 1,
      r11.status,
    );

    const jPending = await seedJob(coA);
    const appP = await apply(C[1], jPending);
    await serviceClient
      .from("jobs")
      .update({ status: "pending_review" })
      .eq("id", jPending);
    const r12 = await select(A, appP);
    report(
      "R12 : offre repassée en modération → 409 job_not_available",
      r12.status === 409 && r12.body.code === "job_not_available",
      r12.body,
    );

    const jLegacy = await seedJob(coA);
    const appL = await apply(C[2], jLegacy);
    await serviceClient
      .from("job_applications")
      .update({ status: "selected", selected_by: idA })
      .eq("id", appL);
    const r13 = await select(A, appL);
    report(
      "R13 : sélection antérieure sans mission ni contrat → 409 selection_incomplete, aucun succès annoncé",
      r13.status === 409 &&
        r13.body.code === "selection_incomplete" &&
        (await state(appL)).missions.length === 0,
      r13.body,
    );

    // ── C. Concurrence avec le retrait et la suppression ─────────
    function createSlowApplication(applicationId: string) {
      execSql(`
        create or replace function public.proof_l7a_slow() returns trigger
        language plpgsql as $$ begin
          if new.id = '${applicationId}'::uuid then perform pg_sleep(1.5); end if;
          return null;
        end $$
      `);
      execSql(`
        create trigger proof_l7a_slow_application after update on public.job_applications
          for each row execute function public.proof_l7a_slow()
      `);
    }

    tempTriggers = true;
    // Sélection engagée, puis retrait.
    const jC1 = await seedJob(coA);
    const appC1 = await apply(C[3], jC1);
    createSlowApplication(appC1);
    const [c1Select, c1Withdraw] = await Promise.all([
      select(A, appC1),
      delay(400).then(() =>
        C[3].client.rpc("withdraw_job_application", { p_job_id: jC1 }),
      ),
    ]);
    const stC1 = await state(appC1);
    report(
      "C1 : sélection engagée puis retrait → sélection conservée, retrait refusé",
      c1Select.status === 200 &&
        c1Withdraw.error?.message === "application_not_withdrawable" &&
        stC1.app?.status === "selected" &&
        stC1.missions.length === 1,
      { select: c1Select.status, withdraw: c1Withdraw.error?.message },
    );
    dropTempTriggers();

    // Retrait engagé, puis sélection.
    const jC2 = await seedJob(coA);
    const appC2 = await apply(C[3], jC2);
    createSlowApplication(appC2);
    const [c2Withdraw, c2Select] = await Promise.all([
      C[3].client.rpc("withdraw_job_application", { p_job_id: jC2 }),
      delay(400).then(() => select(A, appC2)),
    ]);
    const stC2 = await state(appC2);
    report(
      "C2 : retrait engagé puis sélection → candidature retirée, sélection refusée, rien créé",
      !c2Withdraw.error &&
        c2Select.status === 409 &&
        c2Select.body.code === "application_not_selectable" &&
        stC2.app?.status === "withdrawn" &&
        stC2.missions.length === 0 &&
        (await filled(jC2)) === 0,
      {
        withdraw: c2Withdraw.error?.message ?? "ok",
        select: c2Select.body.code,
      },
    );
    dropTempTriggers();

    // Sélection engagée, puis suppression de l'offre.
    const jC3 = await seedJob(coA);
    const appC3 = await apply(C[0], jC3);
    createSlowApplication(appC3);
    const [c3Select, c3Delete] = await Promise.all([
      select(A, appC3),
      delay(400).then(() => http("DELETE", `/api/jobs/${jC3}`, A.cookie)),
    ]);
    const stC3 = await state(appC3);
    report(
      "C3 : sélection engagée puis suppression → 409 job_has_commitments, offre, mission et contrat conservés",
      c3Select.status === 200 &&
        c3Delete.status === 409 &&
        c3Delete.body.code === "job_has_commitments" &&
        (await filled(jC3)) === 1 &&
        stC3.missions.length === 1 &&
        stC3.contracts.length === 1,
      { select: c3Select.status, delete: c3Delete.status },
    );
    dropTempTriggers();

    // Suppression engagée, puis sélection.
    const jC4 = await seedJob(coA);
    const appC4 = await apply(C[1], jC4);
    execSql(`
      create or replace function public.proof_l7a_slow_delete() returns trigger
      language plpgsql as $$ begin
        if old.id = '${jC4}'::uuid then perform pg_sleep(1.5); end if;
        return old;
      end $$
    `);
    execSql(`
      create trigger proof_l7a_slow_job_delete before delete on public.jobs
        for each row execute function public.proof_l7a_slow_delete()
    `);
    const [c4Delete, c4Select] = await Promise.all([
      http("DELETE", `/api/jobs/${jC4}`, A.cookie),
      delay(400).then(() => select(A, appC4)),
    ]);
    const stC4 = await state(appC4);
    report(
      "C4 : suppression engagée puis sélection → offre supprimée, sélection 404, aucune mission orpheline",
      c4Delete.status === 200 &&
        c4Select.status === 404 &&
        c4Select.body.code === "application_not_found" &&
        stC4.app === null &&
        stC4.missions.length === 0 &&
        stC4.notifications.length === 0,
      { delete: c4Delete.status, select: c4Select.status },
    );
    dropTempTriggers();
    tempTriggers = false;

    // ── F. F-16 : visibilité des profils ─────────────────────────
    const { data: fB } = await A.client
      .from("company_profiles")
      .select("id, niu, contact_email")
      .eq("id", coB);
    const { data: fOwn } = await A.client
      .from("company_profiles")
      .select("id")
      .eq("id", coA);
    report(
      "F1 : une entreprise ne lit plus le profil d'une autre (seulement le sien)",
      (fB ?? []).length === 0 && (fOwn ?? []).length === 1,
      { other: fB?.length, own: fOwn?.length },
    );
    const { data: fCand } = await A.client
      .from("candidate_profiles")
      .select("id, last_name, momo_number")
      .in("id", [cand1, cand2]);
    report(
      "F2 : lecture directe des profils de ses candidats → aucune ligne",
      (fCand ?? []).length === 0,
      fCand?.length,
    );

    const jF = await seedJob(coA);
    const jFB = await seedJob(coB);
    await apply(C[0], jF);
    await apply(C[3], jF);
    await apply(C[2], jFB);
    const fList = await http("GET", `/api/jobs/${jF}/applications`, A.cookie);
    const items = (fList.body.applications ?? []) as Record<string, unknown>[];
    const allowed = [
      "application_id",
      "status",
      "match_score",
      "distance_km",
      "rejection_reason",
      "created_at",
      "first_name",
      "last_initial",
      "photo_url",
      // Lot 9c : réputation EasyJob en étoiles seules (ni moyenne, ni
      // nombre d'avis, ni nombre de missions).
      "reputation_stars",
      "skills",
    ].sort();
    const forbiddenStrings = [
      SECRETS.lastName,
      SECRETS.cniNumber,
      SECRETS.momoNumber,
      SECRETS.address,
      "profile_photo_url",
      "@proof.easyjob.cm",
      "+2376990",
      "cni-front",
      "4.0611",
      cand1,
      idC1,
    ];
    const leaked = forbiddenStrings.filter((s) => fList.text.includes(s));
    const aline = items.find((i) => i.first_name === "Aline");
    report(
      "F3 : liste des candidatures → colonnes autorisées seulement, prénom et initiale",
      fList.status === 200 &&
        items.length === 2 &&
        items.every(
          (i) =>
            JSON.stringify(Object.keys(i).sort()) === JSON.stringify(allowed),
        ) &&
        aline?.last_initial === "N",
      {
        status: fList.status,
        count: items.length,
        keys: items[0] && Object.keys(items[0]),
      },
    );
    report(
      "F4 : réponse reçue par le navigateur sans email, téléphone, CNI, MoMo, adresse, coordonnées, chemins ni identifiants internes",
      leaked.length === 0,
      leaked,
    );
    const photoUrl = String(aline?.photo_url ?? "");
    const photoFetch = (cookie: string | null) =>
      appFetch(`${APP_URL}${photoUrl}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: "manual",
      });
    const [photoA, photoB, photoAnon] = await Promise.all([
      photoFetch(A.cookie),
      photoFetch(B.cookie),
      photoFetch(null),
    ]);
    report(
      "F5 : photo servie à l'entreprise de l'offre seulement (B 404, anonyme 401), absente sans photo",
      photoUrl.startsWith(`/api/jobs/${jF}/applications/`) &&
        photoA.status === 200 &&
        (photoA.headers.get("content-type") ?? "").startsWith("image/") &&
        photoB.status === 404 &&
        photoAnon.status === 401 &&
        items.find((i) => i.first_name === "Didier")?.photo_url === null,
      { a: photoA.status, b: photoB.status, anon: photoAnon.status },
    );

    const fCross = await http("GET", `/api/jobs/${jF}/applications`, B.cookie);
    const fBOwn = await http("GET", `/api/jobs/${jFB}/applications`, B.cookie);
    const bNames = (
      (fBOwn.body.applications ?? []) as { first_name?: string }[]
    ).map((i) => i.first_name);
    const { error: fRpcB } = await B.client.rpc("company_job_applicants", {
      p_job_id: jF,
    });
    const { error: fRpcC } = await C[0].client.rpc("company_job_applicants", {
      p_job_id: jF,
    });
    const { error: fRpcAnon } = await anon.rpc("company_job_applicants", {
      p_job_id: jF,
    });
    report(
      "F6 : entreprise B → 404 sur l'offre de A, voit seulement ses candidats ; RPC refusée à B, au candidat et à l'anonyme",
      fCross.status === 404 &&
        fBOwn.status === 200 &&
        JSON.stringify(bNames) === JSON.stringify(["Carine"]) &&
        fRpcB?.message === "job_not_found" &&
        fRpcC?.message === "job_not_found" &&
        !!fRpcAnon,
      { cross: fCross.status, bNames, anon: fRpcAnon?.message },
    );

    const { data: pubAnonA } = await anon
      .from("company_public_profiles")
      .select("id, company_name")
      .eq("id", coA);
    const { data: pubAnonZ } = await anon
      .from("company_public_profiles")
      .select("id")
      .eq("company_name", "Société Z sans offre");
    const { data: pubZOwn } = await Z.client
      .from("company_public_profiles")
      .select("id")
      .eq("company_name", "Société Z sans offre");
    const { error: pubNiuErr } = await anon
      .from("company_public_profiles")
      .select("niu" as "id");
    report(
      "F7 : vitrine publique → entreprise avec offre active visible, sans NIU ni contacts ; entreprise sans offre invisible sauf pour elle-même",
      pubAnonA?.[0]?.company_name === "Restaurant A" &&
        (pubAnonZ ?? []).length === 0 &&
        (pubZOwn ?? []).length === 1 &&
        !!pubNiuErr,
      { a: pubAnonA?.length, z: pubAnonZ?.length, zOwn: pubZOwn?.length },
    );
    const fPublic = await http("GET", `/api/jobs/${jF}`, C[1].cookie);
    const fCompany = (
      fPublic.body.job as { company?: { company_name?: string } }
    )?.company;
    report(
      "F8 : offre publique lue par un candidat → nom de l'entreprise affiché",
      fPublic.status === 200 && fCompany?.company_name === "Restaurant A",
      { status: fPublic.status, company: fCompany?.company_name },
    );
    const { error: pubWriteErr } = await A.client
      .from("company_public_profiles")
      .update({ company_name: "Piraté" })
      .eq("id", coB);
    report("F9 : vitrine en lecture seule", !!pubWriteErr, pubWriteErr?.code);
  } finally {
    if (tempTriggers) dropTempTriggers();
    await cleanAccounts(ids);
  }

  console.log(`\n${passCount} réussite(s), ${failCount} échec(s)`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
