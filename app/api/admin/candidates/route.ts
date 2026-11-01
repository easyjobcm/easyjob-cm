import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { userModerateSchema } from "@/lib/validations/admin-users";

/**
 * T8.4a — API admin « Candidats » (vue centralisée /admin/candidates).
 *
 * GET  : liste des candidats avec leurs données de profil et l'état du
 *        compte. Rôles : les 3 grades (admin_support = lecture seule).
 *        Recherche libre (?q=) par nom / e-mail / téléphone (côté
 *        client sur le lot renvoyé) + sections En attente / Validés /
 *        Suspendus dérivées côté client.
 *
 *        LECTURE via service_role (`createAdminClient()`), car `users`
 *        n'a AUCUNE policy SELECT admin (RLS « propre profil » seulement)
 *        — la session admin ne voit que sa propre ligne. Lecture agrégée
 *        d'admin sans valeur d'audit → service_role, pattern établi
 *        (removeCniPhotos). La mutation (POST) passe par RPC SECURITY
 *        DEFINER en session admin pour que l'audit loggue l'admin réel.
 *
 *        Jamais de chemin de fichier stocké renvoyé : on ne renvoie que
 *        la présence de la photo (booléen) — l'URL signée passe par
 *        `/api/admin/profiles/[profileId]/photo-url`.
 *
 * POST : suspendre / réactiver un compte candidat (RÔLES
 *        admin_ops/admin_founder ; admin_support ne mute jamais).
 *        Passe au RPC `admin_set_user_active` — `is_active` est le seul
 *        levier (ne touche JAMAIS aux flags de vérification : is_verified,
 *        cni_verified, momo_verified). Les candidats/entreprises rejetés
 *        ne sont PAS supprimés (SRS §6.14.4) : ils restent en « En attente
 *        » avec le motif affiché et peuvent ré-émettre (flux T8.3).
 */

const RPC_ERROR_MAP: [RegExp, { code: string; status: number }][] = [
  [/not authorized.*admin only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*role/i, { code: "forbidden", status: 403 }],
  [/cannot modify own account/i, { code: "self_modification", status: 403 }],
  [/cannot modify admin account/i, { code: "admin_modification", status: 403 }],
  [/user not found/i, { code: "not_found", status: 404 }],
];

interface CandidateProfileRow {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  profile_photo_url: string | null;
  momo_provider: "mtn" | "orange" | null;
  momo_number: string | null;
  momo_verified: boolean | null;
  momo_reject_reason: string | null;
  cni_verified: "pending" | "verified" | "rejected" | null;
  cni_expires_at: string | null;
  cni_number: string | null;
  cni_rejection_reason: string | null;
}

interface CandidateItem {
  id: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string | null;
  profile_id: string | null;
  first_name: string | null;
  last_name: string | null;
  has_photo: boolean;
  momo_provider: "mtn" | "orange" | null;
  momo_number: string | null;
  momo_verified: boolean | null;
  momo_reject_reason: string | null;
  cni_verified: "pending" | "verified" | "rejected" | null;
  cni_expires_at: string | null;
  cni_number: string | null;
  cni_rejection_reason: string | null;
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

  // Lecture agrégée admin (service_role) : la session admin ne peut pas
  // lire les autres lignes de `users` (RLS « propre profil » seulement).
  //
  // Pas d'embed PostgREST `users → candidate_profiles` : plus d'une FK
  // relie les deux tables (candidate_profiles.user_id ET momo_verified_by
  // → users.id) → « Could not embed because more than one relationship ».
  // Deux requêtes séparées + merge côté serveur (1:1 sur user_id).
  const admin = createAdminClient();

  const { data: users, error: usersErr } = await admin
    .from("users")
    .select("id, email, phone, is_active, is_verified, created_at")
    .in("role", ["candidate", "candidate_premium"])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (usersErr) {
    console.error("[admin-candidates] users query:", usersErr.message);
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
    return NextResponse.json({ candidates: [] });
  }

  const { data: profiles, error: profilesErr } = await admin
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, profile_photo_url,
       momo_provider, momo_number, momo_verified, momo_reject_reason,
       cni_verified, cni_expires_at, cni_number, cni_rejection_reason`,
    )
    .in(
      "user_id",
      userRows.map((u) => u.id),
    );
  if (profilesErr) {
    console.error("[admin-candidates] profiles query:", profilesErr.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const profileByUser = new Map<string, CandidateProfileRow>();
  for (const p of (profiles ?? []) as CandidateProfileRow[]) {
    profileByUser.set(p.user_id, p);
  }

  let candidates: CandidateItem[] = userRows.map((u) => {
    const p = profileByUser.get(u.id) ?? null;
    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
      is_active: u.is_active ?? true,
      is_verified: u.is_verified ?? false,
      created_at: u.created_at,
      profile_id: p?.id ?? null,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      has_photo: !!p?.profile_photo_url,
      momo_provider: p?.momo_provider ?? null,
      momo_number: p?.momo_number ?? null,
      momo_verified: p?.momo_verified ?? null,
      momo_reject_reason: p?.momo_reject_reason ?? null,
      cni_verified: p?.cni_verified ?? null,
      cni_expires_at: p?.cni_expires_at ?? null,
      cni_number: p?.cni_number ?? null,
      cni_rejection_reason: p?.cni_rejection_reason ?? null,
    };
  });

  // Recherche libre nom / e-mail / téléphone (côté serveur, PostgREST ne
  // supporte pas les références d'embed dans .or()).
  if (q) {
    candidates = candidates.filter((c) =>
      [c.email, c.phone, c.first_name, c.last_name]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }

  return NextResponse.json({ candidates });
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
      "[admin-candidates] set-user-active rpc failed:",
      rpcError.message,
    );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, is_active: active });
}
