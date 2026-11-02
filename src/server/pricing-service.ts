import { db } from "@/lib/db";
import { BUNDLE_UNIT_GRAMS, parseBundleItems, snapshotBundle, type BundleSnapshot } from "@/domain/bundles";
import { computeTotals, lineTotalCents, PricingError, validateQuantity, type CartLineInput } from "@/domain/pricing";
import { AppError } from "./errors";
import { getMerchant } from "./settings";

export interface PricedLine {
  productId: string;
  name: string;
  slug: string;
  grams: number;
  pricePerKgCents: number;
  lineTotalCents: number;
  /** Contents frozen from the catalogue at pricing time (bundles only). */
  bundleSnapshot: BundleSnapshot | null;
}

const MAX_LINES = 50;

/** Single source of truth for cart pricing. Client-supplied prices are never read. */
export interface DeliveryTerms {
  mode: "REGULAR" | "PREORDER_ONLY";
  minOrderCents: number;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number | null;
}

export async function priceCart(lines: CartLineInput[], terms: DeliveryTerms) {
  if (!lines.length) throw new AppError("EMPTY_CART", "Cart is empty");
  if (lines.length > MAX_LINES) throw new AppError("VALIDATION", "Too many cart lines");
  const ids = new Set(lines.map((l) => l.productId));
  if (ids.size !== lines.length) throw new AppError("VALIDATION", "Duplicate products in cart");

  const merchant = await getMerchant();
  const products = await db.product.findMany({
    where: { id: { in: [...ids] }, merchantId: merchant.id },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const priced: PricedLine[] = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p || p.isHidden)
      throw new AppError("PRODUCT_UNAVAILABLE", "A product in your cart no longer exists", 409, { productId: l.productId });
    if (terms.mode === "PREORDER_ONLY" && !p.preorderEligible)
      throw new AppError("PREORDER_ONLY", "This delivery area only accepts preorder products", 422, {
        productId: p.id,
        productName: p.name,
      });
    try {
      validateQuantity(p, l.grams);
    } catch (e) {
      if (e instanceof PricingError) {
        throw new AppError(e.code === "UNAVAILABLE" ? "PRODUCT_UNAVAILABLE" : "INVALID_QUANTITY", e.message, 409, {
          productId: p.id,
          productName: p.name,
        });
      }
      throw e;
    }
    const items = parseBundleItems(p.bundleItems);
    // A bundle that is still awaiting price approval can never be sold, whatever the flags say.
    if (p.bundleItems != null && (!items || !p.priceConfirmed))
      throw new AppError("PRODUCT_UNAVAILABLE", "A product in your cart is not available yet", 409, { productId: p.id, productName: p.name });
    if (items && l.grams % BUNDLE_UNIT_GRAMS !== 0)
      throw new AppError("INVALID_QUANTITY", "Invalid bundle quantity", 409, { productId: p.id, productName: p.name });
    return {
      bundleSnapshot: items ? snapshotBundle(items) : null,
      productId: p.id,
      name: p.name,
      slug: p.slug,
      grams: l.grams,
      pricePerKgCents: p.pricePerKgCents,
      lineTotalCents: lineTotalCents(p.pricePerKgCents, l.grams),
    };
  });

  const subtotalCents = priced.reduce((s, l) => s + l.lineTotalCents, 0);
  const totals = computeTotals({
    subtotalCents,
    minOrderCents: terms.minOrderCents,
    deliveryFeeCents: terms.deliveryFeeCents,
    freeDeliveryOverCents: terms.freeDeliveryThresholdCents,
  });
  return { merchant, lines: priced, totals };
}
