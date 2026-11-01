import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PrismaClient();

// All prices are FICTIONAL demo values. Real pricing is set in Admin → Products.
const categories = [
  {
    slug: "beef",
    name: "Beef",
    de: "Rind",
    tr: "Dana",
    img: "/products/cat-beef.svg",
  },
  {
    slug: "chicken",
    name: "Chicken",
    de: "Hähnchen",
    tr: "Tavuk",
    img: "/products/cat-chicken.svg",
  },
  {
    slug: "lamb",
    name: "Lamb",
    de: "Lamm",
    tr: "Kuzu",
    img: "/products/cat-lamb.svg",
  },
  {
    slug: "minced-meat",
    name: "Minced Meat",
    de: "Hackfleisch",
    tr: "Kıyma",
    img: "/products/cat-mince.svg",
  },
  {
    slug: "family-boxes",
    name: "Family Boxes",
    de: "Familienboxen",
    tr: "Aile Kutuları",
    img: "/products/cat-box.svg",
  },
];

type P = {
  slug: string;
  cat: string;
  name: string;
  de: [string, string];
  tr: [string, string];
  desc: string;
  price: number;
  step: number;
  min: number;
  img: string;
  featured?: boolean;
};
// Photo (webp) where we have one, illustrated SVG fallback otherwise.
const photos: Record<string, string> = {
  "beef-cubes": "diced-beef",
  "ribeye-steak": "ribeye-steak",
  "beef-roast": "beef-roast",
  "osso-buco": "beef-bone-cuts",
  "beef-mince": "minced-beef",
  "chicken-drumsticks": "chicken-drumsticks",
  "chicken-breast": "chicken-breast",
  "lamb-chops": "lamb-chops",
};
const productImageUrl = (img: string) => (photos[img] ? `/products/${photos[img]}.webp` : `/products/${img}.svg`);

const products: P[] = [
  {
    slug: "premium-beef-cubes",
    cat: "beef",
    name: "Premium Beef Cubes",
    de: ["Premium Rindfleischwürfel", "Zartes Rindfleisch, ideal für Currys, Eintöpfe und Familiengerichte."],
    tr: ["Premium Dana Kuşbaşı", "Köri, güveç ve aile yemekleri için ideal, yumuşak dana eti."],
    desc: "Tender, juicy beef cubes, ideal for curries, stews and family meals.",
    price: 1499,
    step: 500,
    min: 500,
    img: "beef-cubes",
    featured: true,
  },
  {
    slug: "ribeye-steak",
    cat: "beef",
    name: "Ribeye Steak",
    de: ["Ribeye-Steak", "Gut marmoriertes Ribeye für Pfanne und Grill."],
    tr: ["Antrikot (Ribeye)", "Tava ve ızgara için iyi mermerli antrikot."],
    desc: "Well-marbled ribeye for the pan or grill.",
    price: 2499,
    step: 500,
    min: 500,
    img: "ribeye-steak",
    featured: true,
  },
  {
    slug: "sirloin-steak",
    cat: "beef",
    name: "Sirloin Steak",
    de: ["Sirloin-Steak", "Mageres, aromatisches Steak mit feinem Fettrand."],
    tr: ["Bonfile (Sirloin)", "İnce yağ kenarlı, aromalı biftek."],
    desc: "Lean, flavourful steak with a fine fat cap.",
    price: 2299,
    step: 500,
    min: 500,
    img: "sirloin-steak",
  },
  {
    slug: "beef-roast",
    cat: "beef",
    name: "Beef Roast",
    de: ["Rinderbraten", "Klassischer Braten für langsames Schmoren oder den Ofen."],
    tr: ["Dana Rosto", "Yavaş pişirme veya fırın için klasik rosto."],
    desc: "Classic roasting joint for slow cooking or the oven.",
    price: 1699,
    step: 500,
    min: 500,
    img: "beef-roast",
    featured: true,
  },
  {
    slug: "osso-buco-shank",
    cat: "beef",
    name: "Osso Buco (Shank)",
    de: ["Osso Buco (Beinscheibe)", "Beinscheiben mit Mark, perfekt zum Schmoren."],
    tr: ["Osso Buco (Incik)", "İliği ile birlikte, uzun pişirme için ideal incik."],
    desc: "Shank slices with marrow, perfect for braising.",
    price: 1399,
    step: 500,
    min: 500,
    img: "osso-buco",
    featured: true,
  },
  {
    slug: "beef-minced-lean",
    cat: "minced-meat",
    name: "Beef Minced (Lean)",
    de: ["Rinderhackfleisch (mager)", "Mageres Hackfleisch für Bolognese, Köfte und mehr."],
    tr: ["Dana Kıyma (Yağsız)", "Bolonez, köfte ve daha fazlası için yağsız kıyma."],
    desc: "Lean minced beef for bolognese, köfte and more.",
    price: 1299,
    step: 500,
    min: 500,
    img: "beef-mince",
    featured: true,
  },
  {
    slug: "lamb-minced",
    cat: "minced-meat",
    name: "Lamb Minced",
    de: ["Lammhackfleisch", "Aromatisches Lammhack für Kebab und Füllungen."],
    tr: ["Kuzu Kıyma", "Kebap ve iç harçlar için aromalı kuzu kıyma."],
    desc: "Flavourful minced lamb for kebabs and fillings.",
    price: 1899,
    step: 500,
    min: 500,
    img: "lamb-mince",
  },
  {
    slug: "chicken-drumsticks",
    cat: "chicken",
    name: "Chicken Drumsticks",
    de: ["Hähnchenkeulen", "Saftige Unterkeulen, perfekt für Ofen und Grill."],
    tr: ["Tavuk Baget", "Fırın ve ızgara için ideal sulu but."],
    desc: "Juicy drumsticks, perfect for the oven or grill.",
    price: 699,
    step: 500,
    min: 500,
    img: "chicken-drumsticks",
    featured: true,
  },
  {
    slug: "chicken-breast",
    cat: "chicken",
    name: "Chicken Breast",
    de: ["Hähnchenbrust", "Mageres Brustfilet, vielseitig einsetzbar."],
    tr: ["Tavuk Göğüs", "Çok yönlü kullanılan yağsız göğüs fileto."],
    desc: "Lean breast fillet, endlessly versatile.",
    price: 1099,
    step: 500,
    min: 500,
    img: "chicken-breast",
    featured: true,
  },
  {
    slug: "whole-chicken",
    cat: "chicken",
    name: "Whole Chicken",
    de: ["Ganzes Hähnchen", "Ganzes Hähnchen, küchenfertig vorbereitet."],
    tr: ["Bütün Tavuk", "Mutfağa hazır, bütün tavuk."],
    desc: "Whole chicken, ready for the kitchen.",
    price: 749,
    step: 500,
    min: 500,
    img: "whole-chicken",
  },
  {
    slug: "lamb-chops",
    cat: "lamb",
    name: "Lamb Chops",
    de: ["Lammkoteletts", "Zarte Lammkoteletts für Pfanne oder Grill."],
    tr: ["Kuzu Pirzola", "Tava veya ızgara için yumuşak kuzu pirzola."],
    desc: "Tender lamb chops for the pan or grill.",
    price: 2799,
    step: 500,
    min: 500,
    img: "lamb-chops",
    featured: true,
  },
  {
    slug: "lamb-shoulder",
    cat: "lamb",
    name: "Lamb Shoulder",
    de: ["Lammschulter", "Saftige Schulter, ideal zum langsamen Garen."],
    tr: ["Kuzu Kol", "Yavaş pişirme için ideal sulu kuzu kol."],
    desc: "Succulent shoulder, ideal for slow cooking.",
    price: 1999,
    step: 500,
    min: 500,
    img: "lamb-shoulder",
  },
  {
    slug: "lamb-cubes",
    cat: "lamb",
    name: "Lamb Cubes",
    de: ["Lammwürfel", "Würfel für Spieße, Eintöpfe und Reisgerichte."],
    tr: ["Kuzu Kuşbaşı", "Şiş, güveç ve pilav için kuşbaşı."],
    desc: "Cubes for skewers, stews and rice dishes.",
    price: 2199,
    step: 500,
    min: 500,
    img: "lamb-cubes",
  },
  {
    slug: "family-box-classic",
    cat: "family-boxes",
    name: "Family Box — Classic",
    de: ["Familienbox – Klassik", "Gemischte Auswahl aus Rind, Hähnchen und Hack, verkauft ab 5 kg. Genaue Zusammenstellung variiert."],
    tr: ["Aile Kutusu – Klasik", "Dana, tavuk ve kıyma karışık seçki, en az 5 kg’dan başlayarak satılır. Tam içerik değişebilir."],
    desc: "A mixed selection of beef, chicken and mince, sold from 5 kg. Exact contents may vary.",
    price: 1650,
    step: 1000,
    min: 5000,
    img: "family-box",
  },
];

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

  for (const [i, c] of categories.entries()) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        imageUrl: c.img,
        sortOrder: i,
        translations: { de: { name: c.de }, tr: { name: c.tr } },
      },
      create: {
        slug: c.slug,
        name: c.name,
        imageUrl: c.img,
        sortOrder: i,
        translations: { de: { name: c.de }, tr: { name: c.tr } },
      },
    });
  }

  for (const [i, p] of products.entries()) {
    const category = await db.category.findUniqueOrThrow({
      where: { slug: p.cat },
    });
    const data = {
      merchantId: merchant.id,
      categoryId: category.id,
      name: p.name,
      description: p.desc,
      pricePerKgCents: p.price,
      stepGrams: p.step,
      minGrams: p.min,
      maxGrams: 20000,
      isFeatured: !!p.featured,
      sortOrder: i,
      translations: {
        de: { name: p.de[0], description: p.de[1] },
        tr: { name: p.tr[0], description: p.tr[1] },
      },
    };
    const prod = await db.product.upsert({
      where: { slug: p.slug },
      update: data,
      create: { slug: p.slug, ...data },
    });
    await db.productImage.deleteMany({
      where: { productId: prod.id, data: null },
    });
    await db.productImage.create({
      data: { productId: prod.id, url: productImageUrl(p.img), alt: p.name },
    });
  }

  await seedCatalog(merchant.id);
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
      imageUrl: "/products/cat-box.svg",
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
    const p = await db.product.create({ data: { slug: it.slug, ...data } });
    await db.productImage.create({ data: { productId: p.id, url: "/products/cat-box.svg", alt: it.name } });
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
