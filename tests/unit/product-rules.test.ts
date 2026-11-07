import { describe, expect, it } from "vitest";
import {
  availabilityError, canTransition, duplicateSkus, hasConfirmedPrice, imageStatus, isHiddenFor, isPurchasable, isValidSku,
  priceLabel, purchaseBlocker, quantityConfigError, statusChangeError, unitsOf, type EligibilityInput,
} from "@/domain/product-rules";
import { lineTotalCents } from "@/domain/pricing";
import { bundleTotalGrams } from "@/domain/bundles";

const base: EligibilityInput = { status: "ACTIVE", isAvailable: true, priceConfirmed: true, pricePerKgCents: 1500 };

describe("status transitions", () => {
  it("allows publish, unpublish, archive and restore-to-draft only", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "DRAFT")).toBe(true);
    expect(canTransition("ACTIVE", "ARCHIVED")).toBe(true);
    expect(canTransition("ARCHIVED", "DRAFT")).toBe(true);
    expect(canTransition("ARCHIVED", "ACTIVE")).toBe(false);
  });
  it("keeps the legacy isHidden mirror consistent", () => {
    expect(isHiddenFor("ACTIVE")).toBe(false);
    expect(isHiddenFor("DRAFT")).toBe(true);
    expect(isHiddenFor("ARCHIVED")).toBe(true);
  });
  it("refuses to publish a bundle without a confirmed price, but allows a plain product to be listed as 'price coming soon'", () => {
    const bundle = { ...base, status: "DRAFT" as const, priceConfirmed: false, bundleItems: [{ grams: 1000, names: { de: "x" } }] };
    expect(statusChangeError(bundle, "ACTIVE")).toMatch(/Confirm/);
    expect(statusChangeError({ ...bundle, priceConfirmed: true }, "ACTIVE")).toBeNull();
    expect(statusChangeError({ ...base, status: "DRAFT", pricePerKgCents: 0, priceConfirmed: false }, "ACTIVE")).toBeNull();
    expect(statusChangeError({ ...base, status: "ARCHIVED" }, "ACTIVE")).toMatch(/Cannot move/);
  });
});

describe("eligibility", () => {
  it("is purchasable only when published, available and priced", () => {
    expect(isPurchasable(base)).toBe(true);
    expect(purchaseBlocker({ ...base, status: "DRAFT" })).toBe("NOT_LISTED");
    expect(purchaseBlocker({ ...base, status: "ARCHIVED" })).toBe("NOT_LISTED");
    expect(purchaseBlocker({ ...base, isAvailable: false })).toBe("UNAVAILABLE");
    expect(purchaseBlocker({ ...base, priceConfirmed: false })).toBe("NO_PRICE");
    expect(purchaseBlocker({ ...base, pricePerKgCents: 0 })).toBe("NO_PRICE");
    expect(purchaseBlocker({ ...base, bundleItems: [] })).toBe("BAD_BUNDLE");
  });
  it("treats 0 cents as never confirmed", () => {
    expect(hasConfirmedPrice({ priceConfirmed: true, pricePerKgCents: 0 })).toBe(false);
    expect(hasConfirmedPrice({ priceConfirmed: true, pricePerKgCents: 1 })).toBe(true);
  });
  it("only lets a priced, non-archived product be switched to available", () => {
    expect(availabilityError({ status: "ACTIVE", priceConfirmed: true, pricePerKgCents: 100 }, true)).toBeNull();
    expect(availabilityError({ status: "ACTIVE", priceConfirmed: false, pricePerKgCents: 100 }, true)).toMatch(/price/);
    expect(availabilityError({ status: "ARCHIVED", priceConfirmed: true, pricePerKgCents: 100 }, true)).toMatch(/Archived/);
    expect(availabilityError({ status: "ARCHIVED", priceConfirmed: false, pricePerKgCents: 0 }, false)).toBeNull();
  });
});

describe("supplier SKUs", () => {
  it("validates and deduplicates", () => {
    expect(isValidSku(" 032016001 ")).toBe(true);
    expect(isValidSku("32016128")).toBe(true);
    expect(isValidSku("ab")).toBe(false);
    expect(isValidSku("has space")).toBe(false);
    expect(duplicateSkus(["1234", " 1234", "5678"])).toEqual(["1234"]);
  });
});

describe("selling units", () => {
  it("uses 1000 per unit for piece and package, so integer maths is unchanged", () => {
    expect(unitsOf("KG", 1500)).toBe(1.5);
    expect(unitsOf("PACKAGE", 2000)).toBe(2);
    // 2 packages at €159.90 each
    expect(lineTotalCents(15990, 2000)).toBe(31980);
    // 1.5 kg at €13.99 rounds half-up on integer cents
    expect(lineTotalCents(1399, 1500)).toBe(2099);
  });
  it("requires whole-unit quantities for non-kg products", () => {
    expect(quantityConfigError("KG", { stepGrams: 500, minGrams: 500, maxGrams: 20000 })).toBeNull();
    expect(quantityConfigError("PACKAGE", { stepGrams: 500, minGrams: 1000, maxGrams: 5000 })).toMatch(/whole units/);
    expect(quantityConfigError("PIECE", { stepGrams: 1000, minGrams: 1000, maxGrams: 10000 })).toBeNull();
    expect(quantityConfigError("KG", { stepGrams: 1000, minGrams: 1500, maxGrams: 5000 })).toMatch(/multiple/);
    expect(priceLabel("PACKAGE")).toBe("package");
  });
  it("sums bundle weights", () => {
    expect(bundleTotalGrams([{ grams: 2000, names: { de: "a", tr: "a", en: "a" } }, { grams: 1500, names: { de: "b", tr: "b", en: "b" } }])).toBe(3500);
  });
});

describe("image fallback", () => {
  it("distinguishes none, placeholder-only and real photos", () => {
    expect(imageStatus([])).toBe("NONE");
    expect(imageStatus([{ url: "/images/products/default-product.svg" }])).toBe("FALLBACK");
    expect(imageStatus([{ url: "/images/products/dana/x.webp", isPlaceholder: true }])).toBe("FALLBACK");
    expect(imageStatus([{ url: "/images/products/dana/x.webp" }])).toBe("OK");
    expect(imageStatus([{ url: null }])).toBe("OK"); // database upload
  });
});
