import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categorizeError,
  logServerError,
  logServerWarning,
  requestIdFrom,
} from "@/lib/observability/server-log";
import { internalErrorResponse } from "@/lib/api/errors";

// Valeurs sensibles qui ne doivent jamais apparaître (F-12, F-23).
const SECRETS = [
  "+237691234567",
  "654321", // OTP
  "482913", // code de fin de mission
  "eyJhbGciOiJIUzI1NiJ9.payload.sig", // jeton
  "sk-live-SECRETKEY",
  "https://x.supabase.co/storage/v1/object/sign/candidate-documents/a.jpg?token=abc",
  "contenu privé du chat",
];

function captured(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("logServerError", () => {
  it("n'écrit que les champs sûrs d'une erreur Postgres", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(
      "jobs.list",
      {
        code: "23505",
        message: `duplicate key value violates unique constraint, Key (phone)=(${SECRETS[0]})`,
        details: `Key (phone)=(${SECRETS[0]}) already exists; token ${SECRETS[3]}`,
        hint: SECRETS[4],
      },
      { requestId: "cdg1::abc-123" },
    );
    const out = captured(spy);
    for (const s of SECRETS) expect(out).not.toContain(s);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "error",
      op: "jobs.list",
      category: "database",
      code: "23505",
      requestId: "cdg1::abc-123",
    });
    expect(line.reason).toBeUndefined();
  });

  it("garde un code métier levé par une RPC", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("jobs.create", {
      code: "42501",
      message: "account_suspended",
    });
    expect(JSON.parse(spy.mock.calls[0][0] as string).reason).toBe(
      "account_suspended",
    );
  });

  it("n'écrit ni le message d'une erreur Auth ni celui d'une Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("auth.verify_phone", {
      __isAuthError: true,
      name: "AuthApiError",
      status: 403,
      code: "otp_expired",
      message: `Token ${SECRETS[1]} for ${SECRETS[0]} has expired`,
    });
    logServerError("chat.provider", new Error(`${SECRETS[4]} ${SECRETS[6]}`));
    const out = captured(spy);
    for (const s of SECRETS) expect(out).not.toContain(s);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      category: "auth",
      code: "otp_expired",
      status: 403,
    });
  });

  it("filtre un code d'erreur non conforme", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("x.y", { code: `${SECRETS[3]} and more` });
    expect(captured(spy)).not.toContain(SECRETS[3]);
  });

  it("logServerWarning refuse une raison qui n'est pas un code", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logServerWarning("auth.send_phone_otp", `quota ${SECRETS[0]}`);
    expect(captured(spy)).not.toContain(SECRETS[0]);
  });
});

describe("categorizeError / requestIdFrom", () => {
  it("catégorise sans lire le message", () => {
    expect(categorizeError({ code: "PGRST116" })).toBe("database");
    expect(categorizeError({ name: "AI_APICallError" })).toBe("provider");
    expect(categorizeError(new Error("x"))).toBe("unexpected");
  });

  it("n'accepte qu'un identifiant de requête bien formé", () => {
    expect(
      requestIdFrom(new Headers({ "x-vercel-id": "cdg1::iad1::x-1" })),
    ).toBe("cdg1::iad1::x-1");
    expect(
      requestIdFrom(
        new Headers({ "x-request-id": "<script>alert(1)</script>" }),
      ),
    ).toBeNull();
  });
});

describe("internalErrorResponse", () => {
  it("renvoie un message générique, un code métier et l'identifiant", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = internalErrorResponse(
      "jobs.list",
      { code: "42P01", message: `relation "secret_table" ${SECRETS[0]}` },
      {
        code: "jobs_failed",
        request: { headers: new Headers({ "x-vercel-id": "cdg1::req" }) },
      },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "Internal server error",
      code: "jobs_failed",
      requestId: "cdg1::req",
    });
    expect(JSON.stringify(body)).not.toContain("secret_table");
  });
});
