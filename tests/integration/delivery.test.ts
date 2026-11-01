import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { berlinToUtc } from "@/domain/delivery";
import { createCheckout } from "@/server/checkout";
import { AppError } from "@/server/errors";
import { checkDelivery } from "@/server/delivery-service";
import { cartView } from "@/server/cart-view";
import { GET as checkRoute } from "@/app/api/delivery/check/route";
import { POST as waitlistRoute } from "@/app/api/waitlist/route";
import { checkoutBody, resetDb, seedBasics } from "../helpers";

// Wednesday 2026-11-04, 09:00 Berlin (CET). Fixed so results never depend on the day tests run.
const NOW = berlinToUtc("2026-11-04", "09:00");

let ctx: Awaited<ReturnType<typeof seedBasics>>;
let preorder: { id: string };

/** Mirrors the brief: Berlin (Mon–Sat 24h), suburbs (Tue/Thu 48h), far Brandenburg (preorder-only, 1st Saturday monthly). */
async function seedZones() {
  const m = ctx.merchant.id;
  const weekly = (weekday: number, h: number) => ({ weekday, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: h });
  await db.deliveryZone.update({
    where: { id: ctx.zone.id },
    data: { minOrderCents: 6000, deliveryFeeCents: 490, freeDeliveryThresholdCents: 12000 },
  });
  await db.routeSchedule.deleteMany({ where: { routeId: ctx.route.id } });
  await db.routeSchedule.createMany({ data: [1, 2, 3, 4, 5, 6].map((d) => ({ routeId: ctx.route.id, ...weekly(d, 24) })) });

  const z2 = await db.deliveryZone.create({ data: { merchantId: m, name: "Berlin suburbs", minOrderCents: 15000 } });
  await db.deliveryRoute.create({
    data: {
      zoneId: z2.id,
      name: "West",
      schedules: { create: [weekly(2, 48)] },
      postcodes: { create: [{ postcode: "14467" }, { postcode: "14612" }] },
    },
  });
  await db.deliveryRoute.create({
    data: {
      zoneId: z2.id,
      name: "North/East",
      schedules: { create: [weekly(4, 48)] },
      postcodes: { create: [{ postcode: "16515" }, { postcode: "15711" }] },
    },
  });
  const z3 = await db.deliveryZone.create({
    data: { merchantId: m, name: "Far Brandenburg", mode: "PREORDER_ONLY", minOrderCents: 30000 },
  });
  await db.deliveryRoute.create({
    data: {
      zoneId: z3.id,
      name: "Far",
      schedules: { create: [{ kind: "NTH_WEEKDAY_OF_MONTH", nth: 1, ...weekly(6, 7 * 24) }] },
      postcodes: { create: [{ postcode: "03046" }, { postcode: "15230" }] },
    },
  });
  preorder = await db.product.create({
    data: {
      merchantId: m,
      categoryId: ctx.beef.categoryId,
      slug: "ramazan-kutusu",
      name: "Ramazan Kutusu",
      description: "d",
      pricePerKgCents: 10000,
      stepGrams: 1000,
      minGrams: 1000,
      maxGrams: 20000,
      preorderEligible: true,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  ctx = await seedBasics();
  await seedZones();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof AppError ? e.code : String(e)),
  );
const put = (over: Record<string, unknown>) => checkoutBody(ctx, over);
const addr = (postalCode: string) => ({ street: "Example Street 12", postalCode, city: "Berlin" });

describe("postcode lookup", () => {
  it("Berlin: terms and the next concrete slot", async () => {
    const c = await checkDelivery("10115", NOW);
    expect(c).toMatchObject({
      supported: true,
      zone: { name: "Berlin" },
      mode: "REGULAR",
      minOrderCents: 6000,
      deliveryFeeCents: 490,
      freeDeliveryThresholdCents: 12000,
    });
    // Wed 09:00 -> Thu 14:00 window (cutoff Wed 14:00 still ahead).
    expect(c.nextSlot).toMatchObject({ date: "2026-11-05", windowStart: "14:00", windowEnd: "18:00" });
  });
  it("Zone 2 West (Tuesday) and North/East (Thursday)", async () => {
    expect((await checkDelivery("14467", NOW)).nextSlot?.date).toBe("2026-11-10"); // Tue 3rd cutoff passed -> next Tue
    expect((await checkDelivery("14612", NOW)).nextSlot?.date).toBe("2026-11-10");
    const ne = await checkDelivery("16515", NOW); // Thu 5th cutoff Tue 3rd 14:00 passed -> Thu 12th
    expect(ne).toMatchObject({ supported: true, zone: { name: "Berlin suburbs" }, minOrderCents: 15000, deliveryFeeCents: 0 });
    expect(ne.nextSlot?.date).toBe("2026-11-12");
    expect((await checkDelivery("15711", NOW)).nextSlot?.date).toBe("2026-11-12");
  });
  it("Zone 3: preorder-only, monthly first Saturday; leading-zero postcode", async () => {
    const c = await checkDelivery("03046", NOW);
    expect(c).toMatchObject({ supported: true, mode: "PREORDER_ONLY", minOrderCents: 30000, zone: { name: "Far Brandenburg" } });
    expect(c.nextSlot?.date).toBe("2026-12-05"); // Nov 7 cutoff (Oct 31) passed
    expect((await checkDelivery("15230", NOW)).mode).toBe("PREORDER_ONLY");
  });
  it("unknown postcode: unsupported, never a bare error; offers preorders when they exist", async () => {
    const c = await checkDelivery("80331", NOW);
    expect(c).toMatchObject({ supported: false, zone: null, mode: null, nextSlot: null });
    expect(c.preorderProductsAvailable).toBe(true);
    await db.product.update({ where: { id: preorder.id }, data: { isHidden: true } });
    expect((await checkDelivery("80331", NOW)).preorderProductsAvailable).toBe(false);
  });
  it("inactive zone/route is unsupported; blackout dates are skipped", async () => {
    await db.deliveryZone.update({ where: { id: ctx.zone.id }, data: { isActive: false } });
    expect((await checkDelivery("10115", NOW)).supported).toBe(false);
    await db.deliveryZone.update({ where: { id: ctx.zone.id }, data: { isActive: true } });
    await db.deliveryBlackoutDate.create({
      data: { merchantId: ctx.merchant.id, date: new Date("2026-11-05T00:00:00Z"), reason: "Holiday" },
    });
    expect((await checkDelivery("10115", NOW)).nextSlot?.date).toBe("2026-11-06");
  });
  it("GET /api/delivery/check validates input", async () => {
    const get = (q: string) => checkRoute(new Request(`http://localhost/api/delivery/check${q}`));
    const ok = await get("?postcode=10115");
    expect(ok.status).toBe(200);
    expect((await ok.json()).supported).toBe(true);
    expect((await (await get("?postcode=03046")).json()).zone.name).toBe("Far Brandenburg");
    for (const bad of ["", "?postcode=", "?postcode=1011", "?postcode=abcde", "?postcode=101155"])
      expect((await get(bad)).status).toBe(400);
    expect((await (await get("?postcode=99999")).json()).supported).toBe(false);
  });
});

describe("waitlist", () => {
  const post = (b: unknown) =>
    waitlistRoute(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        body: JSON.stringify(b),
        headers: { "content-type": "application/json" },
      }),
    );
  const valid = { postcode: "80331", name: "Aylin", contact: "aylin@example.com", preferredLanguage: "tr", consent: true };
  it("stores an entry with a server-side consent timestamp", async () => {
    const r = await post(valid);
    expect(r.status).toBe(201);
    const e = await db.waitlistEntry.findFirstOrThrow();
    expect(e).toMatchObject({ postcode: "80331", preferredLanguage: "tr" });
    expect(Date.now() - e.consentGivenAt.getTime()).toBeLessThan(10_000);
  });
  it("requires explicit consent and valid input", async () => {
    expect((await post({ ...valid, consent: false })).status).toBe(400);
    const noConsent: Partial<typeof valid> = { ...valid };
    delete noConsent.consent;
    expect((await post(noConsent)).status).toBe(400);
    expect((await post({ ...valid, contact: "nope" })).status).toBe(400);
    expect((await post({ ...valid, postcode: "123" })).status).toBe(400);
    expect((await post({ ...valid, preferredLanguage: "fr" })).status).toBe(400);
    expect(await db.waitlistEntry.count()).toBe(0);
  });
});

describe("cart view per postcode", () => {
  it("prices the cart with the zone's terms", async () => {
    const v = await cartView([{ productId: ctx.beef.id, grams: 2000 }], "en", "10115"); // €40
    expect(v.totals).toMatchObject({ minOrderCents: 6000, shortfallCents: 2000, meetsMinimum: false, deliveryFeeCents: 490 });
    const big = await cartView([{ productId: ctx.beef.id, grams: 6000 }], "en", "10115"); // €120 -> free
    expect(big.totals).toMatchObject({ meetsMinimum: true, deliveryFeeCents: 0 });
  });
  it("flags non-preorder lines in a preorder-only area", async () => {
    const v = await cartView(
      [
        { productId: ctx.beef.id, grams: 1000 },
        { productId: preorder.id, grams: 1000 },
      ],
      "en",
      "03046",
    );
    expect(v.lines.find((l) => l.productId === ctx.beef.id)?.issue).toBe("NOT_PREORDER");
    expect(v.lines.find((l) => l.productId === preorder.id)?.issue).toBeUndefined();
    expect(v.hasIssues).toBe(true);
  });
});

describe("checkout validation", () => {
  it("rejects below the zone minimum, accepts at it", async () => {
    // €20/kg: 2.5 kg = €50 < €60
    expect(await code(createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 2500 }], address: addr("10115") }), NOW))).toBe(
      "BELOW_MINIMUM",
    );
    expect(await code(createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 3000 }], address: addr("10115") }), NOW))).toBe("ok"); // €60
  });
  it("applies the zone's fee and the free-delivery threshold, stores the snapshot", async () => {
    await createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 3000 }], address: addr("10115") }), NOW); // €60 + €4.90
    await createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 6000 }], address: addr("10115") }), NOW); // €120 -> free
    const [a, b] = await db.order.findMany({ orderBy: { createdAt: "asc" } });
    expect(a).toMatchObject({
      subtotalCents: 6000,
      deliveryFeeCents: 490,
      totalCents: 6490,
      minOrderCents: 6000,
      freeDeliveryThresholdCents: 12000,
      zoneName: "Berlin",
    });
    expect(b).toMatchObject({ subtotalCents: 12000, deliveryFeeCents: 0, totalCents: 12000 });
    expect(a.deliveryDate.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(a).toMatchObject({ slotStartTime: "14:00", slotEndTime: "18:00", routeId: ctx.route.id, deliveryMode: "REGULAR" });
  });
  it("ignores client-supplied terms", async () => {
    await createCheckout(
      put({
        lines: [{ productId: ctx.beef.id, grams: 3000 }],
        address: addr("10115"),
        deliveryFeeCents: 0,
        minOrderCents: 1,
        deliveryDate: "2030-01-01",
      }),
      NOW,
    );
    const o = await db.order.findFirstOrThrow();
    expect(o.deliveryFeeCents).toBe(490);
    expect(o.deliveryDate.toISOString().slice(0, 10)).toBe("2026-11-05");
  });
  it("uses the suburb route's slot and minimum", async () => {
    expect(await code(createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 6000 }], address: addr("14467") }), NOW))).toBe(
      "BELOW_MINIMUM",
    ); // €120 < €150
    await createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 8000 }], address: addr("14467") }), NOW);
    const o = await db.order.findFirstOrThrow();
    expect(o.deliveryDate.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(o.zoneName).toBe("Berlin suburbs");
  });
  it("preorder-only zone accepts only preorder-eligible products", async () => {
    expect(await code(createCheckout(put({ lines: [{ productId: ctx.beef.id, grams: 20000 }], address: addr("03046") }), NOW))).toBe(
      "PREORDER_ONLY",
    );
    expect(
      await code(
        createCheckout(
          put({
            lines: [
              { productId: preorder.id, grams: 3000 },
              { productId: ctx.beef.id, grams: 1000 },
            ],
            address: addr("03046"),
          }),
          NOW,
        ),
      ),
    ).toBe("PREORDER_ONLY");
    expect(await code(createCheckout(put({ lines: [{ productId: preorder.id, grams: 2000 }], address: addr("03046") }), NOW))).toBe(
      "BELOW_MINIMUM",
    ); // €200 < €300
    expect(await code(createCheckout(put({ lines: [{ productId: preorder.id, grams: 3000 }], address: addr("03046") }), NOW))).toBe("ok"); // €300
    const o = await db.order.findFirstOrThrow();
    expect(o).toMatchObject({ deliveryMode: "PREORDER_ONLY", zoneName: "Far Brandenburg" });
    expect(o.deliveryDate.toISOString().slice(0, 10)).toBe("2026-12-05");
  });
  it("rejects a checked postcode that differs from the address postcode", async () => {
    const body = put({ address: addr("10115"), checkedPostcode: "14467" });
    expect(await code(createCheckout(body, NOW))).toBe("POSTCODE_MISMATCH");
    expect(await db.order.count()).toBe(0);
    expect(await code(createCheckout(put({ address: addr("10115"), checkedPostcode: "10115" }), NOW))).toBe("ok");
  });
  it("rejects unsupported postcodes and hidden products", async () => {
    expect(await code(createCheckout(put({ address: addr("80331") }), NOW))).toBe("POSTCODE_UNSUPPORTED");
    await db.product.update({ where: { id: ctx.beef.id }, data: { isHidden: true } });
    expect(await code(createCheckout(put({ address: addr("10115") }), NOW))).toBe("PRODUCT_UNAVAILABLE");
  });
});
