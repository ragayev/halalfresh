import Link from "next/link";
import type { ProductView } from "@/server/catalog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { ProductImage } from "./product-image";
import { AddToCart } from "./add-to-cart";
import { PartnerTag } from "./partner-badge";

export function BestSellerCard({ p, locale, d }: { p: ProductView; locale: string; d: Dictionary }) {
  return (
    <article
      className="flex w-[11.5rem] shrink-0 snap-start flex-col rounded-xl bg-white p-1.5 shadow-card ring-1 ring-line/60 sm:w-auto"
      data-testid="product-card"
    >
      <Link href={`/${locale}/products/${p.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-sage">
          {p.images[0] && <ProductImage src={p.images[0].src} alt={p.images[0].alt} sizes="(min-width:1024px) 12vw, 190px" />}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-2 pb-2 pt-3">
        <Link href={`/${locale}/products/${p.slug}`} className="line-clamp-1 text-[15px] font-semibold text-ink hover:underline">
          {p.name}
        </Link>
        <p className="text-xs text-muted">
          {d.home.perPack} {formatWeight(p.minGrams)}
        </p>
        <PartnerTag />
        <p className="pb-2 pt-1 text-xl font-bold leading-none text-ink">
          {formatMoney(p.pricePerKgCents, locale)}
          <span className="text-xs font-medium text-muted">{d.common.perKg}</span>
        </p>
        <div className="mt-auto">
          {p.isAvailable ? (
            <AddToCart product={{ id: p.id, name: p.name, stepGrams: p.stepGrams, minGrams: p.minGrams, maxGrams: p.maxGrams }} />
          ) : (
            <p className="grid h-10 place-items-center rounded-md bg-sage-soft text-xs text-muted">{d.common.unavailable}</p>
          )}
        </div>
      </div>
    </article>
  );
}
