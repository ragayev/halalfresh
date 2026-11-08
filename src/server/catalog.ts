import type { Category, Product, ProductImage } from "@prisma/client";
import { db } from "@/lib/db";
import { bundleItemName, bundleTotalGrams, parseBundleItems } from "@/domain/bundles";
import { DEFAULT_PRODUCT_IMAGE, hasConfirmedPrice, isPurchasable, type ProductStatus, type SellingUnit } from "@/domain/product-rules";

type Tr = Record<string, { name?: string; description?: string }>;

export interface ProductView {
  id: string;
  slug: string;
  name: string;
  description: string;
  pricePerKgCents: number;
  stepGrams: number;
  minGrams: number;
  maxGrams: number;
  origin: string | null;
  halalCertification: string | null;
  allergenInfo: string | null;
  isAvailable: boolean;
  /** Server-evaluated: listed, available and carrying a confirmed price. The only flag the UI may use to enable ordering. */
  purchasable: boolean;
  priceConfirmed: boolean;
  sellingUnit: SellingUnit;
  isFeatured: boolean;
  preorderEligible: boolean;
  categorySlug: string;
  categoryName: string;
  /** Fleischpaket: localized contents; null for regular products. */
  bundle: { totalGrams: number; items: { name: string; grams: number }[] } | null;
  images: { src: string; alt: string; placeholder: boolean }[];
  /** Original supplier article codes, when linked to the product. */
  supplierArticleNumbers: string[];
}

export interface CategoryView {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}

export function imageSrc(i: Pick<ProductImage, "id" | "url">): string {
  return i.url ?? `/api/images/${i.id}`;
}

type ProductRow = Product & {
  category: Category;
  images: Pick<ProductImage, "id" | "url" | "alt" | "isPlaceholder">[];
  supplierArticles: { supplierSku: string }[];
};

export function toProductView(p: ProductRow, locale: string): ProductView {
  const tr = (p.translations as Tr)[locale] ?? {};
  const ctr = (p.category.translations as Tr)[locale] ?? {};
  const bundleItems = parseBundleItems(p.bundleItems);
  const supplierArticleNumbers = p.supplierArticles.map((a) => a.supplierSku);
  return {
    id: p.id,
    slug: p.slug,
    name: tr.name || p.name,
    description: tr.description || p.description,
    pricePerKgCents: p.pricePerKgCents,
    stepGrams: p.stepGrams,
    minGrams: p.minGrams,
    maxGrams: p.maxGrams,
    origin: p.origin,
    halalCertification: p.halalCertification,
    allergenInfo: p.allergenInfo,
    // Storefront components only know "available": it already folds in listing status and a confirmed price.
    isAvailable: isPurchasable({ ...p, status: p.status as ProductStatus }),
    purchasable: isPurchasable({ ...p, status: p.status as ProductStatus }),
    priceConfirmed: hasConfirmedPrice(p),
    sellingUnit: p.sellingUnit as SellingUnit,
    isFeatured: p.isFeatured,
    preorderEligible: p.preorderEligible,
    categorySlug: p.category.slug,
    categoryName: ctr.name || p.category.name,
    bundle: bundleItems
      ? {
          totalGrams: bundleTotalGrams(bundleItems),
          items: bundleItems.map((i) => ({ name: bundleItemName(i, locale), grams: i.grams })),
        }
      : null,
    supplierArticleNumbers,
    images: p.images.length
      ? p.images.map((i) => ({
          src: imageSrc(i),
          placeholder: i.isPlaceholder,
          alt: i.alt || (bundleItems ? `${tr.name || p.name}: ${bundleItems.map((b) => bundleItemName(b, locale)).join(", ")}` : tr.name || p.name),
        }))
      : [{ src: DEFAULT_PRODUCT_IMAGE, alt: tr.name || p.name, placeholder: true }],
  };
}

const include = {
  category: true,
  images: {
    orderBy: { position: "asc" as const },
    select: { id: true, url: true, alt: true, isPlaceholder: true },
  },
  supplierArticles: { select: { supplierSku: true }, orderBy: { supplierSku: "asc" as const } },
};

export async function listCategories(locale: string): Promise<CategoryView[]> {
  const cats = await db.category.findMany({
    where: { products: { some: { status: "ACTIVE" } } },
    orderBy: { sortOrder: "asc" },
    include: {
      products: {
        where: { status: "ACTIVE", images: { some: {} } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { images: { orderBy: { position: "asc" }, take: 1, select: { id: true, url: true } } },
      },
    },
  });
  return cats.map((c) => ({
    id: c.id,
    slug: c.slug,
    // Category tiles fall back to the first product photo when no dedicated image is set.
    imageUrl: c.imageUrl ?? (c.products[0]?.images[0] ? imageSrc(c.products[0].images[0]) : null),
    name: (c.translations as Tr)[locale]?.name || c.name,
  }));
}

export type Sort = "popular" | "price-asc" | "price-desc" | "name";

export async function listProducts(
  locale: string,
  opts: {
    category?: string;
    q?: string;
    sort?: Sort;
    availableOnly?: boolean;
    featured?: boolean;
    /** Preorder-only delivery areas: list only preorder-eligible products. */
    preorderOnly?: boolean;
    limit?: number;
  } = {},
) {
  const rows = await db.product.findMany({
    where: {
      status: "ACTIVE",
      ...(opts.preorderOnly ? { preorderEligible: true } : {}),
      ...(opts.category ? { category: { slug: opts.category } } : {}),
      ...(opts.availableOnly ? { isAvailable: true } : {}),
      ...(opts.featured ? { isFeatured: true } : {}),
    },
    include,
    orderBy:
      opts.sort === "price-asc"
        ? { pricePerKgCents: "asc" }
        : opts.sort === "price-desc"
          ? { pricePerKgCents: "desc" }
          : opts.sort === "name"
            ? { name: "asc" }
            : [{ isFeatured: "desc" }, { sortOrder: "asc" }],
    take: opts.limit,
  });
  let views = rows.map((r) => toProductView(r, locale));
  if (opts.q?.trim()) {
    const needle = opts.q.trim().toLowerCase();
    views = views.filter((v) => `${v.name} ${v.categoryName} ${v.description} ${v.supplierArticleNumbers.join(" ")}`.toLowerCase().includes(needle));
  }
  return views;
}

export async function getProductBySlug(slug: string, locale: string) {
  const row = await db.product.findUnique({ where: { slug }, include });
  return row && row.status === "ACTIVE" ? toProductView(row, locale) : null;
}

export async function getProductsByIds(ids: string[], locale: string) {
  const rows = await db.product.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    include,
  });
  return rows.map((r) => toProductView(r, locale));
}
