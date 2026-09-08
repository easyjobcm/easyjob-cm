/**
 * Garde-fou « compétence de conduite -> permis vérifié » — miroir TS du
 * mapping + modèle de satisfaction SQL (migration 20260908150000, T3.1).
 * La source de vérité reste LE TRIGGER Postgres (l'insert est refusé en DB
 * même via la SDK Supabase directe) ; ce module sert à (1) pré-empter le
 * blocage côté client pour afficher le bon message AVANT la requête, et
 * (2) activer/désactiver les chips dans /profile/skills et l'onboarding.
 *
 * RÈGLE DE SYNCHRONISATION : toute modification du mapping ou des
 * ensembles « satisfait par » doit se faire SIMULTANÉMENT dans
 * `supabase/migrations/20260908150000_candidate_documents_license_category.sql`
 * (fonctions `skill_requires_license` / `has_verified_license_for`) ET ici.
 * L'équivalence est verrouillée par `tests/license-requirements.test.ts`
 * (mapping + hiérarchie en TS) et par la preuve E2E (trigger en DB).
 */

/** Catégories de permis — mêmes valeurs que `LICENSE_CATEGORIES` (Zod). */
export type LicenseCategoryT31 =
  | "moto"
  | "voiture"
  | "fourgon"
  | "camion"
  | "bus"
  | "tous_types";

/**
 * Noms de compétences (lowercase/trimmés — identiques aux noms du catalogue,
 * non accentués). `CONDUITE BUS` est une skill ajoutée par T3.1 au catalogue.
 */
export type DrivingSkillName =
  | "conduite moto"
  | "taxi moto"
  | "livraison moto"
  | "conduite voiture"
  | "livraison voiture"
  | "conduite fourgon"
  | "conduite camion"
  | "conduite bus";

/** Mapping skill -> catégorie requise (strict : moto != voiture). */
const SKILL_LICENSE_MAP: Readonly<
  Record<DrivingSkillName, LicenseCategoryT31>
> = {
  "conduite moto": "moto",
  "taxi moto": "moto",
  "livraison moto": "moto",
  "conduite voiture": "voiture",
  "livraison voiture": "voiture",
  "conduite fourgon": "fourgon",
  "conduite camion": "camion",
  "conduite bus": "bus",
};

/**
 * Catégories de permis qui SATISFAISSENT une exigence — « sets satisfait par ».
 * Modèles par exigence :
 *   moto       -> [moto]
 *   voiture    -> [voiture]
 *   fourgon    -> [fourgon, camion]   (un permis camion couvre un fourgon)
 *   camion     -> [camion]
 *   bus        -> [bus]
 *   tous_types -> [tous_types]
 * En PLUS, un document de catégorie `tous_types` (permis international)
 * satisfait TOUTE exigence (wildcard — géré dans `licenseSatisfies`).
 */
const SATISFIES_SETS: Readonly<
  Record<LicenseCategoryT31, readonly LicenseCategoryT31[]>
> = {
  moto: ["moto"],
  voiture: ["voiture"],
  fourgon: ["fourgon", "camion"],
  camion: ["camion"],
  bus: ["bus"],
  tous_types: ["tous_types"],
};

/**
 * Catégorie de permis requise pour une compétence, ou `undefined` si la
 * compétence n'exige aucun permis. Comparaison insensible à la casse et aux
 * espaces (mêmes règles SQL : `lower(coalesce(trim(...), ''))`).
 */
export function requiredLicenseCategory(
  skillName: string,
): LicenseCategoryT31 | undefined {
  const key = skillName.trim().toLowerCase() as DrivingSkillName;
  return SKILL_LICENSE_MAP[key];
}

/**
 * La catégorie `actual` satisfait-elle l'exigence `required` ?
 * `tous_types` (permis international / tous types) est un wildcard : elle
 * couvre n'importe quelle exigence. Modèles par ensembles « satisfait par » :
 * voir `SATISFIES_SETS`. Pas de transitivité (un permis bus ne couvre PAS
 * un camion).
 */
export function licenseSatisfies(
  required: LicenseCategoryT31,
  actual: LicenseCategoryT31 | null,
): boolean {
  if (actual === null) return false;
  if (actual === "tous_types") return true; // wildcard
  return (SATISFIES_SETS[required] ?? []).includes(actual);
}

/**
 * La ligne `documents[i]` (statut + catégorie) couvre-t-elle la catégorie
 * requise pour la compétence `skillName` ? Retourne `true` si
 * `skillName` n'exige aucun permis, sinon exige `status = "verified"` ET
 * `category` non nulle ET `licenseSatisfies(required, category)`.
 */
export function licenseDocCovers(
  skillName: string,
  status: string,
  category: LicenseCategoryT31 | null,
): boolean {
  const required = requiredLicenseCategory(skillName);
  if (required === undefined) return true;
  return status === "verified" && licenseSatisfies(required, category);
}
