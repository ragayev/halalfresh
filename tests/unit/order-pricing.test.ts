import { describe, expect, it } from "vitest";
import { estimateOrder, exceedsTolerance, finalizeOrder } from "@/domain/pricing";

// €150.00 estimated, 10% tolerance -> €165.00 max. One line of 10 kg at €15/kg keeps the maths readable.
const est = estimateOrder([{ pricePerKgCents: 1500, requestedGrams: 10000 }], 0, 1000);
const run = (grams: number) => finalizeOrder([{ pricePerKgCents: 1500, actualGrams: grams }], est.maxItemsCents, 0);

describe("order pricing (spec §5)", () => {
  it("estimates and caps", () => {
    expect(est.estimatedTotalCents).toBe(15000);
    expect(est.maxTotalCents).toBe(16500);
  });
  it("below estimate (and below minimum order) is still valid", () => {
    expect(run(9330).finalTotalCents).toBe(13995);
    const r = finalizeOrder([{ pricePerKgCents: 1400, actualGrams: 10000 }], est.maxItemsCents, 0);
    expect(r.finalTotalCents).toBe(14000);
  });
  it("within tolerance pays the weighed amount", () => {
    expect(finalizeOrder([{ pricePerKgCents: 1600, actualGrams: 10000 }], est.maxItemsCents, 0).finalTotalCents).toBe(16000);
  });
  it("above tolerance is capped and the excess is absorbed by the seller", () => {
    const r = finalizeOrder([{ pricePerKgCents: 1700, actualGrams: 10000 }], est.maxItemsCents, 0);
    expect(r.finalTotalCents).toBe(16500);
    expect(r.cappedAmountCents).toBe(500);
  });
  it("0 g line means unavailable and is excluded", () => {
    const e = estimateOrder(
      [
        { pricePerKgCents: 1500, requestedGrams: 5000 },
        { pricePerKgCents: 1500, requestedGrams: 5000 },
      ],
      0,
      1000,
    );
    const r = finalizeOrder(
      [
        { pricePerKgCents: 1500, actualGrams: 5000 },
        { pricePerKgCents: 1500, actualGrams: 0 },
      ],
      e.maxItemsCents,
      0,
    );
    expect(r.lineFinals).toEqual([7500, 0]);
    expect(r.finalTotalCents).toBe(7500);
    expect(r.cappedAmountCents).toBe(0);
  });
  it("delivery fee is outside the tolerance and the cap", () => {
    const e = estimateOrder([{ pricePerKgCents: 1500, requestedGrams: 10000 }], 490, 1000);
    expect(e.estimatedTotalCents).toBe(15490);
    expect(e.maxTotalCents).toBe(16990);
    expect(finalizeOrder([{ pricePerKgCents: 1700, actualGrams: 10000 }], e.maxItemsCents, 490).finalTotalCents).toBe(16990);
  });
  it("rounds half up, integers only", () => {
    expect(estimateOrder([{ pricePerKgCents: 1490, requestedGrams: 505 }], 0, 1000).lineEstimates[0]).toBe(752); // 752.45 -> 752
    expect(estimateOrder([{ pricePerKgCents: 1, requestedGrams: 500 }], 0, 1000).lineEstimates[0]).toBe(1); // 0.5 -> 1
  });
  it("flags lines weighed over requested + tolerance", () => {
    expect(exceedsTolerance(1000, 1100, 1000)).toBe(false);
    expect(exceedsTolerance(1000, 1101, 1000)).toBe(true);
  });
  it("rejects negative or fractional grams", () => {
    expect(() => run(-1)).toThrow();
    expect(() => run(1.5)).toThrow();
  });
});
