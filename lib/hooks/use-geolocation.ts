"use client";

import * as React from "react";

export type GeolocationStatus =
  | "idle"
  | "loading"
  | "success"
  | "denied"
  | "unavailable"
  | "error";

export interface GeolocationCoords {
  latitude: number;
  longitude: number;
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
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoords(next);
        setStatus("success");
        onSuccessRef.current?.(next);
      },
      (err) => {
        setStatus(
          err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  return { status, coords, requestLocation };
}
