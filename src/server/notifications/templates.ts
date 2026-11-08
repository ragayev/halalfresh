import { formatMoney } from "@/domain/money";
import { orderNumberLabel } from "@/domain/order-state";
import type { Locale } from "@/i18n/config";

/** Variables every template may use. Money in cents, grams as integers. */
export interface TemplateVars {
  locale: Locale;
  number: number;
  firstName: string;
  link: string;
  paymentMethod: "PAYPAL" | "CASH";
  estimatedTotalCents: number;
  maxTotalCents: number;
  finalTotalCents: number | null;
  cappedAmountCents: number | null;
  deliveryLabel: string;
  address: string;
  items: { name: string; requestedGrams: number; actualGrams: number | null; finalCents: number | null; estimatedCents: number }[];
  seller: { name: string; address: string; phone: string; email: string };
  cancelReason?: string | null;
}

export type TemplateKey = "order_created" | "accepted" | "weighed" | "weight_corrected" | "out_for_delivery" | "cancelled" | "payment_overdue";

export interface Rendered {
  subject: string;
  email: string;
  sms: string | null;
}

const kg = (g: number, l: Locale) => `${(g / 1000).toLocaleString(l === "tr" ? "tr-TR" : "de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;

/** Legally relevant blocks: always German, whatever the customer's language (brief §10). */
export const NO_WITHDRAWAL_DE =
  "Kein Widerrufsrecht, da es sich um schnell verderbliche bzw. nach Kundenspezifikation zugeschnittene Ware handelt (§ 312g Abs. 2 Nr. 1, 2 BGB).";

function sellerBlockDe(s: TemplateVars["seller"]) {
  return `Ihr Vertragspartner: ${s.name}, ${s.address}, ${s.phone}, ${s.email}`;
}

const T = {
  de: {
    hello: (n: string) => `Guten Tag ${n},`,
    order: "Bestellung",
    estimated: "Voraussichtlicher Betrag",
    max: "Maximalbetrag",
    final: "Endbetrag",
    delivery: "Lieferung",
    view: "Bestellung ansehen",
    weighNote: "Fleisch wird nach tatsächlichem Gewicht abgerechnet. Der Endbetrag beträgt maximal den Maximalbetrag.",
    created: "vielen Dank für Ihre Bestellung bei Halal Fresh.",
    accepted: "Ihre Bestellung wurde angenommen und wird vorbereitet.",
    weighed: "Ihre Bestellung wurde abgewogen.",
    corrected: "Das Gewicht Ihrer Bestellung wurde korrigiert. Bitte beachten Sie den neuen Endbetrag.",
    payPaypal: "Bitte bezahlen Sie jetzt per PayPal",
    payCash: "Zu zahlen bei Lieferung",
    ofd: "Ihre Bestellung ist unterwegs zu Ihnen.",
    cancelled: "Ihre Bestellung wurde storniert.",
    reason: "Grund",
    overdue: "Erinnerung: Ihre Bestellung ist noch nicht bezahlt. Bitte bezahlen Sie per PayPal, damit wir liefern können.",
  },
  tr: {
    hello: (n: string) => `Merhaba ${n},`,
    order: "Sipariş",
    estimated: "Tahmini tutar",
    max: "Azami tutar",
    final: "Nihai tutar",
    delivery: "Teslimat",
    view: "Siparişi görüntüle",
    weighNote: "Et gerçek ağırlığa göre ücretlendirilir. Nihai tutar azami tutarı aşmaz.",
    created: "Halal Fresh'ten verdiğiniz sipariş için teşekkür ederiz.",
    accepted: "Siparişiniz kabul edildi ve hazırlanıyor.",
    weighed: "Siparişiniz tartıldı.",
    corrected: "Siparişinizin ağırlığı düzeltildi. Lütfen yeni nihai tutara dikkat edin.",
    payPaypal: "Lütfen şimdi PayPal ile ödeyin",
    payCash: "Teslimatta ödenecek tutar",
    ofd: "Siparişiniz yola çıktı.",
    cancelled: "Siparişiniz iptal edildi.",
    reason: "Neden",
    overdue: "Hatırlatma: Siparişinizin ödemesi henüz yapılmadı. Teslimat için lütfen PayPal ile ödeyin.",
  },
} as const;

export function renderTemplate(key: TemplateKey, v: TemplateVars): Rendered {
  const t = T[v.locale];
  const no = orderNumberLabel(v.number);
  const m = (c: number) => formatMoney(c, v.locale);
  const lines = v.items
    .map((i) => {
      const w = i.actualGrams != null ? `${kg(i.actualGrams, v.locale)} (${kg(i.requestedGrams, v.locale)})` : kg(i.requestedGrams, v.locale);
      const p = i.finalCents != null ? m(i.finalCents) : `ca. ${m(i.estimatedCents)}`;
      return `- ${i.name} · ${w} · ${p}`;
    })
    .join("\n");
  const head = [t.hello(v.firstName), ""];
  const body = (intro: string, extra: string[] = []) =>
    [...head, intro, "", `${t.order} ${no}`, lines, "", ...extra, `${t.delivery}: ${v.deliveryLabel}`, v.address, "", `${t.view}: ${v.link}`].join("\n");
  const payLine = () =>
    v.finalTotalCents == null
      ? ""
      : v.paymentMethod === "PAYPAL"
        ? `${t.payPaypal}: ${m(v.finalTotalCents)}`
        : `${t.payCash}: ${m(v.finalTotalCents)}`;

  switch (key) {
    case "order_created": {
      const legal = ["", "— Rechtliche Hinweise (Deutsch) —", NO_WITHDRAWAL_DE, sellerBlockDe(v.seller), "Die AGB der Kevser Fleischerei finden Sie im Anhang bzw. unten in dieser E-Mail."];
      return {
        subject: `Halal Fresh ${no}`,
        email: body(t.created, [`${t.estimated}: ${m(v.estimatedTotalCents)}`, `${t.max}: ${m(v.maxTotalCents)}`, t.weighNote, ""]) + "\n" + legal.join("\n"),
        sms: `Halal Fresh ${no}: ${t.created} ${v.link}`,
      };
    }
    case "accepted":
      return { subject: `Halal Fresh ${no}`, email: body(t.accepted), sms: `Halal Fresh ${no}: ${t.accepted} ${v.link}` };
    case "weighed":
    case "weight_corrected": {
      const intro = key === "weighed" ? t.weighed : t.corrected;
      const cap = v.cappedAmountCents ? [] : [];
      return {
        subject: `Halal Fresh ${no}: ${t.final} ${v.finalTotalCents != null ? m(v.finalTotalCents) : ""}`,
        email: body(intro, [`${t.final}: ${v.finalTotalCents != null ? m(v.finalTotalCents) : ""}`, payLine(), ...cap, ""]),
        sms: `Halal Fresh ${no}: ${t.final} ${v.finalTotalCents != null ? m(v.finalTotalCents) : ""}. ${v.link}`,
      };
    }
    case "out_for_delivery":
      return { subject: `Halal Fresh ${no}`, email: body(t.ofd), sms: `Halal Fresh ${no}: ${t.ofd}` };
    case "cancelled":
      return {
        subject: `Halal Fresh ${no}`,
        email: body(t.cancelled, v.cancelReason ? [`${t.reason}: ${v.cancelReason}`, ""] : []),
        sms: `Halal Fresh ${no}: ${t.cancelled}`,
      };
    case "payment_overdue":
      return {
        subject: `Halal Fresh ${no}: ${t.final}`,
        email: body(t.overdue, [payLine(), ""]),
        sms: `Halal Fresh ${no}: ${t.overdue} ${v.link}`,
      };
  }
}
