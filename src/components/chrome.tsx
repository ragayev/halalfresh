"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Home, LayoutGrid, Search, ShoppingBag, Globe, Leaf, Check } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { useCart } from "./cart-store";
import { Container } from "./ui";
import { PostcodeChip } from "./delivery-ui";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  const { locale, d } = useI18n();
  return (
    <Link href={`/${locale}`} className={cn("inline-flex items-center gap-2", className)} aria-label={d.brand.name}>
      <Leaf className="size-8 fill-forest/15 text-forest" strokeWidth={2.2} aria-hidden />
      <span className="font-display text-[1.65rem] font-semibold tracking-tight text-forest-dark">{d.brand.name}</span>
      <Image src="/halal-logo.svg" alt="Halal" width={44} height={44} className="size-10 sm:size-11" />
    </Link>
  );
}

function CartButton() {
  const { locale, d } = useI18n();
  const { count, ready } = useCart();
  return (
    <Link
      href={`/${locale}/cart`}
      aria-label={`${d.nav.cart}${ready && count ? ` (${count})` : ""}`}
      className="relative grid size-11 place-items-center rounded-full text-ink transition hover:bg-sage"
    >
      <ShoppingBag className="size-6" aria-hidden />
      <span
        key={count}
        className="pop absolute end-0 top-0.5 grid min-w-5 place-items-center rounded-full bg-forest px-1 text-[11px] font-bold leading-5 text-white"
        data-testid="cart-count"
      >
        {ready ? count : 0}
      </span>
    </Link>
  );
}

function LanguageSwitcher() {
  const { locale, d } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const rest = pathname.replace(/^\/(en|de|tr|ar)/, "") || "";
  return (
    <details className="group relative">
      <summary
        aria-label={d.nav.language}
        className="grid h-11 cursor-pointer list-none place-items-center rounded-full px-3 text-sm font-semibold uppercase hover:bg-sage [&::-webkit-details-marker]:hidden"
      >
        <span className="inline-flex items-center gap-1.5">
          <Globe className="size-4" aria-hidden />
          {locale}
        </span>
      </summary>
      <ul className="absolute end-0 z-50 mt-2 w-40 overflow-hidden rounded-2xl bg-white py-1 shadow-card ring-1 ring-line">
        {LOCALES.map((l) => (
          <li key={l}>
            <Link
              href={`/${l}${rest}${search ? `?${search}` : ""}`}
              hrefLang={l}
              lang={l}
              className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-sage-soft"
            >
              {LOCALE_LABELS[l]} {l === locale && <Check className="size-4 text-forest" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Header() {
  const { locale, d } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-white/95 backdrop-blur">
      <Container className="flex h-[72px] items-center gap-2 sm:gap-4 lg:gap-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          <Link href={`/${locale}/shop`} className="rounded-full px-4 py-2 text-[15px] font-medium hover:bg-sage-soft">
            {d.nav.shop}
          </Link>
          <Link href={`/${locale}#standards`} className="rounded-full px-4 py-2 text-[15px] font-medium hover:bg-sage-soft">
            {d.nav.standards}
          </Link>
          <Link href={`/${locale}#how`} className="rounded-full px-4 py-2 text-[15px] font-medium hover:bg-sage-soft">
            {d.nav.delivery}
          </Link>
        </nav>
        <form action={`/${locale}/shop`} role="search" className="relative ms-auto hidden max-w-md flex-1 md:block">
          <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-ink" aria-hidden />
          <input
            type="search"
            name="q"
            maxLength={80}
            aria-label={d.nav.searchLabel}
            placeholder={d.nav.searchPlaceholder}
            className="h-12 w-full rounded-full bg-cream ps-12 pe-4 text-[15px] ring-1 ring-line placeholder:text-muted focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
          />
        </form>
        <div className="ms-auto flex items-center gap-1 md:ms-0">
          <PostcodeChip />
          <Suspense fallback={null}>
            <LanguageSwitcher />
          </Suspense>
          <CartButton />
        </div>
      </Container>
    </header>
  );
}

export function BottomNav() {
  const { locale, d } = useI18n();
  const pathname = usePathname();
  const { count, ready } = useCart();
  const items = [
    {
      href: `/${locale}`,
      label: d.nav.home,
      icon: Home,
      match: (p: string) => p === `/${locale}`,
    },
    {
      href: `/${locale}/shop`,
      label: d.nav.categories,
      icon: LayoutGrid,
      match: (p: string) => p.startsWith(`/${locale}/shop`) || p.startsWith(`/${locale}/products`),
    },
    {
      href: `/${locale}/shop?focus=search`,
      label: d.nav.search,
      icon: Search,
      match: () => false,
    },
    {
      href: `/${locale}/cart`,
      label: d.nav.cart,
      icon: ShoppingBag,
      match: (p: string) => p.startsWith(`/${locale}/cart`) || p.startsWith(`/${locale}/checkout`),
    },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((it) => {
          const active = it.match(pathname);
          return (
            <li key={it.label}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-forest" : "text-muted",
                )}
              >
                <it.icon className="size-6" aria-hidden />
                {it.label}
                {it.icon === ShoppingBag && ready && count > 0 && (
                  <span className="absolute end-[28%] top-2 grid min-w-4 place-items-center rounded-full bg-forest px-1 text-[10px] font-bold leading-4 text-white">
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Footer() {
  const { locale, d, t } = useI18n();
  return (
    <footer className="mt-20 border-t border-line bg-forest-dark text-white/85">
      <Container className="grid gap-8 py-12 md:grid-cols-3">
        <div className="space-y-3">
          <p className="font-display text-2xl text-white">{d.brand.name}</p>
          <p className="text-sm text-white/70">{d.footer.about}</p>
          <p className="pt-2 text-sm text-white/70">
            {d.footer.partnerTitle}:{" "}
            <a
              href="https://share.google/VmenJVKEgN1HV3exG"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-white underline underline-offset-4"
            >
              Kevser Fleischerei
            </a>
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-white">{d.footer.legal}</p>
          <ul className="space-y-2 text-sm">
            {(["privacy", "imprint", "terms"] as const).map((s) => (
              <li key={s}>
                <Link href={`/${locale}/legal/${s}`} className="hover:text-white hover:underline">
                  {d.footer[s]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/60">{d.footer.storage}</p>
      </Container>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">
        {t(d.footer.rights, { year: new Date().getFullYear() })}
      </div>
    </footer>
  );
}
