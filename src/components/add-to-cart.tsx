"use client";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { formatWeight } from "@/domain/pricing";

export function AddToCart({ product }: { product: { id: string; name: string; stepGrams: number; minGrams: number; maxGrams: number } }) {
  const { d } = useI18n();
  const { gramsOf, add, change, ready } = useCart();
  const grams = ready ? gramsOf(product.id) : 0;

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
        {formatWeight(grams)}
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
