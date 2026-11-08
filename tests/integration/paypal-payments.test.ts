import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createOrder } from "@/server/checkout";
import { recordWeights, transitionOrder } from "@/server/orders";
import { captureForOrder, processWebhook, startPayment } from "@/server/payments/service";
import { mockControl } from "@/server/payments/mock";
import { AppError } from "@/server/errors";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
  mockControl.nextCapture = "COMPLETED";
  mockControl.webhookValid = true;
});

/** WEIGHED PayPal order with a final total of €160.00 (8 kg at €20). */
async function weighedOrder() {
  const r = await createOrder(checkoutBody(ctx));
  const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true } });
  await transitionOrder(order.id, "ACCEPTED", { actor: "admin" });
  await transitionOrder(order.id, "PREPARING", { actor: "admin" });
  await recordWeights(order.id, [{ itemId: order.items[0].id, actualGrams: 8000 }], { actor: "admin" });
  return { id: order.id, token: r.token };
}

let evt = 0;
const hook = (type: string, resource: Record<string, unknown>, id = `WH-${++evt}`) =>
  processWebhook(new Headers(), JSON.stringify({ id, event_type: type, resource }));
const capture = (providerOrderId: string, id = "CAP-1", value = "160.00") => ({ id, status: "COMPLETED", amount: { value }, supplementary_data: { related_ids: { order_id: providerOrderId } } });
const statusOf = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).status;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

describe("pay link", () => {
  it("creates one PayPal order for exactly the final amount and reuses it", async () => {
    const o = await weighedOrder();
    const a = await startPayment(o.token);
    const b = await startPayment(o.token);
    expect(b.providerOrderId).toBe(a.providerOrderId);
    expect(await db.payment.count({ where: { orderId: o.id } })).toBe(1);
    expect(mockControl.created.find((c) => c.id === a.providerOrderId)?.amountCents).toBe(16000);
  });
  it("is only available once weighed, for PayPal orders", async () => {
    const r = await createOrder(checkoutBody(ctx));
    expect(await code(startPayment(r.token))).toBe("NOT_PAYABLE");
  });
});

describe("capture and webhooks are idempotent", () => {
  it("server-side capture COMPLETED -> PAID immediately", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    expect((await captureForOrder(o.token, p.providerOrderId)).status).toBe("COMPLETED");
    expect(await statusOf(o.id)).toBe("PAID");
    const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.paidAmountCents).toBe(16000);
  });
  it("capture response then webhook for the same payment is a no-op", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await captureForOrder(o.token, p.providerOrderId);
    expect(await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId))).toBe("processed");
    expect(await db.orderEvent.count({ where: { orderId: o.id, toStatus: "PAID" } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: o.id, status: "COMPLETED" } })).toBe(1);
  });
  it("webhook first, then the capture response, is also a single transition", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId));
    expect(await statusOf(o.id)).toBe("PAID");
    await captureForOrder(o.token, p.providerOrderId);
    expect(await db.orderEvent.count({ where: { orderId: o.id, toStatus: "PAID" } })).toBe(1);
  });
  it("duplicate webhook deliveries (same event id) do not double-transition or double-record", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    const results = await Promise.all([1, 2, 3, 4].map(() => hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId), "WH-SAME")));
    expect(results.filter((r) => r === "processed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(3);
    expect(await db.orderEvent.count({ where: { orderId: o.id, toStatus: "PAID" } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: o.id } })).toBe(1);
  });
  it("different event ids for the same capture are still a single transition", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await Promise.all([hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId)), hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId))]);
    expect(await db.orderEvent.count({ where: { orderId: o.id, toStatus: "PAID" } })).toBe(1);
  });
  it("rejects webhooks that fail signature verification and changes nothing", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    mockControl.webhookValid = false;
    expect(await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId))).toBe("invalid");
    expect(await statusOf(o.id)).toBe("WEIGHED");
    expect(await db.processedWebhookEvent.count()).toBe(0);
  });
  it("PENDING capture stays WEIGHED until the webhook completes it", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    mockControl.nextCapture = "PENDING";
    expect((await captureForOrder(o.token, p.providerOrderId)).status).toBe("PENDING");
    expect(await statusOf(o.id)).toBe("WEIGHED");
    await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId));
    expect(await statusOf(o.id)).toBe("PAID");
  });
  it("CHECKOUT.ORDER.APPROVED captures when the browser never called us", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await hook("CHECKOUT.ORDER.APPROVED", { id: p.providerOrderId, status: "APPROVED" });
    expect(await statusOf(o.id)).toBe("PAID");
  });
  it("a late DENIED never downgrades a completed payment", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId));
    await hook("PAYMENT.CAPTURE.DENIED", capture(p.providerOrderId, "CAP-1"));
    expect(await statusOf(o.id)).toBe("PAID");
    expect((await db.payment.findFirstOrThrow({ where: { orderId: o.id } })).status).toBe("COMPLETED");
  });
  it("REFUNDED is recorded without changing status", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId));
    await hook("PAYMENT.CAPTURE.REFUNDED", { id: "REF-1", amount: { value: "20.00" }, supplementary_data: { related_ids: { order_id: p.providerOrderId } } });
    const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ status: "PAID", refundedCents: 2000 });
  });
});

describe("stale and unmatched payments", () => {
  it("a voided PayPal order (after weight correction) cannot be captured", async () => {
    const o = await weighedOrder();
    const old = await startPayment(o.token);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await recordWeights(o.id, [{ itemId: item.id, actualGrams: 7000 }], { actor: "admin" });
    expect(await code(captureForOrder(o.token, old.providerOrderId))).toBe("NOT_PAYABLE");
    await hook("CHECKOUT.ORDER.APPROVED", { id: old.providerOrderId });
    expect(await statusOf(o.id)).toBe("WEIGHED");
  });
  it("money for a cancelled order is recorded loudly, not turned into PAID", async () => {
    const o = await weighedOrder();
    const p = await startPayment(o.token);
    await transitionOrder(o.id, "CANCELLED", { actor: "admin", reason: "test" });
    await hook("PAYMENT.CAPTURE.COMPLETED", capture(p.providerOrderId));
    expect(await statusOf(o.id)).toBe("CANCELLED");
    expect(await db.orderEvent.count({ where: { orderId: o.id, reason: "payment_unmatched" } })).toBe(1);
  });
  it("a different customer's token cannot capture someone else's payment", async () => {
    const a = await weighedOrder();
    const pa = await startPayment(a.token);
    const b = await createOrder(checkoutBody(ctx));
    expect(await code(captureForOrder(b.token, pa.providerOrderId))).toBe("NOT_FOUND");
  });
});

describe("dispatch rule", () => {
  it("PayPal orders cannot be dispatched before PAID", async () => {
    const o = await weighedOrder();
    expect(await code(transitionOrder(o.id, "OUT_FOR_DELIVERY", { actor: "admin" }).catch((e) => { throw new AppError("INVALID_TRANSITION", e.code); }))).toBe("INVALID_TRANSITION");
    const p = await startPayment(o.token);
    await captureForOrder(o.token, p.providerOrderId);
    await transitionOrder(o.id, "OUT_FOR_DELIVERY", { actor: "admin" });
    await transitionOrder(o.id, "DELIVERED", { actor: "admin" });
    expect(await statusOf(o.id)).toBe("DELIVERED");
  });
});
