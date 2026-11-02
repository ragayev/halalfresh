# Halal Fresh — storefront review (Kevser pilot → multi-butcher)

## Pilot objective
Increase *new* customer acquisition for Kevser; don't merely move its existing customers online. The initial storefront must clearly separate Halal Fresh (marketplace) from Kevser (seller, fulfiller, delivery operator).

## Implemented in this branch
- Removed an unverified hardcoded 4.6/68 Google review claim from the partner card.
- Corrected misleading card-payment marketing copy in German, Turkish and English to match the current SEPA Direct Debit-only Stripe implementation.
- Corrected "choose delivery time" language to the current postcode-based scheduled window.
- Replaced premature halal certification / cold-chain guarantees with verification-appropriate language.
- Corrected the languages advertised in the footer to DE/TR/EN.

## Priority 0 — verify with Kevser before launch
- Confirm the seller legal name, physical address and correct Google profile URL; use no rating or certificate claim without evidence.
- Confirm products, exact per-kg and bundle prices, pack weights, stock, halal certification documentation, food origin and allergen data.
- Confirm delivery PLZ, actual routes, cutoff, order minimum (the €150 value is currently a partner proposal), fees, capacity, and transport/cold-chain handling.
- Validate end-to-end Stripe Connect SEPA test for Kevser, including delayed settlement, failed debit, refund, and early fulfilment risk decisions; customers must understand money may not be collected immediately.
- Complete and review legal pages, seller-of-record notices, privacy responsibilities and food labelling obligations before taking paid orders.
- Validate live checkout, order confirmation emails, admin WhatsApp hand-off, mobile E2E and production build in deployment environment.

## Next conversion-focused work
1. Interview 5–8 prospective *new* households in the actual delivery area: identify acceptable minimum basket and delivery fee before fixing €150.
2. Show postcode and the **next available scheduled delivery** before checkout, with clear 'not available here' messaging.
3. Make ready-to-order family bundles, actual per-kg pricing and image quality the main catalogue conversion levers. Do not show demo prices or placeholder photography in production.
4. Track privacy-compliant funnel milestones: postcode checked → product added → minimum met → checkout started → SEPA authorized → payment settled → fulfilled. Do not equate SEPA authorization with paid conversion.
5. Evaluate a lower first-order minimum or a limited delivery-fee incentive against Kevser's route economics, rather than assuming online prices must be higher than in-store prices.

## Preparing for multiple butchers
- Existing Merchant IDs on products, zones and orders are a useful foundation. Before a second butcher: add merchant-specific fulfilment contact and policies, enforce merchant isolation in admin queries and access control, and explicitly decide whether the basket is single-seller-only.
- Keep seller price and payment account unambiguous throughout product card, basket, checkout and order receipt; never silently mix multi-seller carts into a single charge.
- Plan per-merchant catalog moderation, dispatch monitoring, refunds and SLA dashboards only once the pilot proves demand.

## Verification status
This review is repository-level only. No local dependencies, database, browser automation or production Stripe credentials were available in the connected GitHub environment. Run typecheck, lint, unit tests, Playwright tests and build in CI before merging.
