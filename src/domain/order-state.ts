import type { FulfillmentStatus, PaymentStatus } from "@prisma/client";

const FULFILLMENT_FLOW: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  AWAITING_FORWARDING: ["FORWARDED", "CANCELLED"],
  FORWARDED: ["CONFIRMED_BY_BUTCHER", "AWAITING_FORWARDING", "CANCELLED"],
  CONFIRMED_BY_BUTCHER: ["PREPARING", "CANCELLED"],
  PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransitionFulfillment(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return FULFILLMENT_FLOW[from].includes(to);
}

export function nextFulfillmentOptions(from: FulfillmentStatus): FulfillmentStatus[] {
  return FULFILLMENT_FLOW[from];
}

/**
 * Payment transitions tolerate out-of-order webhooks: a late "failed"/"expired" can never
 * downgrade a paid order, and refunds only apply to paid orders.
 */
const PAYMENT_FLOW: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["PAID", "PENDING_PAYMENT", "CANCELLED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED", "PARTIALLY_REFUNDED"],
  REFUNDED: [],
  CANCELLED: ["PAID"], // late success after our expiry must still win: money was taken
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || PAYMENT_FLOW[from].includes(to);
}

export function paymentStatusAfterRefunds(totalCents: number, refundedCents: number): PaymentStatus {
  if (refundedCents <= 0) return "PAID";
  return refundedCents >= totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

export function orderNumberLabel(n: number): string {
  return `HF-${n}`;
}
