import { plural, type PluralForms } from "@/lib/i18n/plural";

/**
 * Réputation publique d'un profil (lot 9b) : les étoiles des évaluations de
 * missions sont le seul indicateur affiché. `average_rating` et
 * `review_count` sont écrits ensemble par le trigger `refresh_review_rating`
 * (évaluations `mission_flow` uniquement).
 *
 * Sans avis, aucune note n'est affichée : « Pas encore d'avis ». Aucun seuil
 * ni classement n'est dérivé de ces valeurs.
 */
export interface ReputationTexts {
  noReviews: string;
  summary: string;
  reviews: PluralForms;
}

export function hasReviews(reviewCount: number | null | undefined): boolean {
  return (reviewCount ?? 0) > 0;
}

/** Note au dixième, séparateur décimal de la langue : « 4,5 », « 4.5 », « 4 ». */
export function formatRating(
  averageRating: number | null | undefined,
  locale: "fr" | "en",
): string {
  return new Intl.NumberFormat(locale === "en" ? "en" : "fr", {
    maximumFractionDigits: 1,
  }).format(Number(averageRating ?? 0));
}

/** « 4,5/5 · 2 avis » / « 4.5/5 · 2 reviews » ou « Pas encore d'avis ». */
export function formatReputation(
  averageRating: number | null | undefined,
  reviewCount: number | null | undefined,
  locale: "fr" | "en",
  texts: ReputationTexts,
): string {
  if (!hasReviews(reviewCount)) return texts.noReviews;
  const count = reviewCount ?? 0;
  return texts.summary
    .replace("{rating}", formatRating(averageRating, locale))
    .replace("{reviews}", plural(count, texts.reviews, locale));
}
