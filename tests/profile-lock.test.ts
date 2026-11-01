import { describe, expect, it } from "vitest";
import {
  CNI_DOCUMENT_LOCK_FIELDS,
  changedIdentityFields,
  evaluateProfileLock,
  IDENTITY_LOCK_FIELDS,
  lockGroupForField,
  lockedGroupsForCni,
  PROFILE_LOCK_GROUPS,
} from "@/lib/utils/profile-lock";
import { birthDateSchema, maxBirthDate } from "@/lib/validations/profile";

describe("lockedGroupsForCni", () => {
  it("ne verrouille rien quand le CNI n'est pas vérifié", () => {
    expect(lockedGroupsForCni("pending")).toEqual([]);
    expect(lockedGroupsForCni("rejected")).toEqual([]);
    expect(lockedGroupsForCni(null)).toEqual([]);
  });

  it("verrouille les deux groupes quand le CNI est vérifié", () => {
    expect(lockedGroupsForCni("verified")).toEqual(PROFILE_LOCK_GROUPS);
  });
});

describe("lockGroupForField", () => {
  it("mappe chaque champ verrouillable à son groupe", () => {
    for (const f of IDENTITY_LOCK_FIELDS) {
      expect(lockGroupForField(f)).toBe("identity");
    }
    for (const f of CNI_DOCUMENT_LOCK_FIELDS) {
      expect(lockGroupForField(f)).toBe("cni_documents");
    }
    expect(lockGroupForField("profile_photo_url")).toBeUndefined();
    expect(lockGroupForField("bio")).toBeUndefined();
    expect(lockGroupForField("momo_number")).toBeUndefined();
  });
});

describe("changedIdentityFields", () => {
  const current = {
    first_name: "Serge",
    last_name: "Talla",
    date_of_birth: "1996-06-10",
  };

  it("ne compte pas une soumission identique comme modification", () => {
    expect(
      changedIdentityFields(
        {
          first_name: "Serge",
          last_name: "Talla",
          date_of_birth: "1996-06-10",
        },
        current,
      ),
    ).toEqual([]);
  });

  it("détecte un changement de date de naissance", () => {
    expect(
      changedIdentityFields(
        {
          first_name: "Serge",
          last_name: "Talla",
          date_of_birth: "1995-01-01",
        },
        current,
      ),
    ).toEqual(["date_of_birth"]);
  });

  it("détecte prénom + nom en même temps", () => {
    expect(
      changedIdentityFields(
        {
          first_name: "Serge",
          last_name: "Mbarga",
          date_of_birth: "1996-06-10",
        },
        current,
      ),
    ).toEqual(["last_name"]);
    expect(
      changedIdentityFields(
        {
          first_name: "Serge",
          last_name: "Mbarga",
          date_of_birth: "1995-01-01",
        },
        current,
      ),
    ).toEqual(["last_name", "date_of_birth"]);
  });

  it("traiter une valeur nulle courante comme « différente » d'une valeur fournie", () => {
    expect(
      changedIdentityFields(
        {
          first_name: "Serge",
          last_name: "Talla",
          date_of_birth: "1996-06-10",
        },
        { ...current, date_of_birth: null },
      ),
    ).toEqual(["date_of_birth"]);
  });
});

describe("evaluateProfileLock", () => {
  it("bloque un champ vérifié mais sans demande admin", () => {
    const r = evaluateProfileLock(["first_name"], ["identity"], []);
    expect(r.blocked).toBe(true);
    expect(r.lockedGroups).toEqual(["identity"]);
  });

  it("déverrouille un champ couvert par une demande admin pending", () => {
    const r = evaluateProfileLock(
      ["first_name", "date_of_birth"],
      ["identity", "cni_documents"],
      ["identity"],
    );
    expect(r.blocked).toBe(false);
    expect(r.unlockedByRequests).toEqual(["identity"]);
  });

  it("ne déverrouille que les groupes fournis : cni_documents demeure bloqué", () => {
    const r = evaluateProfileLock(
      ["cni_front_url"],
      ["identity", "cni_documents"],
      ["identity"],
    );
    expect(r.blocked).toBe(true);
    expect(r.lockedGroups).toEqual(["cni_documents"]);
  });

  it("ne bloque pas quand le CNI n'était pas vérifié", () => {
    const r = evaluateProfileLock(
      ["first_name"],
      lockedGroupsForCni("pending"),
      [],
    );
    expect(r.blocked).toBe(false);
  });

  it("ne bloque pas pour des champs non verrouillables", () => {
    const r = evaluateProfileLock(
      ["bio", "city", "momo_number"],
      ["identity", "cni_documents"],
      [],
    );
    expect(r.blocked).toBe(false);
    expect(r.lockedGroups).toEqual([]);
  });
});

describe("birthDateSchema", () => {
  it("accepte une date valide d'un adulte", () => {
    expect(birthDateSchema.safeParse("1996-06-10").success).toBe(true);
  });

  it("refuse un âge < 18 ans (ageInvalid)", () => {
    const res = birthDateSchema.safeParse("2025-01-01");
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      expect(messages).toContain("ageInvalid");
    }
  });

  it("refuse une date future", () => {
    const future = new Date(Date.now() + 864e5).toISOString().split("T")[0];
    expect(birthDateSchema.safeParse(future).success).toBe(false);
  });

  it("refuse un format invalide (birthDateInvalid)", () => {
    const res = birthDateSchema.safeParse("10/06/1996");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.map((i) => i.message)).toContain(
        "birthDateInvalid",
      );
    }
  });

  it("refuse une date antérieure à 1900", () => {
    expect(birthDateSchema.safeParse("1850-01-01").success).toBe(false);
  });

  it("borne de date de naissance : ~18 ans au jour le jour (idem onboarding)", () => {
    expect(maxBirthDate()).toBe(
      new Date(
        new Date(
          new Date().setFullYear(new Date().getFullYear() - 18),
        ).toISOString(),
      )
        .toISOString()
        .split("T")[0],
    );
  });
});
