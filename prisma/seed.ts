import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLES, BUNDLE_CATEGORY, BUNDLE_MAX_PACKAGES, BUNDLE_UNIT_GRAMS } from "../src/domain/bundles";

const db = new PrismaClient();

async function main() {
  const merchant =
    (await db.merchant.findFirst()) ??
    (await db.merchant.create({
      data: {
        name: "Kevser Fleischerei",
        addressLine: "Hermannstraße 64",
        postalCode: "12049",
        city: "Berlin",
      },
    }));
  await db.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: { merchantId: merchant.id },
  });

  await hideDemoCatalogue();
  await seedCatalog(merchant.id);
  await seedSupplierArticles(merchant.id);
  await seedBundles(merchant.id);
  await seedPreorderProducts(merchant.id);
  await seedDelivery(merchant.id);

  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (email && password.length >= 10) {
    await db.adminUser.upsert({
      where: { email },
      update: { passwordHash: await hash(password, 12) },
      create: { email, passwordHash: await hash(password, 12) },
    });
    console.log("Admin user ready:", email);
  } else console.log("Skipped admin user: set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars).");
}

// ---------------------------------------------------------------------------------------------
// Real catalogue from the asset bundle (prisma/data/catalog.json, images in public/images/products).
// No prices or halal claims were supplied: products start at price 0 and unavailable ("price coming soon").
// "active" bundle items are listed (unavailable); "draft" ones are hidden. The admin sets price + availability.
// Create-only: re-running never overwrites what the admin changed. TODO confirm with Kevser: prices, units, cuts, images.
// ---------------------------------------------------------------------------------------------
interface CatalogFile {
  categories: { slug: string; tr: string; de: string; en: string }[];
  products: {
    id: string;
    category: string;
    image: string;
    unit: string;
    status: "active" | "draft";
    name: Record<"tr" | "de" | "en", string>;
  }[];
}

// The early demo catalogue (illustrated placeholders, fictional prices) is not real stock: hide it. Rows stay because
// old orders reference them.
async function hideDemoCatalogue() {
  const slugs = ["beef", "chicken", "lamb", "minced-meat", "family-boxes"];
  const r = await db.product.updateMany({ where: { category: { slug: { in: slugs } } }, data: { isHidden: true, isAvailable: false } });
  console.log(`Demo catalogue hidden: ${r.count} products.`);
}

async function seedCatalog(merchantId: string) {
  const cat = JSON.parse(readFileSync(join(__dirname, "data/catalog.json"), "utf8")) as CatalogFile;
  const ids = new Map<string, string>();
  for (const [i, c] of cat.categories.entries()) {
    const row = await db.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: {
        slug: c.slug,
        name: c.en,
        sortOrder: 20 + i,
        translations: { tr: { name: c.tr }, de: { name: c.de }, en: { name: c.en } },
      },
    });
    ids.set(c.slug, row.id);
  }
  const soon = {
    tr: "Fiyat ve ayrıntılar netleşecek.",
    de: "Preis und Details folgen.",
    en: "Price and details to be confirmed.",
  };
  for (const [i, p] of cat.products.entries()) {
    if (await db.product.findUnique({ where: { slug: p.id } })) continue;
    const created = await db.product.create({
      data: {
        merchantId,
        categoryId: ids.get(p.category)!,
        slug: p.id,
        name: p.name.en,
        description: soon.en,
        pricePerKgCents: 0, // TODO confirm with Kevser
        stepGrams: 500, // TODO confirm with Kevser (package items: unit is "package", not kg)
        minGrams: p.unit === "package" ? 1000 : 500,
        maxGrams: 20000,
        isAvailable: false,
        isHidden: p.status === "draft",
        sortOrder: 100 + i,
        translations: Object.fromEntries((["tr", "de", "en"] as const).map((l) => [l, { name: p.name[l], description: soon[l] }])),
      },
    });
    await db.productImage.create({ data: { productId: created.id, url: p.image, alt: p.name.en } });
  }
  console.log(`Catalogue ready: ${cat.products.length} products (all unavailable until priced).`);
}

// ---------------------------------------------------------------------------------------------
// Supplier's printed article list (8 photos / 140 SKUs, prisma/data/kevser-articles.json).
// Preserve original SKUs, merge exact existing catalogue matches and create missing variants.
// Supplier list proves neither prices nor availability, so new food products are visible for
// discovery but cannot be ordered until a price and availability are set by the operator.
// Re-running only creates missing rows or appends SKU metadata; it never resets admin edits.
// ---------------------------------------------------------------------------------------------
interface SupplierArticle {
  sku: string;
  de: string;
  tr: string;
  en: string;
  category: string;
  existingSlug?: string;
}

const SUPPLIER_CATEGORY_META: Record<string, { tr: string; de: string; en: string }> = {
  hazir: { tr: "Hazır Ürünler", de: "Fertiggerichte", en: "Prepared Foods" },
  icecek: { tr: "İçecekler", de: "Getränke", en: "Drinks" },
  ekipman: { tr: "Ekipman", de: "Ausstattung", en: "Equipment" },
};

const SUPPLIER_FALLBACK_IMAGES: Record<string, string> = {
  dana: "/images/products/dana/dana-haslamalik.webp",
  kuzu: "/images/products/kuzu/kuzu-but.webp",
  tavuk: "/images/products/tavuk/butun-tavuk.webp",
  sakatat: "/images/products/sakatat/iskembe.webp",
  mangal: "/images/products/mangal/izgara-kofte.webp",
  sarkuteri: "/images/products/sarkuteri/sucuk.webp",
  hazir: "/images/products/default-product.svg",
  icecek: "/images/products/default-product.svg",
  ekipman: "/images/products/default-product.svg",
};

// Some source labels are ambiguous or refer to industrial equipment, not consumer food.
const SUPPLIER_HIDDEN_SKUS = new Set(["032016075", "32016128"]);

async function seedSupplierArticles(merchantId: string) {
  const source = JSON.parse(readFileSync(join(__dirname, "data/kevser-articles.json"), "utf8")) as {
    items: SupplierArticle[];
  };
  for (const [i, [slug, names]] of Object.entries(SUPPLIER_CATEGORY_META).entries()) {
    const c = await db.category.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: names.en,
        sortOrder: 30 + i,
        translations: Object.fromEntries(
          (["tr", "de", "en"] as const).map((locale) => [locale, { name: names[locale] }]),
        ),
      },
    });
  }
  const categories = await db.category.findMany({ select: { id: true, slug: true } });
  const categoryIds = new Map(categories.map((c) => [c.slug, c.id]));
  let created = 0;
  let linked = 0;
  for (const [i, a] of source.items.entries()) {
    const sku = a.sku.trim();
    const slug = `kevser-${sku}`;
    if (!/^\d{8,9}$/.test(sku)) throw new Error(`Unexpected supplier article number: ${sku}`);
    if (!categoryIds.has(a.category)) throw new Error(`Unknown supplier category: ${a.category}`);

    if (a.existingSlug) {
      const existing = await db.product.findUnique({ where: { slug: a.existingSlug } });
      if (!existing) throw new Error(`Missing mapped catalogue item: ${a.existingSlug}`);
      const current = (existing.translations && typeof existing.translations === "object" && !Array.isArray(existing.translations)
        ? existing.translations
        : {}) as Record<string, unknown>;
      const numbers = Array.isArray(current.supplierArticleNumbers)
        ? current.supplierArticleNumbers.filter((n): n is string => typeof n === "string")
        : [];
      if (!numbers.includes(sku)) {
        await db.product.update({
          where: { id: existing.id },
          data: { translations: { ...current, supplierArticleNumbers: [...numbers, sku] } as Prisma.InputJsonObject },
        });
      }
      linked++;
      continue;
    }

    if (await db.product.findUnique({ where: { slug } })) continue;
    const hidden = a.category === "ekipman" || SUPPLIER_HIDDEN_SKUS.has(sku);
    const image = SUPPLIER_FALLBACK_IMAGES[a.category] ?? "/images/products/default-product.svg";
    await db.product.create({
      data: {
        merchantId,
        categoryId: categoryIds.get(a.category)!,
        slug,
        name: a.en,
        description: "Price, product details and availability to be confirmed by the butcher.",
        pricePerKgCents: 0,
        stepGrams: 500,
        minGrams: 500,
        maxGrams: 20000,
        isAvailable: false,
        isHidden: hidden,
        sortOrder: 200 + i,
        translations: {
          en: { name: a.en, description: "Price and availability to be confirmed." },
          de: { name: a.de, description: "Preis und Verfügbarkeit werden noch bestätigt." },
          tr: { name: a.tr, description: "Fiyat ve stok durumu henüz doğrulanmadı." },
          supplierArticleNumbers: [sku],
          supplierOriginalName: a.de,
        },
        images: { create: { url: image, alt: a.de } },
      },
    });
    created++;
  }
  console.log(`Supplier catalogue: ${source.items.length} SKUs, ${linked} matched, ${created} newly seeded.`);
}

// ---------------------------------------------------------------------------------------------
// Fleischpakete: four fixed bundles in the existing "paketler" category (src/domain/bundles.ts).
// PRICES ARE PLACEHOLDERS until the butcher confirms them, so bundles are seeded as DRAFTS: hidden, unavailable,
// priceConfirmed=false. The admin confirms the price, then un-hides them (Admin → Products).
// Re-running refreshes contents/texts/images only; price, visibility and availability of an already
// confirmed bundle are never touched.
// ---------------------------------------------------------------------------------------------
async function seedBundles(merchantId: string) {
  const category = await db.category.upsert({
    where: { slug: BUNDLE_CATEGORY },
    update: { translations: { tr: { name: "Et Paketleri" }, de: { name: "Fleischpakete" }, en: { name: "Meat Bundles" } } },
    create: {
      slug: BUNDLE_CATEGORY,
      name: "Meat Bundles",
      sortOrder: 26,
      translations: { tr: { name: "Et Paketleri" }, de: { name: "Fleischpakete" }, en: { name: "Meat Bundles" } },
    },
  });
  for (const [i, b] of BUNDLES.entries()) {
    const existing = await db.product.findUnique({ where: { slug: b.slug } });
    const content = {
      merchantId,
      categoryId: category.id,
      name: b.name.en,
      description: b.description.en,
      bundleItems: b.items as unknown as object,
      stepGrams: BUNDLE_UNIT_GRAMS,
      minGrams: BUNDLE_UNIT_GRAMS,
      maxGrams: BUNDLE_UNIT_GRAMS * BUNDLE_MAX_PACKAGES,
      sortOrder: i,
      translations: Object.fromEntries((["de", "tr", "en"] as const).map((l) => [l, { name: b.name[l], description: b.description[l] }])),
    };
    // TODO confirm with Kevser: price, availability of every component, final contents.
    const draft = { pricePerKgCents: b.priceCents, isAvailable: false, isHidden: true, priceConfirmed: false };
    const prod = existing
      ? await db.product.update({ where: { id: existing.id }, data: existing.priceConfirmed && existing.bundleItems ? content : { ...content, ...draft } })
      : await db.product.create({ data: { slug: b.slug, ...content, ...draft } });
    await db.productImage.deleteMany({ where: { productId: prod.id, data: null } });
    await db.productImage.create({ data: { productId: prod.id, url: b.image, alt: "" } });
  }
  // Legacy placeholder "Sparpaket": never part of the four launch bundles, no price. Keep it out of the storefront.
  await db.product.updateMany({ where: { slug: "ekonomik-paket", pricePerKgCents: 0 }, data: { isHidden: true } });
  console.log(`Bundles ready: ${BUNDLES.length} Fleischpakete (drafts until prices are confirmed).`);
}

// ---------------------------------------------------------------------------------------------
// Preorder products (hidden + unavailable until Kevser confirms; admin activates them).
// ---------------------------------------------------------------------------------------------
async function seedPreorderProducts(merchantId: string) {
  const cat = await db.category.upsert({
    where: { slug: "preorder" },
    update: {},
    create: {
      slug: "preorder",
      name: "Preorder",
      sortOrder: 99,
      translations: { de: { name: "Vorbestellung" }, tr: { name: "Ön sipariş" } },
    },
  });
  // TODO confirm with Kevser: prices, units (per-kg pricing may not fit boxes/shares), contents, availability dates.
  const items = [
    {
      slug: "ramazan-kutusu",
      name: "Ramazan Kutusu",
      en: ["Ramadan Box", "Preorder: Ramadan box. Contents and price to be confirmed."],
      de: ["Ramadan-Box", "Vorbestellung: Ramadan-Box. Inhalt und Preis folgen."],
      tr: ["Ramazan Kutusu", "Ön sipariş: Ramazan kutusu. İçerik ve fiyat netleşecek."],
    },
    {
      slug: "kurban-hissesi",
      name: "Kurban Hissesi",
      en: ["Kurban Share", "Preorder: Kurban share. Details and price to be confirmed."],
      de: ["Kurban-Anteil", "Vorbestellung: Kurban-Anteil. Details und Preis folgen."],
      tr: ["Kurban Hissesi", "Ön sipariş: Kurban hissesi. Ayrıntılar ve fiyat netleşecek."],
    },
    {
      slug: "akika",
      name: "Akika",
      en: ["Aqiqah", "Preorder: Aqiqah. Details and price to be confirmed."],
      de: ["Aqiqa", "Vorbestellung: Aqiqa. Details und Preis folgen."],
      tr: ["Akika", "Ön sipariş: Akika. Ayrıntılar ve fiyat netleşecek."],
    },
  ];
  for (const [i, it] of items.entries()) {
    const data = {
      merchantId,
      categoryId: cat.id,
      name: it.name,
      description: it.tr[1],
      pricePerKgCents: 0, // TODO confirm with Kevser: price. Hidden + unavailable, so it cannot be bought at 0.
      stepGrams: 1000,
      minGrams: 1000,
      maxGrams: 20000,
      isAvailable: false,
      isHidden: true,
      preorderEligible: true,
      sortOrder: 90 + i,
      translations: {
        en: { name: it.en[0], description: it.en[1] },
        de: { name: it.de[0], description: it.de[1] },
        tr: { name: it.tr[0], description: it.tr[1] },
      },
    };
    // Never overwrite what the admin has since changed (price, visibility): create only.
    const existing = await db.product.findUnique({ where: { slug: it.slug } });
    if (existing) continue;
    await db.product.create({ data: { slug: it.slug, ...data } });
  }
}

// ---------------------------------------------------------------------------------------------
// Delivery zones. Every value below is a PLACEHOLDER from the brief.
// Postcodes come from prisma/data/postcodes.verified.json (scripts/verify-postcodes.ts, OpenPLZ).
// ---------------------------------------------------------------------------------------------
interface VerifiedPostcodes {
  berlin: string[];
  verified: { zone: 2 | 3; route: string; postcode: string }[];
}

async function seedDelivery(merchantId: string) {
  // Re-running the seed must never clobber admin-managed delivery config: only (re)build when no routes exist
  // yet (fresh DB, or right after the v2 migration), or when forced.
  if ((await db.deliveryRoute.count()) > 0 && process.env.SEED_RESET_DELIVERY !== "1") {
    console.log("Delivery config exists; skipping (set SEED_RESET_DELIVERY=1 to rebuild the demo zones).");
    return;
  }
  // Zones referenced by existing orders are kept (their orders carry a full snapshot) but are never matched again.
  await db.deliveryZone.updateMany({ where: { merchantId }, data: { isActive: false } });
  await db.deliveryZone.deleteMany({ where: { merchantId, orders: { none: {} } } });
  await db.deliveryBlackoutDate.deleteMany({ where: { merchantId } });

  const data = JSON.parse(readFileSync(join(__dirname, "data/postcodes.verified.json"), "utf8")) as VerifiedPostcodes;
  const assigned = new Set<string>();

  const mkZone = (d: {
    name: string;
    mode: "REGULAR" | "PREORDER_ONLY";
    minOrderCents: number;
    deliveryFeeCents: number;
    freeDeliveryThresholdCents: number | null;
    sortOrder: number;
  }) => db.deliveryZone.create({ data: { merchantId, ...d } });
  const mkRoute = async (
    zoneId: string,
    name: string,
    schedules: {
      weekday: number;
      kind?: "WEEKLY" | "NTH_WEEKDAY_OF_MONTH";
      nth?: number;
      windowStart: string;
      windowEnd: string;
      cutoffHoursBefore: number;
    }[],
  ) => db.deliveryRoute.create({ data: { zoneId, name, schedules: { create: schedules } } });
  const assign = async (routeId: string, postcodes: string[]) => {
    // Explicit assignments made earlier win; later (broader) lists never steal a postcode.
    const fresh = postcodes.filter((p) => !assigned.has(p));
    fresh.forEach((p) => assigned.add(p));
    await db.postcodeRoute.createMany({ data: fresh.map((postcode) => ({ postcode, routeId })) });
  };
  const verified = (zone: 2 | 3, route: string) => data.verified.filter((v) => v.zone === zone && v.route === route).map((v) => v.postcode);

  // Zone 2 + 3 first, so their explicit postcodes win any overlap with Berlin.
  // TODO confirm with Kevser: min order €150, fee €0, Tuesday/Thursday 14:00–18:00, 48h cutoff.
  const z2 = await mkZone({
    name: "Berlin suburbs",
    mode: "REGULAR",
    minOrderCents: 15000,
    deliveryFeeCents: 0,
    freeDeliveryThresholdCents: null,
    sortOrder: 2,
  });
  const west = await mkRoute(z2.id, "West", [{ weekday: 2, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 48 }]);
  const northEast = await mkRoute(z2.id, "North/East", [{ weekday: 4, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 48 }]);
  await assign(west.id, verified(2, "West"));
  await assign(northEast.id, verified(2, "North/East"));

  // TODO confirm with Kevser: min order €300, fee €0, first Saturday of the month 14:00–18:00, 7-day cutoff.
  const z3 = await mkZone({
    name: "Far Brandenburg",
    mode: "PREORDER_ONLY",
    minOrderCents: 30000,
    deliveryFeeCents: 0,
    freeDeliveryThresholdCents: null,
    sortOrder: 3,
  });
  const far = await mkRoute(z3.id, "Far Brandenburg", [
    { kind: "NTH_WEEKDAY_OF_MONTH", nth: 1, weekday: 6, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 7 * 24 },
  ]);
  await assign(far.id, verified(3, "Far Brandenburg"));

  // TODO confirm with Kevser: min €60, fee €4.90, free from €120, Mon–Sat 14:00–18:00, 24h cutoff.
  const z1 = await mkZone({
    name: "Berlin",
    mode: "REGULAR",
    minOrderCents: 6000,
    deliveryFeeCents: 490,
    freeDeliveryThresholdCents: 12000,
    sortOrder: 1,
  });
  const berlin = await mkRoute(
    z1.id,
    "Berlin",
    [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 24 })),
  );
  await assign(berlin.id, data.berlin);
  console.log(`Delivery zones seeded: ${assigned.size} postcodes.`);
}

main().finally(() => db.$disconnect());
