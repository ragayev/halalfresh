import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createOrder } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { cartView } from "@/server/cart-view";
import { getProductBySlug as storefrontBySlug, listProducts as storefrontList } from "@/server/catalog";
import {
  addSupplierSku, archiveProduct, createProduct, getCatalogStats, getProductBySupplierSku, listProducts, parseSkuList,
  publishProduct, setAvailability, setSupplierSkus, updatePrice, updateProduct, type ProductInput,
} from "@/server/product-service";
import { runCatalogImport } from "@/server/catalog-import";
import { runCatalogAudit } from "@/server/catalog-audit";
import { applyCsvImport, exportProductsCsv, planCsvImport } from "@/server/catalog-csv";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
let categoryId: string;

const input = (over: Partial<ProductInput> = {}): ProductInput => ({
  name: "Veal Cutlet", slug: "veal-cutlet", description: "d", categoryId, priceCents: 2500, priceConfirmed: true,
  sellingUnit: "KG", stepGrams: 500, minGrams: 1000, maxGrams: 20000, isFeatured: false, isAvailable: true,
  preorderEligible: false, status: "ACTIVE", ...over,
});
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
  categoryId = ctx.beef.categoryId;
});

describe("product service", () => {
  it("creates, edits and archives a product with an audit trail", async () => {
    const p = await createProduct(input(), "admin@test");
    expect(p).toMatchObject({ status: "ACTIVE", isHidden: false, sellingUnit: "KG" });
    const edited = await updateProduct(p.id, input({ name: "Veal Cutlet XL", priceCents: 2700 }), "admin@test");
    expect(edited).toMatchObject({ id: p.id, name: "Veal Cutlet XL", pricePerKgCents: 2700 });
    const archived = await archiveProduct(p.id, "admin@test");
    expect(archived).toMatchObject({ status: "ARCHIVED", isHidden: true, isAvailable: false });
    const log = await db.auditLog.findMany({ where: { entityId: p.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["product.create", "product.update", "product.status.archived"]);
    expect(JSON.stringify(log[1].detail)).toContain("pricePerKgCents");
  });

  it("keeps status and the legacy isHidden flag in agreement, down to the database", async () => {
    const p = await createProduct(input({ status: "DRAFT", isAvailable: false }), "a");
    expect(p.isHidden).toBe(true);
    expect((await publishProduct(p.id, "a")).isHidden).toBe(false);
    await expect(db.product.update({ where: { id: p.id }, data: { isHidden: true } })).rejects.toThrow();
  });

  it("refuses contradictory states", async () => {
    const d = await createProduct(input({ status: "DRAFT", isAvailable: false, priceCents: 0, priceConfirmed: false }), "a");
    expect(await code(setAvailability(d.id, true, "a"))).toBe("VALIDATION");
    expect(await code(updatePrice(d.id, 0, true, "a"))).toBe("VALIDATION");
    expect(await code(createProduct(input({ slug: "x1", priceCents: 0, priceConfirmed: true }), "a"))).toBe("VALIDATION");
    const arch = await archiveProduct(d.id, "a");
    expect(await code(publishProduct(arch.id, "a"))).toBe("VALIDATION");
    expect(await code(createProduct(input({ slug: "x2", sellingUnit: "PACKAGE", stepGrams: 500 }), "a"))).toBe("VALIDATION");
  });

  it("taking the price away takes the product off sale", async () => {
    const p = await createProduct(input(), "a");
    expect((await updatePrice(p.id, 2500, false, "a")).isAvailable).toBe(false);
  });

  it("rejects a duplicate slug", async () => {
    await createProduct(input(), "a");
    expect(await code(createProduct(input(), "a"))).toBe("CONFLICT");
  });

  it("lists, filters and searches by supplier SKU", async () => {
    const a = await createProduct(input(), "a");
    const b = await createProduct(input({ name: "Lamb Neck", slug: "lamb-neck", status: "DRAFT", isAvailable: false, priceCents: 0, priceConfirmed: false }), "a");
    await addSupplierSku(a.id, "032016999", "a");
    await addSupplierSku(a.id, "032016998", "a");
    expect((await listProducts({ sku: "99" })).total).toBe(1);
    expect((await listProducts({ sku: "032016999" })).rows[0].id).toBe(a.id);
    expect((await listProducts({ status: "DRAFT" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await listProducts({ missingPrice: true })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await listProducts({ missingImage: true })).total).toBe(4); // none of the four products has an image
    expect((await listProducts({ availability: "unavailable" })).rows.map((r) => r.slug).sort()).toEqual(["gone", "lamb-neck"]);
    expect((await listProducts({ q: "lamb" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await listProducts({ category: "beef" })).total).toBe(4);
    expect((await listProducts({}, 2, 2)).rows).toHaveLength(2);
    expect((await getProductBySupplierSku("032016998"))?.id).toBe(a.id);
    const stats = await getCatalogStats();
    expect(stats).toMatchObject({ total: 4, published: 3, draft: 1, archived: 0, missingPrice: 1 });
  });

  it("never lets one supplier SKU belong to two products", async () => {
    const a = await createProduct(input(), "a");
    const b = await createProduct(input({ slug: "other", name: "Other" }), "a");
    await addSupplierSku(a.id, "ABC-1001", "a");
    await addSupplierSku(a.id, "ABC-1001", "a"); // idempotent for the same product
    expect(await code(addSupplierSku(b.id, "ABC-1001", "a"))).toBe("CONFLICT");
    expect(await code(setSupplierSkus(b.id, ["ZZZ-1", "ABC-1001"], "a"))).toBe("CONFLICT");
    expect(await db.supplierArticle.count({ where: { productId: b.id } })).toBe(0); // all-or-nothing
    await expect(
      db.supplierArticle.create({ data: { merchantId: a.merchantId, productId: b.id, supplierSku: "ABC-1001" } }),
    ).rejects.toThrow(); // and the database enforces it too
    expect(() => parseSkuList("ABC-1, ABC-1")).toThrow(/Duplicate/);
    expect(() => parseSkuList("a b!")).toThrow(/Invalid/);
    expect(await code(addSupplierSku(a.id, "x", "a"))).toBe("VALIDATION");
  });

  it("preserves legacy supplier metadata and other-locale data on edit", async () => {
    const p = await createProduct(input({ translations: { de: { name: "Kalbsschnitzel", description: "dd" } } }), "a");
    await db.product.update({ where: { id: p.id }, data: { translations: { ...(p.translations as object), tr: { name: "Dana" }, extra: { keep: true } } } });
    const after = await updateProduct(p.id, input({ translations: { de: { name: "Kalbsschnitzel 2" } } }), "a");
    const tr = after.translations as Record<string, Record<string, unknown>>;
    expect(tr.de.name).toBe("Kalbsschnitzel 2");
    expect(tr.de.description).toBe("dd");
    expect(tr.tr.name).toBe("Dana");
    expect(tr.extra.keep).toBe(true);
  });

  it("validates bundle components exist", async () => {
    const items = [{ grams: 1000, names: { de: "a", tr: "a", en: "a" }, productSlug: "nope" }];
    expect(await code(createProduct(input({ slug: "bun", sellingUnit: "PACKAGE", stepGrams: 1000, bundleItems: items }), "a"))).toBe("VALIDATION");
    const ok = [{ grams: 1000, names: { de: "a", tr: "a", en: "a" }, productSlug: "beef-cubes" }];
    const b = await createProduct(input({ slug: "bun", sellingUnit: "PACKAGE", stepGrams: 1000, bundleItems: ok }), "a");
    expect(b.bundleItems).not.toBeNull();
    expect(await code(createProduct(input({ slug: "bun2", sellingUnit: "PACKAGE", stepGrams: 1000, priceConfirmed: false, isAvailable: false, bundleItems: ok }), "a"))).toBe("VALIDATION"); // active + unconfirmed
  });
});

describe("storefront and checkout enforce the same rules on the server", () => {
  it("lists only published products and treats others as not found", async () => {
    const draft = await createProduct(input({ status: "DRAFT", isAvailable: false }), "a");
    expect(await storefrontBySlug(draft.slug, "en")).toBeNull();
    expect((await storefrontList("en")).map((p) => p.slug)).not.toContain(draft.slug);
    await publishProduct(draft.id, "a");
    expect((await storefrontBySlug(draft.slug, "en"))?.purchasable).toBe(false); // listed, but not available yet
    await setAvailability(draft.id, true, "a");
    expect((await storefrontBySlug(draft.slug, "en"))?.purchasable).toBe(true);
  });

  it("refuses archived, draft, unavailable and unpriced products at checkout", async () => {
    const mk = (slug: string, o: Partial<ProductInput>) => createProduct(input({ slug, name: slug, ...o }), "a");
    const archived = await mk("arch", {});
    await archiveProduct(archived.id, "a");
    const draft = await mk("dr", { status: "DRAFT" });
    const unavailable = await mk("un", { isAvailable: false });
    const unpriced = await mk("np", {});
    // Corrupt the row the way a bad script could: available + active but price 0.
    await db.product.update({ where: { id: unpriced.id }, data: { pricePerKgCents: 0 } });
    for (const p of [archived, draft, unavailable, unpriced]) {
      expect(await code(createOrder(checkoutBody(ctx, { lines: [{ productId: p.id, grams: 8000 }] })))).toBe("PRODUCT_UNAVAILABLE");
      const view = await cartView([{ productId: p.id, grams: 8000 }], "en");
      expect(view.lines[0].issue).toBeDefined();
      expect(view.totals.subtotalCents).toBe(0);
    }
  });

  it("prices from the database, never from the client, and keeps orders intact after archiving", async () => {
    const { token: orderToken } = await createOrder(checkoutBody(ctx, { lines: [{ productId: ctx.beef.id, grams: 8000 }], unitPriceCents: 1 }));
    const order = await db.order.findUniqueOrThrow({ where: { publicToken: orderToken }, include: { items: true } });
    expect(order.estimatedTotalCents).toBe(16000);
    await archiveProduct(ctx.beef.id, "a");
    await updatePrice(ctx.beef.id, 99999, true, "a");
    const again = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(again.items[0]).toMatchObject({ productId: ctx.beef.id, productName: "Beef Cubes", estimatedCents: 16000, requestedGrams: 8000 });
    expect(again.estimatedTotalCents).toBe(16000);
  });

  it("calculates mixed unit carts with integer cents", async () => {
    const pkg = await createProduct(input({ slug: "box", name: "Box", sellingUnit: "PACKAGE", stepGrams: 1000, minGrams: 1000, maxGrams: 5000, priceCents: 9999 }), "a");
    const view = await cartView([{ productId: pkg.id, grams: 2000 }, { productId: ctx.beef.id, grams: 1500 }], "en");
    expect(view.lines.map((l) => l.lineTotalCents)).toEqual([19998, 3000]);
    expect(await code(createOrder(checkoutBody(ctx, { lines: [{ productId: pkg.id, grams: 1500 }] })))).not.toBe("ok");
  });
});

describe("legacy catalogue import", () => {
  it("dry-run writes nothing; apply creates; re-running is a no-op", async () => {
    const dry = await runCatalogImport(db, { apply: false });
    expect(dry.mode).toBe("dry-run");
    expect(dry.problems).toEqual([]);
    expect(dry.skuConflicts).toEqual([]);
    expect(await db.supplierArticle.count()).toBe(0);
    expect(await db.product.count()).toBe(2); // only the two seedBasics products

    const first = await runCatalogImport(db, { apply: true });
    expect(first.created).toEqual(dry.created);
    expect(first.created.supplier + first.created.catalog + first.created.bundle + first.created.preorder).toBeGreaterThan(150);
    expect(await db.supplierArticle.count()).toBe(140);
    const total = await db.product.count();

    const second = await runCatalogImport(db, { apply: true });
    expect(second.created).toEqual({ catalog: 0, supplier: 0, bundle: 0, preorder: 0 });
    expect(second.skusLinked).toBe(0);
    expect(await db.product.count()).toBe(total);
    expect(await db.supplierArticle.count()).toBe(140);
  });

  it("never overwrites admin-managed content, prices, images, visibility, SKUs or bundle contents", async () => {
    await runCatalogImport(db, { apply: true });
    const kiyma = await db.product.findUniqueOrThrow({ where: { slug: "dana-kiyma" }, include: { supplierArticles: true } });
    await updateProduct(kiyma.id, input({ slug: "dana-kiyma", name: "Beef Mince (edited)", categoryId: kiyma.categoryId, priceCents: 1899, status: "ACTIVE", isAvailable: true }), "admin");
    await db.productImage.deleteMany({ where: { productId: kiyma.id } });
    await db.productImage.create({ data: { productId: kiyma.id, data: Buffer.from("x"), mimeType: "image/png", alt: "upload" } });
    await addSupplierSku(kiyma.id, "ADMIN-ADDED-1", "admin");
    const bundle = await db.product.findUniqueOrThrow({ where: { slug: BUNDLE_SLUG } });
    await db.product.update({ where: { id: bundle.id }, data: { pricePerKgCents: 17777, priceConfirmed: true, bundleItems: [{ grams: 1234, names: { de: "x", tr: "x", en: "x" } }] } });

    await runCatalogImport(db, { apply: true });

    const after = await db.product.findUniqueOrThrow({ where: { id: kiyma.id }, include: { images: true, supplierArticles: true } });
    expect(after).toMatchObject({ name: "Beef Mince (edited)", pricePerKgCents: 1899, isAvailable: true, status: "ACTIVE" });
    expect(after.images.map((i) => i.url)).toEqual([null]);
    expect(after.supplierArticles.map((s) => s.supplierSku)).toContain("ADMIN-ADDED-1");
    const b = await db.product.findUniqueOrThrow({ where: { id: bundle.id } });
    expect(b).toMatchObject({ pricePerKgCents: 17777, priceConfirmed: true });
    expect(b.bundleItems).toEqual([{ grams: 1234, names: { de: "x", tr: "x", en: "x" } }]);
  });

  it("reports a SKU already mapped elsewhere instead of moving it", async () => {
    await runCatalogImport(db, { apply: true });
    const sa = await db.supplierArticle.findUniqueOrThrow({ where: { merchantId_supplierSku: { merchantId: ctx.merchant.id, supplierSku: "032016001" } } });
    await db.supplierArticle.update({ where: { id: sa.id }, data: { productId: ctx.beef.id } });
    const r = await runCatalogImport(db, { apply: true });
    expect(r.skuConflicts.map((c) => c.sku)).toContain("032016001");
    expect((await db.supplierArticle.findUniqueOrThrow({ where: { id: sa.id } })).productId).toBe(ctx.beef.id);
  });

  it("creates launch bundles as unconfirmed drafts with valid components and per-package units", async () => {
    await runCatalogImport(db, { apply: true });
    const bundles = await db.product.findMany({ where: { bundleItems: { not: undefined }, NOT: { bundleItems: { equals: undefined } } } });
    const real = bundles.filter((b) => b.bundleItems != null && b.slug !== "beef-cubes");
    expect(real).toHaveLength(4);
    for (const b of real) expect(b).toMatchObject({ status: "DRAFT", priceConfirmed: false, isAvailable: false, sellingUnit: "PACKAGE", stepGrams: 1000 });
    expect((await runCatalogAudit(db)).bundleProblems).toEqual([]);
  });

  it("only hides the early demo catalogue when explicitly asked", async () => {
    const demo = await db.category.create({ data: { slug: "lamb", name: "Lamb" } });
    const d = await db.product.create({ data: { merchantId: ctx.merchant.id, categoryId: demo.id, slug: "lamb-chops", name: "Lamb Chops", description: "d", pricePerKgCents: 100 } });
    await runCatalogImport(db, { apply: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("ACTIVE");
    const r = await runCatalogImport(db, { apply: true, hideLegacyDemo: true });
    expect(r.legacyDemoHidden).toBeGreaterThanOrEqual(1); // also the "beef" demo products and the ekonomik-paket placeholder
    expect(await db.product.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "DRAFT", isHidden: true, isAvailable: false });
  });
});

const BUNDLE_SLUG = "aile-paketi";

describe("audit (read-only)", () => {
  it("reports counts and ambiguous names without changing anything", async () => {
    await runCatalogImport(db, { apply: true });
    await db.product.create({ data: { merchantId: ctx.merchant.id, categoryId: ctx.beef.categoryId, slug: "beef-cubes-2", name: "beef cubes", description: "d", pricePerKgCents: 0 } });
    const before = JSON.stringify(await db.product.findMany({ orderBy: { id: "asc" } }));
    const r = await runCatalogAudit(db);
    expect(JSON.stringify(await db.product.findMany({ orderBy: { id: "asc" } }))).toBe(before);
    expect(r.totals.products).toBe(await db.product.count());
    expect(r.supplier.articles).toBe(140);
    expect(r.nameGroups.find((g) => g.name === "beef cubes")?.products).toHaveLength(2);
    expect(r.inconsistent.find((i) => i.slug === "beef-cubes-2")?.problems).toContain("price marked confirmed but is 0");
  });
});

describe("csv price and availability import", () => {
  it("exports, previews every outcome, and applies atomically", async () => {
    const csvHeader = "id;price_eur;available\n";
    const csv = await exportProductsCsv();
    expect(csv.startsWith("﻿id,slug,name")).toBe(true);
    const text =
      csvHeader +
      `${ctx.beef.id};22,50;yes\n` + // update price
      `${ctx.gone.id};10;yes\n` + // unchanged price, availability on a confirmed price: update
      `nope;1;no\n` + // unknown id
      `${ctx.beef.id};5;no\n`; // duplicate id
    const plan = await planCsvImport(text);
    expect(plan.counts).toEqual({ update: 2, skip: 0, reject: 2 });
    expect(plan.rows[2].notes[0]).toMatch(/Unknown product/);
    expect(plan.rows[3].notes[0]).toMatch(/Duplicate/);
    expect(await code(applyCsvImport(text, "a"))).toBe("VALIDATION"); // rejected rows block the whole file
    expect((await db.product.findUniqueOrThrow({ where: { id: ctx.beef.id } })).pricePerKgCents).toBe(2000);

    const good = csvHeader + `${ctx.beef.id};22,50;yes\n${ctx.gone.id};10,00;yes\n`;
    await applyCsvImport(good, "a");
    expect(await db.product.findUniqueOrThrow({ where: { id: ctx.beef.id } })).toMatchObject({ pricePerKgCents: 2250 });
    expect(await db.product.findUniqueOrThrow({ where: { id: ctx.gone.id } })).toMatchObject({ isAvailable: true });
    expect((await db.auditLog.findFirst({ where: { action: "product.csv.import" } }))?.actor).toBe("a");
    expect((await planCsvImport(good)).counts).toEqual({ update: 0, skip: 2, reject: 0 }); // re-applying is a no-op
  });

  it("rejects bad numbers, 0-cent confirmations and an unusable header", async () => {
    expect((await planCsvImport(`id,price_eur\n${ctx.beef.id},abc\n${ctx.beef.id},1.234,5\n`)).counts.reject).toBeGreaterThan(0);
    expect((await planCsvImport(`id,price_eur,price_confirmed\n${ctx.beef.id},0,yes\n`)).rows[0].action).toBe("reject");
    expect((await planCsvImport(`id,name\n${ctx.beef.id},x\n`)).errors[0]).toMatch(/Nothing to import/);
    expect((await planCsvImport(`name,price_eur\nx,1\n`)).errors[0]).toMatch(/"id"/);
  });
});
