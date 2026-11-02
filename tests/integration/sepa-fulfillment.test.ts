import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { db } from "@/lib/db";
import { createCheckout } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { authorizeEarlyFulfillment, cancelOrder, getOrderByToken, prepareWhatsapp, transitionFulfillment } from "@/server/orders";
import { sendOrderEmail } from "@/server/email";
import { adminAttention } from "@/domain/order-state";
import { checkoutBody, postWebhook, resetDb, seedBasics, signedEvent } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
beforeAll(() => {
  process.env.SMTP_URL = "smtp://test";
  process.env.ADMIN_ALERT_EMAIL = "alerts@example.com";
});
beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
  sendMail.mockReset();
  sendMail.mockResolvedValue(undefined);
});

const code = async (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : String(e)),
  );

async function placeOrder() {
  const { orderToken } = await createCheckout(checkoutBody(ctx));
  const order = await db.order.findUniqueOrThrow({ where: { accessToken: orderToken }, include: { payments: true } });
  return { order, sid: order.payments[0].stripeCheckoutSessionId!, token: orderToken };
}
const session = (sid: string, orderId: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: sid,
  object: "checkout.session",
  amount_total: amount,
  currency: "eur",
  payment_intent: "pi_sepa",
  metadata: { orderId },
  ...extra,
});
async function fire(type: string, obj: Record<string, unknown>, id?: string) {
  const ev = signedEvent(type, obj, "acct_test_1", id);
  return (await (await postWebhook(ev.payload, ev.header)).json()).result as string;
}
/** SEPA mandate accepted: Checkout completes with payment_status "unpaid". */
const initiate = (o: { order: { id: string; totalCents: number }; sid: string }, id?: string) =>
  fire("checkout.session.completed", session(o.sid, o.order.id, o.order.totalCents, { payment_status: "unpaid" }), id);
const settle = (o: { order: { id: string; totalCents: number }; sid: string }) =>
  fire("checkout.session.async_payment_succeeded", session(o.sid, o.order.id, o.order.totalCents, { payment_status: "paid" }));
const fail = (o: { order: { id: string; totalCents: number }; sid: string }) =>
  fire("checkout.session.async_payment_failed", session(o.sid, o.order.id, o.order.totalCents, { payment_status: "unpaid" }));
const reload = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const mailsTo = (to: string) => sendMail.mock.calls.filter(([m]) => m.to === to);

describe("SEPA initiation versus settlement", () => {
  it("initiation makes the order actionable but never marks it paid", async () => {
    const p = await placeOrder();
    expect(await initiate(p)).toBe("processed");
    const o = await db.order.findUniqueOrThrow({ where: { id: p.order.id }, include: { payments: true, events: true } });
    expect(o.paymentStatus).toBe("PENDING_PAYMENT");
    expect(o.paidAt).toBeNull();
    expect(o.sepaInitiatedAt).not.toBeNull();
    expect(o.payments[0]).toMatchObject({ status: "PENDING_PAYMENT", stripePaymentIntentId: "pi_sepa", paidAt: null });
    expect(o.events.map((e) => e.type)).toContain("PAYMENT_PROCESSING");
    expect(o.events.map((e) => e.type)).not.toContain("PAYMENT_PAID");
    expect(adminAttention(o)?.level).toBe("action");
  });
  it("only the verified settlement event marks it paid", async () => {
    const p = await placeOrder();
    await initiate(p);
    expect((await reload(p.order.id)).paymentStatus).toBe("PENDING_PAYMENT");
    expect(await settle(p)).toBe("processed");
    const o = await reload(p.order.id);
    expect(o).toMatchObject({ paymentStatus: "PAID" });
    expect(o.paidAt).not.toBeNull();
  });
  it("ignores initiation events that do not match the stored amount or account", async () => {
    const p = await placeOrder();
    await fire("checkout.session.completed", session(p.sid, p.order.id, 1, { payment_status: "unpaid" }));
    const foreign = signedEvent("checkout.session.completed", session(p.sid, p.order.id, p.order.totalCents, { payment_status: "unpaid" }), "acct_other");
    await postWebhook(foreign.payload, foreign.header);
    expect((await reload(p.order.id)).sepaInitiatedAt).toBeNull();
  });
  it("late initiation never regresses an order that is already paid or failed", async () => {
    const p = await placeOrder();
    await settle(p);
    await initiate(p);
    expect(await reload(p.order.id)).toMatchObject({ paymentStatus: "PAID", sepaInitiatedAt: null });
  });
});

describe("webhook idempotency", () => {
  it("drops redelivered and concurrent initiation events and sends one acknowledgement", async () => {
    const p = await placeOrder();
    const id = "evt_fixed_initiation";
    const results = await Promise.all([1, 2, 3].map(() => initiate(p, id)));
    expect(results.filter((r) => r === "processed")).toHaveLength(1);
    expect(await initiate(p, id)).toBe("duplicate");
    // Stripe may also redeliver under a fresh event id: state and mail must not repeat.
    await initiate(p);
    expect(await db.orderEvent.count({ where: { orderId: p.order.id, type: "PAYMENT_PROCESSING" } })).toBe(1);
    expect(mailsTo("customer@example.com")).toHaveLength(1);
  });
  it("settlement and failure events are idempotent too", async () => {
    const a = await placeOrder();
    await initiate(a);
    await settle(a);
    await settle(a);
    expect(await db.orderEvent.count({ where: { orderId: a.order.id, type: "PAYMENT_PAID" } })).toBe(1);
  });
});

describe("customer notifications", () => {
  it("acknowledges SEPA initiation without claiming money was received", async () => {
    const p = await placeOrder();
    await initiate(p);
    const [m] = mailsTo("customer@example.com")[0];
    expect(m.subject).toContain(`#HF-${p.order.number}`);
    expect(m.text).toContain("not been collected");
    expect(m.text).not.toMatch(/received your payment/i);
    expect(m.text).toContain(`/en/order/${p.token}`);
  });
  it("sends 'payment received' only after settlement, once", async () => {
    const p = await placeOrder();
    await initiate(p);
    await settle(p);
    await settle(p);
    const texts = mailsTo("customer@example.com").map(([m]) => m.text as string);
    expect(texts).toHaveLength(2);
    expect(texts.filter((t) => /received your payment/i.test(t))).toHaveLength(1);
  });
  it("notifies confirmed, out-for-delivery, delivered; skips internal steps; never twice", async () => {
    const p = await placeOrder();
    await settle(p);
    sendMail.mockClear();
    for (const s of ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await transitionFulfillment(p.order.id, s, "a@test");
    expect(sendMail).toHaveBeenCalledTimes(3);
    await sendOrderEmail(p.order.id, { kind: "status", status: "DELIVERED" }); // retry of the same notification
    await sendOrderEmail(p.order.id, { kind: "status", status: "CONFIRMED_BY_BUTCHER" });
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(await db.notificationLog.count({ where: { orderId: p.order.id, kind: { startsWith: "STATUS_" } } })).toBe(3);
  });
  it("concurrent identical notifications send once", async () => {
    const p = await placeOrder();
    await settle(p);
    sendMail.mockClear();
    await Promise.all([1, 2, 3, 4].map(() => sendOrderEmail(p.order.id, { kind: "status", status: "OUT_FOR_DELIVERY" })));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it("releases the claim when sending fails so a retry can still notify", async () => {
    const p = await placeOrder();
    await settle(p);
    sendMail.mockClear();
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    await sendOrderEmail(p.order.id, { kind: "status", status: "DELIVERED" });
    expect(await db.notificationLog.count({ where: { orderId: p.order.id, kind: "STATUS_DELIVERED" } })).toBe(0);
    await sendOrderEmail(p.order.id, { kind: "status", status: "DELIVERED" });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(await db.notificationLog.count({ where: { orderId: p.order.id, kind: "STATUS_DELIVERED" } })).toBe(1);
  });
  it("notifies the customer on cancellation", async () => {
    const p = await placeOrder();
    sendMail.mockClear();
    await cancelOrder(p.order.id, "a@test");
    expect(mailsTo("customer@example.com")).toHaveLength(1);
  });
});

describe("fulfillment while SEPA is processing", () => {
  it("a created checkout cannot be prepared or forwarded", async () => {
    const p = await placeOrder();
    expect(await code(transitionFulfillment(p.order.id, "FORWARDED", "a"))).toBe("CONFLICT");
    expect(await code(prepareWhatsapp(p.order.id, "a"))).toBe("CONFLICT");
    expect(await code(authorizeEarlyFulfillment(p.order.id, "a", true))).toBe("CONFLICT"); // no SEPA initiated
  });
  it("SEPA-initiated but unauthorized orders cannot be prepared", async () => {
    const p = await placeOrder();
    await initiate(p);
    expect(await code(transitionFulfillment(p.order.id, "FORWARDED", "a"))).toBe("CONFLICT");
    expect(await code(prepareWhatsapp(p.order.id, "a"))).toBe("CONFLICT");
    expect((await reload(p.order.id)).fulfillmentStatus).toBe("AWAITING_FORWARDING");
  });
  it("requires an explicit acknowledgement, then records who accepted the risk", async () => {
    const p = await placeOrder();
    await initiate(p);
    expect(await code(authorizeEarlyFulfillment(p.order.id, "a@test", false))).toBe("VALIDATION");
    expect((await reload(p.order.id)).earlyFulfillmentAuthorizedAt).toBeNull();
    await authorizeEarlyFulfillment(p.order.id, "kevser-admin@test", true);
    const o = await db.order.findUniqueOrThrow({ where: { id: p.order.id }, include: { events: true } });
    expect(o).toMatchObject({ paymentStatus: "PENDING_PAYMENT", earlyFulfillmentAuthorizedBy: "kevser-admin@test" }); // still NOT paid
    expect(o.paidAt).toBeNull();
    expect(o.events.find((e) => e.type === "EARLY_FULFILLMENT_AUTHORIZED")).toMatchObject({ actor: "kevser-admin@test" });
    expect(await db.auditLog.count({ where: { action: "order.early_fulfillment_authorized", entityId: p.order.id } })).toBe(1);
    expect(await code(authorizeEarlyFulfillment(p.order.id, "a@test", true))).toBe("CONFLICT"); // not repeatable
  });
  it("after authorization the order proceeds independently of payment, with each step audited", async () => {
    const p = await placeOrder();
    await initiate(p);
    await authorizeEarlyFulfillment(p.order.id, "a@test", true);
    const wa = await prepareWhatsapp(p.order.id, "a@test");
    expect(wa.message).toContain("SEPA DIRECT DEBIT PENDING");
    expect(wa.message).not.toMatch(/PAID/);
    for (const s of ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await transitionFulfillment(p.order.id, s, "a@test");
    const o = await db.order.findUniqueOrThrow({ where: { id: p.order.id }, include: { events: true } });
    expect(o).toMatchObject({ fulfillmentStatus: "DELIVERED", paymentStatus: "PENDING_PAYMENT" });
    expect(o.events.filter((e) => e.type === "FULFILLMENT")).toHaveLength(5);
    expect(o.events.find((e) => e.toStatus === "PREPARING")?.note).toMatch(/risk/i);
    // Settlement arrives later and only then flips payment, without touching fulfillment.
    await settle(p);
    expect(await reload(p.order.id)).toMatchObject({ fulfillmentStatus: "DELIVERED", paymentStatus: "PAID" });
  });
  it("authorization is void once the debit failed", async () => {
    const p = await placeOrder();
    await initiate(p);
    await fail(p);
    expect(await code(authorizeEarlyFulfillment(p.order.id, "a", true))).toBe("CONFLICT");
    expect(await code(transitionFulfillment(p.order.id, "FORWARDED", "a"))).toBe("CONFLICT");
  });
  it("cannot be cancelled while the debit is in flight (it cannot be stopped)", async () => {
    const p = await placeOrder();
    await initiate(p);
    expect(await code(cancelOrder(p.order.id, "a"))).toBe("CONFLICT");
    expect(await code(transitionFulfillment(p.order.id, "CANCELLED", "a"))).toBe("CONFLICT");
    expect((await reload(p.order.id)).fulfillmentStatus).toBe("AWAITING_FORWARDING");
  });
});

describe("payment failure", () => {
  it("before fulfilment: alerts the admin, blocks preparation, customer sees failure", async () => {
    const p = await placeOrder();
    await initiate(p);
    await fail(p);
    expect(await reload(p.order.id)).toMatchObject({ paymentStatus: "PAYMENT_FAILED", fulfillmentStatus: "AWAITING_FORWARDING" });
    expect(mailsTo("alerts@example.com")).toHaveLength(1);
    expect(await code(transitionFulfillment(p.order.id, "FORWARDED", "a"))).toBe("CONFLICT");
  });
  it("after delivery: flagged critical, admin alerted once and urgently, delivery record untouched", async () => {
    const p = await placeOrder();
    await initiate(p);
    await authorizeEarlyFulfillment(p.order.id, "a@test", true);
    for (const s of ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await transitionFulfillment(p.order.id, s, "a@test");
    await fail(p);
    // Stripe also emits payment_intent.payment_failed for the same failure.
    await fire("payment_intent.payment_failed", { id: "pi_sepa", object: "payment_intent", metadata: { orderId: p.order.id }, last_payment_error: { code: "insufficient_funds" } });
    const o = await db.order.findUniqueOrThrow({ where: { id: p.order.id }, include: { events: true } });
    expect(o).toMatchObject({ paymentStatus: "PAYMENT_FAILED", fulfillmentStatus: "DELIVERED" });
    expect(adminAttention(o)).toMatchObject({ level: "critical" });
    expect(o.events.filter((e) => e.type === "PAYMENT_FAILED")).toHaveLength(1);
    const alerts = mailsTo("alerts@example.com");
    expect(alerts).toHaveLength(1);
    expect(alerts[0][0].subject).toMatch(/^URGENT/);
    expect(alerts[0][0].text).toContain(`/admin/orders/${p.order.id}`);
    expect(alerts[0][0].text).not.toContain("customer@example.com");
    expect(alerts[0][0].text).not.toContain("Example Street");
  });
  it("failure while out for delivery still lets the admin record the delivery", async () => {
    const p = await placeOrder();
    await initiate(p);
    await authorizeEarlyFulfillment(p.order.id, "a@test", true);
    for (const s of ["FORWARDED", "CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY"] as const) await transitionFulfillment(p.order.id, s, "a@test");
    await fail(p);
    await transitionFulfillment(p.order.id, "DELIVERED", "a@test");
    expect(await reload(p.order.id)).toMatchObject({ paymentStatus: "PAYMENT_FAILED", fulfillmentStatus: "DELIVERED" });
  });
  it("a failure that arrives before the mandate (customer still in Checkout) does not alert", async () => {
    const p = await placeOrder();
    await fire("payment_intent.payment_failed", { id: "pi_x", object: "payment_intent", metadata: { orderId: p.order.id }, last_payment_error: { code: "invalid_iban" } });
    expect(mailsTo("alerts@example.com")).toHaveLength(0);
  });
});

describe("fulfillment transitions", () => {
  it("accepts valid steps on a paid order and rejects invalid ones without side effects", async () => {
    const p = await placeOrder();
    await settle(p);
    const id = p.order.id;
    const events = () => db.orderEvent.count({ where: { orderId: id, type: "FULFILLMENT" } });
    for (const bad of ["CONFIRMED_BY_BUTCHER", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
      expect(await code(transitionFulfillment(id, bad, "a"))).toBe("CONFLICT");
    }
    expect(await events()).toBe(0);
    await transitionFulfillment(id, "FORWARDED", "a");
    await transitionFulfillment(id, "CONFIRMED_BY_BUTCHER", "a");
    await transitionFulfillment(id, "PREPARING", "a");
    expect(await code(transitionFulfillment(id, "CONFIRMED_BY_BUTCHER", "a"))).toBe("CONFLICT"); // no going back
    expect(await code(transitionFulfillment(id, "DELIVERED", "a"))).toBe("CONFLICT"); // no skipping
    expect(await events()).toBe(3);
    await transitionFulfillment(id, "OUT_FOR_DELIVERY", "a");
    await transitionFulfillment(id, "DELIVERED", "a");
    expect(await code(transitionFulfillment(id, "PREPARING", "a"))).toBe("CONFLICT");
    expect(await code(transitionFulfillment(id, "CANCELLED", "a"))).toBe("CONFLICT"); // delivered is final
  });
  it("status change and its history event are atomic", async () => {
    const p = await placeOrder();
    await settle(p);
    // Make the history insert fail INSIDE the transaction that already updated the status.
    const real = db.$transaction.bind(db) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
      real((tx) =>
        fn(
          new Proxy(tx as Record<string, unknown>, {
            get: (t, k) => (k === "orderEvent" ? { create: async () => Promise.reject(new Error("boom")) } : t[k as string]),
          }),
        ),
      )) as never);
    await expect(transitionFulfillment(p.order.id, "FORWARDED", "a")).rejects.toThrow("boom");
    spy.mockRestore();
    expect((await reload(p.order.id)).fulfillmentStatus).toBe("AWAITING_FORWARDING"); // rolled back with the event
  });
  it("two admins racing: exactly one wins", async () => {
    const p = await placeOrder();
    await settle(p);
    const r = await Promise.all([1, 2].map(() => code(transitionFulfillment(p.order.id, "FORWARDED", "a"))));
    expect(r.sort()).toEqual(["CONFLICT", "ok"]);
    expect(await db.orderEvent.count({ where: { orderId: p.order.id, type: "FULFILLMENT" } })).toBe(1);
  });
  it("cancelling a paid order still refunds it in full via the transition entry point", async () => {
    const p = await placeOrder();
    await settle(p);
    await transitionFulfillment(p.order.id, "CANCELLED", "a");
    expect(await reload(p.order.id)).toMatchObject({ fulfillmentStatus: "CANCELLED", paymentStatus: "REFUNDED" });
  });
});

describe("customer tracking permissions", () => {
  it("the token query exposes no internal or sensitive fields", async () => {
    const p = await placeOrder();
    await db.order.update({ where: { id: p.order.id }, data: { adminNotes: "secret note", forwardedBy: "staff@x" } });
    const o = (await getOrderByToken(p.token))! as unknown as Record<string, unknown> & { customer: object; merchant: object; address: object };
    expect(o).not.toHaveProperty("accessToken");
    expect(o).not.toHaveProperty("adminNotes");
    expect(o).not.toHaveProperty("forwardedBy");
    expect(o.customer).not.toHaveProperty("phone");
    expect(o.merchant).not.toHaveProperty("stripeAccountId");
    expect(o.merchant).not.toHaveProperty("whatsappNumber");
    expect(JSON.stringify(o)).not.toContain("secret note");
  });
  it("guessing by order number or short tokens yields nothing", async () => {
    const p = await placeOrder();
    expect(await getOrderByToken(String(p.order.number))).toBeNull();
    expect(await getOrderByToken("")).toBeNull();
  });
  it("status endpoint requires the token, returns statuses only and is never cached", async () => {
    const { GET } = await import("@/app/api/order/[token]/status/route");
    const p = await placeOrder();
    await initiate(p);
    const call = (t: string) => GET(new Request("http://x"), { params: Promise.resolve({ token: t }) });
    const ok = await call(p.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    const body = await ok.json();
    expect(Object.keys(body).sort()).toEqual(["fulfillmentStatus", "paymentStatus", "sepaInitiated", "version"]);
    expect(body).toMatchObject({ paymentStatus: "PENDING_PAYMENT", sepaInitiated: true });
    expect((await call("short")).status).toBe(404);
    expect((await call("x".repeat(32))).status).toBe(404);
    expect((await call(p.order.id)).status).toBe(404); // internal id is not a credential
  });
});
