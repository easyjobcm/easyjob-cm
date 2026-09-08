/**
 * T3.1 — garde-fou « compétence de conduite -> permis vérifié » (miroir TS
 * de la migration 20260908150000 — même mapping, même modèle de sets
 * « satisfait par »). Les assertions ci-dessous décrivent LE CONTRAT partagé
 * entre le TS (lib/utils/license-requirements.ts) et le SQL (fonctions
 * `skill_requires_license` / `has_verified_license_for`) ; l'équivalence en
 * DB est verrouillée par la preuve E2E `scripts/proof-license-gate.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  licenseDocCovers,
  licenseSatisfies,
  requiredLicenseCategory,
  type LicenseCategoryT31,
} from "@/lib/utils/license-requirements";
import { getFlatSkillCatalog } from "@/lib/data/skill-catalog";

/** Mapping attendu — DOIT rester identique aux 8 lignes de
 * `public.skill_requires_license` (VALUES du SQL). */
const EXPECTED_SKILL_MAP: Record<string, LicenseCategoryT31> = {
  "Conduite moto": "moto",
  "Taxi moto": "moto",
  "Livraison moto": "moto",
  "Conduite voiture": "voiture",
  "Livraison voiture": "voiture",
  "Conduite fourgon": "fourgon",
  "Conduite camion": "camion",
  "Conduite bus": "bus",
};

describe("requiredLicenseCategory — mapping compétences de conduite (T3.1)", () => {
  it("mappe les 8 compétences de conduite vers la bonne catégorie", () => {
    for (const [skill, cat] of Object.entries(EXPECTED_SKILL_MAP)) {
      expect(requiredLicenseCategory(skill), skill).toBe(cat);
    }
  });

  it("est insensible à la casse et aux espaces (mêmes règles SQL lower+trim)", () => {
    expect(requiredLicenseCategory("  CONDUITE MOTO  ")).toBe("moto");
    expect(requiredLicenseCategory("conduite voiture ")).toBe("voiture");
  });

  it("renvoie undefined pour les compétences non-conduites", () => {
    const nonDriving: string[] = [
      "Cuisine",
      "Vente",
      "Livreur",
      "Livraison courses",
      "",
    ];
    for (const skill of nonDriving) {
      expect(requiredLicenseCategory(skill), skill).toBeUndefined();
    }
  });

  it("chaque compétence du guide-conduite du catalogue est mappée", () => {
    const flat = getFlatSkillCatalog().map((s) => s.name);
    for (const skill of Object.keys(EXPECTED_SKILL_MAP)) {
      expect(flat, `« ${skill} » doit figurer au catalogue`).toContain(skill);
    }
    // Et « Conduite bus » (ajout T3.1) ne doit pas être double-listée.
    expect(flat.filter((s) => s.toLowerCase() === "conduite bus")).toHaveLength(
      1,
    );
  });
});

describe("licenseSatisfies — modèle par sets « satisfait par » (T3.1)", () => {
  it("couvre exactement la même catégorie", () => {
    expect(licenseSatisfies("moto", "moto")).toBe(true);
    expect(licenseSatisfies("voiture", "voiture")).toBe(true);
    expect(licenseSatisfies("camion", "camion")).toBe(true);
    expect(licenseSatisfies("bus", "bus")).toBe(true);
  });

  it("camion couvre fourgon (set [fourgon, camion]) — et inversement NON", () => {
    expect(licenseSatisfies("fourgon", "camion")).toBe(true);
    expect(licenseSatisfies("fourgon", "fourgon")).toBe(true);
    expect(licenseSatisfies("camion", "fourgon")).toBe(false);
  });

  it("pas de transitivité : bus ne couvre ni fourgon ni moto", () => {
    expect(licenseSatisfies("fourgon", "bus")).toBe(false);
    expect(licenseSatisfies("moto", "bus")).toBe(false);
  });

  it("moto ≠ voiture (strict)", () => {
    expect(licenseSatisfies("moto", "voiture")).toBe(false);
    expect(licenseSatisfies("voiture", "moto")).toBe(false);
  });

  it("tous_types (permis international) est un wildcard : couvre toute exigence", () => {
    const required: LicenseCategoryT31[] = [
      "moto",
      "voiture",
      "fourgon",
      "camion",
      "bus",
      "tous_types",
    ];
    for (const r of required) {
      expect(licenseSatisfies(r, "tous_types"), `tous_types -> ${r}`).toBe(
        true,
      );
    }
  });

  it("null (pas de permis) ne couvre jamais rien", () => {
    const required: LicenseCategoryT31[] = [
      "moto",
      "voiture",
      "fourgon",
      "camion",
      "bus",
      "tous_types",
    ];
    for (const r of required) {
      expect(licenseSatisfies(r, null), `null ne couvre ${r}`).toBe(false);
    }
  });
});

describe("licenseDocCovers — statut vérifié + catégorie (T3.1)", () => {
  it("toujours true pour une compétence non-conduite (quel que soit le doc)", () => {
    expect(licenseDocCovers("Cuisine", "", null)).toBe(true);
    expect(licenseDocCovers("Cuisine", "pending", "moto")).toBe(true);
  });

  it("exige le statut verified (pending ne suffit pas)", () => {
    expect(licenseDocCovers("Conduite moto", "pending", "moto")).toBe(false);
    expect(licenseDocCovers("Conduite moto", "verified", "moto")).toBe(true);
  });

  it("exige une catégorie couvrante (null -> false)", () => {
    expect(licenseDocCovers("Conduite moto", "verified", null)).toBe(false);
    expect(licenseDocCovers("Conduite moto", "verified", "voiture")).toBe(
      false,
    );
    expect(licenseDocCovers("Conduite fourgon", "verified", "camion")).toBe(
      true,
    );
    expect(licenseDocCovers("Conduite camion", "verified", "tous_types")).toBe(
      true,
    );
  });
});
