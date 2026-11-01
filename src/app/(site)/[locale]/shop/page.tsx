import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { cookies } from "next/headers";
import { listCategories, listProducts, type Sort } from "@/server/catalog";
import { resolveDelivery } from "@/server/delivery-service";
import { isValidPostcode } from "@/domain/delivery";
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
      <header className="hero-mesh grain relative isolate overflow-hidden rounded-[2rem] p-6 text-white sm:p-12">
        {active?.imageUrl && (
          <Image
            src={active.imageUrl}
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className="-z-10 object-cover object-right opacity-60 [mask-image:linear-gradient(to_left,black,transparent_75%)]"
          />
        )}
        <div className="relative max-w-lg">
          <h1 className="font-display text-3xl font-normal sm:text-5xl">{active?.name ?? d.shop.title}</h1>
          <p className="mt-2 text-white/80">{d.home.heroText}</p>
        </div>
      </header>
      <nav aria-label={d.nav.categories} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[{ slug: "", name: d.shop.all }, ...cats].map((c) => {
          const on = (sp.category ?? "") === c.slug;
          return (
            <Link
              key={c.slug}
              href={`/${locale}/shop${c.slug ? `?category=${c.slug}` : ""}`}
              aria-current={on ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-5 py-2 text-sm font-semibold ring-1 transition",
                on ? "bg-forest text-white ring-forest" : "bg-white text-ink ring-line hover:bg-sage",
              )}
            >
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
