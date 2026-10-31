import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, CalendarClock, CreditCard, ShieldCheck, Store, Truck, Leaf } from "lucide-react";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { listProducts } from "@/server/catalog";
import { BestSellerCard } from "@/components/best-seller-card";
import { PostcodeChecker } from "@/components/postcode-checker";
import { Container } from "@/components/ui";

const PARTNER_URL = "http://kevser-fleischerei.de/";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = await getDictionary(locale);
  const featured = await listProducts(locale, { featured: true, availableOnly: true, limit: 8 });

  const heroTrust = [
    [Store, d.home.hb1, d.home.hb1t],
    [ShieldCheck, d.home.hb3, d.home.hb3t],
    [Truck, d.home.hb4, d.home.hb4t],
  ] as const;
  const strip = [
    [Truck, d.home.s1, d.home.s1t],
    [ShieldCheck, d.home.s3, d.home.s3t],
    [Leaf, d.home.s4, d.home.s4t],
  ] as const;

  return (
    <>
      <section className="relative isolate overflow-hidden bg-cream">
        <div className="relative aspect-[16/10] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[70%]">
          <Image src="/hero.jpg" alt="" fill priority sizes="(min-width:1024px) 72vw, 100vw" className="object-cover object-[70%_50%]" />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-cream via-cream/25 via-35% to-transparent lg:block" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-cream to-transparent lg:hidden" />
        </div>
        <Container className="relative pb-8 pt-2 lg:pb-10 lg:pt-14">
          <div className="rise max-w-xl space-y-5 lg:min-h-[330px] lg:max-w-[46rem]">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-forest">{d.home.heroEyebrow}</p>
            <h1 className="text-balance font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]">
              {d.home.heroTitle}
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-muted">{d.home.heroText}</p>
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
              <h2 id="feat" className="font-display text-3xl font-semibold sm:text-4xl">
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

      <section aria-label={d.home.trustTitle} className="border-y border-line/60 bg-sage">
        <ul className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:gap-0 lg:px-8">
          {strip.map(([Icon, title, text]) => (
            <li key={title} className="flex items-center gap-4 lg:justify-center lg:border-r lg:border-forest/15 lg:last:border-r-0">
              <Icon className="size-9 shrink-0 text-forest" strokeWidth={1.5} aria-hidden />
              <span>
                <span className="block font-display text-lg font-semibold leading-tight text-ink">{title}</span>
                <span className="block text-sm text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Container className="pt-12">
        <div className="rise [animation-delay:.15s]">
          <PostcodeChecker />
        </div>
      </Container>

      <Container className="space-y-20 pt-16 sm:pt-24">
        <section id="how" aria-labelledby="how-h" className="scroll-mt-24">
          <h2 id="how-h" className="mb-8 font-display text-3xl font-semibold sm:text-4xl">
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
                <span className="absolute -right-2 -top-6 font-display text-[7rem] font-semibold leading-none text-sage transition group-hover:text-emerald-100">
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

        <section
          id="standards"
          aria-labelledby="trust"
          className="scroll-mt-24 overflow-hidden rounded-[2rem] bg-forest-dark p-6 text-white sm:p-10 lg:grid lg:grid-cols-[1fr_1.5fr] lg:gap-10"
        >
          <div className="mb-6 lg:mb-0">
            <h2 id="trust" className="font-display text-3xl font-semibold sm:text-4xl">
              {d.home.trustTitle}
            </h2>
            <p className="mt-3 text-sm text-white/65">{d.home.trustNote}</p>
            <div className="mt-6 rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
              <p className="font-semibold">{d.home.areaTitle}</p>
              <p className="mt-1 text-sm text-white/75">{d.home.areaText}</p>
            </div>
            <div className="mt-4 rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
              <p className="font-semibold">{d.home.partnerTitle}</p>
              <p className="mt-1 text-sm text-white/75">{d.home.partnerText}</p>
              <a
                href={PARTNER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white underline underline-offset-4"
              >
                {d.home.partnerCta}
                <ArrowUpRight className="size-4" aria-hidden />
              </a>
            </div>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["trust1Title", "trust1Text", Leaf],
                ["trust2Title", "trust2Text", CalendarClock],
                ["trust3Title", "trust3Text", ShieldCheck],
              ] as const
            ).map(([a, b, Icon]) => (
              <li key={a} className="rounded-2xl bg-white p-5 text-ink">
                <span className="grid size-11 place-items-center rounded-xl bg-sage text-forest">
                  <Icon className="size-5" aria-hidden />
                </span>
                <p className="mt-4 font-semibold">{d.home[a]}</p>
                <p className="mt-1.5 text-sm text-muted">{d.home[b]}</p>
              </li>
            ))}
          </ul>
        </section>
      </Container>
    </>
  );
}
