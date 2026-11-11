import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { CompanyCheck } from "@/lib/validations/company";

type VerificationStatus = Database["public"]["Enums"]["verification_status"];
type CompanyRow = Database["public"]["Tables"]["company_profiles"]["Row"];

/**
 * État du dossier entreprise vu par l'interface (lot 11), dérivé des
 * colonnes écrites en base (migration 20261111120000) :
 *   - `incomplete`  : en attente, jamais soumis (pièces manquantes) ;
 *   - `in_review`   : en attente, soumis : dans la file admin ;
 *   - `correction`  : correction demandée (motif visible par l'entreprise) ;
 *   - `verified`    : dossier vérifié par EasyJob, publication possible.
 */
export type CompanyReviewState =
  | "incomplete"
  | "in_review"
  | "correction"
  | "verified";

export function companyReviewState(row: {
  verification_status: VerificationStatus | null;
  verification_submitted_at: string | null;
}): CompanyReviewState {
  if (row.verification_status === "verified") return "verified";
  if (row.verification_status === "rejected") return "correction";
  return row.verification_submitted_at ? "in_review" : "incomplete";
}

/** Codes de `company_dossier_missing` (SQL), dans le même ordre. */
export const DOSSIER_PIECES = [
  "rccm_number",
  "rccm_document",
  "niu_number",
  "niu_document",
  "representative_name",
  "representative_title",
  "representative_authority",
  "representative_id_document",
  "mandate_document",
] as const;
export type DossierPiece = (typeof DOSSIER_PIECES)[number];

/** Pièce → contrôle concerné (affichage par section). */
export const PIECE_CHECK: Record<DossierPiece, CompanyCheck> = {
  rccm_number: "rccm",
  rccm_document: "rccm",
  niu_number: "niu",
  niu_document: "niu",
  representative_name: "representative",
  representative_title: "representative",
  representative_authority: "representative",
  representative_id_document: "representative",
  mandate_document: "representative",
};

const blank = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Miroir de `company_dossier_missing` pour les écrans admin (la base reste
 * juge : soumission et décisions la recalculent). Test : mêmes codes.
 */
export function companyDossierMissing(
  p: Pick<
    CompanyRow,
    | "rccm"
    | "documents_url"
    | "niu"
    | "niu_document_path"
    | "representative_name"
    | "representative_title"
    | "representative_authority"
    | "representative_id_document_path"
    | "representative_mandate_path"
  >,
): DossierPiece[] {
  const missing: DossierPiece[] = [];
  if (blank(p.rccm)) missing.push("rccm_number");
  if ((p.documents_url ?? []).length === 0) missing.push("rccm_document");
  if (blank(p.niu)) missing.push("niu_number");
  if (blank(p.niu_document_path)) missing.push("niu_document");
  if (blank(p.representative_name)) missing.push("representative_name");
  if (blank(p.representative_title)) missing.push("representative_title");
  if (!p.representative_authority) missing.push("representative_authority");
  if (blank(p.representative_id_document_path))
    missing.push("representative_id_document");
  if (
    p.representative_authority === "mandate" &&
    blank(p.representative_mandate_path)
  )
    missing.push("mandate_document");
  return missing;
}

/** État d'un contrôle pour l'entreprise (`my_company_verification`). */
export type CompanyCheckState = {
  status: "approved" | "rejected" | "pending";
  reason: string | null;
};

export type MyCompanyVerification = {
  status: VerificationStatus | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  missing: DossierPiece[];
  checks: Record<CompanyCheck, CompanyCheckState>;
};

const checkStateSchema = z.object({
  status: z.enum(["approved", "rejected", "pending"]),
  reason: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

/** Lecture de `my_company_verification()` (null si invalide ou absent). */
export function parseMyCompanyVerification(
  raw: unknown,
): MyCompanyVerification | null {
  const parsed = z
    .object({
      status: z.enum(["pending", "verified", "rejected"]).nullable(),
      submitted_at: z.string().nullable(),
      reviewed_at: z.string().nullable(),
      rejection_reason: z.string().nullable(),
      missing: z.array(z.enum(DOSSIER_PIECES)),
      checks: z.object({
        rccm: checkStateSchema,
        niu: checkStateSchema,
        representative: checkStateSchema,
      }),
    })
    .safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Pièces consultables par l'admin (URL signée), jamais par chemin brut. */
export const DOSSIER_DOCUMENTS = [
  "rccm",
  "niu",
  "representative_id",
  "mandate",
] as const;
export type DossierDocument = (typeof DOSSIER_DOCUMENTS)[number];

/**
 * Chemin stocké d'une pièce, seulement s'il est dans le dossier de
 * l'entreprise (`<user_id>/…`). Serveur uniquement : le chemin ne quitte
 * jamais la route.
 */
export function dossierDocumentPath(
  row: Pick<
    CompanyRow,
    | "user_id"
    | "documents_url"
    | "niu_document_path"
    | "representative_id_document_path"
    | "representative_mandate_path"
  >,
  doc: DossierDocument,
): string | null {
  const candidates =
    doc === "rccm"
      ? (row.documents_url ?? [])
      : [
          doc === "niu"
            ? row.niu_document_path
            : doc === "representative_id"
              ? row.representative_id_document_path
              : row.representative_mandate_path,
        ];
  return (
    candidates.find(
      (p): p is string =>
        typeof p === "string" && p.startsWith(`${row.user_id}/`),
    ) ?? null
  );
}

export function documentKind(path: string | null): "pdf" | "image" | null {
  if (!path) return null;
  return path.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
}
