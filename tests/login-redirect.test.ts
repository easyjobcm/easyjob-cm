import { describe, expect, it } from "vitest";
import {
  loginHref,
  loginReturnParam,
  postLoginPath,
} from "@/lib/auth/safe-redirect";

// Lot 9 : la connexion revient à la page protégée d'origine, avec la
// validation du lot 8 (safeInternalPath).
describe("postLoginPath", () => {
  it.each([
    ["/my-jobs", "/my-jobs"],
    ["/company/dashboard", "/company/dashboard"],
    ["/jobs/123?tab=details", "/jobs/123?tab=details"],
    ["/admin/candidates", "/admin/candidates"],
  ])("retourne la destination interne %s", (raw, expected) => {
    expect(postLoginPath(raw)).toBe(expected);
  });

  it.each([
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["%2F%2Fevil.example"],
    ["/auth/login"],
    ["/auth/verify-phone"],
    ["/AUTH/login"],
    ["/"],
    [""],
    [null],
  ])("ignore %s (destination par défaut du rôle)", (raw) => {
    expect(postLoginPath(raw)).toBeNull();
  });

  it("lit `next`, puis l'ancien `redirect`", () => {
    expect(loginReturnParam(new URLSearchParams("next=/a&redirect=/b"))).toBe(
      "/a",
    );
    expect(loginReturnParam(new URLSearchParams("redirect=/b"))).toBe("/b");
    expect(loginReturnParam(new URLSearchParams(""))).toBeNull();
  });
});

describe("loginHref", () => {
  it("encode la destination dans `next`", () => {
    expect(loginHref("/jobs/42")).toBe("/auth/login?next=%2Fjobs%2F42");
    expect(
      postLoginPath(
        new URLSearchParams(loginHref("/a?b=1").split("?")[1]).get("next"),
      ),
    ).toBe("/a?b=1");
  });

  it("n'accepte pas de destination externe", () => {
    expect(loginHref("//evil.example")).toBe("/auth/login");
  });
});
