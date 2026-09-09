import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { paymentSchema } from "@/lib/validations/profile";

/**
 * T6 — enregistrement / changement du numéro Mobile Money.
 *
 * Le candidat ne peut JAMAIS positionner `momo_verified` / `momo_name_match`
 * / `momo_verified_*` lui-même : la migration T6 a protégé ces 6 colonnes
 * par un trigger `BEFORE UPDATE` (le flag session `easyjob.system_update`
 * n'étant pas posé pour un client). On passe donc par le RPC
 * SECURITY DEFINER `candidate_update_momo` qui réinitialise proprement
 * TOUT le cycle (vérification + preuve OTP) et supprime le code actif.
 *
 * Un changement de numéro/opérateur invalide toujours la vérification en
 * cours (règle SRS §11.5) — appliqué par le RPC, pas par cette route.
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error: rpcError } = await supabase.rpc("candidate_update_momo", {
    p_provider: parsed.data.momo_provider,
    p_number: parsed.data.momo_number,
    p_account_name: parsed.data.momo_account_name ?? null,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
