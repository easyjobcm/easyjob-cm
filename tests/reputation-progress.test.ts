import { describe, expect, it } from "vitest";
import {
  celebrationFor,
  computeProgress,
  formatStars,
  myReputationSchema,
  toHalfStars,
  type MyReputation,
  type ReputationChange,
} from "@/lib/reputation/progress";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

function candidate(overrides: Partial<MyReputation> = {}): MyReputation {
  return {
    subject_type: "candidate",
    stars: 0,
    server_now: "2026-11-09T10:00:00Z",
    profile: { pct: 100, stars: 1 },
    experience: { units: 0, cap: 20, stars: 0, confirmed: 0, breaches: 0 },
    reviews: { units: 0, cap: 10, stars: 0 },
    skills: { count: 0, stars: 0 },
    next_expiry_at: null,
    pending_changes: [],
    ...overrides,
  };
}

describe("computeProgress", () => {
  it("8 missions : prochaine demi-étoile à 10, encore 2 missions", () => {
    const p = computeProgress(
      candidate({
        stars: 1.5,
        experience: {
          units: 8,
          cap: 20,
          stars: 0.5,
          confirmed: 8,
          breaches: 0,
        },
        skills: { count: 2, stars: 1 },
        reviews: { units: 10, cap: 10, stars: 1 },
      }),
    );
    expect(p.nextTier).toBe(2);
    expect(p.primary?.key).toBe("experience");
    expect(p.primary?.action).toEqual({ kind: "missions", count: 2 });
    expect(p.primary?.progress).toBeCloseTo(0.6);
  });

  it("action principale : la catégorie la plus avancée (8 missions plutôt qu'une compétence)", () => {
    const p = computeProgress(
      candidate({
        stars: 2,
        experience: {
          units: 8,
          cap: 20,
          stars: 0.5,
          confirmed: 8,
          breaches: 0,
        },
        reviews: { units: 5, cap: 10, stars: 0.5 },
        skills: { count: 0, stars: 0 },
      }),
    );
    expect(p.primary?.key).toBe("experience");
    expect(p.primary?.action).toEqual({ kind: "missions", count: 2 });
  });

  it("10 missions : la catégorie passe à 1 étoile et vise 15", () => {
    const p = computeProgress(
      candidate({
        experience: {
          units: 10,
          cap: 20,
          stars: 1,
          confirmed: 10,
          breaches: 0,
        },
      }),
    );
    const exp = p.categories.find((c) => c.key === "experience")!;
    expect(exp.action).toEqual({ kind: "missions", count: 5 });
    expect(exp.progress).toBe(0);
  });

  it("plafonds : catégorie au maximum sans action", () => {
    const p = computeProgress(
      candidate({
        stars: 5,
        experience: {
          units: 20,
          cap: 20,
          stars: 2,
          confirmed: 30,
          breaches: 0,
        },
        reviews: { units: 10, cap: 10, stars: 1 },
        skills: { count: 4, stars: 1 },
      }),
    );
    expect(p.nextTier).toBeNull();
    expect(p.primary).toBeNull();
    expect(p.categories.every((c) => c.action === null)).toBe(true);
  });

  it("entreprise : offres réalisées, avis sur 2 étoiles, pas de compétences", () => {
    const p = computeProgress(
      candidate({
        subject_type: "company",
        experience: { units: 3, cap: 20, stars: 0, confirmed: 3, breaches: 0 },
        reviews: { units: 12, cap: 20, stars: 1 },
        skills: null,
      }),
    );
    expect(p.categories.map((c) => c.key)).toEqual([
      "experience",
      "reviews",
      "profile",
    ]);
    expect(p.categories[0].action).toEqual({ kind: "offers", count: 2 });
    expect(p.categories[1].max).toBe(2);
    expect(p.categories[1].action).toEqual({ kind: "reviews", count: 3 });
  });

  it("profil : 50 % puis 100 %", () => {
    const low = computeProgress(candidate({ profile: { pct: 40, stars: 0 } }));
    expect(low.categories.find((c) => c.key === "profile")!.action).toEqual({
      kind: "profile",
      target: 50,
    });
    const mid = computeProgress(
      candidate({ profile: { pct: 85, stars: 0.5 } }),
    );
    expect(mid.categories.find((c) => c.key === "profile")!.action).toEqual({
      kind: "profile",
      target: 100,
    });
  });
});

describe("formats", () => {
  it("demi-étoiles FR/EN, accord", () => {
    expect(formatStars(1.5, "fr", fr.reputation.stars)).toBe("1,5 étoile");
    expect(formatStars(3, "fr", fr.reputation.stars)).toBe("3 étoiles");
    expect(formatStars(1, "en", en.reputation.stars)).toBe("1 star");
    expect(formatStars(3.5, "en", en.reputation.stars)).toBe("3.5 stars");
    expect(formatStars(0, "en", en.reputation.stars)).toBe("0 stars");
  });

  it("toHalfStars borne et arrondit vers le bas", () => {
    expect(toHalfStars(3.7)).toBe(3.5);
    expect(toHalfStars(-1)).toBe(0);
    expect(toHalfStars(9)).toBe(5);
    expect(toHalfStars(null)).toBe(0);
  });

  it("schéma : valeurs numériques en texte (numeric Postgres)", () => {
    const parsed = myReputationSchema.parse({
      ...candidate(),
      stars: "2.5",
      profile: { pct: 100, stars: "1.0" },
    });
    expect(parsed.stars).toBe(2.5);
    expect(parsed.profile.stars).toBe(1);
  });
});

describe("celebrationFor", () => {
  const change = (id: string, at: string, direction: "gain" | "loss") =>
    ({
      id,
      from: 1,
      to: direction === "gain" ? 1.5 : 0.5,
      direction,
      cause: "mission",
      details: {},
      created_at: at,
    }) satisfies ReputationChange;

  it("rien d'acquitté par cet onglet : aucune animation", () => {
    expect(celebrationFor([])).toBeNull();
  });

  it("plusieurs variations : la plus récente donne le sens", () => {
    const shown = celebrationFor([
      change(
        "00000000-0000-4000-8000-000000000001",
        "2026-11-09T10:00:00Z",
        "gain",
      ),
      change(
        "00000000-0000-4000-8000-000000000002",
        "2026-11-09T11:00:00Z",
        "loss",
      ),
    ]);
    expect(shown?.direction).toBe("loss");
  });
});
