import Link from "next/link";
import { Check, CheckCircle2, Clock, CreditCard, MapPin, CalendarClock, XCircle } from "lucide-react";
import type { getOrderByToken } from "@/server/orders";
import type { Dictionary } from "@/i18n/get-dictionary";
import { t } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { bundleItemName, formatQuantity, parseBundleSnapshot } from "@/domain/bundles";
import { BundleContents } from "./bundle-contents";
import { deliveryLabel } from "@/domain/whatsapp";
import { Badge, Card } from "./ui";
import { isOrderReceived, paymentView, pollIntervalMs, timelineIndex, TIMELINE_STEPS } from "@/domain/order-state";
import { OrderAutoRefresh } from "./order-auto-refresh";
import { ClearCartOnPaid } from "./clear-cart";

type Order = NonNullable<Awaited<ReturnType<typeof getOrderByToken>>>;

export function OrderView({
  order,
  token,
  d,
  locale,
  justPaid,
}: {
  order: Order;
  /** The guest link token the visitor already holds; the query deliberately does not return it. */
  token: string;
  d: Dictionary;
  locale: string;
  justPaid?: boolean;
}) {
  const pay = paymentView(order);
  const received = isOrderReceived(order);
  const cancelled = order.fulfillmentStatus === "CANCELLED";
  const settled = pay === "PAID" || pay === "PARTIALLY_REFUNDED" || pay === "REFUNDED";
  const reached = timelineIndex(order.fulfillmentStatus);
  const showTimeline = received && !cancelled;
  const payTone = settled ? "green" : pay === "PROCESSING" || pay === "UNPAID" ? "amber" : "red";
  const polling = pollIntervalMs(order, { redirectedFromCheckout: justPaid }) !== null;
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:py-14">
      {received && <ClearCartOnPaid />}
      {polling && (
        <OrderAutoRefresh
          token={token}
          paymentStatus={order.paymentStatus}
          fulfillmentStatus={order.fulfillmentStatus}
          version={order.updatedAt.getTime()}
          redirectedFromCheckout={justPaid}
        />
      )}
      <div className="text-center">
        {cancelled ? (
          <XCircle className="mx-auto size-14 text-danger" aria-hidden />
        ) : received ? (
          <CheckCircle2 className="mx-auto size-14 text-forest" aria-hidden />
        ) : (
          <Clock className="mx-auto size-14 text-warn-ink" aria-hidden />
        )}
        <h1 className="mt-3 font-display text-3xl font-normal">
          {cancelled
            ? d.order.cancelledTitle2
            : justPaid && settled
              ? d.order.thanks
              : justPaid && pay === "PROCESSING"
                ? d.order.receivedTitle
                : justPaid && pay === "UNPAID"
                  ? d.order.processing
                  : `${d.order.number} #HF-${order.number}`}
        </h1>
        <p className="mt-2 text-muted" role="status">
          {cancelled
            ? d.order.cancelledBanner
            : justPaid && pay === "UNPAID"
              ? d.order.processingText
              : justPaid && pay === "PROCESSING"
                ? d.order.receivedText
                : justPaid && settled
                  ? d.order.paidText
                  : ""}
        </p>
        {received && justPaid && <p className="mt-1 text-sm text-muted">{t(d.order.emailSent, { email: order.customer.email })}</p>}
      </div>
      {showTimeline && (
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">{d.order.progress}</h2>
          <ol className="space-y-0" data-testid="order-timeline">
            {TIMELINE_STEPS.map((step, i) => {
              const state = i < reached || (i === reached && reached === TIMELINE_STEPS.length - 1) ? "done" : i === reached ? "current" : "todo";
              return (
                <li key={step} className="relative flex gap-3 pb-5 last:pb-0" data-step={step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  {i < TIMELINE_STEPS.length - 1 && (
                    <span aria-hidden className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${state === "done" ? "bg-forest" : "bg-line"}`} />
                  )}
                  <span
                    aria-hidden
                    className={`relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${
                      state === "done"
                        ? "border-forest bg-forest text-white"
                        : state === "current"
                          ? "border-forest bg-white text-forest ring-4 ring-sage"
                          : "border-line bg-white text-muted"
                    }`}
                  >
                    {state === "done" ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
                  </span>
                  <div className="min-w-0">
                    <p className={state === "todo" ? "font-medium text-muted" : "font-semibold"}>
                      {d.order.steps[step]}
                      <span className="sr-only">
                        {" "}
                        ({state === "done" ? d.order.stepDone : state === "current" ? d.order.stepCurrent : d.order.stepTodo})
                      </span>
                    </p>
                    {state === "current" && <p className="text-sm text-muted">{d.order.stepHints[step]}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
      <Card className="flex items-start gap-3 p-5" data-testid="payment-indicator" data-payment={pay}>
        <CreditCard className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {d.order.paymentTitle}
            <Badge tone={payTone}>{d.order.pay[pay].label}</Badge>
          </p>
          <p className="mt-1 text-sm text-muted">{d.order.pay[pay].text}</p>
        </div>
      </Card>
      <Card className="divide-y divide-line">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5">
          <div>
            <p className="text-sm text-muted">{d.order.number}</p>
            <p className="text-lg font-bold" data-testid="order-number">
              #HF-{order.number}
            </p>
          </div>
          {cancelled && <Badge tone="red">{d.fulfillment.CANCELLED}</Badge>}
        </div>
        <div className="p-5">
          <p className="mb-3 font-semibold">{d.order.items}</p>
          <ul className="space-y-2 text-sm">
            {order.items.map((i) => {
              const snap = parseBundleSnapshot(i.bundleSnapshot);
              return (
                <li key={i.id}>
                  <div className="flex justify-between gap-3">
                    <span>
                      {i.productName} <span className="text-muted">— {formatQuantity(i.quantityGrams, !!snap)}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(i.lineTotalCents, locale)}</span>
                  </div>
                  {snap && (
                    <BundleContents
                      items={snap.items.map((b) => ({ name: bundleItemName(b, locale), grams: b.grams }))}
                      totalGrams={snap.totalGrams}
                      packages={i.quantityGrams / 1000}
                      totalLabel={d.product.bundleTotal}
                      className="mt-1 ps-3 text-muted"
                    />
                  )}
                </li>
              );
            })}
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
