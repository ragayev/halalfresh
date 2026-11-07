-- A price of 0 can never be a confirmed price. Early seeds left priceConfirmed at its default (true) on 0-cent rows.
-- Selling already required price > 0, so this changes no customer-visible behaviour; it makes the flag truthful.
-- Rollback: UPDATE "Product" SET "priceConfirmed" = true WHERE "pricePerKgCents" = 0 AND "bundleItems" IS NULL;
UPDATE "Product" SET "priceConfirmed" = false WHERE "pricePerKgCents" = 0 AND "priceConfirmed" = true;
