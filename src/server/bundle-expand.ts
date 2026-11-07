import { db } from "@/lib/db";
import { parseBundleItems } from "@/domain/bundles";
import { purchaseBlocker, type ProductStatus } from "@/domain/product-rules";
import { lineTotalCents } from "@/domain/pricing";
import { getMerchant } from "./settings";

export interface ExpandedLine {
  productId: string;
  name: string;
  grams: number;
  pricePerKgCents: number;
  estimatedCents: number;
  bundleId: string;
}

export type ExpandResult = { ok: true; bundleId: string; lines: ExpandedLine[]; estimatedCents: number } | { ok: false; reason: "NOT_FOUND" | "UNAVAILABLE" };

/**
 * "Paket in den Warenkorb": turns a bundle into ordinary order lines (one per component product) at current prices,
 * no bundle discount. Grams are rounded up to the product's step and raised to its minimum so each line is a valid
 * quantity. The bundle is orderable only if every component exists and is purchasable.
 */
export async function expandBundle(slug: string, packages = 1): Promise<ExpandResult> {
  const merchant = await getMerchant();
  const bundle = await db.product.findFirst({ where: { slug, merchantId: merchant.id, status: "ACTIVE" } });
  const items = bundle ? parseBundleItems(bundle.bundleItems) : null;
  if (!bundle || !items) return { ok: false, reason: "NOT_FOUND" };
  const slugs = items.map((i) => i.productSlug);
  if (slugs.some((s) => !s)) return { ok: false, reason: "UNAVAILABLE" };
  const products = await db.product.findMany({ where: { slug: { in: slugs as string[] }, merchantId: merchant.id } });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const merged = new Map<string, ExpandedLine>();
  for (const it of items) {
    const p = bySlug.get(it.productSlug!);
    if (!p || p.bundleItems != null || purchaseBlocker({ ...p, status: p.status as ProductStatus })) return { ok: false, reason: "UNAVAILABLE" };
    const wanted = it.grams * packages;
    const stepped = Math.ceil(wanted / p.stepGrams) * p.stepGrams;
    const grams = Math.min(p.maxGrams, Math.max(p.minGrams, stepped));
    const prev = merged.get(p.id);
    const total = (prev?.grams ?? 0) + grams;
    merged.set(p.id, { productId: p.id, name: p.name, grams: Math.min(total, p.maxGrams), pricePerKgCents: p.pricePerKgCents, estimatedCents: lineTotalCents(p.pricePerKgCents, Math.min(total, p.maxGrams)), bundleId: bundle.slug });
  }
  const lines = [...merged.values()];
  return { ok: true, bundleId: bundle.slug, lines, estimatedCents: lines.reduce((s, l) => s + l.estimatedCents, 0) };
}
