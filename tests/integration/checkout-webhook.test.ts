import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createCheckout } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { cancelOrder, getOrderByToken, prepareWhatsapp, refundOrder, transitionFulfillment } from "@/server/orders";
import { checkoutBody, postWebhook, resetDb, seedBasics, signedEvent } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
beforeAll(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
});

const code = async (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : String(e)),
  );

async function placeOrder(over = {}) {
  const { orderToken } = await createCheckout(checkoutBody(ctx, over));
  const order = (await db.order.findUnique({
    where: { accessToken: orderToken },
    include: { payments: true },
  }))!;
  return { order, payment: order.payments[0] };
}
const completed = (sessionId: string, orderId: string, amount: number, extra = {}) =>
  signedEvent("checkout.session.completed", {
    id: sessionId,
    object: "checkout.session",
    payment_status: "paid",
    amount_total: amount,
    currency: "eur",
    payment_intent: "pi_1",
    metadata: { orderId },
    ...extra,
  });

describe("checkout session creation", () => {
  it("creates a pending order with server-computed totals and an auto-assigned delivery estimate", async () => {
    const { order, payment } = await placeOrder();
    expect(order.paymentStatus).toBe("PENDING_PAYMENT");
    expect(order.subtotalCents).toBe(16000);
    expect(order.totalCents).toBe(16000);
    expect(order.applicationFeeCents).toBe(0); // commission is settled outside the platform
    expect(order.deliveryDate.toISOString().slice(0, 10) >= ctx.date).toBe(false); // earliest slot, sooner than the +5d test date
    expect(order.routeId).toBe(ctx.route.id);
    expect(order).toMatchObject({ zoneName: "Berlin", deliveryMode: "REGULAR", minOrderCents: 15000 });
    expect(order.slotStartTime).toBe("10:00");
    expect(order.slotEndTime).toBe("14:00");
    expect(payment.stripeCheckoutSessionId).toMatch(/^cs_mock_/);
    expect(payment.amountCents).toBe(16000);
    const items = await db.orderItem.findMany({ where: { orderId: order.id } });
    expect(items[0]).toMatchObject({
      productName: "Beef Cubes",
      unitPricePerKgCents: 2000,
      quantityGrams: 8000,
      lineTotalCents: 16000,
    });
  });
  it("rejects orders below the minimum (merchandise only)", async () => {
    await db.deliveryZone.updateMany({ data: { deliveryFeeCents: 2000 } });
    expect(
      await code(
        createCheckout(
          checkoutBody(ctx, {
            lines: [{ productId: ctx.beef.id, grams: 7000 }],
          }),
        ),
      ),
    ).toBe("BELOW_MINIMUM"); // 140 + 20 fee still < 150 merchandise
  });
  it("rejects unsupported postcodes, no delivery day, unavailable products and missing terms", async () => {
    expect(
      await code(
        createCheckout(
          checkoutBody(ctx, {
            address: {
              street: "Somewhere 1",
              postalCode: "80331",
              city: "Munich",
            },
          }),
        ),
      ),
    ).toBe("POSTCODE_UNSUPPORTED");
    await db.routeSchedule.updateMany({ data: { isActive: false } });
    expect(await code(createCheckout(checkoutBody(ctx)))).toBe("SLOT_INVALID"); // no delivery day configured
    await db.routeSchedule.updateMany({ data: { isActive: true } });
    expect(
      await code(
        createCheckout(
          checkoutBody(ctx, {
            lines: [{ productId: ctx.gone.id, grams: 1000 }],
          }),
        ),
      ),
    ).toBe("PRODUCT_UNAVAILABLE");
    expect(await code(createCheckout(checkoutBody(ctx, { acceptTerms: false })))).toBe("VALIDATION");
    expect(
      await code(
        createCheckout(
          checkoutBody(ctx, {
            lines: [{ productId: ctx.beef.id, grams: 8250 }],
          }),
        ),
      ),
    ).toBe("INVALID_QUANTITY");
    expect(await db.order.count()).toBe(0);
  });
  it("ignores client-supplied prices/fees", async () => {
    const { order } = await placeOrder({
      totalCents: 1,
      applicationFeeCents: 0,
      lines: [{ productId: ctx.beef.id, grams: 8000, pricePerKgCents: 1 }],
    });
    expect(order.totalCents).toBe(16000);
    expect(order.applicationFeeCents).toBe(0);
  });
  it("is idempotent for a repeated requestId", async () => {
    const body = checkoutBody(ctx);
    const a = await createCheckout(body),
      b = await createCheckout(body);
    expect(b).toEqual(a);
    expect(await db.order.count()).toBe(1);
  });
});

describe("platform charges (no connected account)", () => {
  it("accepts events without an account and rejects ones that claim to come from another account", async () => {
    await db.merchant.updateMany({ data: { stripeAccountId: null } });
    const { order, payment } = await placeOrder();
    expect(payment.connectedAccountId).toBeNull();
    const base = {
      id: payment.stripeCheckoutSessionId,
      object: "checkout.session",
      payment_status: "paid",
      amount_total: order.totalCents,
      currency: "eur",
      payment_intent: "pi_p",
      metadata: { orderId: order.id },
    };
    const foreign = signedEvent("checkout.session.completed", base, "acct_someone_else");
    await postWebhook(foreign.payload, foreign.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PENDING_PAYMENT");
    const own = signedEvent("checkout.session.completed", base, null);
    await postWebhook(own.payload, own.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
  });
});

describe("stripe webhook", () => {
  it("rejects invalid signatures", async () => {
    const res = await postWebhook("{}", "t=1,v1=bad");
    expect(res.status).toBe(400);
  });
  it("marks the order paid and is idempotent", async () => {
    const { order, payment } = await placeOrder();
    const ev = completed(payment.stripeCheckoutSessionId!, order.id, order.totalCents);
    expect((await (await postWebhook(ev.payload, ev.header)).json()).result).toBe("processed");
    const paid = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true, events: true },
    });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.payments[0]).toMatchObject({
      status: "PAID",
      stripePaymentIntentId: "pi_1",
    });

    expect((await (await postWebhook(ev.payload, ev.header)).json()).result).toBe("duplicate");
    // a *different* event for the same session (Stripe redelivery with new id) must not double-apply
    const ev2 = completed(payment.stripeCheckoutSessionId!, order.id, order.totalCents);
    await postWebhook(ev2.payload, ev2.header);
    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "PAYMENT_PAID" },
    });
    expect(events).toHaveLength(1);
  });
  it("handles concurrent duplicate deliveries", async () => {
    const { order, payment } = await placeOrder();
    const ev = completed(payment.stripeCheckoutSessionId!, order.id, order.totalCents);
    const results = await Promise.all([1, 2, 3].map(() => postWebhook(ev.payload, ev.header).then((r) => r.json())));
    expect(results.filter((r) => r.result === "processed")).toHaveLength(1);
    expect(await db.orderEvent.count({ where: { type: "PAYMENT_PAID" } })).toBe(1);
  });
  it("does not trust events with wrong amount or foreign account", async () => {
    const { order, payment } = await placeOrder();
    const bad = completed(payment.stripeCheckoutSessionId!, order.id, 100);
    await postWebhook(bad.payload, bad.header);
    const foreign = signedEvent(
      "checkout.session.completed",
      {
        id: payment.stripeCheckoutSessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: order.totalCents,
        currency: "eur",
        payment_intent: "pi_x",
        metadata: { orderId: order.id },
      },
      "acct_other",
    );
    await postWebhook(foreign.payload, foreign.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PENDING_PAYMENT");
  });
  it("tolerates out-of-order events: late expiry/failure never downgrade a paid order", async () => {
    const { order, payment } = await placeOrder();
    const sid = payment.stripeCheckoutSessionId!;
    const paidEv = completed(sid, order.id, order.totalCents);
    await postWebhook(paidEv.payload, paidEv.header);
    const exp = signedEvent("checkout.session.expired", {
      id: sid,
      object: "checkout.session",
    });
    const fail = signedEvent("payment_intent.payment_failed", {
      id: "pi_1",
      object: "payment_intent",
      metadata: { orderId: order.id },
      last_payment_error: { code: "card_declined" },
    });
    await postWebhook(exp.payload, exp.header);
    await postWebhook(fail.payload, fail.header);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.paymentStatus).toBe("PAID");
    expect(o.fulfillmentStatus).toBe("AWAITING_FORWARDING");
  });
  it("cancels unpaid orders on expiry, and a late success revives them", async () => {
    const { order, payment } = await placeOrder();
    const sid = payment.stripeCheckoutSessionId!;
    const exp = signedEvent("checkout.session.expired", {
      id: sid,
      object: "checkout.session",
    });
    await postWebhook(exp.payload, exp.header);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
    });
    const late = completed(sid, order.id, order.totalCents);
    await postWebhook(late.payload, late.header);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "PAID",
      fulfillmentStatus: "AWAITING_FORWARDING",
    });
  });
  it("records failures and allows a later successful retry", async () => {
    const { order, payment } = await placeOrder();
    const fail = signedEvent("payment_intent.payment_failed", {
      id: "pi_f",
      object: "payment_intent",
      metadata: { orderId: order.id },
      last_payment_error: { code: "card_declined" },
    });
    await postWebhook(fail.payload, fail.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAYMENT_FAILED");
    const ok = completed(payment.stripeCheckoutSessionId!, order.id, order.totalCents);
    await postWebhook(ok.payload, ok.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
  });
});

async function paidOrder() {
  const { order, payment } = await placeOrder();
  const ev = completed(payment.stripeCheckoutSessionId!, order.id, order.totalCents, { payment_intent: "pi_paid" });
  await postWebhook(ev.payload, ev.header);
  return order;
}

describe("refunds", () => {
  it("handles refund webhooks, partial then full, idempotently", async () => {
    const order = await paidOrder();
    const r1 = signedEvent("refund.created", {
      id: "re_1",
      object: "refund",
      amount: 4000,
      status: "succeeded",
      payment_intent: "pi_paid",
      metadata: {},
    });
    await postWebhook(r1.payload, r1.header);
    await postWebhook(r1.payload, r1.header);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedCents: 4000,
    });
    const r2 = signedEvent("refund.created", {
      id: "re_2",
      object: "refund",
      amount: 12000,
      status: "succeeded",
      payment_intent: "pi_paid",
      metadata: {},
    });
    await postWebhook(r2.payload, r2.header);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "REFUNDED",
      refundedCents: 16000,
    });
    // updated event for the same refund does not double count
    const u = signedEvent("refund.updated", {
      id: "re_2",
      object: "refund",
      amount: 12000,
      status: "succeeded",
      payment_intent: "pi_paid",
      metadata: {},
    });
    await postWebhook(u.payload, u.header);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).refundedCents).toBe(16000);
  });
  it("returns 500 (Stripe retries) when a refund arrives before the payment is recorded", async () => {
    const r = signedEvent("refund.created", {
      id: "re_x",
      object: "refund",
      amount: 100,
      status: "succeeded",
      payment_intent: "pi_unknown",
      metadata: {},
    });
    expect((await postWebhook(r.payload, r.header)).status).toBe(500);
    expect(await db.processedWebhookEvent.count()).toBe(0);
  });
  it("admin refunds partially then fully, and rejects amounts above the remainder", async () => {
    const order = await paidOrder();
    await refundOrder(order.id, 8000, { actor: "admin@test" });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedCents: 8000,
    });
    await expect(refundOrder(order.id, 9000, { actor: "a" })).rejects.toBeInstanceOf(AppError); // exceeds remaining
    await refundOrder(order.id, 8000, { actor: "a" });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "REFUNDED",
      refundedCents: 16000,
    });
  });
  it("cancelling a paid order refunds in full", async () => {
    const order = await paidOrder();
    await cancelOrder(order.id, "admin@test");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      paymentStatus: "REFUNDED",
      fulfillmentStatus: "CANCELLED",
      refundedCents: 16000,
    });
  });
});

describe("admin order operations", () => {
  it("builds the WhatsApp link only for paid orders and tracks opens separately from forwarding", async () => {
    const { order } = await placeOrder();
    expect(await code(prepareWhatsapp(order.id, "a@test"))).toBe("CONFLICT");
    const paid = await paidOrder();
    const { url, message } = await prepareWhatsapp(paid.id, "a@test");
    expect(url.startsWith("https://wa.me/4915112345678?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe(message);
    for (const s of [
      "NEW HALAL FRESH ORDER",
      `#HF-${paid.number}`,
      "Example Customer",
      "+4915112345678",
      "Example Street 12",
      "10115 Berlin",
      "- Beef Cubes — 8 kg",
      "PAID",
      "Ring twice",
    ])
      expect(message).toContain(s);
    await prepareWhatsapp(paid.id, "a@test");
    const o = await db.order.findUniqueOrThrow({ where: { id: paid.id } });
    expect(o.whatsappOpenCount).toBe(2);
    expect(o.forwardedAt).toBeNull();
    expect(o.fulfillmentStatus).toBe("AWAITING_FORWARDING");
  });
  it("enforces fulfillment transitions and requires payment", async () => {
    const { order } = await placeOrder();
    expect(await code(transitionFulfillment(order.id, "FORWARDED", "a"))).toBe("CONFLICT");
    const paid = await paidOrder();
    expect(await code(transitionFulfillment(paid.id, "DELIVERED", "a"))).toBe("CONFLICT");
    await transitionFulfillment(paid.id, "FORWARDED", "a@test");
    expect((await db.order.findUniqueOrThrow({ where: { id: paid.id } })).forwardedBy).toBe("a@test");
    await transitionFulfillment(paid.id, "CONFIRMED_BY_BUTCHER", "a");
  });
  it("only exposes orders to holders of the unguessable token", async () => {
    const { order } = await placeOrder();
    expect(await getOrderByToken(order.accessToken)).not.toBeNull();
    expect(await getOrderByToken(String(order.number))).toBeNull();
    expect(await getOrderByToken("x".repeat(32))).toBeNull();
    expect(order.accessToken.length).toBeGreaterThanOrEqual(32);
  });
});
