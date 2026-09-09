/**
 * Géographie produit (T5.1) — centres de référence des deux villes du
 * Cameroun servies par Easyjob (`CAMEROON_CITIES`) et la règle « zone de
 * service ».
 *
 * Une position GPS domicile hors zone (> `CITY_ZONE_RADIUS_KM` du centre
 * de référence le plus proche) est REJETÉE : le site ne sert que Douala /
 * Yaoundé (SRS — périmètre MVP). La position la plus proche est utilisée
 * pour auto-compléter la `city` du profil.
 *
 * Le Haversine vit ici (et non dans `ai-matching.ts`) pour être réutilisé
 * par le matching domicile→mission ET la validation de zone — même
 * formule, un seul endroit.
 *
 * Confidentialité SRS §12 : ne JAMAIS journaliser / afficher de
 * coordonnée ; ces fonctions ne retournent que des noms de ville ou des
 * distances.
 */

/** Point {lat, lng} en degrés décimaux (WGS84, convention GPS navigateur). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Centre de service de chaque ville — valeur validée avec le produit
 *  (T5.1) : centre-ville. ± quelques km n'impacte pas la décision de zone
 *  (l'écart ville valide / ville invalide est de ~60 à ~200 km). */
export const CITY_CENTROIDS: Readonly<Record<string, GeoPoint>> = {
  Douala: { lat: 4.04, lng: 9.69 },
  Yaoundé: { lat: 3.87, lng: 11.51 },
};

/** Rayon de la zone de service — un fix à l'intérieur est accepté, au-delà
 *  il est rejeté. Vague configurable : seule constante à ajuster si la
 *  zone de couverture évolue. */
export const CITY_ZONE_RADIUS_KM = 20;

/** Rayon de la Terre en km (approximation standard, même usage que le
 *  matching). */
const EARTH_RADIUS_KM = 6371;

const DEG_TO_RAD = Math.PI / 180;

/** Distance Haversine en km entre deux points. Formule sphérique
 *  classique — suffisante pour les distances < 500 km (Cameroun). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG_TO_RAD) *
      Math.cos(b.lat * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ville la plus proche (centroïde) d'un point GPS. Retourne `null` si les
 *  coordonnées ne sont pas de vrais nombres (absentes / NaN). */
export function nearestCityFor(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  let nearest: string | null = null;
  let nearestDist = Infinity;
  for (const [city, center] of Object.entries(CITY_CENTROIDS)) {
    const d = haversineKm({ lat, lng }, center);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = city;
    }
  }
  return nearest;
}

/** `true` si le point GPS est dans la zone de service (≤ rayon du centre
 *  le plus proche). `false` si les coordonnées manquent / NaN ou hors
 *  zone. Les deux cas sont « à refuser » côté GPS : une position vide
 *  n'est PAS une position valide (le fallback « même ville » est porté par
 *  l'absence DB, pas par un fix hors zone). */
export function isNearCityZone(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  const nearest = nearestCityFor(lat, lng);
  if (nearest === null) return false;
  const d = haversineKm(
    { lat: lat as number, lng: lng as number },
    CITY_CENTROIDS[nearest],
  );
  return d <= CITY_ZONE_RADIUS_KM;
}
