import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createOrder } from "@/server/checkout";
import { expandBundle } from "@/server/bundle-expand";
import { AppError } from "@/server/errors";
import { cartView } from "@/server/cart-view";
import { listProducts, getProductBySlug } from "@/server/catalog";
import { BUNDLES } from "@/domain/bundles";
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

async function addComponents() {
  const cat = await db.category.create({ data: { slug: "meat", name: "Meat" } });
  const mk = (slug: string, price: number, over: Record<string, unknown> = {}) =>
    db.product.create({
      data: { merchantId: ctx.merchant.id, categoryId: cat.id, slug, name: slug, description: "d", pricePerKgCents: price, stepGrams: 500, minGrams: 500, maxGrams: 20000, ...over },
    });
  return Promise.all(["dana-kiyma", "dana-kusbasi", "dana-haslamalik", "kuzu-kusbasi", "tavuk-gogus", "tavuk-baget"].map((slug, i) => mk(slug, 1000 + i * 100)));
}

describe("bundles expand into ordinary lines", () => {
  it("expands to one line per component product at current prices, no bundle discount", async () => {
    await addComponents();
    const r = await expandBundle("aile-paketi");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundleId).toBe("aile-paketi");
    expect(r.lines.map((l) => [l.name, l.grams])).toEqual([
      ["dana-kiyma", 2000],
      ["dana-kusbasi", 1500],
      ["dana-haslamalik", 1000],
      ["kuzu-kusbasi", 1000],
      ["tavuk-gogus", 2000],
      ["tavuk-baget", 2000],
    ]);
    // 2*10.00 + 1.5*11.00 + 1*12.00 + 1*13.00 + 2*14.00 + 2*15.00
    expect(r.estimatedCents).toBe(2000 + 1650 + 1200 + 1300 + 2800 + 3000);
  });

  it("scales by packages and respects product step/min", async () => {
    await addComponents();
    await db.product.update({ where: { slug: "dana-kusbasi" }, data: { stepGrams: 1000, minGrams: 1000 } });
    const r = await expandBundle("aile-paketi", 1);
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines.find((l) => l.name === "dana-kusbasi")?.grams).toBe(2000); // 1500 rounded up to the 1000 step
  });

  it("is orderable only if every component is available", async () => {
    const comps = await addComponents();
    await db.product.update({ where: { id: comps[3].id }, data: { isAvailable: false } });
    expect(await expandBundle("aile-paketi")).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(await expandBundle("nope")).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("expanded lines order normally and are tagged with the bundle id", async () => {
    await addComponents();
    const r = await expandBundle("aile-paketi", 2); // €239 clears the €150 minimum
    if (!r.ok) throw new Error("expected ok");
    const { token } = await createOrder(checkoutBody(ctx, { lines: r.lines.map((l) => ({ productId: l.productId, grams: l.grams, bundleId: l.bundleId })) }));
    const order = await db.order.findUniqueOrThrow({ where: { publicToken: token }, include: { items: true } });
    expect(order.items).toHaveLength(6);
    expect(order.items.every((i) => i.bundleId === "aile-paketi")).toBe(true);
  });

  it("a package product itself can never be an order line", async () => {
    await addComponents();
    expect(await code(createOrder(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1000 }] })))).toBe("PRODUCT_UNAVAILABLE");
  });
});

describe("draft bundles (price not confirmed)", () => {
  it("are invisible in the storefront and cannot be ordered even if the flags are flipped", async () => {
    await db.product.update({ where: { id: family.id }, data: { status: "DRAFT", isHidden: true, isAvailable: false, priceConfirmed: false } });
    expect(await getProductBySlug("aile-paketi", "de")).toBeNull();
    expect((await listProducts("de", { category: "paketler" })).length).toBe(0);
    // Someone un-hides it without confirming the price: checkout must still refuse.
    await db.product.update({ where: { id: family.id }, data: { status: "ACTIVE", isHidden: false, isAvailable: true } });
    expect(await code(createOrder(checkoutBody(ctx, { lines: [{ productId: family.id, grams: 1000 }] })))).toBe("PRODUCT_UNAVAILABLE");
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
