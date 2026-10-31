import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { identitySchema } from "@/lib/validations/profile";
import {
  changedIdentityFields,
  evaluateProfileLock,
  lockedGroupsForCni,
} from "@/lib/utils/profile-lock";
import { pendingRequestedGroups } from "@/lib/utils/profile-lock-server";

/**
 * Le nom/prénom sert à la vérification CNI (SRS §11.5 : le nom du document
 * doit correspondre au nom du candidat) : si le nom OU la date de naissance
 * change alors que le CNI était `verified`, on réutilise le seul statut réel
 * existant (`cni_verified`) et on le repasse à `pending` — jamais inventé
 * côté client, jamais un simple avertissement sans effet réel en base.
 *
 * Verrou SRS §5.1 (T2) : quand le CNI est vérifié, les champs identité ne
 * sont modifiables QUE si un admin a initié une mise à jour
 * (`profile_update_requests` en statut `pending` couvrant le groupe).
 * Sans demande, `403 field_locked`. Avec demande, le champ est déverrouillé,
 * le CNI repasse `pending` et la demande est clôturée en `done`.
 *
 * La règle est appliquée par la base (trigger
 * `trg_protect_verified_candidate_data`, F-35) : la vérification ci-dessous
 * ne sert qu'à répondre 403 avant toute écriture.
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
  const parsed = identitySchema.safeParse(body);
  if (!parsed.success) {
    // T5.1 — codes machine spécifiques : la zone de service (lat/lng hors
    // Douala/Yaoundé) et la ville inconnue doivent être distinguées des
    // erreurs de format classiques (le corps `issues` reste inchangé).
    const issues = parsed.error.issues;
    const geoOutOfZone = issues.some((i) => i.message === "geoOutOfZone");
    const cityNotServed = issues.some((i) => i.message === "cityNotServed");
    const code = geoOutOfZone
      ? "geo_out_of_zone"
      : cityNotServed
        ? "city_not_served"
        : "invalid_input";
    return NextResponse.json(
      { error: "Invalid input", code, issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: current } = await supabase
    .from("candidate_profiles")
    .select(
      "id, first_name, last_name, date_of_birth, cni_verified, cni_rejection_reason",
    )
    .eq("user_id", user.id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // ── Verrou SRS §5.1 : champs vérifiés mais sans demande admin pending ──
  const modifiedFields = changedIdentityFields(parsed.data, current);
  const requestedGroups = await pendingRequestedGroups(supabase, current.id);
  const lock = evaluateProfileLock(
    modifiedFields,
    lockedGroupsForCni(current.cni_verified),
    requestedGroups,
  );

  // Une non-modification (mêmes valeurs) ne touche jamais un champ.
  if (lock.blocked) {
    return NextResponse.json(
      {
        error: "Field locked",
        code: "field_locked",
        lockedGroups: lock.lockedGroups,
      },
      { status: 403 },
    );
  }

  // Le nom OU la date de naissance a changé sur un CNI vérifié :
  // révérification requise (statut réel, pas un simple message).
  const requiresReverification =
    current.cni_verified === "verified" &&
    (current.first_name !== parsed.data.first_name ||
      current.last_name !== parsed.data.last_name ||
      current.date_of_birth !== parsed.data.date_of_birth);

  // La base applique la même règle dans l'écriture ci-dessous
  // (trg_protect_verified_candidate_data) : repasse en `pending` et clôture
  // en `done` les demandes couvrant le groupe touché, atomiquement.
  const { error: updateError } = await supabase
    .from("candidate_profiles")
    .update({
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      date_of_birth: parsed.data.date_of_birth,
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

  // Demande clôturée entre la lecture et l'écriture : refus de la base.
  if (updateError?.message === "field_locked") {
    return NextResponse.json(
      {
        error: "Field locked",
        code: "field_locked",
        lockedGroups: ["identity"],
      },
      { status: 403 },
    );
  }
  if (updateError) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requiresReverification });
}
