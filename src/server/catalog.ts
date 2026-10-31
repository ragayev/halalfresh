import type { Category, Product, ProductImage } from "@prisma/client";
import { db } from "@/lib/db";

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
  isFeatured: boolean;
  categorySlug: string;
  categoryName: string;
  images: { src: string; alt: string }[];
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
  images: Pick<ProductImage, "id" | "url" | "alt">[];
};

export function toProductView(p: ProductRow, locale: string): ProductView {
  const tr = (p.translations as Tr)[locale] ?? {};
  const ctr = (p.category.translations as Tr)[locale] ?? {};
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
    isAvailable: p.isAvailable,
    isFeatured: p.isFeatured,
    categorySlug: p.category.slug,
    categoryName: ctr.name || p.category.name,
    images: p.images.map((i) => ({
      src: imageSrc(i),
      alt: i.alt || tr.name || p.name,
    })),
  };
}

const include = {
  category: true,
  images: {
    orderBy: { position: "asc" as const },
    select: { id: true, url: true, alt: true },
  },
};

export async function listCategories(locale: string): Promise<CategoryView[]> {
  const cats = await db.category.findMany({ orderBy: { sortOrder: "asc" } });
  return cats.map((c) => ({
    id: c.id,
    slug: c.slug,
    imageUrl: c.imageUrl,
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
    limit?: number;
  } = {},
) {
  const rows = await db.product.findMany({
    where: {
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
    views = views.filter((v) => `${v.name} ${v.categoryName} ${v.description}`.toLowerCase().includes(needle));
  }
  return views;
}

export async function getProductBySlug(slug: string, locale: string) {
  const row = await db.product.findUnique({ where: { slug }, include });
  return row ? toProductView(row, locale) : null;
}

export async function getProductsByIds(ids: string[], locale: string) {
  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    include,
  });
  return rows.map((r) => toProductView(r, locale));
}
