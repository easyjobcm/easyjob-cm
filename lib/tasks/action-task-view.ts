import type { TranslationKeys } from "@/lib/i18n/fr";
import { documentRequirementText } from "@/lib/jobs/application-feedback";
import { formatCniDate } from "@/lib/utils/cni-validity";
import type { ActionTask } from "./candidate-tasks";

/**
 * Texte et action d'une tâche « pour pouvoir postuler » (lot 9d). Pure :
 * le dictionnaire de la langue de l'interface est passé en argument.
 */
export interface ActionTaskView {
  title: string;
  hint: string;
  /** Motif d'un refus (admin), affiché tel quel. */
  reason?: string;
  label: string;
  href: string;
}

const CNI_EDIT = "/profile/candidate/edit?focus=cni";

export function actionTaskView(
  task: ActionTask,
  t: TranslationKeys,
  locale: string,
): ActionTaskView {
  const tt = t.tasks;
  switch (task.kind) {
    case "profile":
      return task.state === "onboarding"
        ? {
            title: tt.profile.onboardingTitle,
            hint: tt.profile.onboardingHint,
            label: tt.profile.onboardingAction,
            href: "/onboarding/candidate",
          }
        : {
            title: tt.profile.incompleteTitle,
            hint: tt.profile.incompleteHint.replace(
              "{pct}",
              String(task.pct ?? 0),
            ),
            label: tt.profile.action,
            href: "/profile/candidate/edit",
          };
    case "identity":
      return {
        title: tt.identity.title,
        hint: tt.identity.hint,
        label: tt.identity.action,
        href: "/profile/candidate/edit?focus=identity",
      };
    case "phone":
      return {
        title: tt.phone.title,
        hint: tt.phone.hint,
        label: tt.phone.action,
        href: "/auth/verify-phone",
      };
    case "momo": {
      const m = tt.momo;
      if (task.state === "pending") {
        return {
          title: m.pendingTitle,
          hint: m.pendingHint,
          label: m.track,
          href: "/profile/payment",
        };
      }
      return {
        title: task.state === "rejected" ? m.rejectedTitle : m.missingTitle,
        hint: task.state === "rejected" ? m.rejectedHint : m.missingHint,
        reason: task.reason ?? undefined,
        label: m.action,
        href: "/profile/payment",
      };
    }
    case "cni": {
      const c = tt.cni;
      const reason = task.reason ?? undefined;
      const complement = task.complement_requested ? c.complementHint : null;
      switch (task.state) {
        case "expired":
          return {
            title: c.expiredTitle,
            hint: c.expiredHint.replace(
              "{date}",
              task.expires_at ? formatCniDate(task.expires_at, locale) : "—",
            ),
            label: c.renew,
            href: CNI_EDIT,
          };
        case "renewal_pending":
          return {
            title: c.renewalPendingTitle,
            hint: complement ?? c.renewalPendingHint,
            label: c.track,
            href: CNI_EDIT,
          };
        case "renewal_rejected":
          return {
            title: c.renewalRejectedTitle,
            hint: c.renewalRejectedHint,
            reason,
            label: c.renew,
            href: CNI_EDIT,
          };
        case "pending":
          return {
            title: c.pendingTitle,
            hint: complement ?? c.pendingHint,
            label: c.track,
            href: CNI_EDIT,
          };
        case "rejected":
          return {
            title: c.rejectedTitle,
            hint: c.rejectedHint,
            reason,
            label: c.send,
            href: CNI_EDIT,
          };
        default:
          return {
            title: c.missingTitle,
            hint: c.missingHint,
            label: c.send,
            href: CNI_EDIT,
          };
      }
    }
    case "document": {
      const d = tt.document;
      const hint = documentRequirementText(
        {
          document_type: task.document_type,
          state: task.state,
          ...(task.skill_name ? { skill_name: task.skill_name } : {}),
        },
        t.application.documents,
      );
      const titles = {
        missing: d.missingTitle,
        pending: d.pendingTitle,
        rejected: d.rejectedTitle,
        expired: d.expiredTitle,
      } as const;
      return task.state === "pending"
        ? {
            title: titles.pending,
            hint,
            label: d.track,
            href: "/profile/documents",
          }
        : {
            title: titles[task.state],
            hint,
            label: d.action,
            href: "/profile/skill-documents",
          };
    }
  }
}
