import { describe, expect, it } from "vitest";
import {
  allowedPremiumOperations,
  candidatePremiumActionSchema,
  premiumRefusal,
} from "@/lib/validations/candidate-premium";

/**
 * Lot 17a — validation partagée de l'attribution de Premium. La RPC
 * revérifie tout en base (preuve `candidate-premium`, G3 et G7).
 */
const base = {
  request_id: "6f1d3c2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
  operation: "activate" as const,
  ends_at: "2027-01-31T23:00:00+01:00",
  expected_until: null,
  reason: "Attribution validée par le support.",
};

const firstCode = (v: unknown) => {
  const r = candidatePremiumActionSchema.safeParse(v);
  return r.success ? "ok" : r.error.issues[0]?.message;
};

describe("attribution de Premium : corps de la requête", () => {
  it("accepte une fin explicite lointaine : aucune durée commerciale imposée", () => {
    expect(firstCode({ ...base, ends_at: "2031-06-30T12:00:00Z" })).toBe("ok");
    expect(firstCode({ ...base, ends_at: "9999-12-31T23:59:59Z" })).toBe("ok");
  });

  it("refuse une fin absente pour activer ou prolonger, l'accepte pour arrêter", () => {
    expect(firstCode({ ...base, ends_at: null })).toBe("period_invalid");
    expect(firstCode({ ...base, operation: "extend", ends_at: null })).toBe(
      "period_invalid",
    );
    expect(firstCode({ ...base, operation: "stop", ends_at: null })).toBe("ok");
  });

  it("refuse une fin hors de la borne technique (année à cinq chiffres)", () => {
    expect(firstCode({ ...base, ends_at: "+010000-01-01T00:00:00Z" })).not.toBe(
      "ok",
    );
    expect(firstCode({ ...base, ends_at: "infinity" })).not.toBe("ok");
  });

  it("borne le motif et exige une clé d'envoi", () => {
    expect(firstCode({ ...base, reason: "court" })).toBe("reason_invalid");
    expect(firstCode({ ...base, reason: "x".repeat(501) })).toBe(
      "reason_invalid",
    );
    expect(firstCode({ ...base, request_id: "abc" })).toBe("request_invalid");
  });

  it("traduit les refus de la RPC et propose les opérations selon le plan", () => {
    expect(premiumRefusal("premium_state_changed")).toEqual({
      code: "premium_state_changed",
      status: 409,
    });
    expect(premiumRefusal("period_too_long")).toBeNull();
    expect(allowedPremiumOperations("free")).toEqual(["activate"]);
    expect(allowedPremiumOperations("premium")).toEqual(["extend", "stop"]);
  });
});
