import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ChevronDown, Scale, Store, Truck } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { listCategories, listProducts } from "@/server/catalog";
import { BUNDLE_CATEGORY } from "@/domain/bundles";
import { BundleCard } from "@/components/bundle-card";
import { PostcodeChecker } from "@/components/postcode-checker";
import { Container, buttonClasses } from "@/components/ui";

export const dynamic = "force-dynamic";

const COPY = {
  de: {
    title: "Frisches Halal-Fleisch vom Metzger Ihres Vertrauens — nach Hause geliefert.",
    sub: "Bestellen Sie nach ungefährem Gewicht. Sie zahlen, was tatsächlich gewogen wurde.",
    cta: "Jetzt bestellen",
    how: "So funktioniert’s",
    notice: "Etamico vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei.",
    trust: [
      [Store, "Von Kevser Fleischerei", "Zubereitet und geliefert vom Metzger in Berlin."],
      [Truck, "Lieferung in 1–3 Tagen", "Termin je nach Postleitzahl."],
      [Scale, "Bezahlt wird nur das echte Gewicht", "Höchstens der angezeigte Maximalbetrag."],
    ],
    bundles: "Pakete",
    categories: "Kategorien",
    stepsTitle: "So funktioniert’s",
    steps: ["Bestellen", "Kevser schneidet & wiegt", "Sie zahlen den exakten Betrag & wir liefern"],
    aboutTitle: "Über Kevser",
    about: "Kevser Fleischerei ist ein Halal-Metzger in Berlin-Neukölln. Hier wird Ihre Bestellung geschnitten, gewogen und für die Lieferung vorbereitet.",
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
    title: "Güvendiğiniz kasaptan taze helal et — kapınıza kadar.",
    sub: "Yaklaşık ağırlığa göre sipariş verin. Gerçekten tartılan kadarını ödersiniz.",
    cta: "Hemen sipariş ver",
    how: "Nasıl çalışır",
    notice: "Etamico siparişleri aktarır. Satıcı ve teslimatçı Kevser Fleischerei’dir.",
    trust: [
      [Store, "Kevser Fleischerei’dan", "Berlin’deki kasap tarafından hazırlanır ve teslim edilir."],
      [Truck, "1–3 günde teslimat", "Gün, posta kodunuza göre değişir."],
      [Scale, "Yalnızca gerçek ağırlık ödenir", "En fazla gösterilen azami tutar."],
    ],
    bundles: "Paketler",
    categories: "Kategoriler",
    stepsTitle: "Nasıl çalışır",
    steps: ["Sipariş verin", "Kevser keser ve tartar", "Tam tutarı ödersiniz, biz teslim ederiz"],
    aboutTitle: "Kevser hakkında",
    about: "Kevser Fleischerei, Berlin-Neukölln’de bir helal kasaptır. Siparişiniz burada kesilir, tartılır ve teslimata hazırlanır.",
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
  const [bundles, cats] = await Promise.all([
    listProducts(locale, { category: BUNDLE_CATEGORY, availableOnly: true }).then((p) => p.filter((x) => x.bundle).slice(0, 3)),
    listCategories(locale),
  ]);

  return (
    <>
      {/* Hero: real photo of the shop, dark overlay for legibility, PLZ check inside the hero. */}
      <section className="relative isolate overflow-hidden bg-ink text-text-inverse">
        <Image src="/hero-spread.jpg" alt="" fill priority sizes="100vw" className="-z-20 object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 to-ink/20" />
        <Container className="flex min-h-[560px] flex-col justify-end gap-6 pb-10 pt-24 lg:min-h-[600px] lg:pb-16">
          <p className="t-caption uppercase tracking-wider text-white/90">{d.brand.tagline}</p>
          <h1 className="t-display max-w-3xl !text-text-inverse">{c.title}</h1>
          <p className="t-body-lg max-w-xl text-white/90">{c.sub}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href={`/${locale}/shop`} className={buttonClasses({ size: "lg" })}>
              {c.cta}
            </Link>
            <Link href={`/${locale}/how-it-works`} className="inline-flex min-h-11 items-center font-semibold text-white underline underline-offset-4">
              {c.how}
            </Link>
          </div>
          <div className="max-w-md rounded-[var(--radius-lg)] bg-surface p-1 text-text">
            <PostcodeChecker />
          </div>
        </Container>
      </section>
      <Container className="pt-4">
        <p className="t-small text-text-muted">{c.notice}</p>
      </Container>

      <Container className="py-12 lg:py-20">
        <ul className="grid gap-4 sm:grid-cols-3">
          {c.trust.map(([Icon, h, p]) => (
            <li key={h} className="flex gap-3">
              <Icon className="mt-1 size-6 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="font-semibold">{h}</p>
                <p className="t-small text-text-muted">{p}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>

      {bundles.length > 0 && (
        <Container className="pb-12 lg:pb-20">
          <h2 className="t-h2 mb-6">{c.bundles}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bundles.map((p, i) => (
              <BundleCard key={p.id} p={p} locale={locale} d={d} priority={i === 0} />
            ))}
          </div>
        </Container>
      )}

      {cats.length > 0 && (
        <Container className="pb-12 lg:pb-20">
          <h2 className="t-h2 mb-6">{c.categories}</h2>
          <ul className="flex flex-wrap gap-2">
            {cats.map((cat) => (
              <li key={cat.id}>
                <Link href={`/${locale}/shop?category=${cat.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 font-medium hover:bg-primary-soft">
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      )}

      <section className="bg-surface-alt py-12 lg:py-20">
        <Container>
          <h2 className="t-h2 mb-6">{c.stepsTitle}</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {c.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-text-inverse font-semibold">{i + 1}</span>
                <p className="t-h3 pt-1">{s}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Container className="grid items-center gap-8 py-12 md:grid-cols-2 lg:py-20">
        <Image src="/kevser-logo.png" alt="Kevser Fleischerei" width={400} height={289} className="mx-auto h-40 w-auto" />
        <div>
          <h2 className="t-h2">{c.aboutTitle}</h2>
          <p className="t-body-lg mt-3 text-text-muted">{c.about}</p>
        </div>
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
