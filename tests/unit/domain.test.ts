import { describe, expect, it } from "vitest";
import { computeTotals, lineTotalCents, validateQuantity, formatWeight, PricingError } from "@/domain/pricing";
import {
  availableSlots,
  berlinToUtc,
  findZoneForPostcode,
  isSlotBookable,
  isValidPostcode,
  parsePostcodePatterns,
  postcodeMatches,
} from "@/domain/delivery";
import { canTransitionFulfillment, canTransitionPayment, paymentStatusAfterRefunds } from "@/domain/order-state";
import { buildWhatsappMessage, normalizeWhatsappNumber, whatsappLink } from "@/domain/whatsapp";
import { formatMoney } from "@/domain/money";

const product = {
  id: "p",
  pricePerKgCents: 1499,
  stepGrams: 500,
  minGrams: 1000,
  maxGrams: 10000,
  isAvailable: true,
};

describe("pricing", () => {
  it("computes line totals in integer cents", () => {
    expect(lineTotalCents(1499, 1000)).toBe(1499);
    expect(lineTotalCents(1499, 2000)).toBe(2998);
    expect(lineTotalCents(1499, 1500)).toBe(2249); // 2248.5 rounds half up
    expect(lineTotalCents(2799, 500)).toBe(1400); // 1399.5 -> 1400
    expect(Number.isInteger(lineTotalCents(1333, 3500))).toBe(true);
  });
  it("rejects invalid quantities", () => {
    expect(() => lineTotalCents(100, 0)).toThrow(PricingError);
    expect(() => validateQuantity(product, 1250)).toThrow(/multiple/);
    expect(() => validateQuantity(product, 500)).toThrow(/minimum/);
    expect(() => validateQuantity(product, 10500)).toThrow(/maximum/);
    expect(() => validateQuantity({ ...product, isAvailable: false }, 1000)).toThrow(/unavailable/);
    expect(() => validateQuantity(product, 1500)).not.toThrow();
  });
  it("formats weights", () => {
    expect(formatWeight(1000)).toBe("1 kg");
    expect(formatWeight(1500)).toBe("1.5 kg");
  });
});

describe("minimum order", () => {
  it("blocks below €150 and reports shortfall", () => {
    const t = computeTotals({
      subtotalCents: 11000,
      minOrderCents: 15000,
      deliveryFeeCents: 500,
    });
    expect(t.meetsMinimum).toBe(false);
    expect(t.shortfallCents).toBe(4000);
    expect(t.totalCents).toBe(11500);
  });
  it("allows exactly €150 and excludes delivery fee from the threshold", () => {
    expect(
      computeTotals({
        subtotalCents: 15000,
        minOrderCents: 15000,
        deliveryFeeCents: 0,
      }).meetsMinimum,
    ).toBe(true);
    // 14,500 + 600 delivery = 15,100 gross but merchandise is still short
    expect(
      computeTotals({
        subtotalCents: 14500,
        minOrderCents: 15000,
        deliveryFeeCents: 600,
      }).meetsMinimum,
    ).toBe(false);
  });
  it("applies free-delivery threshold", () => {
    const t = computeTotals({
      subtotalCents: 20000,
      minOrderCents: 15000,
      deliveryFeeCents: 500,
      freeDeliveryOverCents: 20000,
    });
    expect(t.deliveryFeeCents).toBe(0);
  });
  it("empty cart never meets minimum", () => {
    expect(computeTotals({ subtotalCents: 0, minOrderCents: 0, deliveryFeeCents: 0 }).meetsMinimum).toBe(false);
  });
});

describe("delivery area", () => {
  const zones = [
    {
      id: "berlin",
      isActive: true,
      postcodes: [{ pattern: "10*" }, { pattern: "12*" }, { pattern: "14199" }],
    },
    { id: "off", isActive: false, postcodes: [{ pattern: "80*" }] },
    { id: "narrow", isActive: true, postcodes: [{ pattern: "101*" }] },
  ];
  it("validates postcode shape", () => {
    expect(isValidPostcode("10115")).toBe(true);
    expect(isValidPostcode("1011")).toBe(false);
    expect(isValidPostcode("abcde")).toBe(false);
  });
  it("matches exact and prefix patterns", () => {
    expect(postcodeMatches("10115", "101*")).toBe(true);
    expect(postcodeMatches("10115", "10115")).toBe(true);
    expect(postcodeMatches("10115", "102*")).toBe(false);
  });
  it("finds the most specific active zone only", () => {
    expect(findZoneForPostcode(zones, "10115")?.id).toBe("narrow");
    expect(findZoneForPostcode(zones, "12345")?.id).toBe("berlin");
    expect(findZoneForPostcode(zones, "80331")).toBeNull();
    expect(findZoneForPostcode(zones, "20095")).toBeNull();
  });
  it("parses admin input", () => {
    expect(parsePostcodePatterns("10*, 12345 ; bad, 1*\n99999")).toEqual(["10*", "12345", "1*", "99999"]);
  });
});

describe("delivery slots", () => {
  const slots = [
    {
      id: "sat",
      weekday: 6,
      startTime: "10:00",
      endTime: "14:00",
      isActive: true,
    },
    {
      id: "wed",
      weekday: 3,
      startTime: "16:00",
      endTime: "20:00",
      isActive: true,
    },
    {
      id: "off",
      weekday: 1,
      startTime: "10:00",
      endTime: "14:00",
      isActive: false,
    },
  ];
  // Monday 2026-06-01 09:00 Berlin (CEST = UTC+2)
  const now = berlinToUtc("2026-06-01", "09:00");
  it("converts Berlin time across DST", () => {
    expect(berlinToUtc("2026-06-01", "09:00").toISOString()).toBe("2026-06-01T07:00:00.000Z");
    expect(berlinToUtc("2026-01-15", "09:00").toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });
  it("lists only configured weekdays within lead time and horizon", () => {
    const opts = availableSlots(slots, now, 24, 14);
    expect(opts.every((o) => o.slotId !== "off")).toBe(true);
    expect(opts[0]).toMatchObject({ slotId: "wed", date: "2026-06-03" });
    expect(opts.some((o) => o.date === "2026-06-06" && o.slotId === "sat")).toBe(true);
    expect(opts.every((o) => o.date <= "2026-06-15")).toBe(true);
  });
  it("applies lead time", () => {
    // Wed 16:00 is < 72h away from Monday 09:00 -> excluded with 72h lead
    expect(availableSlots(slots, now, 72, 14).some((o) => o.date === "2026-06-03")).toBe(false);
  });
  it("validates a chosen slot/date pair", () => {
    expect(isSlotBookable(slots, "sat", "2026-06-06", now, 24, 14)).toBe(true);
    expect(isSlotBookable(slots, "sat", "2026-06-07", now, 24, 14)).toBe(false); // wrong weekday
    expect(isSlotBookable(slots, "sat", "2026-05-30", now, 24, 14)).toBe(false); // past
    expect(isSlotBookable(slots, "nope", "2026-06-06", now, 24, 14)).toBe(false);
  });
});

describe("order state", () => {
  it("allows forward fulfillment flow only", () => {
    expect(canTransitionFulfillment("AWAITING_FORWARDING", "FORWARDED")).toBe(true);
    expect(canTransitionFulfillment("FORWARDED", "AWAITING_FORWARDING")).toBe(true); // undo mistaken mark
    expect(canTransitionFulfillment("AWAITING_FORWARDING", "DELIVERED")).toBe(false);
    expect(canTransitionFulfillment("DELIVERED", "PREPARING")).toBe(false);
    expect(canTransitionFulfillment("CANCELLED", "FORWARDED")).toBe(false);
  });
  it("never downgrades a paid order from late failure/expiry events", () => {
    expect(canTransitionPayment("PAID", "PAYMENT_FAILED")).toBe(false);
    expect(canTransitionPayment("PAID", "CANCELLED")).toBe(false);
    expect(canTransitionPayment("PAID", "PENDING_PAYMENT")).toBe(false);
    expect(canTransitionPayment("PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canTransitionPayment("CANCELLED", "PAID")).toBe(true);
    expect(canTransitionPayment("REFUNDED", "PAID")).toBe(false);
  });
  it("derives refund status from totals", () => {
    expect(paymentStatusAfterRefunds(15000, 0)).toBe("PAID");
    expect(paymentStatusAfterRefunds(15000, 100)).toBe("PARTIALLY_REFUNDED");
    expect(paymentStatusAfterRefunds(15000, 15000)).toBe("REFUNDED");
  });
});

describe("whatsapp", () => {
  const order = {
    number: 10042,
    customerName: "Example Customer",
    phone: "+4915112345678",
    street: "Example Street 12",
    postalCode: "12345",
    city: "Berlin",
    items: [
      { productName: "Beef Cubes", quantityGrams: 3000 },
      { productName: "Chicken Breast", quantityGrams: 4500 },
    ],
    totalCents: 16500,
    paymentStatus: "PAID",
    deliveryDate: "2026-06-06",
    slotStartTime: "10:00",
    slotEndTime: "14:00",
    deliveryInstructions: "Ring twice",
  };
  it("builds the message with all required fields", () => {
    const m = buildWhatsappMessage(order);
    for (const s of [
      "NEW HALAL FRESH ORDER",
      "#HF-10042",
      "Example Customer",
      "+4915112345678",
      "Example Street 12",
      "12345 Berlin",
      "- Beef Cubes — 3 kg",
      "- Chicken Breast — 4.5 kg",
      "PAID",
      "Saturday",
      "10:00–14:00",
      "Ring twice",
    ])
      expect(m).toContain(s);
    expect(m).toContain(formatMoney(16500, "de"));
  });
  it("omits empty instructions", () => {
    expect(buildWhatsappMessage({ ...order, deliveryInstructions: "  " })).not.toContain("Instructions");
  });
  it("creates a url-encoded wa.me link", () => {
    const link = whatsappLink("4915112345678", "A&B\nÄ");
    expect(link).toBe("https://wa.me/4915112345678?text=A%26B%0A%C3%84");
  });
  it("normalizes numbers and rejects national format", () => {
    expect(normalizeWhatsappNumber("+49 151 1234 5678")).toBe("4915112345678");
    expect(normalizeWhatsappNumber("0049 151 12345678")).toBe("4915112345678");
    expect(normalizeWhatsappNumber("0151 12345678")).toBeNull();
    expect(normalizeWhatsappNumber("abc")).toBeNull();
  });
});
