/**
 * Normalises a phone number to E.164. Numbers without a country prefix are treated as German
 * ("0151 1234567" -> "+491511234567"). Returns null when the result cannot be a valid number.
 */
export function normalizePhone(raw: string, defaultCountryCode = "49"): string | null {
  let s = raw.trim().replace(/[\s().\-/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    s = "+" + s.slice(1).replace(/^0+/, "");
  } else if (s.startsWith("0")) {
    s = "+" + defaultCountryCode + s.slice(1);
  } else {
    return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
