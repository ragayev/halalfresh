import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { Badge, Button, Card, Input } from "@/components/ui";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/badges";

export const dynamic = "force-dynamic";
const PAYMENTS = ["PENDING_PAYMENT", "PAID", "PAYMENT_FAILED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"];
const FULFILL = ["AWAITING_FORWARDING", "FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const where: Prisma.OrderWhereInput = {};
  // Unpaid checkouts are noise by default; show them only when explicitly filtered.
  if (sp.payment && PAYMENTS.includes(sp.payment)) where.paymentStatus = sp.payment as never;
  else
    where.paymentStatus = {
      in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"],
    };
  if (sp.fulfillment && FULFILL.includes(sp.fulfillment)) where.fulfillmentStatus = sp.fulfillment as never;
  if (sp.view === "inflight")
    where.fulfillmentStatus = {
      in: ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY"],
    };
  const q = sp.q?.trim();
  if (q) {
    const n = parseInt(q.replace(/\D/g, ""), 10);
    where.OR = [
      ...(Number.isFinite(n) ? [{ number: n }] : []),
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { address: { postalCode: { startsWith: q } } },
      { address: { street: { contains: q, mode: "insensitive" } } },
    ];
  }
  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: true, address: true },
  });
  const sel = "h-11 rounded-xl border border-line bg-white px-3 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search number, name, email, postcode" className="w-72" />
        <select name="payment" defaultValue={sp.payment ?? ""} className={sel} aria-label="Payment status">
          <option value="">Payment: paid & closed</option>
          {PAYMENTS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select name="fulfillment" defaultValue={sp.fulfillment ?? ""} className={sel} aria-label="Fulfillment status">
          <option value="">Fulfillment: any</option>
          {FULFILL.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm" data-testid="orders-table">
          <thead className="border-b border-line text-xs uppercase text-muted">
            <tr>
              {["Order", "Customer", "Address", "Total", "Payment", "Fulfillment", "Slot", "Created", "WhatsApp"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-sage-soft">
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/admin/orders/${o.id}`} className="text-forest hover:underline">
                    #HF-{o.number}
                  </Link>
                </td>
                <td className="px-4 py-3">{o.customer.name}</td>
                <td className="px-4 py-3 text-muted">
                  {o.address.street}, {o.address.postalCode} {o.address.city}
                </td>
                <td className="px-4 py-3 tabular-nums">{formatMoney(o.totalCents)}</td>
                <td className="px-4 py-3">
                  <PaymentBadge s={o.paymentStatus} />
                </td>
                <td className="px-4 py-3">
                  <FulfillmentBadge s={o.fulfillmentStatus} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {o.deliveryDate.toISOString().slice(0, 10)} {o.slotStartTime}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {o.createdAt.toLocaleString("de-DE", {
                    timeZone: "Europe/Berlin",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
                <td className="px-4 py-3">
                  {o.forwardedAt ? (
                    <Badge tone="green">Forwarded</Badge>
                  ) : o.whatsappOpenCount > 0 ? (
                    <Badge tone="amber">Opened ×{o.whatsappOpenCount}</Badge>
                  ) : (
                    <Badge>Not sent</Badge>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  No orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
