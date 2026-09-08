import { z } from "zod";

/** Types de justificatifs acceptés — doit rester synchronisé avec la contrainte
 * CHECK `candidate_documents_document_type_chk` (migration 20260903100000). */
export const SKILL_DOCUMENT_TYPES = [
  "cv",
  "diplome",
  "certificat",
  "attestation_formation",
  "attestation_travail",
  "permis_conduire",
  "casier_judiciaire",
  "autre",
] as const;
export type SkillDocumentType = (typeof SKILL_DOCUMENT_TYPES)[number];

export const skillDocumentTypeSchema = z.enum(SKILL_DOCUMENT_TYPES);

/** Métadonnées envoyées avec le fichier lors de l'upload d'un justificatif. */
export const skillDocumentUploadSchema = z
  .object({
    document_type: skillDocumentTypeSchema,
    title: z.string().trim().min(1, "titleRequired").max(150),
    issuing_organization: z
      .string()
      .trim()
      .max(150)
      .optional()
      .or(z.literal("")),
    issued_at: z.string().date().optional().or(z.literal("")),
    expires_at: z.string().date().optional().or(z.literal("")),
    skill_ids: z.array(z.string().uuid()).max(20),
    confirm_accurate: z.literal(true, { error: "confirmRequired" }),
  })
  .refine((v) => v.document_type === "cv" || v.skill_ids.length > 0, {
    message: "selectSkillRequired",
    path: ["skill_ids"],
  })
  .refine((v) => !v.issued_at || !v.expires_at || v.issued_at <= v.expires_at, {
    message: "expiryBeforeIssued",
    path: ["expires_at"],
  });

export type SkillDocumentUploadInput = z.infer<
  typeof skillDocumentUploadSchema
>;

export const skillDocumentModerateSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    rejection_reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== "reject" || !!v.rejection_reason, {
    message: "rejectionReasonRequired",
    path: ["rejection_reason"],
  });
