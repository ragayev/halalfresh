"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Check, Menu, ShoppingBag, Store } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { LOCALES } from "@/i18n/config";
import { formatMoney } from "@/domain/money";
import { useCart } from "./cart-store";
import { useCartView } from "./use-cart-view";
import { Container, ProgressBar } from "./ui";
import { PostcodeChip } from "./delivery-ui";
import { cn } from "@/lib/utils";

/** Etamico icon + wordmark (the SVG logo files were not supplied; swap this for etamico-logo.svg when they are). */
export function Logo({ className, inverse }: { className?: string; inverse?: boolean }) {
  const { locale } = useI18n();
  return (
    <Link href={`/${locale}`} className={cn("inline-flex min-h-11 items-center gap-2", className)} aria-label="Etamico">
      <Image src="/icons/etamico-icon-192.png" alt="" width={36} height={36} priority className="size-9 rounded-[10px]" />
      <span className={cn("wordmark text-2xl", inverse && "!text-text-inverse")}>Etamico</span>
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
      className="relative grid size-11 place-items-center rounded-full text-text hover:bg-surface-alt"
    >
      <ShoppingBag className="size-6" strokeWidth={1.75} aria-hidden />
      {ready && count > 0 && (
        <span className="pop absolute end-0 top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-5 text-text-inverse" data-testid="cart-count">
          {count}
        </span>
      )}
    </Link>
  );
}

/** DE | TR segmented control. The language lives in the URL only: no cookie. */
function LanguageToggle() {
  const { locale, d } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const rest = pathname.replace(/^\/(de|tr)/, "") || "";
  return (
    <div role="group" aria-label={d.nav.language} className="inline-flex h-8 overflow-hidden rounded-[var(--radius-sm)] border border-border-strong text-sm font-semibold">
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={`/${l}${rest}${search ? `?${search}` : ""}`}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          className={cn("relative grid min-w-11 place-items-center px-2 uppercase after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']", l === locale ? "bg-primary-soft text-primary" : "text-text hover:bg-surface-alt")}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}

export function Header() {
  const { locale, d } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <Container className="flex h-16 items-center gap-3 lg:gap-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          <Link href={`/${locale}/shop`} className="rounded-[var(--radius-md)] px-3 py-2.5 font-medium hover:bg-surface-alt">
            {d.nav.shop}
          </Link>
          <Link href={`/${locale}/how-it-works`} className="rounded-[var(--radius-md)] px-3 py-2.5 font-medium hover:bg-surface-alt">
            {locale === "tr" ? "Nasıl çalışır" : "So funktioniert’s"}
          </Link>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <PostcodeChip />
          <Suspense fallback={null}>
            <LanguageToggle />
          </Suspense>
          <CartButton />
          {/* Mobile menu: full-height sheet without JS (details). */}
          <details className="group lg:hidden">
            <summary aria-label={d.nav.menu} className="grid size-11 cursor-pointer list-none place-items-center rounded-full hover:bg-surface-alt [&::-webkit-details-marker]:hidden">
              <Menu className="size-6" strokeWidth={1.75} aria-hidden />
            </summary>
            <div className="fixed inset-x-0 top-16 z-50 h-[calc(100dvh-4rem)] overflow-y-auto bg-surface p-4 shadow-lg">
              <nav aria-label="Mobile" className="flex flex-col gap-1 text-lg">
                <Link href={`/${locale}/shop`} className="flex min-h-12 items-center rounded-[var(--radius-md)] px-3 hover:bg-surface-alt">{d.nav.shop}</Link>
                <Link href={`/${locale}/how-it-works`} className="flex min-h-12 items-center rounded-[var(--radius-md)] px-3 hover:bg-surface-alt">{locale === "tr" ? "Nasıl çalışır" : "So funktioniert’s"}</Link>
                <Link href={`/${locale}/cart`} className="flex min-h-12 items-center rounded-[var(--radius-md)] px-3 hover:bg-surface-alt">{d.nav.cart}</Link>
                <div className="px-3 pt-4"><Suspense fallback={null}><LanguageToggle /></Suspense></div>
              </nav>
            </div>
          </details>
        </div>
      </Container>
    </header>
  );
}

/** Mobile sticky cart bar: item count, estimated total, min-order progress. Shown only while the cart has items. */
export function BottomNav() {
  const { locale, d } = useI18n();
  const pathname = usePathname();
  const { count, ready } = useCart();
  const { data } = useCartView();
  if (!ready || count === 0 || pathname.includes("/cart") || pathname.includes("/checkout") || pathname.includes("/b/") || pathname.includes("/products/")) return null;
  const totals = data?.totals;
  const est = data?.estimate?.estimatedTotalCents ?? totals?.totalCents;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-lg lg:hidden" data-testid="sticky-cart">
      {totals && totals.minOrderCents > 0 && (
        <div className="px-4 pt-2">
          <ProgressBar value={Math.min(totals.subtotalCents, totals.minOrderCents)} max={totals.minOrderCents} label={d.cart.title} />
          <p className={cn("t-caption mt-1", totals.meetsMinimum ? "text-fresh" : "text-text-muted")}>
            {totals.meetsMinimum ? (
              <>
                <Check className="mr-1 inline size-3" aria-hidden />
                {locale === "tr" ? "Minimum sipariş tutarına ulaşıldı" : "Mindestbestellwert erreicht"}
              </>
            ) : locale === "tr" ? (
              `Minimum sipariş tutarına ${formatMoney(totals.shortfallCents, locale)} kaldı`
            ) : (
              `Noch ${formatMoney(totals.shortfallCents, locale)} bis zum Mindestbestellwert`
            )}
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 p-3">
        <p className="tabular font-semibold">
          {count} {locale === "tr" ? "ürün" : count === 1 ? "Artikel" : "Artikel"}
          {est != null && <> · ca. {formatMoney(est, locale)}</>}
        </p>
        <Link href={`/${locale}/cart`} className="inline-flex h-12 items-center rounded-[var(--radius-md)] bg-primary px-5 font-semibold text-text-inverse hover:bg-primary-hover">
          {d.nav.cart}
        </Link>
      </div>
    </div>
  );
}

const LEGAL: [string, string, string][] = [
  ["imprint", "Impressum", "Impressum"],
  ["privacy", "Datenschutz", "Datenschutz"],
  ["terms", "Nutzungsbedingungen", "Nutzungsbedingungen"],
  ["agb", "AGB & Widerruf Kevser Fleischerei", "AGB & Widerruf Kevser Fleischerei"],
];

export function Footer() {
  const { locale, t, d } = useI18n();
  return (
    <footer className="mt-20 bg-ink text-text-inverse">
      <Container className="grid gap-8 py-12 md:grid-cols-3">
        <div className="space-y-3">
          <Logo inverse />
          <p className="t-small text-white/80">{d.brand.tagline}</p>
          <p className="t-small flex gap-2 text-white/80">
            <Store className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>
              {locale === "tr" ? "Etamico siparişleri aktarır. Satıcı ve teslimatçı Kevser Fleischerei'dir." : "Etamico vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei."}
            </span>
          </p>
          <p className="t-small text-white/80">{locale === "tr" ? "Ödeme: PayPal · Nakit (2. siparişten itibaren)" : "Zahlung: PayPal · Bar (ab 2. Bestellung)"}</p>
        </div>
        <nav aria-label="Rechtliches">
          <p className="mb-3 t-small font-semibold">{d.footer.legal}</p>
          <ul className="t-small space-y-1">
            {LEGAL.map(([slug, label]) => (
              <li key={slug}>
                <Link href={`/${locale}/legal/${slug}`} className="inline-flex min-h-11 items-center text-white/90 underline-offset-4 hover:underline">
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/${locale}/how-it-works`} className="inline-flex min-h-11 items-center text-white/90 underline-offset-4 hover:underline">
                {locale === "tr" ? "Nasıl çalışır" : "So funktioniert’s"}
              </Link>
            </li>
          </ul>
          {locale === "tr" && <p className="t-small mt-2 text-white/80">Yasal metinler yalnızca Almanca olarak geçerlidir.</p>}
        </nav>
        <p className="t-small text-white/80">{d.footer.storage}</p>
      </Container>
      <div className="border-t border-white/10 py-4 text-center t-caption text-white/70">{t(d.footer.rights, { year: new Date().getFullYear() })}</div>
    </footer>
  );
}
