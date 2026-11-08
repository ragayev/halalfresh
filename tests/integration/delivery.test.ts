import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { berlinToUtc } from "@/domain/delivery";
import { meetsMinimumAfterWeighing, buildDispatchMessage } from "@/domain/dispatch";
import { createOrder } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { checkDelivery } from "@/server/delivery-service";
import { cartView } from "@/server/cart-view";
import { GET as checkRoute } from "@/app/api/delivery/check/route";
import { POST as waitlistRoute } from "@/app/api/waitlist/route";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

// Wednesday 2026-11-04, 09:00 Berlin (CET). Fixed so results never depend on the day tests run.
const NOW = berlinToUtc("2026-11-04", "09:00");

let ctx: Awaited<ReturnType<typeof seedBasics>>;

beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : String(e)),
  );
const put = (over: Record<string, unknown>) => checkoutBody(ctx, over);
const addr = (postalCode: string) => ({ street: "Example Street 12", postalCode, city: "Berlin" });
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("postcode lookup", () => {
  it("core: minimum 60, next day shown as tomorrow, delivery free", () => {
    const c = checkDelivery("10115", NOW);
    expect(c).toMatchObject({ status: "ok", supported: true, minOrderCents: 6000, deliveryFeeCents: 0 });
    expect(c.nextSlot).toMatchObject({ date: "2026-11-05", showTomorrow: true });
    expect(c.nextSlot?.slots).toEqual([
      { start: "10:00", end: "14:00" },
      { start: "15:00", end: "19:00" },
    ]);
  });
  it("tours: weekday by sector, minimum by tier, never 'tomorrow'", () => {
    const sw = checkDelivery("14467", NOW); // southwest, Friday, tier_100
    expect(sw).toMatchObject({ minOrderCents: 10000 });
    expect(sw.nextSlot).toMatchObject({ date: "2026-11-06", showTomorrow: false });
    expect(checkDelivery("16515", NOW)).toMatchObject({ minOrderCents: 15000, nextSlot: { date: "2026-11-11" } }); // north, Wednesday; today is Wed
    expect(checkDelivery("13581", NOW).nextSlot?.date).toBe("2026-11-10"); // west, Tuesday
    expect(checkDelivery("16321", NOW).nextSlot?.date).toBe("2026-11-05"); // northeast, Thursday
    expect(checkDelivery("12555", NOW).nextSlot?.date).toBe("2026-11-09"); // southeast, Monday
  });
  it("waitlist and unknown postcodes are unsupported", () => {
    expect(checkDelivery("14641", NOW)).toMatchObject({ status: "waitlist", supported: false, nextSlot: null });
    expect(checkDelivery("80331", NOW)).toMatchObject({ status: "unknown", supported: false, nextSlot: null });
  });
  it("the public payload never carries zone, tier or sector", async () => {
    const get = (q: string) => checkRoute(new Request(`http://localhost/api/delivery/check${q}`));
    const body = JSON.stringify(await (await get("?postcode=14467")).json());
    expect(body).not.toMatch(/tier|sector|zone|west|north|south|core/i);
    for (const bad of ["", "?postcode=", "?postcode=1011", "?postcode=abcde", "?postcode=101155"]) expect((await get(bad)).status).toBe(400);
    expect((await (await get("?postcode=99999")).json()).supported).toBe(false);
  });
});

describe("waitlist", () => {
  const post = (b: unknown) =>
    waitlistRoute(new Request("http://localhost/api/waitlist", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }));
  const valid = { postcode: "80331", name: "Aylin", contact: "aylin@example.com", preferredLanguage: "tr", consent: true };
  it("stores name, contact and postcode with a server-side consent timestamp; tells unknown from waitlist", async () => {
    expect((await post(valid)).status).toBe(201);
    expect((await post({ ...valid, postcode: "14641", contact: "+49 151 2345678" })).status).toBe(201);
    const [a, b] = await db.waitlistEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(a).toMatchObject({ postcode: "80331", name: "Aylin", reason: "unknown" });
    expect(b).toMatchObject({ postcode: "14641", contact: "+49 151 2345678", reason: "waitlist" });
    expect(Date.now() - a.consentGivenAt.getTime()).toBeLessThan(10_000);
  });
  it("requires explicit consent and valid input", async () => {
    expect((await post({ ...valid, consent: false })).status).toBe(400);
    expect((await post({ ...valid, contact: "nope" })).status).toBe(400);
    expect((await post({ ...valid, postcode: "123" })).status).toBe(400);
    expect(await db.waitlistEntry.count()).toBe(0);
  });
});

describe("cart view per postcode", () => {
  it("shows the minimum and the shortfall; no delivery fee", async () => {
    const v = await cartView([{ productId: ctx.beef.id, grams: 2000 }], "de", "10115"); // 40 EUR
    expect(v.totals).toMatchObject({ minOrderCents: 6000, shortfallCents: 2000, meetsMinimum: false, deliveryFeeCents: 0, totalCents: 4000 });
    const tour = await cartView([{ productId: ctx.beef.id, grams: 6000 }], "de", "14467"); // 120 EUR < 100? no: >= 100
    expect(tour.totals).toMatchObject({ minOrderCents: 10000, meetsMinimum: true, deliveryFeeCents: 0 });
  });
});

describe("checkout", () => {
  it("blocks below the minimum, accepts at it", async () => {
    expect(await code(createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 2500 }], address: addr("10115") }), NOW))).toBe("BELOW_MINIMUM"); // 50 < 60
    expect(await code(createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 3000 }], address: addr("10115") }), NOW))).toBe("ok"); // 60
    expect(await code(createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 4500 }], address: addr("14467") }), NOW))).toBe("BELOW_MINIMUM"); // 90 < 100
    expect(await code(createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 5000 }], address: addr("14467") }), NOW))).toBe("ok"); // 100
  });
  it("snapshots terms and slot; no delivery fee; ignores client-supplied terms", async () => {
    await createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 3000 }], address: addr("10115"), slotStart: "15:00", deliveryFeeCents: 490, minOrderCents: 1, deliveryDate: "2030-01-01" }), NOW);
    await createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 8000 }], address: addr("14467") }), NOW);
    const [core, tour] = await db.order.findMany({ orderBy: { createdAt: "asc" } });
    expect(core).toMatchObject({
      deliveryFeeCents: 0,
      estimatedTotalCents: 6000,
      maxTotalCents: 6600,
      minOrderCents: 6000,
      tier: "core",
      sector: null,
      slotStartTime: "15:00",
      slotEndTime: "19:00",
      zoneId: null,
    });
    expect(day(core.deliveryDate)).toBe("2026-11-05");
    expect(tour).toMatchObject({ tier: "tier_100", sector: "southwest", minOrderCents: 10000, slotStartTime: "10:00", slotEndTime: "14:00", zoneNeedsReview: false });
    expect(day(tour.deliveryDate)).toBe("2026-11-06");
  });
  it("flags needs_review postcodes on the order", async () => {
    await createOrder(put({ lines: [{ productId: ctx.beef.id, grams: 8000 }], address: addr("14089") }), NOW);
    expect(await db.order.findFirstOrThrow()).toMatchObject({ zoneNeedsReview: true, tier: "tier_100", sector: "west" });
  });
  it("rejects an unknown slot", async () => {
    expect(await code(createOrder(put({ slotStart: "12:00" }), NOW))).toBe("VALIDATION");
  });
  it("rejects a checked postcode that differs from the address postcode", async () => {
    expect(await code(createOrder(put({ address: addr("10115"), checkedPostcode: "14467" }), NOW))).toBe("POSTCODE_MISMATCH");
    expect(await db.order.count()).toBe(0);
  });
  it("rejects waitlist/unknown postcodes and hidden products", async () => {
    expect(await code(createOrder(put({ address: addr("14641") }), NOW))).toBe("POSTCODE_UNSUPPORTED");
    expect(await code(createOrder(put({ address: addr("80331") }), NOW))).toBe("POSTCODE_UNSUPPORTED");
    await db.product.update({ where: { id: ctx.beef.id }, data: { status: "DRAFT", isHidden: true } });
    expect(await code(createOrder(put({ address: addr("10115") }), NOW))).toBe("PRODUCT_UNAVAILABLE");
  });
});

describe("after weighing", () => {
  it("accepts a final total up to 10% below the minimum", () => {
    expect(meetsMinimumAfterWeighing(6000, 6000)).toBe(true);
    expect(meetsMinimumAfterWeighing(5400, 6000)).toBe(true); // exactly -10%
    expect(meetsMinimumAfterWeighing(5399, 6000)).toBe(false);
    expect(meetsMinimumAfterWeighing(9000, 10000)).toBe(true);
    expect(meetsMinimumAfterWeighing(8999, 10000)).toBe(false);
  });
});

describe("dispatch message", () => {
  it("lists items with estimated weights, customer, address, postcode, date and slot", () => {
    const text = buildDispatchMessage({
      number: 7,
      firstName: "Aylin",
      lastName: "Demir",
      phone: "+491511234567",
      street: "Hermannstraße 1",
      postalCode: "12049",
      city: "Berlin",
      deliveryDate: "2026-11-17",
      slotStartTime: "15:00",
      slotEndTime: "19:00",
      items: [{ productName: "Lammkeule", requestedGrams: 2500 }],
      estimatedTotalCents: 7500,
      needsReview: true,
    });
    for (const part of ["HF-000007", "Aylin Demir", "+491511234567", "Hermannstraße 1", "12049 Berlin", "15:00–19:00", "Lammkeule", "2,5 kg", "PLZ kontrol"]) expect(text).toContain(part);
  });
});
