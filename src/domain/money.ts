/** All money is integer cents. */
export type Cents = number;

export function assertCents(n: number, label = "amount"): asserts n is Cents {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of cents`);
}

export function formatMoney(cents: Cents, locale = "en"): string {
  const tag = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-IE";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/**
 * Parses a user/CSV price into integer cents without floating point. Accepts German ("1.234,50", "12,5"),
 * English ("1,234.50", "12.5") and plain integers ("12"). A single "." followed by exactly three digits ("1.234") is a
 * German thousands separator; a single "," followed by three digits ("1,234") is ambiguous and rejected. Returns null
 * for anything else, including negatives and more than two decimals.
 */
export function parsePriceToCents(raw: string): Cents | null {
  const s = raw.trim().replace(/\s|€|EUR/gi, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  let decimalAt = -1;
  if (dot >= 0 && comma >= 0) decimalAt = Math.max(dot, comma);
  else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? "." : ",";
    const at = Math.max(dot, comma);
    const once = s.indexOf(sep) === at;
    const tail3 = s.length - at - 1 === 3;
    if (once && sep === "," && tail3) return null; // "1,234": thousands (EN) or malformed decimals (DE)
    if (once && !tail3) decimalAt = at;
  }
  const intRaw = decimalAt >= 0 ? s.slice(0, decimalAt) : s;
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1) : "";
  // Thousands groups: 1-3 digits, then groups of exactly three, all with the same separator.
  if (!/^\d{1,3}([.,]\d{3})+$|^\d+$/.test(intRaw)) return null;
  if (/[.,]/.test(intRaw) && new Set(intRaw.match(/[.,]/g)).size > 1) return null;
  if (decimalAt >= 0 && !/^\d{1,2}$/.test(frac)) return null;
  const cents = Number(intRaw.replace(/[.,]/g, "")) * 100 + Number(frac.padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}
