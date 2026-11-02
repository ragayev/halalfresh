-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bundleItems" JSONB,
ADD COLUMN     "priceConfirmed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "bundleSnapshot" JSONB;
