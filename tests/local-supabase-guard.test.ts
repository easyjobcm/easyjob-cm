import { describe, expect, it } from "vitest";
import {
  isLocalUrl,
  readLocalDbUrl,
  readLocalProofEnv,
} from "@/scripts/lib/local-supabase";

describe("readLocalDbUrl", () => {
  it("accepte une base Postgres locale", () => {
    const url = "postgresql://postgres:pw@127.0.0.1:54422/postgres";
    expect(readLocalDbUrl({ DB_URL: url })).toBe(`${url}?sslmode=disable`);
  });

  it.each([
    "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://postgres:pw@localhost.evil.com:5432/postgres",
    "postgresql://postgres.ref:pw@aws-0-eu.pooler.supabase.com:6543/postgres",
    "http://127.0.0.1:54422",
    "",
  ])("refuse %j sans divulguer le mot de passe", (url) => {
    let message = "";
    try {
      readLocalDbUrl({ DB_URL: url });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Refus|manquant/);
    expect(message).not.toContain("pw");
  });
});

describe("isLocalUrl", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://LOCALHOST:3000/",
    "https://localhost",
    "http://[::1]:54321",
  ])("accepte %s", (url) => {
    expect(isLocalUrl(url)).toBe(true);
  });

  it.each([
    "https://abcdefgh.supabase.co",
    "http://localhost.evil.com",
    "http://localhost.evil.com:54321",
    "http://evil-localhost.com",
    "http://evil.com/localhost",
    "http://evil.com/?h=127.0.0.1",
    "http://localhost@evil.com",
    "http://user:pass@localhost:54321",
    "http://127.0.0.1.nip.io",
    "http://127.0.0.2",
    "http://0.0.0.0:54321",
    "ftp://localhost",
    "localhost:54321",
    "",
    "pas une url",
  ])("refuse %j", (url) => {
    expect(isLocalUrl(url)).toBe(false);
  });
});

describe("readLocalProofEnv", () => {
  const base = {
    API_URL: "http://127.0.0.1:54321",
    ANON_KEY: "anon",
    SERVICE_ROLE_KEY: "service",
  };

  it("retourne la configuration locale", () => {
    expect(readLocalProofEnv(base)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      anonKey: "anon",
      serviceKey: "service",
      appUrl: "http://localhost:3000",
    });
  });

  it("ignore les variables de l'app (NEXT_PUBLIC_*, SUPABASE_*)", () => {
    expect(() =>
      readLocalProofEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      }),
    ).toThrow(/manquants/);
  });

  it("refuse une API distante sans divulguer les clés", () => {
    let message = "";
    try {
      readLocalProofEnv({
        ...base,
        API_URL: "https://localhost.evil.com",
        SERVICE_ROLE_KEY: "secret-value",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Refus/);
    expect(message).not.toContain("secret-value");
  });

  it("refuse une app Next distante", () => {
    expect(() =>
      readLocalProofEnv({ ...base, NEXT_APP_URL: "https://easyjob.cm" }),
    ).toThrow(/NEXT_APP_URL/);
  });
});
