import Link from "next/link";
import type { OrderStatus, Prisma } from "@prisma/client";
import { AlertTriangle, CreditCard, Euro } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { overdueThreshold } from "@/server/orders";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { Card, Input } from "@/components/ui";
import { STATUS_ORDER, StatusChip, statusLabel } from "@/components/admin/status-chip";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = STATUS_ORDER.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : undefined;
  const where: Prisma.OrderWhereInput = {};
  if (status) where.status = status;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00.000Z`) : undefined;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T00:00:00.000Z`) : undefined;
  if (from || to) where.deliveryDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const q = sp.q?.trim();
  if (q) {
    const n = parseInt(q.replace(/\D/g, ""), 10);
    where.OR = [
      ...(Number.isFinite(n) ? [{ number: n }] : []),
      { customer: { firstName: { contains: q, mode: "insensitive" as const } } },
      { customer: { lastName: { contains: q, mode: "insensitive" as const } } },
      { customer: { phoneE164: { contains: q.replace(/\s/g, "") } } },
    ];
  }

  const [counts, orders, threshold] = await Promise.all([
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.order.findMany({ where, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }], take: 200, include: { customer: { select: { firstName: true } } } }),
    overdueThreshold(),
  ]);
  const count = new Map(counts.map((c) => [c.status, c._count._all]));
  const href = (s?: string) => `/admin/orders${s ? `?status=${s}` : ""}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Bestellungen</h1>
      <nav aria-label="Status filter" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link href={href()} className={cn("t-small inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4", !status ? "border-primary bg-primary-soft text-primary" : "border-border-strong bg-surface")}>
          Alle
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={href(s)}
            className={cn("t-small inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4", status === s ? "border-primary bg-primary-soft text-primary" : "border-border-strong bg-surface")}
          >
            {statusLabel(s)} <span className="tabular font-semibold">{count.get(s) ?? 0}</span>
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <label className="grow text-sm">
          Suche (Nr., Name, Telefon)
          <Input name="q" defaultValue={q ?? ""} />
        </label>
        <label className="text-sm">
          Lieferung ab
          <Input type="date" name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label className="text-sm">
          bis
          <Input type="date" name="to" defaultValue={sp.to ?? ""} />
        </label>
        <button className="h-12 rounded-[var(--radius-md)] border border-border-strong bg-surface px-4 font-semibold">Filtern</button>
      </form>

      {orders.length === 0 ? (
        <Card className="p-8 text-center text-text-muted">Keine Bestellungen.</Card>
      ) : (
        <ul className="grid gap-2">
          {orders.map((o) => {
            const overdue = o.paymentMethod === "PAYPAL" && (o.status === "PAYMENT_OVERDUE" || (o.status === "WEIGHED" && o.weighedAt != null && o.weighedAt < threshold));
            const total = o.finalTotalCents ?? o.estimatedTotalCents;
            return (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className={cn("flex min-h-16 items-center gap-3 rounded-[var(--radius-md)] border bg-surface p-3", overdue ? "border-danger" : "border-border")}>
                  <div className="min-w-0 grow">
                    <p className="flex items-center gap-2">
                      <span className="tabular font-semibold">{orderNumberLabel(o.number)}</span>
                      <span className="truncate text-sm">{o.customer.firstName}</span>
                      {overdue && <AlertTriangle className="size-4 shrink-0 text-danger" aria-label="Überfällig" />}
                    </p>
                    <p className="t-small text-text-muted">
                      {o.deliveryDate.toISOString().slice(0, 10).split("-").reverse().join(".")} · {o.slotStartTime}–{o.slotEndTime}
                    </p>
                  </div>
                  <span className="tabular t-small font-semibold">
                    {o.finalTotalCents == null ? "ca. " : ""}
                    {formatMoney(total, "de")}
                  </span>
                  {o.paymentMethod === "PAYPAL" ? <CreditCard className="size-5 shrink-0" aria-label="PayPal" /> : <Euro className="size-5 shrink-0" aria-label="Bar" />}
                  <StatusChip status={o.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
