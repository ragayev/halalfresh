import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { siteUrl } from "@/lib/env";
import { deliveryLabel } from "@/domain/whatsapp";
import { orderNumberLabel } from "@/domain/order-state";
import { formatMoney } from "@/domain/money";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/config";
import { getSetting } from "../app-settings";
import { sendEmail, sendSms, sendTelegram, type EmailAttachment, type SendResult } from "./channels";
import { renderTemplate, type TemplateKey, type TemplateVars } from "./templates";

type Channel = "email" | "sms" | "telegram";

async function logged(orderId: string, channel: Channel, template: string, recipient: string, run: () => Promise<SendResult>) {
  const row = await db.notification.create({ data: { orderId, channel, template, recipient, status: "pending" } });
  try {
    const r = await run();
    await db.notification.update({ where: { id: row.id }, data: { status: r.status, providerMessageId: r.providerMessageId } });
  } catch (e) {
    log.error("notification.failed", { orderId, channel, template, error: e });
    await db.notification.update({ where: { id: row.id }, data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "error" } });
  }
}

async function alreadySent(orderId: string, channel: Channel, template: string) {
  return (await db.notification.count({ where: { orderId, channel, template, status: { in: ["pending", "sent", "skipped"] } } })) > 0;
}

async function agbAttachment(): Promise<EmailAttachment[]> {
  const path = process.env.AGB_PDF_PATH;
  if (!path) return [];
  try {
    return [{ filename: "AGB-Kevser-Fleischerei.pdf", content: await readFile(path), contentType: "application/pdf" }];
  } catch (e) {
    log.error("notification.agb_pdf_unreadable", { error: e });
    return [];
  }
}

export async function loadVars(orderId: string): Promise<TemplateVars> {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, customer: true, merchant: true } });
  const locale = isLocale(o.locale) ? o.locale : DEFAULT_LOCALE;
  const m = o.merchant;
  return {
    locale,
    number: o.number,
    firstName: o.customer.firstName,
    link: `${siteUrl()}/${locale}/b/${o.publicToken}`,
    paymentMethod: o.paymentMethod,
    estimatedTotalCents: o.estimatedTotalCents,
    maxTotalCents: o.maxTotalCents,
    finalTotalCents: o.finalTotalCents,
    cappedAmountCents: o.cappedAmountCents,
    deliveryLabel: deliveryLabel(o.deliveryDate.toISOString().slice(0, 10), o.slotStartTime, o.slotEndTime, locale === "tr" ? "tr-TR" : "de-DE"),
    address: `${o.street}, ${o.postalCode} ${o.city}`,
    items: o.items.map((i) => ({
      name: i.productName,
      requestedGrams: i.requestedGrams,
      actualGrams: i.actualGrams,
      finalCents: i.finalCents,
      estimatedCents: i.estimatedCents,
    })),
    seller: {
      name: m.legalName ?? m.name,
      address: [m.addressLine, [m.postalCode, m.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      phone: m.contactPhone ?? "",
      email: m.contactEmail ?? "",
    },
    cancelReason: o.cancelReason,
  };
}

const CUSTOMER_CHANNELS: Record<TemplateKey, { email: boolean; sms: boolean }> = {
  order_created: { email: true, sms: true },
  accepted: { email: true, sms: true },
  weighed: { email: true, sms: true },
  weight_corrected: { email: true, sms: true },
  out_for_delivery: { email: false, sms: true },
  cancelled: { email: true, sms: true },
  payment_overdue: { email: true, sms: true },
};

/**
 * Sends the customer notification for `template` on the channels the matrix allows (spec §8.2).
 * Automatic sends are de-duplicated per (order, channel, template); `force` re-sends (admin "resend", weight correction).
 * Never throws: a failed provider must not undo an order transition.
 */
export async function notifyCustomer(orderId: string, template: TemplateKey, opts: { force?: boolean } = {}) {
  try {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
    const v = await loadVars(orderId);
    const r = renderTemplate(template, v);
    const ch = CUSTOMER_CHANNELS[template];
    if (ch.email && (opts.force || !(await alreadySent(orderId, "email", template)))) {
      const attachments = template === "order_created" ? await agbAttachment() : [];
      await logged(orderId, "email", template, o.customer.email, () => sendEmail(o.customer.email, r.subject, r.email, attachments));
    }
    if (ch.sms && r.sms && (opts.force || !(await alreadySent(orderId, "sms", template)))) {
      await logged(orderId, "sms", template, o.customer.phoneE164, () => sendSms(o.customer.phoneE164, r.sms!));
    }
  } catch (e) {
    log.error("notifyCustomer.failed", { orderId, template, error: e });
  }
}

/** Admin ping with a deep link to the admin order page: Telegram if configured, else email to ADMIN_ALERT_EMAIL / admins. */
export async function notifyAdmin(orderId: string, event: "new_order" | "paid" | "payment_failed") {
  try {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
    const no = orderNumberLabel(o.number);
    const label = event === "new_order" ? `Neue Bestellung ${no} · ca. ${formatMoney(o.estimatedTotalCents, "de")}` : event === "paid" ? `Bezahlt: ${no} · ${formatMoney(o.paidAmountCents ?? 0, "de")}` : `Zahlung fehlgeschlagen: ${no}`;
    const text = `${label}\n${siteUrl()}/admin/orders/${o.id}`;
    const chatId = process.env.TELEGRAM_CHAT_ID || (await getSetting("telegramChatId"));
    if (process.env.TELEGRAM_BOT_TOKEN && chatId) {
      if (await alreadySent(orderId, "telegram", `admin_${event}`)) return;
      await logged(orderId, "telegram", `admin_${event}`, String(chatId), () => sendTelegram(String(chatId), text));
      return;
    }
    const to =
      process.env.ADMIN_ALERT_EMAIL?.split(",").map((x) => x.trim()).filter(Boolean) ??
      (await db.adminUser.findMany({ select: { email: true } })).map((a) => a.email);
    if (await alreadySent(orderId, "email", `admin_${event}`)) return;
    for (const addr of to) await logged(orderId, "email", `admin_${event}`, addr, () => sendEmail(addr, label, text));
  } catch (e) {
    log.error("notifyAdmin.failed", { orderId, event, error: e });
  }
}
