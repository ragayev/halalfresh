import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarClock, CreditCard, ShieldCheck, Leaf, Snowflake, Star, Store, Truck } from "lucide-react";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary, t } from "@/i18n/get-dictionary";
import { cookies } from "next/headers";
import { listProducts } from "@/server/catalog";
import { BUNDLE_CATEGORY } from "@/domain/bundles";
import { resolveDelivery } from "@/server/delivery-service";
import { isValidPostcode } from "@/domain/delivery";
import { BundleCard } from "@/components/bundle-card";
import { BestSellerCard } from "@/components/best-seller-card";
import { PostcodeChecker } from "@/components/postcode-checker";
import { Container } from "@/components/ui";
import { StandardsPostcode } from "@/components/standards-postcode";

// Google share link of the shop (reviews, hours, directions).
const PARTNER_URL = "https://share.google/VmenJVKEgN1HV3exG";
// TODO confirm with Kevser: Google rating and review count shown on the store card.
const PARTNER_RATING = "4,6";
const PARTNER_REVIEWS = 68;

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = await getDictionary(locale);
  const pc = (await cookies()).get("hf_postcode")?.value ?? "";
  const preorderOnly = isValidPostcode(pc) && (await resolveDelivery(pc)).check.mode === "PREORDER_ONLY";
  const featured = await listProducts(locale, { featured: true, availableOnly: true, limit: 8, preorderOnly });

  const bundles = (await listProducts(locale, { category: BUNDLE_CATEGORY, availableOnly: true, preorderOnly })).filter((p) => p.bundle);

  const heroTrust = [
    [Store, d.home.hb1, d.home.hb1t],
    [ShieldCheck, d.home.hb3, d.home.hb3t],
    [Truck, d.home.hb4, d.home.hb4t],
  ] as const;

  return (
    <>
      <section className="relative isolate overflow-hidden bg-cream">
        <div className="relative aspect-[16/10] lg:absolute lg:inset-y-0 lg:end-0 lg:aspect-auto lg:w-[70%]">
          <Image
            src="/hero-spread.jpg"
            alt=""
            fill
            priority
            sizes="(min-width:1024px) 72vw, 100vw"
            className="object-cover object-[70%_50%]"
          />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-cream via-cream/25 via-35% to-transparent lg:block" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-cream to-transparent lg:hidden" />
        </div>
        <Container className="relative pb-8 pt-6 lg:pb-14 lg:pt-20">
          <div className="rise max-w-xl space-y-6 lg:max-w-[46rem]">
            <h1 className="text-balance font-display text-[2.6rem] font-normal leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]">
              {d.home.heroTitle}
            </h1>
            <Link
              href={`/${locale}/shop`}
              className="inline-flex h-14 items-center gap-2 rounded-md bg-forest px-7 text-base font-semibold text-white shadow-lg shadow-forest/20 transition hover:-translate-y-0.5 hover:bg-forest-dark"
            >
              {d.home.shopNow}
              <ArrowRight className="size-5" aria-hidden />
            </Link>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-4 rounded-2xl bg-white/80 p-4 shadow-card ring-1 ring-line/60 backdrop-blur lg:mt-6 lg:max-w-[42rem] lg:grid-cols-3">
            {heroTrust.map(([Icon, title, text]) => (
              <li key={title} className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sage text-forest">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 text-sm leading-tight">
                  <span className="block font-semibold text-ink">{title}</span>
                  <span className="block text-xs text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="feat" className="bg-white/60 py-10 sm:py-12">
        <div className="mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 id="feat" className="font-display text-3xl font-normal sm:text-4xl">
                {d.home.bestSellers}
              </h2>
              <p className="mt-1 text-muted">{d.home.bestSellersSub}</p>
            </div>
            <Link
              href={`/${locale}/shop`}
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-forest-dark underline underline-offset-4"
            >
              {d.home.viewAllProducts}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4 2xl:grid-cols-8">
            {featured.map((p) => (
              <BestSellerCard key={p.id} p={p} locale={locale} d={d} />
            ))}
          </div>
        </div>
      </section>

      {bundles.length > 0 && (
        <section aria-labelledby="bundles" className="py-12 sm:py-16">
          <Container>
            <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
              <div>
                <h2 id="bundles" className="font-display text-3xl font-normal sm:text-4xl">
                  {d.home.bundlesTitle}
                </h2>
                <p className="mt-1 max-w-2xl text-muted">{d.home.bundlesSub}</p>
              </div>
              <Link
                href={`/${locale}/shop?category=${BUNDLE_CATEGORY}`}
                className="hidden shrink-0 items-center gap-1.5 text-sm font-medium text-forest-dark underline underline-offset-4 sm:inline-flex"
              >
                {d.common.viewAll}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
              {bundles.map((p) => (
                <BundleCard key={p.id} p={p} locale={locale} d={d} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <Container className="pt-12">
        <div className="rise [animation-delay:.15s]">
          <PostcodeChecker />
        </div>
      </Container>

      <Container className="space-y-20 pt-16 sm:pt-24">
        <section id="how" aria-labelledby="how-h" className="scroll-mt-24">
          <h2 id="how-h" className="mb-8 font-display text-3xl font-normal sm:text-4xl">
            {d.home.howTitle}
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3 sm:gap-6">
            {(
              [
                ["step1Title", "step1Text", Store],
                ["step2Title", "step2Text", CreditCard],
                ["step3Title", "step3Text", Truck],
              ] as const
            ).map(([a, b, Icon], i) => (
              <li
                key={a}
                className="group relative overflow-hidden rounded-3xl bg-white p-6 shadow-card ring-1 ring-line/60 transition hover:-translate-y-1 hover:shadow-xl"
              >
                <span className="absolute -end-2 -top-6 font-display text-[7rem] font-normal leading-none text-sage transition group-hover:text-emerald-100">
                  {i + 1}
                </span>
                <span className="relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-forest to-emerald-700 text-white shadow-lg shadow-forest/30">
                  <Icon className="size-7" aria-hidden />
                </span>
                <p className="relative mt-5 text-xl font-semibold">{d.home[a]}</p>
                <p className="relative mt-1.5 text-muted">{d.home[b]}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* TODO confirm with Kevser: rating/review count, halal certificate details, same-day + cool-box claims. */}
        <section
          id="standards"
          aria-labelledby="trust"
          className="scroll-mt-24 overflow-hidden rounded-[2rem] bg-forest-dark p-6 text-white sm:p-10 lg:p-12"
        >
          <div className="lg:flex lg:items-end lg:justify-between lg:gap-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-white/70">{d.home.trustTitle}</p>
              <h2 id="trust" className="mt-3 max-w-xl font-display text-4xl font-normal leading-tight sm:text-5xl">
                {d.home.stdTitle}
              </h2>
            </div>
            <p className="mt-4 max-w-md text-lg text-white/85 lg:mt-0 lg:text-base">{d.home.stdText}</p>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
            <div className="flex min-h-72 flex-col justify-between rounded-3xl bg-white/10 ring-1 ring-white/15 p-4 sm:p-5 lg:min-h-[28rem]">
              <div className="grid flex-1 place-items-center gap-3 py-6 text-center">
                <Image src="/halal-logo.svg" alt="Halal" width={160} height={160} className="size-28 sm:size-36" />
                <span className="inline-flex items-center gap-2 font-display text-2xl font-normal">
                  <Leaf className="size-6 text-emerald-300" aria-hidden />
                  {d.brand.name}
                </span>
              </div>
              <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-white p-4 text-ink sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <p className="text-lg font-semibold">Kevser Fleischerei</p>
                  <p className="text-muted">{d.home.stdAddress}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm">
                    <Star className="size-4 fill-amber-600 text-amber-600" aria-hidden />
                    {t(d.home.stdReviews, { rating: PARTNER_RATING, count: PARTNER_REVIEWS })}
                  </p>
                </div>
                <a
                  href={PARTNER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-full bg-forest-dark px-6 font-semibold text-white hover:bg-forest"
                >
                  {d.home.stdStoreCta}
                </a>
              </div>
            </div>
            <div className="space-y-4">
              {(
                [
                  ["stdCert", "stdCertText", ShieldCheck],
                  ["stdDate", "stdDateText", CalendarClock],
                  ["stdCold", "stdColdText", Snowflake],
                ] as const
              ).map(([a, b, Icon]) => (
                <div key={a} className="flex items-start gap-4 rounded-3xl bg-white p-5 text-ink">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-sage text-forest">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <div>
                    <p className="text-lg font-semibold">{d.home[a]}</p>
                    <p className="mt-1 text-muted">{d.home[b]}</p>
                  </div>
                </div>
              ))}
              <StandardsPostcode />
            </div>
          </div>
          <p className="mt-6 text-sm text-white/75">{d.home.stdFoot}</p>
        </section>
      </Container>
    </>
  );
}
