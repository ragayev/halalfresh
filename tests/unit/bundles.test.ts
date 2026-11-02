import { describe, expect, it } from "vitest";
import {
  BUNDLES,
  BUNDLE_UNIT_GRAMS,
  bundleTotalGrams,
  formatQuantity,
  orderItemLines,
  parseBundleItems,
  parseBundleSnapshot,
  snapshotBundle,
} from "@/domain/bundles";
import { lineTotalCents } from "@/domain/pricing";

describe("Fleischpakete definitions", () => {
  const bySlug = Object.fromEntries(BUNDLES.map((b) => [b.slug, b]));

  it("has exactly the four launch bundles with the briefed totals and placeholder prices", () => {
    expect(BUNDLES.map((b) => [b.slug, bundleTotalGrams(b.items), b.priceCents])).toEqual([
      ["aile-paketi", 9500, 15990],
      ["mangal-paketi", 9000, 16990],
      ["aylik-stok-paketi", 15000, 24990],
      ["kuzu-severler-paketi", 8000, 19990],
    ]);
  });

  it("lists every component with its briefed weight", () => {
    expect(bySlug["aile-paketi"].items.map((i) => [i.names.tr, i.grams])).toEqual([
      ["Dana kıyma", 2000],
      ["Dana kuşbaşı", 1500],
      ["Dana haşlamalık", 1000],
      ["Kuzu kuşbaşı", 1000],
      ["Tavuk göğsü", 2000],
      ["Tavuk baget", 2000],
    ]);
    expect(bySlug["kuzu-severler-paketi"].items.map((i) => i.names.tr)).toEqual([
      "Kuzu pirzola",
      "Kuzu but",
      "Kuzu kol",
      "Kuzu kuşbaşı",
      "Kuzu kıyma",
    ]);
  });

  it("is fully translated (de, tr, en) with no empty text", () => {
    for (const b of BUNDLES) {
      for (const l of ["de", "tr", "en"] as const) {
        expect(b.name[l].length).toBeGreaterThan(2);
        expect(b.description[l].length).toBeGreaterThan(10);
        for (const i of b.items) expect(i.names[l].length).toBeGreaterThan(2);
      }
    }
  });
});

describe("bundle pricing and quantities", () => {
  it("prices n packages exactly: unit price * n, no per-kg rounding drift", () => {
    for (const b of BUNDLES) for (const n of [1, 2, 3, 5]) expect(lineTotalCents(b.priceCents, n * BUNDLE_UNIT_GRAMS)).toBe(b.priceCents * n);
  });
  it("formats bundle quantities as packages and others as weight", () => {
    expect(formatQuantity(2000, true)).toBe("2×");
    expect(formatQuantity(1500, false)).toBe("1.5 kg");
  });
});

describe("bundle snapshots", () => {
  const items = BUNDLES[0].items;
  it("round-trips through JSON", () => {
    const snap = parseBundleSnapshot(JSON.parse(JSON.stringify(snapshotBundle(items))));
    expect(snap?.totalGrams).toBe(9500);
    expect(snap?.items).toHaveLength(6);
  });
  it("rejects malformed contents", () => {
    expect(parseBundleItems([])).toBeNull();
    expect(parseBundleItems([{ grams: -1, names: { de: "x" } }])).toBeNull();
    expect(parseBundleItems([{ grams: 1000 }])).toBeNull();
    expect(parseBundleSnapshot(null)).toBeNull();
  });
  it("renders butcher/email lines scaled by package count; regular items stay one line", () => {
    const lines = orderItemLines({ productName: "Familienpaket", quantityGrams: 2000, bundleSnapshot: snapshotBundle(items) }, "de");
    expect(lines[0]).toBe("- Familienpaket — 2× (19 kg)");
    expect(lines).toContain("    · Rinderhackfleisch: 4 kg");
    expect(lines).toHaveLength(7);
    expect(orderItemLines({ productName: "Beef", quantityGrams: 1500 })).toEqual(["- Beef — 1.5 kg"]);
  });
});
