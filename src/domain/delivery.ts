export const POSTCODE_RE = /^\d{5}$/;

export function normalizePostcode(input: string): string {
  return input.replace(/\s+/g, "");
}

export function isValidPostcode(input: string): boolean {
  return POSTCODE_RE.test(normalizePostcode(input));
}

/** pattern: exact "10115" or prefix "101*". */
export function postcodeMatches(postcode: string, pattern: string): boolean {
  const p = normalizePostcode(postcode);
  const pat = pattern.trim();
  if (!POSTCODE_RE.test(p) || !pat) return false;
  if (pat.endsWith("*")) return p.startsWith(pat.slice(0, -1));
  return p === pat;
}

export function parsePostcodePatterns(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const t = part.trim();
    if (/^\d{1,4}\*$/.test(t) || /^\d{5}$/.test(t)) out.add(t);
  }
  return [...out];
}

export interface ZoneLike {
  id: string;
  isActive: boolean;
  postcodes: { pattern: string }[];
}

/** First active zone whose patterns match; exact patterns beat prefixes. */
export function findZoneForPostcode<Z extends ZoneLike>(zones: Z[], postcode: string): Z | null {
  let best: { z: Z; score: number } | null = null;
  for (const z of zones) {
    if (!z.isActive) continue;
    for (const { pattern } of z.postcodes) {
      if (!postcodeMatches(postcode, pattern)) continue;
      const score = pattern.endsWith("*") ? pattern.length - 1 : 5;
      if (!best || score > best.score) best = { z, score };
    }
  }
  return best?.z ?? null;
}

// ---- Slots (Europe/Berlin local calendar) ----

export const TZ = "Europe/Berlin";

export interface SlotLike {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface SlotOption {
  slotId: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  weekday: number;
}

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
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return p; // en-CA => YYYY-MM-DD
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function availableSlots(slots: SlotLike[], now: Date, leadHours: number, horizonDays: number): SlotOption[] {
  const earliest = now.getTime() + leadHours * 3600_000;
  const today = berlinToday(now);
  const out: SlotOption[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const wd = weekdayOf(date);
    for (const s of slots) {
      if (!s.isActive || s.weekday !== wd) continue;
      if (berlinToUtc(date, s.startTime).getTime() < earliest) continue;
      out.push({
        slotId: s.id,
        date,
        startTime: s.startTime,
        endTime: s.endTime,
        weekday: wd,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export function isSlotBookable(
  slots: SlotLike[],
  slotId: string,
  date: string,
  now: Date,
  leadHours: number,
  horizonDays: number,
): boolean {
  return availableSlots(slots, now, leadHours, horizonDays).some((s) => s.slotId === slotId && s.date === date);
}
