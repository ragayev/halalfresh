import type { OrderStatus } from "@prisma/client";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { buildDispatchMessage, groupLabel, groupSort, meetsMinimumAfterWeighing } from "@/domain/dispatch";
import { Badge, Card } from "@/components/ui";
import { CopyMessage, ReportedFinalForm } from "@/components/admin/dispatch-order";

export const dynamic = "force-dynamic";

const OPEN: OrderStatus[] = ["NEW", "ACCEPTED", "PREPARING", "WEIGHED", "PAYMENT_OVERDUE", "PAID", "OUT_FOR_DELIVERY"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (s: string) => s.split("-").reverse().join(".");
const weekday = (s: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`));

/** Open orders grouped by delivery date, then core / sector. Kevser gets each order as a WhatsApp text (copied by hand). */
export default async function Dispatch() {
  await requireAdmin();
  const orders = await db.order.findMany({
    where: { status: { in: OPEN } },
    orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
    include: { items: { orderBy: { id: "asc" } }, customer: true },
  });

  const byDate = new Map<string, Map<string, { label: string; orders: typeof orders }>>();
  for (const o of orders) {
    const date = ymd(o.deliveryDate);
    const key = groupSort(o.tier, o.sector);
    const groups = byDate.get(date) ?? new Map();
    const g = groups.get(key) ?? { label: groupLabel(o.tier, o.sector), orders: [] };
    g.orders.push(o);
    groups.set(key, g);
    byDate.set(date, groups);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Lieferplanung</h1>
      {orders.length === 0 && <Card className="p-8 text-center text-text-muted">Keine offenen Bestellungen.</Card>}
      {[...byDate.entries()].map(([date, groups]) => (
        <section key={date} className="space-y-3">
          <h2 className="text-xl font-semibold">
            {weekday(date)}, {dmy(date)}
          </h2>
          {[...groups.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, g]) => (
              <div key={key} className="space-y-2">
                <h3 className="t-small font-semibold uppercase tracking-wide text-text-muted">
                  {g.label} · {g.orders.length} {g.orders.length === 1 ? "Bestellung" : "Bestellungen"}
                </h3>
                {g.orders.map((o) => {
                  const text = buildDispatchMessage({
                    number: o.number,
                    firstName: o.customer.firstName,
                    lastName: o.customer.lastName,
                    phone: o.customer.phoneE164,
                    street: o.street,
                    postalCode: o.postalCode,
                    city: o.city,
                    deliveryDate: date,
                    slotStartTime: o.slotStartTime,
                    slotEndTime: o.slotEndTime,
                    items: o.items,
                    estimatedTotalCents: o.estimatedTotalCents,
                    notes: o.deliveryNotes,
                    needsReview: o.zoneNeedsReview,
                  });
                  const reportedOk = o.reportedFinalCents == null || meetsMinimumAfterWeighing(o.reportedFinalCents, o.minOrderCents);
                  return (
                    <Card key={o.id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular font-semibold">{orderNumberLabel(o.number)}</span>
                        <span>
                          {o.customer.firstName} {o.customer.lastName}
                        </span>
                        <span className="t-small text-text-muted">
                          {o.postalCode} · {o.slotStartTime}–{o.slotEndTime} · ca. {formatMoney(o.estimatedTotalCents, "de")}
                        </span>
                        {o.zoneNeedsReview && <Badge tone="warning">PLZ prüfen</Badge>}
                      </div>
                      <pre className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-alt p-3 text-sm" data-testid="whatsapp-text">
                        {text}
                      </pre>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <CopyMessage text={text} />
                        <ReportedFinalForm orderId={o.id} initial={o.reportedFinalCents == null ? "" : (o.reportedFinalCents / 100).toFixed(2).replace(".", ",")} />
                      </div>
                      {!reportedOk && (
                        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
                          <AlertTriangle className="size-4" aria-hidden />
                          Mehr als 10 % unter dem Mindestbestellwert ({formatMoney(o.minOrderCents, "de")}). Bitte prüfen.
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
