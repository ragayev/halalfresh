import { PrismaClient } from "@prisma/client";

/**
 * Deterministic priced products for the storefront journeys. The production importer deliberately creates nothing
 * priced or available, so the e2e suite builds its own (these are test rows, created through the same columns the
 * admin uses; they are never part of the real catalogue).
 */
export async function seedE2eProducts(url: string) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const merchant = await db.merchant.findFirstOrThrow();
    const cat = (slug: string, name: string, sortOrder: number) =>
      db.category.upsert({ where: { slug }, update: {}, create: { slug, name, sortOrder, translations: { tr: { name }, de: { name } } } });
    const lamb = await cat("lamb", "Lamb", 1);
    const beef = await cat("beef", "Beef", 2);
    const make = (categoryId: string, slug: string, name: string, de: string, tr: string, priceCents: number, sortOrder: number) =>
      db.product.create({
        data: {
          merchantId: merchant.id, categoryId, slug, name, description: `${name} for tests`, pricePerKgCents: priceCents,
          priceConfirmed: true, isAvailable: true, status: "ACTIVE", isHidden: false, sortOrder, stepGrams: 500, minGrams: 500, maxGrams: 20000,
          translations: { en: { name, description: `${name} for tests` }, de: { name: de, description: de }, tr: { name: tr, description: tr } },
          images: { create: { url: "/images/products/default-product.svg", alt: name, isPlaceholder: true } },
        },
      });
    await make(lamb.id, "lamb-chops", "Lamb Chops", "Lammkoteletts", "Kuzu Pirzola", 2799, 1);
    await make(lamb.id, "lamb-shoulder", "Lamb Shoulder", "Lammschulter", "Kuzu Kol", 2199, 2);
    await make(lamb.id, "lamb-leg", "Lamb Leg", "Lammkeule", "Kuzu But", 2399, 3);
    await make(beef.id, "beef-cubes", "Premium Beef Cubes", "Rindergulasch", "Dana Kuşbaşı", 1499, 1);
  } finally {
    await db.$disconnect();
  }
}
