import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { candidateIdentityEditSchema } from "@/lib/validations/admin-users";

/**
 * T8.4b — Édition d'identité d'un candidat (page /admin/candidates/[id]).
 *
 * POST : corrige prénom / nom / date de naissance. RÔLE admin_founder
 *       UNIQUEMENT (décision produit : « juste modifiable par l'admin
 *       founder » — l'édition d'identité a un impact fort : sur un CNI
 *       vérifié, elle force la re-vérification).
 *
 *       Passe par le RPC SECURITY DEFINER `admin_edit_candidate_identity`
 *       EN SESSION ADMIN : le RPC fait l'écriture candidate_profiles, la
 *       remise `cni_verified='pending'` (si CNI vérifiée + changement
 *       nom/DOB) + `recompute_user_verification` (retrait du flag
 *       is_verified), la notification `document_status` au candidat et
 *       l'audit `admin_edit_identity` (acteur = auth.uid() = l'admin
 *       réel). Jamais de service_role pour la mutation (pattern T8) :
 *       l'audit loggue l'admin réel, pas un service token.
 */

type RouteContext = { params: Promise<{ id: string }> };

const RPC_ERROR_MAP: [RegExp, { code: string; status: number }][] = [
  [/not authorized.*admin only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*admin_founder only/i, { code: "forbidden", status: 403 }],
  [/not authorized.*role/i, { code: "forbidden", status: 403 }],
  [/user not found/i, { code: "not_found", status: 404 }],
  [/profile not found/i, { code: "not_found", status: 404 }],
  [/first_name cannot be empty/i, { code: "invalid_name", status: 400 }],
  [/last_name cannot be empty/i, { code: "invalid_name", status: 400 }],
  [/date_of_birth cannot be null/i, { code: "invalid_dob", status: 400 }],
];

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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

  // Gate route : admin_founder uniquement. Le RPC le re-vérifie (défense
  // en profondeur) — un admin_ops n'atteint jamais l'écriture.
  if (userData?.role !== "admin_founder") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await _request.json().catch(() => null);
  const parsed = candidateIdentityEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { first_name, last_name, date_of_birth } = parsed.data;

  const { error: rpcError } = await supabase.rpc(
    "admin_edit_candidate_identity",
    {
      p_user_id: id,
      p_first_name: first_name,
      p_last_name: last_name,
      p_date_of_birth: date_of_birth,
    },
  );

  if (rpcError) {
    const matched = RPC_ERROR_MAP.find(([re]) => re.test(rpcError.message));
    if (matched) {
      return NextResponse.json(
        { code: matched[1].code, error: rpcError.message },
        { status: matched[1].status },
      );
    }
    console.error(
      "[admin-candidates] edit-identity rpc failed:",
      rpcError.message,
    );
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
