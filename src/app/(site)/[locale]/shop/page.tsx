import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SearchX } from "lucide-react";
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
    <Container className="space-y-5 py-6 sm:space-y-6 sm:py-10">
      <header className="max-w-2xl">
        <h1 className="text-balance font-display text-[2.125rem] font-normal leading-tight sm:text-[2.5rem]">{active?.name ?? d.shop.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted sm:text-base">{d.home.heroText}</p>
      </header>
      <nav aria-label={d.nav.categories} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {[{ slug: "", name: d.shop.all }, ...[...cats].sort((x, y) => Number(y.slug === BUNDLE_CATEGORY) - Number(x.slug === BUNDLE_CATEGORY))].map((c) => {
          const on = (sp.category ?? "") === c.slug;
          const Icon = c.slug ? (CATEGORY_ICONS[c.slug] ?? Cow) : SquaresFour;
          return (
            <Link
              key={c.slug}
              href={`/${locale}/shop${c.slug ? `?category=${c.slug}` : ""}`}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-[var(--radius-button)] px-4 text-sm font-semibold transition-colors",
                on ? "bg-forest text-white" : "bg-white text-heading ring-1 ring-line hover:bg-sage-soft hover:ring-forest/30",
              )}
            >
              <Icon weight={on ? "fill" : "duotone"} className={cn("size-5 shrink-0", on ? "text-white" : "text-forest")} aria-hidden />
              {c.name}
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
