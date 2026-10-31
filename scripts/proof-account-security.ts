/**
 * Preuve lot 1 (audit F-01 / F-02 / F-03) — protection des rôles et comptes.
 *
 * Couvre :
 *  1. un candidat ne peut modifier aucune colonne sensible de sa ligne users ;
 *     un compte suspendu ne peut pas se réactiver ;
 *  2. une entreprise ne peut s'attribuer ni premium ni admin ;
 *  3. un utilisateur ne peut pas modifier le compte d'un autre ;
 *  4. INSERT public.users refusé (session sans ligne users, et anon) ;
 *  5. user_metadata.role = admin_founder / *_premium → candidate après
 *     finalizeSignup (users.role ET app_metadata.role) ;
 *  6. un rôle existant (admin, candidat) est préservé à la re-finalisation ;
 *  7. finalisations concurrentes → une seule ligne, rôle stable, un profil ;
 *  8. édition légitime (users.locale, candidate_profiles.first_name) OK ;
 *  9. RPC admin_set_user_active : OK pour admin_ops, refusée au candidat ;
 *     un admin ne peut pas non plus changer son rôle via PostgREST ;
 * 10. chemins de vérification sans fournisseur : finalizeSignup pose
 *     phone_verified ; recompute_user_verification reste appelable.
 * 11. échec de synchronisation app_metadata (API Auth simulée en panne) :
 *     finalisation ok, rôle en base inchangé, aucun rôle issu de
 *     user_metadata dans app_metadata.
 *
 * Méthode : les tentatives « utilisateur » passent par de VRAIES sessions
 * (signInWithPassword, clé anon). La clé service ne sert qu'aux fixtures,
 * aux relectures d'état persisté et au chemin serveur finalizeSignup
 * (qui s'exécute en service_role dans l'application).
 *
 * Exécution : pile Supabase locale jetable uniquement (pas d'app Next
 * requise) — procédure dans docs/testing/local-proofs.md.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { finalizeSignup } from "@/lib/auth/finalize-signup";
import { readLocalProofEnv } from "./lib/local-supabase";

type DB = SupabaseClient<Database>;
type UserRow = Database["public"]["Tables"]["users"]["Row"];

const {
  supabaseUrl: API_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
} = readLocalProofEnv();

const PASSWORD = "Proof-Lot1-31!";
const TAG = `lot1-${Date.now()}`;
const svc: DB = createClient(API_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok && detail !== undefined) console.log("      ", detail);
}

const createdIds: string[] = [];
let phoneSeq = 10;
const nextPhone = () => `+2376910000${String(phoneSeq++).padStart(2, "0")}`;

async function makeAuthUser(
  label: string,
  userMetadata: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> {
  const email = `${label}.${TAG}@easyjob.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: userMetadata,
  });
  if (error || !data.user)
    throw new Error(`createUser ${label}: ${error?.message}`);
  createdIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function makeAccount(
  label: string,
  role: UserRow["role"],
  extra: Partial<UserRow> = {},
) {
  const u = await makeAuthUser(label);
  const { error } = await svc.from("users").insert({
    id: u.id,
    email: u.email,
    phone: nextPhone(),
    phone_verified: true,
    role,
    locale: "fr",
    ...extra,
  });
  if (error) throw new Error(`users insert ${label}: ${error.message}`);
  await svc.auth.admin.updateUserById(u.id, {
    app_metadata: { role, phone_verified: true },
  });
  return u;
}

async function sessionFor(email: string): Promise<DB> {
  const client: DB = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

async function readUser(id: string): Promise<UserRow | null> {
  const { data } = await svc
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function appRole(id: string): Promise<unknown> {
  const { data } = await svc.auth.admin.getUserById(id);
  return data.user?.app_metadata?.role;
}

/** Tente un UPDATE en session ; succès attendu = erreur ET état inchangé. */
async function expectUpdateRefused(
  name: string,
  client: DB,
  targetId: string,
  patch: Partial<UserRow>,
) {
  const before = await readUser(targetId);
  const { data, error } = await client
    .from("users")
    .update(patch)
    .eq("id", targetId)
    .select("id");
  const after = await readUser(targetId);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const refused = error !== null || (data ?? []).length === 0;
  report(name, refused && unchanged, {
    error: error?.code,
    rows: data?.length,
    before,
    after,
  });
}

async function main() {
  // ── Fixtures ─────────────────────────────────────────────────────
  // no_show_count non nul : la tentative de remise à 0 est un vrai changement.
  const cand = await makeAccount("cand", "candidate", { no_show_count: 2 });
  const other = await makeAccount("other", "candidate");
  const suspended = await makeAccount("susp", "candidate", {
    is_active: false,
  });
  const company = await makeAccount("comp", "company");
  const ops = await makeAccount("ops", "admin_ops");
  await svc
    .from("candidate_profiles")
    .insert({ user_id: cand.id, first_name: "Avant" });

  const candS = await sessionFor(cand.email);
  const compS = await sessionFor(company.email);
  const opsS = await sessionFor(ops.email);
  const suspS = await sessionFor(suspended.email);

  // ── 1. Candidat : colonnes sensibles ─────────────────────────────
  const sensitive: [string, Partial<UserRow>][] = [
    ["role → admin_founder", { role: "admin_founder" }],
    ["role → candidate_premium", { role: "candidate_premium" }],
    ["is_active → false", { is_active: false }],
    ["is_verified → true", { is_verified: true }],
    ["phone_verified → false", { phone_verified: false }],
    ["no_show_count → 0", { no_show_count: 0 }],
    ["ban_reason", { ban_reason: "x" }],
    ["ban_expires_at", { ban_expires_at: "2099-01-01T00:00:00Z" }],
    ["device_fingerprint", { device_fingerprint: "fp" }],
    ["phone", { phone: "+237690000999" }],
    ["email", { email: `hijack.${TAG}@easyjob.test` }],
    ["role + locale mélangés", { role: "admin_ops", locale: "en" }],
  ];
  for (const [label, patch] of sensitive) {
    await expectUpdateRefused(`1. candidat ${label}`, candS, cand.id, patch);
  }
  await expectUpdateRefused(
    "1. compte suspendu ne peut pas se réactiver",
    suspS,
    suspended.id,
    { is_active: true },
  );

  // ── 2. Entreprise ────────────────────────────────────────────────
  await expectUpdateRefused(
    "2. entreprise → company_premium",
    compS,
    company.id,
    {
      role: "company_premium",
    },
  );
  await expectUpdateRefused(
    "2. entreprise → admin_founder",
    compS,
    company.id,
    {
      role: "admin_founder",
    },
  );

  // ── 3. Compte d'un autre utilisateur ─────────────────────────────
  await expectUpdateRefused(
    "3. candidat modifie locale d'autrui",
    candS,
    other.id,
    {
      locale: "en",
    },
  );
  await expectUpdateRefused(
    "3. candidat modifie rôle d'autrui",
    candS,
    other.id,
    {
      role: "admin_founder",
    },
  );

  // ── 4. INSERT public.users ───────────────────────────────────────
  const orphan = await makeAuthUser("orphan"); // compte Auth sans ligne users
  const orphanS = await sessionFor(orphan.email);
  {
    const { error } = await orphanS.from("users").insert({
      id: orphan.id,
      email: orphan.email,
      role: "admin_founder",
    });
    const row = await readUser(orphan.id);
    report(
      "4. INSERT users en session authenticated refusé",
      error !== null && row === null,
      {
        error: error?.code,
        row,
      },
    );
  }
  {
    const anon: DB = createClient(API_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.from("users").insert({
      id: orphan.id,
      email: orphan.email,
      role: "admin_founder",
    });
    const row = await readUser(orphan.id);
    report("4. INSERT users en anon refusé", error !== null && row === null, {
      error: error?.code,
    });
  }

  // ── 5. Métadonnée modifiée par l'utilisateur → aucun privilège ───
  for (const forged of [
    "admin_founder",
    "company_premium",
    "candidate_premium",
  ]) {
    const u = await makeAuthUser(`meta-${forged}`, { role: "candidate" });
    const s = await sessionFor(u.email);
    const { error: updErr } = await s.auth.updateUser({
      data: { role: forged },
    });
    const {
      data: { user: sessionUser },
    } = await s.auth.getUser();
    const res = sessionUser
      ? await finalizeSignup(svc, sessionUser, nextPhone())
      : null;
    const row = await readUser(u.id);
    const meta = await appRole(u.id);
    report(
      `5. user_metadata.role=${forged} → candidate`,
      !updErr &&
        sessionUser?.user_metadata?.role === forged &&
        res?.ok === true &&
        row?.role === "candidate" &&
        meta === "candidate",
      { updErr: updErr?.message, res, role: row?.role, meta },
    );
  }

  // ── 6. Rôle existant préservé ────────────────────────────────────
  {
    await svc.auth.admin.updateUserById(ops.id, {
      user_metadata: { role: "candidate" },
    });
    const {
      data: { user: opsUser },
    } = await svc.auth.admin.getUserById(ops.id);
    const res = opsUser
      ? await finalizeSignup(svc, opsUser, nextPhone())
      : null;
    const row = await readUser(ops.id);
    report(
      "6. admin_ops re-finalisé avec metadata candidate → reste admin_ops",
      res?.ok === true &&
        row?.role === "admin_ops" &&
        (await appRole(ops.id)) === "admin_ops",
      { res, role: row?.role },
    );
  }
  {
    const s = candS;
    await s.auth.updateUser({ data: { role: "company" } });
    const {
      data: { user: cu },
    } = await s.auth.getUser();
    const res = cu ? await finalizeSignup(svc, cu, nextPhone()) : null;
    const row = await readUser(cand.id);
    report(
      "6. candidat existant avec metadata company → reste candidate",
      res?.ok === true && row?.role === "candidate",
      { res, role: row?.role },
    );
  }

  // ── 7. Finalisations concurrentes ────────────────────────────────
  {
    const u = await makeAuthUser("concurrent", {
      role: "candidate",
      locale: "fr",
    });
    const {
      data: { user: au },
    } = await svc.auth.admin.getUserById(u.id);
    const phone = nextPhone();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => finalizeSignup(svc, au!, phone)),
    );
    const { data: rows } = await svc
      .from("users")
      .select("role, phone_verified")
      .eq("id", u.id);
    const { count: profiles } = await svc
      .from("candidate_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id);
    report(
      "7. 6 finalisations concurrentes → 1 ligne candidate, 1 profil",
      results.every((r) => r.ok) &&
        rows?.length === 1 &&
        rows[0].role === "candidate" &&
        rows[0].phone_verified === true &&
        profiles === 1 &&
        (await appRole(u.id)) === "candidate",
      { results, rows, profiles },
    );
  }
  {
    const results = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const {
          data: { user: au },
        } = await svc.auth.admin.getUserById(ops.id);
        return finalizeSignup(svc, au!, nextPhone());
      }),
    );
    const row = await readUser(ops.id);
    report(
      "7. finalisations concurrentes sur un admin → rôle inchangé",
      results.every((r) => r.ok) && row?.role === "admin_ops",
      { results, role: row?.role },
    );
  }

  // ── 8. Édition légitime ──────────────────────────────────────────
  {
    const { data, error } = await candS
      .from("users")
      .update({ locale: "en" })
      .eq("id", cand.id)
      .select("locale");
    const row = await readUser(cand.id);
    report(
      "8. candidat modifie sa locale",
      !error && data?.length === 1 && row?.locale === "en",
      { error, row: row?.locale },
    );
  }
  {
    const { error } = await candS
      .from("candidate_profiles")
      .update({ first_name: "Apres" })
      .eq("user_id", cand.id);
    const { data } = await svc
      .from("candidate_profiles")
      .select("first_name")
      .eq("user_id", cand.id)
      .single();
    report(
      "8. candidat modifie son prénom (candidate_profiles)",
      !error && data?.first_name === "Apres",
      {
        error,
        data,
      },
    );
  }

  // ── 9. Opérations admin ──────────────────────────────────────────
  {
    const { error } = await opsS.rpc("admin_set_user_active", {
      p_user_id: other.id,
      p_active: false,
    });
    const r1 = await readUser(other.id);
    const { error: e2 } = await opsS.rpc("admin_set_user_active", {
      p_user_id: other.id,
      p_active: true,
    });
    const r2 = await readUser(other.id);
    report(
      "9. admin_ops suspend puis réactive via RPC",
      !error && r1?.is_active === false && !e2 && r2?.is_active === true,
      { error, e2 },
    );
  }
  {
    const { error } = await candS.rpc("admin_set_user_active", {
      p_user_id: other.id,
      p_active: false,
    });
    const row = await readUser(other.id);
    report(
      "9. candidat appelle admin_set_user_active → refusé",
      error !== null && row?.is_active === true,
      {
        error: error?.message,
      },
    );
  }
  await expectUpdateRefused(
    "9. admin_ops ne change pas son rôle via PostgREST",
    opsS,
    ops.id,
    {
      role: "admin_founder",
    },
  );
  await expectUpdateRefused(
    "9. admin_ops ne suspend pas via PATCH direct",
    opsS,
    other.id,
    {
      is_active: false,
    },
  );

  // ── 10. Chemins de vérification sans fournisseur ─────────────────
  {
    const u = await makeAuthUser("verify", { role: "candidate" });
    const {
      data: { user: au },
    } = await svc.auth.admin.getUserById(u.id);
    const phone = nextPhone();
    const res = await finalizeSignup(svc, au!, phone);
    const row = await readUser(u.id);
    const { data: authUser } = await svc.auth.admin.getUserById(u.id);
    report(
      "10. finalizeSignup pose phone + phone_verified (DB et app_metadata)",
      res.ok &&
        row?.phone === phone &&
        row?.phone_verified === true &&
        authUser.user?.app_metadata?.phone_verified === true,
      { res, row },
    );
    const s = await sessionFor(u.email);
    const { error } = await s.rpc("recompute_user_verification", {
      p_user_id: u.id,
    });
    const after = await readUser(u.id);
    report(
      "10. recompute_user_verification (SECURITY DEFINER) fonctionne en session",
      !error && after?.is_verified === false,
      { error },
    );
  }

  // ── 11. Échec de synchronisation app_metadata ────────────────────
  // Comportement documenté : non bloquant (public.users fait foi, le
  // middleware la relit). L'échec est simulé sur l'API Auth seule ; les
  // écritures en base passent par la vraie pile locale.
  {
    const failing = withFailingAppMetadataSync(svc);

    // 11a. Nouveau compte, métadonnée forgée admin_founder.
    const u = await makeAuthUser("sync-fail-new", { role: "candidate" });
    const s = await sessionFor(u.email);
    await s.auth.updateUser({ data: { role: "admin_founder" } });
    const {
      data: { user: su },
    } = await s.auth.getUser();
    const phone = nextPhone();
    const res = await finalizeSignup(failing, su!, phone);
    const row = await readUser(u.id);
    const { count: profiles } = await svc
      .from("candidate_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id);
    report(
      "11. sync app_metadata en échec (nouveau compte, metadata admin_founder) → ok, users.role=candidate, app_metadata sans rôle",
      res.ok === true &&
        res.data.role === "candidate" &&
        row?.role === "candidate" &&
        row?.phone_verified === true &&
        row?.phone === phone &&
        profiles === 1 &&
        (await appRole(u.id)) === undefined,
      { res, row, profiles, appRole: await appRole(u.id) },
    );

    // 11b. Compte existant : le rôle en base et l'app_metadata serveur
    // précédent restent inchangés malgré une métadonnée forgée.
    await candS.auth.updateUser({ data: { role: "admin_founder" } });
    const {
      data: { user: cu },
    } = await candS.auth.getUser();
    const before = await appRole(cand.id);
    const res2 = await finalizeSignup(failing, cu!, nextPhone());
    const row2 = await readUser(cand.id);
    report(
      "11. sync app_metadata en échec (compte existant) → users.role et app_metadata.role inchangés",
      res2.ok === true &&
        row2?.role === "candidate" &&
        before === "candidate" &&
        (await appRole(cand.id)) === "candidate",
      { res2, role: row2?.role, before, after: await appRole(cand.id) },
    );
  }
}

/**
 * Client service_role dont seul `auth.admin.updateUserById` échoue (panne
 * simulée de l'API Auth) ; tout le reste atteint la vraie pile locale.
 */
function withFailingAppMetadataSync(client: DB): DB {
  const failingUpdate: DB["auth"]["admin"]["updateUserById"] = async () =>
    ({
      data: { user: null },
      error: { name: "AuthApiError", message: "simulated outage", status: 503 },
    }) as unknown as Awaited<ReturnType<DB["auth"]["admin"]["updateUserById"]>>;
  const admin = new Proxy(client.auth.admin, {
    get: (target, prop) =>
      prop === "updateUserById"
        ? failingUpdate
        : Reflect.get(target, prop, target),
  });
  const auth = new Proxy(client.auth, {
    get: (target, prop) =>
      prop === "admin" ? admin : Reflect.get(target, prop, target),
  });
  return new Proxy(client, {
    get: (target, prop) =>
      prop === "auth" ? auth : Reflect.get(target, prop, target),
  });
}

async function cleanup() {
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
