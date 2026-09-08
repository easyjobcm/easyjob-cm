/**
 * T5 — localisation candidat : validation des coordonnées domicile
 * (boundes géographiques, règle « lat+lng ensemble ou pas ») et invariants
 * du catalogue de villes (orthographe accentuée, pas de doublon).
 *
 * Règle produit : la précision GPS n'est JAMAIS stockée (pas de colonne
 * accuracy) — l'`accuracy` n'est que de l'affichage client, hors périmètre
 * de test. Confidentialité : aucune coordonnée n'est exposée (pas de test
 * d'affichage — c'est une règle de UI, vérifiée par preuve E2E).
 */
import { describe, expect, it } from "vitest";
import {
  geoSchema,
  isCleanGeoCoords,
  identitySchema,
} from "@/lib/validations/profile";
import { CAMEROON_CITIES } from "@/lib/utils/candidate-constants";

describe("CAMEROON_CITIES (T5 — orthographe canonique)", () => {
  it("les deux villes sont en orthographe accentuée (source de vérité = seed + SRS)", () => {
    expect(CAMEROON_CITIES).toContain("Yaoundé");
    expect(CAMEROON_CITIES).toContain("Douala");
  });

  it("aucun doublon dans le catalogue", () => {
    expect(new Set(CAMEROON_CITIES).size).toBe(CAMEROON_CITIES.length);
  });
});

describe("geoSchema (T5 — bornes géographiques)", () => {
  it("coordonnées valides (Douala : 4.05, 9.77) passent", () => {
    const r = geoSchema.safeParse({ latitude: 4.05, longitude: 9.77 });
    expect(r.success).toBe(true);
  });

  it("null (pas de GPS) passe — ville/quartier seul reste validable", () => {
    const r = geoSchema.safeParse({ latitude: null, longitude: null });
    expect(r.success).toBe(true);
  });

  it("lat/lng absents (undefined) passent", () => {
    const r = geoSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("latitude hors bornes > 90 est rejetée", () => {
    const r = geoSchema.safeParse({ latitude: 91, longitude: 11.5 });
    expect(r.success).toBe(false);
  });

  it("latitude hors bornes < -90 est rejetée", () => {
    const r = geoSchema.safeParse({ latitude: -91, longitude: 11.5 });
    expect(r.success).toBe(false);
  });

  it("longitude hors bornes > 180 est rejetée", () => {
    const r = geoSchema.safeParse({ latitude: 4.05, longitude: 181 });
    expect(r.success).toBe(false);
  });

  it("longitude hors bornes < -180 est rejetée", () => {
    const r = geoSchema.safeParse({ latitude: 4.05, longitude: -181 });
    expect(r.success).toBe(false);
  });
});

describe("identitySchema (T5 — coordonnées intégrées au schéma d'identité)", () => {
  const validIdentity = {
    first_name: "Jean",
    last_name: "Kouam",
    date_of_birth: "1995-05-05",
    city: "Douala",
    quartier: "Bonanjo",
    bio: "",
  };

  it("identité complète sans GPS -> valide", () => {
    const r = identitySchema.safeParse(validIdentity);
    expect(r.success).toBe(true);
  });

  it("identité + coordonnées valides -> valide", () => {
    const r = identitySchema.safeParse({
      ...validIdentity,
      latitude: 4.05,
      longitude: 9.77,
    });
    expect(r.success).toBe(true);
  });

  it("identité + lat hors bornes -> invalide (règle « client ET serveur »)", () => {
    const r = identitySchema.safeParse({
      ...validIdentity,
      latitude: 95,
      longitude: 9.77,
    });
    expect(r.success).toBe(false);
  });

  it("identité + null mixte : le schéma autorise (la PAIRE est garantie par isCleanGeoCoords + l'UI)", () => {
    // La géolocalisation est toujours posée par l'UI ENSEMBLE (le bouton
    // « Utiliser ma position » écrit lat ET lng), jamais à moitié. Le
    // schéma Zod borne les valeurs, l'invariant de paire est porté par
    // isCleanGeoCoords (écriture onboarding) + l'UI.
    const r = identitySchema.safeParse({
      ...validIdentity,
      latitude: null,
      longitude: 9.77,
    });
    expect(r.success).toBe(true);
  });
});

describe("isCleanGeoCoords (garde-bouche écriture directe onboarding)", () => {
  it("tous deux absents (undefined) -> clean", () => {
    expect(isCleanGeoCoords(undefined, undefined)).toBe(true);
  });

  it("paires complètes + bornées -> clean", () => {
    expect(isCleanGeoCoords(4.05, 9.77)).toBe(true);
    expect(isCleanGeoCoords(-4.05, -9.77)).toBe(true);
    expect(isCleanGeoCoords(0, 0)).toBe(true);
  });

  it("tous deux null -> clean (aucun GPS = valide, fallback même-ville)", () => {
    expect(isCleanGeoCoords(null, null)).toBe(true);
  });

  it("seul un des deux null -> NON clean (jamais une coord seule nulle)", () => {
    expect(isCleanGeoCoords(null, 9.77)).toBe(false);
    expect(isCleanGeoCoords(4.05, null)).toBe(false);
  });

  it("lat hors bornes -> NON clean", () => {
    expect(isCleanGeoCoords(91, 9.77)).toBe(false);
  });

  it("lng hors bornes -> NON clean", () => {
    expect(isCleanGeoCoords(4.05, 181)).toBe(false);
  });
});
