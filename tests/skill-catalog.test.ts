import { describe, expect, it } from "vitest";
import {
  getFlatSkillCatalog,
  searchSkillCatalog,
  SKILL_CATALOG,
} from "@/lib/data/skill-catalog";
import { COMMON_SKILLS } from "@/lib/utils/candidate-constants";

describe("skill catalog (T3 — page /profile/skills)", () => {
  it("n'a aucun nom en double dans la liste aplatie", () => {
    const names = getFlatSkillCatalog().map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("couvre les 15 compétences de l'onboarding (les candidates retrouvent leurs cases)", () => {
    const catalogNames = new Set(getFlatSkillCatalog().map((s) => s.name));
    const missing = COMMON_SKILLS.filter((s) => !catalogNames.has(s));
    expect(missing).toEqual([]);
  });

  it("contient au moins 90 compétences dans 14 groupes", () => {
    expect(SKILL_CATALOG.length).toBe(14);
    expect(getFlatSkillCatalog().length).toBeGreaterThanOrEqual(90);
  });

  it("associe chaque skill à la clé de son groupe", () => {
    const groupKeys = new Set(SKILL_CATALOG.map((g) => g.key));
    for (const skill of getFlatSkillCatalog()) {
      expect(groupKeys.has(skill.groupKey)).toBe(true);
    }
  });

  describe("searchSkillCatalog", () => {
    it("renvoie tout le catalogue quand la requête est vide", () => {
      expect(searchSkillCatalog("")).toHaveLength(getFlatSkillCatalog().length);
    });

    it("est insensible à la casse et aux espaces", () => {
      expect(searchSkillCatalog("  CAISSE  ")).toEqual(
        searchSkillCatalog("Caisse"),
      );
    });

    it("filtre en sous-chaîne", () => {
      const matches = searchSkillCatalog("livraison");
      expect(matches.length).toBeGreaterThan(0);
      expect(
        matches.every((s) => s.name.toLowerCase().includes("livraison")),
      ).toBe(true);
    });

    it("renvoie un résultat vide pour une requête inconnue", () => {
      expect(searchSkillCatalog("zzz-inexistant-9999")).toEqual([]);
    });
  });
});
