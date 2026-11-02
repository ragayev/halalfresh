import nodemailer, { type Transporter } from "nodemailer";
import { Prisma, type FulfillmentStatus } from "@prisma/client";
import { log } from "@/lib/logger";
import { formatMoney } from "@/domain/money";
import { orderItemLines } from "@/domain/bundles";
import { deliveryLabel } from "@/domain/whatsapp";
import { siteUrl } from "@/lib/env";
import { getDictionary } from "@/i18n/get-dictionary";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
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

const STATUS_NOTIFY = new Set<FulfillmentStatus>(["CONFIRMED_BY_BUTCHER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);

export type OrderEmailKind =
  | { kind: "ack" } // SEPA mandate accepted: order received, money NOT yet collected
  | { kind: "payment_received" } // payment settled
  | { kind: "status"; status: FulfillmentStatus };

const dedupeKey = (k: OrderEmailKind) => (k.kind === "status" ? `STATUS_${k.status}` : k.kind.toUpperCase());

/**
 * Durable at-most-once guard: the unique (orderId, kind) row is claimed BEFORE sending. A failed send releases
 * the claim so a later retry (webhook redelivery, next status change) can still notify the customer.
 */
async function claim(orderId: string, key: string): Promise<boolean> {
  try {
    await db.notificationLog.create({ data: { orderId, kind: key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}
const release = (orderId: string, key: string) => db.notificationLog.deleteMany({ where: { orderId, kind: key } }).catch(() => undefined);

export async function sendOrderEmail(orderId: string, what: OrderEmailKind) {
  const key = dedupeKey(what);
  let claimed = false;
  try {
    if (what.kind === "status" && !STATUS_NOTIFY.has(what.status)) return;
    if (!process.env.SMTP_URL) {
      log.info("email.skipped_no_smtp", { orderId, key });
      return;
    }
    const o = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true, address: true, merchant: true },
    });
    if (!o) return;
    claimed = await claim(orderId, key);
    if (!claimed) return; // already sent (or being sent) by another request
    const locale = (isLocale(o.locale) ? o.locale : DEFAULT_LOCALE) as Locale;
    const d = await getDictionary(locale);
    const link = `${siteUrl()}/${locale}/order/${o.accessToken}`;
    const items = o.items.flatMap((i) => orderItemLines(i, locale, ` — ${formatMoney(i.lineTotalCents, locale)}`)).join("\n");
    const when = deliveryLabel(o.deliveryDate.toISOString().slice(0, 10), o.slotStartTime, o.slotEndTime, locale);
    const head =
      what.kind === "ack"
        ? d.email.sepaAckIntro
        : what.kind === "payment_received"
          ? d.email.confirmationIntro
          : (d.email.statusIntro as string).replace("{status}", d.fulfillment[what.status]);
    const subjectBase = what.kind === "ack" ? d.email.sepaAckSubject : what.kind === "payment_received" ? d.email.confirmationSubject : d.email.statusSubject;
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
    await send(o.customer.email, `${subjectBase} #HF-${o.number}`, body);
  } catch (e) {
    if (claimed) await release(orderId, key);
    log.error("email.failed", { orderId, error: e });
  }
}

/** Where payment alerts go: ADMIN_ALERT_EMAIL, else every admin user. */
async function adminRecipients(): Promise<string[]> {
  const env = process.env.ADMIN_ALERT_EMAIL?.split(",").map((x) => x.trim()).filter(Boolean);
  if (env?.length) return env;
  return (await db.adminUser.findMany({ select: { email: true } })).map((a) => a.email);
}

/** Admin-only alert (English, no customer personal data beyond the order number). Deduplicated per order. */
export async function sendPaymentFailureAlert(orderId: string, reason: string) {
  const key = "ADMIN_PAYMENT_FAILED";
  let claimed = false;
  try {
    if (!process.env.SMTP_URL) {
      log.warn("email.admin_alert_skipped_no_smtp", { orderId });
      return;
    }
    const o = await db.order.findUnique({ where: { id: orderId } });
    if (!o) return;
    const to = await adminRecipients();
    if (!to.length) {
      log.warn("email.admin_alert_no_recipient", { orderId });
      return;
    }
    claimed = await claim(orderId, key);
    if (!claimed) return;
    const afterDelivery = o.fulfillmentStatus === "OUT_FOR_DELIVERY" || o.fulfillmentStatus === "DELIVERED";
    const body = [
      `SEPA payment FAILED for order #HF-${o.number} (${formatMoney(o.totalCents, "de")}).`,
      `Reason: ${reason}`,
      `Fulfillment status: ${o.fulfillmentStatus}${o.earlyFulfillmentAuthorizedAt ? " (early fulfillment was authorized)" : ""}`,
      afterDelivery ? "WARNING: goods were already out for delivery or delivered. The money was not collected." : "Do not prepare or deliver this order.",
      "",
      `${siteUrl()}/admin/orders/${o.id}`,
    ].join("\n");
    await send(to.join(","), `${afterDelivery ? "URGENT: " : ""}SEPA payment failed #HF-${o.number}`, body);
  } catch (e) {
    if (claimed) await release(orderId, key);
    log.error("email.admin_alert_failed", { orderId, error: e });
  }
}
