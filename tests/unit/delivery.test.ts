import { describe, expect, it } from "vitest";
import { berlinToUtc, expandPostcodeRange, isoWeekdayOf, isValidPostcode, nthWeekdayOfMonth, parsePostcodeList } from "@/domain/delivery";
import { berlinHolidays, easterSunday, isWorkingDay, nextDeliveryDate, orderCutoffFor, previousWorkingDay } from "@/domain/delivery-dates";

const CORE = [1, 2, 3, 4, 5, 6];
const MON = [1]; // southeast tour
const TUE = [2]; // west tour
/** Next delivery date for a Berlin wall-clock "now". */
const next = (weekdays: number[], date: string, time: string, blackout: string[] = []) =>
  nextDeliveryDate({ weekdays, now: berlinToUtc(date, time), blackoutDates: new Set(blackout) });

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

describe("Berlin holidays and working days", () => {
  it("computes Easter and the Berlin holiday set", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    const h = berlinHolidays(2026);
    for (const d of ["2026-01-01", "2026-03-08", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"])
      expect(h.has(d), d).toBe(true);
    expect(h.has("2026-10-31")).toBe(false); // Reformationstag is not a Berlin holiday
  });
  it("Monday to Saturday, minus holidays and blackout dates", () => {
    expect(isWorkingDay("2026-11-07")).toBe(true); // Saturday
    expect(isWorkingDay("2026-11-08")).toBe(false); // Sunday
    expect(isWorkingDay("2026-12-25")).toBe(false);
    expect(isWorkingDay("2026-11-10", new Set(["2026-11-10"]))).toBe(false);
    expect(previousWorkingDay("2026-11-09")).toBe("2026-11-07"); // Monday -> Saturday
    expect(previousWorkingDay("2026-04-04")).toBe("2026-04-02"); // Saturday after Good Friday -> Thursday
  });
  it("order cutoff is 18:00 Berlin time on the working day before, across DST", () => {
    expect(orderCutoffFor("2026-11-07").toISOString()).toBe("2026-11-06T17:00:00.000Z"); // Fri 18:00 CET
    expect(orderCutoffFor("2026-03-30").toISOString()).toBe("2026-03-28T17:00:00.000Z"); // Sat 18:00 CET, DST starts Sunday
    expect(orderCutoffFor("2026-03-31").toISOString()).toBe("2026-03-30T16:00:00.000Z"); // Mon 18:00 CEST
  });
});

describe("next delivery date: core (Monday to Saturday)", () => {
  it("Friday 17:59 -> Saturday, which is tomorrow", () => {
    const n = next(CORE, "2026-11-06", "17:59");
    expect(n).toMatchObject({ date: "2026-11-07", isTomorrow: true });
  });
  it("Friday 18:01 -> Monday (Saturday cutoff passed)", () => {
    const n = next(CORE, "2026-11-06", "18:01");
    expect(n).toMatchObject({ date: "2026-11-09", isTomorrow: false });
  });
  it("Friday exactly 18:00 is already too late for Saturday", () => {
    expect(next(CORE, "2026-11-06", "18:00")?.date).toBe("2026-11-09");
  });
  it("Saturday before the cutoff -> Monday; after the cutoff -> Tuesday", () => {
    expect(next(CORE, "2026-11-07", "17:59")?.date).toBe("2026-11-09");
    expect(next(CORE, "2026-11-07", "18:01")?.date).toBe("2026-11-10");
  });
  it("Sunday -> Tuesday: Monday's cutoff was Saturday 18:00", () => {
    expect(next(CORE, "2026-11-08", "09:00")?.date).toBe("2026-11-10");
    expect(next(CORE, "2026-11-08", "23:59")?.date).toBe("2026-11-10");
  });
  it("Berlin public holiday: Wednesday before Good Friday", () => {
    // Fri 3 Apr (Karfreitag) and Mon 6 Apr (Ostermontag) are skipped; Saturday's cutoff is Thursday 18:00.
    expect(next(CORE, "2026-04-01", "17:59")?.date).toBe("2026-04-02");
    expect(next(CORE, "2026-04-01", "18:01")?.date).toBe("2026-04-04");
    expect(next(CORE, "2026-04-02", "18:01")?.date).toBe("2026-04-07"); // Sat cutoff passed, Mon holiday
  });
  it("Christmas: nothing on the 25th and 26th", () => {
    expect(next(CORE, "2026-12-23", "17:59")?.date).toBe("2026-12-24");
    expect(next(CORE, "2026-12-23", "18:01")?.date).toBe("2026-12-28");
  });
  it("blackout dates are skipped like holidays", () => {
    expect(next(CORE, "2026-11-04", "09:00")?.date).toBe("2026-11-05");
    expect(next(CORE, "2026-11-04", "09:00", ["2026-11-05"])?.date).toBe("2026-11-06");
  });
  it("is Berlin time, not UTC: 17:30 UTC in summer is already 19:30 local", () => {
    // Fri 2026-07-10 17:30Z = 19:30 CEST, after the cutoff.
    expect(nextDeliveryDate({ weekdays: CORE, now: new Date("2026-07-10T17:30:00Z") })?.date).toBe("2026-07-13");
    expect(nextDeliveryDate({ weekdays: CORE, now: new Date("2026-07-10T15:30:00Z") })?.date).toBe("2026-07-11"); // 17:30 CEST
  });
});

describe("next delivery date: weekly tours", () => {
  it("Monday tour ordered Saturday before the cutoff -> the coming Monday", () => {
    expect(next(MON, "2026-11-07", "17:59")?.date).toBe("2026-11-09");
  });
  it("Monday tour ordered Saturday after the cutoff -> the Monday after", () => {
    expect(next(MON, "2026-11-07", "18:01")?.date).toBe("2026-11-16");
  });
  it("Monday tour ordered on Sunday -> next week", () => {
    expect(next(MON, "2026-11-08", "10:00")?.date).toBe("2026-11-16");
  });
  it("Tuesday tour: cutoff is Monday 18:00", () => {
    expect(next(TUE, "2026-11-09", "17:59")?.date).toBe("2026-11-10");
    expect(next(TUE, "2026-11-09", "18:01")?.date).toBe("2026-11-17");
  });
  it("a tour day on a holiday is skipped to the next week", () => {
    expect(next(MON, "2026-04-01", "09:00")?.date).toBe("2026-04-13"); // Mon 6 Apr = Ostermontag
  });
  it("nothing for a postcode without delivery weekdays", () => {
    expect(next([], "2026-11-04", "09:00")).toBeNull();
  });
});

describe("DST", () => {
  it("converts Berlin wall-clock to UTC on both sides of the change", () => {
    expect(berlinToUtc("2026-03-28", "14:00").toISOString()).toBe("2026-03-28T13:00:00.000Z"); // CET
    expect(berlinToUtc("2026-03-29", "14:00").toISOString()).toBe("2026-03-29T12:00:00.000Z"); // CEST
    expect(berlinToUtc("2026-10-24", "14:00").toISOString()).toBe("2026-10-24T12:00:00.000Z"); // CEST
    expect(berlinToUtc("2026-10-25", "14:00").toISOString()).toBe("2026-10-25T13:00:00.000Z"); // CET
  });
});
