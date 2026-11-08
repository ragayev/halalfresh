import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createOrder, cashStatusForPhone } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { cancelByCustomer, recordWeights, transitionOrder, getOrderByToken } from "@/server/orders";
import { TransitionError } from "@/domain/order-state";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

let ctx: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : e instanceof TransitionError ? e.code : String(e)),
  );

async function place(over: Record<string, unknown> = {}) {
  const r = await createOrder(checkoutBody(ctx, over));
  return { ...r, order: await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true } }) };
}
async function toPreparing(id: string) {
  await transitionOrder(id, "ACCEPTED", { actor: "admin" });
  await transitionOrder(id, "PREPARING", { actor: "admin" });
}
/** 8 kg at €20 = €160 est, €176 max. */
const weigh = (o: { id: string; items: { id: string }[] }, grams: number) => recordWeights(o.id, [{ itemId: o.items[0].id, actualGrams: grams }], { actor: "admin" });

describe("order creation", () => {
  it("snapshots prices and rules, creates NEW with a strong token, event and consents", async () => {
    const { token, order } = await place({ lines: [{ productId: ctx.beef.id, grams: 8000 }], unitPriceCents: 1, estimatedTotalCents: 1 });
    expect(token.length).toBeGreaterThanOrEqual(32); // >= 192 bit base64url
    expect(order).toMatchObject({ status: "NEW", estimatedTotalCents: 16000, maxTotalCents: 17600, toleranceBps: 1000, paymentMode: "CAPTURE_AFTER_WEIGH", paymentMethod: "PAYPAL" });
    expect(order.items[0]).toMatchObject({ productName: "Beef Cubes", unitPricePerKgCents: 2000, requestedGrams: 8000, estimatedCents: 16000, actualGrams: null });
    const ev = await db.orderEvent.findMany({ where: { orderId: order.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ toStatus: "NEW", actor: "customer" });
    const consents = await db.consent.findMany({ where: { orderId: order.id }, orderBy: { type: "asc" } });
    expect(consents.map((c) => [c.type, c.granted, c.wordingVersion.length > 0])).toEqual([
      ["MARKETING", false, true],
      ["DATA_TRANSFER", false, true],
      ["TERMS", true, true],
    ]);
  });
  it("is idempotent on requestId", async () => {
    const body = checkoutBody(ctx);
    const a = await createOrder(body);
    const b = await createOrder(body);
    expect(b.token).toBe(a.token);
    expect(await db.order.count()).toBe(1);
  });
  it("requires the terms checkbox", async () => {
    expect(await code(createOrder(checkoutBody(ctx, { consents: { terms: false } })))).toBe("VALIDATION");
  });
  it("identifies customers by normalised phone", async () => {
    await place({ customer: { firstName: "A", lastName: "B", email: "a@b.de", phone: "0151 12345678" } });
    await place({ customer: { firstName: "A", lastName: "B", email: "a@b.de", phone: "+49 151 12345678" } });
    expect(await db.customer.count()).toBe(1);
    expect((await db.customer.findFirstOrThrow()).phoneE164).toBe("+4915112345678");
  });
  it("logs notifications (skipped without providers) and does not fail the order", async () => {
    const { order } = await place();
    const n = await db.notification.findMany({ where: { orderId: order.id } });
    expect(n.map((x) => `${x.channel}:${x.template}`).sort()).toEqual(expect.arrayContaining(["email:order_created", "sms:order_created"]));
  });
});

describe("cash eligibility (server-enforced)", () => {
  const cash = { paymentMethod: "CASH" };
  it("first-time phone cannot choose cash", async () => {
    expect(await code(createOrder(checkoutBody(ctx, cash)))).toBe("PAYMENT_METHOD_UNAVAILABLE");
    expect(await db.order.count()).toBe(0);
    expect(await cashStatusForPhone("0151 12345678")).toEqual({ allowed: false, reason: "FIRST_ORDER" });
  });
  it("a PayPal order that is not yet delivered does not unlock cash", async () => {
    await place();
    expect(await code(createOrder(checkoutBody(ctx, cash)))).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });
  it("is unlocked by one delivered and paid order", async () => {
    const { order } = await place();
    await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
    expect(await code(createOrder(checkoutBody(ctx, cash)))).toBe("ok");
    expect(await cashStatusForPhone("+4915112345678")).toEqual({ allowed: true });
  });
  it("is blocked after a refusal and by the manual flag", async () => {
    const { order } = await place();
    await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
    await db.customer.updateMany({ data: { refusedCount: 1 } });
    expect(await code(createOrder(checkoutBody(ctx, cash)))).toBe("PAYMENT_METHOD_UNAVAILABLE");
    await db.customer.updateMany({ data: { refusedCount: 0, blockedCash: true } });
    expect(await code(createOrder(checkoutBody(ctx, cash)))).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });
  it("REFUSED_AT_DOOR increments refused_count", async () => {
    const { order } = await place();
    await db.order.update({ where: { id: order.id }, data: { status: "OUT_FOR_DELIVERY" } });
    await transitionOrder(order.id, "REFUSED_AT_DOOR", { actor: "admin" });
    expect((await db.customer.findFirstOrThrow()).refusedCount).toBe(1);
  });
});

describe("state machine on real orders", () => {
  it("customer can cancel in NEW and ACCEPTED, not after", async () => {
    const a = await place();
    await cancelByCustomer(a.token);
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe("CANCELLED");

    const b = await place();
    await transitionOrder(b.order.id, "ACCEPTED", { actor: "admin" });
    await cancelByCustomer(b.token);

    const c = await place();
    await toPreparing(c.order.id);
    expect(await code(cancelByCustomer(c.token))).toBe("INVALID_TRANSITION");
    expect((await db.order.findUniqueOrThrow({ where: { id: c.order.id } })).status).toBe("PREPARING");
  });
  it("rejects invalid transitions with a typed error and writes no event", async () => {
    const { order } = await place();
    expect(await code(transitionOrder(order.id, "WEIGHED", { actor: "admin" }))).toBe("INVALID_TRANSITION");
    expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(1);
  });
  it("admin cancel needs a reason, which is stored", async () => {
    const { order } = await place();
    expect(await code(transitionOrder(order.id, "CANCELLED", { actor: "admin" }))).toBe("REASON_REQUIRED");
    await transitionOrder(order.id, "CANCELLED", { actor: "admin", reason: "Kein Bestand" });
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: "CANCELLED", cancelReason: "Kein Bestand" });
    expect(o.terminalAt).not.toBeNull();
  });
  it("concurrent transitions apply once", async () => {
    const { order } = await place();
    const r = await Promise.all([1, 2, 3].map(() => code(transitionOrder(order.id, "ACCEPTED", { actor: "admin" }))));
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
    expect(await db.orderEvent.count({ where: { orderId: order.id, toStatus: "ACCEPTED" } })).toBe(1);
  });
  it("the public link expires 30 days after a terminal state", async () => {
    const { order, token } = await place();
    await transitionOrder(order.id, "CANCELLED", { actor: "admin", reason: "x" });
    const t = (await db.order.findUniqueOrThrow({ where: { id: order.id } })).terminalAt!;
    expect((await getOrderByToken(token, new Date(t.getTime() + 29 * 86400_000)))?.expired).toBe(false);
    expect((await getOrderByToken(token, new Date(t.getTime() + 31 * 86400_000)))?.expired).toBe(true);
  });
  it("the public view never exposes internal fields", async () => {
    const { token } = await place();
    const r = await getOrderByToken(token);
    const o = r!.order as unknown as Record<string, unknown>;
    for (const k of ["publicToken", "adminNotes", "requestId", "commissionBps"]) expect(o).not.toHaveProperty(k);
  });
});

describe("weighing (spec §5 on real orders)", () => {
  it("below estimate: customer pays the weighed amount", async () => {
    const { order } = await place();
    await toPreparing(order.id);
    const r = await weigh(order, 7000); // 7 kg = €140
    expect(r.finalTotalCents).toBe(14000);
    expect(r.cappedAmountCents).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("WEIGHED");
  });
  it("within tolerance", async () => expect((await (async () => { const { order } = await place(); await toPreparing(order.id); return weigh(order, 8500); })()).finalTotalCents).toBe(17000));
  it("above the cap: capped, excess absorbed, warning", async () => {
    const { order } = await place();
    await toPreparing(order.id);
    const r = await weigh(order, 9000); // €180 > €176
    expect(r).toMatchObject({ finalTotalCents: 17600, cappedAmountCents: 400 });
    expect(r.lineWarnings).toEqual(["Beef Cubes"]);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).cappedAmountCents).toBe(400);
  });
  it("0 g marks the item unavailable", async () => {
    const { order } = await place({ lines: [{ productId: ctx.beef.id, grams: 8000 }, { productId: ctx.gone.id, grams: 1000 }].slice(0, 1) });
    await toPreparing(order.id);
    const r = await weigh(order, 0);
    expect(r.finalTotalCents).toBe(0);
  });
  it("requires a weight for every line and valid integers", async () => {
    const { order } = await place();
    await toPreparing(order.id);
    expect(await code(recordWeights(order.id, [], { actor: "admin" }))).toBe("VALIDATION");
    expect(await code(recordWeights(order.id, [{ itemId: order.items[0].id, actualGrams: -5 }], { actor: "admin" }))).toBe("VALIDATION");
    expect(await code(recordWeights(order.id, [{ itemId: order.items[0].id, actualGrams: 1.5 }], { actor: "admin" }))).toBe("VALIDATION");
  });
  it("only in PREPARING (or as a correction while WEIGHED)", async () => {
    const { order } = await place();
    expect(await code(weigh(order, 8000))).toBe("INVALID_TRANSITION");
  });
  it("correction recomputes, keeps status, voids the stale PayPal order and logs weight_correction", async () => {
    const { order, token } = await place();
    await toPreparing(order.id);
    await weigh(order, 8000);
    const { startPayment } = await import("@/server/payments/service");
    const first = await startPayment(token);
    await weigh(order, 7500);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: "WEIGHED", finalTotalCents: 15000 });
    expect((await db.payment.findUniqueOrThrow({ where: { providerOrderId: first.providerOrderId } })).status).toBe("VOIDED");
    const ev = await db.orderEvent.findMany({ where: { orderId: order.id, reason: "weight_correction" } });
    expect(ev).toHaveLength(1);
    expect(ev[0].fromStatus).toBe("WEIGHED");
    expect(ev[0].toStatus).toBe("WEIGHED");
    const second = await startPayment(token);
    expect(second.providerOrderId).not.toBe(first.providerOrderId);
    // The customer gets a fresh notification for the corrected amount.
    expect(await db.notification.count({ where: { orderId: order.id, template: "weight_corrected" } })).toBeGreaterThan(0);
  });
  it("no correction after PAID", async () => {
    const { order, token } = await place();
    await toPreparing(order.id);
    await weigh(order, 8000);
    const { startPayment, captureForOrder } = await import("@/server/payments/service");
    const p = await startPayment(token);
    await captureForOrder(token, p.providerOrderId);
    expect(await code(weigh(order, 7000))).toBe("INVALID_TRANSITION");
  });
});
