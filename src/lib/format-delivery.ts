import type { Locale } from "@/i18n/config";
import { TZ } from "@/domain/delivery";

/** BCP-47 tags for Intl. */
export const INTL_LOCALE: Record<Locale, string> = { de: "de-DE", tr: "tr-TR" };

/** "Perşembe 6 Kasım" for a YYYY-MM-DD calendar date (no time zone shifting). */
export function formatSlotDay(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** "Sonntag, 2. November, 14:00" for an instant, in Berlin time. */
export function formatCutoff(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** "Dienstag, 17.11." for a YYYY-MM-DD calendar date. */
export function formatShortDay(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${weekday}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

/** Weekday name for an ISO weekday (1 = Monday). 2026-11-02 is a Monday. */
export function weekdayName(isoWeekday: number, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + isoWeekday)));
}

/** "jeden Dienstag", "Montag bis Samstag", or a list for unusual overrides. Pass the delivery dictionary strings. */
export function formatDeliveryDays(
  weekdays: number[],
  locale: Locale,
  words: { everyDay: string; daysRange: string; and: string },
): string {
  const days = [...weekdays].sort((a, b) => a - b);
  const name = (n: number) => weekdayName(n, locale);
  if (days.length === 1) return words.everyDay.replace("{day}", name(days[0]));
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (days.length > 2 && consecutive) return words.daysRange.replace("{from}", name(days[0])).replace("{to}", name(days[days.length - 1]));
  return days.map(name).join(` ${words.and} `);
}
