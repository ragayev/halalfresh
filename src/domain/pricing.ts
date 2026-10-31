import { type Cents } from "./money";

export interface PricedProduct {
  id: string;
  pricePerKgCents: Cents;
  stepGrams: number;
  minGrams: number;
  maxGrams: number;
  isAvailable: boolean;
}

export class PricingError extends Error {
  constructor(
    public code: "INVALID_QUANTITY" | "UNAVAILABLE" | "BELOW_MIN" | "ABOVE_MAX" | "BAD_STEP",
    message: string,
  ) {
    super(message);
  }
}

/** Line price = price/kg * grams / 1000, rounded half-up to the nearest cent. Deterministic integer math. */
export function lineTotalCents(pricePerKgCents: Cents, grams: number): Cents {
  if (!Number.isInteger(grams) || grams <= 0) throw new PricingError("INVALID_QUANTITY", "grams must be a positive integer");
  return Math.floor((pricePerKgCents * grams + 500) / 1000);
}

export function validateQuantity(product: PricedProduct, grams: number): void {
  if (!Number.isInteger(grams) || grams <= 0) throw new PricingError("INVALID_QUANTITY", "Invalid quantity");
  if (!product.isAvailable) throw new PricingError("UNAVAILABLE", "Product unavailable");
  if (grams < product.minGrams) throw new PricingError("BELOW_MIN", "Below minimum quantity");
  if (grams > product.maxGrams) throw new PricingError("ABOVE_MAX", "Above maximum quantity");
  if (grams % product.stepGrams !== 0) throw new PricingError("BAD_STEP", "Quantity must be a multiple of the step");
}

export function formatWeight(grams: number): string {
  return grams % 1000 === 0 ? `${grams / 1000} kg` : `${(grams / 1000).toString().replace(/\.?0+$/, "")} kg`;
}

export interface CartLineInput {
  productId: string;
  grams: number;
}

export interface TotalsInput {
  subtotalCents: Cents;
  minOrderCents: Cents;
  deliveryFeeCents: Cents;
  freeDeliveryOverCents?: Cents | null;
}

export interface Totals {
  subtotalCents: Cents;
  deliveryFeeCents: Cents;
  totalCents: Cents;
  minOrderCents: Cents;
  shortfallCents: Cents;
  meetsMinimum: boolean;
}

/** Minimum order applies to merchandise subtotal only, never the delivery fee. */
export function computeTotals(i: TotalsInput): Totals {
  const free = i.freeDeliveryOverCents != null && i.subtotalCents >= i.freeDeliveryOverCents;
  const deliveryFeeCents = free ? 0 : i.deliveryFeeCents;
  const shortfallCents = Math.max(0, i.minOrderCents - i.subtotalCents);
  return {
    subtotalCents: i.subtotalCents,
    deliveryFeeCents,
    totalCents: i.subtotalCents + deliveryFeeCents,
    minOrderCents: i.minOrderCents,
    shortfallCents,
    meetsMinimum: shortfallCents === 0 && i.subtotalCents > 0,
  };
}
