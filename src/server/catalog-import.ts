import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BUNDLES, BUNDLE_CATEGORY, BUNDLE_MAX_PACKAGES, BUNDLE_UNIT_GRAMS } from "@/domain/bundles";
import { DEFAULT_PRODUCT_IMAGE, normalizeSku, SUPPLIER_SKU_RE } from "@/domain/product-rules";

/**
 * One-time / repeatable legacy catalogue import (prisma/data/*.json + the launch bundles + preorder placeholders).
 *
 * CREATE-ONLY. A product that already exists (matched by its stable slug) is never modified, so admin edits to names,
 * prices, images, availability, status, bundle contents and SKU mappings always survive. Supplier mappings are only
 * added, never moved: a SKU already mapped to a different product is reported as a conflict.
 *
 * Dry-run is the default and runs the exact same code inside a transaction that is rolled back, so the report of a
 * dry-run is what --apply will do.
 */
export interface ImportOptions {
  apply: boolean;
  /** Explicit opt-in: take the fictional early demo products (and the "ekonomik-paket" placeholder) off the storefront. */
  hideLegacyDemo?: boolean;
  dataDir?: string;
}

export interface ImportReport {
  mode: "dry-run" | "apply";
  categoriesCreated: string[];
  created: { catalog: number; supplier: number; bundle: number; preorder: number };
  existingUntouched: number;
  skusLinked: number;
  skusAlreadyLinked: number;
  skuConflicts: { sku: string; wantedProduct: string; mappedTo: string }[];
  problems: string[];
  legacyDemoHidden: number;
}

interface CatalogFile {
  categories: { slug: string; tr: string; de: string; en: string }[];
  products: { id: string; category: string; image: string; unit: string; status: "active" | "draft"; name: Record<"tr" | "de" | "en", string> }[];
}
interface SupplierItem { sku: string; de: string; tr: string; en: string; category: string; existingSlug?: string }

const SUPPLIER_CATEGORY_META: Record<string, { tr: string; de: string; en: string }> = {
  hazir: { tr: "Hazır Ürünler", de: "Fertiggerichte", en: "Prepared Foods" },
  icecek: { tr: "İçecekler", de: "Getränke", en: "Drinks" },
  ekipman: { tr: "Ekipman", de: "Ausstattung", en: "Equipment" },
};
/** Illustrative stand-ins for supplier-only articles (a photo of a related cut, or the generic default). */
export const SUPPLIER_FALLBACK_IMAGES: Record<string, string> = {
  dana: "/images/products/dana/dana-haslamalik.webp",
  kuzu: "/images/products/kuzu/kuzu-but.webp",
  tavuk: "/images/products/tavuk/butun-tavuk.webp",
  sakatat: "/images/products/sakatat/iskembe.webp",
  mangal: "/images/products/mangal/izgara-kofte.webp",
  sarkuteri: "/images/products/sarkuteri/sucuk.webp",
  hazir: DEFAULT_PRODUCT_IMAGE,
  icecek: DEFAULT_PRODUCT_IMAGE,
  ekipman: DEFAULT_PRODUCT_IMAGE,
};
/** Ambiguous labels or industrial equipment: imported as drafts. */
export const SUPPLIER_DRAFT_SKUS = new Set(["032016075", "32016128"]);
export const LEGACY_DEMO_CATEGORIES = ["beef", "chicken", "lamb", "minced-meat", "family-boxes"];

const SOON = {
  tr: "Fiyat ve ayrıntılar netleşecek.",
  de: "Preis und Details folgen.",
  en: "Price and details to be confirmed.",
};

class DryRunRollback extends Error {}

export async function runCatalogImport(db: PrismaClient, opts: ImportOptions, dataDir = opts.dataDir ?? join(process.cwd(), "prisma/data")): Promise<ImportReport> {
  const report: ImportReport = {
    mode: opts.apply ? "apply" : "dry-run",
    categoriesCreated: [],
    created: { catalog: 0, supplier: 0, bundle: 0, preorder: 0 },
    existingUntouched: 0,
    skusLinked: 0,
    skusAlreadyLinked: 0,
    skuConflicts: [],
    problems: [],
    legacyDemoHidden: 0,
  };
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dataDir, f), "utf8")) as T;
  const catalog = read<CatalogFile>("catalog.json");
  const supplier = read<{ items: SupplierItem[] }>("kevser-articles.json").items;

  try {
    await db.$transaction(
      async (tx) => {
        const merchant = await tx.merchant.findFirst({ orderBy: { createdAt: "asc" } });
        if (!merchant) throw new Error("No merchant found. Run `npm run db:seed` (bootstrap) first.");
        const merchantId = merchant.id;

        const catIds = new Map((await tx.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
        const ensureCategory = async (slug: string, names: { tr: string; de: string; en: string }, sortOrder: number) => {
          if (catIds.has(slug)) return catIds.get(slug)!;
          const c = await tx.category.create({
            data: { slug, name: names.en, sortOrder, translations: { tr: { name: names.tr }, de: { name: names.de }, en: { name: names.en } } },
          });
          catIds.set(slug, c.id);
          report.categoriesCreated.push(slug);
          return c.id;
        };
        const slugExists = async (slug: string) => !!(await tx.product.findUnique({ where: { slug }, select: { id: true } }));

        // 1. Launch bundles first: some share a slug with a catalog.json entry and the bundle definition must win.
        // Create-only: confirmed contents and prices are never rewritten.
        const createdBundles: (typeof BUNDLES)[number][] = [];
        const bundleCat = await ensureCategory(BUNDLE_CATEGORY, { tr: "Et Paketleri", de: "Fleischpakete", en: "Meat Bundles" }, 26);
        for (const [i, b] of BUNDLES.entries()) {
          const existing = await tx.product.findUnique({ where: { slug: b.slug }, select: { id: true } });
          if (existing) { report.existingUntouched++; continue; }
          createdBundles.push(b);
          if (b.items.some((it) => !(it.grams > 0))) report.problems.push(`bundle ${b.slug}: component weights must be positive`);
          await tx.product.create({
            data: {
              merchantId, categoryId: bundleCat, slug: b.slug, name: b.name.en, description: b.description.en,
              bundleItems: b.items as unknown as Prisma.InputJsonValue,
              // PLACEHOLDER price until the butcher confirms it; bundle stays a draft.
              pricePerKgCents: b.priceCents, priceConfirmed: false, isAvailable: false, status: "DRAFT", isHidden: true,
              sellingUnit: "PACKAGE", stepGrams: BUNDLE_UNIT_GRAMS, minGrams: BUNDLE_UNIT_GRAMS, maxGrams: BUNDLE_UNIT_GRAMS * BUNDLE_MAX_PACKAGES,
              sortOrder: i,
              translations: Object.fromEntries((["de", "tr", "en"] as const).map((l) => [l, { name: b.name[l], description: b.description[l] }])),
              images: { create: { url: b.image, alt: "" } },
            },
          });
          report.created.bundle++;
        }

        // 2. Initial catalogue.
        for (const [i, c] of catalog.categories.entries()) await ensureCategory(c.slug, c, 20 + i);
        for (const [i, p] of catalog.products.entries()) {
          if (await slugExists(p.id)) { report.existingUntouched++; continue; }
          const categoryId = catIds.get(p.category);
          if (!categoryId) { report.problems.push(`catalog.json: ${p.id} has unknown category "${p.category}"`); continue; }
          const pack = p.unit === "package";
          const draft = p.status === "draft";
          await tx.product.create({
            data: {
              merchantId, categoryId, slug: p.id, name: p.name.en, description: SOON.en,
              pricePerKgCents: 0, priceConfirmed: false, // TODO confirm with Kevser: prices
              sellingUnit: pack ? "PACKAGE" : "KG",
              stepGrams: pack ? 1000 : 500, minGrams: pack ? 1000 : 500, maxGrams: 20000,
              isAvailable: false, status: draft ? "DRAFT" : "ACTIVE", isHidden: draft,
              sortOrder: 100 + i,
              translations: Object.fromEntries((["tr", "de", "en"] as const).map((l) => [l, { name: p.name[l], description: SOON[l] }])),
              images: { create: { url: p.image, alt: p.name.en } },
            },
          });
          report.created.catalog++;
        }

        // 3. Supplier articles: map to an existing product or create a draft-quality entry; SKUs go to SupplierArticle.
        for (const [slug, names] of Object.entries(SUPPLIER_CATEGORY_META)) await ensureCategory(slug, names, 30 + Object.keys(SUPPLIER_CATEGORY_META).indexOf(slug));
        for (const [i, a] of supplier.entries()) {
          const sku = normalizeSku(a.sku);
          if (!SUPPLIER_SKU_RE.test(sku)) { report.problems.push(`kevser-articles.json: invalid article number "${a.sku}"`); continue; }
          if (!catIds.has(a.category)) { report.problems.push(`kevser-articles.json: ${sku} has unknown category "${a.category}"`); continue; }
          let productId: string | undefined;
          if (a.existingSlug) {
            productId = (await tx.product.findUnique({ where: { slug: a.existingSlug }, select: { id: true } }))?.id;
            if (!productId) { report.problems.push(`kevser-articles.json: ${sku} maps to missing product "${a.existingSlug}"`); continue; }
          } else {
            const slug = `kevser-${sku}`;
            const existing = await tx.product.findUnique({ where: { slug }, select: { id: true } });
            if (existing) { productId = existing.id; report.existingUntouched++; }
            else {
              const draft = a.category === "ekipman" || SUPPLIER_DRAFT_SKUS.has(sku);
              const created = await tx.product.create({
                data: {
                  merchantId, categoryId: catIds.get(a.category)!, slug, name: a.en,
                  description: "Price, product details and availability to be confirmed by the butcher.",
                  pricePerKgCents: 0, priceConfirmed: false, stepGrams: 500, minGrams: 500, maxGrams: 20000,
                  isAvailable: false, status: draft ? "DRAFT" : "ACTIVE", isHidden: draft, sortOrder: 200 + i,
                  translations: {
                    en: { name: a.en, description: "Price and availability to be confirmed." },
                    de: { name: a.de, description: "Preis und Verfügbarkeit werden noch bestätigt." },
                    tr: { name: a.tr, description: "Fiyat ve stok durumu henüz doğrulanmadı." },
                  },
                  images: { create: { url: SUPPLIER_FALLBACK_IMAGES[a.category] ?? DEFAULT_PRODUCT_IMAGE, alt: a.de, isPlaceholder: true } },
                },
                select: { id: true },
              });
              productId = created.id;
              report.created.supplier++;
            }
          }
          const owner = await tx.supplierArticle.findUnique({ where: { merchantId_supplierSku: { merchantId, supplierSku: sku } } });
          if (owner?.productId === productId) { report.skusAlreadyLinked++; continue; }
          if (owner) {
            const other = await tx.product.findUnique({ where: { id: owner.productId }, select: { slug: true } });
            report.skuConflicts.push({ sku, wantedProduct: a.existingSlug ?? `kevser-${sku}`, mappedTo: other?.slug ?? owner.productId });
            continue;
          }
          await tx.supplierArticle.create({ data: { merchantId, productId, supplierSku: sku, originalName: a.de, source: "kevser-list" } });
          report.skusLinked++;
        }

        // Bundle components must exist (checked once every product above is in place).
        for (const b of createdBundles)
          for (const it of b.items)
            if (it.productSlug && !(await slugExists(it.productSlug))) report.problems.push(`bundle ${b.slug}: component product "${it.productSlug}" does not exist`);

        // 4. Preorder placeholders.
        const preorderCat = await ensureCategory("preorder", { tr: "Ön sipariş", de: "Vorbestellung", en: "Preorder" }, 99);
        const preorder = [
          { slug: "ramazan-kutusu", name: "Ramazan Kutusu", en: ["Ramadan Box", "Preorder: Ramadan box. Contents and price to be confirmed."], de: ["Ramadan-Box", "Vorbestellung: Ramadan-Box. Inhalt und Preis folgen."], tr: ["Ramazan Kutusu", "Ön sipariş: Ramazan kutusu. İçerik ve fiyat netleşecek."] },
          { slug: "kurban-hissesi", name: "Kurban Hissesi", en: ["Kurban Share", "Preorder: Kurban share. Details and price to be confirmed."], de: ["Kurban-Anteil", "Vorbestellung: Kurban-Anteil. Details und Preis folgen."], tr: ["Kurban Hissesi", "Ön sipariş: Kurban hissesi. Ayrıntılar ve fiyat netleşecek."] },
          { slug: "akika", name: "Akika", en: ["Aqiqah", "Preorder: Aqiqah. Details and price to be confirmed."], de: ["Aqiqa", "Vorbestellung: Aqiqa. Details und Preis folgen."], tr: ["Akika", "Ön sipariş: Akika. Ayrıntılar ve fiyat netleşecek."] },
        ];
        for (const [i, it] of preorder.entries()) {
          if (await slugExists(it.slug)) { report.existingUntouched++; continue; }
          await tx.product.create({
            data: {
              merchantId, categoryId: preorderCat, slug: it.slug, name: it.name, description: it.tr[1],
              pricePerKgCents: 0, priceConfirmed: false, sellingUnit: "PACKAGE", stepGrams: 1000, minGrams: 1000, maxGrams: 20000,
              isAvailable: false, status: "DRAFT", isHidden: true, preorderEligible: true, sortOrder: 90 + i,
              translations: Object.fromEntries((["en", "de", "tr"] as const).map((l) => [l, { name: it[l][0], description: it[l][1] }])),
            },
          });
          report.created.preorder++;
        }

        // 5. Explicit opt-in only.
        if (opts.hideLegacyDemo) {
          const r = await tx.product.updateMany({
            where: { status: "ACTIVE", OR: [{ category: { slug: { in: LEGACY_DEMO_CATEGORIES } } }, { slug: "ekonomik-paket", pricePerKgCents: 0 }] },
            data: { status: "DRAFT", isHidden: true, isAvailable: false },
          });
          report.legacyDemoHidden = r.count;
        }

        if (!opts.apply || report.problems.length) throw new DryRunRollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}

export function formatImportReport(r: ImportReport): string {
  const aborted = r.mode === "apply" && r.problems.length;
  const lines = [
    `Catalogue import (${r.mode}${aborted ? ", ABORTED: nothing written" : r.mode === "dry-run" ? ", nothing written" : ""})`,
    `  categories to create:   ${r.categoriesCreated.length ? r.categoriesCreated.join(", ") : "none"}`,
    `  products to create:     catalog ${r.created.catalog} · supplier ${r.created.supplier} · bundles ${r.created.bundle} · preorder ${r.created.preorder}`,
    `  existing (untouched):   ${r.existingUntouched}`,
    `  supplier SKUs to link:  ${r.skusLinked} (already linked: ${r.skusAlreadyLinked})`,
    `  legacy demo to hide:    ${r.legacyDemoHidden}`,
  ];
  if (r.skuConflicts.length) lines.push(`  SKU CONFLICTS (not changed, review manually):`, ...r.skuConflicts.map((c) => `    ${c.sku}: wanted ${c.wantedProduct}, already mapped to ${c.mappedTo}`));
  if (r.problems.length) lines.push(`  PROBLEMS:`, ...r.problems.map((p) => `    ${p}`));
  return lines.join("\n");
}
