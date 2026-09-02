import { z } from "zod";
import { phoneSchema } from "@/lib/validations/auth";

/**
 * Bio candidat — le seuil de complétion (`profile-completion.ts`) exige
 * strictement plus de 10 caractères utiles ; on borne juste la taille max ici,
 * le calcul de complétion reste la seule source de vérité sur le "fait/pas fait".
 */
export const bioSchema = z.string().trim().max(500, "bioTooLong");

/** Étape identité de l'édition de profil (mêmes champs que l'onboarding). */
export const identitySchema = z.object({
  first_name: z.string().trim().min(1, "firstNameRequired").max(60),
  last_name: z.string().trim().min(1, "lastNameRequired").max(60),
  city: z.string().trim().min(1, "cityRequired"),
  quartier: z.string().trim().max(100).optional().or(z.literal("")),
  bio: bioSchema.optional().or(z.literal("")),
});
export type IdentityInput = z.infer<typeof identitySchema>;

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
