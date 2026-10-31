/**
 * Messages des refus documentaires de candidature (SRS §6.14, §5.4).
 *
 * La décision est prise en base par la RPC `apply_to_job` (migration
 * 20261031130000), seule source de vérité : elle lève `document_requirement`
 * avec en détail le premier document manquant. Ce module ne fait que
 * traduire ce détail en message pour le candidat.
 */

export type DocumentRequirementState =
  | "expired"
  | "pending"
  | "rejected"
  | "missing";

export interface DocumentRequirementDetail {
  document_type: string;
  state: DocumentRequirementState;
  /** Présent quand l'exigence porte sur une compétence précise. */
  skill_name?: string;
}

const SIMPLE_DOC_LABELS: Record<string, string> = {
  casier_judiciaire: "casier judiciaire",
  diplome: "diplôme",
  certificat: "certificat",
  attestation_formation: "attestation de formation",
  attestation_travail: "attestation de travail",
  autre: "document",
};

const STATE_MESSAGES: Record<
  Exclude<DocumentRequirementState, "missing">,
  string
> = {
  pending: "Votre justificatif est encore en cours de vérification.",
  rejected:
    "Votre justificatif a été refusé. Consultez votre profil pour le remplacer.",
  expired: "Votre justificatif a expiré. Mettez-le à jour pour postuler.",
};

function missingMessage(detail: DocumentRequirementDetail): string {
  if (detail.skill_name) {
    return `Cette offre exige un diplôme ou certificat valide pour la compétence « ${detail.skill_name} ».`;
  }
  if (detail.document_type === "cni") {
    return "Cette offre exige une CNI vérifiée pour postuler.";
  }
  if (detail.document_type === "driving_license") {
    return "Cette offre exige un permis de conduire valide pour postuler.";
  }
  const label = SIMPLE_DOC_LABELS[detail.document_type] ?? detail.document_type;
  return `Cette offre exige un ${label} valide pour postuler.`;
}

export function documentRequirementMessage(
  detail: DocumentRequirementDetail,
): string {
  return detail.state === "missing"
    ? missingMessage(detail)
    : STATE_MESSAGES[detail.state];
}

export function parseDocumentRequirementDetail(
  raw: string | null | undefined,
): DocumentRequirementDetail | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentRequirementDetail>;
    if (typeof parsed.document_type !== "string") return null;
    if (
      parsed.state !== "expired" &&
      parsed.state !== "pending" &&
      parsed.state !== "rejected" &&
      parsed.state !== "missing"
    ) {
      return null;
    }
    return {
      document_type: parsed.document_type,
      state: parsed.state,
      ...(typeof parsed.skill_name === "string"
        ? { skill_name: parsed.skill_name }
        : {}),
    };
  } catch {
    return null;
  }
}
