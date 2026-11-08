/**
 * Preuve lot 8 — vérification du téléphone (H-04, F-12).
 *
 * Méthode :
 *   - Code serveur réel : `verifyPhoneCode` et `requestPhoneCode`
 *     (lib/auth/phone-verification.ts), appelés comme par les actions avec
 *     de vrais clients : session de l'utilisateur (mot de passe, clé anon),
 *     client anon sans persistance, clé service.
 *   - Supabase Auth réel. Aucun SMS : un code « émis » est simulé en posant
 *     en base ce que Supabase Auth écrit à l'envoi (`phone_change`, empreinte
 *     sha224 du numéro et du code, `phone_change_sent_at`). La vérification
 *     passe ensuite par l'API réelle `/verify`.
 *   - Après chaque refus, l'état est RELU en base : `public.users`,
 *     `candidate_profiles`, `app_metadata`, numéro confirmé côté Auth.
 *   - Journaux du processus capturés : aucun code ni numéro complet.
 *
 * Cas :
 *   H1 (reproduction H-04) autoconfirm : le numéro relu sur le compte est déjà
 *      le numéro demandé, sans code ; code erroné → refus, rien de vérifié.
 *   H2 code erroné ; H3 code expiré ; H4 code valide émis pour un autre compte.
 *   H5 code correct → finalisation (rôle et app_metadata cohérents).
 *   H6 réponse perdue après finalisation → relance acceptée, idempotente.
 *   H7 réponse perdue entre Supabase Auth et le serveur : refus tant que la
 *      pile est en autoconfirm ; acceptée quand Auth exige un code (réglage
 *      de production, simulé) ; le renvoi n'enregistre aucun nouvel envoi.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";
import {
  readAuthPhoneSettings,
  requestPhoneCode,
  verifyPhoneCode,
  type AuthPhoneSettings,
} from "@/lib/auth/phone-verification";

type DB = SupabaseClient<Database>;

const {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  serviceKey: SERVICE_KEY,
} = readLocalProofEnv();
const DB_URL = readLocalDbUrl();
const PROOF_PASSWORD = "Proof-L8-phone-01!";
const PROOF_METADATA = { proofPhoneVerification: true };
const EMAIL_PREFIX = "proof-l8-phone-";

const service: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const statelessAnon = (): DB =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// ─── Journaux capturés (F-12) ────────────────────────────────────
const captured: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    captured.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
    original(...args);
  };
}

let passCount = 0;
let failCount = 0;
function report(name: string, ok: boolean, detail?: unknown) {
  if (ok) passCount += 1;
  else failCount += 1;
  process.stdout.write(
    `${ok ? "✅" : "❌"} ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}\n`,
  );
}

function execSql(sql: string) {
  const tmp = path.join(
    os.tmpdir(),
    `proof-phone-verification-${Date.now()}.sql`,
  );
  fs.writeFileSync(tmp, sql, "utf-8");
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
  if (r.status !== 0) {
    throw new Error(
      `supabase db query : ${(r.stdout || r.stderr || "").slice(0, 300)}`,
    );
  }
}

const uuid = (v: string) => {
  if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error("uuid attendu");
  return v;
};
const digits = (v: string) => {
  if (!/^[0-9]{12}$/.test(v)) throw new Error("numéro attendu");
  return v;
};

/** Pose ce que Supabase Auth écrit à l'envoi d'un code de changement de numéro. */
function seedPendingCode(
  userId: string,
  e164: string,
  code: string,
  ageSeconds = 0,
) {
  const phone = digits(e164.slice(1));
  if (!/^[0-9]{6}$/.test(code)) throw new Error("code attendu");
  execSql(
    `update auth.users set phone_change = '${phone}', ` +
      `phone_change_token = encode(extensions.digest('${phone}${code}', 'sha224'), 'hex'), ` +
      `phone_change_sent_at = now() - interval '${Math.floor(ageSeconds)} seconds' ` +
      `where id = '${uuid(userId)}'`,
  );
}

// ─── Fixtures ────────────────────────────────────────────────────
const created: string[] = [];
const run = Date.now();
let seq = 0;
/** Numéro unique par exécution (+2376 9x xxx xxx). */
const nextPhone = () =>
  `+23769${String((run + seq++ * 7919) % 10_000_000).padStart(7, "0")}`;

type Party = { id: string; email: string; session: DB };

async function makeParty(tag: string): Promise<Party> {
  const email = `${EMAIL_PREFIX}${tag}-${run}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PROOF_PASSWORD,
    email_confirm: true,
    user_metadata: { ...PROOF_METADATA, role: "candidate", locale: "fr" },
  });
  if (error || !data.user)
    throw new Error(`createUser(${tag}) : ${error?.message}`);
  created.push(data.user.id);
  // Profil initialement non vérifié (comme après le retour OAuth).
  const { error: rowError } = await service.from("users").insert({
    id: data.user.id,
    email,
    role: "candidate",
    locale: "fr",
    phone_verified: false,
  });
  if (rowError) throw new Error(`users(${tag}) : ${rowError.message}`);
  const session = statelessAnon();
  const { error: signInError } = await session.auth.signInWithPassword({
    email,
    password: PROOF_PASSWORD,
  });
  if (signInError) throw new Error(`signIn(${tag}) : ${signInError.message}`);
  return { id: data.user.id, email, session };
}

const sessionUser = async (p: Party) => {
  const { data } = await p.session.auth.getUser();
  if (!data.user) throw new Error("session illisible");
  return data.user;
};

type Snapshot = {
  phone: string | null;
  phoneVerified: boolean | null;
  role: string | null;
  candidateProfile: boolean;
  appPhoneVerified: unknown;
  appRole: unknown;
  authPhone: string | null;
  authConfirmed: boolean;
};

async function snapshot(userId: string): Promise<Snapshot> {
  const [{ data: row }, { data: profile }, { data: auth }] = await Promise.all([
    service
      .from("users")
      .select("phone, phone_verified, role")
      .eq("id", userId)
      .maybeSingle(),
    service
      .from("candidate_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle(),
    service.auth.admin.getUserById(userId),
  ]);
  return {
    phone: row?.phone ?? null,
    phoneVerified: row?.phone_verified ?? null,
    role: row?.role ?? null,
    candidateProfile: !!profile,
    appPhoneVerified: auth.user?.app_metadata?.phone_verified,
    appRole: auth.user?.app_metadata?.role,
    authPhone: auth.user?.phone || null,
    authConfirmed: !!auth.user?.phone_confirmed_at,
  };
}

const untouched = (s: Snapshot) =>
  s.phoneVerified === false &&
  s.phone === null &&
  !s.candidateProfile &&
  s.appPhoneVerified !== true;

const realSettings = () => readAuthPhoneSettings(SUPABASE_URL, ANON_KEY);
const productionLike = async (): Promise<AuthPhoneSettings> => ({
  phoneAutoconfirm: false,
});

async function verify(
  p: Party,
  e164: string,
  code: string,
  readSettings = realSettings,
) {
  return verifyPhoneCode(
    { admin: service, verifier: statelessAnon(), readSettings },
    await sessionUser(p),
    e164,
    code,
  );
}

async function sendCount(userId: string, e164: string): Promise<number> {
  const { count } = await service
    .from("sms_send_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("phone", e164);
  return count ?? 0;
}

async function directVerify(e164: string, code: string) {
  return statelessAnon().auth.verifyOtp({
    phone: e164,
    token: code,
    type: "phone_change",
  });
}

// ─── Nettoyage ───────────────────────────────────────────────────
async function cleanup(ids: string[]) {
  if (ids.length === 0) return;
  await service.from("sms_send_log").delete().in("user_id", ids);
  await service.from("candidate_profiles").delete().in("user_id", ids);
  await service.from("users").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
}

async function cleanupLeftovers() {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  const stale = (data?.users ?? [])
    .filter(
      (u) =>
        u.email?.startsWith(EMAIL_PREFIX) &&
        u.user_metadata?.proofPhoneVerification === true,
    )
    .map((u) => u.id);
  await cleanup(stale);
}

// ─── Preuve ──────────────────────────────────────────────────────
async function main() {
  await cleanupLeftovers();
  const settings = await realSettings();
  console.log(
    `Réglage Auth de la pile : phone_autoconfirm = ${settings?.phoneAutoconfirm}`,
  );

  // H1 — reproduction H-04 : autoconfirm, numéro déjà « confirmé » sans code.
  {
    const a = await makeParty("h1");
    const phone = nextPhone();
    const sent = await requestPhoneCode(
      { admin: service, session: a.session, readSettings: realSettings },
      await sessionUser(a),
      phone,
      null,
    );
    const before = await snapshot(a.id);
    report(
      "H1. précondition : l'envoi place sur le compte le numéro demandé, confirmé sans code (autoconfirm)",
      sent.ok && before.authPhone === phone.slice(1) && before.authConfirmed,
      {
        sent,
        authPhone: before.authPhone,
        authConfirmed: before.authConfirmed,
      },
    );
    const res = await verify(a, phone, "000000");
    const after = await snapshot(a.id);
    report(
      "H1. code erroné alors que le numéro relu correspond : refus, téléphone non vérifié, aucun profil",
      !res.ok && res.errorCode === "otpWrong" && untouched(after),
      { res, after },
    );
  }

  // H2 — code erroné sur un code réellement émis.
  {
    const b = await makeParty("h2");
    const phone = nextPhone();
    seedPendingCode(b.id, phone, "514273");
    const res = await verify(b, phone, "514274");
    const after = await snapshot(b.id);
    report(
      "H2. code erroné : refus, base inchangée",
      !res.ok && untouched(after) && !after.authConfirmed,
      {
        res,
        after,
      },
    );
  }

  // H3 — code expiré (émis il y a 3 h ; durée de validité de la pile < 2 h).
  {
    const c = await makeParty("h3");
    const phone = nextPhone();
    seedPendingCode(c.id, phone, "602158", 3 * 3600);
    const res = await verify(c, phone, "602158");
    const after = await snapshot(c.id);
    report(
      "H3. bon code mais expiré : refus, base inchangée",
      !res.ok && untouched(after) && !after.authConfirmed,
      {
        res,
        after,
      },
    );
  }

  // H4 — code valide émis pour un autre compte (autre session).
  {
    const owner = await makeParty("h4-owner");
    const other = await makeParty("h4-other");
    const phone = nextPhone();
    seedPendingCode(owner.id, phone, "731904");
    const res = await verify(other, phone, "731904");
    const after = await snapshot(other.id);
    report(
      "H4. code d'un autre compte saisi dans cette session : refus, compte de la session non vérifié",
      !res.ok &&
        res.errorCode === "otpWrong" &&
        untouched(after) &&
        after.authPhone === null,
      { res, after },
    );
  }

  // H5 / H6 — succès puis relance après réponse perdue.
  let h5: Party | null = null;
  {
    h5 = await makeParty("h5");
    const phone = nextPhone();
    seedPendingCode(h5.id, phone, "845620");
    const res = await verify(h5, phone, "845620");
    const after = await snapshot(h5.id);
    report(
      "H5. code correct : téléphone vérifié, profil créé, rôle et app_metadata cohérents",
      res.ok &&
        after.phone === phone &&
        after.phoneVerified === true &&
        after.candidateProfile &&
        after.role === "candidate" &&
        after.appRole === "candidate" &&
        after.appPhoneVerified === true,
      { res, after },
    );

    const again = await verify(h5, phone, "845620");
    const after2 = await snapshot(h5.id);
    const { count } = await service
      .from("candidate_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", h5.id);
    report(
      "H6. réponse perdue après finalisation : relance (code consommé) acceptée, sans doublon ni changement de rôle",
      again.ok &&
        after2.role === "candidate" &&
        after2.phoneVerified === true &&
        count === 1,
      { again, count },
    );
  }

  // H7 — code accepté par Supabase Auth, réponse jamais reçue par le serveur.
  {
    const f = await makeParty("h7");
    const phone = nextPhone();
    // L'envoi enregistré par requestPhoneCode, puis le code émis.
    await service
      .from("sms_send_log")
      .insert({ phone, ip: null, user_id: f.id });
    await new Promise((r) => setTimeout(r, 1100));
    seedPendingCode(f.id, phone, "917346");
    const direct = await directVerify(phone, "917346");
    if (direct.data.session) {
      await service.auth.admin.signOut(
        direct.data.session.access_token,
        "local",
      );
    }
    const mid = await snapshot(f.id);
    report(
      "H7. précondition : Auth a confirmé le numéro, la base applicative ne le sait pas",
      !direct.error && mid.authConfirmed && mid.phoneVerified === false,
      { error: direct.error?.code, mid },
    );

    const refusedHere = await verify(f, phone, "917346");
    report(
      "H7. pile en autoconfirm : la confirmation Auth n'est pas une preuve → refus",
      !refusedHere.ok && untouched(await snapshot(f.id)),
      refusedHere,
    );

    const sendsBefore = await sendCount(f.id, phone);
    const resend = await requestPhoneCode(
      { admin: service, session: f.session, readSettings: productionLike },
      await sessionUser(f),
      phone,
      null,
    );
    const sendsAfter = await sendCount(f.id, phone);
    report(
      "H7. Auth exige un code (production) : le renvoi ne déclenche ni n'enregistre de nouvel envoi",
      resend.ok && sendsAfter === sendsBefore,
      { resend, sendsBefore, sendsAfter },
    );

    const recovered = await verify(f, phone, "917346", productionLike);
    const after = await snapshot(f.id);
    report(
      "H7. Auth exige un code (production) : relance retrouve l'état confirmé et finalise",
      recovered.ok &&
        after.phoneVerified === true &&
        after.phone === phone &&
        after.candidateProfile,
      { recovered, after },
    );
  }

  // F-12 — aucun code ni numéro complet dans les journaux du processus.
  {
    const all = captured.join("\n");
    const leaks = [
      "000000",
      "514273",
      "514274",
      "602158",
      "731904",
      "845620",
      "917346",
    ].filter((c) => all.includes(c));
    const phoneLeak = /\+?2376\d{8}/.test(all);
    report(
      "F-12. journaux : aucun code OTP ni numéro complet",
      leaks.length === 0 && !phoneLeak,
      {
        leaks,
        phoneLeak,
      },
    );
  }
}

main()
  .catch((e: unknown) => {
    report("exécution", false, (e as Error).message);
  })
  .finally(async () => {
    await cleanup(created).catch(() => undefined);
    process.stdout.write(`\n${passCount} réussies, ${failCount} échecs\n`);
    process.exitCode = failCount > 0 ? 1 : 0;
  });
