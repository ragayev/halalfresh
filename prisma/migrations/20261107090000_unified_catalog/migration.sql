-- Unified catalogue. Purely additive: no column is dropped, no row is deleted, no existing value is rewritten
-- except the new columns' backfill. Rollback: docs/catalog-migration.md.

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "SellingUnit" AS ENUM ('KG', 'PIECE', 'PACKAGE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "sellingUnit" "SellingUnit" NOT NULL DEFAULT 'KG';
ALTER TABLE "ProductImage" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;

-- Backfill publishing status from the legacy flag: hidden -> DRAFT (nothing is archived automatically).
UPDATE "Product" SET "status" = 'DRAFT' WHERE "isHidden" = true;
-- Bundles are sold per package.
UPDATE "Product" SET "sellingUnit" = 'PACKAGE' WHERE "bundleItems" IS NOT NULL;
-- Generic or illustrative stand-ins: the shared default image and every image of an imported supplier-only article.
UPDATE "ProductImage" SET "isPlaceholder" = true
WHERE "url" = '/images/products/default-product.svg'
   OR "productId" IN (SELECT "id" FROM "Product" WHERE "slug" LIKE 'kevser-%');

-- One publishing source of truth: the legacy flag may never contradict the status.
ALTER TABLE "Product" ADD CONSTRAINT "product_hidden_matches_status" CHECK ("isHidden" = ("status" <> 'ACTIVE'));

-- CreateIndex
CREATE INDEX "Product_status_categoryId_idx" ON "Product"("status", "categoryId");

-- CreateTable
CREATE TABLE "SupplierArticle" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "originalName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierArticle_merchantId_supplierSku_key" ON "SupplierArticle"("merchantId", "supplierSku");
CREATE INDEX "SupplierArticle_productId_idx" ON "SupplierArticle"("productId");

-- AddForeignKey
ALTER TABLE "SupplierArticle" ADD CONSTRAINT "SupplierArticle_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierArticle" ADD CONSTRAINT "SupplierArticle_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill supplier article numbers from the legacy JSON (translations.supplierArticleNumbers).
-- The JSON is left untouched. A number claimed by more than one product is ambiguous: it is NOT mapped (no arbitrary
-- winner) and is reported by `npm run catalog:audit`.
INSERT INTO "SupplierArticle" ("id", "merchantId", "productId", "supplierSku", "originalName", "source", "updatedAt")
SELECT 'sa_' || md5(p."id" || ':' || s.sku), p."merchantId", p."id", s.sku,
       NULLIF(p."translations"->>'supplierOriginalName', ''), 'kevser-list', CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN LATERAL (
  SELECT DISTINCT btrim(v) AS sku
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p."translations"->'supplierArticleNumbers') = 'array'
         THEN p."translations"->'supplierArticleNumbers' ELSE '[]'::jsonb END) AS v
  WHERE btrim(v) <> ''
) s
WHERE (
  SELECT count(DISTINCT p2."id") FROM "Product" p2
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p2."translations"->'supplierArticleNumbers') = 'array'
         THEN p2."translations"->'supplierArticleNumbers' ELSE '[]'::jsonb END) AS v2
  WHERE p2."merchantId" = p."merchantId" AND btrim(v2) = s.sku
) = 1
ON CONFLICT ("merchantId", "supplierSku") DO NOTHING;
