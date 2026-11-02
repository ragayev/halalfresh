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

// ---------------------------------------------------------------------------------------------
// SEPA-aware fulfillment policy. Payment status and fulfillment status stay independent; this is
// the single place that decides whether fulfillment may move forward given the payment state.
// ---------------------------------------------------------------------------------------------

export interface PaymentFacts {
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  sepaInitiatedAt: Date | null;
  earlyFulfillmentAuthorizedAt: Date | null;
}

/**
 * OPEN               payment settled: fulfillment proceeds normally
 * NEEDS_AUTHORIZATION SEPA debit initiated but not settled; admin must explicitly accept the risk first
 * EARLY_AUTHORIZED   admin accepted the collection risk; fulfillment proceeds while SEPA is processing
 * BLOCKED            checkout merely created, payment failed or cancelled: nothing may be prepared
 */
export type FulfillmentGate = "OPEN" | "NEEDS_AUTHORIZATION" | "EARLY_AUTHORIZED" | "BLOCKED";

export function fulfillmentGate(o: PaymentFacts): FulfillmentGate {
  switch (o.paymentStatus) {
    case "PAID":
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return "OPEN";
    case "PENDING_PAYMENT":
      if (!o.sepaInitiatedAt) return "BLOCKED";
      return o.earlyFulfillmentAuthorizedAt ? "EARLY_AUTHORIZED" : "NEEDS_AUTHORIZATION";
    case "PAYMENT_FAILED":
    case "CANCELLED":
      return "BLOCKED";
  }
}

/**
 * Whether the fulfillment step `to` is allowed right now. Backward moves and cancellation are never
 * gated by payment. One exception to the failed-payment block: an order the admin already put on the
 * road under an early authorization may still be recorded as delivered, so reality stays reflected.
 */
export function fulfillmentMoveAllowed(o: PaymentFacts, to: FulfillmentStatus): { ok: true } | { ok: false; reason: string } {
  if (!canTransitionFulfillment(o.fulfillmentStatus, to)) return { ok: false, reason: `Cannot move from ${o.fulfillmentStatus} to ${to}` };
  if (to === "CANCELLED" || to === "AWAITING_FORWARDING") return { ok: true };
  const gate = fulfillmentGate(o);
  if (gate === "OPEN" || gate === "EARLY_AUTHORIZED") return { ok: true };
  if (gate === "NEEDS_AUTHORIZATION")
    return { ok: false, reason: "SEPA payment is still processing. Authorize fulfillment explicitly or wait for settlement." };
  if (o.paymentStatus === "PAYMENT_FAILED" && o.earlyFulfillmentAuthorizedAt && o.fulfillmentStatus === "OUT_FOR_DELIVERY" && to === "DELIVERED")
    return { ok: true };
  return { ok: false, reason: o.paymentStatus === "PAYMENT_FAILED" ? "Payment failed" : "Order is not paid yet" };
}

/** Early authorization is only meaningful while a SEPA debit is processing on a live order. */
export function canAuthorizeEarlyFulfillment(o: PaymentFacts): { ok: true } | { ok: false; reason: string } {
  if (o.fulfillmentStatus === "CANCELLED" || o.fulfillmentStatus === "DELIVERED") return { ok: false, reason: "Order is already closed" };
  if (o.paymentStatus !== "PENDING_PAYMENT" || !o.sepaInitiatedAt) return { ok: false, reason: "No SEPA payment is processing for this order" };
  if (o.earlyFulfillmentAuthorizedAt) return { ok: false, reason: "Already authorized" };
  return { ok: true };
}

/** Payment indicator shown to customers and admins; never conflated with delivery progress. */
export type PaymentView = "UNPAID" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export function paymentView(o: Pick<PaymentFacts, "paymentStatus" | "sepaInitiatedAt">): PaymentView {
  switch (o.paymentStatus) {
    case "PENDING_PAYMENT":
      return o.sepaInitiatedAt ? "PROCESSING" : "UNPAID";
    case "PAID":
      return "PAID";
    case "PAYMENT_FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "REFUNDED":
      return "REFUNDED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
  }
}

// ---- Customer progress timeline ----

export const TIMELINE_STEPS = ["RECEIVED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

/** Index of the step the order has reached (internal forwarding states collapse into "received"). */
export function timelineIndex(f: FulfillmentStatus): number {
  switch (f) {
    case "AWAITING_FORWARDING":
    case "FORWARDED":
    case "CANCELLED":
      return 0;
    case "CONFIRMED_BY_BUTCHER":
      return 1;
    case "PREPARING":
      return 2;
    case "OUT_FOR_DELIVERY":
      return 3;
    case "DELIVERED":
      return 4;
  }
}

/** The order is "received" once payment was initiated (SEPA) or settled. A bare checkout is not an order yet. */
export function isOrderReceived(o: Pick<PaymentFacts, "paymentStatus" | "sepaInitiatedAt">): boolean {
  return o.paymentStatus !== "PENDING_PAYMENT" ? o.paymentStatus !== "CANCELLED" : !!o.sepaInitiatedAt;
}

// ---- Polling policy (customer page) ----

export function isFulfillmentTerminal(f: FulfillmentStatus) {
  return f === "DELIVERED" || f === "CANCELLED";
}
/** Payment states that can still change without customer action. FAILED/CANCELLED/REFUNDED are final. */
export function isPaymentSettling(o: Pick<PaymentFacts, "paymentStatus">) {
  return o.paymentStatus === "PENDING_PAYMENT";
}

/** Milliseconds until the next status check, or null to stop polling for good. */
export function pollIntervalMs(o: Pick<PaymentFacts, "paymentStatus" | "fulfillmentStatus">, opts: { redirectedFromCheckout?: boolean } = {}): number | null {
  const fulfilling = !isFulfillmentTerminal(o.fulfillmentStatus);
  const settling = isPaymentSettling(o);
  if (!fulfilling && !settling) return null;
  if (opts.redirectedFromCheckout && settling && o.fulfillmentStatus === "AWAITING_FORWARDING") return 3_000; // webhook usually lands within seconds
  if (fulfilling) return 20_000;
  return 60_000; // delivered but SEPA still settling: days, so check rarely
}

// ---- Admin attention ----

export type Attention = { level: "critical" | "action"; reason: string } | null;

export function adminAttention(o: PaymentFacts): Attention {
  const f = o.fulfillmentStatus;
  if (o.paymentStatus === "PAYMENT_FAILED" && o.sepaInitiatedAt && f !== "CANCELLED") {
    if (f === "DELIVERED") return { level: "critical", reason: "SEPA payment failed AFTER delivery: money not collected" };
    if (f === "OUT_FOR_DELIVERY") return { level: "critical", reason: "SEPA payment failed while out for delivery" };
    if (o.earlyFulfillmentAuthorizedAt) return { level: "critical", reason: "SEPA payment failed after early authorization" };
    return { level: "action", reason: "SEPA payment failed: do not fulfil" };
  }
  if (o.paymentStatus === "PENDING_PAYMENT" && o.sepaInitiatedAt && f !== "CANCELLED") {
    if (f === "DELIVERED") return { level: "action", reason: "Delivered, SEPA collection still pending" };
    if (!o.earlyFulfillmentAuthorizedAt && f === "AWAITING_FORWARDING")
      return { level: "action", reason: "SEPA pending: wait for settlement or authorize early fulfillment" };
    return { level: "action", reason: "Fulfilling on SEPA collection risk" };
  }
  if ((o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_REFUNDED") && f === "AWAITING_FORWARDING")
    return { level: "action", reason: "Paid: forward to butcher" };
  return null;
}
