import { describe, expect, it } from "vitest";
import {
  completionCodeSchema,
  missionRefusal,
  missionReviewSchema,
} from "@/lib/validations/mission";

describe("completionCodeSchema", () => {
  it("accepte six chiffres, zéros initiaux compris", () => {
    expect(completionCodeSchema.parse({ code: "000123" }).code).toBe("000123");
    expect(completionCodeSchema.parse({ code: " 987654 " }).code).toBe(
      "987654",
    );
  });

  it("refuse tout autre format", () => {
    for (const code of ["12345", "1234567", "12a456", "", "١٢٣٤٥٦"]) {
      const r = completionCodeSchema.safeParse({ code });
      expect(r.success).toBe(false);
      expect(r.success ? null : r.error.issues[0]?.message).toBe("code_format");
    }
    expect(completionCodeSchema.safeParse({ code: 123456 }).success).toBe(
      false,
    );
    expect(completionCodeSchema.safeParse({}).success).toBe(false);
  });
});

describe("missionReviewSchema", () => {
  it("accepte une note entière de 1 à 5 et un commentaire facultatif", () => {
    expect(missionReviewSchema.safeParse({ rating: 1 }).success).toBe(true);
    expect(
      missionReviewSchema.safeParse({ rating: 5, comment: "Très bien" })
        .success,
    ).toBe(true);
    expect(
      missionReviewSchema.safeParse({ rating: 3, comment: null }).success,
    ).toBe(true);
  });

  it("refuse une note hors bornes ou non entière, et un commentaire trop long", () => {
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      const r = missionReviewSchema.safeParse({ rating });
      expect(r.success ? null : r.error.issues[0]?.message).toBe(
        "rating_invalid",
      );
    }
    const long = missionReviewSchema.safeParse({
      rating: 4,
      comment: "x".repeat(1001),
    });
    expect(long.success ? null : long.error.issues[0]?.message).toBe(
      "comment_too_long",
    );
  });
});

describe("missionRefusal", () => {
  it("associe les refus de la base à un statut HTTP", () => {
    expect(missionRefusal("too_early")).toEqual({
      code: "too_early",
      status: 409,
    });
    expect(missionRefusal("not_started")?.status).toBe(409);
    expect(missionRefusal("code_unavailable")?.status).toBe(409);
    expect(missionRefusal("mission_not_found")?.status).toBe(404);
    expect(missionRefusal("rating_invalid")?.status).toBe(400);
    expect(missionRefusal("autre chose")).toBeNull();
    expect(missionRefusal(undefined)).toBeNull();
  });
});
