import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronDown, Scale, Store, Truck } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { listCategories, listProducts } from "@/server/catalog";
import { BUNDLE_CATEGORY } from "@/domain/bundles";
import { BundleCard } from "@/components/bundle-card";
import { ProductCard } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";
import { PostcodePanel } from "@/components/delivery-ui";
import { Container, buttonClasses } from "@/components/ui";

export const dynamic = "force-dynamic";

const COPY = {
  de: {
    title: "Frisches Halal-Fleisch. Direkt nach Hause.",
    heroLabel: "Von der Kevser Fleischerei in Berlin",
    partnerLabel: "Ihr lokaler Metzger-Partner",
    deliveryTerms: "Liefertermin, Mindestbestellwert und Lieferkosten hängen von Ihrer Postleitzahl ab.",
    imageDisclaimer: "Symbolbild – das Fleisch wird von Kevser Fleischerei vorbereitet.",
    categoriesSub: "Wählen Sie aus, was heute auf den Tisch kommt.",
    featured: "Fleisch für Ihren Einkauf",
    featuredSub: "Klare Kilopreise. Direkt in den Warenkorb.",
    allProducts: "Alle Produkte",
    deliveryTitle: "Liefern wir zu Ihnen?",
    deliverySub: "Postleitzahl eingeben und die Konditionen direkt sehen.",
    sub: "Frisch von Kevser Fleischerei vorbereitet. Sie zahlen nur, was tatsächlich gewogen wurde.",
    cta: "Fleisch entdecken",
    how: "So funktioniert’s",
    notice: "Halal Fresh vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei.",
    trust: [
      [Store, "Von Kevser Fleischerei", "Zubereitet und geliefert vom Metzger in Berlin."],
      [Truck, "Lieferung nach PLZ", "Termin und Konditionen direkt prüfen."],
      [Scale, "Bezahlt wird nur das echte Gewicht", "Höchstens der angezeigte Maximalbetrag."],
    ],
    bundles: "Pakete",
    categories: "Kategorien",
    stepsTitle: "So funktioniert’s",
    steps: ["Bestellen", "Kevser schneidet & wiegt", "Sie zahlen den exakten Betrag & wir liefern"],
    aboutTitle: "Über Kevser",
    about: "Kevser Fleischerei bereitet Ihre Bestellung als lokaler Metzger in Berlin vor: Fleisch wird zugeschnitten, gewogen und zur Lieferung bereitgestellt.",
    faqTitle: "Häufige Fragen",
    faq: [
      ["Mindestbestellwert", "Der Mindestbestellwert wird am voraussichtlichen Betrag gemessen. Er steht im Warenkorb."],
      ["Gewicht & Preis", "Sie bestellen ein ungefähres Gewicht. Nach dem Wiegen zahlen Sie das tatsächliche Gewicht, höchstens den Maximalbetrag (±10 %)."],
      ["Liefergebiet", "Geben Sie oben Ihre Postleitzahl ein, dann sehen Sie sofort, ob und wann wir liefern."],
      ["Bezahlung", "PayPal nach dem Wiegen. Barzahlung bei Lieferung ist ab der zweiten Bestellung möglich."],
      ["Halal", "Angaben zu Halal-Nachweisen zeigen wir erst, wenn sie geprüft sind."],
    ],
  },
  tr: {
    title: "Taze helal et. Kapınıza kadar.",
    heroLabel: "Berlin'deki Kevser Fleischerei'den",
    partnerLabel: "Yerel kasap iş ortağımız",
    deliveryTerms: "Teslimat günü, minimum sipariş ve teslimat ücreti posta kodunuza göre belirlenir.",
    imageDisclaimer: "Temsili görsel – etler Kevser Fleischerei tarafından hazırlanır.",
    categoriesSub: "Sofranız için ihtiyacınız olanı seçin.",
    featured: "Alışverişiniz için etler",
    featuredSub: "Net kilogram fiyatları. Kolayca sepete ekleyin.",
    allProducts: "Tüm ürünler",
    deliveryTitle: "Adresinize teslimat var mı?",
    deliverySub: "Posta kodunuzu yazın, teslimat koşullarını hemen görün.",
    sub: "Kevser Fleischerei siparişinizi taze hazırlar. Yalnızca tartılan gerçek ağırlığın bedelini ödersiniz.",
    cta: "Etleri keşfet",
    how: "Nasıl çalışır",
    notice: "Halal Fresh siparişleri aktarır. Satıcı ve teslimatçı Kevser Fleischerei’dir.",
    trust: [
      [Store, "Kevser Fleischerei’dan", "Berlin’deki kasap tarafından hazırlanır ve teslim edilir."],
      [Truck, "Bölgeye göre teslimat", "Günü ve koşulları posta kodunuzla öğrenin."],
      [Scale, "Yalnızca gerçek ağırlık ödenir", "En fazla gösterilen azami tutar."],
    ],
    bundles: "Paketler",
    categories: "Kategoriler",
    stepsTitle: "Nasıl çalışır",
    steps: ["Sipariş verin", "Kevser keser ve tartar", "Tam tutarı ödersiniz, biz teslim ederiz"],
    aboutTitle: "Kevser hakkında",
    about: "Kevser Fleischerei, Berlin’deki yerel kasap iş ortağımızdır. Etler siparişinize göre hazırlanır, tartılır ve teslimata hazırlanır.",
    faqTitle: "Sık sorulan sorular",
    faq: [
      ["Minimum sipariş tutarı", "Minimum tutar tahmini tutar üzerinden ölçülür. Sepette görürsünüz."],
      ["Ağırlık ve fiyat", "Yaklaşık ağırlık sipariş edersiniz. Tartımdan sonra gerçek ağırlığı, en fazla azami tutarı (±%10) ödersiniz."],
      ["Teslimat bölgesi", "Yukarıya posta kodunuzu girin; teslim edip etmediğimizi ve ne zaman edeceğimizi hemen görürsünüz."],
      ["Ödeme", "Tartımdan sonra PayPal. Teslimatta nakit ödeme ikinci siparişten itibaren mümkündür."],
      ["Helal", "Helal belgelerine ilişkin bilgileri yalnızca doğrulandıktan sonra gösteririz."],
    ],
  },
} as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = await getDictionary(locale);
  const c = COPY[locale];
  const [bundles, cats, catalog] = await Promise.all([
    listProducts(locale, { category: BUNDLE_CATEGORY, availableOnly: true }).then((items) =>
      items.filter((p) => p.bundle && p.purchasable && p.priceConfirmed).slice(0, 3),
    ),
    listCategories(locale),
    listProducts(locale, { availableOnly: true, limit: 36 }),
  ]);
  // Never advertise an unconfirmed price or unavailable product.
  const featured = catalog.filter((p) => !p.bundle && p.purchasable && p.priceConfirmed).slice(0, 8);
  const preferredCategories = ["dana", "kuzu", "tavuk", "mangal", "sarkuteri", "sakatat"];
  const categories = cats
    .filter((cat) => !["ekipman", "icecek"].includes(cat.slug))
    .sort((a, b) => {
      const ai = preferredCategories.indexOf(a.slug);
      const bi = preferredCategories.indexOf(b.slug);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
    })
    .slice(0, 6);

  return (
    <>
      {/* Local-butcher trust, a clear price promise and a working delivery postcode check. */}
      <section className="bg-[#F6EFE3]">
        <Container className="grid items-start gap-7 py-7 sm:py-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:items-center lg:gap-9 lg:py-12">
          <div className="min-w-0">
            <div className="mb-5 inline-flex max-w-full items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-white/85 px-3 py-2">
              <Image src="/kevser-logo.png" alt="" width={400} height={289} className="h-10 w-auto shrink-0 object-contain" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-primary">{c.heroLabel}</p>
                <p className="mt-0.5 text-xs text-text-muted">{c.partnerLabel}</p>
              </div>
            </div>
            <h1 className="text-balance font-display text-[2.125rem] font-semibold leading-[1.12] tracking-tight text-text sm:text-[2.75rem] lg:text-[3rem]">{c.title}</h1>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-text-muted sm:text-lg">{c.sub}</p>
            <Link href={"/" + locale + "/shop"} className={buttonClasses({ size: "lg" }) + " mt-5"}>
              {c.cta}<ArrowRight className="size-5" aria-hidden />
            </Link>
            <div id="delivery-check" className="mt-6 max-w-xl scroll-mt-24">
              <h2 className="text-lg font-semibold text-text">{c.deliveryTitle}</h2>
              <p className="mt-1 text-sm text-text-muted">{c.deliverySub}</p>
              <div className="mt-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3 sm:p-4" data-testid="hero-postcode">
                <PostcodePanel />
              </div>
              <p className="mt-2 text-xs text-text-muted">{c.deliveryTerms}</p>
            </div>
            <p className="mt-4 max-w-xl border-l-2 border-primary/30 pl-3 text-xs leading-relaxed text-text-muted">{c.notice}</p>
          </div>
          <figure className="min-w-0">
            <div className="relative h-52 overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-sm sm:h-72 lg:h-[390px]">
              <Image src="/hero-spread.jpg" alt="" fill priority sizes="(min-width:1024px) 40vw, 100vw" className="object-cover" />
            </div>
            <figcaption className="mt-2 text-xs text-text-muted">{c.imageDisclaimer}</figcaption>
          </figure>
        </Container>
      </section>

      {categories.length > 0 && (
        <Container className="py-9 sm:py-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="t-h2">{c.categories}</h2><p className="mt-1 text-sm text-text-muted">{c.categoriesSub}</p></div>
            <Link href={"/" + locale + "/shop"} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{c.allProducts}<ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-6">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link href={"/" + locale + "/shop?category=" + encodeURIComponent(cat.slug)} className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface transition-colors hover:border-primary/40 hover:bg-surface-alt">
                  <div className="relative aspect-[5/4] w-full bg-[#FAF9F6]">
                    {cat.imageUrl ? (
                      <ProductImage src={cat.imageUrl} alt="" sizes="(min-width:1024px) 180px, (min-width:640px) 32vw, 33vw" className="object-contain p-2" />
                    ) : (
                      <div className="grid h-full place-items-center text-primary/60"><Store className="size-9" aria-hidden /></div>
                    )}
                  </div>
                  <span className="flex min-h-11 items-center justify-center px-1 py-2 text-center text-xs font-semibold text-text sm:text-base">{cat.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      )}

      {/* Only show products that the customer can actually buy at a confirmed price. */}
      {featured.length > 0 && (
        <section className="bg-surface py-9 sm:py-12">
          <Container>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
              <div><h2 className="t-h2">{c.featured}</h2><p className="mt-1 text-sm text-text-muted">{c.featuredSub}</p></div>
              <Link href={"/" + locale + "/shop"} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{c.allProducts}<ArrowRight className="size-4" aria-hidden /></Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {featured.map((p, i) => <ProductCard key={p.id} p={p} locale={locale} d={d} priority={i < 4} />)}
            </div>
          </Container>
        </section>
      )}

      {bundles.length > 0 && (
        <Container className="py-9 sm:py-12">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="t-h2">{c.bundles}</h2>
            <Link href={"/" + locale + "/shop?category=" + encodeURIComponent(BUNDLE_CATEGORY)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{c.allProducts}<ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{bundles.map((p) => <BundleCard key={p.id} p={p} locale={locale} d={d} />)}</div>
        </Container>
      )}

      <Container className="py-9 sm:py-12">
        <ul className="grid gap-5 sm:grid-cols-3">
          {c.trust.map(([Icon, heading, description]) => (
            <li key={heading} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft"><Icon className="size-5 text-primary" strokeWidth={1.75} aria-hidden /></span>
              <div><p className="font-semibold">{heading}</p><p className="mt-1 text-sm text-text-muted">{description}</p></div>
            </li>
          ))}
        </ul>
      </Container>

      <section className="bg-surface-alt py-10 sm:py-12">
        <Container>
          <h2 className="t-h2 mb-5">{c.stepsTitle}</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {c.steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-surface p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-text-inverse font-semibold">{i + 1}</span>
                <p className="text-base font-semibold">{s}</p>
              </li>
            ))}
          </ol>
          <Link href={"/" + locale + "/how-it-works"} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{c.how}<ArrowRight className="size-4" aria-hidden /></Link>
        </Container>
      </section>

      <Container className="grid items-center gap-5 py-10 sm:grid-cols-[180px_1fr] sm:gap-10 sm:py-12">
        <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <Image src="/kevser-logo.png" alt="Kevser Fleischerei" width={400} height={289} className="h-24 w-auto object-contain" />
        </div>
        <div><h2 className="t-h2">{c.aboutTitle}</h2><p className="mt-2 leading-relaxed text-text-muted">{c.about}</p></div>
      </Container>

      <Container className="max-w-3xl pb-12 lg:pb-20">
        <h2 className="t-h2 mb-4">{c.faqTitle}</h2>
        <div className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
          {c.faq.map(([q, a]) => (
            <details key={q} className="group px-4">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown className="size-5 shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-4 text-text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Container>
    </>
  );
}
