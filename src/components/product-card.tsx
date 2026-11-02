import Link from "next/link";
import type { ProductView } from "@/server/catalog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { ProductImage } from "./product-image";
import { QuickAdd } from "./quick-add";
import { Badge } from "./ui";
import { PartnerTag } from "./partner-badge";
import { cn } from "@/lib/utils";

export function ProductCard({ p, locale, d, priority }: { p: ProductView; locale: string; d: Dictionary; priority?: boolean }) {
  const href = `/${locale}/products/${p.slug}`;
  const unit = p.bundle ? d.common.perPackage : d.common.perKg;
  return (
    <article
      className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] bg-white shadow-card ring-1 ring-line transition-shadow duration-200 hover:shadow-[0_10px_28px_-14px_rgb(16_45_34/0.3)]"
      data-testid="product-card"
    >
      <Link href={href} className="block" tabIndex={-1} aria-hidden>
        <div className="relative aspect-[4/3] overflow-hidden bg-sage-soft">
          {p.images[0] && (
            <ProductImage
              src={p.images[0].src}
              alt=""
              priority={priority}
              sizes="(min-width:1280px) 22vw, (min-width:768px) 33vw, 50vw"
              className={cn("transition-transform duration-500 group-hover:scale-[1.03]", !p.isAvailable && "opacity-60 grayscale-[40%]")}
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
        <Link href={href} className="line-clamp-2 min-h-[2.75rem] text-[15px] font-semibold leading-snug text-heading hover:underline sm:text-[17px]">
          {p.name}
        </Link>
        <p className="text-sm text-muted">
          {p.bundle ? (
            formatWeight(p.bundle.totalGrams)
          ) : (
            <>
              {formatWeight(p.minGrams)}
              {p.stepGrams !== p.minGrams ? ` · ${p.stepGrams >= 1000 ? formatWeight(p.stepGrams) : `${p.stepGrams} g`} +` : ""}
            </>
          )}
        </p>
        <PartnerTag className="pt-1" />
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          {p.pricePerKgCents > 0 ? (
            <p className="leading-none">
              <span className={cn("text-lg font-bold sm:text-xl", p.isAvailable ? "text-forest" : "text-muted")}>
                {formatMoney(p.pricePerKgCents, locale)}
              </span>
              <span className="ms-0.5 text-xs font-medium text-muted">{unit}</span>
            </p>
          ) : (
            <p className="text-sm font-semibold leading-none text-muted">{d.product.priceSoon}</p>
          )}
          {p.isAvailable ? (
            <QuickAdd
              product={{
                id: p.id,
                name: p.name,
                stepGrams: p.stepGrams,
                minGrams: p.minGrams,
                maxGrams: p.maxGrams,
                bundle: !!p.bundle,
              }}
            />
          ) : (
            <span className="rounded-[var(--radius-button)] bg-sage-soft px-3 py-2 text-xs font-semibold text-muted">{d.common.unavailable}</span>
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
