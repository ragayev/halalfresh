"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Minus, Plus, ShoppingBasket, Trash2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { useCartView } from "./use-cart-view";
import { FreeDeliveryBar, MinOrderBanner } from "./cart-progress";
import { DeliveryInfo } from "./delivery-ui";
import { useDelivery } from "./delivery-provider";
import { buttonClasses, Button, Card, Container } from "./ui";
import { formatMoney } from "@/domain/money";
import { formatQuantity } from "@/domain/bundles";
import { BundleContents } from "./bundle-contents";

export function CartPage() {
  const { d, locale, t } = useI18n();
  const { change, remove, clear } = useCart();
  const { data, error, loading } = useCartView();
  const { postcode, openGate } = useDelivery();

  if (loading && !data)
    return (
      <Container className="py-8">
        <div className="skeleton h-96 rounded-[var(--radius-card)]" />
      </Container>
    );
  if (error && !data)
    return (
      <Container className="py-16 text-center">
        <p className="text-danger">{d.common.networkError}</p>
        <Button className="mt-4" onClick={() => location.reload()}>
          {d.common.retry}
        </Button>
      </Container>
    );
  if (!data || data.lines.length === 0) {
    return (
      <Container className="grid place-items-center py-24 text-center">
        <ShoppingBasket className="size-14 text-muted" aria-hidden />
        <h1 className="mt-4 font-display text-3xl font-normal">{d.cart.empty}</h1>
        <p className="mt-1 text-muted">{d.cart.emptyText}</p>
        <Link href={`/${locale}/shop`} className={buttonClasses({ size: "lg" }) + " mt-6"}>
          {d.cart.browse}
        </Link>
      </Container>
    );
  }
  const totals = data.totals!;
  const delivery = data.delivery;
  const unsupported = !postcode || !delivery?.supported;
  const noSlot = !!delivery?.supported && !delivery.nextSlot;
  const blocked = unsupported || noSlot || !totals.meetsMinimum || !!data.hasIssues;
  const hasNonPreorder = data.lines.some((l) => l.issue === "NOT_PREORDER");

  return (
    <Container className="py-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-3xl font-normal">{d.cart.title}</h1>
        <button onClick={clear} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-danger">
          <Trash2 className="size-4" aria-hidden />
          {d.cart.clear}
        </button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]" aria-busy={loading}>
        <div className="space-y-4">
          {unsupported ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn p-4 text-warn-ink">
              <p className="font-semibold">{postcode ? t(d.delivery.cartUnsupported, { postcode }) : d.delivery.needPostcode}</p>
              <Button size="sm" onClick={openGate}>
                {d.delivery.change}
              </Button>
            </div>
          ) : (
            <>
              <MinOrderBanner totals={totals} />
              <FreeDeliveryBar totals={totals} check={delivery} />
            </>
          )}
          {delivery?.mode === "PREORDER_ONLY" && hasNonPreorder && (
            <div className="rounded-2xl bg-warn p-4 text-sm text-warn-ink">
              <p className="font-semibold">{d.delivery.preorderTitle}</p>
              <p>{d.delivery.cartPreorderOnly}</p>
            </div>
          )}
          {data.hasIssues && !hasNonPreorder && (
            <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-danger">
              <AlertTriangle className="size-4" aria-hidden />
              {d.cart.updated}
            </p>
          )}
          <ul className="space-y-3">
            {data.lines.map((l) => (
              <li key={l.productId}>
                <Card className={`flex gap-3 p-3 sm:gap-4 sm:p-4 ${l.issue ? "ring-2 ring-danger/40" : ""}`} data-testid="cart-line">
                  <Link
                    href={`/${locale}/products/${l.slug}`}
                    className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-sage sm:size-28"
                  >
                    {l.image && (
                      <Image src={l.image} alt="" fill unoptimized={l.image.endsWith(".svg")} sizes="112px" className="object-cover" />
                    )}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{l.name}</p>
                        <p className="text-sm text-muted">
                          {formatQuantity(l.grams, l.isBundle)} · {formatMoney(l.pricePerKgCents, locale)}
                          {l.isBundle ? d.common.perPackage : d.common.perKg}
                        </p>
                        {l.bundle && (
                          <details className="mt-1 text-sm">
                            <summary className="cursor-pointer font-medium text-forest-dark underline-offset-4 hover:underline">
                              {d.product.bundleDetails}
                            </summary>
                            <BundleContents
                              items={l.bundle.items}
                              totalGrams={l.bundle.totalGrams}
                              packages={l.grams / 1000}
                              totalLabel={d.product.bundleTotal}
                              className="mt-1"
                            />
                          </details>
                        )}
                        {l.issue && (
                          <p className="mt-1 text-xs font-semibold text-danger">
                            {l.issue === "NOT_PREORDER" ? d.delivery.lineNotPreorder : d.common.unavailable}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => remove(l.productId)}
                        aria-label={`${d.common.remove}: ${l.name}`}
                        className="grid size-10 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-red-50 hover:text-danger"
                      >
                        <Trash2 className="size-5" aria-hidden />
                      </button>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="inline-flex items-center rounded-[var(--radius-button)] bg-sage p-0.5">
                        <button
                          onClick={() => change(l.productId, -l.stepGrams, l.minGrams, l.maxGrams)}
                          aria-label={d.common.decrease}
                          className="grid size-10 place-items-center rounded-[10px] text-forest hover:bg-white"
                        >
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <span className="min-w-14 text-center text-sm font-bold" data-testid="line-weight">
                          {formatQuantity(l.grams, l.isBundle)}
                        </span>
                        <button
                          onClick={() => change(l.productId, l.stepGrams, l.minGrams, l.maxGrams)}
                          disabled={l.grams + l.stepGrams > l.maxGrams}
                          aria-label={d.common.increase}
                          className="grid size-10 place-items-center rounded-[10px] bg-forest text-white hover:bg-forest-dark disabled:opacity-40"
                        >
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </div>
                      <p className="text-lg font-bold tabular-nums">{formatMoney(l.lineTotalCents, locale)}</p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-3 p-5">
            <dl className="space-y-2 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-muted">{d.common.subtotal}</dt>
                <dd className="tabular-nums" data-testid="subtotal">
                  {formatMoney(totals.subtotalCents, locale)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{d.common.delivery}</dt>
                <dd className="tabular-nums">
                  {totals.deliveryFeeCents === 0 ? d.common.free : formatMoney(totals.deliveryFeeCents, locale)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3 text-xl font-bold">
                <dt>{d.common.total}</dt>
                <dd className="tabular-nums">{formatMoney(totals.totalCents, locale)}</dd>
              </div>
            </dl>
            {blocked ? (
              <Button size="lg" full disabled data-testid="checkout-btn">
                {unsupported
                  ? d.delivery.checkoutBlocked
                  : noSlot
                    ? d.delivery.noSlotCheckout
                    : totals.meetsMinimum
                      ? d.cart.updated
                      : t(d.cart.belowMin, {
                          amount: formatMoney(totals.shortfallCents, locale),
                        })}
              </Button>
            ) : (
              <Link href={`/${locale}/checkout`} className={buttonClasses({ size: "lg", full: true })} data-testid="checkout-btn">
                {d.cart.checkout}
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            )}
            {delivery?.supported ? (
              <DeliveryInfo check={delivery} />
            ) : (
              <p className="text-center text-xs text-muted">{d.cart.deliveryCalc}</p>
            )}
          </Card>
        </aside>
      </div>
    </Container>
  );
}
