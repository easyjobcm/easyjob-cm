import { describe, expect, it } from "vitest";
import {
  normalizeSignupLocale,
  normalizeSignupRole,
} from "@/lib/auth/signup-role";

describe("normalizeSignupRole", () => {
  it("accepte les deux choix publics d'inscription", () => {
    expect(normalizeSignupRole("candidate")).toBe("candidate");
    expect(normalizeSignupRole("company")).toBe("company");
  });

  it.each([
    "admin_founder",
    "admin_ops",
    "admin_support",
    "candidate_premium",
    "company_premium",
    "COMPANY",
    " company",
    "",
    undefined,
    null,
    42,
    { role: "company" },
  ])("ramène %j à candidate", (value) => {
    expect(normalizeSignupRole(value)).toBe("candidate");
  });
});

describe("normalizeSignupLocale", () => {
  it("n'accepte que fr ou en", () => {
    expect(normalizeSignupLocale("en")).toBe("en");
    expect(normalizeSignupLocale("fr")).toBe("fr");
    expect(normalizeSignupLocale("de")).toBe("fr");
    expect(normalizeSignupLocale(undefined)).toBe("fr");
  });
});
