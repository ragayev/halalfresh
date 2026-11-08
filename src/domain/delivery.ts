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

// ---- Customer-facing delivery terms ----

export interface DeliverySlotWindow {
  start: string;
  end: string;
}

/**
 * What a postcode resolves to, as sent to the browser. Deliberately carries no tier or sector:
 * customers only see the minimum and the next date.
 */
export interface DeliveryCheck {
  postcode: string;
  /** "ok" = we deliver; "review" = we probably deliver but must confirm first (no date is promised); "waitlist" = known postcode we do not serve yet; "unknown" = not in our data. */
  status: "ok" | "review" | "waitlist" | "unknown";
  supported: boolean;
  minOrderCents: number;
  /** ISO weekdays of delivery for this postcode (empty when unsupported). */
  weekdays: number[];
  /** Delivery is free; kept as 0 so totals math needs no special case. */
  deliveryFeeCents: 0;
  /** showTomorrow: the date really is tomorrow AND the postcode is on daily delivery ("Morgen bei Ihnen"). */
  /** Orderable delivery dates, earliest first (a handful, for the date picker). */
  dates: { date: string; showTomorrow: boolean; cutoffAt: string }[];
  nextSlot: { date: string; weekday: number; showTomorrow: boolean; cutoffAt: string; slots: DeliverySlotWindow[] } | null;
}
