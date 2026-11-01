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
