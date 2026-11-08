import { describe, expect, it } from "vitest";
import {
  DEFAULT_AFTER_AUTH_PATH,
  safeInternalPath,
  signupRoleFromPath,
} from "@/lib/auth/safe-redirect";

// Valeurs telles que lues par `URLSearchParams.get("next")`, donc déjà
// décodées une fois.
describe("safeInternalPath (F-13)", () => {
  it.each([
    ["/auth/signup/company?step=phone", "/auth/signup/company?step=phone"],
    ["/jobs?city=Douala&q=a%20b", "/jobs?city=Douala&q=a%20b"],
    ["/jobs?q=a b", "/jobs?q=a%20b"],
    ["/profile/candidate", "/profile/candidate"],
    ["/", "/"],
  ])("accepte le chemin interne %s", (raw, expected) => {
    expect(safeInternalPath(raw)).toBe(expected);
  });

  it.each([
    ["URL absolue", "https://evil.example/phish"],
    ["schéma relatif", "//evil.example"],
    ["schéma relatif avec chemin", "//evil.example/auth/login"],
    ["barre oblique inverse", "/\\evil.example"],
    ["barre oblique inverse seule", "\\\\evil.example"],
    ["@hôte", "@evil.example"],
    ["point hôte", ".evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["tabulation", "/\t/evil.example"],
    ["retour ligne", "/\n/evil.example"],
    ["// encodé", "%2F%2Fevil.example"],
    ["/ puis / encodé", "/%2Fevil.example"],
    ["\\ encodé", "/%5Cevil.example"],
    ["double encodage", "/%252F%252Fevil.example"],
    ["double encodage \\", "/%255Cevil.example"],
    ["chemin d'API", "/api/chat"],
    ["boucle sur le callback", "/auth/callback?next=/"],
    ["encodage invalide", "/%E0%A4%A"],
    ["trop long", `/${"a".repeat(3000)}`],
    ["vide", ""],
  ])("refuse %s", (_label, raw) => {
    expect(safeInternalPath(raw)).toBe(DEFAULT_AFTER_AUTH_PATH);
  });

  it("refuse null et utilise le repli fourni", () => {
    expect(safeInternalPath(null)).toBe("/");
    expect(safeInternalPath("//x", "/auth/login")).toBe("/auth/login");
  });
});

describe("signupRoleFromPath", () => {
  it("lit le rôle sur le chemin exact, pas sur une sous-chaîne", () => {
    expect(signupRoleFromPath("/auth/signup/company?step=phone")).toBe(
      "company",
    );
    expect(signupRoleFromPath("/auth/signup/candidate")).toBe("candidate");
    expect(signupRoleFromPath("/jobs?x=/auth/signup/company")).toBeNull();
    expect(signupRoleFromPath("/auth/signup/companyX")).toBeNull();
  });
});
