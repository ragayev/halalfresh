import { db } from "@/lib/db";
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
}

const MAX_LINES = 50;

/** Single source of truth for cart pricing. Client-supplied prices are never read. */
export async function priceCart(lines: CartLineInput[], opts: { deliveryFeeOverrideCents?: number | null } = {}) {
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
    if (!p) throw new AppError("PRODUCT_UNAVAILABLE", "A product in your cart no longer exists", 409, { productId: l.productId });
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
    return {
      productId: p.id,
      name: p.name,
      slug: p.slug,
      grams: l.grams,
      pricePerKgCents: p.pricePerKgCents,
      lineTotalCents: lineTotalCents(p.pricePerKgCents, l.grams),
    };
  });

  const subtotalCents = priced.reduce((s, l) => s + l.lineTotalCents, 0);
  const s = merchant.settings;
  const totals = computeTotals({
    subtotalCents,
    minOrderCents: s.minOrderCents,
    deliveryFeeCents: opts.deliveryFeeOverrideCents ?? s.deliveryFeeCents,
    freeDeliveryOverCents: s.freeDeliveryOverCents,
  });
  return { merchant, lines: priced, totals };
}
