import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { userModerateSchema } from "@/lib/validations/admin-users";

/**
 * T8.4a — API admin « Entreprises » (vue centralisée /admin/companies).
 *
 * GET  : liste des entreprises avec leur profil et l'état du compte.
 *        Rôles : les 3 grades (admin_support = lecture seule).
 *        Sections En attente / Validées / Suspendues :
 *        - « En attente » : company_profiles.verification_status =
 *          'pending' (les entreprises refusées y retombent — SRS §6.14.4 :
 *          pas de suppression, ré-émission possible) ;
 *        - « Validées »   : verification_status = 'verified' ET compte actif ;
 *        - « Suspendues » : users.is_active = false.
 *        Recherche libre (?q=) par nom / e-mail / téléphone.
 *
 *        LECTURE via service_role (`createAdminClient()`) : `company_profiles`
 *        et `users` n'ont AUCUNE policy SELECT admin (seules «Companies can
 *        view own profile» / «Users can view own profile» existent) — la
 *        session admin ne verrait que 0 ligne. Pattern établi
 *        (removeCniPhotos). La mutation (POST) passe par RPC SECURITY
 *        DEFINER en session admin pour que l'audit loggue l'admin réel.
 *
 *        Jamais de chemin de logo stocké renvoyé : on ne renvoie que la
 *        présence du logo (booléen).
 *
 * POST : suspendre / réactiver une entreprise (RÔLES admin_ops/
 *        admin_founder ; admin_support ne mute jamais) via le même RPC
 *        `admin_set_user_active` que les candidats (le compte entreprise
 *        se suspend via son ligne users).
 */

const RPC_ERROR_MAP: [RegExp, { code: string; status: number }][] = [
  [/not authorized.*admin only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*role/i, { code: "forbidden", status: 403 }],
  [/cannot modify own account/i, { code: "self_modification", status: 403 }],
  [/cannot modify admin account/i, { code: "admin_modification", status: 403 }],
  [/user not found/i, { code: "not_found", status: 404 }],
];

interface CompanyProfileRow {
  id: string;
  user_id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  verification_status: "pending" | "verified" | "rejected";
  verification_rejection_reason: string | null;
  logo_url: string | null;
  created_at: string | null;
}

interface CompanyItem {
  id: string;
  is_active: boolean;
  user_id: string | null;
  is_verified: boolean;
  company_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  verification_status: "pending" | "verified" | "rejected" | null;
  verification_rejection_reason: string | null;
  has_logo: boolean;
  created_at: string | null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userData?.role ||
    !["admin_support", "admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  // Lecture agrégée admin (service_role) : sans policy SELECT admin sur
  // users/company_profiles, la session admin ne verrait que 0 ligne.
  // Deux requêtes séparées + merge côté serveur — PostgREST refuse les
  // références d'embed dans `.or()`, la recherche est faite en JS sur le
  // lot (limité à 5000 comptes, acceptable pour le MVP).
  const admin = createAdminClient();

  const { data: users, error: usersErr } = await admin
    .from("users")
    .select("id, email, phone, is_active, is_verified, created_at")
    .in("role", ["company", "company_premium"])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (usersErr) {
    console.error("[admin-companies] users query:", usersErr.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const userRows = users as Array<{
    id: string;
    email: string | null;
    phone: string | null;
    is_active: boolean | null;
    is_verified: boolean | null;
    created_at: string | null;
  }>;
  if (userRows.length === 0) {
    return NextResponse.json({ companies: [] });
  }

  const { data: profiles, error: profilesErr } = await admin
    .from("company_profiles")
    .select(
      `id, user_id, company_name, contact_name, contact_email,
       contact_phone, city, verification_status,
       verification_rejection_reason, logo_url, created_at`,
    )
    .in(
      "user_id",
      userRows.map((u) => u.id),
    );
  if (profilesErr) {
    console.error("[admin-companies] profiles query:", profilesErr.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const profileByUser = new Map<string, CompanyProfileRow>();
  for (const p of (profiles ?? []) as CompanyProfileRow[]) {
    profileByUser.set(p.user_id, p);
  }

  let companies: CompanyItem[] = userRows.map((u) => {
    const p = profileByUser.get(u.id) ?? null;
    return {
      id: u.id,
      is_active: u.is_active ?? true,
      user_id: u.id,
      is_verified: u.is_verified ?? false,
      company_id: p?.id ?? null,
      company_name: p?.company_name ?? null,
      contact_name: p?.contact_name ?? null,
      contact_email: p?.contact_email ?? null,
      contact_phone: p?.contact_phone ?? null,
      city: p?.city ?? null,
      verification_status: p?.verification_status ?? null,
      verification_rejection_reason: p?.verification_rejection_reason ?? null,
      has_logo: !!p?.logo_url,
      created_at: p?.created_at ?? u.created_at,
    };
  });

  if (q) {
    companies = companies.filter((c) =>
      [c.company_name, c.contact_name, c.contact_email, c.contact_phone]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }

  return NextResponse.json({ companies });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userData?.role ||
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = userModerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { user_id, action } = parsed.data;
  const active = action === "activate";

  const { error: rpcError } = await supabase.rpc("admin_set_user_active", {
    p_user_id: user_id,
    p_active: active,
  });

  if (rpcError) {
    const matched = RPC_ERROR_MAP.find(([re]) => re.test(rpcError.message));
    if (matched) {
      return NextResponse.json(
        { code: matched[1].code, error: rpcError.message },
        { status: matched[1].status },
      );
    }
    console.error(
      "[admin-companies] set-user-active rpc failed:",
      rpcError.message,
    );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, is_active: active });
}
