/**
 * Preuve E2E T8.4c — Revues « En attente » uniquement + `?userId=` + purge
 * immédiate des FICHIERS rejetés.
 *
 * T8.4c AJOUTE (le flux de verdict est déjà prouvé par
 * `proof-admin-cni.ts` / `proof-admin-momo-review.ts`) :
 *  A. Page SSR `/admin/cni` — file « En attente » UNIQUEMENT :
 *     - candidat `cni_verified='pending'` + photos → présent ;
 *     - candidat `cni_verified='rejected'` → ABSENT ;
 *     - candidat `cni_verified='verified'` → ABSENT ;
 *     - `?userId=` filtre sur ce candidat uniquement.
 *  B. Page SSR `/admin/momo` — `momo_verified=false` ET
 *     `momo_reject_reason IS NULL` UNIQUEMENT :
 *     - compte MoMo en attente → présent ;
 *     - compte MoMo REJETÉ (motif posé) → ABSENT ;
 *     - `?userId=` filtre.
 *  C. Page SSR `/admin/skill-documents` — `status='pending'` UNIQUEMENT :
 *     - document `pending` → présent ;
 *     - document `rejected` → ABSENT ;
 *     - `?userId=` filtre (résolution `user_id → candidate_id` côté SSR).
 *  D. POST `/api/admin/cni` REJECT → purge IMMÉDIATE des 3 photos CNI
 *     (nouveau : T8.4 ne purgait qu'à l'APPROBATION) :
 *     - 200 + status 'rejected' ;
 *     - les 3 objets storage supprimés ;
 *     - `cni_*_url` NULLifiées + `cni_verified='rejected'` (COMPTE conservé) ;
 *     - le candidat retombe de la file « En attente ».
 *  E. POST `/api/admin/skill-documents/[id]` REJECT → purge immédiate du
 *     FICHIER :
 *     - 200 ;
 *     - l'objet storage supprimé ;
 *     - la LIGNE reste en `status='rejected'` + motif (état visible T8.4b) ;
 *     - la compétence liée recalcule à `'rejected'` ;
 *     - le document retombe de la file « En attente ».
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword), photos et
 * fichier skill uploadés en storage privé via service role, nettoyage
 * complet en fin de course.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;

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
const PWD = "Proof-T84c-11!";
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";
const BUCKET = "candidate-documents";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error("Missing env keys.");
}

const svc: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, "base64");

const be = (p: PromiseLike<unknown>) => Promise.resolve(p).catch(() => {});

async function real(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (e: { name: string; value: string; options?: unknown }[]) => {
        for (const { name, value } of e) {
          if (value === "" || value === "0") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
    auth: { autoRefreshToken: false },
  }) as DB;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PWD,
  });
  if (error || !data.session)
    throw new Error(`sign-in ${email}: ${error?.message}`);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function storageRemoved(prefix: string): Promise<boolean> {
  const { data } = await svc.storage.from(BUCKET).list(prefix, { limit: 500 });
  return (data ?? []).length === 0;
}

async function html(cookies: string, path: string): Promise<string> {
  const r = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: cookies, Accept: "text/html" },
    cache: "no-store",
  });
  return r.text();
}

async function post(
  cookies: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: cookies,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass += 1;
  else fail += 1;
  console.log(
    `${cond ? "✅" : "❌"} ${name}${
      detail !== undefined ? "\n     " + JSON.stringify(detail) : ""
    }`,
  );
}

interface Acct {
  last: string;
  email: string;
  uid: string;
  profileId: string | null;
  storagePaths: string[];
  skillId?: string | null;
  docId?: string | null;
}

function phoneOf(uid: string) {
  return `2376959${uid
    .replace(/[^0-9]/g, "")
    .slice(0, 6)
    .padEnd(6, "7")}`;
}

async function mkAcct(
  last: string,
  role: "candidate" | "admin_ops",
  opts: {
    cni?: "pending" | "verified" | "rejected" | null;
    cniPhotos?: boolean;
    momoRejected?: boolean;
  },
): Promise<Acct> {
  const email = `t84c.${last.toLowerCase()}.${Date.now()}@e.com`;
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password: PWD,
    email_confirm: true,
    user_metadata: { proofT84c: true },
    app_metadata: { role },
  });
  if (error || !created.user) throw new Error(`mk ${email}: ${error?.message}`);
  const uid = created.user.id;

  const { error: uErr } = await svc.from("users").insert({
    id: uid,
    email,
    role,
    phone_verified: true,
    is_active: true,
    is_verified: null,
    phone: phoneOf(uid),
    locale: "fr",
  });
  if (uErr) throw new Error(`users ${email}: ${uErr.message}`);

  const storagePaths: string[] = [];
  let cniFront: string | null = null;
  let cniBack: string | null = null;
  let cniSelfie: string | null = null;
  if (opts.cniPhotos) {
    const kinds = ["front", "back", "selfie"] as const;
    for (const kind of kinds) {
      const p = `${uid}/cni_${kind}-t84c.png`;
      const { error: uErr } = await svc.storage
        .from(BUCKET)
        .upload(p, TINY_PNG, { contentType: "image/png", upsert: true });
      if (uErr) throw new Error(`upload ${kind}: ${uErr.message}`);
      storagePaths.push(p);
    }
    cniFront = storagePaths[0];
    cniBack = storagePaths[1];
    cniSelfie = storagePaths[2];
  }

  const { data: profile, error: pErr } = await svc
    .from("candidate_profiles")
    .insert({
      user_id: uid,
      first_name: "T84",
      last_name: last,
      date_of_birth: "1998-03-12",
      city: "Douala",
      quartier: "Bonanjo",
      momo_provider: "mtn",
      momo_number: "+237695000123",
      momo_account_name: `T84 ${last}`,
      momo_verified: false,
      momo_reject_reason: opts.momoRejected ? "Compte au nom d'un tiers" : null,
      cni_front_url: cniFront,
      cni_back_url: cniBack,
      cni_selfie_url: cniSelfie,
      cni_number: "T84CNI0000",
      cni_verified: opts.cni ?? null,
      onboarding_step: 4,
      onboarding_status: "completed",
      profile_completion_pct: 70,
    })
    .select("id")
    .single();
  if (pErr || !profile) throw new Error(`profile ${email}: ${pErr?.message}`);

  return { last, email, uid, profileId: profile.id, storagePaths };
}

/** Insère une compétence + un document PENDING lié (file « En attente »). */
async function addPendingSkillDocument(a: Acct): Promise<void> {
  if (!a.profileId) return;
  const skill = await svc
    .from("candidate_skills")
    .insert({ candidate_id: a.profileId, skill_name: `${a.last}Skill` })
    .select("id")
    .single();
  if (skill.error || !skill.data)
    throw new Error(`skill: ${skill.error?.message}`);
  a.skillId = skill.data.id;

  const p = `${a.uid}/skill-t84c-${a.uid.slice(0, 8)}.png`;
  const up = await svc.storage
    .from(BUCKET)
    .upload(p, TINY_PNG, { contentType: "image/png", upsert: true });
  if (up.error) throw new Error(`skill upload: ${up.error.message}`);
  a.storagePaths.push(p);

  const doc = await svc
    .from("candidate_documents")
    .insert({
      candidate_id: a.profileId,
      document_type: "certificat",
      title: `Certificat ${a.last}`,
      storage_path: p,
    })
    .select("id")
    .single();
  if (doc.error || !doc.data)
    throw new Error(`doc insert: ${doc.error?.message}`);
  a.docId = doc.data.id;

  const link = await svc.from("candidate_skill_documents").insert({
    candidate_skill_id: a.skillId!,
    candidate_document_id: a.docId,
  });
  if (link.error) throw new Error(`link: ${link.error.message}`);
}

async function clean(a: Acct): Promise<void> {
  await be(
    svc.storage
      .from(BUCKET)
      .list("", { limit: 2000 })
      .then((r) => {
        const own = (r.data ?? []).filter((o) =>
          o.name.startsWith(`${a.uid}/`),
        );
        return own.length > 0
          ? svc.storage.from(BUCKET).remove(own.map((o) => o.name))
          : null;
      }),
  );
  if (a.profileId) {
    await be(
      svc.from("candidate_documents").delete().eq("candidate_id", a.profileId),
    );
    await be(
      svc.from("candidate_skills").delete().eq("candidate_id", a.profileId),
    );
    await be(svc.from("candidate_profiles").delete().eq("id", a.profileId));
  }
  await be(svc.from("users").delete().eq("id", a.uid));
  await be(svc.auth.admin.deleteUser(a.uid));
}

async function main() {
  console.log("── Preuve T8.4c — Revues « En attente » + ?userId + purge ──\n");

  let serverUp = false;
  try {
    const probe = await fetch(`${APP_URL}/admin/cni`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    serverUp = [200, 302, 307, 308, 401, 403, 500].includes(probe.status);
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(
      `⚠️  Serveur dev injoignable sur ${APP_URL}. Preuve T8.4c ignorée.`,
    );
    return;
  }

  const R = await mkAcct("OpsT84", "admin_ops", {});
  const C1 = await mkAcct("CniPend", "candidate", {
    cni: "pending",
    cniPhotos: true,
  });
  const C2 = await mkAcct("CniRej", "candidate", { cni: "rejected" });
  const C3 = await mkAcct("CniVer", "candidate", { cni: "verified" });
  const M2 = await mkAcct("MomoRej", "candidate", { momoRejected: true });
  const D = await mkAcct("DocPend", "candidate", {});
  const D2 = await mkAcct("DocRej", "candidate", {});
  await addPendingSkillDocument(D);
  await addPendingSkillDocument(D2);
  // D2 : repasser le document en `rejected` (exclusion de la file pending).
  // → D.docId doit rester 'pending' (C1), D2.docId devient 'rejected' (C2).
  await be(
    svc
      .from("candidate_documents")
      .update({ status: "rejected", rejection_reason: "Doc illisible" })
      .eq("id", D2.docId!),
  );

  const Rc = await real(R.email);

  try {
    // ── A. CNI page — pending only + ?userId ─────────────────────
    const aPage = await html(Rc, "/admin/cni");
    ok(
      "A1 : CNI 'pending' présente dans /admin/cni",
      aPage.includes("CniPend"),
    );
    ok("A2 : CNI 'rejected' ABSENTE de /admin/cni", !aPage.includes("CniRej"));
    ok("A3 : CNI 'verified' ABSENTE de /admin/cni", !aPage.includes("CniVer"));
    const aFilter = await html(Rc, `/admin/cni?userId=${C1.uid}`);
    ok(
      "A4 : /admin/cni?userId=C1 → C1 présente + C3 absente",
      aFilter.includes("CniPend") && !aFilter.includes("CniVer"),
    );

    // ── B. MoMo page — pending only + ?userId ─────────────────────
    const bPage = await html(Rc, "/admin/momo");
    ok(
      "B1 : MoMo 'pending' présent dans /admin/momo",
      bPage.includes("CniPend"),
    );
    ok(
      "B2 : MoMo 'rejected' (motif) ABSENT de /admin/momo",
      !bPage.includes("MomoRej"),
    );
    const bFilter = await html(Rc, `/admin/momo?userId=${C1.uid}`);
    ok(
      "B3 : /admin/momo?userId=C1 → C1 présent + M2 absent",
      bFilter.includes("CniPend") && !bFilter.includes("MomoRej"),
    );

    // ── C. Skill-docs page — pending only + ?userId ───────────────
    const cPage = await html(Rc, "/admin/skill-documents");
    ok(
      "C1 : skill-doc 'pending' présent dans /admin/skill-documents",
      cPage.includes("Certificat DocPend"),
    );
    ok(
      "C2 : skill-doc 'rejected' ABSENT de la page (pending only)",
      !cPage.includes("Certificat DocRej"),
    );
    const cFilter = await html(Rc, `/admin/skill-documents?userId=${D.uid}`);
    ok(
      "C3 : /admin/skill-documents?userId=D → D présent + D2 (autre) absent",
      cFilter.includes("Certificat DocPend") &&
        !cFilter.includes("Certificat DocRej"),
    );

    // ── D. CNI REJECT → purge photos (nouveau T8.4c) ──────────────
    const d1 = await post(Rc, "/api/admin/cni", {
      profile_id: C1.profileId!,
      action: "reject",
      rejection_reason: "Photos illisibles — le nom est masqué.",
    });
    ok(
      "D1 : POST /api/admin/cni reject → 200 + status 'rejected'",
      d1.status === 200 && d1.json.status === "rejected",
      d1.json,
    );
    ok(
      "D2 : 3 photos CNI supprimées du bucket privé (purge au REJET)",
      await storageRemoved(`${C1.uid}/`),
    );
    const d3prof = await svc
      .from("candidate_profiles")
      .select("cni_verified, cni_rejection_reason, cni_front_url")
      .eq("id", C1.profileId!)
      .single();
    ok(
      "D3 : profil cni_verified='rejected' + motif + cni_front_url NULL",
      d3prof.data?.cni_verified === "rejected" &&
        typeof d3prof.data?.cni_rejection_reason === "string" &&
        d3prof.data?.cni_front_url === null,
      d3prof.data,
    );
    const d4page = await html(Rc, `/admin/cni?userId=${C1.uid}`);
    ok(
      "D4 : le candidat C1 retombe de la file « En attente » après reject",
      !d4page.includes("CniPend"),
    );

    // ── E. Skill-doc REJECT → purge du FICHIER (nouveau T8.4c) ────
    const e1 = await post(Rc, `/api/admin/skill-documents/${D.docId!}`, {
      action: "reject",
      rejection_reason: "Certificat falsifié",
    });
    ok(
      "E1 : POST /api/admin/skill-documents/[id] reject → 200",
      e1.status === 200,
      e1.json,
    );
    const { data: dList } = await svc.storage
      .from(BUCKET)
      .list(`${D.uid}/`, { limit: 50 });
    const e2gone = !(dList ?? []).some((o) => o.name.startsWith("skill-t84c-"));
    ok("E2 : fichier skill-doc supprimé du bucket (ligne conservée)", e2gone);
    const e3line = await svc
      .from("candidate_documents")
      .select("status, rejection_reason")
      .eq("id", D.docId!)
      .single();
    ok(
      "E3 : ligne skill-doc status='rejected' + motif (COMPTE conservé)",
      e3line.data?.status === "rejected" &&
        e3line.data?.rejection_reason === "Certificat falsifié",
      e3line.data,
    );
    const e4skill = await svc
      .from("candidate_skills")
      .select("verification_status")
      .eq("id", D.skillId!)
      .single();
    ok(
      "E4 : compétence liée recalcule à 'rejected' (recompute)",
      e4skill.data?.verification_status === "rejected",
      e4skill.data,
    );
    const e5page = await html(Rc, `/admin/skill-documents?userId=${D.uid}`);
    ok(
      "E5 : le document D retombe de la file « En attente » après reject",
      !e5page.includes("Certificat DocPend"),
    );
  } finally {
    await clean(D2);
    await clean(D);
    await clean(M2);
    await clean(C3);
    await clean(C2);
    await clean(C1);
    await clean(R);
  }

  console.log(
    `\n── ${fail === 0 ? "Toutes les assertions passent" : "ÉCHEC"} : ${pass}/${pass + fail} ──`,
  );
  if (fail > 0) process.exitCode = 1;
}

void main().catch((e) => {
  console.error("Preuve T8.4c interrompue :", e);
  process.exitCode = 1;
});
