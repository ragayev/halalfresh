import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { addDays, berlinToday, weekdayOf } from "@/domain/delivery";

export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE "OrderEvent","Refund","Payment","CommissionRecord","OrderItem","Order","Address","Customer","DeliverySlot","DeliveryPostcode","DeliveryZone","ProductImage","Product","Category","MerchantSettings","Merchant","AdminUser","AuditLog","ProcessedWebhookEvent","RateLimit" RESTART IDENTITY CASCADE`,
  );
}

export async function seedBasics() {
  const merchant = await db.merchant.create({
    data: {
      name: "Test Butcher",
      whatsappNumber: "4915112345678",
      stripeAccountId: "acct_test_1",
      settings: { create: { slotLeadTimeHours: 12 } },
    },
  });
  const cat = await db.category.create({
    data: { slug: "beef", name: "Beef" },
  });
  const beef = await db.product.create({
    data: {
      merchantId: merchant.id,
      categoryId: cat.id,
      slug: "beef-cubes",
      name: "Beef Cubes",
      description: "d",
      pricePerKgCents: 2000,
      stepGrams: 500,
      minGrams: 1000,
      maxGrams: 20000,
    },
  });
  const gone = await db.product.create({
    data: {
      merchantId: merchant.id,
      categoryId: cat.id,
      slug: "gone",
      name: "Gone",
      description: "d",
      pricePerKgCents: 1000,
      isAvailable: false,
    },
  });
  const zone = await db.deliveryZone.create({
    data: {
      merchantId: merchant.id,
      name: "Berlin",
      postcodes: { create: [{ pattern: "10*" }] },
    },
  });
  // Every weekday, so a bookable slot always exists regardless of when tests run.
  const slots = [];
  for (let wd = 0; wd < 7; wd++)
    slots.push(
      await db.deliverySlot.create({
        data: {
          zoneId: zone.id,
          weekday: wd,
          startTime: "10:00",
          endTime: "14:00",
        },
      }),
    );
  const date = addDays(berlinToday(new Date()), 5);
  const slot = slots.find((s) => s.weekday === weekdayOf(date))!;
  return { merchant, beef, gone, zone, slot, date };
}

export function checkoutBody(ctx: Awaited<ReturnType<typeof seedBasics>>, over: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    locale: "en",
    lines: [{ productId: ctx.beef.id, grams: 8000 }], // 8 kg * €20 = €160
    customer: {
      name: "Example Customer",
      email: "customer@example.com",
      phone: "+4915112345678",
    },
    address: {
      street: "Example Street 12",
      postalCode: "10115",
      city: "Berlin",
    },
    deliveryInstructions: "Ring twice",
    acceptTerms: true,
    ...over,
  };
}

const stripe = new Stripe("sk_test_dummy");
export function signedEvent(
  type: string,
  object: Record<string, unknown>,
  account: string | null = "acct_test_1",
  id = `evt_${randomUUID()}`,
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    account: account ?? undefined,
    api_version: "x",
    created: 1,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return { id, payload, header };
}

export async function postWebhook(payload: string, header: string) {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header },
    }),
  );
}
