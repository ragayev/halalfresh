import Link from "next/link";
import type { ProductView } from "@/server/catalog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { ProductImage } from "./product-image";
import { QuickAdd } from "./quick-add";
import { Badge } from "./ui";

export function ProductCard({ p, locale, d, priority }: { p: ProductView; locale: string; d: Dictionary; priority?: boolean }) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-line/60 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-16px_rgb(22_75_57/0.35)]"
      data-testid="product-card"
    >
      <Link href={`/${locale}/products/${p.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-sage after:absolute after:inset-0 after:bg-gradient-to-t after:from-black/10 after:to-transparent">
          {p.images[0] && (
            <ProductImage
              src={p.images[0].src}
              alt={p.images[0].alt}
              priority={priority}
              sizes="(min-width:1024px) 22vw, (min-width:640px) 33vw, 50vw"
              className="transition duration-500 group-hover:scale-105"
            />
          )}
          {!p.isAvailable && (
            <Badge tone="gray" className="absolute start-2 top-2 bg-white/95">
              {d.common.unavailable}
            </Badge>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <Link
          href={`/${locale}/products/${p.slug}`}
          className="line-clamp-2 min-h-[2.5rem] text-[15px] font-semibold leading-tight text-ink hover:underline"
        >
          {p.name}
        </Link>
        <p className="text-xs text-muted">
          {formatWeight(p.minGrams)}
          {p.stepGrams !== p.minGrams ? ` · ${p.stepGrams >= 1000 ? formatWeight(p.stepGrams) : `${p.stepGrams} g`} +` : ""}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {p.pricePerKgCents > 0 ? (
            <p className="text-lg font-bold leading-none text-ink">
              {formatMoney(p.pricePerKgCents, locale)}
              <span className="text-xs font-medium text-muted">{d.common.perKg}</span>
            </p>
          ) : (
            <p className="text-sm font-semibold leading-none text-muted">{d.product.priceSoon}</p>
          )}
          {p.isAvailable && (
            <QuickAdd
              product={{
                id: p.id,
                name: p.name,
                stepGrams: p.stepGrams,
                minGrams: p.minGrams,
                maxGrams: p.maxGrams,
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton aspect-[3/4] rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}
