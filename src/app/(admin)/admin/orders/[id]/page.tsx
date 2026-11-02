import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { getOrderForAdmin } from "@/server/orders";
import { adminAttention, fulfillmentGate, fulfillmentMoveAllowed, nextFulfillmentOptions } from "@/domain/order-state";
import { formatMoney } from "@/domain/money";
import { orderItemLines } from "@/domain/bundles";
import { buildWhatsappMessage, deliveryLabel } from "@/domain/whatsapp";
import { Card } from "@/components/ui";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/badges";
import { EarlyAuthorizePanel, NoteForm, RefundForm, StatusButtons, WhatsappPanel } from "@/components/admin/order-actions";

export const dynamic = "force-dynamic";
const LABEL: Record<string, string> = {
  AWAITING_FORWARDING: "Back to awaiting forwarding",
  FORWARDED: "Mark forwarded",
  CONFIRMED_BY_BUTCHER: "Confirmed by butcher",
  PREPARING: "Preparing",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancel order",
};

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const o = await getOrderForAdmin(id);
  if (!o) notFound();
  const paid = o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_REFUNDED";
  const gate = fulfillmentGate(o);
  const attention = adminAttention(o);
  const sepaPending = o.paymentStatus === "PENDING_PAYMENT" && !!o.sepaInitiatedAt;
  const payment = o.payments[0];
  const message = buildWhatsappMessage({
    number: o.number,
    customerName: o.customer.name,
    phone: o.customer.phone,
    street: o.address.street,
    postalCode: o.address.postalCode,
    city: o.address.city,
    items: o.items,
    totalCents: o.totalCents,
    paymentStatus: o.paymentStatus,
    sepaPendingAuthorized: gate === "EARLY_AUTHORIZED",
    deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
    slotStartTime: o.slotStartTime,
    slotEndTime: o.slotEndTime,
    deliveryInstructions: o.deliveryInstructions,
  });
  // Offer only moves the server would accept right now (the server re-checks every one of them).
  const options = nextFulfillmentOptions(o.fulfillmentStatus)
    .filter((s) => s !== "FORWARDED" && (s === "CANCELLED" ? !sepaPending : true))
    .filter((s) => fulfillmentMoveAllowed(o, s).ok)
    .map((s) => ({ value: s, label: LABEL[s] }));
  const fmt = (d: Date) =>
    d.toLocaleString("de-DE", {
      timeZone: "Europe/Berlin",
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/orders" className="text-sm text-forest hover:underline">
          ← Orders
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="order-title">
          Order #HF-{o.number}
        </h1>
        <PaymentBadge s={o.paymentStatus} sepa={!!o.sepaInitiatedAt} />
        <FulfillmentBadge s={o.fulfillmentStatus} />
      </div>
      {attention && (
        <p
          role="alert"
          data-testid="attention-banner"
          className={`rounded-xl p-4 text-sm font-semibold ${attention.level === "critical" ? "bg-danger text-white" : "bg-warn text-warn-ink"}`}
        >
          {attention.reason}
          {o.paymentStatus === "PAYMENT_FAILED" && payment?.failureReason ? ` (${payment.failureReason})` : ""}
        </p>
      )}
      {gate === "NEEDS_AUTHORIZATION" && o.fulfillmentStatus !== "CANCELLED" && (
        <Card className="p-5">
          <EarlyAuthorizePanel orderId={o.id} amountLabel={formatMoney(o.totalCents)} />
        </Card>
      )}
      {gate === "EARLY_AUTHORIZED" && (
        <p className="rounded-xl bg-warn p-3 text-sm font-medium text-warn-ink" data-testid="early-authorized-note">
          Fulfilling on SEPA collection risk, authorized by {o.earlyFulfillmentAuthorizedBy}
          {o.earlyFulfillmentAuthorizedAt ? ` on ${fmt(o.earlyFulfillmentAuthorizedAt)}` : ""}. Payment is not confirmed yet.
        </p>
      )}
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Forward to butcher</h2>
        {!o.merchant.whatsappNumber && (
          <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-danger">
            Butcher WhatsApp number missing. Set it in{" "}
            <Link href="/admin/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        )}
        <WhatsappPanel
          orderId={o.id}
          openCount={o.whatsappOpenCount}
          forwardedAt={o.forwardedAt ? fmt(o.forwardedAt) : null}
          canForward={(gate === "OPEN" || gate === "EARLY_AUTHORIZED") && !!o.merchant.whatsappNumber && o.fulfillmentStatus !== "CANCELLED"}
          message={message}
        />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-semibold">Customer & delivery</h2>
          <p>{o.customer.name}</p>
          <p>
            <a className="text-forest underline" href={`mailto:${o.customer.email}`}>
              {o.customer.email}
            </a>{" "}
            ·{" "}
            <a className="text-forest underline" href={`tel:${o.customer.phone}`}>
              {o.customer.phone}
            </a>
          </p>
          <p>
            {o.address.street}
            <br />
            {o.address.postalCode} {o.address.city}
          </p>
          <p className="font-medium">{deliveryLabel(o.deliveryDate.toISOString().slice(0, 10), o.slotStartTime, o.slotEndTime)}</p>
          <p className="text-muted">Instructions: {o.deliveryInstructions ?? "—"}</p>
        </Card>
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-semibold">Items & totals</h2>
          <ul className="space-y-1">
            {o.items.map((i) => (
              <li key={i.id}>
                <div className="flex justify-between">
                  <span>{orderItemLines(i, "de")[0].slice(2)}</span>
                  <span className="tabular-nums">{formatMoney(i.lineTotalCents)}</span>
                </div>
                {orderItemLines(i, "de")
                  .slice(1)
                  .map((l) => (
                    <p key={l} className="ps-3 text-xs text-muted">
                      {l.trim()}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-line pt-2">
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatMoney(o.subtotalCents)}</span>
            </p>
            <p className="flex justify-between">
              <span>Delivery</span>
              <span>{formatMoney(o.deliveryFeeCents)}</span>
            </p>
            <p className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatMoney(o.totalCents)}</span>
            </p>
            {o.refundedCents > 0 && (
              <p className="flex justify-between text-muted">
                <span>Refunded</span>
                <span>{formatMoney(o.refundedCents)}</span>
              </p>
            )}
          </div>
        </Card>
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-semibold">Payment</h2>
          {payment ? (
            <>
              <p>
                Status: <PaymentBadge s={payment.status} sepa={!!o.sepaInitiatedAt} />
                {payment.paidAt ? ` · ${fmt(payment.paidAt)}` : ""}
              </p>
              <p className="break-all text-muted">
                Provider: {payment.provider}
                <br />
                Session: {payment.stripeCheckoutSessionId ?? "—"}
                <br />
                Intent: {payment.stripePaymentIntentId ?? "—"}
                <br />
                Balance txn: {payment.balanceTransactionId ?? "—"}
                <br />
                Stripe fee: {payment.stripeFeeCents != null ? formatMoney(payment.stripeFeeCents) : "n/a"}
              </p>
              {payment.refunds.map((r) => (
                <p key={r.id} className="text-muted">
                  Refund {formatMoney(r.amountCents)} ({r.status}) · {fmt(r.createdAt)}
                </p>
              ))}
            </>
          ) : (
            <p>—</p>
          )}
          {paid && o.totalCents - o.refundedCents > 0 && (
            <div className="border-t border-line pt-3">
              <p className="mb-2 font-medium">Refund</p>
              <RefundForm orderId={o.id} remainingCents={o.totalCents - o.refundedCents} />
            </div>
          )}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Fulfillment</h2>
          <StatusButtons orderId={o.id} options={options} />
          <h3 className="pt-2 text-sm font-semibold">Internal notes</h3>
          <NoteForm orderId={o.id} initial={o.adminNotes ?? ""} />
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Timeline</h2>
        <ol className="space-y-2 text-sm">
          {o.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-32 shrink-0 text-muted">{fmt(e.createdAt)}</span>
              <span>
                {e.type.replace(/_/g, " ").toLowerCase()}
                {e.toStatus ? ` → ${e.toStatus}` : ""}
                {e.note ? ` · ${e.note}` : ""}
                <span className="text-muted"> · {e.actor}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
