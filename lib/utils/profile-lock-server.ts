/**
 * Logique serveur du verrou de profil (SRS §5.1) : lit les demandes de mise
 * à jour admin (`profile_update_requests`). Leur clôture en `done` est faite
 * par la base, dans l'écriture du candidat
 * (`trg_protect_verified_candidate_data`). Séparé de `profile-lock.ts`
 * (fonctions pures, testables en unité) car ça requiert un client Supabase.
 *
 * RLS source de vérité : le client serveur se connecte avec la session du
 * candidat, il ne peut lire que SES demandes `pending` — aucun candidat ne
 * peut forcer la lecture d'une demande d'un autre.
 */
import type { createClient } from "@/lib/supabase/server";
import {
  PROFILE_LOCK_GROUPS,
  type ProfileLockGroup,
} from "@/lib/utils/profile-lock";

/** Client serveur `@supabase/ssr` tel que produit par `createClient()`. */
type CandidateClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Groupes couverts par au moins une demande admin `pending` du candidat.
 * Les statuts `done`/`cancelled` ne déverrouillent rien.
 */
export async function pendingRequestedGroups(
  supabase: CandidateClient,
  candidateId: string,
): Promise<ProfileLockGroup[]> {
  const { data } = await supabase
    .from("profile_update_requests")
    .select("fields")
    .eq("candidate_id", candidateId)
    .eq("status", "pending");

  const groups = new Set<ProfileLockGroup>();
  for (const row of data ?? []) {
    const fields: unknown = row.fields;
    if (!Array.isArray(fields)) continue;
    for (const group of PROFILE_LOCK_GROUPS) {
      if (fields.includes(group)) groups.add(group);
    }
  }
  return [...groups];
}
