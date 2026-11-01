import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BadgeCheck, ChevronLeft, Leaf, Info } from "lucide-react";
import { isLocale, LOCALES } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getProductBySlug, listProducts } from "@/server/catalog";
import { formatMoney } from "@/domain/money";
import { ProductImage } from "@/components/product-image";
import { ProductBuyBox } from "@/components/product-buy-box";
import { ProductCard } from "@/components/product-card";
import { Container } from "@/components/ui";
import { siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await getProductBySlug(slug, locale);
  if (!p) return {};
  return {
    title: p.name,
    description: p.description.slice(0, 160),
    alternates: {
      canonical: `/${locale}/products/${slug}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/products/${slug}`])),
    },
    openGraph: {
      title: p.name,
      description: p.description.slice(0, 160),
      images: p.images[0] ? [{ url: p.images[0].src }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const [d, p] = await Promise.all([getDictionary(locale), getProductBySlug(slug, locale)]);
  if (!p) notFound();
  const related = (
    await listProducts(locale, {
      category: p.categorySlug,
      availableOnly: true,
      limit: 5,
    })
  )
    .filter((x) => x.id !== p.id)
    .slice(0, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    image: p.images.map((i) => new URL(i.src, siteUrl()).toString()),
    category: p.categoryName,
    offers:
      p.pricePerKgCents > 0
        ? {
            "@type": "Offer",
            priceCurrency: "EUR",
            price: (p.pricePerKgCents / 100).toFixed(2),
            availability: p.isAvailable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: `${siteUrl()}/${locale}/products/${p.slug}`,
          }
        : undefined,
  };

  return (
    <Container className="py-4 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Link
        href={`/${locale}/shop?category=${p.categorySlug}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        {p.categoryName}
      </Link>
      <div className="grid gap-8 pb-28 lg:grid-cols-2 lg:gap-14 lg:pb-0">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] bg-sage ring-1 ring-line">
            {p.images[0] && <ProductImage src={p.images[0].src} alt={p.images[0].alt} priority sizes="(min-width:1024px) 50vw, 100vw" />}
          </div>
        </div>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-forest">{p.categoryName}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold leading-tight sm:text-4xl">{p.name}</h1>
            <p className="mt-2 font-display text-3xl font-semibold text-forest" data-testid="price">
              {p.pricePerKgCents > 0 ? (
                <>
                  {formatMoney(p.pricePerKgCents, locale)}
                  <span className="text-lg">{d.common.perKg}</span>
                </>
              ) : (
                <span className="text-xl text-muted">{d.product.priceSoon}</span>
              )}
            </p>
          </div>
          <p className="text-lg leading-relaxed text-muted">{p.description}</p>

          <div className="rounded-2xl bg-sage p-4">
            <div className="flex gap-3">
              {p.halalCertification ? (
                <BadgeCheck className="mt-0.5 size-6 shrink-0 text-forest" aria-hidden />
              ) : (
                <Info className="mt-0.5 size-6 shrink-0 text-forest" aria-hidden />
              )}
              <div>
                <p className="font-semibold text-forest-dark">{d.product.halal}</p>
                <p className="text-sm text-forest-dark/80">{p.halalCertification ?? d.product.halalUnverified}</p>
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
              <dt className="flex items-center gap-1.5 text-muted">
                <Leaf className="size-4" aria-hidden />
                {d.product.freshNote}
              </dt>
            </div>
            {p.origin && (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
                <dt className="text-muted">{d.product.origin}</dt>
                <dd className="mt-0.5 font-semibold">{p.origin}</dd>
              </div>
            )}
          </dl>

          <ProductBuyBox p={p} />

          <section aria-labelledby="allergens" className="rounded-2xl bg-white p-4 text-sm ring-1 ring-line">
            <h2 id="allergens" className="font-semibold">
              {d.product.allergens}
            </h2>
            <p className="mt-1 text-muted">{p.allergenInfo ?? d.product.allergenNone}</p>
          </section>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-6 hidden lg:block">
          <h2 className="mb-5 font-display text-2xl font-semibold">{p.categoryName}</h2>
          <div className="grid grid-cols-4 gap-5">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} locale={locale} d={d} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
