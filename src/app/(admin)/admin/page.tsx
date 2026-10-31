import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { berlinToUtc, berlinToday, addDays } from "@/domain/delivery";
import { formatMoney } from "@/domain/money";
import { Card } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";
const PAID = ["PAID", "PARTIALLY_REFUNDED"] as const;

export default async function Dashboard() {
  await requireAdmin();
  const today = berlinToday(new Date());
  const start = berlinToUtc(today, "00:00"),
    end = berlinToUtc(addDays(today, 1), "00:00");
  const paidWhere = { paymentStatus: { in: [...PAID] } };
  const [todayN, awaiting, revenue, inFlight, done, cancelled, refunded] = await Promise.all([
    db.order.count({
      where: { createdAt: { gte: start, lt: end }, ...paidWhere },
    }),
    db.order.count({
      where: { ...paidWhere, fulfillmentStatus: "AWAITING_FORWARDING" },
    }),
    db.order.aggregate({
      _sum: { totalCents: true, refundedCents: true },
      where: paidWhere,
    }),
    db.order.count({
      where: {
        ...paidWhere,
        fulfillmentStatus: {
          in: ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY"],
        },
      },
    }),
    db.order.count({ where: { fulfillmentStatus: "DELIVERED" } }),
    db.order.count({
      where: {
        fulfillmentStatus: "CANCELLED",
        paymentStatus: { not: "PENDING_PAYMENT" },
      },
    }),
    db.order.count({
      where: { paymentStatus: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] } },
    }),
  ]);
  const rev = (revenue._sum.totalCents ?? 0) - (revenue._sum.refundedCents ?? 0);
  const tiles: [string, string | number, string?][] = [
    ["Today's paid orders", todayN],
    ["Awaiting forwarding", awaiting, "/admin/orders?fulfillment=AWAITING_FORWARDING"],
    ["Paid revenue (net of refunds)", formatMoney(rev)],
    ["Awaiting delivery", inFlight, "/admin/orders?view=inflight"],
    ["Completed", done, "/admin/orders?fulfillment=DELIVERED"],
    ["Cancelled", cancelled],
    ["Refunded / part-refunded", refunded],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([l, v, href]) => {
          const inner = (
            <Card className="p-5">
              <p className="text-sm text-muted">{l}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{v}</p>
            </Card>
          );
          return href ? (
            <Link key={l} href={href}>
              {inner}
            </Link>
          ) : (
            <div key={l}>{inner}</div>
          );
        })}
      </div>
      <p className="text-sm text-muted">
        Revenue is the gross amount paid to the butcher&apos;s Stripe account; it does not include Stripe fees or taxes.
      </p>
    </div>
  );
}
