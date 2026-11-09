import { describe, expect, it } from "vitest";
import {
  cniDateExpired,
  cniExpiredDetailSchema,
  cniState,
  formatCniDate,
  isCniExpiredState,
} from "@/lib/utils/cni-validity";

/**
 * Lot 9d : miroir de candidate_cni_state (migration 20261110120000).
 * Convention : expirée dès 00:00 UTC du jour d'échéance (strictement après).
 */

const photos = {
  cni_front_url: "u/front.jpg",
  cni_back_url: "u/back.jpg",
  cni_selfie_url: "u/selfie.jpg",
};
const at = Date.parse("2026-11-10T00:00:00Z");

describe("cniDateExpired", () => {
  it("limite exacte : valide juste avant et à 00:00:00.000 UTC, expirée 1 ms après", () => {
    expect(cniDateExpired("2026-11-10", at - 1)).toBe(false);
    expect(cniDateExpired("2026-11-10", at)).toBe(false);
    expect(cniDateExpired("2026-11-10", at + 1)).toBe(true);
    expect(cniDateExpired("2026-11-11", at + 1)).toBe(false);
  });

  it("sans date : jamais expirée ; date illisible ignorée", () => {
    expect(cniDateExpired(null, at)).toBe(false);
    expect(cniDateExpired("pas-une-date", at)).toBe(false);
  });

  it("accepte un horodatage complet (seul le jour compte)", () => {
    expect(cniDateExpired("2026-11-10T15:00:00+01:00", at + 1)).toBe(true);
  });
});

describe("cniState", () => {
  it.each([
    [{ cni_verified: "verified", cni_expires_at: "2030-01-01" }, "valid"],
    [{ cni_verified: "verified", cni_expires_at: null }, "valid"],
    [{ cni_verified: "verified", cni_expires_at: "2026-11-09" }, "expired"],
    [
      { cni_verified: "pending", cni_expires_at: "2026-11-09", ...photos },
      "renewal_pending",
    ],
    [
      { cni_verified: "rejected", cni_expires_at: "2026-11-09", ...photos },
      "renewal_rejected",
    ],
    [{ cni_verified: "pending", cni_expires_at: null, ...photos }, "pending"],
    [{ cni_verified: "rejected", cni_expires_at: null }, "rejected"],
    [{ cni_verified: "pending", cni_expires_at: null }, "missing"],
  ] as const)("%o → %s", (profile, expected) => {
    expect(cniState(profile, at + 1)).toBe(expected);
  });

  it("seuls les états d'échéance sont des refus cni_expired", () => {
    expect(isCniExpiredState("expired")).toBe(true);
    expect(isCniExpiredState("renewal_pending")).toBe(true);
    expect(isCniExpiredState("renewal_rejected")).toBe(true);
    expect(isCniExpiredState("pending")).toBe(false);
    expect(isCniExpiredState("valid")).toBe(false);
  });
});

describe("cniExpiredDetailSchema", () => {
  it("accepte les trois états, refuse le reste", () => {
    expect(cniExpiredDetailSchema.safeParse({ state: "expired" }).success).toBe(
      true,
    );
    expect(cniExpiredDetailSchema.safeParse({ state: "valid" }).success).toBe(
      false,
    );
    expect(cniExpiredDetailSchema.safeParse(null).success).toBe(false);
  });
});

describe("formatCniDate", () => {
  it("jour civil sans décalage de fuseau", () => {
    expect(formatCniDate("2026-11-10", "fr")).toBe("10 nov. 2026");
    expect(formatCniDate("2026-11-10", "en")).toBe("Nov 10, 2026");
  });
});
