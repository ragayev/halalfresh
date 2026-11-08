-- MVP order domain: Stripe prepay orders are replaced by weight-based, pay-after-weighing orders.
-- The old order model cannot be mapped onto the new one, so existing rows are archived
-- into legacy_* tables (kept for reference, not read by the app) and then removed.
CREATE TABLE "legacy_Customer" AS SELECT * FROM "Customer";
CREATE TABLE "legacy_Address" AS SELECT * FROM "Address";
CREATE TABLE "legacy_Order" AS SELECT * FROM "Order";
CREATE TABLE "legacy_OrderItem" AS SELECT * FROM "OrderItem";
CREATE TABLE "legacy_OrderEvent" AS SELECT * FROM "OrderEvent";
CREATE TABLE "legacy_Payment" AS SELECT * FROM "Payment";
CREATE TABLE "legacy_Refund" AS SELECT * FROM "Refund";
CREATE TABLE "legacy_CommissionRecord" AS SELECT * FROM "CommissionRecord";
-- Detach archives from enum types that are dropped below.
ALTER TABLE "legacy_Order" ALTER COLUMN "paymentStatus" TYPE text, ALTER COLUMN "fulfillmentStatus" TYPE text;
ALTER TABLE "legacy_Payment" ALTER COLUMN "status" TYPE text;
ALTER TABLE "legacy_CommissionRecord" ALTER COLUMN "status" TYPE text;
TRUNCATE "Refund", "CommissionRecord", "NotificationLog", "Payment", "OrderEvent", "OrderItem", "Order", "Address", "Customer" CASCADE;
DELETE FROM "ProcessedWebhookEvent";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'PREPARING', 'WEIGHED', 'PAYMENT_OVERDUE', 'PAID', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERED_UNPAID', 'CASH_COLLECTED', 'REFUSED_AT_DOOR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAYPAL', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CAPTURE_AFTER_WEIGH', 'AUTHORIZE_THEN_CAPTURE');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('CREATED', 'APPROVED', 'PENDING', 'COMPLETED', 'DENIED', 'VOIDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('MARKETING', 'DATA_TRANSFER', 'TERMS');

-- DropForeignKey
ALTER TABLE "CommissionRecord" DROP CONSTRAINT "CommissionRecord_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_addressId_fkey";

-- DropForeignKey
ALTER TABLE "Refund" DROP CONSTRAINT "Refund_paymentId_fkey";

-- DropIndex
DROP INDEX "Merchant_stripeAccountId_key";

-- DropIndex
DROP INDEX "Order_accessToken_key";

-- DropIndex
DROP INDEX "Order_deliveryDate_idx";

-- DropIndex
DROP INDEX "Order_paymentStatus_fulfillmentStatus_idx";

-- DropIndex
DROP INDEX "Payment_stripeCheckoutSessionId_key";

-- DropIndex
DROP INDEX "Payment_stripePaymentIntentId_key";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "totpSecret" TEXT;

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "locale",
DROP COLUMN "name",
DROP COLUMN "phone",
ADD COLUMN     "blockedCash" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "phoneE164" TEXT NOT NULL,
ADD COLUMN     "refusedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Merchant" DROP COLUMN "stripeAccountId";

-- AlterTable
ALTER TABLE "MerchantSettings" DROP COLUMN "commissionBps";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "accessToken",
DROP COLUMN "addressId",
DROP COLUMN "applicationFeeCents",
DROP COLUMN "currency",
DROP COLUMN "deliveryInstructions",
DROP COLUMN "earlyFulfillmentAuthorizedAt",
DROP COLUMN "earlyFulfillmentAuthorizedBy",
DROP COLUMN "forwardedAt",
DROP COLUMN "forwardedBy",
DROP COLUMN "freeDeliveryThresholdCents",
DROP COLUMN "fulfillmentStatus",
DROP COLUMN "lastWhatsappOpenAt",
DROP COLUMN "legacySlotId",
DROP COLUMN "paymentStatus",
DROP COLUMN "sepaInitiatedAt",
DROP COLUMN "subtotalCents",
DROP COLUMN "totalCents",
DROP COLUMN "whatsappOpenCount",
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cappedAmountCents" INTEGER,
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "commissionCents" INTEGER,
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "estimatedTotalCents" INTEGER NOT NULL,
ADD COLUMN     "finalTotalCents" INTEGER,
ADD COLUMN     "maxTotalCents" INTEGER NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paidAmountCents" INTEGER,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL,
ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'CAPTURE_AFTER_WEIGH',
ADD COLUMN     "postalCode" TEXT NOT NULL,
ADD COLUMN     "publicToken" TEXT NOT NULL,
ADD COLUMN     "refusedAt" TIMESTAMP(3),
ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "street" TEXT NOT NULL,
ADD COLUMN     "terminalAt" TIMESTAMP(3),
ADD COLUMN     "toleranceBps" INTEGER NOT NULL,
ADD COLUMN     "weighedAt" TIMESTAMP(3),
ALTER COLUMN "locale" SET DEFAULT 'de',
ALTER COLUMN "commissionBps" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderEvent" DROP COLUMN "note",
DROP COLUMN "type",
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "reason" TEXT,
DROP COLUMN "fromStatus",
ADD COLUMN     "fromStatus" "OrderStatus",
DROP COLUMN "toStatus",
ADD COLUMN     "toStatus" "OrderStatus",
ALTER COLUMN "actor" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "bundleSnapshot",
DROP COLUMN "lineTotalCents",
DROP COLUMN "quantityGrams",
ADD COLUMN     "actualGrams" INTEGER,
ADD COLUMN     "bundleId" TEXT,
ADD COLUMN     "estimatedCents" INTEGER NOT NULL,
ADD COLUMN     "finalCents" INTEGER,
ADD COLUMN     "requestedGrams" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "applicationFeeCents",
DROP COLUMN "balanceTransactionId",
DROP COLUMN "checkoutUrl",
DROP COLUMN "connectedAccountId",
DROP COLUMN "failureReason",
DROP COLUMN "paidAt",
DROP COLUMN "stripeChargeId",
DROP COLUMN "stripeCheckoutSessionId",
DROP COLUMN "stripeFeeCents",
DROP COLUMN "stripePaymentIntentId",
ADD COLUMN     "providerCaptureId" TEXT,
ADD COLUMN     "providerOrderId" TEXT,
ADD COLUMN     "raw" JSONB,
ALTER COLUMN "provider" SET DEFAULT 'paypal',
DROP COLUMN "status",
ADD COLUMN     "status" "PaymentRecordStatus" NOT NULL DEFAULT 'CREATED';

-- DropTable
DROP TABLE "CommissionRecord";

-- DropTable
DROP TABLE "Refund";

-- DropTable
DROP TABLE "_legacy_delivery_archive";

-- DropEnum
DROP TYPE "CommissionStatus";

-- DropEnum
DROP TYPE "FulfillmentStatus";

-- DropEnum
DROP TYPE "PaymentStatus";

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "ConsentType" NOT NULL,
    "wordingVersion" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Consent_customerId_idx" ON "Consent"("customerId");

-- CreateIndex
CREATE INDEX "Notification_orderId_idx" ON "Notification"("orderId");

-- CreateIndex
CREATE INDEX "Notification_orderId_channel_template_idx" ON "Notification"("orderId", "channel", "template");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneE164_key" ON "Customer"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");

-- CreateIndex
CREATE INDEX "Order_status_deliveryDate_idx" ON "Order"("status", "deliveryDate");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerCaptureId_key" ON "Payment"("providerCaptureId");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

