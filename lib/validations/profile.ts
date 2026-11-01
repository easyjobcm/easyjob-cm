import { z } from "zod";
import { phoneSchema } from "@/lib/validations/auth";
import { CAMEROON_CITIES } from "@/lib/utils/candidate-constants";
import { isNearCityZone } from "@/lib/validations/geo-schema";

/**
 * Bio candidat — le seuil de complétion (`profile-completion.ts`) exige
 * strictement plus de 10 caractères utiles ; on borne juste la taille max ici,
 * le calcul de complétion reste la seule source de vérité sur le "fait/pas fait".
 */
export const bioSchema = z.string().trim().max(500, "bioTooLong");

/** Date de naissance : format ISO + âge minimal 18 ans (règle onboarding)
 *  et pas de date future ou antérieure à 1900. */
export const MIN_CANDIDATE_AGE_YEARS = 18;

export function maxBirthDate(today = new Date()): string {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - MIN_CANDIDATE_AGE_YEARS);
  return d.toISOString().split("T")[0];
}

export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDateInvalid")
  .refine((v) => v <= maxBirthDate(), { message: "ageInvalid" })
  .refine((v) => v >= "1900-01-01", { message: "birthDateInvalid" });

/** Coordonnées domicile (T5) : bornes géographiques + zone de service
 *  (T5.1) — une paire lat/lng complète DOIT être à l'intérieur de la
 *  zone de service (≤ 20 km du centre de référence le plus proche).
 *  Absentes / null = valide → fallback « même ville » du matching.
 *  (La règle de PAIRE — jamais une seule à null — est portée par
 *  `isCleanGeoCoords` + l'UI qui écrit les deux ensemble.) */
export const geoSchema = z
  .object({
    latitude: z
      .number()
      .min(-90, "geoOutOfRange")
      .max(90, "geoOutOfRange")
      .nullable()
      .optional(),
    longitude: z
      .number()
      .min(-180, "geoOutOfRange")
      .max(180, "geoOutOfRange")
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.latitude === null ||
      v.latitude === undefined ||
      v.longitude === null ||
      v.longitude === undefined ||
      isNearCityZone(v.latitude, v.longitude),
    { message: "geoOutOfZone" },
  );
export type GeoInput = z.infer<typeof geoSchema>;

/** Garde-bouche client pour les écritures qui ne passent pas par la route
 *  identity (l'onboarding écrit candidate_profiles directement) : une paire
 *  lat/lng « propre » est SOIT absente (undefined/null, fallback même-ville
 *  du matching) SOIT une paire de nombres bornés. Jamais un seul des deux
 *  absent/à null (une coord seule n'a pas de sens). */
export function isCleanGeoCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  const latAbsent = latitude === undefined || latitude === null;
  const lngAbsent = longitude === undefined || longitude === null;
  if (latAbsent && lngAbsent) return true; // aucun GPS (ou jamais fourni)
  if (!latAbsent && !lngAbsent) {
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  }
  return false; // mixte : un présent, l'autre absent → non propre
}

/** Étape identité de l'édition de profil (mêmes champs que l'onboarding)
 *  + city restreinte au catalogue produit (T5.1 — client ET serveur ;
 *  avant T5.1 seul le bouton picker UI limitait) + coordonnées validées
 *  (bornes + zone de service) — source de vérité client ET serveur. */
export const identitySchema = z
  .object({
    first_name: z.string().trim().min(1, "firstNameRequired").max(60),
    last_name: z.string().trim().min(1, "lastNameRequired").max(60),
    date_of_birth: birthDateSchema,
    city: z
      .string()
      .trim()
      .min(1, "cityRequired")
      .refine((v) => CAMEROON_CITIES.includes(v), {
        message: "cityNotServed",
      }),
    quartier: z.string().trim().max(100).optional().or(z.literal("")),
    bio: bioSchema.optional().or(z.literal("")),
  })
  .and(geoSchema);
export type IdentityInput = z.infer<typeof identitySchema>;

/**
 * Demande de mise à jour de profil initiée par l'admin (verrou SRS §5.1) :
 * déverrouille temporairement les champs vérifiés (`identity` et/ou
 * `cni_documents`) le temps qu'ils soient resoumis puis re-vérifiés.
 */
export const updateRequestSchema = z.object({
  candidate_id: z.string().uuid(),
  fields: z
    .array(z.enum(["identity", "cni_documents"]))
    .min(1, "fieldsRequired")
    .max(2),
  reason: z.string().trim().min(5, "reasonTooShort").max(500),
});
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;

/**
 * T8.5 — action admin sur une demande existante. Le verrou T2/SRS §5.1.1
 * ne distingue pas « approuver/refuser » : l'ADMIN initie et le CANDIDAT
 * exécute (fermeture `done` automatique par le serveur). Le seul verbe
 * d'annulation côté admin est donc `cancelled` (la transition
 * `pending → pending` n'a aucun sens ; `done` n'est pas re-prévisible
 * par l'admin — c'est le candidat qui la pose).
 */
export const updateRequestActionSchema = z.object({
  status: z.enum(["cancelled"]),
});
export type UpdateRequestActionInput = z.infer<
  typeof updateRequestActionSchema
>;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "timeInvalid");

/** Une plage horaire pour un jour de la semaine (0=dimanche .. 6=samedi). */
export const availabilityDaySchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: timeSchema,
    end_time: timeSchema,
  })
  .refine((v) => v.start_time < v.end_time, {
    message: "timeRangeInvalid",
    path: ["end_time"],
  });

export const availabilitySchema = z.object({
  days: z.array(availabilityDaySchema).max(7),
  max_travel_distance_km: z.number().int().min(1).max(200),
});
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

/**
 * Mobile Money — même format téléphone que l'auth (`phoneSchema`
 * réutilisé). `momo_account_name` est le nom porté par le compte déclaré
 * par le candidat : l'admin le confronte au nom de la CNI lors de la
 * validation (SRS §11.5 — les comptes au nom d'un tiers / comptes
 * familiaux sont refusés). Optionnel : un candidat peut saisir le numéro
 * d'abord et compléter le nom ensuite ; l'admin voit l'absence de nom.
 */
export const paymentSchema = z.object({
  momo_provider: z.enum(["mtn", "orange"], { error: "momoProviderInvalid" }),
  momo_number: phoneSchema,
  momo_account_name: z
    .string()
    .trim()
    .max(100, "momoAccountNameTooLong")
    .optional(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

/**
 * Validation admin MoMo (T6) : `approve` / `reject` sur un profil précis.
 * `reject` exige un motif (3..300 car) ; `approve` n'en porte pas.
 * Les pré-requis métier (rôle admin, profil existant, numéro configuré,
 * motif de refus requis) sont vérifiés côté RPC SECURITY DEFINER
 * `apply_momo_verification` — le Zod borne seulement la forme de la
 * requête, la règle métier vit en base.
 */
export const momoModerateSchema = z
  .object({
    profile_id: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    rejection_reason: z
      .string()
      .trim()
      .min(3, "momoRejectReasonTooShort")
      .max(300)
      .optional(),
  })
  .refine((v) => v.action === "approve" || !!v.rejection_reason, {
    message: "momoRejectReasonRequired",
    path: ["rejection_reason"],
  });
export type MomoModerateInput = z.infer<typeof momoModerateSchema>;

/**
 * Validation admin CNI (T8.3) : `approve` / `reject` sur un profil précis.
 * `reject` exige un motif (3..300 car) ; `approve` peut porter une
 * date d'expiration optionnelle (`expires_at`, ISO `YYYY-MM-DD`) —
 * le RPC `moderate_cni` la prend en défaut = date de naissance + 10 ans.
 * Les pré-requis métier (rôle admin, 3 photos soumises, identité
 * complète, motif requis) sont vérifiés côté RPC SECURITY DEFINER
 * `moderate_cni` — le Zod borne seulement la forme de la requête.
 */
export const cniModerateSchema = z
  .object({
    profile_id: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    rejection_reason: z
      .string()
      .trim()
      .min(3, "cniRejectReasonTooShort")
      .max(300)
      .optional(),
    expires_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "cniExpiresAtInvalid")
      .optional(),
  })
  .refine((v) => v.action === "approve" || !!v.rejection_reason, {
    message: "cniRejectReasonRequired",
    path: ["rejection_reason"],
  });
export type CniModerateInput = z.infer<typeof cniModerateSchema>;
