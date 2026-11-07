import { purchaseBlocker, type ProductStatus } from "@/domain/product-rules";
import { db } from "@/lib/db";
import { computeTotals, lineTotalCents, PricingError, validateQuantity, type CartLineInput } from "@/domain/pricing";
import { getProductsByIds } from "./catalog";
import { getMerchant } from "./settings";
import { resolveDelivery } from "./delivery-service";

export type LineIssue = "UNAVAILABLE" | "NOT_FOUND" | "QUANTITY" | "NOT_PREORDER";

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
  isBundle: boolean;
  bundle: { totalGrams: number; items: { name: string; grams: number }[] } | null;
  issue?: LineIssue;
}

/** Display-only pricing: tolerant of stale carts (reports issues instead of throwing). Checkout re-validates strictly. */
export async function cartView(lines: CartLineInput[], locale: string, postcode?: string | null) {
  const delivery = (await resolveDelivery(postcode ?? "")).check;
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
        isBundle: false,
        bundle: null,
        issue: "NOT_FOUND",
      };
    let issue: LineIssue | undefined;
    if (delivery.mode === "PREORDER_ONLY" && !r.preorderEligible) issue = "NOT_PREORDER";
    if (!issue && purchaseBlocker({ ...r, status: r.status as ProductStatus })) issue = "UNAVAILABLE";
    try {
      validateQuantity(r, l.grams);
    } catch (e) {
      if (e instanceof PricingError && !issue) issue = e.code === "UNAVAILABLE" ? "UNAVAILABLE" : "QUANTITY";
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
      isBundle: !!p.bundle,
      bundle: p.bundle,
      issue,
    };
  });

  const subtotal = out.reduce((a, l) => a + l.lineTotalCents, 0);
  const totals = computeTotals({
    subtotalCents: subtotal,
    minOrderCents: delivery.minOrderCents,
    deliveryFeeCents: delivery.deliveryFeeCents,
    freeDeliveryOverCents: delivery.freeDeliveryThresholdCents,
  });
  return {
    lines: out,
    totals,
    delivery,
    merchant: { name: merchant.legalName ?? merchant.name },
    hasIssues: out.some((l) => l.issue),
  };
}
