import Link from "next/link";
import { CheckCircle2, Clock, MapPin, CalendarClock } from "lucide-react";
import type { getOrderByToken } from "@/server/orders";
import type { Dictionary } from "@/i18n/get-dictionary";
import { t } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { deliveryLabel } from "@/domain/whatsapp";
import { Badge, Card } from "./ui";
import { OrderAutoRefresh } from "./order-auto-refresh";
import { ClearCartOnPaid } from "./clear-cart";

type Order = NonNullable<Awaited<ReturnType<typeof getOrderByToken>>>;

export function OrderView({ order, d, locale, justPaid }: { order: Order; d: Dictionary; locale: string; justPaid?: boolean }) {
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus);
  const pending = order.paymentStatus === "PENDING_PAYMENT";
  const tone = paid ? "green" : pending ? "amber" : "red";
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:py-14">
      {paid && <ClearCartOnPaid />}
      {pending && justPaid && <OrderAutoRefresh />}
      <div className="text-center">
        {paid ? (
          <CheckCircle2 className="mx-auto size-14 text-forest" aria-hidden />
        ) : (
          <Clock className="mx-auto size-14 text-warn-ink" aria-hidden />
        )}
        <h1 className="mt-3 font-display text-3xl font-semibold">
          {pending && justPaid ? d.order.processing : justPaid && paid ? d.order.thanks : `${d.order.number} #HF-${order.number}`}
        </h1>
        <p className="mt-2 text-muted" role="status">
          {pending && justPaid ? d.order.processingText : paid ? d.order.paidText : ""}
        </p>
        {paid && justPaid && <p className="mt-1 text-sm text-muted">{t(d.order.emailSent, { email: order.customer.email })}</p>}
      </div>
      <Card className="divide-y divide-line">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <p className="text-sm text-muted">{d.order.number}</p>
            <p className="text-lg font-bold" data-testid="order-number">
              #HF-{order.number}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge tone={tone}>{d.payment[order.paymentStatus]}</Badge>
            {paid && <Badge tone="blue">{d.fulfillment[order.fulfillmentStatus]}</Badge>}
          </div>
        </div>
        <div className="p-5">
          <p className="mb-3 font-semibold">{d.order.items}</p>
          <ul className="space-y-2 text-sm">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span>
                  {i.productName} <span className="text-muted">— {formatWeight(i.quantityGrams)}</span>
                </span>
                <span className="tabular-nums">{formatMoney(i.lineTotalCents, locale)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{d.common.subtotal}</dt>
              <dd>{formatMoney(order.subtotalCents, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{d.common.delivery}</dt>
              <dd>{order.deliveryFeeCents ? formatMoney(order.deliveryFeeCents, locale) : d.common.free}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>{d.common.total}</dt>
              <dd>{formatMoney(order.totalCents, locale)}</dd>
            </div>
            {order.refundedCents > 0 && (
              <div className="flex justify-between text-muted">
                <dt>
                  {t(d.order.refunded, {
                    amount: formatMoney(order.refundedCents, locale),
                  })}
                </dt>
              </div>
            )}
          </dl>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="flex gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
            <div>
              <p className="font-semibold">{d.order.address}</p>
              <p className="text-sm text-muted">
                {order.customer.name}
                <br />
                {order.address.street}
                <br />
                {order.address.postalCode} {order.address.city}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
            <div>
              <p className="font-semibold">{d.order.slot}</p>
              <p className="text-sm text-muted">
                {deliveryLabel(order.deliveryDate.toISOString().slice(0, 10), order.slotStartTime, order.slotEndTime, locale)}
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 text-sm text-muted">
          <p>
            {d.order.contactUs} <span className="font-medium text-ink">{order.merchant.legalName ?? order.merchant.name}</span>
            {order.merchant.contactEmail ? ` · ${order.merchant.contactEmail}` : ""}
            {order.merchant.contactPhone ? ` · ${order.merchant.contactPhone}` : ""}
          </p>
          <p className="mt-2">{d.order.bookmark}</p>
        </div>
      </Card>
      <p className="text-center">
        <Link href={`/${locale}/shop`} className="text-sm font-semibold text-forest hover:underline">
          {d.cart.browse}
        </Link>
      </p>
    </div>
  );
}
