import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const finalizeSignup = vi.fn(async () => ({
  ok: true as const,
  data: { role: "candidate" as const },
}));
vi.mock("@/lib/auth/finalize-signup", () => ({ finalizeSignup }));

const { findPhoneProof, otpErrorCode, toE164, verifyPhoneCode } = await import(
  "@/lib/auth/phone-verification"
);

/**
 * Décision de vérification du téléphone (H-04) avec des clients simulés.
 * Le parcours réel (Supabase Auth, base relue après refus) est couvert par
 * `pnpm test:rls phone-verification`.
 */

const USER = { id: "user-a", email: "a@example.test", user_metadata: {} };
const E164 = "+237691234567";

type State = {
  account: { phone: string | null; phone_verified: boolean | null } | null;
  authPhone: string | null; // format GoTrue : sans « + »
  confirmedAt: string | null;
  lastSendAt: string | null;
};

function fakeAdmin(state: State) {
  const query = (table: string) => {
    const result = () =>
      table === "users"
        ? { data: state.account }
        : { data: state.lastSendAt ? { sent_at: state.lastSendAt } : null };
    const b = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => result(),
    };
    return b;
  };
  return {
    from: query,
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: USER.id,
              phone: state.authPhone,
              phone_confirmed_at: state.confirmedAt,
            },
          },
          error: null,
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
  };
}

function verifier(result: {
  userId?: string;
  error?: { code: string; status: number };
}) {
  return {
    auth: {
      verifyOtp: vi.fn(async () =>
        result.error
          ? { data: { user: null, session: null }, error: result.error }
          : {
              data: {
                user: { id: result.userId },
                session: { access_token: "tok" },
              },
              error: null,
            },
      ),
    },
  };
}

const WRONG = { error: { code: "otp_expired", status: 403 } };
type ReadSettings = () => Promise<{ phoneAutoconfirm: boolean } | null>;
const confirmed =
  (phoneAutoconfirm: boolean): ReadSettings =>
  async () => ({ phoneAutoconfirm });

async function run(
  state: State,
  verify: Parameters<typeof verifier>[0],
  settings: ReadSettings = confirmed(false),
) {
  const admin = fakeAdmin(state);
  const v = verifier(verify);
  const res = await verifyPhoneCode(
    // Clients simulés : seules les méthodes appelées sont fournies.
    { admin: admin as never, verifier: v as never, readSettings: settings },
    USER,
    E164,
    "000000",
  );
  return { res, admin };
}

const unverified: State = {
  account: { phone: null, phone_verified: false },
  authPhone: null,
  confirmedAt: null,
  lastSendAt: "2026-11-08T10:00:00Z",
};

beforeEach(() => {
  finalizeSignup.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("verifyPhoneCode (H-04)", () => {
  it("reproduction : code refusé alors que le numéro relu correspond déjà → refus", async () => {
    // Lecture identique au numéro demandé (condition de l'ancien repli,
    // qui finalisait l'inscription dans ce cas). Autoconfirm : updateUser a
    // posé le numéro « confirmé » sans code.
    const { res } = await run(
      { ...unverified, authPhone: E164, confirmedAt: "2026-11-08T09:59:59Z" },
      WRONG,
      confirmed(true),
    );
    expect(res).toEqual({ ok: false, errorCode: "otpWrong" });
    expect(finalizeSignup).not.toHaveBeenCalled();
  });

  it("même confirmation postérieure à l'envoi : refus tant que l'autoconfirm est actif", async () => {
    const { res } = await run(
      {
        ...unverified,
        authPhone: "237691234567",
        confirmedAt: "2026-11-08T10:05:00Z",
      },
      WRONG,
      confirmed(true),
    );
    expect(res.ok).toBe(false);
    expect(finalizeSignup).not.toHaveBeenCalled();
  });

  it("réglages illisibles : refus", async () => {
    const { res } = await run(
      {
        ...unverified,
        authPhone: "237691234567",
        confirmedAt: "2026-11-08T10:05:00Z",
      },
      WRONG,
      async () => null,
    );
    expect(res.ok).toBe(false);
  });

  it("confirmation antérieure au dernier envoi : refus", async () => {
    const { res } = await run(
      {
        ...unverified,
        authPhone: "237691234567",
        confirmedAt: "2026-11-08T09:00:00Z",
      },
      WRONG,
    );
    expect(res.ok).toBe(false);
    expect(finalizeSignup).not.toHaveBeenCalled();
  });

  it("aucun envoi enregistré : refus", async () => {
    const { res } = await run(
      {
        ...unverified,
        lastSendAt: null,
        authPhone: "237691234567",
        confirmedAt: "2026-11-08T10:05:00Z",
      },
      WRONG,
    );
    expect(res.ok).toBe(false);
  });

  it("code valide d'un AUTRE compte : refus, session émise révoquée", async () => {
    const { res, admin } = await run(unverified, { userId: "user-b" });
    expect(res).toEqual({ ok: false, errorCode: "otpWrong" });
    expect(finalizeSignup).not.toHaveBeenCalled();
    expect(admin.auth.admin.signOut).toHaveBeenCalledWith("tok", "local");
  });

  it("code valide pour ce compte : finalisation", async () => {
    const { res } = await run(unverified, { userId: USER.id });
    expect(res.ok).toBe(true);
    expect(finalizeSignup).toHaveBeenCalledTimes(1);
  });

  it("réponse perdue après finalisation : reprise sur la ligne users", async () => {
    const { res } = await run(
      { ...unverified, account: { phone: E164, phone_verified: true } },
      WRONG,
      confirmed(true),
    );
    expect(res.ok).toBe(true);
    expect(finalizeSignup).toHaveBeenCalledTimes(1);
  });

  it("réponse perdue entre Supabase Auth et le serveur : reprise si confirmation après envoi", async () => {
    const { res } = await run(
      {
        ...unverified,
        authPhone: "237691234567",
        confirmedAt: "2026-11-08T10:05:00Z",
      },
      WRONG,
    );
    expect(res.ok).toBe(true);
    expect(finalizeSignup).toHaveBeenCalledTimes(1);
  });

  it("numéro vérifié différent : refus", async () => {
    const { res } = await run(
      {
        ...unverified,
        account: { phone: "+237690000001", phone_verified: true },
      },
      WRONG,
    );
    expect(res.ok).toBe(false);
  });
});

describe("helpers", () => {
  it("toE164 normalise le format GoTrue", () => {
    expect(toE164("237691234567")).toBe(E164);
    expect(toE164(E164)).toBe(E164);
    expect(toE164("")).toBeNull();
    expect(toE164("abc")).toBeNull();
  });

  it("otpErrorCode", () => {
    expect(otpErrorCode({ code: "otp_expired", status: 403 })).toBe("otpWrong");
    expect(otpErrorCode({ status: 429 })).toBe("smsQuotaExceeded");
    expect(otpErrorCode({ status: 500 })).toBe("generic");
  });

  it("findPhoneProof ne lit pas Supabase Auth si la ligne users suffit", async () => {
    const admin = fakeAdmin({
      ...unverified,
      account: { phone: E164, phone_verified: true },
    });
    const spy = vi.spyOn(admin.auth.admin, "getUserById");
    expect(
      await findPhoneProof(admin as never, USER.id, E164, confirmed(false)),
    ).toBe("account_verified");
    expect(spy).not.toHaveBeenCalled();
  });
});
