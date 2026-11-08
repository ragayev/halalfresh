import { formatMoney } from "./money";

export function deliveryLabel(date: string, start: string, end: string, locale = "de-DE"): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day}, ${start}–${end}`;
}

export interface KevserOrder {
  number: number;
  firstName: string;
  lastName: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  deliveryDate: string; // YYYY-MM-DD
  slotStartTime: string;
  slotEndTime: string;
  paymentMethod: "PAYPAL" | "CASH";
  items: { productName: string; requestedGrams: number }[];
  estimatedTotalCents: number;
  maxTotalCents: number;
  notes?: string | null;
}

const kgTr = (g: number) => (g / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 3 });

/** Turkish message the admin forwards to Kevser by WhatsApp (spec §6.1). Customers' last names are abbreviated to an initial. */
export function buildKevserMessage(o: KevserOrder): string {
  const [y, m, d] = o.deliveryDate.split("-").map(Number);
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  const lines = [
    `🟢 Sipariş #HF-${String(o.number).padStart(6, "0")}`,
    `Müşteri: ${o.firstName} ${o.lastName.trim().charAt(0).toUpperCase()}. · ${o.phone}`,
    `Adres: ${o.street}, ${o.postalCode} ${o.city}`,
    `Teslimat: ${day}, ${o.slotStartTime}–${o.slotEndTime}`,
    `Ödeme: ${o.paymentMethod === "PAYPAL" ? "PayPal" : "Nakit"}`,
    "",
    ...o.items.map((i) => `- ${i.productName} · ${kgTr(i.requestedGrams)} kg`),
    `Tahmini: ${formatMoney(o.estimatedTotalCents, "tr")} · Max: ${formatMoney(o.maxTotalCents, "tr")}`,
  ];
  if (o.notes?.trim()) lines.push(`Not: ${o.notes.trim()}`);
  return lines.join("\n");
}

export function normalizeWhatsappNumber(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  d = d.replace(/\+/g, "");
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** wa.me link to message a customer directly (no prefilled text). */
export function customerWhatsappLink(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}`;
}
