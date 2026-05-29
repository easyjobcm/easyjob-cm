import { z } from "zod";

/** Téléphone camerounais : 9 chiffres commençant par 6 (sans le +237). */
export const phoneSchema = z.string().regex(/^6\d{8}$/, "phoneInvalid");

/** NIU camerounais : 14 caractères alphanumériques (norme DGI). */
export const niuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{14}$/, "niuInvalid");

/** Mot de passe : min 8, au moins 1 chiffre + 1 lettre. */
export const passwordSchema = z
  .string()
  .min(8, "passwordTooShort")
  .regex(/[A-Za-z]/, "passwordNeedsLetter")
  .regex(/\d/, "passwordNeedsDigit");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("emailInvalid");

/** Étape 1 candidat : compte. */
export const candidateAccountSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: "termsRequired" }),
});
export type CandidateAccountInput = z.infer<typeof candidateAccountSchema>;

/** Étape 1 entreprise : société. */
export const companyInfoSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "companyNameTooShort")
    .max(100, "companyNameTooLong"),
  niu: niuSchema,
});
export type CompanyInfoInput = z.infer<typeof companyInfoSchema>;

/** Étape 2 entreprise : compte (réutilise candidate). */
export const companyAccountSchema = candidateAccountSchema;
export type CompanyAccountInput = CandidateAccountInput;

/** Étape téléphone (commune). */
export const phoneStepSchema = z.object({
  phone: phoneSchema,
});
export type PhoneStepInput = z.infer<typeof phoneStepSchema>;

/** Étape OTP (commune). */
export const otpStepSchema = z.object({
  phone: phoneSchema,
  token: z.string().regex(/^\d{6}$/, "otpInvalid"),
});
export type OtpStepInput = z.infer<typeof otpStepSchema>;

/** Vérification OTP email (post-signup). */
export const emailOtpSchema = z.object({
  email: emailSchema,
  token: z.string().regex(/^\d{6}$/, "otpInvalid"),
});
export type EmailOtpInput = z.infer<typeof emailOtpSchema>;

/** Renvoi du code OTP email. */
export const resendEmailSchema = z.object({
  email: emailSchema,
});
export type ResendEmailInput = z.infer<typeof resendEmailSchema>;
