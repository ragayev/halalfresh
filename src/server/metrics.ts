import { db } from "@/lib/db";

export interface Metrics {
  orders: number;
  perDay: { day: string; count: number }[];
  perWeek: { week: string; count: number }[];
  avgEstimatedCents: number | null;
  avgFinalCents: number | null;
  cappedPct: number | null;
  perProductDeviation: { product: string; avgDeviationPct: number; lines: number }[];
  avgMinutesNewToAccepted: number | null;
  avgMinutesPreparingToWeighed: number | null;
  cancellationPct: number | null;
  refusedPct: number | null;
  overduePct: number | null;
  repeatCustomerPct: number | null;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/** ISO week label (YYYY-Www) of a YYYY-MM-DD calendar day. */
function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

/** Derived from orders and the append-only order_events. */
export async function computeMetrics(since: Date): Promise<Metrics> {
  const orders = await db.order.findMany({
    where: { createdAt: { gte: since } },
    include: { items: true, events: { select: { fromStatus: true, toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
  });
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const o of orders) {
    const day = berlinDay(o.createdAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    perWeek.set(isoWeek(day), (perWeek.get(isoWeek(day)) ?? 0) + 1);
  }
  const weighed = orders.filter((o) => o.finalTotalCents != null);
  const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;
  const firstAt = (o: (typeof orders)[number], to: string) => o.events.find((e) => e.toStatus === to)?.createdAt;
  const accepted = orders.flatMap((o) => (firstAt(o, "ACCEPTED") ? [minutes(o.createdAt, firstAt(o, "ACCEPTED")!)] : []));
  const prep = orders.flatMap((o) => {
    const a = firstAt(o, "PREPARING"), b = firstAt(o, "WEIGHED");
    return a && b ? [minutes(a, b)] : [];
  });
  const dev = new Map<string, number[]>();
  for (const o of weighed)
    for (const i of o.items)
      if (i.actualGrams != null && i.actualGrams > 0) dev.set(i.productName, [...(dev.get(i.productName) ?? []), ((i.actualGrams - i.requestedGrams) / i.requestedGrams) * 100]);

  const customerCounts = await db.order.groupBy({ by: ["customerId"], _count: { _all: true }, where: { customerId: { in: [...new Set(orders.map((o) => o.customerId))] } } });
  const everOverdue = orders.filter((o) => o.events.some((e) => e.toStatus === "PAYMENT_OVERDUE")).length;
  const paypalWeighed = orders.filter((o) => o.paymentMethod === "PAYPAL" && o.events.some((e) => e.toStatus === "WEIGHED")).length;

  return {
    orders: orders.length,
    perDay: [...perDay].sort().map(([day, count]) => ({ day, count })),
    perWeek: [...perWeek].sort().map(([week, count]) => ({ week, count })),
    avgEstimatedCents: avg(weighed.map((o) => o.estimatedTotalCents)),
    avgFinalCents: avg(weighed.map((o) => o.finalTotalCents!)),
    cappedPct: pct(weighed.filter((o) => (o.cappedAmountCents ?? 0) > 0).length, weighed.length),
    perProductDeviation: [...dev].map(([product, xs]) => ({ product, avgDeviationPct: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, lines: xs.length })).sort((a, b) => b.lines - a.lines),
    avgMinutesNewToAccepted: avg(accepted),
    avgMinutesPreparingToWeighed: avg(prep),
    cancellationPct: pct(orders.filter((o) => o.status === "CANCELLED").length, orders.length),
    refusedPct: pct(orders.filter((o) => o.status === "REFUSED_AT_DOOR").length, orders.length),
    overduePct: pct(everOverdue, paypalWeighed),
    repeatCustomerPct: pct(customerCounts.filter((c) => c._count._all > 1).length, customerCounts.length),
  };
}
