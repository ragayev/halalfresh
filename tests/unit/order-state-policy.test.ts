import { describe, expect, it } from "vitest";
import type { FulfillmentStatus, PaymentStatus } from "@prisma/client";
import {
  adminAttention,
  canAuthorizeEarlyFulfillment,
  fulfillmentGate,
  fulfillmentMoveAllowed,
  isOrderReceived,
  paymentView,
  pollIntervalMs,
  timelineIndex,
} from "@/domain/order-state";

const NOW = new Date();
const o = (paymentStatus: PaymentStatus, fulfillmentStatus: FulfillmentStatus, sepa = false, early = false) => ({
  paymentStatus,
  fulfillmentStatus,
  sepaInitiatedAt: sepa ? NOW : null,
  earlyFulfillmentAuthorizedAt: early ? NOW : null,
});

describe("fulfillment gate", () => {
  it("never opens for a merely created checkout", () => {
    expect(fulfillmentGate(o("PENDING_PAYMENT", "AWAITING_FORWARDING"))).toBe("BLOCKED");
    expect(fulfillmentMoveAllowed(o("PENDING_PAYMENT", "AWAITING_FORWARDING"), "FORWARDED").ok).toBe(false);
  });
  it("SEPA initiated needs explicit authorization; authorization opens it without paying", () => {
    expect(fulfillmentGate(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true))).toBe("NEEDS_AUTHORIZATION");
    expect(fulfillmentMoveAllowed(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true), "FORWARDED").ok).toBe(false);
    expect(fulfillmentGate(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true, true))).toBe("EARLY_AUTHORIZED");
    expect(fulfillmentMoveAllowed(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true, true), "FORWARDED").ok).toBe(true);
  });
  it("paid orders are open; failed and cancelled are blocked", () => {
    expect(fulfillmentGate(o("PAID", "AWAITING_FORWARDING"))).toBe("OPEN");
    expect(fulfillmentGate(o("PAYMENT_FAILED", "AWAITING_FORWARDING", true))).toBe("BLOCKED");
    expect(fulfillmentGate(o("CANCELLED", "CANCELLED"))).toBe("BLOCKED");
  });
  it("a failed payment stops further progress, except recording an already dispatched delivery", () => {
    const failedPrep = o("PAYMENT_FAILED", "PREPARING", true, true);
    expect(fulfillmentMoveAllowed(failedPrep, "OUT_FOR_DELIVERY").ok).toBe(false);
    expect(fulfillmentMoveAllowed(o("PAYMENT_FAILED", "OUT_FOR_DELIVERY", true, true), "DELIVERED").ok).toBe(true);
    expect(fulfillmentMoveAllowed(o("PAYMENT_FAILED", "OUT_FOR_DELIVERY", true, false), "DELIVERED").ok).toBe(false);
    expect(fulfillmentMoveAllowed(failedPrep, "CANCELLED").ok).toBe(true);
  });
  it("structural transition rules still apply on top of payment", () => {
    expect(fulfillmentMoveAllowed(o("PAID", "AWAITING_FORWARDING"), "DELIVERED").ok).toBe(false);
    expect(fulfillmentMoveAllowed(o("PAID", "PREPARING"), "CONFIRMED_BY_BUTCHER").ok).toBe(false);
    expect(fulfillmentMoveAllowed(o("PAID", "DELIVERED"), "OUT_FOR_DELIVERY").ok).toBe(false);
    expect(fulfillmentMoveAllowed(o("PAID", "OUT_FOR_DELIVERY"), "DELIVERED").ok).toBe(true);
  });
  it("early authorization applies only to a live order with a processing SEPA debit", () => {
    expect(canAuthorizeEarlyFulfillment(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true)).ok).toBe(true);
    expect(canAuthorizeEarlyFulfillment(o("PENDING_PAYMENT", "AWAITING_FORWARDING", false)).ok).toBe(false);
    expect(canAuthorizeEarlyFulfillment(o("PAID", "AWAITING_FORWARDING", true)).ok).toBe(false);
    expect(canAuthorizeEarlyFulfillment(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true, true)).ok).toBe(false);
    expect(canAuthorizeEarlyFulfillment(o("PENDING_PAYMENT", "CANCELLED", true)).ok).toBe(false);
  });
});

describe("customer-facing views", () => {
  it("payment indicator is independent of delivery progress", () => {
    expect(paymentView(o("PENDING_PAYMENT", "DELIVERED", true))).toBe("PROCESSING");
    expect(paymentView(o("PENDING_PAYMENT", "AWAITING_FORWARDING"))).toBe("UNPAID");
    expect(paymentView(o("PAYMENT_FAILED", "DELIVERED", true))).toBe("FAILED");
    expect(paymentView(o("PAID", "AWAITING_FORWARDING"))).toBe("PAID");
  });
  it("collapses internal forwarding states into the 'received' step", () => {
    expect(timelineIndex("AWAITING_FORWARDING")).toBe(0);
    expect(timelineIndex("FORWARDED")).toBe(0);
    expect(timelineIndex("CONFIRMED_BY_BUTCHER")).toBe(1);
    expect(timelineIndex("PREPARING")).toBe(2);
    expect(timelineIndex("OUT_FOR_DELIVERY")).toBe(3);
    expect(timelineIndex("DELIVERED")).toBe(4);
  });
  it("an order exists for the customer only after SEPA initiation or settlement", () => {
    expect(isOrderReceived(o("PENDING_PAYMENT", "AWAITING_FORWARDING"))).toBe(false);
    expect(isOrderReceived(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true))).toBe(true);
    expect(isOrderReceived(o("PAID", "AWAITING_FORWARDING"))).toBe(true);
    expect(isOrderReceived(o("CANCELLED", "CANCELLED"))).toBe(false);
  });
});

describe("polling policy", () => {
  it("stops for terminal states and polls lightly otherwise", () => {
    expect(pollIntervalMs(o("PAID", "DELIVERED"))).toBeNull();
    expect(pollIntervalMs(o("CANCELLED", "CANCELLED"))).toBeNull();
    expect(pollIntervalMs(o("REFUNDED", "CANCELLED"))).toBeNull();
    expect(pollIntervalMs(o("PAYMENT_FAILED", "CANCELLED"))).toBeNull();
    expect(pollIntervalMs(o("PAID", "PREPARING"))).toBe(20_000);
    expect(pollIntervalMs(o("PENDING_PAYMENT", "AWAITING_FORWARDING"), { redirectedFromCheckout: true })).toBe(3_000);
  });
  it("keeps checking slowly while a delivered order's SEPA debit settles, then stops", () => {
    expect(pollIntervalMs(o("PENDING_PAYMENT", "DELIVERED", true))).toBe(60_000);
    expect(pollIntervalMs(o("PAID", "DELIVERED", true))).toBeNull();
  });
});

describe("admin attention", () => {
  it("flags payment failure after delivery as critical", () => {
    expect(adminAttention(o("PAYMENT_FAILED", "DELIVERED", true, true))?.level).toBe("critical");
    expect(adminAttention(o("PAYMENT_FAILED", "OUT_FOR_DELIVERY", true, true))?.level).toBe("critical");
  });
  it("flags pending SEPA orders and paid orders awaiting forwarding", () => {
    expect(adminAttention(o("PENDING_PAYMENT", "AWAITING_FORWARDING", true))?.level).toBe("action");
    expect(adminAttention(o("PAID", "AWAITING_FORWARDING"))?.level).toBe("action");
    expect(adminAttention(o("PAID", "PREPARING"))).toBeNull();
    expect(adminAttention(o("PENDING_PAYMENT", "AWAITING_FORWARDING"))).toBeNull(); // bare checkout is noise
  });
});
