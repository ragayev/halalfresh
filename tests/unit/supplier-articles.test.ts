import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Article {
  sku: string;
  de: string;
  tr: string;
  en: string;
  category: string;
  existingSlug?: string;
}

const root = process.cwd();
const articles = (JSON.parse(readFileSync(join(root, "prisma/data/kevser-articles.json"), "utf8")) as { items: Article[] }).items;
const existing = (JSON.parse(readFileSync(join(root, "prisma/data/catalog.json"), "utf8")) as {
  products: { id: string }[];
}).products;
const originalIds = new Set(existing.map((p) => p.id));
const listedIds = new Set<string>();

describe("Kevser supplier catalogue", () => {
  it("preserves all 140 printed article numbers without duplicates", () => {
    expect(articles).toHaveLength(140);
    expect(new Set(articles.map((a) => a.sku)).size).toBe(140);
    for (const [i, a] of articles.entries()) {
      const expected = i < 120 ? `032016${String(i + 1).padStart(3, "0")}` : `32016${i + 1}`;
      expect(a.sku).toBe(expected);
      expect(a.de.trim()).not.toBe("");
      expect(a.tr.trim()).not.toBe("");
      expect(a.en.trim()).not.toBe("");
    }
  });

  it("only links to existing or previously imported products", () => {
    for (const a of articles) {
      if (a.existingSlug) {
        expect(originalIds.has(a.existingSlug) || listedIds.has(a.existingSlug)).toBe(true);
      } else {
        listedIds.add(`kevser-${a.sku}`);
      }
    }
  });

  it("maps every article into a supported category with a fallback image", () => {
    const images: Record<string, string> = {
      dana: "dana/dana-haslamalik.webp",
      kuzu: "kuzu/kuzu-but.webp",
      tavuk: "tavuk/butun-tavuk.webp",
      sakatat: "sakatat/iskembe.webp",
      mangal: "mangal/izgara-kofte.webp",
      sarkuteri: "sarkuteri/sucuk.webp",
      hazir: "default-product.svg",
      icecek: "default-product.svg",
      ekipman: "default-product.svg",
    };
    for (const a of articles) {
      const relative = images[a.category];
      expect(relative).toBeDefined();
      expect(existsSync(join(root, "public/images/products", relative))).toBe(true);
    }
  });
});
