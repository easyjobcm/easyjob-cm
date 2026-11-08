import { describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import {
  formatRating,
  formatReputation,
  hasReviews,
} from "@/lib/utils/reputation";

/**
 * Lot 9b : la réputation affichée est la note des évaluations de missions et
 * leur nombre. Sans avis, aucune note n'est inventée.
 */
describe("formatReputation", () => {
  it("note et nombre d'avis, séparateur décimal de la langue", () => {
    expect(formatReputation(4.5, 2, "fr", fr.reputation)).toBe(
      "4,5/5 · 2 avis",
    );
    expect(formatReputation(4.5, 2, "en", en.reputation)).toBe(
      "4.5/5 · 2 reviews",
    );
  });

  it("un seul avis : singulier", () => {
    expect(formatReputation(5, 1, "fr", fr.reputation)).toBe("5/5 · 1 avis");
    expect(formatReputation(5, 1, "en", en.reputation)).toBe("5/5 · 1 review");
  });

  it("aucun avis : « Pas encore d'avis », même si une note traîne en base", () => {
    expect(formatReputation(0, 0, "fr", fr.reputation)).toBe(
      "Pas encore d'avis",
    );
    expect(formatReputation(null, null, "en", en.reputation)).toBe(
      "No reviews yet",
    );
    expect(formatReputation(3.5, 0, "fr", fr.reputation)).toBe(
      "Pas encore d'avis",
    );
  });

  it("note au dixième, sans zéro inutile", () => {
    expect(formatRating(4, "fr")).toBe("4");
    expect(formatRating(3.7, "fr")).toBe("3,7");
    expect(formatRating(3.7, "en")).toBe("3.7");
    expect(hasReviews(undefined)).toBe(false);
    expect(hasReviews(3)).toBe(true);
  });
});
