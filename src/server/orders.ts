import type { FulfillmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canTransitionFulfillment } from "@/domain/order-state";
import { buildWhatsappMessage, normalizeWhatsappNumber, whatsappLink } from "@/domain/whatsapp";
import { AppError } from "./errors";
import { getGateway } from "./payments/gateway";
import { applyRefund } from "./payments/webhook";
import { sendOrderEmail } from "./email";

export async function audit(actor: string, action: string, entity?: string, entityId?: string, detail?: Prisma.InputJsonValue) {
  await db.auditLog.create({
    data: { actor, action, entity, entityId, detail },
  });
}

export async function getOrderByToken(token: string) {
  if (!token || token.length < 20) return null;
  return db.order.findUnique({
    where: { accessToken: token },
    include: { items: true, address: true, customer: true, merchant: true },
  });
}

export async function getOrderForAdmin(id: string) {
  return db.order.findUnique({
    where: { id },
    include: {
      items: true,
      address: true,
      customer: true,
      merchant: true,
      payments: { include: { refunds: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function transitionFulfillment(orderId: string, to: FulfillmentStatus, actor: string) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (order.paymentStatus === "PENDING_PAYMENT" || order.paymentStatus === "PAYMENT_FAILED") {
    throw new AppError("CONFLICT", "Order is not paid yet", 409);
  }
  if (!canTransitionFulfillment(order.fulfillmentStatus, to)) {
    throw new AppError("CONFLICT", `Cannot move from ${order.fulfillmentStatus} to ${to}`, 409);
  }
  // Compare-and-set protects against two admins clicking at once.
  const res = await db.order.updateMany({
    where: { id: orderId, fulfillmentStatus: order.fulfillmentStatus },
    data: {
      fulfillmentStatus: to,
      ...(to === "FORWARDED" ? { forwardedAt: new Date(), forwardedBy: actor } : {}),
      ...(to === "AWAITING_FORWARDING" ? { forwardedAt: null, forwardedBy: null } : {}),
    },
  });
  if (res.count !== 1) throw new AppError("CONFLICT", "Order was changed by someone else. Reload and retry.", 409);
  await db.orderEvent.create({
    data: {
      orderId,
      type: "FULFILLMENT",
      fromStatus: order.fulfillmentStatus,
      toStatus: to,
      actor,
    },
  });
  await audit(actor, "order.fulfillment", "Order", orderId, {
    from: order.fulfillmentStatus,
    to,
  });
  await sendOrderEmail(orderId, "status");
}

/** Builds the click-to-chat link; records that the admin opened it (NOT that it was sent). */
export async function prepareWhatsapp(orderId: string, actor: string) {
  const o = await getOrderForAdmin(orderId);
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (o.paymentStatus !== "PAID" && o.paymentStatus !== "PARTIALLY_REFUNDED")
    throw new AppError("CONFLICT", "Only paid orders can be forwarded", 409);
  const number = o.merchant.whatsappNumber ? normalizeWhatsappNumber(o.merchant.whatsappNumber) : null;
  if (!number) throw new AppError("VALIDATION", "Butcher WhatsApp number is not configured (Admin → Merchant)", 422);
  const message = buildWhatsappMessage({
    number: o.number,
    customerName: o.customer.name,
    phone: o.customer.phone,
    street: o.address.street,
    postalCode: o.address.postalCode,
    city: o.address.city,
    items: o.items,
    totalCents: o.totalCents,
    paymentStatus: o.paymentStatus,
    deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
    slotStartTime: o.slotStartTime,
    slotEndTime: o.slotEndTime,
    deliveryInstructions: o.deliveryInstructions,
  });
  await db.order.update({
    where: { id: orderId },
    data: {
      whatsappOpenCount: { increment: 1 },
      lastWhatsappOpenAt: new Date(),
    },
  });
  await db.orderEvent.create({
    data: {
      orderId,
      type: "WHATSAPP_OPENED",
      actor,
      note: "Message prepared (not confirmed as sent)",
    },
  });
  await audit(actor, "order.whatsapp_opened", "Order", orderId);
  return { url: whatsappLink(number, message), message };
}

export async function addNote(orderId: string, note: string, actor: string) {
  await db.order.update({
    where: { id: orderId },
    data: { adminNotes: note.slice(0, 4000) },
  });
  await db.orderEvent.create({
    data: { orderId, type: "NOTE", actor, note: "Internal note updated" },
  });
}

export async function refundOrder(orderId: string, amountCents: number, opts: { actor: string; reason?: string }) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  const payment = order.payments.find((p) => p.status === "PAID" || p.status === "PARTIALLY_REFUNDED");
  if (!payment?.stripePaymentIntentId) throw new AppError("CONFLICT", "Order has no captured payment to refund", 409);
  const remaining = order.totalCents - order.refundedCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining)
    throw new AppError("VALIDATION", "Invalid refund amount", 400, {
      remaining,
    });

  const gw = await getGateway();
  // Idempotency key includes the refunded-so-far so a retry of the same click is safe but a second refund is allowed.
  const res = await gw.refund({
    paymentIntentId: payment.stripePaymentIntentId,
    amountCents,
    connectedAccountId: payment.connectedAccountId,
    idempotencyKey: `refund_${order.id}_${order.refundedCents}_${amountCents}`,
  });
  await db.$transaction(async (tx) => {
    await applyRefund(tx, {
      id: res.refundId,
      amount: amountCents,
      status: res.status,
      payment_intent: payment.stripePaymentIntentId,
      reason: opts.reason ?? null,
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "REFUND_ISSUED",
        actor: opts.actor,
        note: `Refund ${amountCents} cents`,
      },
    });
  });
  await audit(opts.actor, "order.refund", "Order", orderId, {
    amountCents,
  });
}

/** Cancels an unpaid order (and its open checkout), or a paid one with a full refund. */
export async function cancelOrder(orderId: string, actor: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (order.fulfillmentStatus === "DELIVERED") throw new AppError("CONFLICT", "Delivered orders cannot be cancelled", 409);
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED") {
    const remaining = order.totalCents - order.refundedCents;
    if (remaining > 0)
      await refundOrder(orderId, remaining, {
        actor,
        reason: "requested_by_customer",
      });
  } else if (order.paymentStatus === "PENDING_PAYMENT" || order.paymentStatus === "PAYMENT_FAILED") {
    const p = order.payments[0];
    if (p?.stripeCheckoutSessionId) {
      try {
        await (await getGateway()).expireCheckout(p.stripeCheckoutSessionId, p.connectedAccountId);
      } catch {
        /* already expired/completed: webhook will reconcile */
      }
    }
    await db.order.update({
      where: { id: orderId },
      data: { paymentStatus: "CANCELLED" },
    });
    await db.payment.updateMany({
      where: { orderId },
      data: { status: "CANCELLED" },
    });
  }
  await db.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: "CANCELLED" },
  });
  await db.orderEvent.create({
    data: {
      orderId,
      type: "FULFILLMENT",
      fromStatus: order.fulfillmentStatus,
      toStatus: "CANCELLED",
      actor,
    },
  });
  await audit(actor, "order.cancel", "Order", orderId);
  await sendOrderEmail(orderId, "status");
}
