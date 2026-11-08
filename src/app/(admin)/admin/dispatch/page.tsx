import type { OrderStatus } from "@prisma/client";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { buildDispatchMessage, groupOrdersForDispatch, meetsMinimumAfterWeighing, paymentLabel } from "@/domain/dispatch";
import { Badge, Card } from "@/components/ui";
import { StatusChip } from "@/components/admin/status-chip";
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

  const days = groupOrdersForDispatch(
    orders.map((o) => ({ ...o, deliveryDate: ymd(o.deliveryDate), totalCents: o.finalTotalCents ?? o.estimatedTotalCents })),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Lieferplanung</h1>
      {orders.length === 0 && <Card className="p-8 text-center text-text-muted">Keine offenen Bestellungen.</Card>}
      {days.map((day) => (
        <section key={day.date} className="space-y-3">
          <h2 className="text-xl font-semibold">
            {weekday(day.date)}, {dmy(day.date)}
            <span className="t-small ml-2 font-normal text-text-muted">
              {day.orderCount} {day.orderCount === 1 ? "Bestellung" : "Bestellungen"} · {formatMoney(day.totalCents, "de")}
            </span>
          </h2>
          {day.groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <h3 className="font-semibold" data-testid="dispatch-group">
                {weekday(day.date)} — {g.label}
                <span className="t-small ml-2 font-normal text-text-muted">
                  {g.orderCount} {g.orderCount === 1 ? "Bestellung" : "Bestellungen"} | {formatMoney(g.totalCents, "de")} gesamt
                </span>
              </h3>
              {g.postcodes.map((pc) => (
                <div key={pc.postalCode} className="space-y-2">
                  <h4 className="t-small font-semibold uppercase tracking-wide text-text-muted">PLZ {pc.postalCode}</h4>
                  {pc.orders.map((o) => {
                    const text = buildDispatchMessage({
                      number: o.number,
                      firstName: o.customer.firstName,
                      lastName: o.customer.lastName,
                      phone: o.customer.phoneE164,
                      street: o.street,
                      postalCode: o.postalCode,
                      city: o.city,
                      deliveryDate: day.date,
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
                          <StatusChip status={o.status} />
                          <span className="t-small text-text-muted">{paymentLabel(o)}</span>
                          {o.zoneNeedsReview && <Badge tone="warning">PLZ prüfen</Badge>}
                        </div>
                        <p className="t-small text-text-muted">
                          {o.street}, {o.postalCode} {o.city} · {o.slotStartTime}–{o.slotEndTime} · {o.finalTotalCents == null ? "ca. " : ""}
                          {formatMoney(o.totalCents, "de")}
                        </p>
                        <details>
                          <summary className="t-small cursor-pointer font-medium">WhatsApp-Text</summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-alt p-3 text-sm" data-testid="whatsapp-text">
                            {text}
                          </pre>
                        </details>
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
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
