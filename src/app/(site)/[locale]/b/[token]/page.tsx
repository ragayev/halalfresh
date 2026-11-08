import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Store } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getOrderByToken } from "@/server/orders";
import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import { mvpCopy } from "@/content/mvp-copy";
import { Card, Container, Notice, SellerBox } from "@/components/ui";
import { CancelButton, PayButton } from "@/components/order-actions-client";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
// Private page: never indexed, no third-party scripts.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const STEPS = ["NEW", "ACCEPTED", "PREPARING", "WEIGHED", "PAID", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
const rank = (s: string) => {
  const i = STEPS.indexOf(s as (typeof STEPS)[number]);
  if (i >= 0) return i;
  if (s === "PAYMENT_OVERDUE") return 3;
  if (s === "DELIVERED_UNPAID") return 5;
  if (s === "CASH_COLLECTED") return 6;
  return -1;
};

export default async function OrderPage({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const c = mvpCopy(locale);
  const found = await getOrderByToken(token);
  if (!found) notFound();
  const { order: o, expired } = found;

  if (expired)
    return (
      <Container className="max-w-xl py-16 text-center">
        <h1 className="t-h2">{c.expired}</h1>
        <p className="mt-2 text-text-muted">{c.expiredHint}</p>
      </Container>
    );

  const m = (cents: number) => formatMoney(cents, locale);
  const cancelled = o.status === "CANCELLED" || o.status === "REFUSED_AT_DOOR";
  const cur = rank(o.status);
  const seller = o.merchant;
  const at = (s: string) => o.events.find((e) => e.toStatus === s)?.createdAt;
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
  const day = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(o.deliveryDate);
  const payable = o.paymentMethod === "PAYPAL" && (o.status === "WEIGHED" || o.status === "PAYMENT_OVERDUE") && o.finalTotalCents != null;
  const weighed = o.finalTotalCents != null;

  return (
    <Container className="max-w-2xl space-y-6 py-8">
      <header>
        <h1 className="t-h1 tabular">{orderNumberLabel(o.number)}</h1>
        <p className="mt-1 font-semibold">{c.statuses[o.status]}</p>
      </header>

      {payable && (
        <Card className="space-y-3 border-primary p-4">
          <p className="t-price-lg">{c.payNow(m(o.finalTotalCents!))}</p>
          <PayButton token={token} label={c.payWithPaypal} returnedOrderId={sp.token} />
        </Card>
      )}
      {o.paymentMethod === "CASH" && weighed && ["WEIGHED", "OUT_FOR_DELIVERY", "DELIVERED_UNPAID"].includes(o.status) && (
        <Notice tone="info">
          <span className="t-price">{c.cashDue(m(o.finalTotalCents!))}</span>
        </Notice>
      )}
      {o.paymentMethod === "PAYPAL" && o.status === "WEIGHED" && sp.token && <Notice tone="info">{c.paymentPending}</Notice>}
      {o.paidAt && o.paymentMethod === "PAYPAL" && <Notice tone="success">{c.paid}</Notice>}
      {o.cappedAmountCents ? <Notice tone="info">{c.cappedNote}</Notice> : null}

      {!cancelled && (
        <ol aria-label="Status" className="space-y-0">
          {STEPS.map((s, i) => {
            const done = i < cur || (i === cur && (s === "DELIVERED" || s === "PAID" ? true : false));
            const current = i === cur && !done;
            const ts = at(s);
            return (
              <li key={s} className="relative flex gap-3 pb-5 last:pb-0">
                {i < STEPS.length - 1 && <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />}
                <span aria-hidden className={cn("relative mt-1.5 size-3 shrink-0 rounded-full border-2", done ? "border-primary bg-primary" : current ? "border-primary bg-surface ring-4 ring-primary-soft" : "border-border bg-surface")} />
                <div>
                  <p className={cn(current ? "font-semibold" : done ? "" : "text-text-muted")}>
                    {c.statuses[s]}
                    {done && <Check className="ml-1 inline size-4 text-primary" aria-hidden />}
                  </p>
                  {ts && <p className="t-caption text-text-muted tabular">{fmt(ts)}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {cancelled && o.cancelReason && o.status === "CANCELLED" && <Notice tone="danger">{o.cancelReason}</Notice>}

      <Card className="overflow-hidden">
        <h2 className="t-h3 p-4 pb-2">{c.items}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="px-4 py-1 font-medium">&nbsp;</th>
              <th className="px-2 py-1 text-right font-medium">{c.requested}</th>
              <th className="px-2 py-1 text-right font-medium">{c.actual}</th>
              <th className="px-4 py-1 text-right font-medium">{c.amount}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {o.items.map((i) => (
              <tr key={i.id} className="border-t border-border align-top">
                <td className="px-4 py-2">
                  {i.productName}
                  <span className="block text-text-muted">{m(i.unitPricePerKgCents)} / kg</span>
                </td>
                <td className="px-2 py-2 text-right">{(i.requestedGrams / 1000).toLocaleString(locale === "tr" ? "tr-TR" : "de-DE", { minimumFractionDigits: 1 })} kg</td>
                <td className="px-2 py-2 text-right">{i.actualGrams == null ? "–" : i.actualGrams === 0 ? c.unavailableItem : `${(i.actualGrams / 1000).toLocaleString(locale === "tr" ? "tr-TR" : "de-DE", { minimumFractionDigits: 2 })} kg`}</td>
                <td className="px-4 py-2 text-right">{i.finalCents != null ? m(i.finalCents) : `ca. ${m(i.estimatedCents)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="tabular space-y-1 border-t border-border p-4 text-sm">
          <div className="flex justify-between"><dt className="text-text-muted">{c.estimatedTotal}</dt><dd>ca. {m(o.estimatedTotalCents)}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">{c.maxTotal}</dt><dd>{m(o.maxTotalCents)}</dd></div>
          {o.deliveryFeeCents > 0 && <div className="flex justify-between"><dt className="text-text-muted">{c.deliveryFee}</dt><dd>{m(o.deliveryFeeCents)}</dd></div>}
          {weighed && <div className="t-price flex justify-between border-t border-border pt-2"><dt>{c.finalTotal}</dt><dd>{m(o.finalTotalCents!)}</dd></div>}
        </dl>
      </Card>

      <Card className="space-y-1 p-4 text-sm">
        <h2 className="t-h3">{c.deliverySlot}</h2>
        <p className="capitalize">{day}, {o.slotStartTime}–{o.slotEndTime}</p>
        <p className="text-text-muted">{o.street}, {o.postalCode} {o.city}</p>
      </Card>

      <SellerBox title={c.sellerTitle}>
        <p>
          <Store className="hidden" aria-hidden />
          {seller.legalName ?? seller.name}
          {seller.addressLine ? `, ${seller.addressLine}, ${[seller.postalCode, seller.city].filter(Boolean).join(" ")}` : ""}
          {seller.contactPhone ? `, ${seller.contactPhone}` : ""}
          {seller.contactEmail ? `, ${seller.contactEmail}` : ""}
        </p>
      </SellerBox>

      {(o.status === "NEW" || o.status === "ACCEPTED") && <CancelButton token={token} labels={{ cancel: c.cancel, confirm: c.cancelConfirm, yes: c.cancelYes, back: c.back }} />}
    </Container>
  );
}
