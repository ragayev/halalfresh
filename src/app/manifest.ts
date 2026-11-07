import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Etamico",
    short_name: "Etamico",
    description: "Halal-Fleisch vom Berliner Metzger",
    start_url: "/de",
    scope: "/",
    display: "standalone",
    lang: "de",
    theme_color: "#8B1A1F",
    background_color: "#FFF5E6",
    icons: [
      { src: "/icons/etamico-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/etamico-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
