import { formatWeight } from "./pricing";

/**
 * Fleischpakete: fixed meat bundles sold as one unit.
 *
 * A bundle is a regular Product. Its quantity unit is one package, encoded as 1000 "grams" per package so the
 * existing step/min/max validation and the integer price math (price * grams / 1000) apply unchanged:
 * `pricePerKgCents` holds the price of ONE package. The real weight lives in the contents.
 */
export const BUNDLE_UNIT_GRAMS = 1000;
export const BUNDLE_MAX_PACKAGES = 5;
/** Existing catalogue category the bundles live in (shop navigation reuses it; no new category). */
export const BUNDLE_CATEGORY = "paketler";

export type BundleLocale = "de" | "tr" | "en";

export interface BundleItem {
  /** Weight of this component in one package. */
  grams: number;
  names: Record<BundleLocale, string>;
  /** Catalogue product this component is cut from (availability hint for the admin). Optional. */
  productSlug?: string;
}

/** Stored on Order items: what the customer bought, frozen at checkout. */
export interface BundleSnapshot {
  totalGrams: number;
  items: BundleItem[];
}

export function bundleTotalGrams(items: BundleItem[]): number {
  return items.reduce((s, i) => s + i.grams, 0);
}

/** Defensive parse of the Json column; returns null when the value is not a valid bundle definition. */
export function parseBundleItems(raw: unknown): BundleItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: BundleItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const g = (r as { grams?: unknown }).grams;
    const n = (r as { names?: unknown }).names as Record<string, unknown> | undefined;
    if (typeof g !== "number" || !Number.isInteger(g) || g <= 0 || !n || typeof n.de !== "string") return null;
    const slug = (r as { productSlug?: unknown }).productSlug;
    out.push({
      grams: g,
      names: { de: n.de, tr: typeof n.tr === "string" ? n.tr : n.de, en: typeof n.en === "string" ? n.en : n.de },
      productSlug: typeof slug === "string" ? slug : undefined,
    });
  }
  return out;
}

export function snapshotBundle(items: BundleItem[]): BundleSnapshot {
  return { totalGrams: bundleTotalGrams(items), items };
}

export function parseBundleSnapshot(raw: unknown): BundleSnapshot | null {
  const items = parseBundleItems((raw as { items?: unknown } | null)?.items);
  return items ? snapshotBundle(items) : null;
}

export function bundleItemName(i: BundleItem, locale: string): string {
  return i.names[locale as BundleLocale] ?? i.names.de;
}

/** "2 × " style quantity for bundle lines, kg weight for everything else. */
export function formatQuantity(grams: number, isBundle: boolean): string {
  return isBundle ? `${grams / BUNDLE_UNIT_GRAMS}×` : formatWeight(grams);
}

/**
 * Plain-text lines for one order item (butcher message, emails). Regular product: one line.
 * Bundle: the headline plus one indented line per component, scaled by the number of packages.
 */
export function orderItemLines(
  i: { productName: string; quantityGrams: number; bundleSnapshot?: unknown },
  locale = "de",
  suffix = "",
): string[] {
  const snap = parseBundleSnapshot(i.bundleSnapshot);
  const head = `- ${i.productName} — ${formatQuantity(i.quantityGrams, !!snap)}${snap ? ` (${formatWeight(snap.totalGrams * (i.quantityGrams / BUNDLE_UNIT_GRAMS))})` : ""}${suffix}`;
  if (!snap) return [head];
  const n = i.quantityGrams / BUNDLE_UNIT_GRAMS;
  return [head, ...snap.items.map((b) => `    · ${bundleItemName(b, locale)}: ${formatWeight(b.grams * n)}`)];
}

// ---------------------------------------------------------------------------------------------
// The four launch bundles. PRICES ARE PLACEHOLDERS until Kevser confirms them (see seed: drafts).
// ---------------------------------------------------------------------------------------------
const n = (de: string, tr: string, en: string) => ({ de, tr, en });

export interface BundleDef {
  slug: string;
  image: string;
  priceCents: number;
  name: Record<BundleLocale, string>;
  description: Record<BundleLocale, string>;
  alt: Record<BundleLocale, string>;
  items: BundleItem[];
}

export const BUNDLES: BundleDef[] = [
  {
    slug: "aile-paketi",
    image: "/images/products/paketler/aile-paketi-v2.webp",
    priceCents: 15990,
    name: n("Familienpaket", "Aile Paketi", "Family Bundle"),
    description: n(
      "Die ausgewogene Auswahl für den Familientisch: Rind, Lamm und Hähnchen in Alltagsschnitten.",
      "Aile sofrası için dengeli seçki: günlük kullanıma uygun dana, kuzu ve tavuk kesimleri.",
      "A balanced selection for the family table: everyday cuts of beef, lamb and chicken.",
    ),
    alt: n(
      "Frisch geschnittenes Rind-, Lamm- und Hähnchenfleisch auf Holzbrettern",
      "Ahşap tahtalar üzerinde taze dana, kuzu ve tavuk kesimleri",
      "Fresh beef, lamb and chicken cuts on wooden boards",
    ),
    items: [
      { grams: 2000, names: n("Rinderhackfleisch", "Dana kıyma", "Beef mince"), productSlug: "dana-kiyma" },
      { grams: 1500, names: n("Rindergulasch (gewürfelt)", "Dana kuşbaşı", "Diced beef"), productSlug: "dana-kusbasi" },
      { grams: 1000, names: n("Rindfleisch zum Kochen", "Dana haşlamalık", "Beef for boiling"), productSlug: "dana-haslamalik" },
      { grams: 1000, names: n("Lammwürfel", "Kuzu kuşbaşı", "Diced lamb"), productSlug: "kuzu-kusbasi" },
      { grams: 2000, names: n("Hähnchenbrust", "Tavuk göğsü", "Chicken breast"), productSlug: "tavuk-gogus" },
      { grams: 2000, names: n("Hähnchenunterkeule", "Tavuk baget", "Chicken drumstick"), productSlug: "tavuk-baget" },
    ],
  },
  {
    slug: "mangal-paketi",
    image: "/images/products/paketler/mangal-paketi-v2.webp",
    priceCents: 16990,
    name: n("Grillpaket", "Mangal Paketi", "BBQ Bundle"),
    description: n(
      "Alles für den Grillabend: Adana, Köfte, Lammkoteletts, Spieße und Hähnchen.",
      "Mangal keyfi için her şey: Adana, köfte, kuzu pirzola, şişlik et ve tavuk.",
      "Everything for the barbecue: Adana, kofte, lamb chops, skewer meat and chicken.",
    ),
    alt: n(
      "Rohes Grillfleisch: Adana, Köfte, Lammkoteletts, Spießfleisch und Hähnchen",
      "Çiğ mangal etleri: Adana, köfte, kuzu pirzola, şişlik et ve tavuk",
      "Raw barbecue meats: Adana, kofte, lamb chops, skewer meat and chicken",
    ),
    items: [
      { grams: 1500, names: n("Adana-Kebab-Hackmasse", "Adana kıyma", "Adana kebab mix"), productSlug: "adana-kebaplik-harc" },
      { grams: 1500, names: n("Gegrillte Köfte", "Izgara köfte", "Grilled köfte"), productSlug: "izgara-kofte" },
      { grams: 1500, names: n("Lammkoteletts", "Kuzu pirzola", "Lamb chops"), productSlug: "kuzu-pirzola" },
      { grams: 1500, names: n("Rinder-Spießfleisch", "Dana şişlik kuşbaşı", "Beef skewer cubes") },
      { grams: 2000, names: n("Hähnchenflügel", "Tavuk kanat", "Chicken wings"), productSlug: "tavuk-kanat" },
      { grams: 1000, names: n("Hähnchenschenkel ohne Knochen", "Tavuk kemiksiz but", "Boneless chicken thigh"), productSlug: "tavuk-kemiksiz-but" },
    ],
  },
  {
    slug: "aylik-stok-paketi",
    image: "/images/products/paketler/aylik-stok-paketi-v2.webp",
    priceCents: 24990,
    name: n("Vorratspaket", "Aylık Stok Paketi", "Monthly Stock Bundle"),
    description: n(
      "Der große Vorrat für den Monat: Rind, Lamm und Hähnchen zum Einfrieren und Portionieren.",
      "Aylık ihtiyaç için büyük stok: dondurup porsiyonlayabileceğiniz dana, kuzu ve tavuk.",
      "The big monthly supply: beef, lamb and chicken to freeze and portion.",
    ),
    alt: n(
      "Große Auswahl an rohem Rind-, Lamm- und Hähnchenfleisch",
      "Çok çeşitli çiğ dana, kuzu ve tavuk eti",
      "Large assortment of raw beef, lamb and chicken",
    ),
    items: [
      { grams: 3000, names: n("Rinderhackfleisch", "Dana kıyma", "Beef mince"), productSlug: "dana-kiyma" },
      { grams: 2000, names: n("Rindergulasch (gewürfelt)", "Dana kuşbaşı", "Diced beef"), productSlug: "dana-kusbasi" },
      { grams: 2000, names: n("Rindfleisch zum Kochen", "Dana haşlamalık", "Beef for boiling"), productSlug: "dana-haslamalik" },
      { grams: 1000, names: n("Lammwürfel", "Kuzu kuşbaşı", "Diced lamb"), productSlug: "kuzu-kusbasi" },
      { grams: 3000, names: n("Hähnchenbrust", "Tavuk göğsü", "Chicken breast"), productSlug: "tavuk-gogus" },
      { grams: 2000, names: n("Hähnchenunterkeule", "Tavuk baget", "Chicken drumstick"), productSlug: "tavuk-baget" },
      { grams: 2000, names: n("Hähnchenflügel", "Tavuk kanat", "Chicken wings"), productSlug: "tavuk-kanat" },
    ],
  },
  {
    slug: "kuzu-severler-paketi",
    image: "/images/products/paketler/kuzu-severler-paketi-v2.webp",
    priceCents: 19990,
    name: n("Lammpaket", "Kuzu Severler Paketi", "Lamb Lovers Bundle"),
    description: n(
      "Für Lamm-Liebhaber: Koteletts, Keule, Schulter, Gulasch und Hackfleisch.",
      "Kuzu sevenler için: pirzola, but, kol, kuşbaşı ve kıyma.",
      "For lamb lovers: chops, leg, shoulder, diced lamb and mince.",
    ),
    alt: n(
      "Rohe Lammstücke: Koteletts, Keulen, Schulter, Würfel und Hackfleisch",
      "Çiğ kuzu parçaları: pirzola, but, kol, kuşbaşı ve kıyma",
      "Raw lamb cuts: chops, legs, shoulder, cubes and mince",
    ),
    items: [
      { grams: 1500, names: n("Lammkoteletts", "Kuzu pirzola", "Lamb chops"), productSlug: "kuzu-pirzola" },
      { grams: 2000, names: n("Lammkeule", "Kuzu but", "Leg of lamb"), productSlug: "kuzu-but" },
      { grams: 2000, names: n("Lammschulter", "Kuzu kol", "Lamb shoulder"), productSlug: "kuzu-kol" },
      { grams: 1500, names: n("Lammwürfel", "Kuzu kuşbaşı", "Diced lamb"), productSlug: "kuzu-kusbasi" },
      { grams: 1000, names: n("Lammhackfleisch", "Kuzu kıyma", "Lamb mince"), productSlug: "kuzu-kiyma" },
    ],
  },
];
