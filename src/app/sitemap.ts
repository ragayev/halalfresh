import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/env";
import { LOCALES } from "@/i18n/config";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [products, cats] = await Promise.all([
    db.product.findMany({ select: { slug: true, updatedAt: true } }),
    db.category.findMany({ select: { slug: true } }),
  ]);
  const alt = (path: string) => ({
    languages: Object.fromEntries(LOCALES.map((l) => [l, `${base}/${l}${path}`])),
  });
  const entries: MetadataRoute.Sitemap = [];
  for (const l of LOCALES) {
    entries.push({ url: `${base}/${l}`, alternates: alt("") }, { url: `${base}/${l}/shop`, alternates: alt("/shop") });
    for (const c of cats)
      entries.push({
        url: `${base}/${l}/shop?category=${c.slug}`,
        alternates: alt(`/shop?category=${c.slug}`),
      });
    for (const p of products)
      entries.push({
        url: `${base}/${l}/products/${p.slug}`,
        lastModified: p.updatedAt,
        alternates: alt(`/products/${p.slug}`),
      });
    for (const s of ["privacy", "imprint", "terms"]) entries.push({ url: `${base}/${l}/legal/${s}` });
  }
  return entries;
}
