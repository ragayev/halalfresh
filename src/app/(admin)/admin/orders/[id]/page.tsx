import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth";
import { getOrderForAdmin } from "@/server/orders";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { Card, Notice } from "@/components/ui";
import { StatusChip } from "@/components/admin/status-chip";
import { NoteForm, OrderActions, ResendButton, WhatsappButtons } from "@/components/admin/order-actions";
import { WeightForm } from "@/components/admin/weight-form";

export const dynamic = "force-dynamic";

const fmtTime = (d: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
const RESEND: Record<string, string> = { ACCEPTED: "accepted", WEIGHED: "weighed", PAYMENT_OVERDUE: "payment_overdue", OUT_FOR_DELIVERY: "out_for_delivery", CANCELLED: "cancelled", NEW: "order_created" };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const o = await getOrderForAdmin(id);
  if (!o) notFound();
  const m = (c: number) => formatMoney(c, "de");
  const weighing = o.status === "PREPARING";
  const correcting = (o.status === "WEIGHED" || o.status === "PAYMENT_OVERDUE") && !o.paidAt;
  const resend = RESEND[o.status];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/orders" className="t-small inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft className="size-4" aria-hidden /> Bestellungen
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="tabular text-2xl font-semibold">{orderNumberLabel(o.number)}</h1>
        <StatusChip status={o.status} />
        <span className="t-small text-text-muted">{o.paymentMethod === "PAYPAL" ? "PayPal" : "Barzahlung"}</span>
      </header>

      <OrderActions orderId={o.id} status={o.status} method={o.paymentMethod} scrollToWeights={weighing} />
      <WhatsappButtons orderId={o.id} customerPhone={o.customer.phoneE164} />

      {o.cappedAmountCents ? (
        <Notice tone="danger">
          Gedeckelt: {m(o.cappedAmountCents)} über dem Maximalbetrag werden vom Verkäufer getragen.
        </Notice>
      ) : null}
      {o.refundedCents > 0 && <Notice tone="info">Erstattet: {m(o.refundedCents)} (in PayPal durchgeführt)</Notice>}
      {o.notes && <Notice tone="info">Kundenhinweis: {o.notes}</Notice>}

      {(weighing || correcting) && (
        <WeightForm
          orderId={o.id}
          correction={correcting}
          toleranceBps={o.toleranceBps}
          estimatedTotalCents={o.estimatedTotalCents}
          maxTotalCents={o.maxTotalCents}
          deliveryFeeCents={o.deliveryFeeCents}
          lines={o.items.map((i) => ({ id: i.id, name: i.productName, requestedGrams: i.requestedGrams, unitPricePerKgCents: i.unitPricePerKgCents, actualGrams: i.actualGrams }))}
        />
      )}

      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Positionen</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="py-1 font-medium">Produkt</th>
              <th className="py-1 text-right font-medium">Bestellt</th>
              <th className="py-1 text-right font-medium">Gewogen</th>
              <th className="py-1 text-right font-medium">Betrag</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {o.items.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="py-2">
                  {i.productName}
                  <span className="block text-text-muted">{m(i.unitPricePerKgCents)} / kg{i.bundleId ? ` · Paket ${i.bundleId}` : ""}</span>
                </td>
                <td className="py-2 text-right">{i.requestedGrams} g</td>
                <td className="py-2 text-right">{i.actualGrams == null ? "–" : i.actualGrams === 0 ? "n. v." : `${i.actualGrams} g`}</td>
                <td className="py-2 text-right">{i.finalCents == null ? `ca. ${m(i.estimatedCents)}` : m(i.finalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Beträge</h2>
        <dl className="tabular grid grid-cols-2 gap-y-1 text-sm">
          <dt>Geschätzt</dt><dd className="text-right">{m(o.estimatedTotalCents)}</dd>
          <dt>Maximal (+{o.toleranceBps / 100} %)</dt><dd className="text-right">{m(o.maxTotalCents)}</dd>
          <dt>Lieferung</dt><dd className="text-right">{m(o.deliveryFeeCents)}</dd>
          <dt className="font-semibold">Endbetrag</dt><dd className="text-right font-semibold">{o.finalTotalCents == null ? "–" : m(o.finalTotalCents)}</dd>
          {o.paidAmountCents != null && (<><dt>Bezahlt</dt><dd className="text-right">{m(o.paidAmountCents)}</dd></>)}
        </dl>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Kunde</h2>
        <p>{o.customer.firstName} {o.customer.lastName}</p>
        <p className="t-small text-text-muted">{o.customer.phoneE164} · {o.customer.email}</p>
        <p className="t-small mt-2">{o.street}, {o.postalCode} {o.city}</p>
        <p className="t-small">Lieferung: {o.deliveryDate.toISOString().slice(0, 10).split("-").reverse().join(".")} · {o.slotStartTime}–{o.slotEndTime} ({o.zoneName})</p>
        {o.deliveryNotes && <p className="t-small mt-1">Hinweis: {o.deliveryNotes}</p>}
        <p className="t-small mt-2 text-text-muted">
          Verweigerungen: {o.customer.refusedCount}{o.customer.blockedCash ? " · Barzahlung gesperrt" : ""}
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Zahlung</h2>
        {o.payments.length === 0 ? (
          <p className="t-small text-text-muted">Noch keine PayPal-Zahlung gestartet.</p>
        ) : (
          <ul className="t-small space-y-1">
            {o.payments.map((p) => (
              <li key={p.id} className="tabular">
                {fmtTime(p.createdAt)} · {m(p.amountCents)} · <strong>{p.status}</strong> · {p.providerOrderId}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Verlauf</h2>
        <ol className="t-small space-y-2">
          {o.events.map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <span className="tabular text-text-muted">{fmtTime(e.createdAt)}</span> · {e.fromStatus ?? "–"} → <strong>{e.toStatus ?? "–"}</strong> · {e.actor}
              {e.reason ? ` · ${e.reason}` : ""}
            </li>
          ))}
        </ol>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="text-lg font-semibold">Benachrichtigungen</h2>
        {o.notifications.length === 0 ? (
          <p className="t-small text-text-muted">Keine.</p>
        ) : (
          <ul className="t-small space-y-1">
            {o.notifications.map((n) => (
              <li key={n.id} className="tabular">
                {fmtTime(n.createdAt)} · {n.channel} · {n.template} · {n.recipient} · <strong>{n.status}</strong>{n.error ? ` (${n.error})` : ""}
              </li>
            ))}
          </ul>
        )}
        {resend && <ResendButton orderId={o.id} template={resend} />}
      </Card>

      <Card className="p-4">
        <NoteForm orderId={o.id} initial={o.adminNotes ?? ""} />
      </Card>
    </div>
  );
}
