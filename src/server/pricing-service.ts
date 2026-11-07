import { db } from "@/lib/db";
import { purchaseBlocker, type ProductStatus } from "@/domain/product-rules";
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
  /** Set when the line came from expanding a bundle (analytics only). */
  bundleId: string | null;
}

const MAX_LINES = 50;

/** Single source of truth for cart pricing. Client-supplied prices are never read. */
export interface DeliveryTerms {
  mode: "REGULAR" | "PREORDER_ONLY";
  minOrderCents: number;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number | null;
}

export async function priceCart(lines: (CartLineInput & { bundleId?: string })[], terms: DeliveryTerms) {
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
    // Only published products exist for customers; drafts and archived records behave as deleted.
    if (!p || p.status !== "ACTIVE")
      throw new AppError("PRODUCT_UNAVAILABLE", "A product in your cart no longer exists", 409, { productId: l.productId });
    if (terms.mode === "PREORDER_ONLY" && !p.preorderEligible)
      throw new AppError("PREORDER_ONLY", "This delivery area only accepts preorder products", 422, {
        productId: p.id,
        productName: p.name,
      });
    // Server-side truth: listed + available + confirmed price (+ valid bundle). Client flags are never consulted.
    if (purchaseBlocker({ ...p, status: p.status as ProductStatus }))
      throw new AppError("PRODUCT_UNAVAILABLE", "A product in your cart is not available", 409, { productId: p.id, productName: p.name });
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
    // Bundles are expanded into ordinary product lines in the cart (see bundle-expand.ts); a package product is never an order line.
    if (p.bundleItems != null || p.sellingUnit !== "KG")
      throw new AppError("PRODUCT_UNAVAILABLE", "Bundles must be added as individual products", 409, { productId: p.id, productName: p.name });
    return {
      bundleId: l.bundleId ?? null,
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
