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
import {
  CITY_CENTROIDS,
  CITY_ZONE_RADIUS_KM,
  haversineKm,
  isNearCityZone,
  nearestCityFor,
} from "@/lib/validations/geo-schema";
import {
  pickQuartierFromAddress,
  NOMINATIM_REVERSE_URL,
} from "@/lib/utils/quartier-fetch";
import { geoErrorCodeToStatus } from "@/lib/hooks/use-geolocation";
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

/**
 * T5.1 — localisation : zone de service (Douala/Yaoundé) + auto-remplissage.
 *
 * Règle produit : le site ne sert QUE Douala et Yaoundé. Une position GPS
 * domicile HORS zone (> 20 km du centre de référence le plus proche) est
 * REJETÉE. Un fix DANS zone est accepté et auto-remplit la ville la plus
 * proche (+ le quartier via Nominatim hors périmètre de test : c'est de
 * l'UX de fetch, pas un invariant de zone).
 *
 * Distance Haversine : source unique `lib/validations/geo-schema.ts`
 * (partagée avec le matching domicile→mission).
 */
describe("CITY_CENTROIDS / CITY_ZONE_RADIUS_KM (T5.1 — config de zone)", () => {
  it("les deux villes du catalogue ont un CENTROÏde défini", () => {
    for (const city of CAMEROON_CITIES) {
      const c = CITY_CENTROIDS[city];
      expect(c, `CENTROÏde manquant pour ${city}`).toBeDefined();
      expect(c.lat).toBeGreaterThanOrEqual(-90);
      expect(c.lat).toBeLessThanOrEqual(90);
      expect(c.lng).toBeGreaterThanOrEqual(-180);
      expect(c.lng).toBeLessThanOrEqual(180);
    }
  });

  it("le rayon de zone est positif (bornes géo valides)", () => {
    expect(CITY_ZONE_RADIUS_KM).toBeGreaterThan(0);
    expect(CITY_ZONE_RADIUS_KM).toBeLessThanOrEqual(200);
  });
});

describe("haversineKm (T5.1 — distance grande échelle)", () => {
  it("même point -> 0 km", () => {
    expect(
      haversineKm(CITY_CENTROIDS.Douala, CITY_CENTROIDS.Douala),
    ).toBeCloseTo(0, 3);
  });

  it("centre Douala -> centre Yaoundé ≈ 200 km (bien au-delà de la zone)", () => {
    const d = haversineKm(CITY_CENTROIDS.Douala, CITY_CENTROIDS.Yaoundé);
    // La valeur exacte dépend de la géodésie ; on borne large mais stricte sur
    // « inter-urbain » (pas un accident de ~0 km / ~3000+ km).
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(260);
  });
});

describe("nearestCityFor (T5.1 — ville la plus proche)", () => {
  it("centre exact de Douala -> 'Douala'", () => {
    expect(
      nearestCityFor(CITY_CENTROIDS.Douala.lat, CITY_CENTROIDS.Douala.lng),
    ).toBe("Douala");
  });

  it("centre exact de Yaoundé -> 'Yaoundé'", () => {
    expect(
      nearestCityFor(CITY_CENTROIDS.Yaoundé.lat, CITY_CENTROIDS.Yaoundé.lng),
    ).toBe("Yaoundé");
  });

  it("coordonnées manquantes (null) -> null (aucune ville détectable)", () => {
    expect(nearestCityFor(null, 9.69)).toBeNull();
    expect(nearestCityFor(4.04, null)).toBeNull();
    expect(nearestCityFor(undefined, undefined)).toBeNull();
  });

  it("NaN -> null (pas de ville, pas de crash)", () => {
    expect(nearestCityFor(Number.NaN, 9.69)).toBeNull();
  });
});

describe("isNearCityZone (T5.1 — acceptation / refus de zone)", () => {
  it("centre de Douala -> dans la zone", () => {
    expect(
      isNearCityZone(CITY_CENTROIDS.Douala.lat, CITY_CENTROIDS.Douala.lng),
    ).toBe(true);
  });

  it("centre de Yaoundé -> dans la zone", () => {
    expect(
      isNearCityZone(CITY_CENTROIDS.Yaoundé.lat, CITY_CENTROIDS.Yaoundé.lng),
    ).toBe(true);
  });

  it("point à ~210 km au sud-ouest de Yaoundé (sud Cameroun) -> HORS zone", () => {
    // (1.96, 11.44) est bien au-delà des 20 km des deux centroïdes
    // (~210 km du centroïde de Yaoundé, ~300 km du centroïde de Douala).
    expect(isNearCityZone(1.96, 11.44)).toBe(false);
  });

  it("Douala ~40 km au nord du centre (bassin péri-urbain extrême) -> HORS zone", () => {
    // Centre 4.04 + 0.36° lat ≈ 40 km nord → bien au-delà du rayon de 20 km.
    expect(isNearCityZone(4.4, 9.69)).toBe(false);
  });

  it("limites : ~19.7 km au sud du centre Douala -> DANS la zone ; ~20.5 km -> HORS", () => {
    // 1° de latitude ≈ 110.6 km.
    const at = (kmSouth: number) => ({
      lat: CITY_CENTROIDS.Douala.lat - kmSouth / 110.6,
      lng: CITY_CENTROIDS.Douala.lng,
    });
    expect(isNearCityZone(at(19.7).lat, at(19.7).lng)).toBe(true);
    expect(isNearCityZone(at(20.5).lat, at(20.5).lng)).toBe(false);
  });

  it("coordonnées absentes (null) -> HORS zone (pas un fix valide)", () => {
    expect(isNearCityZone(null, null)).toBe(false);
    expect(isNearCityZone(null, 9.69)).toBe(false);
  });
});

describe("geoSchema (T5.1 — refine zone de service)", () => {
  it("paire DANS la zone (centre Douala) -> valide", () => {
    const r = geoSchema.safeParse({
      latitude: CITY_CENTROIDS.Douala.lat,
      longitude: CITY_CENTROIDS.Douala.lng,
    });
    expect(r.success).toBe(true);
  });

  it("paire HORS zone (sud Cameroun, ~210 km de Yaoundé) -> invalide + message geoOutOfZone", () => {
    const r = geoSchema.safeParse({ latitude: 1.96, longitude: 11.44 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "geoOutOfZone")).toBe(
        true,
      );
    }
  });

  it("null -> valide (fallback même ville) — inchangé T5", () => {
    expect(
      geoSchema.safeParse({ latitude: null, longitude: null }).success,
    ).toBe(true);
  });

  it("absentes (undefined) -> valide (pas de GPS) — inchangé T5", () => {
    expect(geoSchema.safeParse({}).success).toBe(true);
  });
});

describe("identitySchema (T5.1 — city restreinte au catalogue)", () => {
  const validIdentity = {
    first_name: "Jean",
    last_name: "Kouam",
    date_of_birth: "1995-05-05",
    bio: "",
    quartier: "Bonanjo",
  };

  it("city 'Douala' -> valide", () => {
    expect(
      identitySchema.safeParse({ ...validIdentity, city: "Douala" }).success,
    ).toBe(true);
  });

  it("city 'Yaoundé' -> valide", () => {
    expect(
      identitySchema.safeParse({ ...validIdentity, city: "Yaoundé" }).success,
    ).toBe(true);
  });

  it("city 'Bafoussam' (hors catalogue) -> invalide + cityNotServed", () => {
    // Bafoussam EST une ville camerounaise, elle est simplement HORS du
    // périmètre MVP Douala/Yaoundé — c'est exactement le cas de test T5.1.
    const r = identitySchema.safeParse({ ...validIdentity, city: "Bafoussam" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "cityNotServed")).toBe(
        true,
      );
    }
  });

  it("city vide -> cityRequired (inchangé T5)", () => {
    const r = identitySchema.safeParse({ ...validIdentity, city: "  " });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "cityRequired")).toBe(
        true,
      );
    }
  });

  it("city valide + GPS hors zone -> invalide (les deux règles composées)", () => {
    const r = identitySchema.safeParse({
      ...validIdentity,
      city: "Douala",
      latitude: 1.96,
      longitude: 11.44,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "geoOutOfZone")).toBe(
        true,
      );
    }
  });
});

describe("pickQuartierFromAddress (T5.1 — extraction Nominatim, pur)", () => {
  it("suburb non vide -> retourné", () => {
    expect(pickQuartierFromAddress({ suburb: "Bonanjo" })).toBe("Bonanjo");
  });

  it("le premier champ non vide gagne (suburb vide -> neighbourhood)", () => {
    expect(
      pickQuartierFromAddress({ suburb: "  ", neighbourhood: "Akwa" }),
    ).toBe("Akwa");
  });

  it("aucun champ quartier présent -> null (pas de quartier détectable)", () => {
    expect(
      pickQuartierFromAddress({ country: "Cameroon", city: "Douala" }),
    ).toBeNull();
  });

  it("address vide / null / undefined -> null", () => {
    expect(pickQuartierFromAddress({})).toBeNull();
    expect(pickQuartierFromAddress(null)).toBeNull();
    expect(pickQuartierFromAddress(undefined)).toBeNull();
  });

  it("le quartier est borné à 100 caractères et trimmé", () => {
    const long = "A".repeat(150);
    const out = pickQuartierFromAddress({ suburb: `  ${long}  ` });
    expect(out).toHaveLength(100);
  });

  it("le champ non-string (nombre) est ignoré", () => {
    expect(
      pickQuartierFromAddress({
        suburb: 42,
        neighbourhood: "Akwa",
      } as unknown as Record<string, string>),
    ).toBe("Akwa");
  });
});

describe("NOMINATIM_REVERSE_URL (T5.1 — service de reverse-geocoding)", () => {
  it("pointe vers l'API publique OSM Nominatim (https)", () => {
    expect(NOMINATIM_REVERSE_URL).toBe(
      "https://nominatim.openstreetmap.org/reverse",
    );
  });
});

/**
 * geoErrorCodeToStatus — mapping code d'erreur navigateur (W3C
 * GeolocationPositionError) → statut produit. Contexte : sur mobile, un fix
 * GPS à froid (surtout à réseau instable / A-GPS) dépasse le timeout de 10 s
 * et le navigateur renvoie le code 3 ; avant le découpage, ce cas était
 * fondu dans « Position indisponible sur cet appareil ».
 */
describe("geoErrorCodeToStatus (codes W3C → statuts)", () => {
  it("code 1 (permission refusée) -> denied", () => {
    expect(geoErrorCodeToStatus(1)).toBe("denied");
  });

  it("code 2 (position indisponible) -> unavailable", () => {
    expect(geoErrorCodeToStatus(2)).toBe("unavailable");
  });

  it("code 3 (timeout) -> timeout (distingué de unavailable)", () => {
    expect(geoErrorCodeToStatus(3)).toBe("timeout");
  });

  it("code inconnu / 0 / négatif -> unavailable (défaut sûr)", () => {
    expect(geoErrorCodeToStatus(0)).toBe("unavailable");
    expect(geoErrorCodeToStatus(4)).toBe("unavailable");
    expect(geoErrorCodeToStatus(-1)).toBe("unavailable");
  });

  it("code absent (undefined, NaN) -> unavailable, jamais un statut invalide", () => {
    expect(geoErrorCodeToStatus(undefined)).toBe("unavailable");
    expect(geoErrorCodeToStatus(Number.NaN)).toBe("unavailable");
  });
});
