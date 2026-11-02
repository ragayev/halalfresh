import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, SearchX, ShieldCheck, Snowflake, Truck } from "lucide-react";
import { Barn, Bird, Cow, Fire, Heart, Knife, Package, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { cookies } from "next/headers";
import { listCategories, listProducts, type Sort } from "@/server/catalog";
import { resolveDelivery } from "@/server/delivery-service";
import { isValidPostcode } from "@/domain/delivery";
import { BUNDLE_CATEGORY } from "@/domain/bundles";
import { ProductCard } from "@/components/product-card";
import { ShopControls } from "@/components/shop-controls";
import { buttonClasses, Container } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const { category } = await searchParams;
  if (!isLocale(locale)) return {};
  const [d, cats] = await Promise.all([getDictionary(locale), listCategories(locale)]);
  const cat = cats.find((c) => c.slug === category);
  return {
    title: cat ? `${cat.name}` : d.shop.title,
    alternates: {
      canonical: `/${locale}/shop${cat ? `?category=${cat.slug}` : ""}`,
    },
  };
}

const CATEGORY_ICONS: Record<string, PhosphorIcon> = {
  [BUNDLE_CATEGORY]: Package,
  dana: Cow,
  kuzu: Barn,
  tavuk: Bird,
  mangal: Fire,
  sarkuteri: Knife,
  sakatat: Heart,
};

const SORTS = new Set(["popular", "price-asc", "price-desc", "name"]);

export default async function Shop({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const d = await getDictionary(locale);
  // Preorder-only areas (and the unsupported-postcode offer) only see preorder-eligible products.
  const pc = (await cookies()).get("hf_postcode")?.value ?? "";
  const mode = isValidPostcode(pc) ? (await resolveDelivery(pc)).check.mode : null;
  const preorderOnly = mode === "PREORDER_ONLY" || sp.preorder === "1";
  const sort = (SORTS.has(sp.sort ?? "") ? sp.sort : "popular") as Sort;
  const [cats, products] = await Promise.all([
    listCategories(locale),
    listProducts(locale, {
      category: sp.category,
      q: sp.q?.slice(0, 80),
      sort,
      availableOnly: sp.available === "1",
      preorderOnly,
    }),
  ]);
  const active = cats.find((c) => c.slug === sp.category);

  return (
    <Container className="space-y-6 py-6 sm:py-10">
      <header className="relative isolate overflow-hidden rounded-[2rem] bg-[#0d3427] text-white shadow-card">
        <Image
          src="/hero-spread.jpg"
          alt=""
          fill
          priority
          sizes="(min-width:1280px) 1200px, 100vw"
          className="-z-10 object-cover object-[75%_50%] sm:object-right"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0d3427] from-30% via-[#0d3427]/70 via-55% to-transparent max-sm:from-[#0d3427]/90 max-sm:via-[#0d3427]/80 max-sm:to-[#0d3427]/60" />
        <div className="max-w-xl p-6 sm:p-10 lg:p-12">
          <span className="inline-block rounded-2xl bg-white px-4 py-2 shadow-card">
            <Image src="/logo-crest.png" alt={d.brand.name} width={720} height={240} priority className="h-10 w-auto sm:h-12" />
          </span>
          <h1 className="mt-3 font-display text-4xl font-normal sm:text-6xl">{active?.name ?? d.shop.title}</h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/85 sm:text-base">{d.home.heroText}</p>
          <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold">
            {[
              [ShieldCheck, d.shop.trustHalal],
              [Snowflake, d.shop.trustCold],
              [Truck, d.shop.trustFast],
            ].map(([Icon, label], i) => {
              const I = Icon as typeof Truck;
              return (
                <li key={i} className="flex items-center gap-2 sm:[&:not(:first-child)]:border-s sm:[&:not(:first-child)]:border-white/25 sm:[&:not(:first-child)]:ps-6">
                  <I className="size-6 text-[#e7c873]" aria-hidden />
                  {label as string}
                </li>
              );
            })}
          </ul>
        </div>
      </header>
      <nav aria-label={d.nav.categories} className="-mx-4 flex gap-2.5 overflow-x-auto px-4 py-2 sm:-mx-2 sm:px-2">
        {[{ slug: "", name: d.shop.all, imageUrl: null as string | null }, ...[...cats].sort((x, y) => Number(y.slug === BUNDLE_CATEGORY) - Number(x.slug === BUNDLE_CATEGORY))].map((c) => {
          const on = (sp.category ?? "") === c.slug;
          const bundle = c.slug === BUNDLE_CATEGORY;
          const Icon = c.slug ? (CATEGORY_ICONS[c.slug] ?? Cow) : SquaresFour;
          return (
            <Link
              key={c.slug}
              href={`/${locale}/shop${c.slug ? `?category=${c.slug}` : ""}`}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group relative flex shrink-0 flex-col overflow-hidden rounded-xl bg-white p-2.5 shadow-card ring-1 transition hover:-translate-y-0.5",
                bundle ? "w-44 sm:w-52" : "w-28 sm:w-36",
                on ? "bg-sage-soft ring-2 ring-forest shadow-none" : bundle ? "bg-gradient-to-br from-[#fff7e0] to-white ring-[#e7c873]" : "ring-line/70 hover:ring-forest/40",
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-[13px] font-bold", on || bundle ? "text-forest" : "text-ink")}>
                <Icon weight="duotone" className="size-5 shrink-0 text-forest" aria-hidden />
                {c.name}
              </span>
              {!c.slug ? (
                <span className="mt-2 grid h-11 grid-cols-4 gap-1 sm:h-14">
                  {cats
                    .filter((x) => x.imageUrl)
                    .slice(0, 4)
                    .map((x) => (
                      <span key={x.slug} className="relative overflow-hidden rounded-lg">
                        <Image src={x.imageUrl!} alt="" fill sizes="48px" className="object-cover" />
                      </span>
                    ))}
                </span>
              ) : c.imageUrl && (
                <span className="relative mt-2 block h-11 sm:h-14">
                  <Image src={c.imageUrl} alt="" fill sizes="256px" className="rounded-xl object-cover" />
                </span>
              )}
              {bundle && (
                <span className="absolute bottom-2 end-2 grid size-6 place-items-center rounded-full bg-white text-forest shadow ring-1 ring-line">
                  <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <ShopControls count={products.length} />
      {products.length ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p, i) => (
            <ProductCard key={p.id} p={p} locale={locale} d={d} priority={i < 4} />
          ))}
        </div>
      ) : (
        <div className="grid place-items-center rounded-[var(--radius-card)] bg-white px-6 py-16 text-center ring-1 ring-line">
          <SearchX className="size-10 text-muted" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">{d.shop.emptyTitle}</h2>
          <p className="mt-1 text-muted">{d.shop.emptyText}</p>
          <Link href={`/${locale}/shop`} className={buttonClasses({ variant: "secondary" }) + " mt-5"}>
            {d.shop.clear}
          </Link>
        </div>
      )}
    </Container>
  );
}
