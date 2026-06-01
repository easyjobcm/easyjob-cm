import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EasyJob CM",
    short_name: "EasyJob",
    description: "Trouvez votre prochain job flexible au Cameroun",
    start_url: "/",
    display: "standalone",
    background_color: "#1A0A2E",
    theme_color: "#7C3AED",
    orientation: "portrait",
    scope: "/",
    lang: "fr",
    icons: [
      {
        src: "/icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-icon-180.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    categories: ["business", "productivity"],
    prefer_related_applications: false,
  };
}
