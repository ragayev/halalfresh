import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createCheckout } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { prepareWhatsapp } from "@/server/orders";
import { cartView } from "@/server/cart-view";
import { listProducts, getProductBySlug } from "@/server/catalog";
import { BUNDLES, snapshotBundle } from "@/domain/bundles";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
let family: { id: string };

async function addBundle(over: Record<string, unknown> = {}) {
  const cat = await db.category.create({ data: { slug: "paketler", name: "Meat Bundles", translations: { de: { name: "Fleischpakete" } } } });
  const b = BUNDLES[0];
  return db.product.create({
    data: {
      merchantId: ctx.merchant.id,
      categoryId: cat.id,
      slug: b.slug,
      name: b.name.en,
      description: b.description.en,
      translations: { de: { name: b.name.de, description: b.description.de } },
      pricePerKgCents: b.priceCents,
      stepGrams: 1000,
      minGrams: 1000,
      maxGrams: 5000,
      bundleItems: b.items as unknown as object,
      ...over,
    },
  });
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : String(e)),
  );

beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
  family = await addBundle();
});

describe("bundles in checkout", () => {
  it("prices a bundle server-side and counts it toward the €150 minimum", async () => {
    const { orderToken } = await createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1000 }] }));
    const order = await db.order.findUniqueOrThrow({ where: { accessToken: orderToken }, include: { items: true } });
    expect(order.subtotalCents).toBe(15990);
    expect(order.items[0]).toMatchObject({ productName: "Family Bundle", quantityGrams: 1000, lineTotalCents: 15990 });
  });

  it("supports several bundles next to regular products", async () => {
    const { orderToken } = await createCheckout(
      checkoutBody(ctx, {
        lines: [
          { productId: family.id, grams: 2000 },
          { productId: ctx.beef.id, grams: 1500 },
        ],
      }),
    );
    const order = await db.order.findUniqueOrThrow({ where: { accessToken: orderToken }, include: { items: true } });
    expect(order.subtotalCents).toBe(2 * 15990 + 3000);
    const reg = order.items.find((i) => i.productSlug === "beef-cubes")!;
    expect(reg.bundleSnapshot).toBeNull();
  });

  it("rejects fractional package quantities and over-max quantities", async () => {
    expect(await code(createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1500 }] })))).toBe("INVALID_QUANTITY");
    expect(await code(createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 6000 }] })))).toBe("INVALID_QUANTITY");
  });

  it("freezes the contents in the order: later catalogue edits do not change history", async () => {
    const { orderToken } = await createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1000 }] }));
    await db.product.update({
      where: { id: family.id },
      data: { pricePerKgCents: 99999, bundleItems: [{ grams: 500, names: { de: "Nur Test", tr: "t", en: "t" } }] },
    });
    const order = await db.order.findUniqueOrThrow({ where: { accessToken: orderToken }, include: { items: true } });
    expect(order.items[0].bundleSnapshot).toEqual(JSON.parse(JSON.stringify(snapshotBundle(BUNDLES[0].items))));
    expect(order.items[0].lineTotalCents).toBe(15990);
  });

  it("puts the bundle breakdown into the butcher WhatsApp message", async () => {
    const { orderToken } = await createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 2000 }] }));
    const order = await db.order.findUniqueOrThrow({ where: { accessToken: orderToken } });
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
    const { message } = await prepareWhatsapp(order.id, "admin@test");
    expect(message).toContain("- Family Bundle — 2× (19 kg)");
    expect(message).toContain("· Rinderhackfleisch: 4 kg");
    expect(message).toContain("· Hähnchenunterkeule: 4 kg");
  });
});

describe("draft bundles (price not confirmed)", () => {
  it("are invisible in the storefront and cannot be ordered even if the flags are flipped", async () => {
    await db.product.update({ where: { id: family.id }, data: { status: "DRAFT", isHidden: true, isAvailable: false, priceConfirmed: false } });
    expect(await getProductBySlug("aile-paketi", "de")).toBeNull();
    expect((await listProducts("de", { category: "paketler" })).length).toBe(0);
    // Someone un-hides it without confirming the price: checkout must still refuse.
    await db.product.update({ where: { id: family.id }, data: { status: "ACTIVE", isHidden: false, isAvailable: true } });
    expect(await code(createCheckout(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1000 }] })))).toBe("PRODUCT_UNAVAILABLE");
    const view = await cartView([{ productId: family.id, grams: 1000 }], "de");
    expect(view.lines[0].issue).toBe("UNAVAILABLE");
    expect(view.totals.subtotalCents).toBe(0);
  });

  it("go live once confirmed and expose localized contents", async () => {
    const p = await getProductBySlug("aile-paketi", "de");
    expect(p?.name).toBe("Familienpaket");
    expect(p?.categoryName).toBe("Fleischpakete");
    expect(p?.bundle?.totalGrams).toBe(9500);
    expect(p?.bundle?.items[0]).toEqual({ name: "Rinderhackfleisch", grams: 2000 });
    // No image rows: the view falls back to the generic placeholder and says so.
    expect(p?.images).toEqual([{ src: "/images/products/default-product.svg", alt: "Familienpaket", placeholder: true }]);
  });
});
