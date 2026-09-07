import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema } from "@/lib/validations/profile";

const requestSchema = identitySchema.extend({
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

/**
 * Le nom/prénom sert à la vérification CNI (SRS §11.5 : le nom du document
 * doit correspondre au nom du candidat). Aucune règle SRS ne définit
 * explicitement un statut de "reverification globale du profil" : on réutilise
 * le seul statut réel existant (`cni_verified`) et on le repasse à `pending`
 * uniquement si le nom change ET qu'il était `verified` — jamais inventé côté
 * client, jamais un simple avertissement sans effet réel en base.
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
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: current } = await supabase
    .from("candidate_profiles")
    .select("first_name, last_name, cni_verified")
    .eq("user_id", user.id)
    .single();

  const nameChanged =
    !!current &&
    (current.first_name !== parsed.data.first_name ||
      current.last_name !== parsed.data.last_name);
  const requiresReverification =
    nameChanged && current?.cni_verified === "verified";

  const { error: updateError } = await supabase
    .from("candidate_profiles")
    .update({
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      city: parsed.data.city,
      quartier: parsed.data.quartier || null,
      bio: parsed.data.bio || null,
      ...(parsed.data.latitude !== undefined
        ? { latitude: parsed.data.latitude }
        : {}),
      ...(parsed.data.longitude !== undefined
        ? { longitude: parsed.data.longitude }
        : {}),
      ...(requiresReverification
        ? { cni_verified: "pending", cni_rejection_reason: null }
        : {}),
    })
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requiresReverification });
}
