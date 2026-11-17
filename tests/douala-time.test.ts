import { describe, expect, it } from "vitest";
import { doualaLocalInput, doualaLocalToIso } from "@/lib/utils/douala-time";

describe("saisie date et heure en heure de Douala (lot 15)", () => {
  it("affiche un instant UTC en heure de Douala (UTC+1)", () => {
    expect(doualaLocalInput(Date.parse("2026-11-17T16:05:00Z"))).toBe(
      "2026-11-17T17:05",
    );
    // Après minuit à Douala, encore la veille en UTC.
    expect(doualaLocalInput(Date.parse("2026-11-17T23:30:00Z"))).toBe(
      "2026-11-18T00:30",
    );
  });

  it("convertit une saisie en instant, aller-retour exact", () => {
    const iso = doualaLocalToIso("2026-11-18T06:00");
    expect(iso).toBe("2026-11-18T06:00:00+01:00");
    expect(Date.parse(iso!)).toBe(Date.parse("2026-11-18T05:00:00Z"));
    expect(doualaLocalInput(Date.parse(iso!))).toBe("2026-11-18T06:00");
  });

  it("refuse une saisie mal formée", () => {
    expect(doualaLocalToIso("")).toBeNull();
    expect(doualaLocalToIso("2026-11-18 06:00")).toBeNull();
    expect(doualaLocalToIso("2026-13-40T25:99")).toBeNull();
  });
});
