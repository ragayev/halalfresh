-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "checkoutUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_requestId_key" ON "Order"("requestId");

