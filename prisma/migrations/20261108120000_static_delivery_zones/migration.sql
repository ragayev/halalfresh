-- Delivery terms now come from static postcode data (src/data/delivery); orders no longer need a DB zone.
ALTER TABLE "Order" ALTER COLUMN "zoneId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "tier" TEXT;
ALTER TABLE "Order" ADD COLUMN "sector" TEXT;
ALTER TABLE "Order" ADD COLUMN "zoneNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "reportedFinalCents" INTEGER;
ALTER TABLE "WaitlistEntry" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'waitlist';
