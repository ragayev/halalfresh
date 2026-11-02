import { formatWeight } from "@/domain/pricing";
import { cn } from "@/lib/utils";

/** Breakdown of a Fleischpaket: component, weight, and the total. `packages` scales the amounts (cart/order lines). */
export function BundleContents({
  items,
  totalGrams,
  packages = 1,
  totalLabel,
  className,
}: {
  items: { name: string; grams: number }[];
  totalGrams: number;
  packages?: number;
  totalLabel: string;
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-line/70 text-sm", className)} data-testid="bundle-contents">
      {items.map((i) => (
        <div key={i.name} className="flex items-baseline justify-between gap-4 py-2">
          <dt>{i.name}</dt>
          <dd className="shrink-0 font-semibold tabular-nums">{formatWeight(i.grams * packages)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 pt-2.5 font-semibold text-forest-dark">
        <dt>{totalLabel}</dt>
        <dd className="tabular-nums">{formatWeight(totalGrams * packages)}</dd>
      </div>
    </dl>
  );
}
