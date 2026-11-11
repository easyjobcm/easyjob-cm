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
 * Champ facultatif du représentant (lot 11) : absent, vide ou blanc = `null`.
 * Les pièces manquantes sont signalées par `company_dossier_missing` (base),
 * pas par le formulaire : l'entreprise peut enregistrer un dossier partiel.
 */
const representativeText = (tooLong: string) =>
  z
    .string()
    .trim()
    .max(100, tooLong)
    .nullish()
    .transform((value) => (value ? value : null));

export const REPRESENTATIVE_AUTHORITIES = [
  "listed_officer",
  "mandate",
] as const;
export type RepresentativeAuthority =
  (typeof REPRESENTATIVE_AUTHORITIES)[number];

/**
 * Onboarding entreprise : colonnes de `company_profiles` écrites par
 * `PUT /api/company/onboarding`. Le NIU (saisi à l'inscription, modifiable
 * par le support seulement), la vérification et l'abonnement n'en font pas
 * partie ; les pièces sont des fichiers envoyés à part.
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
  representative_name: representativeText("representativeNameTooLong"),
  representative_title: representativeText("representativeTitleTooLong"),
  representative_authority: z
    .union([z.enum(REPRESENTATIVE_AUTHORITIES), z.literal("")])
    .nullish()
    .transform((value) => (value ? value : null)),
});
export type CompanyOnboardingInput = z.input<typeof companyOnboardingSchema>;
export type CompanyOnboardingData = z.output<typeof companyOnboardingSchema>;

/**
 * Codes des RPC `submit_company_verification` et `admin_review_company`
 * (message de l'exception, migration 20261111120000), traduits dans
 * `companyVerification.errors`. Ne jamais renommer un code existant.
 */
export const COMPANY_VERIFICATION_REFUSALS = {
  not_authenticated: 401,
  not_a_company: 403,
  account_suspended: 403,
  company_not_found: 404,
  forbidden: 403,
  invalid_action: 400,
  reason_required: 400,
  reason_too_long: 400,
  company_not_pending: 409,
  dossier_not_submitted: 409,
  company_changed: 409,
  dossier_incomplete: 409,
  nothing_changed: 409,
  invalid_check: 400,
  source_required: 400,
  reference_required: 400,
  reference_too_long: 400,
  check_changed: 409,
  checks_incomplete: 409,
} as const;

export type CompanyVerificationRefusal =
  keyof typeof COMPANY_VERIFICATION_REFUSALS;

export function companyVerificationRefusal(
  message: string | undefined,
): { code: CompanyVerificationRefusal; status: number } | null {
  if (message && message in COMPANY_VERIFICATION_REFUSALS) {
    const code = message as CompanyVerificationRefusal;
    return { code, status: COMPANY_VERIFICATION_REFUSALS[code] };
  }
  return null;
}

/** Bornes du motif de correction, identiques à `admin_review_company`. */
export const COMPANY_REVIEW_REASON_MIN = 10;
export const COMPANY_REVIEW_REASON_MAX = 500;

/**
 * Décision admin sur un dossier entreprise. `seen_revision` est la révision
 * lue par l'admin : la base refuse une décision sur une version ancienne.
 */
export const companyReviewSchema = z
  .object({
    action: z.enum(["approve", "request_correction"], {
      error: "invalid_action",
    }),
    reason: z
      .string()
      .trim()
      .max(COMPANY_REVIEW_REASON_MAX, "reason_too_long")
      .optional(),
    seen_revision: z.number().int().positive(),
  })
  .refine(
    (d) =>
      d.action !== "request_correction" ||
      (d.reason?.length ?? 0) >= COMPANY_REVIEW_REASON_MIN,
    { path: ["reason"], message: "reason_required" },
  );
export type CompanyReviewInput = z.input<typeof companyReviewSchema>;

/** Contrôles manuels du dossier (lot 11) et sources officielles admises. */
export const COMPANY_CHECKS = ["rccm", "niu", "representative"] as const;
export type CompanyCheck = (typeof COMPANY_CHECKS)[number];

export const COMPANY_CHECK_SOURCES = {
  rccm: ["official_registry", "court_registry"],
  niu: ["dgi_online", "dgi_office"],
  representative: ["rccm_extract", "mandate"],
} as const satisfies Record<CompanyCheck, readonly string[]>;
export type CompanyCheckSource =
  (typeof COMPANY_CHECK_SOURCES)[CompanyCheck][number];

export const COMPANY_CHECK_DECISIONS = [
  "approved",
  "rejected",
  "unverifiable",
] as const;
export type CompanyCheckDecision = (typeof COMPANY_CHECK_DECISIONS)[number];

/**
 * Contrôle d'un élément, mêmes règles que `admin_record_company_check` :
 * approuvé = source officielle + référence ou note interne ; refusé = motif
 * communiqué à l'entreprise ; vérification impossible = note interne.
 */
export const companyCheckSchema = z
  .object({
    check: z.enum(COMPANY_CHECKS, { error: "invalid_check" }),
    decision: z.enum(COMPANY_CHECK_DECISIONS, { error: "invalid_action" }),
    source: z.string().trim().optional(),
    reference: z.string().trim().max(300, "reference_too_long").optional(),
    reason: z
      .string()
      .trim()
      .max(COMPANY_REVIEW_REASON_MAX, "reason_too_long")
      .optional(),
    seen_revision: z.number().int().positive(),
    seen_check: z.string().uuid().nullable(),
  })
  .superRefine((d, ctx) => {
    const sources: readonly string[] = COMPANY_CHECK_SOURCES[d.check];
    if (d.source && !sources.includes(d.source)) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "source_required",
      });
    }
    if (d.decision === "approved" && !d.source) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "source_required",
      });
    }
    if (d.decision !== "rejected" && (d.reference?.length ?? 0) < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "reference_required",
      });
    }
    if (
      d.decision === "rejected" &&
      (d.reason?.length ?? 0) < COMPANY_REVIEW_REASON_MIN
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "reason_required",
      });
    }
  });
export type CompanyCheckInput = z.input<typeof companyCheckSchema>;
