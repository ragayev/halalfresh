import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import "../../globals.css";
import { LOCALES, isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { I18nProvider } from "@/i18n/provider";
import { CartProvider } from "@/components/cart-store";
import { DeliveryProvider } from "@/components/delivery-provider";
import { PostcodeGate } from "@/components/delivery-ui";
import { Header, BottomNav, Footer } from "@/components/chrome";
import { siteUrl } from "@/lib/env";

export const viewport: Viewport = {
  themeColor: "#6B1E23",
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const d = await getDictionary(locale);
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${d.brand.name} — ${d.brand.tagline}`,
      template: `%s · ${d.brand.name}`,
    },
    description: d.home.heroText,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      type: "website",
      siteName: d.brand.name,
      title: d.brand.tagline,
      description: d.home.heroText,
      locale,
    },
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  for (const f of ["inter-latin-wght-normal", "fraunces-latin-opsz-normal"])
    preload(`/fonts/${f}.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body className="min-h-dvh pb-20 lg:pb-0">
        <I18nProvider locale={locale} dictionary={dictionary}>
          <CartProvider>
            <DeliveryProvider>
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2"
              >
                {dictionary.nav.skip}
              </a>
              <Header />
              <main id="main">{children}</main>
              <Footer />
              <BottomNav />
              <PostcodeGate />
            </DeliveryProvider>
          </CartProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
