import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Halal Fresh",
    short_name: "Halal Fresh",
    description: "Frisches Halal-Fleisch vom Berliner Metzger",
    start_url: "/de",
    scope: "/",
    display: "standalone",
    lang: "de",
    theme_color: "#6B1E23",
    background_color: "#F6EFE3",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
