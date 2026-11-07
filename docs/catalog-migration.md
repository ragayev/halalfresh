# Unified product catalogue

PostgreSQL is the only source of truth for products. Admin and storefront read the same rows through the same rules.

```
PostgreSQL (Product, Category, ProductImage, SupplierArticle)
   ├── src/domain/product-rules.ts      pure rules: status, availability, price confirmation, units, SKUs, image status
   ├── src/server/product-service.ts    admin reads/writes (transactional, audited) – the only writer of product state
   ├── src/server/catalog.ts            storefront reads (published products only)
   ├── src/server/pricing-service.ts    checkout pricing, re-checks eligibility on the server
   └── Admin /admin/products            filters, stats, edit, CSV export/import
```

## Audit findings (pre-refactor)

| Question | Finding |
|---|---|
| Where are products created? | `prisma/seed.ts` (catalog.json, kevser-articles.json, 4 bundles from `src/domain/bundles.ts`, 3 preorder placeholders) and the admin form. |
| Updated? | Admin form/toggles. The seed also *updated* bundles (content, images; price/visibility too while unconfirmed), appended SKUs into `translations` JSON, and re-hid demo products on every run. |
| Seed run twice | Mostly create-only, but bundles were rewritten and their images deleted/recreated, and demo categories re-hidden: not safe to run on a managed catalogue. |
| Deployment | README told operators to run `db:seed` after deploy, so a deploy could touch products. Now the seed is bootstrap-only. |
| Supplier SKUs | In `Product.translations.supplierArticleNumbers` (JSON): no uniqueness, not searchable in SQL. Now `SupplierArticle` with `UNIQUE(merchantId, supplierSku)`. |
| Matching | `existingSlug` in `kevser-articles.json`, otherwise a new `kevser-<sku>` product. Names are never used for matching. |
| Images | `ProductImage.url` (repository file under `public/images/products/`) or `data` (DB upload served by `/api/images/[id]`). Unchanged. |
| Admin vs storefront | Admin: every row, no filters/pagination. Storefront: `isHidden = false`. Checkout checked `isHidden` + `isAvailable` + bundle price, but **not** that a plain product had a price > 0. |
| Bundles | Code constants seeded to rows; row is `pricePerKgCents` = price of one package at "1000 g". |
| Flags | `isHidden` (publishing), `isAvailable` (commercial), `priceConfirmed` (only meaningful for bundles; defaulted to `true` on 0-cent rows), `preorderEligible`. |
| Checkout/order snapshot fields | `id`, `name`, `slug`, `pricePerKgCents`, `quantityGrams`, `lineTotalCents`, `bundleSnapshot`. Untouched. |
| Audit log | `AuditLog` existed and is used for orders and the old product save; now every product mutation writes a field-level diff. |

## Model

* `Product.status` (`DRAFT` / `ACTIVE` / `ARCHIVED`) is the canonical publishing state. `isHidden` is kept as a mirror (`status <> 'ACTIVE'`) because it is read by older code and queries; a CHECK constraint (`product_hidden_matches_status`) makes a contradiction impossible. Direct writes of `isHidden` alone are rejected by the database.
* `isAvailable` = may be bought now. `priceConfirmed` + `pricePerKgCents > 0` = a real price. **Purchasable = ACTIVE ∧ available ∧ confirmed price** (and a valid bundle definition for bundles): `isPurchasable()` in `product-rules.ts`, used by the product view, the cart view and checkout pricing. A published product without a price is listed as "price coming soon" and cannot be bought.
* `Product.sellingUnit` (`KG` / `PIECE` / `PACKAGE`). Compatibility layer: quantities remain integers; for `PIECE`/`PACKAGE` one unit is 1000 in the quantity column and `pricePerKgCents` is the price of one unit. This is exactly the existing bundle convention, so price maths, order lines and snapshots are unchanged. The service enforces whole-unit step/min/max for non-KG products. (A column rename is intentionally left for later.)
* `SupplierArticle(merchantId, supplierSku)` unique; many articles per product.
* `ProductImage.isPlaceholder` marks generic/illustrative stand-ins (shown in the admin as "placeholder", counted by "missing image").

## Imports

* `npm run db:seed`: bootstrap only (merchant, settings, first delivery config, admin user). Never touches products.
* `npm run catalog:audit [-- --json]`: read-only report.
* `npm run catalog:import`: dry-run (default). `-- --apply` writes. **Create-only**: existing products (by slug), their prices, images, status, bundle contents and SKU mappings are never modified; a SKU already mapped elsewhere is reported as a conflict, not moved. `-- --hide-legacy-demo` additionally unpublishes the early fictional demo products and is never implied.
* Admin → Products → Import CSV: prices / price confirmation / availability only, matched by product `id`; preview first, apply is all-or-nothing and re-validated on the server.

## Bundles

After the one-time import PostgreSQL owns bundle contents and prices; the constants in `src/domain/bundles.ts` are only the initial-import template. Components are validated (`productSlug` must exist, weights positive); publishing needs a confirmed price; orders keep their own `bundleSnapshot`. The four bundle recipes were **not** changed.

## Migrations (additive only)

1. `20261107090000_unified_catalog`: enums, `Product.status`, `Product.sellingUnit`, `ProductImage.isPlaceholder`, `SupplierArticle`; backfills `status` from `isHidden` (hidden → `DRAFT`, nothing archived), bundles → `PACKAGE`, placeholder flags (default image + `kevser-*` products), SKUs from `translations.supplierArticleNumbers` (a SKU found under more than one product is **not** mapped; the audit lists it), then the CHECK constraint. The legacy JSON is left in place.
2. `20261107090100_unconfirm_zero_prices`: `priceConfirmed=false` where the price is 0. No behaviour change (selling already needed price > 0), but the flag is now truthful.

No column dropped, no row deleted, no ID or slug changed.

### Pre-flight against the target database (read-only)

```sh
DATABASE_URL=… npm run catalog:audit
# duplicate SKUs across products in the legacy JSON (must be empty, or resolved by hand first)
psql "$DATABASE_URL" -c "select s, count(*) from \"Product\", jsonb_array_elements_text(case when jsonb_typeof(translations->'supplierArticleNumbers')='array' then translations->'supplierArticleNumbers' else '[]' end) s group by s having count(*)>1"
```

### Rollback

The app of the previous release keeps working against the migrated schema (new columns have defaults) except for writes of `isHidden` alone, which the CHECK rejects. To roll the schema back (only after redeploying the previous release):

```sql
ALTER TABLE "Product" DROP CONSTRAINT "product_hidden_matches_status";
DROP TABLE "SupplierArticle";
ALTER TABLE "ProductImage" DROP COLUMN "isPlaceholder";
ALTER TABLE "Product" DROP COLUMN "status", DROP COLUMN "sellingUnit";
DROP TYPE "ProductStatus"; DROP TYPE "SellingUnit";
DELETE FROM "_prisma_migrations" WHERE migration_name IN ('20261107090000_unified_catalog','20261107090100_unconfirm_zero_prices');
-- optional: UPDATE "Product" SET "priceConfirmed" = true WHERE "pricePerKgCents" = 0 AND "bundleItems" IS NULL;
```

Take a `pg_dump` first. SKU mappings created or edited after the migration live only in `SupplierArticle`; export them before dropping the table (`\copy "SupplierArticle" to …`).

## Deployment order

1. Back up the production database (`pg_dump`).
2. Run the read-only audit and the duplicate-SKU query above against production; resolve anything listed.
3. Deploy (build runs `prisma migrate deploy`). Do **not** run `db:seed` or `catalog:import --apply` on an existing catalogue.
4. Run `npm run catalog:audit` again and compare. `npm run catalog:import` (dry-run) must report *0 products to create* on a catalogue that was seeded earlier; if it reports creations, review them before `--apply`.
5. Open Admin → Products, check the stats and the "No/placeholder image" and "No confirmed price" filters.

## Images

Repository images live in `public/images/products/` and are referenced by path from `ProductImage.url`; new ones need a commit and a deploy. Admin uploads are stored in PostgreSQL (`ProductImage.data`) and served by `/api/images/[id]`: the only runtime-writable storage on Vercel. The edit page states which one each image uses. Both are addressed through `ProductImage`, so object storage can replace either later without touching product IDs or the view contract. No images were generated in this change.

## Known limitations

* Production/staging inventory was not available: all counts in the PR are from the local development database.
* The `sellingUnit` layer is a compatibility convention (see above); storefront labels still key off "bundle" for the quantity wording of non-kg, non-bundle products.
* `/api/images/[id]` serves any stored upload regardless of product status (existing behaviour).
* The seed still resets the admin password from `ADMIN_PASSWORD` on every run (existing behaviour).
* Name-collision pairs (e.g. `lamb-chops` vs `kuzu-pirzola`) are reported, never merged.
