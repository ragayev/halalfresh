import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { Badge, Button, Card, Input } from "@/components/ui";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/badges";
import { adminAttention } from "@/domain/order-state";

export const dynamic = "force-dynamic";
const PAYMENTS = ["PENDING_PAYMENT", "PAID", "PAYMENT_FAILED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"];
const FULFILL = ["AWAITING_FORWARDING", "FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const where: Prisma.OrderWhereInput = {};
  const and: Prisma.OrderWhereInput[] = [];
  // Unpaid checkouts are noise by default; show them only when explicitly filtered.
  if (sp.payment && PAYMENTS.includes(sp.payment)) where.paymentStatus = sp.payment as never;
  else {
    // SEPA orders whose debit was initiated (pending or failed) are real orders and must stay visible.
    and.push({
      OR: [{ paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"] } }, { sepaInitiatedAt: { not: null } }],
    });
  }
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
  if (and.length) where.AND = and;
  // Everything that needs a human: open orders, SEPA still collecting, or a failed debit. Independent of filters.
  const open = await db.order.findMany({
    where: {
      OR: [
        { fulfillmentStatus: { notIn: ["DELIVERED", "CANCELLED"] }, OR: [{ paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, { sepaInitiatedAt: { not: null } }] },
        { fulfillmentStatus: "DELIVERED", paymentStatus: { in: ["PENDING_PAYMENT", "PAYMENT_FAILED"] }, sepaInitiatedAt: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { customer: true, address: true },
  });
  const attention = open
    .map((o) => ({ o, a: adminAttention(o) }))
    .filter((x): x is { o: (typeof open)[number]; a: NonNullable<ReturnType<typeof adminAttention>> } => !!x.a)
    .sort((x, y) => (x.a.level === y.a.level ? 0 : x.a.level === "critical" ? -1 : 1));
  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: true, address: true },
  });
  const fmtDate = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
  const sel = "h-11 rounded-xl border border-line bg-white px-3 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      {attention.length > 0 && (
        <section aria-label="Needs action" className="space-y-2" data-testid="needs-action">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Needs action ({attention.length})</h2>
          <ul className="space-y-2">
            {attention.map(({ o, a }) => (
              <li key={o.id}>
                <Link
                  href={`/admin/orders/${o.id}`}
                  data-level={a.level}
                  className={`block rounded-xl p-4 ring-1 ${a.level === "critical" ? "bg-danger text-white ring-danger" : "bg-warn text-warn-ink ring-line"}`}
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-bold">
                      #HF-{o.number} · {o.customer.name}
                    </span>
                    <span className="tabular-nums">{formatMoney(o.totalCents)}</span>
                  </span>
                  <span className="mt-1 block text-sm font-medium">{a.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search number, name, email, postcode" className="w-72" />
        <select name="payment" defaultValue={sp.payment ?? ""} className={sel} aria-label="Payment status">
          <option value="">Payment: paid, SEPA & closed</option>
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
      <ul className="space-y-2 md:hidden" data-testid="orders-cards">
        {orders.map((o) => {
          const a = adminAttention(o);
          return (
            <li key={o.id}>
              <Link href={`/admin/orders/${o.id}`} className="block rounded-xl bg-white p-4 ring-1 ring-line">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-forest">#HF-{o.number}</span>
                  <span className="tabular-nums">{formatMoney(o.totalCents)}</span>
                </span>
                <span className="mt-0.5 block text-sm">{o.customer.name}</span>
                <span className="block text-sm text-muted">
                  {o.address.postalCode} {o.address.city} · {o.deliveryDate.toISOString().slice(0, 10)} {o.slotStartTime}
                </span>
                <span className="mt-2 flex flex-wrap gap-2">
                  <PaymentBadge s={o.paymentStatus} sepa={!!o.sepaInitiatedAt} />
                  <FulfillmentBadge s={o.fulfillmentStatus} />
                  {a?.level === "critical" && <Badge tone="red">payment risk</Badge>}
                </span>
              </Link>
            </li>
          );
        })}
        {orders.length === 0 && <li className="py-10 text-center text-muted">No orders match.</li>}
      </ul>
      <Card className="hidden overflow-x-auto md:block">
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
                  <PaymentBadge s={o.paymentStatus} sepa={!!o.sepaInitiatedAt} />
                </td>
                <td className="px-4 py-3">
                  <FulfillmentBadge s={o.fulfillmentStatus} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {o.deliveryDate.toISOString().slice(0, 10)} {o.slotStartTime}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">{fmtDate(o.createdAt)}</td>
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
