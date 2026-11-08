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

// ---- Overview grouping: delivery date -> core/sector -> postcode ----

export interface GroupableOrder {
  deliveryDate: string; // YYYY-MM-DD
  tier: string | null;
  sector: string | null;
  postalCode: string;
  /** Final amount once weighed, otherwise the estimate. */
  totalCents: number;
}

export interface PostcodeGroup<T> {
  postalCode: string;
  orders: T[];
}
export interface SectorGroup<T> {
  key: string;
  label: string;
  orderCount: number;
  totalCents: number;
  postcodes: PostcodeGroup<T>[];
}
export interface DateGroup<T> {
  date: string;
  orderCount: number;
  totalCents: number;
  groups: SectorGroup<T>[];
}

/** Dates ascending, core before sectors (sectors alphabetical), postcodes ascending. Orders keep their input order. */
export function groupOrdersForDispatch<T extends GroupableOrder>(orders: T[]): DateGroup<T>[] {
  const dates = new Map<string, Map<string, SectorGroup<T>>>();
  for (const o of orders) {
    const sectors = dates.get(o.deliveryDate) ?? new Map<string, SectorGroup<T>>();
    const key = groupSort(o.tier, o.sector);
    const g = sectors.get(key) ?? { key, label: groupLabel(o.tier, o.sector), orderCount: 0, totalCents: 0, postcodes: [] };
    g.orderCount++;
    g.totalCents += o.totalCents;
    let pc = g.postcodes.find((p) => p.postalCode === o.postalCode);
    if (!pc) g.postcodes.push((pc = { postalCode: o.postalCode, orders: [] }));
    pc.orders.push(o);
    sectors.set(key, g);
    dates.set(o.deliveryDate, sectors);
  }
  return [...dates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sectors]) => {
      const groups = [...sectors.values()].sort((a, b) => a.key.localeCompare(b.key));
      for (const g of groups) g.postcodes.sort((a, b) => a.postalCode.localeCompare(b.postalCode));
      return { date, orderCount: groups.reduce((n, g) => n + g.orderCount, 0), totalCents: groups.reduce((n, g) => n + g.totalCents, 0), groups };
    });
}

/** Payment state shown in the overview (the order status shows fulfilment). */
export function paymentLabel(o: { paymentMethod: "PAYPAL" | "CASH"; paidAt: Date | null; status: string }): string {
  if (o.paymentMethod === "CASH") return o.status === "CASH_COLLECTED" ? "Bar kassiert" : "Barzahlung bei Lieferung";
  if (o.paidAt) return "Bezahlt (PayPal)";
  return o.status === "PAYMENT_OVERDUE" ? "PayPal überfällig" : "PayPal offen";
}
