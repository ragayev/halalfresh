import type { Locale } from "./config";
import type de from "./dictionaries/de.json";

export type Dictionary = typeof de;

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  de: () => import("./dictionaries/de.json").then((m) => m.default),
  tr: () => import("./dictionaries/tr.json").then((m) => m.default as Dictionary),
};

export const getDictionary = (l: Locale) => loaders[l]();

/** Replace {placeholders} in a dictionary string. */
export function t(s: string, vars: Record<string, string | number> = {}) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
