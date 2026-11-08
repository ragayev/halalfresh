import { describe, expect, it } from "vitest";
import { formatDeliveryDays, formatSlotDay } from "@/lib/format-delivery";
import de from "@/i18n/dictionaries/de.json";
import tr from "@/i18n/dictionaries/tr.json";

describe("delivery day wording", () => {
  it("german", () => {
    expect(formatDeliveryDays([2], "de", de.delivery)).toBe("jeden Dienstag");
    expect(formatDeliveryDays([1, 2, 3, 4, 5, 6], "de", de.delivery)).toBe("Montag bis Samstag");
    expect(formatDeliveryDays([3, 5], "de", de.delivery)).toBe("Mittwoch und Freitag");
    expect(formatSlotDay("2026-11-10", "de")).toBe("Dienstag, 10. November");
  });
  it("turkish", () => {
    expect(formatDeliveryDays([2], "tr", tr.delivery)).toBe("her Salı");
    expect(formatDeliveryDays([1, 2, 3, 4, 5, 6], "tr", tr.delivery)).toBe("Pazartesi – Cumartesi arası");
  });
  it("both dictionaries define the same delivery keys", () => {
    expect(Object.keys(tr.delivery).sort()).toEqual(Object.keys(de.delivery).sort());
  });
});
