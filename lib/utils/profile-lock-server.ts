/**
 * Logique serveur du verrou de profil (SRS §5.1) : lit/clôture les demandes
 * de mise à jour admin (`profile_update_requests`). Séparé de `profile-lock.ts`
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

/**
 * Clôture les demandes `pending` du candidat qui couvraient au moins un des
 * groupes effectivement (ré)soumis — appelé dès que le candidat exécute la
 * mise à jour demandée. N'achève PAS une ligne qui ne contient aucun de ces
 * groupes (ex. demande "cni_documents" alors que le candidat n'a touché
 * que son identité). Idempotent.
 */
export async function completePendingRequests(
  supabase: CandidateClient,
  candidateId: string,
  touchedGroups: ProfileLockGroup[],
): Promise<void> {
  const groups = touchedGroups.filter((g) => PROFILE_LOCK_GROUPS.includes(g));
  if (groups.length === 0) return;
  const now = new Date().toISOString();
  await Promise.all(
    groups.map((g) =>
      // `.contains()` sérialise l'opérateur PostgREST `cs` correctement sur la
      // colonne text[] `fields` (≠ `.filter("fields","cs",[g])` : `.filter`
      // attend une chaîne raw PostgREST, pas un array JS). Une ligne est
      // clôturée si `fields` contient le groupe effectivement (ré)soumis.
      supabase
        .from("profile_update_requests")
        .update({ status: "done", completed_at: now })
        .eq("candidate_id", candidateId)
        .eq("status", "pending")
        .contains("fields", [g]),
    ),
  );
}
