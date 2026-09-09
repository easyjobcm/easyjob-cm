import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { cniModerateSchema } from "@/lib/validations/profile";

/**
 * T8.3 — API admin CNI.
 *
 * GET  : liste des candidats avec CNI fournie (nom, statut
 *        cni_verified, n° CNI, date d'expiration, admin ayant vérifié).
 *        Rôles : les 3 grades (admin_support = lecture seule).
 *        Filtre optionnel `?status=verified|rejected|pending` sur
 *        `cni_verified` (défaut = tous).
 * POST : valider / refuser le CNI d'un profil (RÔLES
 *        admin_ops/admin_founder ; admin_support ne mute jamais).
 *        Passe au RPC SECURITY DEFINER `moderate_cni` (jamais
 *        createAdminClient — pour que l'audit loggue l'admin RÉEL et
 *        que `users.is_verified` (recompute_user_verification) soit
 *        posé par l'admin réel).
 *
 * T8.4 : à l'approbation, la route supprime ensuite les 3 objets
 * storage du bucket privé `candidate-documents` (service_role),
 * conformément au SRS §8.4 (les photos ne sont conservées que le
 * temps de la revue).
 */

const RPC_ERROR_MAP: [RegExp, { code: string; status: number }][] = [
  [/profile not found/i, { code: "not_found", status: 404 }],
  [/not authorized.*admin only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*role/i, { code: "forbidden", status: 403 }],
  [/invalid action/i, { code: "invalid_action", status: 400 }],
  [
    /cni documents not submitted/i,
    { code: "documents_not_submitted", status: 400 },
  ],
  [/identity incomplete/i, { code: "identity_incomplete", status: 400 }],
  [/reject reason required/i, { code: "reject_reason_required", status: 400 }],
];

/**
 * T8.4 — Suppression des photos CNI après approbation (SRS §8.4) :
 * l'admin a pu consulter les documents pendant la revue, la preuve d'identité
 * est posée dans `cni_verified='verified'` — les objets ne servent plus et
 * sont retirés du bucket privé. `candidate_profiles.cni_*_url` est NULLifié en
 * parallèle (le flag `verified` reste la source de vérité du gate ; les
 * `has_cni`/visuels retombent sur « vérifié, photos non conservées »).
 *
 * Service role OBLIGATOIRE : le bucket `candidate-documents` est privé
 * (RLS storage) et la policy « update own profile » de candidate_profiles
 * n'autorise que le candidat propriétaire — le client session de l'admin
 * échouerait silencieusement sur les deux (RLS = 0 ligne, pas d'erreur).
 * Ce n'est PAS une violation du principe « audit logge l'admin réel » :
 * le verdict passe par le RPC `moderate_cni` (session admin) ; cette
 * suppression post-verdict est un housekeeping storage sans valeur audit.
 */
async function removeCniPhotos(profileId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: profile, error: readErr } = await supabase
    .from("candidate_profiles")
    .select("id, user_id, cni_front_url, cni_back_url, cni_selfie_url")
    .eq("id", profileId)
    .single();

  if (readErr || !profile) return; // best effort : ne bloque pas l'approve

  const paths = [
    profile.cni_front_url,
    profile.cni_back_url,
    profile.cni_selfie_url,
  ]
    .filter((p): p is string => !!p)
    // Garde : ne jamais supprimer un objet qui n'appartient pas au
    // candidat propriétaire du profil (préfixe `<user_id>/`).
    .filter((p) => p.startsWith(`${profile.user_id}/`));

  if (paths.length > 0) {
    await supabase.storage.from("candidate-documents").remove(paths);
  }

  // Ne reposer les URLs QUE si la suppression storage a réussi : sinon on
  // orphelinerait les objets alors qu'ils servent encore (ex. échec
  // réseau storage) — la revue reste faisable.
  if (paths.length > 0) {
    await supabase
      .from("candidate_profiles")
      .update({
        cni_front_url: null,
        cni_back_url: null,
        cni_selfie_url: null,
      })
      .eq("id", profileId);
  }
}

function roleForbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    return roleForbiddenResponse();
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") as
    | "verified"
    | "rejected"
    | "pending"
    | null;
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? 100) || 100, 1),
    500,
  );

  // CNI « fournie » = au moins une photo recto/verso/selfie (cni_front_url
  // est le premier document de l'upload). On trie par plus ancien en tête
  // (nulls d'abord = jamais revu) pour la file de revue.
  let query = supabase
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, date_of_birth,
       cni_number, cni_verified, cni_expires_at, cni_rejection_reason,
       cni_front_url, cni_back_url, cni_selfie_url`,
    )
    .not("cni_front_url", "is", null)
    .order("cni_expires_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (statusFilter) {
    query = query.eq("cni_verified", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Les chemins du bucket privé ne sont JAMAIS servis au client : on ne
  // renvoie que la présence du document par champ (l'URL signée passe par
  // l'API T8.2 `/api/admin/momo/[profileId]/cni-url`).
  const profiles = (data ?? []).map((p) => ({
    id: p.id,
    user_id: p.user_id,
    first_name: p.first_name,
    last_name: p.last_name,
    date_of_birth: p.date_of_birth,
    cni_number: p.cni_number,
    cni_verified: p.cni_verified ?? null,
    cni_expires_at: p.cni_expires_at,
    cni_rejection_reason: p.cni_rejection_reason,
    has_cni_front: Boolean(p.cni_front_url),
    has_cni_back: Boolean(p.cni_back_url),
    has_cni_selfie: Boolean(p.cni_selfie_url),
  }));

  return NextResponse.json({ profiles });
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

  // Mutation réservée à admin_ops / admin_founder (admin_support = RO).
  if (
    !userData?.role ||
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return roleForbiddenResponse();
  }

  const body = await request.json().catch(() => null);
  const parsed = cniModerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { profile_id, action, rejection_reason, expires_at } = parsed.data;

  const { error: rpcError } = await supabase.rpc("moderate_cni", {
    p_profile_id: profile_id,
    p_action: action,
    p_reject_reason: (action === "reject"
      ? (rejection_reason ?? null)
      : null) as string,
    p_expires_at: (action === "approve" ? (expires_at ?? null) : null) as
      | string
      | null,
  });

  if (rpcError) {
    const matched = RPC_ERROR_MAP.find(([re]) => re.test(rpcError.message));
    if (matched) {
      return NextResponse.json(
        { code: matched[1].code, error: rpcError.message },
        { status: matched[1].status },
      );
    }
    console.error("[cni-admin] moderate rpc failed:", rpcError.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  // T8.4 (livré avec T8.3 — la revue CNI est le moment où la suppression
  // a lieu, SRS §8.4) : à l'approbation, on retire les 3 photos du bucket
  // privé + on NULLifie les URLs du profil. Best effort : si la suppression
  // storage échoue (réseau), on log + on ne bloque PAS le verdict admin
  // (l'admin peut relancer la suppression au re-approve, T8.8 settings).
  if (action === "approve") {
    try {
      await removeCniPhotos(profile_id);
    } catch (err) {
      console.error("[cni-admin] photo removal failed (verdict kept):", err);
    }
  }

  return NextResponse.json({
    ok: true,
    status: action === "approve" ? "verified" : "rejected",
  });
}
