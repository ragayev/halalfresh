-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sepaInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "earlyFulfillmentAuthorizedAt" TIMESTAMP(3),
ADD COLUMN     "earlyFulfillmentAuthorizedBy" TEXT;

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_orderId_kind_key" ON "NotificationLog"("orderId", "kind");

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
