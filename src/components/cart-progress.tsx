"use client";
import { PackageCheck, Package } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { formatMoney } from "@/domain/money";
import type { Totals } from "@/domain/pricing";
import { ProgressBar } from "./ui";

export function MinOrderBanner({ totals }: { totals: Totals }) {
  const { d, locale, t } = useI18n();
  if (totals.minOrderCents <= 0) return null;
  const min = formatMoney(totals.minOrderCents, locale);
  const ok = totals.meetsMinimum;
  return (
    <div className={`rounded-2xl p-4 ${ok ? "bg-sage text-forest-dark" : "bg-warn text-warn-ink"}`} data-testid="min-order-progress">
      <div className="flex items-start gap-3">
        {ok ? <PackageCheck className="size-7 shrink-0" aria-hidden /> : <Package className="size-7 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {ok
              ? d.cart.reached
              : t(d.cart.addMore, {
                  amount: formatMoney(totals.shortfallCents, locale),
                })}
          </p>
          <p className="text-sm opacity-80">{ok ? d.cart.reachedText : `${t(d.cart.minimumIs, { amount: min })} ${d.cart.almost}`}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar value={Math.min(totals.subtotalCents, totals.minOrderCents)} max={totals.minOrderCents} label={d.cart.title} />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums">
              {formatMoney(totals.subtotalCents, locale)} / {min}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
