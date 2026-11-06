import { describe, expect, it } from "vitest";
import { observedClientIp } from "@/lib/utils/observed-ip";

const headers = (entries: Record<string, string>) => new Headers(entries);
const VERCEL = { VERCEL: "1" };

describe("observedClientIp", () => {
  it("ignore tout en-tête hors Vercel (valeur forgeable)", () => {
    const h = headers({
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "x-vercel-forwarded-for": "203.0.113.9",
    });
    expect(observedClientIp(h, {})).toBeNull();
    expect(observedClientIp(h, { VERCEL: "0" })).toBeNull();
  });

  it("sur Vercel, préfère x-vercel-forwarded-for", () => {
    const h = headers({
      "x-vercel-forwarded-for": "198.51.100.4",
      "x-forwarded-for": "203.0.113.9",
    });
    expect(observedClientIp(h, VERCEL)).toBe("198.51.100.4");
  });

  it("sur Vercel, se rabat sur x-forwarded-for (réécrit par Vercel)", () => {
    expect(
      observedClientIp(headers({ "x-forwarded-for": "2001:db8::1" }), VERCEL),
    ).toBe("2001:db8::1");
  });

  it("n'utilise jamais x-real-ip seul", () => {
    expect(
      observedClientIp(headers({ "x-real-ip": "203.0.113.9" }), VERCEL),
    ).toBeNull();
  });

  it("rejette une valeur qui n'est pas une adresse", () => {
    expect(
      observedClientIp(
        headers({ "x-vercel-forwarded-for": "pas-une-ip, 1.2.3.4" }),
        VERCEL,
      ),
    ).toBeNull();
    expect(observedClientIp(headers({}), VERCEL)).toBeNull();
  });
});
