-- Manual rollback of 20261101120000_delivery_zones_v2. Not run by Prisma.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261101120000_delivery_zones_v2/down.sql
--   then: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101120000_delivery_zones_v2';
-- and redeploy the previous app version. Orders are preserved. Waitlist entries, routes, schedules,
-- postcode assignments and blackout dates created under v2 are dropped (export them first if needed).
BEGIN;

-- Old tables
CREATE TABLE "DeliveryPostcode" (
    "id" TEXT NOT NULL, "zoneId" TEXT NOT NULL, "pattern" TEXT NOT NULL,
    CONSTRAINT "DeliveryPostcode_pkey" PRIMARY KEY ("id"));
CREATE TABLE "DeliverySlot" (
    "id" TEXT NOT NULL, "zoneId" TEXT NOT NULL, "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "DeliverySlot_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "DeliveryPostcode_zoneId_pattern_key" ON "DeliveryPostcode"("zoneId", "pattern");
CREATE UNIQUE INDEX "DeliverySlot_zoneId_weekday_startTime_endTime_key" ON "DeliverySlot"("zoneId", "weekday", "startTime", "endTime");
ALTER TABLE "DeliveryPostcode" ADD CONSTRAINT "DeliveryPostcode_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverySlot" ADD CONSTRAINT "DeliverySlot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restore archived rows whose zone still exists.
INSERT INTO "DeliverySlot" SELECT d->>'id', d->>'zoneId', (d->>'weekday')::int, d->>'startTime', d->>'endTime', (d->>'isActive')::boolean
  FROM "_legacy_delivery_archive" a, LATERAL (SELECT a."data" AS d) x
  WHERE a."kind" = 'slot' AND EXISTS (SELECT 1 FROM "DeliveryZone" z WHERE z."id" = a."data"->>'zoneId');
INSERT INTO "DeliveryPostcode" SELECT d->>'id', d->>'zoneId', d->>'pattern'
  FROM "_legacy_delivery_archive" a, LATERAL (SELECT a."data" AS d) x
  WHERE a."kind" = 'postcode' AND EXISTS (SELECT 1 FROM "DeliveryZone" z WHERE z."id" = a."data"->>'zoneId');

-- Orders placed under v2 have no legacy slot: synthesize one per (zone, weekday, window) from the order snapshot.
INSERT INTO "DeliverySlot" ("id", "zoneId", "weekday", "startTime", "endTime")
  SELECT 'rb' || md5(o."zoneId" || EXTRACT(DOW FROM o."deliveryDate") || o."slotStartTime" || o."slotEndTime"),
         o."zoneId", EXTRACT(DOW FROM o."deliveryDate")::int, o."slotStartTime", o."slotEndTime"
  FROM "Order" o WHERE o."legacySlotId" IS NULL OR NOT EXISTS (SELECT 1 FROM "DeliverySlot" s WHERE s."id" = o."legacySlotId")
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT DO NOTHING;
ALTER TABLE "Order" ADD COLUMN "slotId" TEXT;
UPDATE "Order" o SET "slotId" = o."legacySlotId" WHERE EXISTS (SELECT 1 FROM "DeliverySlot" s WHERE s."id" = o."legacySlotId");
UPDATE "Order" o SET "slotId" = s."id" FROM "DeliverySlot" s
  WHERE o."slotId" IS NULL AND s."zoneId" = o."zoneId" AND s."weekday" = EXTRACT(DOW FROM o."deliveryDate")::int
    AND s."startTime" = o."slotStartTime" AND s."endTime" = o."slotEndTime";
ALTER TABLE "Order" ALTER COLUMN "slotId" SET NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "DeliverySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order columns
ALTER TABLE "Order" DROP CONSTRAINT "Order_routeId_fkey";
ALTER TABLE "Order" DROP COLUMN "routeId", DROP COLUMN "zoneName", DROP COLUMN "deliveryMode",
  DROP COLUMN "minOrderCents", DROP COLUMN "freeDeliveryThresholdCents", DROP COLUMN "legacySlotId";

-- Settings
ALTER TABLE "MerchantSettings"
  ADD COLUMN "minOrderCents" INTEGER NOT NULL DEFAULT 15000,
  ADD COLUMN "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freeDeliveryOverCents" INTEGER,
  ADD COLUMN "slotLeadTimeHours" INTEGER NOT NULL DEFAULT 24,
  ALTER COLUMN "slotHorizonDays" SET DEFAULT 14;
UPDATE "MerchantSettings" ms SET
  "minOrderCents" = (a."data"->>'minOrderCents')::int,
  "deliveryFeeCents" = (a."data"->>'deliveryFeeCents')::int,
  "freeDeliveryOverCents" = (a."data"->>'freeDeliveryOverCents')::int,
  "slotLeadTimeHours" = (a."data"->>'slotLeadTimeHours')::int,
  "slotHorizonDays" = (a."data"->>'slotHorizonDays')::int
FROM "_legacy_delivery_archive" a WHERE a."kind" = 'settings' AND a."data"->>'merchantId' = ms."merchantId";

-- Zones: restore per-zone fee override semantics (nullable), drop v2 columns.
ALTER TABLE "DeliveryZone" ALTER COLUMN "deliveryFeeCents" DROP NOT NULL, ALTER COLUMN "deliveryFeeCents" DROP DEFAULT;
UPDATE "DeliveryZone" z SET "deliveryFeeCents" = NULLIF(a."data"->>'deliveryFeeCents', '')::int
  FROM "_legacy_delivery_archive" a WHERE a."kind" = 'zone' AND a."data"->>'id' = z."id";
UPDATE "DeliveryZone" z SET "deliveryFeeCents" = NULL
  WHERE NOT EXISTS (SELECT 1 FROM "_legacy_delivery_archive" a WHERE a."kind" = 'zone' AND a."data"->>'id' = z."id");
-- Reactivate zones that existed before the migration (they were deactivated by it).
UPDATE "DeliveryZone" z SET "isActive" = true WHERE EXISTS (SELECT 1 FROM "_legacy_delivery_archive" a WHERE a."kind" = 'zone' AND a."data"->>'id' = z."id");
-- v2-only zones with no orders are removed; with orders they stay (deactivated, no postcodes).
DELETE FROM "DeliveryZone" z WHERE NOT EXISTS (SELECT 1 FROM "_legacy_delivery_archive" a WHERE a."kind" = 'zone' AND a."data"->>'id' = z."id")
  AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."zoneId" = z."id");
UPDATE "DeliveryZone" z SET "isActive" = false WHERE NOT EXISTS (SELECT 1 FROM "_legacy_delivery_archive" a WHERE a."kind" = 'zone' AND a."data"->>'id' = z."id");
ALTER TABLE "DeliveryZone" DROP COLUMN "mode", DROP COLUMN "sortOrder", DROP COLUMN "minOrderCents", DROP COLUMN "freeDeliveryThresholdCents";

ALTER TABLE "Product" DROP COLUMN "isHidden", DROP COLUMN "preorderEligible";

DROP TABLE "WaitlistEntry";
DROP TABLE "DeliveryBlackoutDate";
DROP TABLE "PostcodeRoute";
DROP TABLE "RouteSchedule";
DROP TABLE "DeliveryRoute";
DROP TABLE "_legacy_delivery_archive";
DROP TYPE "ScheduleKind";
DROP TYPE "DeliveryMode";

COMMIT;
