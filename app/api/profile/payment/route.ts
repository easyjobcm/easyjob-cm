import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { paymentSchema } from "@/lib/validations/profile";

/**
 * Un changement de numéro/opérateur invalide toujours la vérification en
 * cours : cette règle n'est définie ni dans le SRS ni par un trigger DB ;
 * elle est appliquée ici explicitement, côté serveur uniquement. Le client ne
 * peut jamais positionner `momo_verified` lui-même (champ absent du schéma).
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

  const { error: updateError } = await supabase
    .from("candidate_profiles")
    .update({
      momo_provider: parsed.data.momo_provider,
      momo_number: parsed.data.momo_number,
      momo_verified: false,
    })
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
