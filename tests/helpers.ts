import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { addDays, berlinToday } from "@/domain/delivery";

export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE "OrderEvent","Notification","Consent","Payment","OrderItem","Order","Address","Customer","Setting","WaitlistEntry","DeliveryBlackoutDate","PostcodeRoute","RouteSchedule","DeliveryRoute","DeliveryZone","ProductImage","SupplierArticle","Product","Category","MerchantSettings","Merchant","AdminUser","AuditLog","ProcessedWebhookEvent","RateLimit" RESTART IDENTITY CASCADE`,
  );
}

export async function seedBasics() {
  const merchant = await db.merchant.create({
    data: {
      name: "Test Butcher",
      whatsappNumber: "4915112345678",
      settings: { create: {} },
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
  // Min €150, no fee: the numbers the original checkout tests were written against.
  const zone = await db.deliveryZone.create({
    data: { merchantId: merchant.id, name: "Berlin", minOrderCents: 15000, deliveryFeeCents: 0 },
  });
  // Mon–Sat every week with a 12h cutoff, so a bookable slot always exists regardless of when tests run.
  const route = await db.deliveryRoute.create({
    data: {
      zoneId: zone.id,
      name: "Berlin",
      schedules: {
        create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, windowStart: "10:00", windowEnd: "14:00", cutoffHoursBefore: 12 })),
      },
      postcodes: { create: [{ postcode: "10115" }, { postcode: "10117" }] },
    },
  });
  const date = addDays(berlinToday(new Date()), 5);
  return { merchant, beef, gone, zone, route, date };
}

export function checkoutBody(ctx: Awaited<ReturnType<typeof seedBasics>>, over: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    locale: "de",
    lines: [{ productId: ctx.beef.id, grams: 8000 }], // 8 kg * €20 = €160 estimated, €176 max
    customer: { firstName: "Example", lastName: "Customer", email: "customer@example.com", phone: "0151 12345678" },
    address: { street: "Example Street 12", postalCode: "10115", city: "Berlin" },
    deliveryNotes: "Ring twice",
    paymentMethod: "PAYPAL",
    consents: { terms: true, marketing: false, dataTransfer: false },
    ...over,
  };
}
