import type { TranslationKeys } from "@/lib/i18n/fr";
import type { DocumentRequirementDetail } from "@/lib/matching/skill-document-requirements";
import { loginHref } from "@/lib/auth/safe-redirect";
import { supportMailto } from "@/lib/support";

/**
 * Message et action proposés après un refus de `POST /api/jobs/[id]/apply`
 * (lot 9). Le texte vient du dictionnaire de la langue de l'interface, à
 * partir du code métier renvoyé par la route (`code`), jamais du champ
 * `error`, conservé en anglais pour les autres appelants.
 */

type ApplicationDict = TranslationKeys["application"];

export type FeedbackAction = { label: string; href: string };

export type ApplyFeedback = {
  title: string;
  description: string;
  action?: FeedbackAction;
};

export type ApplyRefusal = {
  /** Statut HTTP, ou `null` si la requête n'a pas abouti (réseau). */
  status: number | null;
  code?: string | null;
  requirement?: DocumentRequirementDetail | null;
};

/** Message d'un justificatif manquant, en attente, refusé ou expiré. */
export function documentRequirementText(
  detail: DocumentRequirementDetail,
  d: ApplicationDict["documents"],
): string {
  if (detail.state === "pending") return d.pending;
  if (detail.state === "rejected") return d.rejected;
  if (detail.state === "expired") return d.expired;
  if (detail.skill_name)
    return d.missingSkill.replace("{skill}", detail.skill_name);
  if (detail.document_type === "cni") return d.missingCni;
  if (detail.document_type === "driving_license") return d.missingLicense;
  const label =
    d.labels[detail.document_type as keyof typeof d.labels] ?? d.labels.autre;
  return d.missingOther.replace("{doc}", label);
}

export function applyRefusalFeedback(
  refusal: ApplyRefusal,
  d: ApplicationDict,
  jobPath: string,
): ApplyFeedback {
  const title = d.errorTitle;
  const a = d.actions;
  const browse = { label: a.browseJobs, href: "/jobs" };

  if (refusal.status === null) {
    return { title, description: d.refusals.network };
  }

  switch (refusal.code) {
    case "not_authenticated":
      return {
        title,
        description: d.refusals.not_authenticated,
        action: { label: a.signIn, href: loginHref(jobPath) },
      };
    case "profile_not_found":
    case "onboarding_incomplete":
      return {
        title,
        description: d.refusals[refusal.code],
        action: { label: a.finishSignup, href: "/onboarding/candidate" },
      };
    case "account_suspended":
      return {
        title,
        description: d.refusals.account_suspended,
        action: { label: a.support, href: supportMailto("Compte suspendu") },
      };
    case "job_not_found":
    case "job_not_available":
    case "no_positions":
      return { title, description: d.refusals[refusal.code], action: browse };
    case "profile_incomplete":
    case "profile_not_verified":
      return {
        title,
        description: d.refusals[refusal.code],
        action: { label: a.completeProfile, href: "/profile/candidate/edit" },
      };
    case "already_applied":
      return {
        title,
        description: d.refusals.already_applied,
        action: { label: a.myApplications, href: "/my-jobs" },
      };
    case "document_requirement":
      if (refusal.requirement) {
        const identity = refusal.requirement.document_type === "cni";
        return {
          title,
          description: documentRequirementText(
            refusal.requirement,
            d.documents,
          ),
          action: identity
            ? { label: a.identity, href: "/profile/documents" }
            : { label: a.documents, href: "/profile/skill-documents" },
        };
      }
      return { title, description: d.refusals.generic };
    case "application_failed":
      return { title, description: d.refusals.application_failed };
    default:
      return { title, description: d.refusals.generic };
  }
}
