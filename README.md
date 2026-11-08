# Halal Fresh

Mobile-first web shop where customers in Berlin order halal meat **by weight**. Kevser Fleischerei is the seller (prepares, weighs,
delivers, invoices); Halal Fresh is the ordering front end. There is no butcher-facing system in the MVP: the admin forwards orders to
Kevser via a WhatsApp click-to-chat link and enters the final weights reported back.

**Flow:** guest order (estimated + maximum total) → admin accepts → forwards to Kevser → Kevser weighs → admin enters grams →
customer gets the final amount and pays by PayPal (or cash on delivery from the second order) → dispatch → delivered.
Pricing, tolerance (±10 %, capped), payment-method eligibility and the order state machine are enforced in code
(`src/domain/pricing.ts`, `src/domain/order-state.ts`, `src/domain/payment-eligibility.ts`) and unit-tested.

**Stack:** Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · PostgreSQL + Prisma 6 · Zod · PayPal Orders v2 · Vitest + Playwright.
Admin auth: bcrypt password + TOTP, signed-cookie session (`jose`), re-verified against the DB on every admin page/action.
i18n: German (default) and Turkish, language in the URL (`/de`, `/tr`); the shop sets **no cookies**.

## Local development

```bash
npm install
cp .env.example .env            # fill in AUTH_SECRET, ADMIN_PASSWORD; keep PAYMENT_PROVIDER="mock" for no-PayPal dev
createdb halalfresh && createdb halalfresh_test
npm run db:migrate              # applies prisma/migrations (test DB: set -a; . ./.env.test; set +a; npx prisma migrate deploy)
npm run db:seed                 # bootstrap only: merchant, delivery zones, admin user (never touches products)
npm run catalog:audit           # read-only catalogue report (-- --json for raw)
npm run catalog:import          # dry-run; add -- --apply for the create-only legacy catalogue import (docs/catalog-migration.md)
npm run dev                     # http://localhost:3000   admin: /admin
```

- `PAYMENT_PROVIDER=mock` replaces PayPal with a local stand-in (no network); the same capture/webhook code paths run. It is hard-refused when `NODE_ENV=production`.
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

## Payments (PayPal) and the order flow

- **Pay after weighing.** A PayPal order (Orders v2, `intent=CAPTURE`) is created **only after `WEIGHED`**, for exactly `finalTotalCents`. The
  customer is sent to PayPal's hosted approval page (redirect flow, so **no PayPal script runs on `/b/{token}`**) and comes back to the order page, which
  captures **server-side**. `COMPLETED` → `PAID` immediately; `PENDING` stays `WEIGHED` until the webhook.
- **Idempotency.** `PayPal-Request-Id` on create/capture; an open PayPal order for the same amount is reused; webhooks are de-duplicated by PayPal event id
  (`ProcessedWebhookEvent`) and by payment row lock, so a capture response and its webhook (in either order) transition the order once.
- **Weight correction** while `WEIGHED` voids stale PayPal orders (they can never be captured) and re-notifies the customer. Not allowed after `PAID`.
- **Refunds/disputes** are done by the seller in PayPal; `PAYMENT.CAPTURE.REFUNDED` is recorded on the order (`refundedCents`), no status change.
- Raw provider responses are stored in `Payment.raw`. `PaymentProvider` (`src/server/payments/provider.ts`) and `Order.paymentMode`
  (`CAPTURE_AFTER_WEIGH` | `AUTHORIZE_THEN_CAPTURE`) leave room for the later auth/capture flow and marketplace `platform_fees`.

### Testing with the PayPal sandbox

1. Create a sandbox REST app (developer.paypal.com) → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`; set `PAYPAL_ENV=sandbox`, `PAYMENT_PROVIDER=paypal`.
2. Expose the local webhook endpoint with a tunnel, e.g. `cloudflared tunnel --url http://localhost:3000` (prints `https://<random>.trycloudflare.com`).
3. In the sandbox app add a webhook `https://<tunnel>/api/webhooks/paypal` subscribed to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`,
   `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `CHECKOUT.ORDER.APPROVED` → copy its id into `PAYPAL_WEBHOOK_ID`. Set `NEXT_PUBLIC_SITE_URL` to the tunnel URL
   so PayPal can return to the order page.
4. Place an order, accept → prepare → enter weights in the admin, open the order link and pay with a sandbox buyer account.
   Every webhook is verified with `POST /v1/notifications/verify-webhook-signature` before it is acted on.
- Live: separate `PAYPAL_ENV=live` credentials and webhook id. Never commit them.

### Order states

`NEW → ACCEPTED → PREPARING → WEIGHED → (PayPal) PAID → OUT_FOR_DELIVERY → DELIVERED` · `(cash) WEIGHED → OUT_FOR_DELIVERY → DELIVERED_UNPAID → CASH_COLLECTED` ·
`REFUSED_AT_DOOR` · `PAYMENT_OVERDUE` (admin, sends a reminder) · `CANCELLED` (customer only from `NEW`/`ACCEPTED`; admin needs a reason).
Implemented as an explicit table in `src/domain/order-state.ts`; every change is written to the append-only `OrderEvent` log by `transitionOrder()` (`src/server/orders.ts`).

### Migrating from the Stripe prepay model

`20261108090000_mvp_order_domain` replaces the order model. It first **copies** the old tables into `legacy_*` (not read by the app), then empties and reshapes the order tables.
Back up first (`pg_dump -Fc`). The migration is not reversible in place (`down.sql` explains how to restore from the archive/backup).

## Delivery zones

Customers never see a zone map. On first open they enter a postcode (PLZ); it is kept in `localStorage` only (no cookie; so server pages can hide non-preorder products) and can be changed from the header chip. `GET /api/delivery/check?postcode=XXXXX` returns zone, mode, minimum order, fee, free-delivery threshold and the **next concrete slot**. Checkout re-resolves everything server-side from the address postcode (client values are ignored; a `checkedPostcode` that differs from the address is rejected with `POSTCODE_MISMATCH`) and stores route, slot, fee and minimum on the order.

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
2. Set env vars from `.env.example` (never set `PAYMENT_PROVIDER=mock`; set `ADMIN_ALERT_EMAIL`). `NEXT_PUBLIC_SITE_URL=https://halalfresh.app`. `AUTH_SECRET` ≥ 32 chars.
3. Build command `prisma migrate deploy && next build`. Run `npm run db:seed` once from a trusted machine (set `ADMIN_EMAIL`/`ADMIN_PASSWORD`) to bootstrap merchant, delivery zones and the admin user; for an empty catalogue follow `docs/catalog-migration.md` (`catalog:import` dry-run, then `--apply`).
4. PayPal developer dashboard → webhooks: add `https://<domain>/api/webhooks/paypal` with the events listed above; put its id in `PAYPAL_WEBHOOK_ID`.
5. Configure SMTP (`SMTP_URL`) for order emails — without it emails are skipped (a log line is written, no personal data).
   Nothing in this repo deploys or pushes automatically.

## Architecture

```
src/domain/    pure business rules (money, pricing, delivery area/slots, state machines, WhatsApp text) — unit tested
src/server/    checkout, order ops, webhook processor, PayPal provider (paypal | mock), notifications, auth, email, catalog — Prisma-backed
src/app/(site)/[locale]/…   storefront: home, shop, product, cart, checkout, b/[token], how-it-works, legal
src/app/(admin)/admin/…     dashboard, orders (+ detail with WhatsApp), products, customers, settings (seller, operating, delivery)
src/app/api/   cart pricing, postcode/slot lookup, checkout, bundle expansion, order pay/capture/cancel, image serving, PayPal webhooks
src/i18n/      locales, dictionaries (de/tr), provider
prisma/        schema, migrations, seed
```

Multi-merchant readiness: every product, zone and order carries `merchantId`; checkout currently resolves the single merchant. Cart/checkout across several merchants is intentionally not built.

Security: server-side recalculation of every price/fee/slot; rate limits (Postgres-backed) on login, checkout, postcode/slot lookup and cart pricing; PII-scrubbing logger; unguessable order tokens (`/de/b/<token>`, `noindex`); admin pages `noindex`/`no-store`; security headers in `next.config.ts`.

## Implemented vs. needs your input

**Implemented & tested:** pricing/tolerance/cap rules, order state machine, cash eligibility, guest checkout with the German legal block, bundle expansion,
admin order processing (WhatsApp templates, weight entry/correction, notifications log), PayPal create/capture/webhooks (idempotent), customer order page
(`/b/{token}`), consents with wording versions, metrics page, TOTP admin login, DE/TR, design system. Money paths are covered by unit and integration tests;
the PayPal provider itself is exercised through the mock provider (the real HTTP calls need sandbox credentials).

**Needs your input / external configuration:**

- PayPal Business credentials and webhook id (sandbox first); SMTP, seven.io and Telegram accounts; domain.
- Kevser's legal details, WhatsApp number, AGB text and PDF (`AGB_PDF_PATH`), Impressum, Datenschutz, Nutzungsbedingungen — placeholders until provided.
- Wording for the data-transfer consent (pending lawyer review, kept in settings with a version).
- Real product photos, prices, gram steps, origin text, delivery PLZ list/fees/windows, bundle definitions.
- Halal certificate: `halalCertificateVerified` stays `false` until you tick it in Einstellungen; the word "zertifiziert" is not shown before that.
