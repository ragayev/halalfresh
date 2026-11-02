import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, expire } = vi.hoisted(() => ({ create: vi.fn(), expire: vi.fn() }));
vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create, expire } };
  },
}));

import { stripeGateway } from "@/server/payments/stripe";

const args = {
  orderId: "o1",
  orderNumber: 7,
  lines: [{ name: "Beef", amountCents: 16000 }],
  totalCents: 16000,
  applicationFeeCents: 0,
  customerEmail: "c@example.com",
  connectedAccountId: "acct_kevser",
  successUrl: "https://x/s",
  cancelUrl: "https://x/c",
  idempotencyKey: "checkout_o1",
  locale: "de",
};

beforeEach(() => {
  create.mockReset();
  expire.mockReset();
  create.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/x", payment_method_types: ["sepa_debit"] });
  expire.mockResolvedValue({});
});

describe("Stripe SEPA Direct Debit checkout", () => {
  it("offers only SEPA as a direct charge on the seller's connected account", async () => {
    await stripeGateway.createCheckout(args);
    const [params, opts] = create.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.allowed_payment_method_types).toEqual(["sepa_debit"]);
    expect(params.payment_method_types).toBeUndefined();
    expect(opts).toMatchObject({ stripeAccount: "acct_kevser", idempotencyKey: "checkout_o1" });
    expect(params.line_items.every((l: { price_data: { currency: string } }) => l.price_data.currency === "eur")).toBe(true);
    expect(params.payment_intent_data.metadata.orderId).toBe("o1");
  });
  it("refuses to charge the platform account when the seller has no connected account", async () => {
    await expect(stripeGateway.createCheckout({ ...args, connectedAccountId: null })).rejects.toThrow(/connected Stripe account/);
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses a session that would also offer other payment methods", async () => {
    create.mockResolvedValue({ id: "cs_2", url: "https://checkout.stripe.com/y", payment_method_types: ["card", "sepa_debit"] });
    await expect(stripeGateway.createCheckout(args)).rejects.toThrow(/other than SEPA/);
    expect(expire).toHaveBeenCalledWith("cs_2", {}, { stripeAccount: "acct_kevser" });
  });
});
