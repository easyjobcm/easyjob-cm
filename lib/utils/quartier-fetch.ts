/**
 * Reverse-geocoding quartier candidat (T5.1) — appelé APRÈS une capture GPS
 * acceptée (dans la zone de service) pour auto-compléter le champ `quartier`
 * du profil.
 *
 * Service : OpenStreetMap Nominatim (reverse) — 1 seule requête par clic
 * utilisateur (respect du rate-limit 1 req/s ; cf.
 * https://operations.osmfoundation.org/policies/nominatim/).
 *
 * Confidentialité SRS §12 : ne JAMAIS journaliser / afficher de coordonnée.
 * Un échec réseau ou un timeout (5 s) retourne `null` — le fix reste
 * valide, le candidat saisit le quartier lui-même.
 */

/** URL publique de l'API. Pas de clé requise pour reverse-geocoding. */
export const NOMINATIM_REVERSE_URL =
  "https://nominatim.openstreetmap.org/reverse";

/** Champs `address` Nominatim utilisés pour la détection du quartier, du
 *  plus fin au plus grossier. Le premier non vide gagne. `village`/`town`
 *  couvrent les petites agglomérations péri-urbaines. */
const QUARTIER_ADDRESS_KEYS = [
  "suburb",
  "neighbourhood",
  "quarter",
  "hamlet",
  "city_district",
  "county_district",
  "town",
  "village",
] as const;

/** Plafond de taille — le schéma Zod borne `quartier` à 100 caractères. */
const QUARTIER_MAX_LEN = 100;

/** Timeout fetch Nominatim — au-delà, le quartier n'est pas auto-posé
 *  (le fix GPS reste valide) : l'UX n'a pas à bloquer la suite. */
const FETCH_TIMEOUT_MS = 5_000;

/** Pur (testable sans réseau) : extrait le quartier d'un objet `address`
 *  Nominatim. Le premier champ de `QUARTIER_ADDRESS_KEYS` non vide gagne.
 *  Retourne `null` si aucun champ pertinent. */
export function pickQuartierFromAddress(
  address: Record<string, string> | undefined | null,
): string | null {
  if (!address) return null;
  for (const key of QUARTIER_ADDRESS_KEYS) {
    const v = address[key];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim().slice(0, QUARTIER_MAX_LEN);
    }
  }
  return null;
}

/** Appel Nominatim reverse-geocoding : retourne le quartier ou `null` sur
 *  toute erreur (réseau, HTTP, timeout, JSON invalide). Jamais d'exception
 *  vers le caller — un échec de détection quartier ne doit PAS bloquer le
 *  fix GPS. */
export async function fetchQuartierFromNominatim(
  lat: number,
  lng: number,
  locale: "fr" | "en" = "fr",
): Promise<string | null> {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  // zoom=18 → finitude quartier (~390 m de résolution, suffisant pour
  // les arrondissements de Douala/Yaoundé) ; zoom>18 ferait payer la
  // précision non utile et chargerait les noms de rues.
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", locale);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: Record<string, string>;
    };
    return pickQuartierFromAddress(data.address);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
