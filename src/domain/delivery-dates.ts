import { BLACKOUT_DATES, CUTOFF_TIME, SLOTS } from "@/config/delivery";
import { addDays, berlinToday, berlinToUtc, isoWeekdayOf } from "./delivery";

/** Gregorian Easter Sunday (anonymous / Meeus algorithm) as YYYY-MM-DD. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Berlin public holidays (Feiertagsgesetz Berlin): fixed dates, Easter-based dates and Internationaler Frauentag (since 2019). */
export function berlinHolidays(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const p = (s: string) => `${year}-${s}`;
  return new Map<string, string>([
    [p("01-01"), "Neujahr"],
    [p("03-08"), "Internationaler Frauentag"],
    [addDays(easter, -2), "Karfreitag"],
    [addDays(easter, 1), "Ostermontag"],
    [p("05-01"), "Tag der Arbeit"],
    [addDays(easter, 39), "Christi Himmelfahrt"],
    [addDays(easter, 50), "Pfingstmontag"],
    [p("10-03"), "Tag der Deutschen Einheit"],
    [p("12-25"), "1. Weihnachtstag"],
    [p("12-26"), "2. Weihnachtstag"],
  ]);
}

export function isBerlinHoliday(date: string): boolean {
  return berlinHolidays(Number(date.slice(0, 4))).has(date);
}

/** Monday to Saturday, not a Berlin public holiday, not in the blackout list. */
export function isWorkingDay(date: string, blackout: ReadonlySet<string> = new Set(BLACKOUT_DATES)): boolean {
  return isoWeekdayOf(date) !== 7 && !isBerlinHoliday(date) && !blackout.has(date);
}

export function previousWorkingDay(date: string, blackout: ReadonlySet<string> = new Set(BLACKOUT_DATES)): string {
  let d = addDays(date, -1);
  for (let i = 0; i < 14 && !isWorkingDay(d, blackout); i++) d = addDays(d, -1);
  return d;
}

/** Last instant at which delivery on `date` can be ordered: CUTOFF_TIME Berlin time on the working day before. */
export function orderCutoffFor(date: string, blackout: ReadonlySet<string> = new Set(BLACKOUT_DATES)): Date {
  return berlinToUtc(previousWorkingDay(date, blackout), CUTOFF_TIME);
}

export interface NextDelivery {
  date: string; // YYYY-MM-DD, Berlin
  weekday: number; // ISO 1..7
  cutoffAt: Date;
  /** True when the date is the calendar day after today in Berlin. */
  isTomorrow: boolean;
  slots: readonly { start: string; end: string }[];
}

export interface NextDeliveryInput {
  /** ISO weekdays this postcode is delivered on. */
  weekdays: readonly number[];
  now: Date;
  blackoutDates?: ReadonlySet<string>;
  horizonDays?: number;
}

/**
 * Earliest delivery date D with: D a working day, D a delivery weekday, and now strictly before 18:00 Berlin time
 * on the working day before D. Null when nothing is available within the horizon (or the postcode has no weekdays).
 */
export function nextDeliveryDate({ weekdays, now, blackoutDates = new Set(BLACKOUT_DATES), horizonDays = 60 }: NextDeliveryInput): NextDelivery | null {
  if (!weekdays.length) return null;
  const today = berlinToday(now);
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const weekday = isoWeekdayOf(date);
    if (!weekdays.includes(weekday) || !isWorkingDay(date, blackoutDates)) continue;
    const cutoffAt = orderCutoffFor(date, blackoutDates);
    if (now.getTime() >= cutoffAt.getTime()) continue;
    return { date, weekday, cutoffAt, isTomorrow: date === addDays(today, 1), slots: SLOTS };
  }
  return null;
}
