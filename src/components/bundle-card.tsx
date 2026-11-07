import Link from "next/link";
import type { ProductView } from "@/server/catalog";
import type { Dictionary } from "@/i18n/get-dictionary";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { ProductImage } from "./product-image";
import { AddToCart } from "./add-to-cart";
import { PartnerTag } from "./partner-badge";

/** Fleischpaket card: large image, name, total weight, price, short description, add-to-cart. Contents live on the detail page. */
export function BundleCard({ p, locale, d, priority }: { p: ProductView; locale: string; d: Dictionary; priority?: boolean }) {
  const href = `/${locale}/products/${p.slug}`;
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-line/60 transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-16px_rgb(22_75_57/0.35)]"
      data-testid="bundle-card"
    >
      <Link href={href} className="block" aria-label={p.name}>
        <div className="relative aspect-square overflow-hidden bg-sage">
          {p.images[0] && (
            <ProductImage
              src={p.images[0].src}
              alt={p.images[0].alt}
              priority={priority}
              sizes="(min-width:1024px) 24vw, (min-width:640px) 48vw, 92vw"
              className="transition duration-500 group-hover:scale-105"
            />
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href} className="text-lg font-semibold leading-snug text-heading hover:underline">
              {p.name}
            </Link>
            {p.bundle && <p className="mt-0.5 text-sm text-muted">{formatWeight(p.bundle.totalGrams)}</p>}
          </div>
          <p className="shrink-0 text-xl font-bold leading-none text-forest">{formatMoney(p.pricePerKgCents, locale)}</p>
        </div>
        <p className="line-clamp-3 text-sm text-muted">{p.description}</p>
        <PartnerTag />
        <div className="mt-auto pt-3">
          {p.isAvailable ? (
            <AddToCart
              product={{ id: p.id, name: p.name, stepGrams: p.stepGrams, minGrams: p.minGrams, maxGrams: p.maxGrams, bundle: true, bundleSlug: p.slug }}
            />
          ) : (
            <p className="grid h-10 place-items-center rounded-[var(--radius-button)] bg-sage-soft text-sm font-medium text-muted">{d.common.unavailable}</p>
          )}
        </div>
      </div>
    </article>
  );
}
