import { z } from "zod";
import { phoneSchema } from "@/lib/validations/auth";

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

/** Étape identité de l'édition de profil (mêmes champs que l'onboarding). */
export const identitySchema = z.object({
  first_name: z.string().trim().min(1, "firstNameRequired").max(60),
  last_name: z.string().trim().min(1, "lastNameRequired").max(60),
  date_of_birth: birthDateSchema,
  city: z.string().trim().min(1, "cityRequired"),
  quartier: z.string().trim().max(100).optional().or(z.literal("")),
  bio: bioSchema.optional().or(z.literal("")),
});
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

/** Mobile Money — même format téléphone que l'auth (candidatSchema réutilisé). */
export const paymentSchema = z.object({
  momo_provider: z.enum(["mtn", "orange"], { error: "momoProviderInvalid" }),
  momo_number: phoneSchema,
});
export type PaymentInput = z.infer<typeof paymentSchema>;
