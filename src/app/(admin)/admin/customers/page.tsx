import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { Card, Input } from "@/components/ui";
import { BlockCashButton } from "@/components/admin/block-cash-button";
import { StatusChip } from "@/components/admin/status-chip";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q } = await searchParams;
  const term = q?.trim();
  const customers = await db.customer.findMany({
    where: term ? { OR: [{ phoneE164: { contains: term.replace(/\s/g, "") } }, { lastName: { contains: term, mode: "insensitive" } }, { firstName: { contains: term, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { orders: { orderBy: { number: "desc" }, take: 5 }, consents: { orderBy: { createdAt: "desc" }, take: 6 }, _count: { select: { orders: true } } },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Kunden</h1>
      <form role="search" className="flex gap-2">
        <label className="grow text-sm">
          Telefon oder Name
          <Input name="q" defaultValue={term ?? ""} />
        </label>
        <button className="mt-6 h-12 rounded-[var(--radius-md)] border border-border-strong bg-surface px-4 font-semibold">Suchen</button>
      </form>
      <ul className="space-y-3">
        {customers.map((c) => (
          <li key={c.id}>
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.firstName} {c.lastName}</p>
                  <p className="t-small tabular text-text-muted">{c.phoneE164} · {c.email}</p>
                </div>
                <BlockCashButton customerId={c.id} blocked={c.blockedCash} />
              </div>
              <p className="t-small">
                Bestellungen: <strong>{c._count.orders}</strong> · Verweigerungen: <strong>{c.refusedCount}</strong>
                {c.blockedCash ? " · Barzahlung gesperrt" : ""}
              </p>
              <ul className="t-small space-y-1">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/orders/${o.id}`} className="tabular font-medium text-primary underline">{orderNumberLabel(o.number)}</Link>
                    <StatusChip status={o.status} />
                    <span className="tabular">{formatMoney(o.finalTotalCents ?? o.estimatedTotalCents, "de")}</span>
                  </li>
                ))}
              </ul>
              <details className="t-small text-text-muted">
                <summary className="min-h-11 cursor-pointer py-2">Einwilligungen</summary>
                <ul>
                  {c.consents.map((x) => (
                    <li key={x.id} className="tabular">{x.type}: {x.granted ? "ja" : "nein"} · Version {x.wordingVersion} · {x.createdAt.toISOString().slice(0, 16).replace("T", " ")}</li>
                  ))}
                </ul>
              </details>
            </Card>
          </li>
        ))}
        {customers.length === 0 && <Card className="p-8 text-center text-text-muted">Keine Kunden.</Card>}
      </ul>
    </div>
  );
}
