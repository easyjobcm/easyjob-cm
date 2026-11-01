"use client";

import * as React from "react";

/** `timeout` : le fix a pris trop de temps (code 3 navigateur).
 *  Distingué de `unavailable` pour ne plus masquer un échec temporaire
 *  derrière « Position indisponible sur cet appareil ». */
export type GeolocationStatus =
  | "idle"
  | "loading"
  | "success"
  | "denied"
  | "unavailable"
  | "timeout"
  | "error";

export interface GeolocationCoords {
  latitude: number;
  longitude: number;
  /** Précision estimée en mètres (undefined si non fournie par l'appareil). */
  accuracy?: number;
}

/**
 * Transposition « code d'erreur navigateur → statut produit ». Valeurs W3C
 * Geolocation Position Error Code (Navigation Geolocation API) :
 *   1 PERMISSION_DENIED     → denied
 *   2 POSITION_UNAVAILABLE  → unavailable
 *   3 TIMEOUT               → timeout
 *   tout le reste / undefined / NaN → unavailable (défaut sûr)
 * Function pure exportée → testable sans DOM.
 * NOTE : le code 3 (TIMEOUT — fix trop lent, fréquent sur mobile à réseau
 * instable / A-GPS) était auparavant fusionné dans `unavailable`,
 * d'où le message trompeur « Position indisponible sur cet appareil »
 * sur mobile en prod.
 */
export function geoErrorCodeToStatus(
  code: number | undefined,
): GeolocationStatus {
  switch (code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    case 2:
      return "unavailable";
    default:
      return "unavailable";
  }
}

/**
 * Capture ponctuelle de la position (pas de suivi continu), déclenchée
 * uniquement par un appel explicite à `requestLocation()` (jamais au montage).
 * `onSuccess` est appelé directement dans le callback natif — pas via un
 * effet React — pour éviter un setState en cascade.
 * Ne journalise jamais les coordonnées.
 */
export function useGeolocation(
  onSuccess?: (coords: GeolocationCoords) => void,
) {
  const [status, setStatus] = React.useState<GeolocationStatus>("idle");
  const [coords, setCoords] = React.useState<GeolocationCoords | null>(null);
  const onSuccessRef = React.useRef(onSuccess);
  React.useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const requestLocation = React.useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }

    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: GeolocationCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        if (typeof position.coords.accuracy === "number") {
          next.accuracy = position.coords.accuracy;
        }
        setCoords(next);
        setStatus("success");
        onSuccessRef.current?.(next);
      },
      (err) => {
        // Codes W3C GeolocationPositionError.Code :
        //   1 PermissionDenied, 2 PositionUnavailable, 3 Timeout.
        // Mapping dédié (`geoErrorCodeToStatus`) : le code 3 (fix trop
        // lent, fréquent sur mobile à réseau instable) n'est plus
        // confondu avec « Position indisponible ».
        setStatus(geoErrorCodeToStatus(err.code));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  return { status, coords, requestLocation };
}
