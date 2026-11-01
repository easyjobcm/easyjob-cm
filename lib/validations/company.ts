import { z } from "zod";
import { Constants } from "@/lib/database.types";
import { CAMEROON_CITIES } from "@/lib/utils/candidate-constants";
import { companyInfoSchema } from "@/lib/validations/auth";

/** Secteurs proposés à l'onboarding (stockés dans `company_profiles.sector`). */
export const COMPANY_SECTORS = [
  "restaurant",
  "hotel",
  "commerce",
  "event",
  "logistics",
  "other",
] as const;

/** Champ facultatif : vide ou blanc = `null` (effacement voulu), jamais "". */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value));

/** Site web facultatif : seul un lien http(s) est accepté, jamais `javascript:`. */
const websiteSchema = optionalText(200, "websiteInvalid").refine(
  (value) => value === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value),
  "websiteInvalid",
);

/**
 * Onboarding entreprise : colonnes de `company_profiles` écrites par
 * `PUT /api/company/onboarding`. Le NIU (saisi à l'inscription), la
 * vérification et l'abonnement n'en font pas partie.
 */
export const companyOnboardingSchema = z.object({
  company_name: companyInfoSchema.shape.companyName,
  sector: z.enum(COMPANY_SECTORS, { error: "sectorRequired" }),
  company_size: z.enum(Constants.public.Enums.company_size, {
    error: "companySizeRequired",
  }),
  website: websiteSchema,
  description: optionalText(1000, "descriptionTooLong"),
  rccm: z.string().trim().min(1, "rccmRequired").max(50, "rccmTooLong"),
  // Mêmes valeurs que les candidats, pour que les villes se comparent.
  city: z
    .string({ error: "cityRequired" })
    .refine((value) => CAMEROON_CITIES.includes(value), "cityRequired"),
  quartier: z
    .string()
    .trim()
    .min(1, "quartierRequired")
    .max(100, "quartierTooLong"),
  address: z
    .string()
    .trim()
    .min(1, "addressRequired")
    .max(200, "addressTooLong"),
});
export type CompanyOnboardingInput = z.input<typeof companyOnboardingSchema>;
export type CompanyOnboardingData = z.output<typeof companyOnboardingSchema>;
