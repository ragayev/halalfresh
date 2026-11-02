"use client";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { formatQuantity } from "@/domain/bundles";

export function QuickAdd({
  product,
}: {
  product: {
    id: string;
    name: string;
    stepGrams: number;
    minGrams: number;
    maxGrams: number;
    bundle?: boolean;
  };
}) {
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
        className="grid size-11 place-items-center rounded-[var(--radius-button)] bg-forest text-white shadow-sm transition-colors hover:bg-forest-dark active:translate-y-px"
      >
        <Plus className="size-5" aria-hidden />
      </button>
    );
  }
  const dec = () => change(product.id, -product.stepGrams, product.minGrams, product.maxGrams);
  return (
    <div className="inline-flex items-center rounded-[var(--radius-button)] bg-sage p-0.5" role="group" aria-label={product.name}>
      <button
        type="button"
        onClick={dec}
        aria-label={d.common.decrease}
        className="grid size-10 place-items-center rounded-[10px] text-forest hover:bg-white"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="min-w-[2.5rem] text-center text-xs font-bold text-forest-dark" aria-live="polite">
        {formatQuantity(grams, !!product.bundle)}
      </span>
      <button
        type="button"
        onClick={() => add(product)}
        disabled={grams + product.stepGrams > product.maxGrams}
        aria-label={d.common.increase}
        className="grid size-10 place-items-center rounded-[10px] bg-forest text-white hover:bg-forest-dark disabled:opacity-40"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
