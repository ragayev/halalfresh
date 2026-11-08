import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BadgeCheck, ChevronLeft, Leaf } from "lucide-react";
import { isLocale, LOCALES } from "@/i18n/config";
import { getDictionary, t } from "@/i18n/get-dictionary";
import { getProductBySlug, listProducts } from "@/server/catalog";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { BundleContents } from "@/components/bundle-contents";
import { ProductImage } from "@/components/product-image";
import { ProductBuyBox } from "@/components/product-buy-box";
import { ProductCard } from "@/components/product-card";
import { Container } from "@/components/ui";
import { siteUrl } from "@/lib/env";
import { getSetting } from "@/server/app-settings";
import { Notice } from "@/components/ui";

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
  const [d, p, halalVerified] = await Promise.all([getDictionary(locale), getProductBySlug(slug, locale), getSetting("halalCertificateVerified")]);
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
        <ChevronLeft className="size-4" aria-hidden />
        {p.categoryName}
      </Link>
      <div className="grid gap-8 pb-28 lg:grid-cols-2 lg:gap-14 lg:pb-0">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className={`relative overflow-hidden rounded-[var(--radius-card)] ${p.bundle ? "aspect-square" : "aspect-[4/3]"} bg-sage ring-1 ring-line`}>
            {p.images[0] && <ProductImage src={p.images[0].src} alt={p.images[0].alt} priority sizes="(min-width:1024px) 50vw, 100vw" />}
            {p.slug.startsWith("kevser-") && p.images[0]?.src.startsWith("/images/products/") && (
              <span className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-semibold text-forest-dark">
                {locale === "tr" ? "Temsili görsel" : locale === "de" ? "Beispielbild" : "Illustrative photo"}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-forest">{p.categoryName}</p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight text-heading sm:text-[2rem]">{p.name}</h1>
            {p.supplierArticleNumbers.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {locale === "tr" ? "Ürün kodu" : locale === "de" ? "Artikel-Nr." : "Article no."}: {p.supplierArticleNumbers.join(", ")}
              </p>
            )}
            <p className="mt-2 text-[1.625rem] font-bold text-forest" data-testid="price">
              {p.pricePerKgCents > 0 ? (
                <>
                  {formatMoney(p.pricePerKgCents, locale)}
                  <span className="text-base font-medium text-muted">{p.bundle ? ` ${d.product.bundlePer}` : d.common.perKg}</span>
                </>
              ) : (
                <span className="text-xl text-muted">{d.product.priceSoon}</span>
              )}
            </p>
          </div>
          {p.bundle && (
            <p className="-mt-3 text-sm font-semibold text-forest-dark">
              {t(d.product.bundleWeight, { weight: formatWeight(p.bundle.totalGrams) })}
            </p>
          )}
          <p className="text-lg leading-relaxed text-muted">{p.description}</p>

          {p.bundle && (
            <section aria-labelledby="contents" className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
              <h2 id="contents" className="mb-1 font-display text-xl font-normal">
                {d.product.bundleContents}
              </h2>
              <BundleContents items={p.bundle.items} totalGrams={p.bundle.totalGrams} totalLabel={d.product.bundleTotal} />
            </section>
          )}

          <div className="space-y-3">
            {/* Origin is required product information; the halal certificate text only appears once the operator has verified it. */}
            <p className="text-sm">
              <span className="font-semibold">{locale === "tr" ? "Menşei" : "Herkunft"}:</span> {p.origin ?? (locale === "tr" ? "Bilgi yakında" : "Angabe folgt")}
            </p>
            {halalVerified && p.halalCertification && (
              <p className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-fresh-soft px-2 py-1 text-sm font-medium text-fresh">
                <BadgeCheck className="size-5" strokeWidth={1.75} aria-hidden />
                {locale === "tr" ? "Helal kaynağı" : "Halal-Nachweis"}: {p.halalCertification}
              </p>
            )}
            <p className="text-sm text-text-muted">{locale === "tr" ? "Satıcı: Kevser Fleischerei" : "Verkauf durch Kevser Fleischerei"}</p>
            {!p.bundle && (
              <Notice tone="info">{locale === "tr" ? "Gerçek ağırlığa göre ücretlendirilir (±%10)." : "Abrechnung nach tatsächlichem Gewicht (±10 %)."}</Notice>
            )}
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
          <h2 className="mb-5 font-display text-2xl font-normal">{p.categoryName}</h2>
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
