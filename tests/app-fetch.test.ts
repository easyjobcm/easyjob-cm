import { describe, expect, it } from "vitest";
import { isStaleSocketError } from "../scripts/lib/app-fetch";

const fetchFailed = (code?: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("isStaleSocketError", () => {
  it("reprend une connexion keep-alive morte (Windows et Linux)", () => {
    expect(isStaleSocketError(fetchFailed("ECONNRESET"))).toBe(true);
    expect(isStaleSocketError(fetchFailed("UND_ERR_SOCKET"))).toBe(true);
    expect(isStaleSocketError(fetchFailed("EPIPE"))).toBe(true);
  });
  it("ne reprend pas une application injoignable ni une erreur inconnue", () => {
    expect(isStaleSocketError(fetchFailed("ECONNREFUSED"))).toBe(false);
    expect(isStaleSocketError(fetchFailed())).toBe(false);
    expect(isStaleSocketError(new Error("x"))).toBe(false);
    expect(isStaleSocketError(null)).toBe(false);
  });
});
