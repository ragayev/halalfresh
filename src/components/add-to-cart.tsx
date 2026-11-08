"use client";
import { useState } from "react";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { formatQuantity } from "@/domain/bundles";

/** `bundleSlug` set = a Paket: it expands into ordinary product lines (no package line ever exists in the cart). */
export function AddToCart({ product }: { product: { id: string; name: string; stepGrams: number; minGrams: number; maxGrams: number; bundle?: boolean; bundleSlug?: string } }) {
  const { d } = useI18n();
  const { gramsOf, add, change, ready, addBundle } = useCart();
  const [failed, setFailed] = useState(false);
  const grams = ready ? gramsOf(product.id) : 0;

  if (product.bundleSlug) {
    return (
      <div>
        <button
          type="button"
          onClick={async () => setFailed(!(await addBundle(product.bundleSlug!)))}
          data-testid="quick-add"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-primary text-sm font-semibold text-text-inverse transition hover:bg-primary-hover"
        >
          <ShoppingCart className="size-4" aria-hidden />
          {d.common.addToCart}
        </button>
        {failed && <p role="alert" className="t-small mt-1 text-danger">{d.common.unavailable}</p>}
      </div>
    );
  }
  if (grams === 0) {
    return (
      <button
        type="button"
        onClick={() => add(product)}
        aria-label={`${d.common.addToCart}: ${product.name}`}
        data-testid="quick-add"
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-forest text-sm font-semibold text-white transition hover:bg-forest-dark active:scale-[0.98]"
      >
        <ShoppingCart className="size-4" aria-hidden />
        {d.common.addToCart}
      </button>
    );
  }
  return (
    <div className="flex h-10 w-full items-center justify-between rounded-md bg-sage p-0.5" role="group" aria-label={product.name}>
      <button
        type="button"
        onClick={() => change(product.id, -product.stepGrams, product.minGrams, product.maxGrams)}
        aria-label={d.common.decrease}
        className="grid h-9 w-10 place-items-center rounded text-forest hover:bg-white"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="text-sm font-bold text-forest-dark" aria-live="polite">
        {formatQuantity(grams, !!product.bundle)}
      </span>
      <button
        type="button"
        onClick={() => add(product)}
        disabled={grams + product.stepGrams > product.maxGrams}
        aria-label={d.common.increase}
        className="grid h-9 w-10 place-items-center rounded bg-forest text-white hover:bg-forest-dark disabled:opacity-40"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
