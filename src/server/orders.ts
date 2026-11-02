import type { FulfillmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canAuthorizeEarlyFulfillment, fulfillmentGate, fulfillmentMoveAllowed } from "@/domain/order-state";
import { buildWhatsappMessage, normalizeWhatsappNumber, whatsappLink } from "@/domain/whatsapp";
import { AppError } from "./errors";
import { getGateway } from "./payments/gateway";
import { applyRefund } from "./payments/webhook";
import { sendOrderEmail } from "./email";

export async function audit(
  actor: string,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Prisma.InputJsonValue,
  client: Prisma.TransactionClient = db,
) {
  await client.auditLog.create({
    data: { actor, action, entity, entityId, detail },
  });
}

export async function getOrderByToken(token: string) {
  if (!token || token.length < 20) return null;
  // Guest tracking link: expose only what the order page renders. Internal notes, staff identities, Stripe ids,
  // the customer's phone and the access token itself never leave the server through this query.
  return db.order.findUnique({
    where: { accessToken: token },
    omit: {
      accessToken: true,
      adminNotes: true,
      forwardedBy: true,
      earlyFulfillmentAuthorizedBy: true,
      requestId: true,
      commissionBps: true,
      applicationFeeCents: true,
    },
    include: {
      items: true,
      address: { select: { street: true, postalCode: true, city: true } },
      customer: { select: { name: true, email: true } },
      merchant: { select: { name: true, legalName: true, contactEmail: true, contactPhone: true } },
    },
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

/**
 * Moves the fulfillment status. The status change, its history event and the audit row commit together or not at all.
 * Payment is checked via the fulfillment policy (see domain/order-state.ts), never assumed to be "paid".
 */
export async function transitionFulfillment(orderId: string, to: FulfillmentStatus, actor: string) {
  // Cancellation also settles money (refund / expiring the checkout), so it has exactly one code path.
  if (to === "CANCELLED") return cancelOrder(orderId, actor);
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  const allowed = fulfillmentMoveAllowed(order, to);
  if (!allowed.ok) throw new AppError("CONFLICT", allowed.reason, 409);
  await db.$transaction(async (tx) => {
    // Compare-and-set on BOTH statuses protects against two admins clicking at once and against a payment webhook
    // changing the payment state between our check and the write.
    const res = await tx.order.updateMany({
      where: { id: orderId, fulfillmentStatus: order.fulfillmentStatus, paymentStatus: order.paymentStatus },
      data: {
        fulfillmentStatus: to,
        ...(to === "FORWARDED" ? { forwardedAt: new Date(), forwardedBy: actor } : {}),
        ...(to === "AWAITING_FORWARDING" ? { forwardedAt: null, forwardedBy: null } : {}),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "Order was changed by someone else. Reload and retry.", 409);
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "FULFILLMENT",
        fromStatus: order.fulfillmentStatus,
        toStatus: to,
        actor,
        note:
          fulfillmentGate(order) === "EARLY_AUTHORIZED" ? "Fulfilled on SEPA collection risk (early authorization)" : undefined,
      },
    });
    await audit(actor, "order.fulfillment", "Order", orderId, { from: order.fulfillmentStatus, to }, tx);
  });
  await sendOrderEmail(orderId, { kind: "status", status: to });
}

/**
 * Explicit, audited acceptance of the SEPA collection risk. Does not mark anything paid and does not move the order;
 * it only lifts the payment block so the admin can forward and fulfil. `acknowledged` must be literally true.
 */
export async function authorizeEarlyFulfillment(orderId: string, actor: string, acknowledged: boolean) {
  if (acknowledged !== true) throw new AppError("VALIDATION", "You must acknowledge the collection risk", 422);
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  const can = canAuthorizeEarlyFulfillment(order);
  if (!can.ok) throw new AppError("CONFLICT", can.reason, 409);
  await db.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      // paymentStatus guard: if the debit settled or failed in the meantime, this authorization no longer applies.
      where: { id: orderId, paymentStatus: "PENDING_PAYMENT", earlyFulfillmentAuthorizedAt: null, sepaInitiatedAt: { not: null } },
      data: { earlyFulfillmentAuthorizedAt: new Date(), earlyFulfillmentAuthorizedBy: actor },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "Payment status changed. Reload and review.", 409);
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "EARLY_FULFILLMENT_AUTHORIZED",
        actor,
        note: `Risk acknowledged: fulfilment may proceed before SEPA settlement (${order.totalCents} cents). Halal Fresh bears no collection risk; the seller accepts it.`,
      },
    });
    await audit(actor, "order.early_fulfillment_authorized", "Order", orderId, { totalCents: order.totalCents }, tx);
  });
}

/** Builds the click-to-chat link; records that the admin opened it (NOT that it was sent). */
export async function prepareWhatsapp(orderId: string, actor: string) {
  const o = await getOrderForAdmin(orderId);
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (o.fulfillmentStatus === "CANCELLED") throw new AppError("CONFLICT", "Cancelled orders cannot be forwarded", 409);
  const gate = fulfillmentGate(o);
  if (gate !== "OPEN" && gate !== "EARLY_AUTHORIZED")
    throw new AppError(
      "CONFLICT",
      gate === "NEEDS_AUTHORIZATION"
        ? "SEPA payment is still processing. Authorize early fulfillment first or wait for settlement."
        : "Only paid or authorized orders can be forwarded",
      409,
    );
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
    sepaPendingAuthorized: gate === "EARLY_AUTHORIZED",
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

/**
 * Cancels an unpaid order (and its open checkout), or a paid one with a full refund.
 * A SEPA debit that is already processing cannot be stopped, so cancelling then would leave the customer charged on a
 * cancelled order; it has to wait for settlement (then it is refunded) or failure.
 */
export async function cancelOrder(orderId: string, actor: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (order.fulfillmentStatus === "DELIVERED") throw new AppError("CONFLICT", "Delivered orders cannot be cancelled", 409);
  if (order.fulfillmentStatus === "CANCELLED") throw new AppError("CONFLICT", "Order is already cancelled", 409);
  if (order.paymentStatus === "PENDING_PAYMENT" && order.sepaInitiatedAt)
    throw new AppError(
      "CONFLICT",
      "A SEPA debit is processing and cannot be stopped. Wait for it to settle (then cancel to refund) or fail.",
      409,
    );
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
  }
  const unpaid = order.paymentStatus === "PENDING_PAYMENT" || order.paymentStatus === "PAYMENT_FAILED";
  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: "CANCELLED", ...(unpaid ? { paymentStatus: "CANCELLED" } : {}) },
    });
    if (unpaid) await tx.payment.updateMany({ where: { orderId }, data: { status: "CANCELLED" } });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "FULFILLMENT",
        fromStatus: order.fulfillmentStatus,
        toStatus: "CANCELLED",
        actor,
      },
    });
    await audit(actor, "order.cancel", "Order", orderId, undefined, tx);
  });
  await sendOrderEmail(orderId, { kind: "status", status: "CANCELLED" });
}
