import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

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
      data: { name: "Partner Butcher (configure in Admin)" },
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

  if (!(await db.deliveryZone.findFirst({ where: { merchantId: merchant.id } }))) {
    const zone = await db.deliveryZone.create({
      data: {
        merchantId: merchant.id,
        name: "Berlin (demo coverage — review before launch)",
      },
    });
    for (const pattern of ["10*", "12*", "13*", "141*"]) await db.deliveryPostcode.create({ data: { zoneId: zone.id, pattern } });
    for (const [weekday, startTime, endTime] of [
      [3, "16:00", "20:00"],
      [5, "16:00", "20:00"],
      [6, "10:00", "14:00"],
      [6, "14:00", "18:00"],
    ] as const) {
      await db.deliverySlot.create({
        data: { zoneId: zone.id, weekday, startTime, endTime },
      });
    }
  }

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

main().finally(() => db.$disconnect());
