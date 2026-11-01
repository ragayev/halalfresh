-- Delivery v2: zones with mode/min/fee, routes, schedules, postcode->route, blackout dates, waitlist.
-- Existing orders are NEVER deleted or rewritten: delivery terms are snapshotted onto each order first.
-- Rollback: see down.sql in this folder. BACK UP THE DATABASE FIRST (see README "Delivery zones").

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('REGULAR', 'PREORDER_ONLY');
CREATE TYPE "ScheduleKind" AS ENUM ('WEEKLY', 'NTH_WEEKDAY_OF_MONTH');

-- 1. Archive legacy config (rows are small; lets down.sql restore exactly what existed).
CREATE TABLE "_legacy_delivery_archive" (
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL
);
INSERT INTO "_legacy_delivery_archive" ("kind", "data")
  SELECT 'slot', to_jsonb(s) FROM "DeliverySlot" s;
INSERT INTO "_legacy_delivery_archive" ("kind", "data")
  SELECT 'postcode', to_jsonb(p) FROM "DeliveryPostcode" p;
INSERT INTO "_legacy_delivery_archive" ("kind", "data")
  SELECT 'settings', jsonb_build_object(
    'merchantId', "merchantId", 'minOrderCents', "minOrderCents", 'deliveryFeeCents', "deliveryFeeCents",
    'freeDeliveryOverCents', "freeDeliveryOverCents", 'slotLeadTimeHours', "slotLeadTimeHours", 'slotHorizonDays', "slotHorizonDays")
  FROM "MerchantSettings";
INSERT INTO "_legacy_delivery_archive" ("kind", "data")
  SELECT 'zone', jsonb_build_object('id', "id", 'deliveryFeeCents', "deliveryFeeCents") FROM "DeliveryZone";

-- 2. Zones: new terms, backfilled from the old per-merchant settings / per-zone fee override.
ALTER TABLE "DeliveryZone"
  ADD COLUMN "mode" "DeliveryMode" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minOrderCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freeDeliveryThresholdCents" INTEGER;
UPDATE "DeliveryZone" z SET
  "minOrderCents" = ms."minOrderCents",
  "deliveryFeeCents" = COALESCE(z."deliveryFeeCents", ms."deliveryFeeCents"),
  "freeDeliveryThresholdCents" = ms."freeDeliveryOverCents"
FROM "MerchantSettings" ms WHERE ms."merchantId" = z."merchantId";
UPDATE "DeliveryZone" SET "deliveryFeeCents" = 0 WHERE "deliveryFeeCents" IS NULL;
ALTER TABLE "DeliveryZone" ALTER COLUMN "deliveryFeeCents" SET NOT NULL, ALTER COLUMN "deliveryFeeCents" SET DEFAULT 0;
-- Legacy zones lose their postcode patterns; deactivate so they never match. Kept because orders reference them.
UPDATE "DeliveryZone" SET "isActive" = false;

-- 3. Orders: snapshot terms (min order = value in force at migration time; the old schema never stored it per order).
ALTER TABLE "Order"
  ADD COLUMN "routeId" TEXT,
  ADD COLUMN "zoneName" TEXT,
  ADD COLUMN "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "minOrderCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freeDeliveryThresholdCents" INTEGER,
  ADD COLUMN "legacySlotId" TEXT;
UPDATE "Order" o SET
  "zoneName" = z."name",
  "minOrderCents" = z."minOrderCents",
  "freeDeliveryThresholdCents" = z."freeDeliveryThresholdCents",
  "legacySlotId" = o."slotId"
FROM "DeliveryZone" z WHERE z."id" = o."zoneId";
ALTER TABLE "Order" ALTER COLUMN "zoneName" SET NOT NULL;
-- deliveryDate, slotStartTime, slotEndTime, deliveryFeeCents were already stored on the order and are untouched.
ALTER TABLE "Order" DROP CONSTRAINT "Order_slotId_fkey";
ALTER TABLE "Order" DROP COLUMN "slotId";

-- 4. Drop old tables, settings columns.
DROP TABLE "DeliverySlot";
DROP TABLE "DeliveryPostcode";
ALTER TABLE "MerchantSettings"
  DROP COLUMN "minOrderCents",
  DROP COLUMN "deliveryFeeCents",
  DROP COLUMN "freeDeliveryOverCents",
  DROP COLUMN "slotLeadTimeHours",
  ALTER COLUMN "slotHorizonDays" SET DEFAULT 90;
UPDATE "MerchantSettings" SET "slotHorizonDays" = 90 WHERE "slotHorizonDays" < 90;

-- 5. Products
ALTER TABLE "Product"
  ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "preorderEligible" BOOLEAN NOT NULL DEFAULT false;

-- 6. New tables
CREATE TABLE "DeliveryRoute" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RouteSchedule" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "kind" "ScheduleKind" NOT NULL DEFAULT 'WEEKLY',
    "weekday" INTEGER NOT NULL,
    "nth" INTEGER,
    "windowStart" TEXT NOT NULL,
    "windowEnd" TEXT NOT NULL,
    "cutoffHoursBefore" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "RouteSchedule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PostcodeRoute" (
    "postcode" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    CONSTRAINT "PostcodeRoute_pkey" PRIMARY KEY ("postcode")
);
CREATE TABLE "DeliveryBlackoutDate" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "DeliveryBlackoutDate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL,
    "consentGivenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryRoute_zoneId_idx" ON "DeliveryRoute"("zoneId");
CREATE INDEX "RouteSchedule_routeId_idx" ON "RouteSchedule"("routeId");
CREATE INDEX "PostcodeRoute_routeId_idx" ON "PostcodeRoute"("routeId");
CREATE UNIQUE INDEX "DeliveryBlackoutDate_merchantId_date_key" ON "DeliveryBlackoutDate"("merchantId", "date");
CREATE INDEX "WaitlistEntry_postcode_idx" ON "WaitlistEntry"("postcode");

ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteSchedule" ADD CONSTRAINT "RouteSchedule_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostcodeRoute" ADD CONSTRAINT "PostcodeRoute_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryBlackoutDate" ADD CONSTRAINT "DeliveryBlackoutDate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
