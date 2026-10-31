import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import { notFound } from "next/navigation";
import "../../globals.css";
import { LOCALES, isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { I18nProvider } from "@/i18n/provider";
import { CartProvider } from "@/components/cart-store";
import { Header, BottomNav, Footer } from "@/components/chrome";
import { siteUrl } from "@/lib/env";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#164B39",
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
    icons: { icon: "/icon.svg" },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return (
    <html lang={locale} data-scroll-behavior="smooth" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh pb-20 lg:pb-0">
        <I18nProvider locale={locale} dictionary={dictionary}>
          <CartProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2"
            >
              {dictionary.nav.skip}
            </a>
            <Header />
            <main id="main">{children}</main>
            <Footer />
            <BottomNav />
          </CartProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
