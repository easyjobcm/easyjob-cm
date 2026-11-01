import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // T5 : geolocation=(self) — la géolocalisation domicile (onboarding,
            // profil, distance domicile→mission) est une fonction produit ; la
            // list vide `geolocation=()` la bloquait AVANT toute demande au
            // navigateur (PERMISSION_DENIED sans prompt). `(self)` = seul le
            // document d'origine (jamais une iframe tierce embarquée) peut y
            // accéder. Caméra/micro restent interdits (aucun usage).
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
