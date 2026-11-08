import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ENVIRONMENT BOOTSTRAP ONLY: merchant, merchant settings, first delivery configuration and the admin user.
// Safe to re-run: existing rows are kept; it never creates, changes or hides a product.
const db = new PrismaClient();

async function main() {
  const merchant =
    (await db.merchant.findFirst()) ??
    (await db.merchant.create({
      data: {
        name: "Kevser Fleischerei",
        addressLine: "Hermannstraße 64",
        postalCode: "12049",
        city: "Berlin",
      },
    }));
  await db.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: { merchantId: merchant.id },
  });

  // Products are NOT seeded here: PostgreSQL is the catalogue's source of truth and is managed in Admin → Products.
  // The one-time legacy import is explicit and dry-run by default: `npm run catalog:import` (see docs/catalog-migration.md).
  await seedDelivery(merchant.id);

  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (email && password.length >= 10) {
    await db.adminUser.upsert({
      where: { email },
      update: { passwordHash: await hash(password, 12) },
      create: { email, passwordHash: await hash(password, 12) },
    });
    console.log("Admin user ready:", email);
  } else console.log("Skipped admin user: set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars).");
}

// ---------------------------------------------------------------------------------------------
// Delivery zones. Every value below is a PLACEHOLDER from the brief.
// Postcodes come from prisma/data/postcodes.verified.json (scripts/verify-postcodes.ts, OpenPLZ).
// ---------------------------------------------------------------------------------------------
interface VerifiedPostcodes {
  berlin: string[];
  verified: { zone: 2 | 3; route: string; postcode: string }[];
}

async function seedDelivery(merchantId: string) {
  // Re-running the seed must never clobber admin-managed delivery config: only (re)build when no routes exist
  // yet (fresh DB, or right after the v2 migration), or when forced.
  if ((await db.deliveryRoute.count()) > 0 && process.env.SEED_RESET_DELIVERY !== "1") {
    console.log("Delivery config exists; skipping (set SEED_RESET_DELIVERY=1 to rebuild the demo zones).");
    return;
  }
  // Zones referenced by existing orders are kept (their orders carry a full snapshot) but are never matched again.
  await db.deliveryZone.updateMany({ where: { merchantId }, data: { isActive: false } });
  await db.deliveryZone.deleteMany({ where: { merchantId, orders: { none: {} } } });
  await db.deliveryBlackoutDate.deleteMany({ where: { merchantId } });

  const data = JSON.parse(readFileSync(join(__dirname, "data/postcodes.verified.json"), "utf8")) as VerifiedPostcodes;
  const assigned = new Set<string>();

  const mkZone = (d: {
    name: string;
    mode: "REGULAR" | "PREORDER_ONLY";
    minOrderCents: number;
    deliveryFeeCents: number;
    freeDeliveryThresholdCents: number | null;
    sortOrder: number;
  }) => db.deliveryZone.create({ data: { merchantId, ...d } });
  const mkRoute = async (
    zoneId: string,
    name: string,
    schedules: {
      weekday: number;
      kind?: "WEEKLY" | "NTH_WEEKDAY_OF_MONTH";
      nth?: number;
      windowStart: string;
      windowEnd: string;
      cutoffHoursBefore: number;
    }[],
  ) => db.deliveryRoute.create({ data: { zoneId, name, schedules: { create: schedules } } });
  const assign = async (routeId: string, postcodes: string[]) => {
    // Explicit assignments made earlier win; later (broader) lists never steal a postcode.
    const fresh = postcodes.filter((p) => !assigned.has(p));
    fresh.forEach((p) => assigned.add(p));
    await db.postcodeRoute.createMany({ data: fresh.map((postcode) => ({ postcode, routeId })) });
  };
  const verified = (zone: 2 | 3, route: string) => data.verified.filter((v) => v.zone === zone && v.route === route).map((v) => v.postcode);

  // Zone 2 + 3 first, so their explicit postcodes win any overlap with Berlin.
  // TODO confirm with Kevser: min order €150, fee €0, Tuesday/Thursday 14:00–18:00, 48h cutoff.
  const z2 = await mkZone({
    name: "Berlin suburbs",
    mode: "REGULAR",
    minOrderCents: 15000,
    deliveryFeeCents: 0,
    freeDeliveryThresholdCents: null,
    sortOrder: 2,
  });
  const west = await mkRoute(z2.id, "West", [{ weekday: 2, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 48 }]);
  const northEast = await mkRoute(z2.id, "North/East", [{ weekday: 4, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 48 }]);
  await assign(west.id, verified(2, "West"));
  await assign(northEast.id, verified(2, "North/East"));

  // TODO confirm with Kevser: min order €300, fee €0, first Saturday of the month 14:00–18:00, 7-day cutoff.
  const z3 = await mkZone({
    name: "Far Brandenburg",
    mode: "PREORDER_ONLY",
    minOrderCents: 30000,
    deliveryFeeCents: 0,
    freeDeliveryThresholdCents: null,
    sortOrder: 3,
  });
  const far = await mkRoute(z3.id, "Far Brandenburg", [
    { kind: "NTH_WEEKDAY_OF_MONTH", nth: 1, weekday: 6, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 7 * 24 },
  ]);
  await assign(far.id, verified(3, "Far Brandenburg"));

  // TODO confirm with Kevser: min €60, fee €4.90, free from €120, Mon–Sat 14:00–18:00, 24h cutoff.
  const z1 = await mkZone({
    name: "Berlin",
    mode: "REGULAR",
    minOrderCents: 6000,
    deliveryFeeCents: 490,
    freeDeliveryThresholdCents: 12000,
    sortOrder: 1,
  });
  const berlin = await mkRoute(
    z1.id,
    "Berlin",
    [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, windowStart: "14:00", windowEnd: "18:00", cutoffHoursBefore: 24 })),
  );
  await assign(berlin.id, data.berlin);
  console.log(`Delivery zones seeded: ${assigned.size} postcodes.`);
}

main().finally(() => db.$disconnect());
