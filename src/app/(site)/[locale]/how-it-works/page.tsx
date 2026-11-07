import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { Container, Notice } from "@/components/ui";

const COPY = {
  de: {
    title: "So funktioniert’s",
    intro: "Etamico vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei in Berlin.",
    steps: [
      ["Bestellen", "Wählen Sie Fleisch nach ungefährem Gewicht. Sie sehen den voraussichtlichen Betrag und den Maximalbetrag."],
      ["Kevser schneidet & wiegt", "Wir leiten Ihre Bestellung an die Kevser Fleischerei weiter. Dort wird geschnitten und gewogen."],
      ["Sie zahlen den exakten Betrag", "Nach dem Wiegen erhalten Sie den Endbetrag. Sie zahlen nur das tatsächliche Gewicht, höchstens den Maximalbetrag. Danach liefern wir."],
    ],
    roles: "Wer ist wer? Der Kaufvertrag besteht mit der Kevser Fleischerei. Etamico nimmt Ihre Bestellung entgegen und leitet sie weiter.",
    pay: "Bezahlung: PayPal (nach dem Wiegen) oder Bar bei Lieferung (ab der zweiten Bestellung).",
  },
  tr: {
    title: "Nasıl çalışır",
    intro: "Etamico siparişleri aktarır. Satıcı ve teslimatçı Berlin’deki Kevser Fleischerei’dir.",
    steps: [
      ["Sipariş verin", "Eti yaklaşık ağırlığa göre seçin. Tahmini tutarı ve azami tutarı görürsünüz."],
      ["Kevser keser ve tartar", "Siparişinizi Kevser Fleischerei’ye iletiriz. Orada kesilir ve tartılır."],
      ["Tam tutarı ödersiniz", "Tartımdan sonra nihai tutarı alırsınız. Yalnızca gerçek ağırlığı, en fazla azami tutarı ödersiniz. Ardından teslim ederiz."],
    ],
    roles: "Kim kimdir? Satış sözleşmesi Kevser Fleischerei ile kurulur. Etamico siparişinizi alır ve iletir.",
    pay: "Ödeme: PayPal (tartımdan sonra) veya teslimatta nakit (ikinci siparişten itibaren).",
  },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? { title: COPY[locale].title } : {};
}

export default async function HowItWorks({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = COPY[locale];
  return (
    <Container className="max-w-[720px] space-y-6 py-10">
      <h1 className="t-h1">{c.title}</h1>
      <p className="t-body-lg">{c.intro}</p>
      <ol className="space-y-4">
        {c.steps.map(([h, p], i) => (
          <li key={h} className="flex gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{i + 1}</span>
            <div>
              <h2 className="t-h3">{h}</h2>
              <p className="text-text-muted">{p}</p>
            </div>
          </li>
        ))}
      </ol>
      <Notice tone="info">{c.roles}</Notice>
      <p>{c.pay}</p>
    </Container>
  );
}
