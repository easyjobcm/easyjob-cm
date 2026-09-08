import { describe, expect, it } from "vitest";
import {
  checkEssentialCriteria,
  computeCandidateCriteria,
  computeCompletion,
  type CandidateProfileForCompletion,
} from "@/lib/utils/profile-completion";

const FULL_IDENTITY: Pick<
  CandidateProfileForCompletion,
  "first_name" | "last_name" | "date_of_birth"
> = {
  first_name: "Aïcha",
  last_name: "Mbarga",
  date_of_birth: "1998-04-12",
};

const FUTURE_EXPIRATION = "2031-01-01";

describe("checkEssentialCriteria (gate postulation SRS §6.6)", () => {
  it("passe quand les trois essentiels sont remplis", () => {
    const result = checkEssentialCriteria({
      ...FULL_IDENTITY,
      cni_verified: "verified",
      cni_expires_at: FUTURE_EXPIRATION,
      momo_verified: true,
    });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("signale l'identité si un champ manque", () => {
    for (const patch of [
      { ...FULL_IDENTITY, first_name: null },
      { ...FULL_IDENTITY, last_name: "" },
      { ...FULL_IDENTITY, date_of_birth: null },
    ]) {
      const result = checkEssentialCriteria({
        ...patch,
        cni_verified: "verified",
        cni_expires_at: FUTURE_EXPIRATION,
        momo_verified: true,
      });
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("identity");
    }
  });

  it("signale la CNI si non vérifiée", () => {
    const statuses: ("pending" | "rejected" | "verified" | null)[] = [
      "pending",
      "rejected",
      null,
    ];
    for (const status of statuses) {
      const result = checkEssentialCriteria({
        ...FULL_IDENTITY,
        cni_verified: status,
        momo_verified: true,
      });
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("cni");
    }
  });

  it("signale la CNI si expirée, même si verified", () => {
    const result = checkEssentialCriteria({
      ...FULL_IDENTITY,
      cni_verified: "verified",
      cni_expires_at: "2020-01-01",
      momo_verified: true,
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("cni");
  });

  it("ne signale pas la CNI si cni_expires_at est vide (null)", () => {
    const result = checkEssentialCriteria({
      ...FULL_IDENTITY,
      cni_verified: "verified",
      cni_expires_at: null,
      momo_verified: true,
    });
    expect(result.missing).not.toContain("cni");
  });

  it("signale Mobile Money si non vérifié", () => {
    for (const value of [false, null]) {
      const result = checkEssentialCriteria({
        ...FULL_IDENTITY,
        cni_verified: "verified",
        cni_expires_at: FUTURE_EXPIRATION,
        momo_verified: value,
      });
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("momo");
    }
  });

  it("liste plusieurs critères manquants", () => {
    const result = checkEssentialCriteria({
      first_name: null,
      last_name: null,
      date_of_birth: null,
      cni_verified: null,
      momo_verified: false,
    });
    expect(result).toEqual({ ok: false, missing: ["identity", "cni", "momo"] });
  });
});

describe("computeCandidateCriteria (pondération profil)", () => {
  it("pondération invariante : total = 100", () => {
    const criteria = computeCandidateCriteria(
      {
        first_name: null,
        last_name: null,
        date_of_birth: null,
        city: null,
        profile_photo_url: null,
        bio: null,
        max_travel_distance_km: null,
        latitude: null,
        longitude: null,
        cni_front_url: null,
        cni_back_url: null,
        cni_selfie_url: null,
        cni_verified: null,
        momo_verified: null,
      },
      0,
    );
    const total = criteria.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBe(100);
    expect(criteria.every((c) => c.done === false)).toBe(true);
    expect(computeCompletion(criteria)).toBe(0);
  });

  it("un profil vide avec 0 compétences vaut 0%", () => {
    const result = computeCompletion(computeCandidateCriteria({}, 0));
    expect(result).toBe(0);
  });

  it("complétude 60% atteint = postulation possible (sans le gate essentiels)", () => {
    // identity(20) + photo(15) + skills(15) + bio(10) + cni(15) = 75 >= 60,
    // mais pas momo ni location ni availability.
    const profile: CandidateProfileForCompletion = {
      first_name: "Aïcha",
      last_name: "Mbarga",
      date_of_birth: "1998-04-12",
      city: "Douala",
      profile_photo_url: "photos/aicha.jpg",
      bio: "Cinquiennale en gestion, 3 ans d'expérience.",
      max_travel_distance_km: null,
      latitude: null,
      longitude: null,
      cni_front_url: "cni/front.jpg",
      cni_back_url: "cni/back.jpg",
      cni_selfie_url: "cni/selfie.jpg",
      cni_verified: null,
      momo_verified: null,
    };
    expect(computeCompletion(computeCandidateCriteria(profile, 2))).toBe(75);
  });
});
