import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/*/cart", "/*/checkout", "/*/order/", "/*/dev"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
