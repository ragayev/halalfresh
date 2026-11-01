import { formatMoney } from "./money";
import { formatWeight } from "./pricing";

export interface WhatsappOrder {
  number: number;
  customerName: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  items: { productName: string; quantityGrams: number }[];
  totalCents: number;
  paymentStatus: string;
  deliveryDate: string; // YYYY-MM-DD
  slotStartTime: string;
  slotEndTime: string;
  deliveryInstructions?: string | null;
}

export function deliveryLabel(date: string, start: string, end: string, locale = "en-GB"): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day}, ${start}–${end}`;
}

/** Plain-text message the admin reviews and sends manually. The butcher's team reads German/English. */
export function buildWhatsappMessage(o: WhatsappOrder): string {
  const lines = [
    "NEW HALAL FRESH ORDER",
    "",
    `Order: #HF-${o.number}`,
    "",
    `Customer: ${o.customerName}`,
    `Phone: ${o.phone}`,
    "",
    "Address:",
    o.street,
    `${o.postalCode} ${o.city}`,
    "",
    "Products:",
    ...o.items.map((i) => `- ${i.productName} — ${formatWeight(i.quantityGrams)}`),
    "",
    `Total: ${formatMoney(o.totalCents, "de")}`,
    `Payment: ${o.paymentStatus === "PAID" ? "PAID (confirmed via Stripe)" : o.paymentStatus}`,
    "",
    `Delivery: ${deliveryLabel(o.deliveryDate, o.slotStartTime, o.slotEndTime)}`,
  ];
  if (o.deliveryInstructions?.trim()) lines.push("", `Instructions: ${o.deliveryInstructions.trim()}`);
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
