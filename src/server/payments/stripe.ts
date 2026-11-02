import Stripe from "stripe";
import type { AccountStatus, PaymentGateway } from "./gateway";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new GatewayConfigError("STRIPE_SECRET_KEY is not configured");
  return (client ??= new Stripe(key, { maxNetworkRetries: 2 }));
}

export class GatewayConfigError extends Error {}

const CHECKOUT_LOCALES = new Set(["en", "de", "tr"]);

/**
 * V1 pilot: SEPA Direct Debit only. Checkout collects the IBAN and the mandate itself (Halal Fresh never sees or
 * stores bank details). Charges are DIRECT charges on the butcher's connected account, so the money settles with the
 * butcher, not with Halal Fresh. A missing connected account is refused rather than silently charging the platform.
 */
export const stripeGateway: PaymentGateway = {
  name: "stripe",

  async createCheckout(a) {
    const stripe = stripeClient();
    if (!a.connectedAccountId) throw new GatewayConfigError("No connected Stripe account configured for the seller");
    const expiresAt = new Date(Date.now() + 31 * 60_000); // Stripe minimum is 30 min
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // On this API version the static `payment_method_types` list is gone: this is a filter on the methods Stripe deems
        // eligible, so SEPA must also be enabled for the seller in Stripe (see README).
        allowed_payment_method_types: ["sepa_debit"],
        client_reference_id: a.orderId,
        customer_email: a.customerEmail,
        locale: CHECKOUT_LOCALES.has(a.locale) ? (a.locale as "en" | "de") : "auto",
        line_items: a.lines.map((l) => ({
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: l.amountCents,
            product_data: { name: l.name },
          },
        })),
        payment_intent_data: {
          ...(a.applicationFeeCents ? { application_fee_amount: a.applicationFeeCents } : {}),
          metadata: { orderId: a.orderId, orderNumber: String(a.orderNumber) },
        },
        metadata: { orderId: a.orderId, orderNumber: String(a.orderNumber) },
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: a.successUrl,
        cancel_url: a.cancelUrl,
      },
      { stripeAccount: a.connectedAccountId, idempotencyKey: a.idempotencyKey },
    );
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    // Belt and braces for "SEPA only": never hand the customer a session that would also offer cards, wallets, etc.
    if (session.payment_method_types?.some((m) => m !== "sepa_debit")) {
      await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: a.connectedAccountId }).catch(() => undefined);
      throw new GatewayConfigError("Checkout session offers payment methods other than SEPA Direct Debit");
    }
    return { sessionId: session.id, url: session.url, expiresAt };
  },

  async expireCheckout(sessionId, connectedAccountId) {
    await stripeClient().checkout.sessions.expire(sessionId, {}, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);
  },

  async refund(a) {
    const stripe = stripeClient();
    const r = await stripe.refunds.create(
      {
        payment_intent: a.paymentIntentId,
        amount: a.amountCents,
      },
      {
        stripeAccount: a.connectedAccountId ?? undefined,
        idempotencyKey: a.idempotencyKey,
      },
    );
    return { refundId: r.id, status: r.status ?? "pending" };
  },

  async getAccountStatus(accountId): Promise<AccountStatus> {
    const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") ? "live" : "test";
    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        accountId,
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        sepaDebitEnabled: false,
        detailsSubmitted: false,
        requirementsDue: [],
        mode,
      };
    }
    // No connected account configured: charges go to the platform's own Stripe account.
    const acct = await (accountId ? stripeClient().accounts.retrieve(accountId) : stripeClient().accounts.retrieveCurrent());
    return {
      accountId: acct.id,
      connected: true,
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      sepaDebitEnabled: acct.capabilities?.sepa_debit_payments === "active",
      detailsSubmitted: !!acct.details_submitted,
      requirementsDue: acct.requirements?.currently_due ?? [],
      mode,
    };
  },
};
