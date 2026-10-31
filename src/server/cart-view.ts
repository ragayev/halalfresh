import { db } from "@/lib/db";
import { computeTotals, lineTotalCents, PricingError, validateQuantity, type CartLineInput } from "@/domain/pricing";
import { getProductsByIds } from "./catalog";
import { getMerchant } from "./settings";

export type LineIssue = "UNAVAILABLE" | "NOT_FOUND" | "QUANTITY";

export interface CartViewLine {
  productId: string;
  name: string;
  slug: string;
  image: string | null;
  grams: number;
  pricePerKgCents: number;
  lineTotalCents: number;
  stepGrams: number;
  minGrams: number;
  maxGrams: number;
  issue?: LineIssue;
}

/** Display-only pricing: tolerant of stale carts (reports issues instead of throwing). Checkout re-validates strictly. */
export async function cartView(lines: CartLineInput[], locale: string) {
  const merchant = await getMerchant();
  const products = await getProductsByIds(
    lines.map((l) => l.productId),
    locale,
  );
  const raw = await db.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rawById = new Map(raw.map((p) => [p.id, p]));

  const out: CartViewLine[] = lines.map((l) => {
    const p = byId.get(l.productId),
      r = rawById.get(l.productId);
    if (!p || !r)
      return {
        productId: l.productId,
        name: "—",
        slug: "",
        image: null,
        grams: l.grams,
        pricePerKgCents: 0,
        lineTotalCents: 0,
        stepGrams: 1000,
        minGrams: 1000,
        maxGrams: 1000,
        issue: "NOT_FOUND",
      };
    let issue: LineIssue | undefined;
    try {
      validateQuantity(r, l.grams);
    } catch (e) {
      if (e instanceof PricingError) issue = e.code === "UNAVAILABLE" ? "UNAVAILABLE" : "QUANTITY";
    }
    return {
      productId: p.id,
      name: p.name,
      slug: p.slug,
      image: p.images[0]?.src ?? null,
      grams: l.grams,
      pricePerKgCents: p.pricePerKgCents,
      lineTotalCents: issue ? 0 : lineTotalCents(p.pricePerKgCents, l.grams),
      stepGrams: p.stepGrams,
      minGrams: p.minGrams,
      maxGrams: p.maxGrams,
      issue,
    };
  });

  const s = merchant.settings;
  const subtotal = out.reduce((a, l) => a + l.lineTotalCents, 0);
  const totals = computeTotals({
    subtotalCents: subtotal,
    minOrderCents: s.minOrderCents,
    deliveryFeeCents: s.deliveryFeeCents,
    freeDeliveryOverCents: s.freeDeliveryOverCents,
  });
  return {
    lines: out,
    totals,
    merchant: { name: merchant.legalName ?? merchant.name },
    hasIssues: out.some((l) => l.issue),
  };
}
