/**
 * T6 — Mobile Money : preuve de possession (OTP 6 chiffres SMS) + schemas Zod.
 *
 * Environnement vitest = `node` (pas de DOM) : uniquement des fonctions
 * pures/déterministes. La machine d'état OTP vit dans les RPC Postgres
 * (`momo_verify_otp`) — couverte par la preuve E2E `scripts/proof-profile-momo.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  buildMomoOtpSmsBody,
  formatMomoNumber,
  generateMomoOtpToken,
  hashMomoOtpToken,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  OTP_TTL_SECONDS,
  OTP_TOKEN_LENGTH,
} from "@/lib/momo-otp";
import { createHash } from "node:crypto";
import {
  momoModerateSchema,
  momoOtpSchema,
  paymentSchema,
} from "@/lib/validations/profile";

describe("momo-otp — génération du code", () => {
  it("6 chiffres, jamais de 000000 (bornes inclusives 100000..999999)", () => {
    for (let i = 0; i < 500; i++) {
      const token = generateMomoOtpToken();
      expect(token).toMatch(/^\d{6}$/);
      const n = Number(token);
      expect(n).toBeGreaterThanOrEqual(100_000);
      expect(n).toBeLessThan(1_000_000);
    }
  });

  it("ne produit jamais deux codes identiques d'affilée (random 9 chiffres)", () => {
    // P(la même valeur 2 fois de suite) = 1/900 000 ; 20 itérations ≈ 2e-5.
    let prev = generateMomoOtpToken();
    for (let i = 0; i < 20; i++) {
      const token = generateMomoOtpToken();
      expect(token).not.toBe(prev);
      prev = token;
    }
  });

  it("OTP_TOKEN_LENGTH = 6 (contrat OtpInput / SMS)", () => {
    expect(OTP_TOKEN_LENGTH).toBe(6);
    expect(generateMomoOtpToken().length).toBe(OTP_TOKEN_LENGTH);
  });
});

describe("momo-otp — hash SHA-256 (jamais le code en clair en base)", () => {
  it("est stable et correspond exactement à createHash('sha256').digest('hex')", () => {
    const token = "123456";
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(hashMomoOtpToken(token)).toBe(expected);
    expect(hashMomoOtpToken(token)).toBe(expected);
  });

  it("des codes différents → des hash différents", () => {
    expect(hashMomoOtpToken("123456")).not.toBe(hashMomoOtpToken("123457"));
  });

  it("hash = 64 caractères hex", () => {
    expect(hashMomoOtpToken("000000")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("momo-otp — constantes", () => {
  it("TTL 10 minutes (ms/s alignés)", () => {
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
    expect(OTP_TTL_SECONDS).toBe(600);
    expect(OTP_TTL_SECONDS).toBe(Math.floor(OTP_TTL_MS / 1000));
  });

  it("3 essais maximum avant rejet de la preuve", () => {
    expect(MAX_OTP_ATTEMPTS).toBe(3);
  });
});

describe("momo-otp — format du numéro camerounais", () => {
  it("9 chiffres → « xxx xxx xxx »", () => {
    expect(formatMomoNumber("612345678")).toBe("612 345 678");
  });

  it("avec des espaces/ponctuation, borné à 9 chiffres", () => {
    expect(formatMomoNumber("612 345 678")).toBe("612 345 678");
    expect(formatMomoNumber("61234567890123")).toBe("612 345 678");
  });

  it("moins de 4 chiffres → tel quel (pas de format possible)", () => {
    expect(formatMomoNumber("6")).toBe("6");
    expect(formatMomoNumber("")).toBe("");
  });
});

describe("momo-otp — corps du SMS", () => {
  it("contient le code en clair + marque Easyjob CM", () => {
    const body = buildMomoOtpSmsBody("424242");
    expect(body).toContain("424242");
    expect(body).toContain("Easyjob CM");
  });

  it("des tokens différents → des corps différents", () => {
    expect(buildMomoOtpSmsBody("111111")).not.toBe(
      buildMomoOtpSmsBody("222222"),
    );
  });
});

describe("paymentSchema (T6 : + momo_account_name optionnel)", () => {
  it("valide un opérateur/numéro corrects, nom de compte omis → undefined accepté", () => {
    const ok = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "612345678",
    });
    expect(ok.success).toBe(true);
  });

  it("le numéro avec espaces est normalisé (phoneSchema pré-traité)", () => {
    const ok = paymentSchema.safeParse({
      momo_provider: "orange",
      momo_number: " 699 111 222 ",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.momo_number).toBe("699111222");
    }
  });

  it("opérateur invalide → message clé 'momoProviderInvalid'", () => {
    const bad = paymentSchema.safeParse({
      momo_provider: "camtel",
      momo_number: "612345678",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("momoProviderInvalid");
    }
  });

  it("numéro non camerounais (préfixe ≠ 6) → 'phoneInvalid'", () => {
    const bad = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "712345678",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("phoneInvalid");
    }
  });

  it("nom de compte ≥ 100 caractères → 'momoAccountNameTooLong'", () => {
    const ok = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "612345678",
      momo_account_name: "a".repeat(100),
    });
    expect(ok.success).toBe(true);
    const bad = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "612345678",
      momo_account_name: "a".repeat(101),
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("momoAccountNameTooLong");
    }
  });

  it("le nom de compte est trimmé", () => {
    const ok = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "612345678",
      momo_account_name: "  Jean Dupont  ",
    });
    if (ok.success) {
      expect(ok.data.momo_account_name).toBe("Jean Dupont");
    }
  });
});

describe("momoOtpSchema", () => {
  it("6 chiffres + numéro camerounais → ok", () => {
    const ok = momoOtpSchema.safeParse({
      token: "123456",
      number: "612345678",
    });
    expect(ok.success).toBe(true);
  });

  it("token non numérique / 5 chiffres → 'otpInvalid'", () => {
    for (const token of ["12345", "abc123", "1234567", ""]) {
      const bad = momoOtpSchema.safeParse({ token, number: "612345678" });
      expect(bad.success).toBe(false);
      if (!bad.success) {
        expect(bad.error.issues[0].message).toBe("otpInvalid");
      }
    }
  });

  it("numéro invalide sur le champ number → 'phoneInvalid'", () => {
    const bad = momoOtpSchema.safeParse({ token: "123456", number: "123" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("phoneInvalid");
    }
  });
});

describe("momoModerateSchema (validation admin)", () => {
  it("approve sans motif → ok", () => {
    const ok = momoModerateSchema.safeParse({
      profile_id: "11111111-2222-4333-8444-555555555555",
      action: "approve",
    });
    expect(ok.success).toBe(true);
  });

  it("reject avec motif (≥ 3 car) → ok", () => {
    const ok = momoModerateSchema.safeParse({
      profile_id: "11111111-2222-4333-8444-555555555555",
      action: "reject",
      rejection_reason: "Nom du compte ≠ nom de la CNI",
    });
    expect(ok.success).toBe(true);
  });

  it("reject SANS motif → 'momoRejectReasonRequired'", () => {
    const bad = momoModerateSchema.safeParse({
      profile_id: "11111111-2222-4333-8444-555555555555",
      action: "reject",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("momoRejectReasonRequired");
    }
  });

  it("motif < 3 caractères → 'momoRejectReasonTooShort' (refine non déclenchée : le champ existe)", () => {
    const bad = momoModerateSchema.safeParse({
      profile_id: "11111111-2222-4333-8444-555555555555",
      action: "reject",
      rejection_reason: "x",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe("momoRejectReasonTooShort");
    }
  });

  it("profile_id non-uuid / action invalide → rejet", () => {
    const badUuid = momoModerateSchema.safeParse({
      profile_id: "pas-un-uuid",
      action: "approve",
    });
    expect(badUuid.success).toBe(false);
    const badAction = momoModerateSchema.safeParse({
      profile_id: "11111111-2222-4333-8444-555555555555",
      action: "maybe",
    });
    expect(badAction.success).toBe(false);
  });
});
