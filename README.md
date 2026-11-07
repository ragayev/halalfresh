# Halal Fresh

Mobile-first halal meat delivery marketplace for Berlin & Brandenburg (domain: halalfresh.app).
One partner butcher, guest checkout, €150 minimum merchandise value, Stripe Checkout (one Stripe account, no commission split), and a private
admin that forwards paid orders to the butcher through a WhatsApp click-to-chat link (no WhatsApp API).

**Stack:** Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · PostgreSQL + Prisma 6 · Zod · Stripe Checkout · Vitest + Playwright.
Admin auth is a custom signed-cookie session (bcrypt + `jose` JWT), re-verified against the DB on every admin page/action.
i18n is a small purpose-built layer (`/de`, `/tr`, `/en` routes, JSON dictionaries, `proxy.ts` locale redirect: highest-q `Accept-Language` match, else German).

## Local development

```bash
npm install
cp .env.example .env            # fill in AUTH_SECRET, ADMIN_PASSWORD; keep PAYMENT_GATEWAY="mock" for no-Stripe dev
createdb halalfresh && createdb halalfresh_test
npm run db:migrate              # applies prisma/migrations (test DB: set -a; . ./.env.test; set +a; npx prisma migrate deploy)
npm run db:seed                 # bootstrap only: merchant, delivery zones, admin user (never touches products)
npm run catalog:audit           # read-only catalogue report (-- --json for raw)
npm run catalog:import          # dry-run; add -- --apply for the create-only legacy catalogue import (docs/catalog-migration.md)
npm run dev                     # http://localhost:3000   admin: /admin
```

- `PAYMENT_GATEWAY=mock` swaps Stripe Checkout for a local stand-in page (`/en/dev/mock-pay/...`). It feeds a synthetic event
  through the **same** webhook processor. It is hard-refused when `NODE_ENV=production`.
- Before the first order, in **Admin → Settings** set the butcher's WhatsApp number (international format).
- Product images are generated demo artwork (`npm run gen:images`). Upload real photos in Admin → Products (stored in Postgres, served by `/api/images/[id]`).

## Kevser supplier article list (2026-11-07)

The 8 photographed sheets supplied by the merchant have been transcribed into
`prisma/data/kevser-articles.json` (**140 article codes**). The importer in
`npm run catalog:import` (dry-run by default, create-only with `--apply`) links exact matches to existing products and creates missing cuts and
packaged variants using `kevser-<article-number>` slugs. Article codes are stored in the
normalised `SupplierArticle` table (unique per merchant), shown and searchable under **Admin → Products**;
the shop search also accepts supplier article codes. See `docs/catalog-migration.md`.

Every newly created item is **unavailable with €0 placeholder price** until the
butcher confirms the actual price, weight/packaging and stock. Most items remain
visible as *price coming soon*. The industrial equipment and two ambiguous entries
are hidden; supplier names/translations still require merchant review. No halal
certification or price is inferred from these sheets.

Missing photos use existing category-specific stock images or
`/images/products/default-product.svg`. These are placeholders, not photos of the
specific SKU. The storefront also has a visual fallback when a product has no image.

**Important:** Pushing this repository does **not** populate a deployed database, and
`npm run db:seed` no longer creates products. On a *new* database run
`npm run catalog:import` (review the dry-run) and then `npm run catalog:import -- --apply`.
Never apply it to an existing catalogue without reading the dry-run. Check the products in the admin before enabling
availability. The importer is create-only for new products and preserves later
admin edits. Re-running it safely adds missing article metadata.

## Tests

```bash
npm run typecheck && npm run lint
npm test              # unit + integration tests (uses DATABASE_URL from .env.test → halalfresh_test)
npm run test:e2e      # Playwright, mobile + desktop, uses system Chrome, own dev server on :3100 (dist dir .next-e2e) and the test DB
npm run build
```

Last run: typecheck ✔ · lint ✔ · 45/45 Vitest ✔ · 16/16 Playwright (8 flows × mobile/desktop) ✔ · production build ✔.
E2E and integration tests mock only the payment boundary (mock gateway / locally signed webhook payloads); WhatsApp is stubbed so tests never contact it.

### Verifying with real Stripe test mode

1. `STRIPE_SECRET_KEY=sk_test_...`, `PAYMENT_GATEWAY=stripe`.
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy the `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
3. Enable SEPA Direct Debit on the connected test account. Pay with test IBAN `DE89370400440532013000`; the order shows _SEPA processing_ until `async_payment_succeeded` arrives (`stripe trigger`/Dashboard) and `PAID` only then. IBAN `DE62888888880012345678` simulates a failed debit.
5. Refund from the admin order page and confirm `refund.created` is received.

## Payments, SEPA and fulfillment (V1 pilot)

- **SEPA Direct Debit only.** Stripe Checkout (`allowed_payment_method_types: ["sepa_debit"]`) collects the IBAN and the mandate; Halal Fresh never sees bank details. Sessions are **direct charges on the seller's connected account** (`Merchant.stripeAccountId`); with `PAYMENT_GATEWAY=stripe` checkout is refused (503) if that account is missing or lacks the `sepa_debit_payments` capability, so the platform account is never charged by accident. No commission is taken.
- **Authorization is not payment.** `checkout.session.completed` with `payment_status: unpaid` (mandate accepted, debit initiated) sets `Order.sepaInitiatedAt`, logs `PAYMENT_PROCESSING`, and sends the customer an acknowledgement that says the money is **not yet collected**. `paymentStatus` stays `PENDING_PAYMENT`. Only `checkout.session.async_payment_succeeded` (verified webhook) sets `PAID`. `async_payment_failed` / `payment_intent.payment_failed` set `PAYMENT_FAILED` and alert the admin.
- **Fulfillment policy** (`src/domain/order-state.ts`, `fulfillmentGate`): a created checkout can never be prepared. Once SEPA is initiated the order appears under **Needs action** in the admin; forwarding/preparing needs either settlement or the admin's explicit, audited **Authorize fulfilment now** (risk checkbox; stores who and when, `EARLY_FULFILLMENT_AUTHORIZED` event + audit row). Authorization never marks anything paid and is void if the debit fails. After a failure, only recording an already dispatched delivery is still allowed. A processing SEPA debit cannot be cancelled (it cannot be stopped); cancel after settlement (full refund) or failure.
- Failures after delivery are **critical** in the admin list/detail/dashboard and e-mail the admin (`ADMIN_ALERT_EMAIL`, else all admin users).
- Orders are marked paid only by verified webhooks (`/api/webhooks/stripe`, Connect endpoint): `checkout.session.completed|async_payment_succeeded|async_payment_failed|expired`, `payment_intent.payment_failed`, `refund.created|updated|failed`.
- Idempotency: event-id ledger written in the same DB transaction as the state change; Stripe idempotency keys; client `requestId` prevents duplicate orders on double submit. Notifications are de-duplicated by the unique `NotificationLog(orderId, kind)` claim.
- Out-of-order safety: a paid order is never downgraded by late failure/expiry; late initiation never regresses a paid/failed order; a late success revives an order cancelled on expiry; refunds before the payment is recorded return 500 so Stripe retries.
- Customer tracking (`/[locale]/order/[token]`): 5-step timeline (received → confirmed → preparing → out for delivery → delivered), cancellation shown separately, and a separate payment indicator. It polls `GET /api/order/[token]/status` (statuses only, `no-store`, rate limited) every 3 s right after checkout, 20 s while fulfilling, 60 s while only SEPA settles, paused in background tabs, and stops in terminal states.
- Delivery: customers do **not** pick a slot. See _Delivery zones_ below.

### Required Stripe settings

1. Connect: Kevser's account connected (`Merchant.stripeAccountId`), `sepa_debit_payments` capability **active**, SEPA Direct Debit enabled under Settings → Payment methods **for that account** (the code filters to SEPA but Stripe must consider it eligible).
2. Webhook endpoint `/api/webhooks/stripe` listening to **events on Connected accounts**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`, `refund.failed`. Secret in `STRIPE_WEBHOOK_SECRET`.
3. Statement descriptor / mandate text on Kevser's account should name the seller. SEPA debits settle in ~2-5 business days and can be returned for up to 8 weeks (13 months for unauthorized debits).

## Delivery zones

Customers never see a zone map. On first open they enter a postcode (PLZ); it is kept in `localStorage` + a `hf_postcode` cookie (so server pages can hide non-preorder products) and can be changed from the header chip. `GET /api/delivery/check?postcode=XXXXX` returns zone, mode, minimum order, fee, free-delivery threshold and the **next concrete slot**. Checkout re-resolves everything server-side from the address postcode (client values are ignored; a `checkedPostcode` that differs from the address is rejected with `POSTCODE_MISMATCH`) and stores route, slot, fee and minimum on the order.

- **Data (Admin → Delivery):** zones (`REGULAR` / `PREORDER_ONLY`, min order, fee, free-delivery threshold) → routes → weekly or "nth weekday of month" schedules (window + cutoff hours) and postcodes (one route per postcode, stored as text so `03046` keeps its zero). Blackout dates and the waitlist report (count per postcode, CSV) live under the same menu. All money is integer cents; all date logic is Europe/Berlin.
- **Next slot:** earliest slot whose cutoff is still ahead; Sundays and blackout dates are skipped. Cutoffs subtract whole days on the Berlin calendar (so "48h before Tuesday 14:00" is Sunday 14:00 local on DST weekends too).
- **Preorder-only zones** accept only products with _Preorder eligible_ set. The catalogue import adds hidden, unavailable placeholders ("Ramazan Kutusu", "Kurban Hissesi", "Akika") with price 0: set the price and untick _Hidden_ + tick _Available_ in Admin → Products once confirmed.
- **Seed / postcodes:** `npm run db:seed` builds the placeholder zones from `prisma/data/postcodes.verified.json`, generated by `npx tsx scripts/verify-postcodes.ts` (checks every postcode against OpenPLZ API data and lists the ones that do not exist). Re-running the seed never overwrites delivery config that already exists (`SEED_RESET_DELIVERY=1` forces a rebuild). Every number is a placeholder, marked `TODO confirm with Kevser` in `prisma/seed.ts`.

### Migrating an existing database (delivery v2)

`prisma/migrations/20261101120000_delivery_zones_v2` replaces the old zone/slot/postcode tables. **Existing orders are never deleted or rewritten**: each order is snapshotted first (`zoneName`, `minOrderCents`, `freeDeliveryThresholdCents`, `legacySlotId`; its date, window and fee were already stored), and the old slot/postcode/settings rows are archived in `_legacy_delivery_archive` so the migration can be reversed.

1. **Back up first** (restorable with `pg_restore`):
   ```bash
   pg_dump "$DATABASE_URL" -Fc -f halalfresh-before-delivery-v2-$(date +%F).dump
   # hosted DB (Neon/Supabase/Vercel Postgres): take a snapshot/branch in the provider's dashboard as well
   ```
2. Rehearse on a copy: `createdb halalfresh_copy && pg_dump "$DATABASE_URL" | psql halalfresh_copy`, then run step 3 against it.
3. `npx prisma migrate deploy` then `npm run db:seed` (the seed only builds zones when no routes exist yet). Legacy zones that orders reference stay in the table, inactive.
4. **Rollback:**
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261101120000_delivery_zones_v2/down.sql
   psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261101120000_delivery_zones_v2'"
   ```
   then deploy the previous app version. Orders (also those placed under v2) survive; v2-only data (routes, waitlist, blackouts) is dropped. Restoring the dump from step 1 is the other, always-safe way back.

## Deploying to Vercel

1. Create a Postgres database (Neon/Vercel Postgres/Supabase) and set `DATABASE_URL`.
2. Set env vars from `.env.example` (never set `PAYMENT_GATEWAY=mock`; set `ADMIN_ALERT_EMAIL`). `NEXT_PUBLIC_SITE_URL=https://halalfresh.app`. `AUTH_SECRET` ≥ 32 chars.
3. Build command `prisma migrate deploy && next build`. Run `npm run db:seed` once from a trusted machine (set `ADMIN_EMAIL`/`ADMIN_PASSWORD`) to bootstrap merchant, delivery zones and the admin user; for an empty catalogue follow `docs/catalog-migration.md` (`catalog:import` dry-run, then `--apply`).
4. Stripe Dashboard → Developers → Webhooks: add endpoint `https://halalfresh.app/api/webhooks/stripe` (events on your account) with the events above; put the secret in `STRIPE_WEBHOOK_SECRET`.
5. Configure SMTP (`SMTP_URL`) for order emails — without it emails are skipped (a log line is written, no personal data).
   Nothing in this repo deploys or pushes automatically.

## Architecture

```
src/domain/    pure business rules (money, pricing, delivery area/slots, state machines, WhatsApp text) — unit tested
src/server/    checkout, order ops, webhook processor, payment gateway (stripe | mock), auth, email, catalog — Prisma-backed
src/app/(site)/[locale]/…   storefront: home, shop, product, cart, checkout, success/cancelled, order/[token], legal
src/app/(admin)/admin/…     dashboard, orders (+ detail with WhatsApp), products, settings (merchant, delivery, Stripe)
src/app/api/   cart pricing, postcode/slot lookup, checkout, image serving, Stripe webhooks
src/i18n/      locales, dictionaries (en/de/tr), provider
prisma/        schema, migrations, seed
```

Multi-merchant readiness: every product, zone and order carries `merchantId`; checkout currently resolves the single merchant. Cart/checkout across several merchants is intentionally not built.

Security: server-side recalculation of every price/fee/slot; rate limits (Postgres-backed) on login, checkout, postcode/slot lookup and cart pricing; PII-scrubbing logger; unguessable order tokens (`/en/order/<token>`, `noindex`); admin pages `noindex`/`no-store`; security headers in `next.config.ts`.

## Implemented vs. needs your input

**Implemented & tested:** everything in the brief's customer app, admin (dashboard, orders, order detail, WhatsApp forwarding with duplicate warnings and separate “mark as forwarded”, fulfillment states + customer emails, products incl. image upload, delivery & merchant settings, Stripe status), 3 languages, SEO (metadata, JSON-LD, sitemap, robots, canonicals/hreflang), Stripe payment and refund logic.

**Blocked on credentials / external configuration (not verified against live Stripe in this environment):**

- Real Stripe test-mode run (needs your keys; PayPal etc. must be enabled in the Stripe Dashboard) — covered by signed-payload tests and the mock gateway only.
- SMTP provider for emails; production domain/DNS; managed Postgres.
- Butcher's real name, address, WhatsApp number, real prices, product photography, delivery postcodes/days/fees (seed values are demo placeholders).

**Business/legal decisions needing review (not solved by code):**

- Legal pages (`src/content/legal.ts`) are placeholders: Impressum, Datenschutz, AGB, withdrawal wording for perishable goods, LMIV/food-information duties, Preisangabenverordnung (price-per-kg display), VSBG notice.
- Halal certification text is shown only if entered per product; nothing is claimed by default.
- Seller-of-record and responsibilities between Halal Fresh and the butcher; because payments land on the operator's Stripe account, the onward settlement/commission agreement with the butcher needs tax and legal review.
- VAT/invoicing: no tax rates are hardcoded; invoices/receipts must be handled by the butcher/Stripe or added later.
- Only essential browser storage is used (cart, language) so there is no consent banner. If analytics/ads are ever added, a consent mechanism is required first.
- GDPR: the butcher receives customer name/address/phone — needs a data-processing/sharing arrangement and retention policy. WhatsApp itself is a third-party processor of that data.
- Admin accounts are seed-created; there is no password reset or 2FA yet.

## Known limitations

- Rate limiting and PII logging rules are best-effort; no WAF. Image uploads are stored in Postgres (≤ 2 MB) — move to object storage if volume grows.
- Delivery estimates have no capacity limits; a single delivery zone is editable in the admin UI.
- Mock-gateway e2e runs on dev server; run `npm run build && npm start` for a final smoke test.
