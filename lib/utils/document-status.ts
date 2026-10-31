/**
 * Statut EFFECTIF d'un justificatif candidat (T4) — calculé « au vol ».
 *
 * La base ne PAS d'écriture automatique de `candidate_documents.status =
 * 'expired'` (pas de cron — point ouvert mémorisé). Comme
 * `lib/matching/skill-document-requirements.ts`, on détecte l'expiration en
 * lecture : un document `verified` dont `expires_at` est dépassé compte comme
 * `expired`. C'est la même source de vérité que le matching, réutilisée pour
 * afficher le vrai état dans la page « Mes documents » (SRS §6.14, §6.14.3).
 *
 * Statuts bruts DB (`candidate_documents_status_chk`) :
 *   pending | verified | rejected | expired
 * Statut effectif renvoyé :
 *   pending | verified | rejected | expired
 *   (le cas « verified mais expiré » devient `expired` ; un `expired` brut
 *    reste `expired` quelle que soit la date — idempotent.)
 */

import type { SkillDocumentType } from "@/lib/validations/skill-documents";

/** Statut affiché d'un document, après détection de l'expiration au vol. */
export type EffectiveDocStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "expired";

export type { SkillDocumentType };

/**
 * Un document est-il expiré à la date courante ?
 * `expires_at` absente ou invalide → non expiré (les documents sans date
 * d'expiration — ex. diplôme — n'expirent pas).
 * Comparaison à la JOURNÉE (un doc arrivant à échéance aujourd'hui n'est pas
 * encore « dépassé » en début de journée) via la date midi 12h, cohérent
 * avec une lecture date-only (les DATE Postgres sont rendues en `YYYY-MM-DD`).
 */
export function isDocExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const d = new Date(`${expiresAt}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
  return d < today;
}

/**
 * Statut effectif d'un document à partir de son statut brut DB et de sa date
 * d'expiration. Règle unique : `verified` + `expires_at` dépassée → `expired`.
 * Tout reste inchangé sinon ; un statut inconnu est conservé tel quel mais
 * traité comme `pending` pour l'affichage (jamais de crash).
 */
export function effectiveDocStatus(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): EffectiveDocStatus {
  const raw = (status ?? "").toLowerCase();
  if (raw === "expired") return "expired";
  if (raw === "verified")
    return isDocExpired(expiresAt) ? "expired" : "verified";
  if (raw === "rejected") return "rejected";
  return "pending";
}
