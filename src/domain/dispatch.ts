import { MIN_ORDER_FINAL_TOLERANCE_BPS, type Sector } from "@/config/delivery";
import { formatMoney } from "./money";
import { orderNumberLabel } from "./order-state";

export const SECTOR_LABEL: Record<Sector, string> = {
  west: "Westen",
  north: "Norden",
  northeast: "Nordosten",
  southeast: "Südosten",
  southwest: "Südwesten",
};

/** Admin grouping label: core, or the sector. Internal only. */
export function groupLabel(tier: string | null, sector: string | null): string {
  if (tier === "core") return "Kern (Berlin)";
  return sector ? (SECTOR_LABEL[sector as Sector] ?? sector) : (tier ?? "Unbekannt");
}

/** Sort key: core first, then sectors in config weekday order is irrelevant within one date, so alphabetical. */
export function groupSort(tier: string | null, sector: string | null): string {
  return tier === "core" ? "0" : `1-${sector ?? ""}`;
}

/**
 * A weighed order is accepted as long as its final total is at most 10% below the minimum.
 * Used for display and checks only; weighing never rejects an order.
 */
export function meetsMinimumAfterWeighing(finalCents: number, minOrderCents: number): boolean {
  return finalCents * 10_000 >= minOrderCents * (10_000 - MIN_ORDER_FINAL_TOLERANCE_BPS);
}

export interface DispatchOrder {
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
  items: { productName: string; requestedGrams: number }[];
  estimatedTotalCents: number;
  notes?: string | null;
  needsReview?: boolean;
}

const kg = (g: number) => (g / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 3 });

/** Turkish text for Kevser (same language as the per-order message in whatsapp.ts), pasted into WhatsApp by hand. */
export function buildDispatchMessage(o: DispatchOrder): string {
  const [y, m, d] = o.deliveryDate.split("-").map(Number);
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  const lines = [
    `🟢 Sipariş ${orderNumberLabel(o.number)}`,
    `Teslimat: ${day}, ${o.slotStartTime}–${o.slotEndTime}`,
    `Müşteri: ${o.firstName} ${o.lastName} · ${o.phone}`,
    `Adres: ${o.street}`,
    `PLZ / Şehir: ${o.postalCode} ${o.city}`,
    "",
    ...o.items.map((i) => `- ${i.productName} · yakl. ${kg(i.requestedGrams)} kg`),
    `Tahmini toplam: ${formatMoney(o.estimatedTotalCents, "tr")}`,
  ];
  if (o.notes?.trim()) lines.push(`Not: ${o.notes.trim()}`);
  if (o.needsReview) lines.push("⚠️ PLZ kontrol edilmeli");
  return lines.join("\n");
}
