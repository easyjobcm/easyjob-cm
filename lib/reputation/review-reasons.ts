/**
 * Motifs d'un avis selon la partie évaluée (lot 9c). Mêmes codes que la
 * fonction SQL `review_reasons_for` (migration 20261109120000) : la base
 * refuse tout autre code et exige au moins un motif pour une note < 3.
 * Libellés : dictionnaires `reputation.reasons.*` (FR/EN).
 */
export const CANDIDATE_REVIEW_REASONS = [
  "late",
  "left_early",
  "poor_quality",
  "instructions_ignored",
  "behavior",
  "presentation",
] as const;

export const COMPANY_REVIEW_REASONS = [
  "unclear_instructions",
  "conditions_mismatch",
  "disrespect",
  "unsafe",
  "code_withheld",
  "extra_tasks",
] as const;

export type ReviewReason =
  | (typeof CANDIDATE_REVIEW_REASONS)[number]
  | (typeof COMPANY_REVIEW_REASONS)[number];

export const ALL_REVIEW_REASONS: readonly ReviewReason[] = [
  ...CANDIDATE_REVIEW_REASONS,
  ...COMPANY_REVIEW_REASONS,
];

/** Motifs proposés pour évaluer cette partie. */
export function reasonsFor(
  reviewed: "candidate" | "company",
): readonly ReviewReason[] {
  return reviewed === "candidate"
    ? CANDIDATE_REVIEW_REASONS
    : COMPANY_REVIEW_REASONS;
}

/** Une note de 1 ou 2 exige un motif ; 3 l'accepte ; 4 et 5 n'en ont pas. */
export function reasonsAllowed(rating: number): boolean {
  return rating >= 1 && rating <= 3;
}

export function reasonsRequired(rating: number): boolean {
  return rating >= 1 && rating < 3;
}

export function isReviewReason(value: unknown): value is ReviewReason {
  return (
    typeof value === "string" &&
    (ALL_REVIEW_REASONS as readonly string[]).includes(value)
  );
}
