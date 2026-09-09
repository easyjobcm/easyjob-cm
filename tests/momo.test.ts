/**
 * T6 — Mobile Money : validation admin MANUELLE + schemas Zod.
 *
 * La preuve de possession par OTP SMS a été RETIRÉE au lancement
 * (décision produit 2026-09-10) : le candidat déclare opérateur + numéro +
 * nom du compte ; l'admin valide manuellement en confrontant le nom déclaré
 * au nom CNI (SRS §11.5). La machine d'état vit dans les RPC Postgres
 * (`candidate_update_momo`, `apply_momo_verification`) — couverte par la
 * preuve E2E `scripts/proof-profile-momo.ts`.
 *
 * Environnement vitest = `node` (pas de DOM) : uniquement des fonctions
 * pures/déterministes.
 */
import { describe, expect, it } from "vitest";
import { momoModerateSchema, paymentSchema } from "@/lib/validations/profile";

describe("paymentSchema (déclaration candidat)", () => {
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

  it("nom de compte ≥ 100 caractères → 'momoAccountNameTooLong' ; 100 ok", () => {
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
