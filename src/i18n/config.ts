export const LOCALES = ["de", "tr", "ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Customers are in Germany and mostly de/tr/ar speakers: unknown browser languages fall back to German. */
export const DEFAULT_LOCALE: Locale = "de";
export const RTL_LOCALES: readonly Locale[] = ["ar"];
export const isRtl = (l: Locale) => RTL_LOCALES.includes(l);
export const LOCALE_COOKIE = "hf_locale";
export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  tr: "Türkçe",
  ar: "العربية",
  en: "English",
};

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}
