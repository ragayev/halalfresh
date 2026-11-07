import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { allowedNext, assertTransition, isTerminal, orderNumberLabel, TransitionError } from "@/domain/order-state";
import { cashEligibility } from "@/domain/payment-eligibility";
import { normalizePhone } from "@/domain/phone";

const t = (from: OrderStatus, to: OrderStatus, method: "PAYPAL" | "CASH" = "PAYPAL", actor: "admin" | "customer" | "webhook" = "admin", reason?: string) =>
  assertTransition({ from, to, method, actor, reason });
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TransitionError) return e.code;
    throw e;
  }
  return "OK";
};

describe("state machine", () => {
  it("happy paths", () => {
    for (const [a, b] of [["NEW", "ACCEPTED"], ["ACCEPTED", "PREPARING"], ["PREPARING", "WEIGHED"], ["WEIGHED", "PAID"], ["PAID", "OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "DELIVERED"]] as const)
      expect(code(() => t(a, b, "PAYPAL", "webhook"))).toBe("OK");
    for (const [a, b] of [["WEIGHED", "OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "DELIVERED_UNPAID"], ["DELIVERED_UNPAID", "CASH_COLLECTED"]] as const)
      expect(code(() => t(a, b, "CASH"))).toBe("OK");
  });
  it("rejects skipping steps and going backwards", () => {
    expect(code(() => t("NEW", "WEIGHED"))).toBe("INVALID_TRANSITION");
    expect(code(() => t("ACCEPTED", "NEW"))).toBe("INVALID_TRANSITION");
    expect(code(() => t("PREPARING", "PAID"))).toBe("INVALID_TRANSITION");
  });
  it("terminal states have no exits", () => {
    for (const s of ["DELIVERED", "CASH_COLLECTED", "REFUSED_AT_DOOR", "CANCELLED"] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(allowedNext(s, "PAYPAL")).toEqual([]);
    }
  });
  it("PayPal orders are dispatched only after PAID", () => {
    expect(code(() => t("WEIGHED", "OUT_FOR_DELIVERY", "PAYPAL"))).toBe("METHOD_MISMATCH");
    expect(code(() => t("PAYMENT_OVERDUE", "OUT_FOR_DELIVERY", "PAYPAL"))).toBe("INVALID_TRANSITION");
  });
  it("cash and PayPal paths do not cross", () => {
    expect(code(() => t("WEIGHED", "PAID", "CASH"))).toBe("METHOD_MISMATCH");
    expect(code(() => t("OUT_FOR_DELIVERY", "DELIVERED_UNPAID", "PAYPAL"))).toBe("METHOD_MISMATCH");
    expect(code(() => t("OUT_FOR_DELIVERY", "DELIVERED", "CASH"))).toBe("METHOD_MISMATCH");
  });
  it("customer may cancel only from NEW/ACCEPTED", () => {
    expect(code(() => t("NEW", "CANCELLED", "PAYPAL", "customer"))).toBe("OK");
    expect(code(() => t("ACCEPTED", "CANCELLED", "PAYPAL", "customer"))).toBe("OK");
    for (const s of ["PREPARING", "WEIGHED", "PAID", "OUT_FOR_DELIVERY"] as const)
      expect(code(() => t(s, "CANCELLED", "PAYPAL", "customer"))).toBe("CUSTOMER_CANNOT_CANCEL");
  });
  it("admin cancel needs a reason", () => {
    expect(code(() => t("PREPARING", "CANCELLED"))).toBe("REASON_REQUIRED");
    expect(code(() => t("PREPARING", "CANCELLED", "PAYPAL", "admin", "  "))).toBe("REASON_REQUIRED");
    expect(code(() => t("PREPARING", "CANCELLED", "PAYPAL", "admin", "out of stock"))).toBe("OK");
  });
  it("overdue reminder path", () => {
    expect(code(() => t("WEIGHED", "PAYMENT_OVERDUE"))).toBe("OK");
    expect(code(() => t("PAYMENT_OVERDUE", "PAID", "PAYPAL", "webhook"))).toBe("OK");
  });
  it("formats order numbers", () => expect(orderNumberLabel(123)).toBe("HF-000123"));
});

describe("cash eligibility", () => {
  it("first-time phone cannot pay cash", () => {
    expect(cashEligibility({ completedOrders: 0, refusedCount: 0, blockedCash: false })).toEqual({ allowed: false, reason: "FIRST_ORDER" });
  });
  it("needs a completed order, zero refusals, no block", () => {
    expect(cashEligibility({ completedOrders: 1, refusedCount: 0, blockedCash: false }).allowed).toBe(true);
    expect(cashEligibility({ completedOrders: 3, refusedCount: 1, blockedCash: false })).toEqual({ allowed: false, reason: "REFUSED_BEFORE" });
    expect(cashEligibility({ completedOrders: 3, refusedCount: 0, blockedCash: true })).toEqual({ allowed: false, reason: "BLOCKED" });
  });
});

describe("phone normalisation", () => {
  it("normalises to E.164", () => {
    expect(normalizePhone("0151 1234 5678")).toBe("+4915112345678");
    expect(normalizePhone("+49 (151) 1234-5678")).toBe("+4915112345678");
    expect(normalizePhone("0049 151 12345678")).toBe("+4915112345678");
    expect(normalizePhone("+90 532 123 45 67")).toBe("+905321234567");
  });
  it("rejects junk", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("same number in different formats is one identity", () => {
    expect(normalizePhone("0151/12345678")).toBe(normalizePhone("+49 151 12345678"));
  });
});

import { totpAt, verifyTotp, base32Decode } from "@/lib/totp";
describe("TOTP", () => {
  // RFC 6238 appendix B test vector (SHA1, secret "12345678901234567890"), 8 digits -> last 6 compared here.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it("matches the RFC 6238 vector", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpAt(secret, 59_000, 8)).toBe("94287082");
    expect(totpAt(secret, 1111111109_000, 8)).toBe("07081804");
  });
  it("accepts adjacent step, rejects wrong/old/non-numeric codes", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
    expect(verifyTotp(secret, "", now)).toBe(false);
  });
});
