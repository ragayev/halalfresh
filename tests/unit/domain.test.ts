import { describe, expect, it } from "vitest";
import { computeTotals, lineTotalCents, validateQuantity, formatWeight, PricingError } from "@/domain/pricing";
import { buildKevserMessage, customerWhatsappLink, normalizeWhatsappNumber, whatsappLink } from "@/domain/whatsapp";

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

describe("whatsapp", () => {
  const order = {
    number: 123,
    firstName: "Ayşe",
    lastName: "Yılmaz",
    phone: "+4915112345678",
    street: "Example Street 12",
    postalCode: "12345",
    city: "Berlin",
    deliveryDate: "2026-06-06",
    slotStartTime: "10:00",
    slotEndTime: "14:00",
    paymentMethod: "PAYPAL" as const,
    items: [
      { productName: "Kuzu But", requestedGrams: 2500 },
      { productName: "Dana Kıyma", requestedGrams: 1000 },
    ],
    estimatedTotalCents: 15000,
    maxTotalCents: 16500,
    notes: "Ring twice",
  };
  it("builds the Turkish Kevser template", () => {
    const m = buildKevserMessage(order);
    for (const s of [
      "🟢 Sipariş #HF-000123",
      "Müşteri: Ayşe Y. · +4915112345678",
      "Adres: Example Street 12, 12345 Berlin",
      "Teslimat: 6 Haziran Cumartesi, 10:00–14:00",
      "Ödeme: PayPal",
      "- Kuzu But · 2,5 kg",
      "- Dana Kıyma · 1,0 kg",
      "Tahmini:",
      "Max:",
      "Not: Ring twice",
    ])
      expect(m).toContain(s);
    expect(m).not.toContain("Yılmaz");
  });
  it("omits empty notes and labels cash", () => {
    const m = buildKevserMessage({ ...order, notes: "  ", paymentMethod: "CASH" });
    expect(m).not.toContain("Not:");
    expect(m).toContain("Ödeme: Nakit");
  });
  it("links a customer without prefilled text", () => expect(customerWhatsappLink("+4915112345678")).toBe("https://wa.me/4915112345678"));
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
