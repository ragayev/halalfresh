"use client";
import { useState } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { formatMoney } from "@/domain/money";
import { formatWeight, lineTotalCents } from "@/domain/pricing";
import { Button } from "./ui";

export function ProductBuyBox({
  p,
}: {
  p: {
    id: string;
    pricePerKgCents: number;
    stepGrams: number;
    minGrams: number;
    maxGrams: number;
    isAvailable: boolean;
  };
}) {
  const { d, locale, t } = useI18n();
  const { add, gramsOf } = useCart();
  // Kg-sold cuts: customer picks half a kilo or a full kilo.
  const halfOrFull = p.minGrams === 500 && p.stepGrams === 500;
  const [grams, setGrams] = useState(halfOrFull ? 1000 : p.minGrams);
  const inCart = gramsOf(p.id);
  const total = formatMoney(lineTotalCents(p.pricePerKgCents, grams), locale);

  const choice = (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={d.product.quantity}>
      {[500, 1000].map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={grams === g}
          onClick={() => setGrams(g)}
          className={`h-14 rounded-2xl text-lg font-semibold ring-1 transition ${
            grams === g ? "bg-forest text-white ring-forest" : "bg-white ring-line hover:bg-sage"
          }`}
        >
          {formatWeight(g)}
        </button>
      ))}
    </div>
  );

  const stepper = (
    <div className="flex items-center justify-between rounded-2xl bg-white p-1 ring-1 ring-line">
      <button
        type="button"
        onClick={() => setGrams((g) => Math.max(p.minGrams, g - p.stepGrams))}
        disabled={grams <= p.minGrams}
        aria-label={d.common.decrease}
        className="grid size-12 place-items-center rounded-xl text-xl hover:bg-sage disabled:opacity-30"
      >
        <Minus className="size-5" aria-hidden />
      </button>
      <output aria-live="polite" className="text-lg font-semibold">
        {formatWeight(grams)}
      </output>
      <button
        type="button"
        onClick={() => setGrams((g) => Math.min(p.maxGrams, g + p.stepGrams))}
        disabled={grams >= p.maxGrams}
        aria-label={d.common.increase}
        className="grid size-12 place-items-center rounded-xl hover:bg-sage disabled:opacity-30"
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  );

  if (!p.isAvailable)
    return <p className="rounded-2xl bg-neutral-100 p-4 text-center font-medium text-neutral-600">{d.common.unavailable}</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold">{d.product.quantity}</p>
        <p className="text-lg font-bold">{t(d.product.lineTotal, { amount: total })}</p>
      </div>
      {halfOrFull ? choice : stepper}
      <p className="text-xs text-muted">
        {!halfOrFull && (
          <>
            {t(d.product.step, {
              step: p.stepGrams >= 1000 ? formatWeight(p.stepGrams) : `${p.stepGrams} g`,
            })}{" "}
            ·{" "}
          </>
        )}
        {d.product.fixedWeightNote}
      </p>
      {/* sticky on mobile, inline on desktop */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-cream/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <Button size="lg" full onClick={() => add(p, Math.min(p.maxGrams, inCart + grams))} data-testid="add-to-cart">
          <ShoppingBag className="size-5" aria-hidden />
          {t(d.product.addFor, { amount: total })}
        </Button>
      </div>
    </div>
  );
}
