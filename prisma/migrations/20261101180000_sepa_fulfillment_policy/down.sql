-- Manual rollback of 20261101180000_sepa_fulfillment_policy. Not run by Prisma.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261101180000_sepa_fulfillment_policy/down.sql
--   then: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101180000_sepa_fulfillment_policy';
DROP TABLE "NotificationLog";
ALTER TABLE "Order" DROP COLUMN "sepaInitiatedAt", DROP COLUMN "earlyFulfillmentAuthorizedAt", DROP COLUMN "earlyFulfillmentAuthorizedBy";
