import nodemailer, { type Transporter } from "nodemailer";
import { log } from "@/lib/logger";
import { formatMoney } from "@/domain/money";
import { formatWeight } from "@/domain/pricing";
import { deliveryLabel } from "@/domain/whatsapp";
import { siteUrl } from "@/lib/env";
import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";

let transport: Transporter | null = null;

async function send(to: string, subject: string, text: string) {
  const url = process.env.SMTP_URL;
  if (!url) {
    log.info("email.skipped_no_smtp", { subject });
    return;
  }
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Halal Fresh <orders@halalfresh.app>",
    to,
    subject,
    text,
  });
}

const STATUS_NOTIFY = new Set(["CONFIRMED_BY_BUTCHER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);

export async function sendOrderEmail(orderId: string, kind: "confirmation" | "status") {
  try {
    const o = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true, address: true, merchant: true },
    });
    if (!o) return;
    if (kind === "status" && !STATUS_NOTIFY.has(o.fulfillmentStatus)) return;
    const locale = (["en", "de", "tr"].includes(o.locale) ? o.locale : "en") as Locale;
    const d = await getDictionary(locale);
    const link = `${siteUrl()}/${locale}/order/${o.accessToken}`;
    const items = o.items
      .map((i) => `- ${i.productName} — ${formatWeight(i.quantityGrams)} — ${formatMoney(i.lineTotalCents, locale)}`)
      .join("\n");
    const when = deliveryLabel(o.deliveryDate.toISOString().slice(0, 10), o.slotStartTime, o.slotEndTime, locale);
    const head =
      kind === "confirmation"
        ? d.email.confirmationIntro
        : (d.email.statusIntro as string).replace("{status}", d.fulfillment[o.fulfillmentStatus]);
    const subject = kind === "confirmation" ? `${d.email.confirmationSubject} #HF-${o.number}` : `${d.email.statusSubject} #HF-${o.number}`;
    const body = [
      `${d.email.hello} ${o.customer.name},`,
      "",
      head,
      "",
      `${d.email.order}: #HF-${o.number}`,
      items,
      "",
      `${d.email.total}: ${formatMoney(o.totalCents, locale)}`,
      `${d.email.delivery}: ${when}`,
      `${o.address.street}, ${o.address.postalCode} ${o.address.city}`,
      "",
      `${d.email.seller}: ${o.merchant.legalName ?? o.merchant.name}`,
      "",
      `${d.email.viewOrder}: ${link}`,
    ].join("\n");
    await send(o.customer.email, subject, body);
  } catch (e) {
    log.error("email.failed", { orderId, error: e });
  }
}
