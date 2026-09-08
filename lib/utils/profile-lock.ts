/**
 * Verrouillage des informations vérifiées du profil candidat (SRS §5.1).
 *
 * Règle : quand une donnée a été vérifiée (CNI), le candidat ne peut plus la
 * modifier librement — un admin doit initier la mise à jour (`profile_update_requests`
 * en statut `pending`) pour que le champ soit déverrouillé. C'est la source de
 * vérité côté serveur : le masquage client (champ désactivé) n'est qu'un confort.
 *
 * Fonctions pures, sans effet de bord : testables en unité, réutilisables
 * côté serveur (routes) et côté client (afficher les champs verrouillés).
 */

/** Groupes de champs verrouillables (voir migration profile_update_requests). */
export const PROFILE_LOCK_GROUPS = ["identity", "cni_documents"] as const;
export type ProfileLockGroup = (typeof PROFILE_LOCK_GROUPS)[number];

/**
 * Un groupe n'est verrouillé QUE si la donnée est vérifiée :
 * `identity` si `cni_verified === "verified"`, `cni_documents` idem.
 * (Un CNI `pending`/`rejected` n'est pas "vérifié" : le candidat peut
 * légitimement re-soumettre sans demande admin. `momo` est volontairement
 * hors périmètre T2 — pas de verrou.)
 */
export function lockedGroupsForCni(
  cniVerified: string | null,
): ProfileLockGroup[] {
  return cniVerified === "verified" ? PROFILE_LOCK_GROUPS.slice() : [];
}

/** Les champs identité couverts par le groupe `identity` (modifiables). */
export const IDENTITY_LOCK_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
] as const;

/** Les champs document couverts par le groupe `cni_documents`. */
export const CNI_DOCUMENT_LOCK_FIELDS = [
  "cni_front_url",
  "cni_back_url",
  "cni_selfie_url",
] as const;

const LOCK_GROUP_BY_FIELD: Record<string, ProfileLockGroup> = {
  first_name: "identity",
  last_name: "identity",
  date_of_birth: "identity",
  cni_number: "identity",
  cni_front_url: "cni_documents",
  cni_back_url: "cni_documents",
  cni_selfie_url: "cni_documents",
};

export function lockGroupForField(field: string): ProfileLockGroup | undefined {
  return LOCK_GROUP_BY_FIELD[field];
}

/**
 * Calcule les champs réellement modifiés dans la soumission identité
 * (une valeur identique à l'existant n'est pas une « modification »).
 * `cni_number` absent du schéma public (jamais modifiable par le candidat)
 * — le reste de l'identité l'est.
 */
export function changedIdentityFields(
  submitted: { first_name: string; last_name: string; date_of_birth: string },
  current: {
    first_name: string | null;
    last_name: string | null;
    date_of_birth: string | null;
  },
): string[] {
  return IDENTITY_LOCK_FIELDS.filter((f) => {
    const next = (submitted as Record<string, unknown>)[f];
    const prev = (current as Record<string, unknown>)[f] ?? null;
    return next !== prev;
  });
}

export interface ProfileLockCheck {
  /** true si l'opération doit être refusée (403 field_locked). */
  blocked: boolean;
  /** Groupes couverts par les champs touchés (pour la réponse 403). */
  lockedGroups: ProfileLockGroup[];
  /** Groupes verrouillés mais couverts par une demande admin en attente
   *  (le verrou est alors levé côté route + la demande est clôturée). */
  unlockedByRequests: ProfileLockGroup[];
}

/**
 * Décide verrou / déverrouillage pour un ensemble de champs modifiés.
 *
 * - `verifiedGroups` : groupes verrouillés sur le profil courant (CNI vérifiée).
 * - `requestedGroups` : groupes couverts par au moins une demande admin `pending`.
 *
 * Un champ est bloqué s'il appartient à un groupe vérifié MAIS non couvert
 * par une demande pending. S'il est couvert, il est déverrouillé : la route
 * repasse le CNI en `pending` (révérification) et clôt la demande.
 */
export function evaluateProfileLock(
  modifiedFields: string[],
  verifiedGroups: ProfileLockGroup[],
  requestedGroups: ProfileLockGroup[],
): ProfileLockCheck {
  const groups = [
    ...new Set(
      modifiedFields
        .map((f) => lockGroupForField(f))
        .filter((g): g is ProfileLockGroup => g !== undefined),
    ),
  ];

  const unlockedByRequests: ProfileLockGroup[] = [];
  const lockedGroups: ProfileLockGroup[] = [];
  for (const group of groups) {
    if (!verifiedGroups.includes(group)) continue;
    if (requestedGroups.includes(group)) {
      unlockedByRequests.push(group);
    } else {
      lockedGroups.push(group);
    }
  }

  return {
    blocked: lockedGroups.length > 0,
    lockedGroups,
    unlockedByRequests,
  };
}
