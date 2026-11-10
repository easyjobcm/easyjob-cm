import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildContentSecurityPolicy,
  supabaseOrigins,
} from "@/lib/security/csp";
import { cspBlockedSource, cspPagePath } from "@/lib/observability/server-log";
import { POST } from "@/app/api/csp-report/route";

afterEach(() => vi.restoreAllMocks());

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );
}

describe("CSP Report-Only (F-25)", () => {
  it("autorise Supabase en HTTPS et en WebSocket, Nominatim et blob:", () => {
    const d = directives(
      buildContentSecurityPolicy({
        supabaseUrl: "https://abcd.supabase.co",
      }),
    );
    expect(d.get("connect-src")).toEqual([
      "'self'",
      "https://abcd.supabase.co",
      "wss://abcd.supabase.co",
      "https://nominatim.openstreetmap.org",
    ]);
    expect(d.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://abcd.supabase.co",
    ]);
    expect(d.get("frame-src")).toEqual(["https://abcd.supabase.co"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("report-uri")).toEqual(["/api/csp-report"]);
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("pile locale : origine HTTP et ws:, eval en développement seulement", () => {
    expect(supabaseOrigins("http://127.0.0.1:54421")).toEqual([
      "http://127.0.0.1:54421",
      "ws://127.0.0.1:54421",
    ]);
    const dev = directives(
      buildContentSecurityPolicy({
        supabaseUrl: "http://127.0.0.1:54321",
        dev: true,
      }),
    );
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
  });

  it("ignore une URL Supabase absente ou invalide", () => {
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins("javascript:alert(1)")).toEqual([]);
    const d = directives(buildContentSecurityPolicy({ supabaseUrl: "x" }));
    expect(d.get("connect-src")).toEqual([
      "'self'",
      "https://nominatim.openstreetmap.org",
    ]);
    expect(d.get("frame-src")).toEqual(["'none'"]);
  });
});

describe("/api/csp-report", () => {
  const signed =
    "https://abcd.supabase.co/storage/v1/object/sign/candidate-documents/u/cni.jpg?token=SECRET";

  it("réduit l'URL bloquée à son origine et masque les identifiants", () => {
    expect(cspBlockedSource(signed)).toBe("https://abcd.supabase.co");
    expect(cspBlockedSource("inline")).toBe("inline");
    expect(cspBlockedSource("data:image/png;base64,AAAA")).toBe("data");
    expect(cspBlockedSource("n'importe quoi")).toBeUndefined();
    expect(
      cspPagePath(
        "https://app.example/jobs/6f1c2a52-6e7b-4d6a-9d7e-2b8f0c1a9e33?tab=x#y",
      ),
    ).toBe("/jobs/:id");
  });

  it("journalise les deux formats sans URL complète ni extrait", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacy = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "http://localhost/profile/documents?x=1",
          "effective-directive": "img-src",
          "blocked-uri": signed,
          "script-sample": "alert('SECRET')",
          disposition: "report",
        },
      }),
    });
    expect((await POST(legacy)).status).toBe(204);

    const modern = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: JSON.stringify([
        {
          type: "csp-violation",
          body: {
            documentURL: "http://localhost/auth/login",
            effectiveDirective: "connect-src",
            blockedURL: "https://tiers.example/collect?id=SECRET",
            disposition: "report",
          },
        },
        { type: "deprecation", body: { message: "ignoré" } },
      ]),
    });
    expect((await POST(modern)).status).toBe(204);

    const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines).toEqual([
      {
        level: "warn",
        op: "security.csp_report",
        category: "validation",
        directive: "img-src",
        blocked: "https://abcd.supabase.co",
        page: "/profile/documents",
        disposition: "report",
      },
      {
        level: "warn",
        op: "security.csp_report",
        category: "validation",
        directive: "connect-src",
        blocked: "https://tiers.example",
        page: "/auth/login",
        disposition: "report",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("SECRET");
  });

  it("ignore un corps trop gros ou invalide, toujours 204", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      body: "x".repeat(17 * 1024),
    });
    const junk = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      body: "{pas du json",
    });
    expect((await POST(big)).status).toBe(204);
    expect((await POST(junk)).status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
  });
});
