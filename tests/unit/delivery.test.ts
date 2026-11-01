import { describe, expect, it } from "vitest";
import {
  berlinToUtc,
  cutoffFor,
  expandPostcodeRange,
  isoWeekdayOf,
  isValidPostcode,
  nextDeliverySlot,
  nthWeekdayOfMonth,
  parsePostcodeList,
  type ScheduleLike,
} from "@/domain/delivery";

const weekly = (weekday: number, cutoffHoursBefore: number, windowStart = "14:00", windowEnd = "18:00"): ScheduleLike => ({
  kind: "WEEKLY",
  weekday,
  nth: null,
  windowStart,
  windowEnd,
  cutoffHoursBefore,
  isActive: true,
});
const monSat24 = [1, 2, 3, 4, 5, 6].map((d) => weekly(d, 24));
const next = (schedules: ScheduleLike[], nowBerlin: [string, string], blackouts: string[] = [], horizonDays = 90) =>
  nextDeliverySlot({ schedules, blackoutDates: new Set(blackouts), now: berlinToUtc(...nowBerlin), horizonDays });

describe("postcodes", () => {
  it("validates 5 digits and keeps leading zeros", () => {
    expect(isValidPostcode("10115")).toBe(true);
    expect(isValidPostcode("03046")).toBe(true);
    expect(isValidPostcode(" 03 046 ")).toBe(true);
    expect(isValidPostcode("3046")).toBe(false);
    expect(isValidPostcode("1011a")).toBe(false);
    expect(isValidPostcode("101155")).toBe(false);
    expect(isValidPostcode("")).toBe(false);
  });
  it("expands ranges as zero-padded strings", () => {
    expect(expandPostcodeRange("03042", "03045")).toEqual(["03042", "03043", "03044", "03045"]);
    expect(expandPostcodeRange("14770", "14776")).toHaveLength(7);
    expect(expandPostcodeRange("14776", "14770")).toEqual([]);
  });
  it("parses admin lists with ranges and reports invalid tokens", () => {
    const r = parsePostcodeList("10115, 14467-14469 03046;abc 123");
    expect(r.postcodes).toEqual(["10115", "14467", "14468", "14469", "03046"]);
    expect(r.invalid).toEqual(["abc", "123"]);
  });
});

describe("calendar helpers", () => {
  it("ISO weekday and nth weekday", () => {
    expect(isoWeekdayOf("2026-11-02")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-11-08")).toBe(7); // Sunday
    expect(nthWeekdayOfMonth("2026-11-07")).toBe(1);
    expect(nthWeekdayOfMonth("2026-11-14")).toBe(2);
    expect(nthWeekdayOfMonth("2026-11-28")).toBe(4);
  });
});

describe("next delivery slot", () => {
  // 2026-11-04 is a Wednesday (CET, UTC+1).
  it("takes tomorrow when the 24h cutoff has not passed", () => {
    const s = next(monSat24, ["2026-11-04", "13:59"]);
    expect(s).toMatchObject({ date: "2026-11-05", windowStart: "14:00", windowEnd: "18:00" });
  });
  it("moves to the following day exactly at and after the cutoff", () => {
    expect(next(monSat24, ["2026-11-04", "14:00"])?.date).toBe("2026-11-06"); // cutoff instant has passed
    expect(next(monSat24, ["2026-11-04", "14:01"])?.date).toBe("2026-11-06");
  });
  it("Saturday after the cutoff goes to next week (Sunday skipped, Monday cutoff = Sunday 14:00)", () => {
    // Fri 2026-11-06 15:00: Sat 14:00 cutoff (Fri 14:00) passed. Sunday never delivered. Monday cutoff is Sun 14:00 -> still open.
    expect(next(monSat24, ["2026-11-06", "15:00"])?.date).toBe("2026-11-09");
  });
  it("skips Sunday even when a Sunday schedule exists", () => {
    const withSunday = [...monSat24, weekly(7, 24)];
    expect(next(withSunday, ["2026-11-07", "20:00"])?.date).toBe("2026-11-09"); // Sat 7th -> Mon 9th
  });
  it("skips blackout dates", () => {
    expect(next(monSat24, ["2026-11-04", "09:00"], ["2026-11-05"])?.date).toBe("2026-11-06");
    expect(next(monSat24, ["2026-11-04", "09:00"], ["2026-11-05", "2026-11-06", "2026-11-07"])?.date).toBe("2026-11-09");
  });
  it("48h route: Tuesday window closes Sunday 14:00", () => {
    const west = [weekly(2, 48)];
    expect(next(west, ["2026-11-01", "13:59"])?.date).toBe("2026-11-03"); // Sunday 13:59 -> this Tuesday
    expect(next(west, ["2026-11-01", "14:00"])?.date).toBe("2026-11-10"); // Sunday 14:00 -> next Tuesday
    expect(cutoffFor("2026-11-03", "14:00", 48).toISOString()).toBe(berlinToUtc("2026-11-01", "14:00").toISOString());
  });
  it("returns the earliest of several schedules and honours inactive ones", () => {
    const off = { ...weekly(3, 0), isActive: false };
    const s = next([weekly(5, 24), weekly(4, 24), off], ["2026-11-02", "08:00"]);
    expect(s?.date).toBe("2026-11-05");
  });
  it("returns null when nothing is bookable within the horizon", () => {
    expect(next([], ["2026-11-02", "08:00"])).toBeNull();
    expect(next([weekly(2, 48)], ["2026-11-02", "08:00"], [], 3)).toBeNull();
  });
  it("monthly rule: first Saturday with 7-day cutoff", () => {
    const monthly: ScheduleLike = { ...weekly(6, 7 * 24), kind: "NTH_WEEKDAY_OF_MONTH", nth: 1 };
    // Sat 2026-11-07 is the first Saturday; cutoff Sat 2026-10-31 14:00.
    expect(next([monthly], ["2026-10-31", "13:59"])?.date).toBe("2026-11-07");
    expect(next([monthly], ["2026-10-31", "14:00"])?.date).toBe("2026-12-05"); // cutoff passed -> next month
    expect(next([monthly], ["2026-11-08", "09:00"])?.date).toBe("2026-12-05");
  });
  it("monthly rule skips a blacked-out first Saturday", () => {
    const monthly: ScheduleLike = { ...weekly(6, 7 * 24), kind: "NTH_WEEKDAY_OF_MONTH", nth: 1 };
    expect(next([monthly], ["2026-10-01", "09:00"], ["2026-11-07"])?.date).toBe("2026-12-05");
  });
});

describe("DST", () => {
  it("converts Berlin wall-clock to UTC on both sides of the change", () => {
    expect(berlinToUtc("2026-03-28", "14:00").toISOString()).toBe("2026-03-28T13:00:00.000Z"); // CET
    expect(berlinToUtc("2026-03-29", "14:00").toISOString()).toBe("2026-03-29T12:00:00.000Z"); // CEST
    expect(berlinToUtc("2026-10-24", "14:00").toISOString()).toBe("2026-10-24T12:00:00.000Z"); // CEST
    expect(berlinToUtc("2026-10-25", "14:00").toISOString()).toBe("2026-10-25T13:00:00.000Z"); // CET
  });
  it("spring forward: Tuesday 2026-03-31 window, 48h cutoff stays Sunday 14:00 local", () => {
    const west = [weekly(2, 48)];
    // Sunday 2026-03-29 is the change day (23h). 48h elapsed would be 15:00 local; calendar days keep 14:00.
    expect(cutoffFor("2026-03-31", "14:00", 48).toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(next(west, ["2026-03-29", "13:59"])?.date).toBe("2026-03-31");
    expect(next(west, ["2026-03-29", "14:00"])?.date).toBe("2026-04-07");
  });
  it("fall back: Tuesday 2026-10-27 window, 48h cutoff stays Sunday 14:00 local", () => {
    const west = [weekly(2, 48)];
    expect(cutoffFor("2026-10-27", "14:00", 48).toISOString()).toBe("2026-10-25T13:00:00.000Z");
    expect(next(west, ["2026-10-25", "13:59"])?.date).toBe("2026-10-27");
    expect(next(west, ["2026-10-25", "14:00"])?.date).toBe("2026-11-03");
  });
  it("24h cutoff on the day after the spring change", () => {
    // Mon 2026-03-30 14:00 window; cutoff Sun 2026-03-29 14:00 CEST = 12:00Z.
    expect(cutoffFor("2026-03-30", "14:00", 24).toISOString()).toBe("2026-03-29T12:00:00.000Z");
  });
  it("hours that are not whole days are subtracted as elapsed time", () => {
    // 36h before Tue 14:00 (CET) = Mon 02:00 local.
    expect(cutoffFor("2026-11-03", "14:00", 36).toISOString()).toBe(berlinToUtc("2026-11-02", "02:00").toISOString());
  });
});
