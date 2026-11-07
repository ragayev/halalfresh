export const LOCALES = ["de", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
/** Customers are in Germany and mostly de/tr speakers: unknown browser languages fall back to German. */
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  tr: "Türkçe",
};

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}
