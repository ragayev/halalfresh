import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { canTransitionPayment, paymentStatusAfterRefunds } from "@/domain/order-state";
import { sendOrderEmail, sendPaymentFailureAlert } from "../email";
import { stripeClient } from "./stripe";

export type WebhookResult = "processed" | "duplicate" | "ignored";

type Tx = Prisma.TransactionClient;

type Effect =
  | { type: "ack"; orderId: string }
  | { type: "payment_received"; orderId: string }
  | { type: "payment_failed_alert"; orderId: string; reason: string };

interface PaidDetails {
  chargeId?: string;
  paymentIntentId?: string;
  balanceTransactionId?: string;
  stripeFeeCents?: number;
}

/**
 * Idempotent processor. The event id is inserted into the ledger inside the same transaction as the
 * state change: duplicates (even concurrent ones) hit the unique key and are dropped; a failure rolls
 * the ledger row back so Stripe's retry reprocesses the event.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  // Network lookups happen before the transaction to keep it short.
  const extra = await prefetch(event);
  let effects: Effect[] = [];

  try {
    await db.$transaction(async (tx) => {
      await tx.processedWebhookEvent.create({
        data: { id: event.id, type: event.type },
      });
      effects = await handle(tx, event, extra);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // The ledger insert is the only expected unique violation; if the event is already recorded it is a duplicate.
      const seen = await db.processedWebhookEvent.findUnique({
        where: { id: event.id },
      });
      if (seen) return "duplicate";
    }
    throw e;
  }
  // Side effects run after commit; each is individually de-duplicated (NotificationLog) and never throws.
  for (const fx of effects) {
    if (fx.type === "ack") await sendOrderEmail(fx.orderId, { kind: "ack" });
    else if (fx.type === "payment_received") await sendOrderEmail(fx.orderId, { kind: "payment_received" });
    else await sendPaymentFailureAlert(fx.orderId, fx.reason);
  }
  return "processed";
}

async function prefetch(event: Stripe.Event): Promise<PaidDetails> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return {};
  const s = event.data.object as Stripe.Checkout.Session;
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  const out: PaidDetails = { paymentIntentId: pi };
  if (!pi || !process.env.STRIPE_SECRET_KEY || s.id.startsWith("cs_mock_")) return out;
  try {
    const intent = await stripeClient().paymentIntents.retrieve(
      pi,
      { expand: ["latest_charge.balance_transaction"] },
      event.account ? { stripeAccount: event.account } : undefined,
    );
    const charge = intent.latest_charge as Stripe.Charge | null;
    if (charge && typeof charge !== "string") {
      out.chargeId = charge.id;
      const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
      if (bt && typeof bt !== "string") {
        out.balanceTransactionId = bt.id;
        // fee_details includes the application fee for the platform; the processing fee is the stripe_fee entry.
        out.stripeFeeCents = bt.fee_details.filter((f) => f.type === "stripe_fee").reduce((a, f) => a + f.amount, 0);
      }
    }
  } catch (e) {
    log.warn("webhook.fee_lookup_failed", { eventId: event.id, error: e });
  }
  return out;
}

async function handle(tx: Tx, event: Stripe.Event, extra: PaidDetails): Promise<Effect[]> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      // Settled immediately (cards, mock) vs. SEPA: the session completes when the mandate is accepted and the
      // debit is initiated, with payment_status "unpaid". That is authorization, NOT collected money.
      if (s.payment_status === "paid" || s.payment_status === "no_payment_required") return markPaid(tx, event, s, extra);
      return markInitiated(tx, event, s, extra);
    }
    case "checkout.session.async_payment_succeeded":
      return markPaid(tx, event, event.data.object as Stripe.Checkout.Session, extra);
    case "checkout.session.async_payment_failed":
      return markFailed(tx, (event.data.object as Stripe.Checkout.Session).id, "async_payment_failed");
    case "checkout.session.expired":
      await markExpired(tx, (event.data.object as Stripe.Checkout.Session).id);
      return [];
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      return markFailedByIntent(tx, pi.metadata?.orderId, pi.last_payment_error?.code ?? "payment_failed");
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      await applyRefund(tx, event.data.object as Stripe.Refund);
      return [];
    default:
      return [];
  }
}

async function findPayment(tx: Tx, sessionId: string) {
  return tx.payment.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
    include: { order: true },
  });
}

/** The event must come from our connected account and match the stored order/amount, or it needs manual review. */
async function verifiedPayment(tx: Tx, event: Stripe.Event, s: Stripe.Checkout.Session) {
  const payment = await findPayment(tx, s.id);
  if (!payment) {
    log.warn("webhook.unknown_session", { eventId: event.id, sessionId: s.id });
    return null;
  }
  const accountOk = (payment.connectedAccountId ?? null) === (event.account ?? null); // platform charges carry no account
  const metaOk = !s.metadata?.orderId || s.metadata.orderId === payment.orderId;
  const amountOk = s.amount_total === payment.amountCents && (s.currency ?? "eur").toLowerCase() === "eur";
  if (!accountOk || !metaOk || !amountOk) {
    log.error("webhook.session_mismatch", {
      eventId: event.id,
      orderId: payment.orderId,
      accountOk,
      metaOk,
      amountOk,
    });
    await tx.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: "PAYMENT_MISMATCH",
        actor: "stripe",
        note: "Webhook did not match order; needs manual review",
      },
    });
    return null;
  }
  return payment;
}

/**
 * SEPA: mandate accepted, debit initiated. Makes the order visible and actionable to the admin and lets us
 * acknowledge it to the customer, but the order is NOT paid until async_payment_succeeded.
 */
async function markInitiated(tx: Tx, event: Stripe.Event, s: Stripe.Checkout.Session, x: PaidDetails): Promise<Effect[]> {
  const payment = await verifiedPayment(tx, event, s);
  if (!payment) return [];
  const order = payment.order;
  // Out-of-order safety: never regress a settled/failed/cancelled order, never repeat the initiation.
  if (order.paymentStatus !== "PENDING_PAYMENT" || order.sepaInitiatedAt) return [];
  await tx.payment.update({
    where: { id: payment.id },
    data: { stripePaymentIntentId: x.paymentIntentId ?? payment.stripePaymentIntentId },
  });
  await tx.order.update({ where: { id: order.id }, data: { sepaInitiatedAt: new Date() } });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: "PAYMENT_PROCESSING",
      fromStatus: "PENDING_PAYMENT",
      toStatus: "PENDING_PAYMENT",
      actor: "stripe",
      note: "SEPA mandate accepted, debit initiated. Money not yet collected.",
    },
  });
  return [{ type: "ack", orderId: order.id }];
}

async function markPaid(tx: Tx, event: Stripe.Event, s: Stripe.Checkout.Session, x: PaidDetails): Promise<Effect[]> {
  const payment = await verifiedPayment(tx, event, s);
  if (!payment) return [];
  if (payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED") return []; // already applied

  const now = new Date();
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      paidAt: now,
      failureReason: null,
      stripePaymentIntentId: x.paymentIntentId ?? payment.stripePaymentIntentId,
      stripeChargeId: x.chargeId ?? payment.stripeChargeId,
      balanceTransactionId: x.balanceTransactionId ?? payment.balanceTransactionId,
      stripeFeeCents: x.stripeFeeCents ?? payment.stripeFeeCents,
    },
  });
  if (!canTransitionPayment(payment.order.paymentStatus, "PAID")) return [];
  const wasCancelled = payment.order.fulfillmentStatus === "CANCELLED";
  await tx.order.update({
    where: { id: payment.orderId },
    // A late success after we cancelled on expiry: money was taken, so the order is live again.
    data: {
      paymentStatus: "PAID",
      paidAt: now,
      ...(wasCancelled ? { fulfillmentStatus: "AWAITING_FORWARDING" } : {}),
    },
  });
  await tx.orderEvent.create({
    data: {
      orderId: payment.orderId,
      type: "PAYMENT_PAID",
      fromStatus: payment.order.paymentStatus,
      toStatus: "PAID",
      actor: "stripe",
    },
  });
  return [{ type: "payment_received", orderId: payment.orderId }];
}

async function markFailed(tx: Tx, sessionId: string, reason: string): Promise<Effect[]> {
  const payment = await findPayment(tx, sessionId);
  if (!payment) return [];
  return setFailed(tx, payment, reason);
}

async function markFailedByIntent(tx: Tx, orderId: string | undefined, reason: string): Promise<Effect[]> {
  // The intent id is only stored once the session completes, so failures are matched via our order metadata.
  if (!orderId) return [];
  const payment = await tx.payment.findFirst({
    where: { orderId },
    include: { order: true },
  });
  return payment ? setFailed(tx, payment, reason) : [];
}

async function setFailed(tx: Tx, payment: NonNullable<Awaited<ReturnType<typeof findPayment>>>, reason: string): Promise<Effect[]> {
  if (!canTransitionPayment(payment.order.paymentStatus, "PAYMENT_FAILED") || payment.order.paymentStatus === "PAYMENT_FAILED") {
    return []; // e.g. already PAID: late failure events never downgrade
  }
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "PAYMENT_FAILED", failureReason: reason },
  });
  await tx.order.update({
    where: { id: payment.orderId },
    data: { paymentStatus: "PAYMENT_FAILED" },
  });
  await tx.orderEvent.create({
    data: {
      orderId: payment.orderId,
      type: "PAYMENT_FAILED",
      fromStatus: payment.order.paymentStatus,
      toStatus: "PAYMENT_FAILED",
      actor: "stripe",
      note: payment.order.fulfillmentStatus === "AWAITING_FORWARDING" ? reason : `${reason} (fulfillment was ${payment.order.fulfillmentStatus})`,
    },
  });
  // Only a failure of an already-authorized SEPA debit needs an alert: before the mandate the customer is still
  // on the Stripe page and may retry. Alerts are deduplicated per order.
  return payment.order.sepaInitiatedAt ? [{ type: "payment_failed_alert", orderId: payment.orderId, reason }] : [];
}

async function markExpired(tx: Tx, sessionId: string) {
  const payment = await findPayment(tx, sessionId);
  if (!payment) return;
  const st = payment.order.paymentStatus;
  if (st !== "PENDING_PAYMENT" && st !== "PAYMENT_FAILED") return; // paid orders ignore late expiry
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "CANCELLED" },
  });
  await tx.order.update({
    where: { id: payment.orderId },
    data: { paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED" },
  });
  await tx.orderEvent.create({
    data: {
      orderId: payment.orderId,
      type: "PAYMENT_CANCELLED",
      fromStatus: st,
      toStatus: "CANCELLED",
      actor: "stripe",
      note: "Checkout session expired",
    },
  });
}

/** Idempotent: upserts the refund, then recomputes order/payment from the sum of refunds. */
export async function applyRefund(
  tx: Tx,
  r:
    | Stripe.Refund
    | {
        id: string;
        amount: number;
        status: string | null;
        payment_intent: string | { id: string } | null;
        reason?: string | null;
        metadata?: Record<string, string> | null;
      },
) {
  const piId = typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id;
  const payment = piId
    ? await tx.payment.findUnique({
        where: { stripePaymentIntentId: piId },
        include: { order: true },
      })
    : null;
  // Out-of-order: refund arrived before the payment was recorded. Throwing rolls back the ledger row so Stripe retries.
  if (!payment) throw new Error(`refund ${r.id}: payment not yet recorded`);
  const status = r.status ?? "pending";
  await tx.refund.upsert({
    where: { stripeRefundId: r.id },
    create: {
      paymentId: payment.id,
      stripeRefundId: r.id,
      amountCents: r.amount,
      reason: r.reason ?? null,
      status,
    },
    update: { status, amountCents: r.amount },
  });
  const all = await tx.refund.findMany({
    where: { paymentId: payment.id, status: { in: ["succeeded", "pending"] } },
  });
  const refunded = all.reduce((a, x) => a + x.amountCents, 0);
  const order = payment.order;
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED" || order.paymentStatus === "REFUNDED") {
    const next = paymentStatusAfterRefunds(order.totalCents, refunded);
    await tx.order.update({
      where: { id: order.id },
      data: { refundedCents: refunded, paymentStatus: next },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: next },
    });
    if (next !== order.paymentStatus) {
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "REFUND",
          fromStatus: order.paymentStatus,
          toStatus: next,
          actor: "stripe",
          note: `Refunded ${refunded} cents total`,
        },
      });
    }
  }
}
