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
    theme_color: "#7a1f2b",
    background_color: "#faf6f0",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-crest.png", type: "image/png", purpose: "any" },
    ],
  };
}
