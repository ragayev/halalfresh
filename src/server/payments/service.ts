import { Prisma, type Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { siteUrl } from "@/lib/env";
import { orderNumberLabel } from "@/domain/order-state";
import { AppError } from "../errors";
import { transitionOrder } from "../orders";
import { notifyAdmin } from "../notifications/notify";
import { getProvider } from "./provider";

const PAYABLE = ["WEIGHED", "PAYMENT_OVERDUE"] as const;

/**
 * "Pay with PayPal" click. Creates the PayPal order for exactly the final amount, or reuses the open one for
 * the same amount. Orders created for an older amount are never reused (see recordWeights).
 */
/** PayPal's hosted approval page (redirect flow: no PayPal script runs on our order page). */
export function approveUrlFrom(raw: unknown): string | null {
  const links = (raw as { links?: { rel?: string; href?: string }[] } | null)?.links ?? [];
  return links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}

export async function startPayment(token: string): Promise<{ providerOrderId: string; paymentId: string; approveUrl: string | null }> {
  const order = await db.order.findUnique({ where: { publicToken: token }, include: { items: true, merchant: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (order.paymentMethod !== "PAYPAL" || !(PAYABLE as readonly string[]).includes(order.status) || order.finalTotalCents == null)
    throw new AppError("NOT_PAYABLE", "This order cannot be paid right now", 409);
  const amount = order.finalTotalCents;

  const open = await db.payment.findFirst({
    where: { orderId: order.id, amountCents: amount, status: { in: ["CREATED", "APPROVED", "PENDING"] }, providerOrderId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (open?.providerOrderId) return { providerOrderId: open.providerOrderId, paymentId: open.id, approveUrl: approveUrlFrom(open.raw) };

  const provider = await getProvider();
  const attempt = await db.payment.count({ where: { orderId: order.id, amountCents: amount } });
  const idempotencyKey = `create_${order.id}_${amount}_${attempt}`;
  const label = orderNumberLabel(order.number);
  const base = `${siteUrl()}/${order.locale}/b/${token}`;
  const lines = order.items
    .filter((i) => (i.finalCents ?? 0) > 0)
    .map((i) => ({ name: `${i.productName} ${((i.actualGrams ?? 0) / 1000).toFixed(2)} kg`, amountCents: i.finalCents! }));
  if (order.deliveryFeeCents > 0) lines.push({ name: "Lieferung", amountCents: order.deliveryFeeCents });
  const created = await provider.createOrder({
    amountCents: amount,
    requestId: idempotencyKey,
    orderNumberLabel: label,
    sellerName: order.merchant.legalName ?? order.merchant.name,
    lines,
    returnUrl: base,
    cancelUrl: base,
  });
  const p = await db.payment.create({
    data: { orderId: order.id, provider: provider.name, providerOrderId: created.providerOrderId, amountCents: amount, idempotencyKey, raw: created.raw as Prisma.InputJsonValue },
  });
  return { providerOrderId: created.providerOrderId, paymentId: p.id, approveUrl: approveUrlFrom(created.raw) };
}

/** Marks the payment captured and the order PAID. Safe to call any number of times, from any source. */
export async function applyCaptureCompleted(providerOrderId: string, captureId: string | null, amountCents: number | null, source: "capture" | "webhook", raw?: unknown) {
  const payment = await db.payment.findUnique({ where: { providerOrderId } });
  if (!payment) {
    log.warn("payment.capture_unknown_order", { providerOrderId });
    return { applied: false as const, reason: "unknown_payment" };
  }
  const paid = amountCents ?? payment.amountCents;
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (fresh.status === "COMPLETED") return "duplicate" as const;
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "COMPLETED", providerCaptureId: captureId ?? fresh.providerCaptureId, ...(raw !== undefined ? { raw: raw as Prisma.InputJsonValue } : {}) },
    });
    return "recorded" as const;
  });
  if (outcome === "duplicate") return { applied: false as const, reason: "duplicate" };

  const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  if ((PAYABLE as readonly string[]).includes(order.status) && order.finalTotalCents === paid) {
    await transitionOrder(order.id, "PAID", { actor: source === "webhook" ? "webhook" : "system", reason: "paypal_capture", metadata: { providerOrderId, captureId, amountCents: paid, source }, patch: { paidAmountCents: paid }, idempotentIfAt: true });
    return { applied: true as const, reason: "paid" };
  }
  // Money arrived but the order cannot take it (cancelled, re-weighed, different amount): record it loudly for the admin.
  log.error("payment.captured_but_order_not_payable", { orderId: order.id, status: order.status, paid, expected: order.finalTotalCents });
  await db.orderEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: order.status, actor: "webhook", reason: "payment_unmatched", metadata: { providerOrderId, captureId, paidCents: paid, finalTotalCents: order.finalTotalCents } } });
  await db.order.update({ where: { id: order.id }, data: { paidAmountCents: paid } });
  await notifyAdmin(order.id, "payment_failed");
  return { applied: false as const, reason: "unmatched" };
}

/** Customer returned from PayPal: capture server-side. COMPLETED -> PAID now; PENDING waits for the webhook. */
export async function captureForOrder(token: string, providerOrderId: string) {
  const order = await db.order.findUnique({ where: { publicToken: token } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  const payment = await db.payment.findUnique({ where: { providerOrderId } });
  if (!payment || payment.orderId !== order.id) throw new AppError("NOT_FOUND", "Payment not found", 404);
  if (payment.status === "COMPLETED") return { status: "COMPLETED" as const };
  if (payment.status === "VOIDED") throw new AppError("NOT_PAYABLE", "This payment is no longer valid; please reload the page", 409);
  if (payment.amountCents !== order.finalTotalCents) throw new AppError("NOT_PAYABLE", "The amount changed; please reload the page", 409);

  const provider = await getProvider();
  const res = await provider.captureOrder(providerOrderId, `capture_${payment.id}`);
  if (res.status === "COMPLETED") {
    await applyCaptureCompleted(providerOrderId, res.captureId, res.amountCents, "capture", res.raw);
    return { status: "COMPLETED" as const };
  }
  await db.payment.update({ where: { id: payment.id }, data: { status: res.status === "PENDING" ? "PENDING" : "DENIED", raw: res.raw as Prisma.InputJsonValue } });
  if (res.status === "DECLINED") throw new AppError("PAYMENT_ERROR", "PayPal declined the payment", 402);
  return { status: "PENDING" as const };
}

interface PayPalEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: { value?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
    purchase_units?: { payments?: { captures?: { id?: string }[] } }[];
  };
}

const cents = (v?: string) => (v == null ? null : Math.round(Number(v) * 100));

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "invalid";

/** Verifies, de-duplicates (by PayPal event id) and processes a webhook. Duplicate/out-of-order events are no-ops. */
export async function processWebhook(headers: Headers, rawBody: string): Promise<WebhookOutcome> {
  const provider = await getProvider();
  if (!(await provider.verifyWebhook(headers, rawBody))) return "invalid";
  const event = JSON.parse(rawBody) as PayPalEvent;
  if (!event.id || !event.event_type) return "ignored";
  try {
    await db.processedWebhookEvent.create({ data: { id: event.id, type: event.event_type } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
  try {
    await dispatch(event);
    return "processed";
  } catch (e) {
    // Let PayPal retry: forget the event so the retry is not treated as a duplicate.
    await db.processedWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    throw e;
  }
}

async function paymentFor(event: PayPalEvent): Promise<Payment | null> {
  const r = event.resource;
  const orderId = r?.supplementary_data?.related_ids?.order_id ?? (event.event_type.startsWith("CHECKOUT.ORDER") ? r?.id : undefined);
  if (orderId) return db.payment.findUnique({ where: { providerOrderId: orderId } });
  if (r?.id) return db.payment.findUnique({ where: { providerCaptureId: r.id } });
  return null;
}

async function dispatch(event: PayPalEvent) {
  const r = event.resource;
  const payment = await paymentFor(event);
  if (!payment || !payment.providerOrderId) {
    log.warn("webhook.unknown_payment", { type: event.event_type });
    return;
  }
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      await applyCaptureCompleted(payment.providerOrderId, r?.id ?? null, cents(r?.amount?.value), "webhook", event);
      return;
    case "PAYMENT.CAPTURE.PENDING":
      if (payment.status !== "COMPLETED") await db.payment.update({ where: { id: payment.id }, data: { status: "PENDING", providerCaptureId: r?.id ?? payment.providerCaptureId } });
      return;
    case "PAYMENT.CAPTURE.DENIED":
      // Never downgrade a completed payment on an out-of-order event.
      if (payment.status !== "COMPLETED") {
        await db.payment.update({ where: { id: payment.id }, data: { status: "DENIED" } });
        await notifyAdmin(payment.orderId, "payment_failed");
      }
      return;
    case "PAYMENT.CAPTURE.REFUNDED": {
      const amt = cents(r?.amount?.value) ?? 0;
      await db.$transaction([
        db.order.update({ where: { id: payment.orderId }, data: { refundedCents: { increment: amt } } }),
        db.orderEvent.create({ data: { orderId: payment.orderId, actor: "webhook", reason: "refunded", metadata: { amountCents: amt, eventId: event.id } } }),
      ]);
      return;
    }
    case "CHECKOUT.ORDER.APPROVED": {
      // Customer approved but our onApprove call never arrived (closed tab): capture here.
      if (payment.status === "COMPLETED" || payment.status === "VOIDED") return;
      const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      if (payment.amountCents !== order.finalTotalCents || !(PAYABLE as readonly string[]).includes(order.status)) return;
      const res = await (await getProvider()).captureOrder(payment.providerOrderId, `capture_${payment.id}`);
      if (res.status === "COMPLETED") await applyCaptureCompleted(payment.providerOrderId, res.captureId, res.amountCents, "webhook", res.raw);
      else await db.payment.update({ where: { id: payment.id }, data: { status: "PENDING" } });
      return;
    }
    default:
      return;
  }
}
