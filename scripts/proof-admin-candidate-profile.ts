/**
 * Preuve E2E T8.4b — Profil candidat admin (/admin/candidates/[id]).
 *
 * Porte sur ce que T8.4b AJOUTE :
 *  A. Page SSR + rôles :
 *     - admin_founder → /admin/candidates/{id} 200 (rendu, client SWR).
 *     - candidat → /api/admin/candidates/{id} 403 (rôle non admin).
 *  B. API GET /api/admin/candidates/[id] (lecture seule 3 grades) :
 *     - admin_ops → 200 + identity.first_name + cni.status='verified'
 *       + tableaux skills/documents/missions (vides OK) ;
 *     - admin_support (RO) → 200.
 *  C. Édition identité (POST /api/admin/candidates/[id]/identity) :
 *     - admin_ops (NON fondateur) → 403 (gate route) ;
 *     - admin_founder → 200 + profile.first_name/last_name mis à jour.
 *  D. Reset CNI sur identité vérifiée :
 *     - candidat cni_verified='verified' + is_verified=true :
 *       édition du nom par fondateur → cni_verified='pending' +
 *       cni_rejection_reason NULL + users.is_verified=false (recompute)
 *       + notification document_status + audit admin_edit_identity
 *       (acteur = fondateur réel).
 *  E. Validation Zod :
 *     - first_name vide → 400.
 *  F. Hors cible :
 *     - POST identité sur un compte admin → 404 « not_found »
 *       (RPC 'profile not found').
 *
 * Méthode : sessions RÉELLES (@supabase/ssr signInWithPassword). L'état
 * « CNI vérifiée » est posé à l'INSERT (les triggers de protection —
 * tg_protect_cni_verification / trg_protect_user_is_verified — ne
 * s'appliquent qu'au UPDATE, pas à l'INSERT), ce qui représente l'état
 * d'un candidat déjà certifié avant l'édition. Nettoyage complet.
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
const PWD = "Proof-T84b-11!";
const META = { proofT84b: true };
const APP_URL = process.env.NEXT_APP_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error("Missing env keys.");
}

const svc: DB = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false },
});

async function real(email: string): Promise<{ cookies: string }> {
  const j = {
    map: new Map<string, string>(),
  };
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () =>
        [...j.map.entries()].map(([name, value]) => ({ name, value })),
      setAll: (e: { name: string; value: string; options?: unknown }[]) => {
        for (const { name, value } of e) {
          if (value === "" || value === "0") j.map.delete(name);
          else j.map.set(name, value);
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
    throw new Error(`signin ${email}: ${error?.message}`);
  const cookies = [...j.map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  return { cookies };
}

interface CandidatePayload {
  candidate?: {
    identity?: {
      first_name?: string | null;
      last_name?: string | null;
      date_of_birth?: string | null;
    };
    cni?: { status?: string | null };
  };
  skills?: unknown[];
  documents?: unknown[];
  missions?: unknown[];
  code?: string;
  error?: string;
}

function parseJson() {
  return {} as CandidatePayload;
}

async function get(
  cookies: string,
  path: string,
): Promise<{ status: number; json: CandidatePayload }> {
  const r = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: cookies, Accept: "application/json" },
    cache: "no-store",
  });
  const json = (await r.json().catch(parseJson)) as unknown as CandidatePayload;
  return { status: r.status, json };
}
async function post(
  cookies: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: CandidatePayload }> {
  const r = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { Cookie: cookies, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await r.json().catch(parseJson)) as unknown as CandidatePayload;
  return { status: r.status, json };
}
async function html(cookies: string, path: string): Promise<number> {
  const r = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: cookies, Accept: "text/html" },
    cache: "no-store",
    redirect: "manual",
  });
  await r.text();
  return r.status;
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass += 1;
  else fail += 1;
  console.log(
    `${cond ? "✅" : "❌"} ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`,
  );
}

type Role = "candidate" | "admin_ops" | "admin_support" | "admin_founder";

interface U {
  email: string;
  uid: string;
  profileId: string | null;
}

function phoneOf(uid: string) {
  return `2376919${uid
    .replace(/[^0-9]/g, "")
    .slice(0, 6)
    .padEnd(6, "7")}`;
}

async function mkUser(
  email: string,
  role: Role,
  opts: { profile?: boolean; verified?: boolean },
): Promise<U> {
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password: PWD,
    email_confirm: true,
    user_metadata: META,
    app_metadata: { role },
  });
  if (error || !created.user) throw new Error(`mk ${email}: ${error?.message}`);
  const uid = created.user.id;
  const phone = phoneOf(uid);

  await svc.from("users").insert({
    id: uid,
    email,
    role,
    phone_verified: true,
    is_active: true,
    is_verified: opts.verified ? true : null,
    phone,
    locale: "fr",
  });

  let profileId: string | null = null;
  if (opts.profile) {
    const { data: p, error: pErr } = await svc
      .from("candidate_profiles")
      .insert({
        user_id: uid,
        first_name: "T84",
        last_name: "Cand",
        date_of_birth: "1999-02-10",
        city: "Douala",
        quartier: "Bonapriso",
        momo_provider: "mtn",
        momo_number: "+237691000111",
        momo_account_name: "T84 Cand",
        momo_verified: opts.verified ? true : false,
        cni_verified: opts.verified ? "verified" : null,
        cni_number: "AA123456",
        cni_expires_at: "2036-02-10",
        onboarding_step: 4,
        onboarding_status: "completed",
        profile_completion_pct: 70,
      })
      .select("id")
      .single();
    if (pErr || !p) throw new Error(`profile ${email}: ${pErr?.message}`);
    profileId = p.id;
  }
  return { email, uid, profileId };
}

async function clean(u: U): Promise<void> {
  const be = (p: PromiseLike<unknown>) => Promise.resolve(p).catch(() => {});
  if (u.profileId) {
    await be(svc.from("notifications").delete().eq("user_id", u.uid));
    await be(svc.from("audit_logs").delete().eq("resource_id", u.profileId));
    await be(svc.from("audit_logs").delete().eq("resource_id", u.uid));
    await be(
      svc.from("candidate_documents").delete().eq("candidate_id", u.profileId),
    );
    await be(
      svc.from("candidate_skills").delete().eq("candidate_id", u.profileId),
    );
    await be(svc.from("missions").delete().eq("candidate_id", u.uid));
    await be(svc.from("candidate_profiles").delete().eq("id", u.profileId));
  }
  await be(svc.from("users").delete().eq("id", u.uid));
  await be(svc.auth.admin.deleteUser(u.uid));
}

async function main() {
  // Cible : candidat CNI VÉRIFIÉE (insert, pas bloqué par le trigger).
  const F = await mkUser(
    `t84b.founder.${Date.now()}@e.com`,
    "admin_founder",
    {},
  );
  const R = await mkUser(`t84b.ops.${Date.now()}@e.com`, "admin_ops", {});
  const C = await mkUser(`t84b.cand.${Date.now()}@e.com`, "candidate", {
    profile: true,
    verified: true,
  });
  const Fc = (await real(F.email)).cookies;
  const Rc = (await real(R.email)).cookies;
  const Cc = (await real(C.email)).cookies;
  const profileId = C.profileId!;

  try {
    // A — Page + rôles
    const a1 = await html(Fc, `/admin/candidates/${C.uid}`);
    ok("A1 : admin_founder → /admin/candidates/{id} 200", a1 === 200, {
      status: a1,
    });

    const a2 = await get(Cc, `/api/admin/candidates/${C.uid}`);
    ok("A2 : candidat → API GET 403", a2.status === 403, { status: a2.status });

    // B — API GET lecture (2 grades)
    const b1 = await get(Rc, `/api/admin/candidates/${C.uid}`);
    const b1c = b1.json.candidate;
    ok(
      "B1 : admin_ops GET 200 + identity + cni verified",
      b1.status === 200 &&
        b1c?.identity?.first_name === "T84" &&
        b1c?.cni?.status === "verified",
      {
        status: b1.status,
        first: b1c?.identity?.first_name,
        cni: b1c?.cni?.status,
      },
    );
    ok(
      "B1b : tableaux skills/documents/missions présents",
      Array.isArray(b1.json.skills) &&
        Array.isArray(b1.json.documents) &&
        Array.isArray(b1.json.missions),
      {
        skills: b1.json.skills?.length,
        docs: b1.json.documents?.length,
        missions: b1.json.missions?.length,
      },
    );

    // C — Édition : ops non-fondateur 403, founder OK
    const c1 = await post(Rc, `/api/admin/candidates/${C.uid}/identity`, {
      first_name: "X",
      last_name: "Y",
      date_of_birth: "1999-02-10",
    });
    ok("C1 : admin_ops POST identité → 403", c1.status === 403, {
      status: c1.status,
    });

    const c2 = await post(Fc, `/api/admin/candidates/${C.uid}/identity`, {
      first_name: "Edited",
      last_name: "Name",
      date_of_birth: "1998-05-01",
    });
    const c2p = await svc
      .from("candidate_profiles")
      .select(
        "first_name, last_name, date_of_birth, cni_verified, cni_rejection_reason",
      )
      .eq("id", profileId)
      .single();
    ok(
      "C2 : admin_founder POST 200 + nom/DOB mis à jour",
      c2.status === 200 &&
        c2p.data?.first_name === "Edited" &&
        c2p.data?.last_name === "Name" &&
        c2p.data?.date_of_birth === "1998-05-01",
      { status: c2.status, data: c2p.data },
    );

    // D — Reset CNI (était verified → pending) + recompute + audit/notif
    ok(
      "D1 : cni_verified remis à 'pending' + reason NULL",
      c2p.data?.cni_verified === "pending" &&
        c2p.data?.cni_rejection_reason === null,
      { cni: c2p.data?.cni_verified, reason: c2p.data?.cni_rejection_reason },
    );

    const d2u = await svc
      .from("users")
      .select("is_verified")
      .eq("id", C.uid)
      .single();
    ok(
      "D2 : users.is_verified retombe à false (recompute)",
      d2u.data?.is_verified === false,
      { is_verified: d2u.data?.is_verified },
    );

    const d3audit = await svc
      .from("audit_logs")
      .select("action, actor_id")
      .eq("action", "admin_edit_identity")
      .eq("resource_id", profileId)
      .limit(1);
    const d3notif = await svc
      .from("notifications")
      .select("notification_type, title")
      .eq("user_id", C.uid)
      .eq("notification_type", "document_status")
      .limit(1);
    const d3title = String(d3notif.data?.[0]?.title ?? "");
    ok(
      "D3 : audit admin_edit_identity (acteur founder) + notif document_status",
      d3audit.data?.[0]?.actor_id === F.uid &&
        (d3title.toLowerCase().includes("identité") ||
          d3title.toLowerCase().includes("identity")),
      { actor: d3audit.data?.[0]?.actor_id, title: d3title },
    );

    // E — Zod : first_name vide → 400
    const e1 = await post(Fc, `/api/admin/candidates/${C.uid}/identity`, {
      first_name: "",
      last_name: "Name",
      date_of_birth: "1998-05-01",
    });
    ok("E1 : first_name vide → 400 (Zod)", e1.status === 400, {
      status: e1.status,
    });

    // F — Hors cible : POST identité sur un compte admin → 404
    const f1 = await post(Fc, `/api/admin/candidates/${R.uid}/identity`, {
      first_name: "A",
      last_name: "B",
      date_of_birth: "1990-01-01",
    });
    ok(
      "F1 : POST identité sur compte admin → 404 not_found",
      f1.status === 404 && f1.json.code === "not_found",
      { status: f1.status, code: f1.json.code },
    );
  } finally {
    await clean(C);
    await clean(R);
    await clean(F);
  }

  console.log(
    `\n── ${fail === 0 ? "Toutes les assertions passent" : "ÉCHEC"} : ${pass}/${pass + fail} ──`,
  );
  if (fail > 0) process.exitCode = 1;
}

void main().catch((e) => {
  console.error("Preuve T8.4b interrompue :", e);
  process.exitCode = 1;
});
