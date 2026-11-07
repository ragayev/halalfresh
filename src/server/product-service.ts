import { Prisma, type Product, type ProductStatus as DbStatus, type SellingUnit as DbUnit } from "@prisma/client";
import { db } from "@/lib/db";
import { parseBundleItems, type BundleItem } from "@/domain/bundles";
import {
  availabilityError,
  hasConfirmedPrice,
  imageStatus,
  isHiddenFor,
  isValidSku,
  normalizeSku,
  duplicateSkus,
  quantityConfigError,
  statusChangeError,
  type ProductStatus,
  type SellingUnit,
} from "@/domain/product-rules";
import { AppError } from "./errors";
import { audit } from "./orders";
import { getMerchant } from "./settings";

/**
 * Admin-side product service. PostgreSQL is the only source of truth; this module is the only place that writes
 * Product publishing state (status + the isHidden mirror), prices, availability and supplier mappings, always in a
 * transaction with an audit row. Storefront reads live in ./catalog.ts and share the rules in domain/product-rules.ts.
 */

type Tx = Prisma.TransactionClient;
type Actor = string;

const adminInclude = {
  category: true,
  images: { orderBy: { position: "asc" as const }, select: { id: true, url: true, alt: true, isPlaceholder: true } },
  supplierArticles: { orderBy: { supplierSku: "asc" as const }, select: { id: true, supplierSku: true, originalName: true, source: true } },
} satisfies Prisma.ProductInclude;

export type AdminProduct = Prisma.ProductGetPayload<{ include: typeof adminInclude }>;

// ---------------------------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------------------------
export interface AdminProductFilters {
  q?: string;
  sku?: string;
  category?: string;
  status?: ProductStatus;
  availability?: "available" | "unavailable";
  missingImage?: boolean;
  missingPrice?: boolean;
}

export function adminWhere(f: AdminProductFilters): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];
  if (f.q?.trim()) {
    const q = f.q.trim();
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        // Localized names live in the translations JSON.
        { translations: { path: ["de", "name"], string_contains: q } },
        { translations: { path: ["tr", "name"], string_contains: q } },
      ],
    });
  }
  if (f.sku?.trim()) and.push({ supplierArticles: { some: { supplierSku: { contains: f.sku.trim() } } } });
  if (f.category) and.push({ category: { slug: f.category } });
  if (f.status) and.push({ status: f.status });
  if (f.availability) and.push({ isAvailable: f.availability === "available" });
  if (f.missingImage) and.push({ OR: [{ images: { none: {} } }, { images: { every: { isPlaceholder: true } } }] });
  if (f.missingPrice) and.push({ OR: [{ pricePerKgCents: { lte: 0 } }, { priceConfirmed: false }] });
  return and.length ? { AND: and } : {};
}

export async function listProducts(filters: AdminProductFilters = {}, page = 1, pageSize = 50) {
  const where = adminWhere(filters);
  const size = Math.min(Math.max(1, pageSize), 200);
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      include: adminInclude,
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      skip: (Math.max(1, page) - 1) * size,
      take: size,
    }),
  ]);
  return { total, rows, page: Math.max(1, page), pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
}

export async function getProductById(id: string) {
  return db.product.findUnique({ where: { id }, include: adminInclude });
}

export async function getProductBySlug(slug: string) {
  return db.product.findUnique({ where: { slug }, include: adminInclude });
}

export async function getProductBySupplierSku(sku: string, merchantId?: string) {
  const mid = merchantId ?? (await getMerchant()).id;
  const row = await db.supplierArticle.findUnique({
    where: { merchantId_supplierSku: { merchantId: mid, supplierSku: normalizeSku(sku) } },
    include: { product: { include: adminInclude } },
  });
  return row?.product ?? null;
}

export interface CatalogStats {
  total: number;
  published: number;
  draft: number;
  archived: number;
  available: number;
  /** Purchasable right now: published, available, confirmed price. */
  purchasable: number;
  missingImage: number;
  missingPrice: number;
}

/** Every number is computed from the database; nothing is hardcoded. */
export async function getCatalogStats(): Promise<CatalogStats> {
  const c = (where: Prisma.ProductWhereInput = {}) => db.product.count({ where });
  const [total, published, draft, archived, available, purchasable, missingImage, missingPrice] = await Promise.all([
    c(),
    c({ status: "ACTIVE" }),
    c({ status: "DRAFT" }),
    c({ status: "ARCHIVED" }),
    c({ isAvailable: true }),
    c({ status: "ACTIVE", isAvailable: true, priceConfirmed: true, pricePerKgCents: { gt: 0 } }),
    c(adminWhere({ missingImage: true })),
    c(adminWhere({ missingPrice: true })),
  ]);
  return { total, published, draft, archived, available, purchasable, missingImage, missingPrice };
}

export const productImageStatus = (p: Pick<AdminProduct, "images">) => imageStatus(p.images);

// ---------------------------------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------------------------------
export interface ProductInput {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  priceCents: number;
  priceConfirmed: boolean;
  sellingUnit: SellingUnit;
  stepGrams: number;
  minGrams: number;
  maxGrams: number;
  origin?: string | null;
  halalCertification?: string | null;
  allergenInfo?: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  preorderEligible: boolean;
  status: ProductStatus;
  /** Only the fields present are merged into the stored translations; supplier metadata is never touched. */
  translations?: { de?: { name?: string; description?: string }; tr?: { name?: string; description?: string } };
  /** undefined = leave as is (or none for a regular product). */
  bundleItems?: BundleItem[];
}

/** Every referenced component slug must exist; quantities must be positive. Returns an error message or null. */
export async function bundleError(items: BundleItem[], client: Tx | typeof db = db): Promise<string | null> {
  if (!items.length) return "A bundle needs at least one component";
  if (items.some((i) => !Number.isInteger(i.grams) || i.grams <= 0)) return "Every bundle component needs a positive weight in grams";
  const slugs = [...new Set(items.flatMap((i) => (i.productSlug ? [i.productSlug] : [])))];
  if (!slugs.length) return null;
  const found = await client.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true } });
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  return missing.length ? `Unknown catalogue product in bundle: ${missing.join(", ")}` : null;
}

function validateInput(i: ProductInput): void {
  const cfg = quantityConfigError(i.sellingUnit, i);
  if (cfg) throw new AppError("VALIDATION", cfg);
  if (!Number.isSafeInteger(i.priceCents) || i.priceCents < 0) throw new AppError("VALIDATION", "Price must be a non-negative amount");
  if (i.priceConfirmed && i.priceCents <= 0) throw new AppError("VALIDATION", "A price of 0 cannot be confirmed");
}

const TRACKED = [
  "name", "slug", "description", "categoryId", "pricePerKgCents", "priceConfirmed", "sellingUnit", "stepGrams", "minGrams",
  "maxGrams", "origin", "halalCertification", "allergenInfo", "isFeatured", "isAvailable", "preorderEligible", "status",
] as const;

function diff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of TRACKED) if (!before || before[k] !== after[k]) changes[k] = [before?.[k] ?? null, after[k] ?? null];
  return changes;
}

function mergeTranslations(prev: unknown, input: ProductInput): Prisma.InputJsonObject {
  const base = prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const loc = (k: string) => (base[k] && typeof base[k] === "object" ? (base[k] as Record<string, unknown>) : {});
  const out: Record<string, unknown> = { ...base, en: { ...loc("en"), name: input.name, description: input.description } };
  for (const l of ["de", "tr"] as const) {
    const t = input.translations?.[l];
    if (t) out[l] = { ...loc(l), ...(t.name !== undefined ? { name: t.name } : {}), ...(t.description !== undefined ? { description: t.description } : {}) };
  }
  return out as Prisma.InputJsonObject;
}

function writeData(i: ProductInput, prevTranslations: unknown) {
  return {
    name: i.name,
    slug: i.slug,
    description: i.description,
    categoryId: i.categoryId,
    pricePerKgCents: i.priceCents,
    priceConfirmed: i.priceConfirmed,
    sellingUnit: i.sellingUnit as DbUnit,
    stepGrams: i.stepGrams,
    minGrams: i.minGrams,
    maxGrams: i.maxGrams,
    origin: i.origin || null,
    halalCertification: i.halalCertification || null,
    allergenInfo: i.allergenInfo || null,
    isFeatured: i.isFeatured,
    // Archiving always takes a product off sale.
    isAvailable: i.status === "ARCHIVED" ? false : i.isAvailable,
    preorderEligible: i.preorderEligible,
    status: i.status as DbStatus,
    isHidden: isHiddenFor(i.status),
    translations: mergeTranslations(prevTranslations, i),
    ...(i.bundleItems ? { bundleItems: i.bundleItems as unknown as Prisma.InputJsonValue } : {}),
  };
}

function conflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", "Slug already in use", 409);
  throw e;
}

export async function createProduct(input: ProductInput, actor: Actor) {
  validateInput(input);
  const merchant = await getMerchant();
  return db
    .$transaction(async (tx) => {
      if (input.bundleItems) {
        const err = await bundleError(input.bundleItems, tx);
        if (err) throw new AppError("VALIDATION", err);
      }
      const priced = { priceConfirmed: input.priceConfirmed, pricePerKgCents: input.priceCents };
      const blocked =
        (input.isAvailable && input.status !== "ARCHIVED" ? availabilityError({ status: input.status, ...priced }, true) : null) ??
        (input.status === "ACTIVE"
          ? statusChangeError({ status: "DRAFT", isAvailable: input.isAvailable, bundleItems: input.bundleItems, ...priced }, "ACTIVE")
          : null);
      if (blocked) throw new AppError("VALIDATION", blocked);
      const p = await tx.product.create({ data: { ...writeData(input, {}), merchantId: merchant.id } });
      await audit(actor, "product.create", "Product", p.id, { changes: diff(null, p) } as Prisma.InputJsonValue, tx);
      return p;
    })
    .catch(conflict);
}

export async function updateProduct(id: string, input: ProductInput, actor: Actor) {
  validateInput(input);
  return db
    .$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new AppError("NOT_FOUND", "Product not found", 404);
      const bundleItems = input.bundleItems ?? parseBundleItems(before.bundleItems) ?? undefined;
      if (input.bundleItems) {
        const err = await bundleError(input.bundleItems, tx);
        if (err) throw new AppError("VALIDATION", err);
      }
      const current = { status: before.status as ProductStatus, isAvailable: before.isAvailable, priceConfirmed: input.priceConfirmed, pricePerKgCents: input.priceCents, bundleItems: before.bundleItems != null ? (bundleItems ?? before.bundleItems) : undefined };
      const statusErr = input.status !== before.status ? statusChangeError(current, input.status) : null;
      if (statusErr) throw new AppError("VALIDATION", statusErr);
      // Availability is only validated when it is being switched on or the product is being published.
      const turningOn = input.isAvailable && input.status !== "ARCHIVED" && (!before.isAvailable || input.status !== before.status);
      const availErr = turningOn ? availabilityError({ status: input.status, priceConfirmed: input.priceConfirmed, pricePerKgCents: input.priceCents }, true) : null;
      if (availErr) throw new AppError("VALIDATION", availErr);
      if (before.bundleItems != null && input.status === "ACTIVE" && !hasConfirmedPrice({ priceConfirmed: input.priceConfirmed, pricePerKgCents: input.priceCents }))
        throw new AppError("VALIDATION", "Confirm the butcher-approved bundle price before publishing it.");
      const p = await tx.product.update({ where: { id }, data: writeData(input, before.translations) });
      const changes = diff(before, p);
      if (Object.keys(changes).length) await audit(actor, "product.update", "Product", id, { changes } as Prisma.InputJsonValue, tx);
      return p;
    })
    .catch(conflict);
}

async function mutate(id: string, actor: Actor, action: string, fn: (p: Product, tx: Tx) => Prisma.ProductUpdateInput) {
  return db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Product not found", 404);
    const data = fn(before, tx);
    const p = await tx.product.update({ where: { id }, data });
    await audit(actor, action, "Product", id, { changes: diff(before, p) } as Prisma.InputJsonValue, tx);
    return p;
  });
}

export function setStatus(id: string, to: ProductStatus, actor: Actor) {
  return mutate(id, actor, `product.status.${to.toLowerCase()}`, (p) => {
    const err = statusChangeError(p, to);
    if (err) throw new AppError("VALIDATION", err);
    return { status: to, isHidden: isHiddenFor(to), ...(to === "ARCHIVED" ? { isAvailable: false } : {}) };
  });
}
export const publishProduct = (id: string, actor: Actor) => setStatus(id, "ACTIVE", actor);
export const unpublishProduct = (id: string, actor: Actor) => setStatus(id, "DRAFT", actor);
export const archiveProduct = (id: string, actor: Actor) => setStatus(id, "ARCHIVED", actor);

export function setAvailability(id: string, available: boolean, actor: Actor) {
  return mutate(id, actor, "product.isAvailable", (p) => {
    const err = availabilityError(p, available);
    if (err) throw new AppError("VALIDATION", err);
    return { isAvailable: available };
  });
}

export function setFlag(id: string, field: "isFeatured" | "preorderEligible", value: boolean, actor: Actor) {
  return mutate(id, actor, `product.${field}`, () => ({ [field]: value }));
}

/** Price changes keep availability honest: an unconfirmed or zero price takes the product off sale. */
export async function updatePrice(id: string, priceCents: number, confirmed: boolean, actor: Actor) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 10_000_000) throw new AppError("VALIDATION", "Invalid price");
  if (confirmed && priceCents <= 0) throw new AppError("VALIDATION", "A price of 0 cannot be confirmed");
  return mutate(id, actor, "product.price", () => ({
    pricePerKgCents: priceCents,
    priceConfirmed: confirmed,
    ...(confirmed ? {} : { isAvailable: false }),
  }));
}

// ---- Supplier SKUs ----
/** Replaces nothing; adds one mapping. Rejects invalid numbers and a number already mapped to another product. */
export async function addSupplierSku(productId: string, rawSku: string, actor: Actor, opts: { originalName?: string; source?: string } = {}) {
  const sku = normalizeSku(rawSku);
  if (!isValidSku(sku)) throw new AppError("VALIDATION", `Invalid supplier article number: ${rawSku}`);
  return db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId }, select: { id: true, merchantId: true } });
    if (!p) throw new AppError("NOT_FOUND", "Product not found", 404);
    const owner = await tx.supplierArticle.findUnique({
      where: { merchantId_supplierSku: { merchantId: p.merchantId, supplierSku: sku } },
      include: { product: { select: { id: true, name: true } } },
    });
    if (owner && owner.productId === productId) return owner;
    if (owner) throw new AppError("CONFLICT", `Supplier article ${sku} already belongs to "${owner.product.name}"`, 409, { productId: owner.productId });
    const row = await tx.supplierArticle.create({
      data: { merchantId: p.merchantId, productId, supplierSku: sku, originalName: opts.originalName ?? null, source: opts.source ?? "admin" },
    });
    await audit(actor, "product.sku.add", "Product", productId, { sku }, tx);
    return row;
  });
}

export async function removeSupplierSku(productId: string, sku: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const r = await tx.supplierArticle.deleteMany({ where: { productId, supplierSku: normalizeSku(sku) } });
    if (r.count) await audit(actor, "product.sku.remove", "Product", productId, { sku }, tx);
    return r.count;
  });
}

/** Parses "a, b\nc" into validated unique SKUs, or throws with the offending values. */
export function parseSkuList(text: string): string[] {
  const list = text.split(/[\s,;]+/).map(normalizeSku).filter(Boolean);
  const dup = duplicateSkus(list);
  if (dup.length) throw new AppError("VALIDATION", `Duplicate supplier article numbers: ${dup.join(", ")}`);
  const bad = list.filter((s) => !isValidSku(s));
  if (bad.length) throw new AppError("VALIDATION", `Invalid supplier article numbers: ${bad.join(", ")}`);
  return list;
}

/** Makes the product's SKU set equal to `skus` (adds and removes), all-or-nothing. */
export async function setSupplierSkus(productId: string, skus: string[], actor: Actor) {
  return db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId }, select: { merchantId: true } });
    if (!p) throw new AppError("NOT_FOUND", "Product not found", 404);
    const current = await tx.supplierArticle.findMany({ where: { productId } });
    const have = new Set(current.map((c) => c.supplierSku));
    const want = new Set(skus);
    const remove = current.filter((c) => !want.has(c.supplierSku));
    const add = skus.filter((s) => !have.has(s));
    for (const s of add) {
      const owner = await tx.supplierArticle.findUnique({
        where: { merchantId_supplierSku: { merchantId: p.merchantId, supplierSku: s } },
        include: { product: { select: { name: true } } },
      });
      if (owner) throw new AppError("CONFLICT", `Supplier article ${s} already belongs to "${owner.product.name}"`, 409);
    }
    if (remove.length) await tx.supplierArticle.deleteMany({ where: { id: { in: remove.map((r) => r.id) } } });
    if (add.length) await tx.supplierArticle.createMany({ data: add.map((s) => ({ merchantId: p.merchantId, productId, supplierSku: s, source: "admin" })) });
    if (add.length || remove.length) await audit(actor, "product.sku.set", "Product", productId, { added: add, removed: remove.map((r) => r.supplierSku) }, tx);
  });
}

// ---- Images ----
/** Associates a repository-backed static image (a path under /public). Stored as metadata only. */
export async function associateStaticImage(productId: string, url: string, alt: string, actor: Actor, opts: { isPlaceholder?: boolean } = {}) {
  if (!/^\/images\/products\/[\w./-]+\.(webp|png|jpe?g|svg)$/i.test(url) || url.includes(".."))
    throw new AppError("VALIDATION", "Static images must live under /images/products/");
  return db.$transaction(async (tx) => {
    const position = await tx.productImage.count({ where: { productId } });
    const img = await tx.productImage.create({ data: { productId, url, alt, position, isPlaceholder: opts.isPlaceholder ?? false } });
    await audit(actor, "product.image.static", "Product", productId, { url }, tx);
    return img;
  });
}
