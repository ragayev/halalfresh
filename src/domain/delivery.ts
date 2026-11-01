export const POSTCODE_RE = /^\d{5}$/;

export function normalizePostcode(input: string): string {
  return input.replace(/\s+/g, "");
}

export function isValidPostcode(input: string): boolean {
  return POSTCODE_RE.test(normalizePostcode(input));
}

/** Inclusive numeric range as 5-digit strings (leading zeros kept), e.g. ("14467","14482"). */
export function expandPostcodeRange(from: string, to: string): string[] {
  if (!POSTCODE_RE.test(from) || !POSTCODE_RE.test(to) || Number(from) > Number(to)) return [];
  const out: string[] = [];
  for (let n = Number(from); n <= Number(to); n++) out.push(String(n).padStart(5, "0"));
  return out;
}

/** Admin input: "10115, 14467-14482 03046" -> unique 5-digit strings, plus tokens that could not be parsed. */
export function parsePostcodeList(raw: string): { postcodes: string[]; invalid: string[] } {
  const set = new Set<string>();
  const invalid: string[] = [];
  for (const tok of raw.split(/[\s,;]+/).filter(Boolean)) {
    const range = tok.match(/^(\d{5})[-–](\d{5})$/);
    if (range) {
      const r = expandPostcodeRange(range[1], range[2]);
      if (!r.length || r.length > 5000) invalid.push(tok);
      else r.forEach((p) => set.add(p));
    } else if (POSTCODE_RE.test(tok)) set.add(tok);
    else invalid.push(tok);
  }
  return { postcodes: [...set], invalid };
}

// ---- Time (Europe/Berlin local calendar) ----

export const TZ = "Europe/Berlin";

function tzOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs;
}

/** Berlin wall-clock date+time -> UTC instant. */
export function berlinToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const guess = naive - tzOffsetMs(naive);
  return new Date(naive - tzOffsetMs(guess));
}

export function berlinToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA => YYYY-MM-DD
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Which occurrence of its weekday this date is within its month (1..5). */
export function nthWeekdayOfMonth(date: string): number {
  return Math.ceil(Number(date.slice(8, 10)) / 7);
}

// ---- Schedules ----

export type DeliveryMode = "REGULAR" | "PREORDER_ONLY";

export interface ScheduleLike {
  kind: "WEEKLY" | "NTH_WEEKDAY_OF_MONTH";
  /** ISO weekday 1 = Monday ... 7 = Sunday (Sunday is never delivered). */
  weekday: number;
  /** 1..5, only for NTH_WEEKDAY_OF_MONTH. */
  nth: number | null;
  windowStart: string;
  windowEnd: string;
  cutoffHoursBefore: number;
  isActive: boolean;
}

export interface DeliverySlot {
  date: string; // YYYY-MM-DD (Berlin)
  weekday: number; // ISO 1..7
  windowStart: string;
  windowEnd: string;
  /** Last instant at which this slot can still be ordered. */
  cutoffAt: Date;
}

/**
 * Cutoff instant for a delivery on `date`. Whole days are subtracted on the Berlin calendar, so
 * "48h before Tuesday 14:00" is always "Sunday 14:00 local", also across DST changes; the remainder
 * (hours % 24) is subtracted as elapsed time.
 */
export function cutoffFor(date: string, windowStart: string, cutoffHoursBefore: number): Date {
  const days = Math.floor(cutoffHoursBefore / 24);
  const rem = cutoffHoursBefore % 24;
  return new Date(berlinToUtc(addDays(date, -days), windowStart).getTime() - rem * 3600_000);
}

export interface NextSlotInput {
  schedules: ScheduleLike[];
  /** YYYY-MM-DD dates with no delivery (holidays, Bayram, ...). */
  blackoutDates: ReadonlySet<string>;
  now: Date;
  horizonDays: number;
}

/**
 * Earliest slot whose cutoff has not passed. Sundays and blackout dates are skipped.
 * A slot is orderable strictly before its cutoff instant.
 */
export function nextDeliverySlot({ schedules, blackoutDates, now, horizonDays }: NextSlotInput): DeliverySlot | null {
  const today = berlinToday(now);
  const active = schedules.filter((s) => s.isActive);
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const wd = isoWeekdayOf(date);
    if (wd === 7 || blackoutDates.has(date)) continue;
    const slots: DeliverySlot[] = [];
    for (const s of active) {
      if (s.weekday !== wd) continue;
      if (s.kind === "NTH_WEEKDAY_OF_MONTH" && s.nth !== nthWeekdayOfMonth(date)) continue;
      const cutoffAt = cutoffFor(date, s.windowStart, s.cutoffHoursBefore);
      if (cutoffAt.getTime() <= now.getTime()) continue;
      slots.push({ date, weekday: wd, windowStart: s.windowStart, windowEnd: s.windowEnd, cutoffAt });
    }
    if (slots.length) return slots.sort((a, b) => a.windowStart.localeCompare(b.windowStart))[0];
  }
  return null;
}

/** Terms a postcode resolves to. Serialisable: this is the /api/delivery/check payload. */
export interface DeliveryCheck {
  postcode: string;
  supported: boolean;
  zone: { id: string; name: string } | null;
  mode: DeliveryMode | null;
  minOrderCents: number;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number | null;
  /** At least one visible, available preorder product exists (offered to areas we do not serve regularly). */
  preorderProductsAvailable: boolean;
  nextSlot: { date: string; weekday: number; windowStart: string; windowEnd: string; cutoffAt: string } | null;
}
